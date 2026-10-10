// POST /api/dfresh/leads (spec D2, docs/06_API.md). Every lead is saved to MySQL first; e-mail and the Google
// Sheet row are only queued here (mail_outbox / sync_outbox) in the SAME transaction, so a SendGrid or Google
// outage can never lose a lead or show the visitor an error.
// Order: form type -> honeypot (fake success, nothing saved) -> validation (rules.json) -> transaction:
//   bump the year's lead_counters row (row lock: unique lead_ref, and it serialises the rate-limit count)
//   -> rate limit by ip_hash -> leads + lead_products -> outbox rows -> commit.
const crypto = require('crypto');
const express = require('express');
const { getDBConnection } = require('../../config/db');
const { rules, isFormType, validateLead } = require('./validation');
const mailer = require('./mailer');
const { brochure } = require('./Brochure_server');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const RATE_MAX = Number(process.env.LEAD_RATE_LIMIT_PER_10MIN) || rules.rateLimit.max;
const RATE_WINDOW_MIN = rules.rateLimit.windowMinutes;
const MAIL_LINK_TTL = '7d';
const TZ = 'Asia/Kolkata';

if (!process.env.IP_HASH_SALT) {
  if (process.env.NODE_ENV === 'production') throw new Error('IP_HASH_SALT must be set in production');
  console.warn('IP_HASH_SALT is not set: rate-limit hashes use an empty salt (dev only)');
}

const ipHash = (ip) => crypto.createHash('sha256').update(`${process.env.IP_HASH_SALT || ''}|${ip || ''}`).digest('hex');
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function istParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: '2-digit', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const fullYear = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric' }).format(date);
  return { yr: Number(parts.year), label: `${parts.day} ${parts.month} ${fullYear}, ${parts.hour}:${parts.minute} IST` };
}

// Active option values per list and active product ids (cards + colour variants), for validation.
async function loadLookups() {
  const [[opts], [prods]] = await Promise.all([
    db.query('SELECT list_key, option_value FROM form_options WHERE is_active = 1'),
    db.query(
      `SELECT p.product_id FROM products p
         JOIN categories c ON c.category_key = p.category_key AND c.is_active = 1
        WHERE p.is_active = 1`
    ),
  ]);
  const options = {};
  for (const r of opts) (options[r.list_key] ||= new Set()).add(r.option_value);
  return { options, products: new Set(prods.map((r) => r.product_id)) };
}

async function loadLanguages() {
  const [rows] = await db.query('SELECT lang_code, name_en, html_lang, is_default FROM languages WHERE is_active = 1');
  const def = rows.find((r) => Number(r.is_default) === 1) || rows[0];
  return { rows, def: def.lang_code };
}

// Everything the e-mails need besides the lead itself, read inside the transaction.
async function mailContext(conn, { lang, def, productIds, optionPairs }) {
  const [settingRows] = await conn.query(
    "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('lead_email', 'company_name', 'public_email')"
  );
  const settings = Object.fromEntries(settingRows.map((r) => [r.setting_key, (r.setting_value || '').trim()]));

  let products = [];
  if (productIds.length) {
    const [rows] = await conn.query(
      `SELECT p.product_id, t.name FROM products p
         JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = ?
        WHERE p.product_id IN (${productIds.map(() => '?').join(', ')})`,
      [def, ...productIds]
    );
    const names = new Map(rows.map((r) => [r.product_id, r.name]));
    products = productIds.map((id) => ({ id, name: names.get(id) || '' }));
  }

  const options = {};
  for (const [field, list, value] of optionPairs) {
    if (!value) continue;
    const [[row]] = await conn.query(
      'SELECT label FROM form_option_translations WHERE list_key = ? AND option_value = ? AND lang_code = ?',
      [list, value, def]
    );
    if (row) options[field] = row.label;
  }

  const uiKeys = ['mail_bro_subject', 'mail_bro_intro', 'download_brochure', 'consent'];
  const [uiRows] = await conn.query(
    `SELECT k.text_key, COALESCE(t.value, e.value) AS value
       FROM ui_text_keys k
       JOIN ui_text e ON e.text_key = k.text_key AND e.lang_code = ?
       LEFT JOIN ui_text t ON t.text_key = k.text_key AND t.lang_code = ?
      WHERE k.text_key IN (${uiKeys.map(() => '?').join(', ')})`,
    [def, lang, ...uiKeys]
  );
  const ui = Object.fromEntries(uiRows.map((r) => [r.text_key, r.value]));
  return { settings, products, options, ui };
}

// form fields -> leads columns (distributor extras go to details_json; firm name also to business_name for search)
function toColumns(formType, v) {
  const base = { phone: v.phone, email: v.email };
  if (formType === 'brochure') {
    return { ...base, first_name: v.first_name, last_name: v.last_name, full_name: `${v.first_name} ${v.last_name}` };
  }
  if (formType === 'distributor') {
    const details = {
      firm_name: v.firm_name, gst_no: v.gst_no, areas: v.areas,
      godown_vehicles: v.godown_vehicles, brands: v.brands, monthly_sales: v.monthly_sales,
    };
    return { ...base, full_name: v.full_name, business_name: v.firm_name, details_json: JSON.stringify(details) };
  }
  if (formType === 'contact') return { ...base, full_name: v.full_name, message: v.message };
  return {
    ...base, full_name: v.full_name, business_name: v.business_name, business_type: v.business_type,
    town: v.town, monthly_quantity: v.monthly_quantity, message: v.message,
  };
}

const outboxMail = (conn, leadId, purpose, to, m) => conn.query(
  'INSERT INTO mail_outbox (to_email, subject, html_body, text_body, purpose, lead_id) VALUES (?, ?, ?, ?, ?, ?)',
  [to, m.subject, m.html, m.text, purpose, leadId]
);

class RateLimited extends Error {}

router.post('/leads', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const formType = body.form_type;
  if (!isFormType(formType)) return res.status(400).json({ success: false, message: 'Unknown form', fields: {} });

  // Honeypot: a bot filled the hidden field. Looks like success, nothing is saved.
  if (typeof body.website === 'string' && body.website !== '') {
    console.warn(`honeypot hit (${formType}), not saved`);
    return res.json({ success: true, data: { lead_ref: null, brochure_available: false } });
  }

  let conn;
  try {
    const [lookups, langs] = await Promise.all([loadLookups(), loadLanguages()]);
    const checked = validateLead(formType, body, lookups);
    if (!checked.ok) return res.status(400).json({ success: false, message: 'Please check the form', fields: checked.fields });
    const v = checked.values;
    const lang = langs.rows.some((r) => r.lang_code === body.lang) ? body.lang : langs.def;
    const langRow = langs.rows.find((r) => r.lang_code === lang);
    const productIds = v.products || [];
    const found = formType === 'brochure' ? await brochure.findBrochure(lang) : null;
    const { yr, label: receivedAt } = istParts();

    conn = await db.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();

    await conn.query(
      'INSERT INTO lead_counters (yr, last_no) VALUES (?, 1) ON DUPLICATE KEY UPDATE last_no = last_no + 1',
      [yr]
    );
    const [[counter]] = await conn.query('SELECT last_no FROM lead_counters WHERE yr = ?', [yr]);
    const leadRef = `DFL-${String(yr).padStart(2, '0')}${String(counter.last_no).padStart(4, '0')}`;

    const hash = ipHash(req.ip);
    const [[recent]] = await conn.query(
      'SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created_at > NOW() - INTERVAL ? MINUTE',
      [hash, RATE_WINDOW_MIN]
    );
    if (Number(recent.n) >= RATE_MAX) throw new RateLimited();

    const ctx = await mailContext(conn, {
      lang,
      def: langs.def,
      productIds,
      optionPairs: [
        ['business_type', 'business_type', v.business_type],
        ['godown_vehicles', 'yes_no', v.godown_vehicles],
        ['monthly_sales', 'monthly_sales', v.monthly_sales],
      ],
    });

    const cols = {
      lead_ref: leadRef,
      form_type: formType,
      ...toColumns(formType, v),
      lang_code: lang,
      source_page: str(body.source_page, 150),
      source_ref: str(body.source_ref, 60),
      consent_given: 1,
      consent_text: (ctx.ui.consent || '').slice(0, 500),
      ip_hash: hash,
      user_agent: str(req.get('user-agent'), 255),
    };
    const names = Object.keys(cols);
    const [ins] = await conn.query(
      `INSERT INTO leads (${names.join(', ')}, consent_at) VALUES (${names.map(() => '?').join(', ')}, NOW())`,
      names.map((n) => cols[n])
    );
    const leadId = ins.insertId;
    for (const id of productIds) {
      await conn.query('INSERT INTO lead_products (lead_id, product_id) VALUES (?, ?)', [leadId, id]);
    }

    // Visitor's brochure copy (only when there is a PDF to link to)
    if (found) {
      const token = brochure.signBrochureToken({ leadId, lang }, MAIL_LINK_TTL);
      const apiBase = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4012}`).replace(/\/+$/, '');
      const copy = mailer.renderBrochureCopy({
        htmlLang: langRow.html_lang,
        ui: ctx.ui,
        name: v.first_name,
        link: `${apiBase}/api/dfresh/brochure/download?token=${encodeURIComponent(token)}`,
        companyName: ctx.settings.company_name,
        publicEmail: ctx.settings.public_email,
      });
      await outboxMail(conn, leadId, 'brochure_copy', v.email, copy);
    }

    // Staff alert
    if (ctx.settings.lead_email) {
      const alert = mailer.renderLeadAlert({
        leadRef,
        formType,
        receivedAt,
        fullName: cols.full_name,
        firstName: cols.first_name,
        lastName: cols.last_name,
        businessName: formType === 'distributor' ? v.firm_name : cols.business_name,
        businessType: cols.business_type,
        town: cols.town,
        phone: cols.phone,
        email: cols.email,
        monthlyQuantity: cols.monthly_quantity,
        message: cols.message,
        details: formType === 'distributor' ? JSON.parse(cols.details_json) : null,
        products: ctx.products,
        options: ctx.options,
        brochure: formType !== 'brochure' ? null : found ? 'sent' : 'pending',
        brochureLang: found ? found.lang.toUpperCase() : null,
        languageName: `${langRow.name_en} (${lang})`,
        sourcePage: cols.source_page,
        sourceRef: cols.source_ref,
        consentText: cols.consent_text,
        companyName: ctx.settings.company_name,
      });
      await outboxMail(conn, leadId, 'lead_alert', ctx.settings.lead_email, alert);
    } else {
      console.error(`site_settings.lead_email is empty: no staff alert queued for ${leadRef}`);
    }

    await conn.query("INSERT INTO sync_outbox (target, lead_id) VALUES ('gsheet', ?)", [leadId]);
    await conn.commit();

    const data = { lead_ref: leadRef };
    if (formType === 'brochure') {
      data.brochure_available = Boolean(found);
      if (found) data.brochure_token = brochure.signBrochureToken({ leadId, lang }, brochure.inPageTtl());
    }
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err instanceof RateLimited) {
      return res.status(429).json({ success: false, message: 'Too many requests, please try again later', errorKey: 'e_rate' });
    }
    console.error('lead save failed:', err.code || err.message);
    return res.status(500).json({ success: false, message: 'Could not save, please try again' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
