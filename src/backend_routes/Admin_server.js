// Admin API /api/dfresh/admin/* (spec F, docs/06_API.md). Sign-in lives in Admin_login_server.js.
// - Every route is registered through route(method, path, role, handler, opts): the role argument is
//   mandatory, so no route can exist without a role check. requireAuth runs before all of them.
//   Roles: viewer (read), editor (content + leads), admin (also settings, users, languages, Excel import).
// - Every write records audit_log (before / after) in the same transaction as the change.
// - opts.content: a successful write busts the public content cache, so the site shows it on the next request.
// - DB constraint errors become 400 / 409 with a plain message; nothing else leaks.
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { getDBConnection } = require('../../config/db');
const auth = require('./auth');
const entities = require('./admin-entities');
const media = require('./admin-media');
const excel = require('./product-excel');
const theme = require('./excel-theme');
const positions = require('./positions');
const csv = require('./csv');
const contentCache = require('./content-cache');
const { audit } = require('./audit');
const path = require('path');
const mailer = require('./mailer');
const logoCheck = require('./mail-logo-check');
const senderCheck = require('./sendgrid-sender-check');
const loginServer = require('./Admin_login_server');
const fontManager = require('./font-manager');
const outboxWorker = require('./outbox-worker');
const gsheet = require('./gsheet');
const settingRules = require('../shared/settingRules');
const { STAFF_GROUP, RETIRED_KEYS } = require('./text-groups');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const { InputError } = entities;
const permissions = require('../shared/permissions');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const pricing = require('./pricing');
const priceExcel = require('./price-excel');
const invoices = require('./invoices');
const MB = 1024 * 1024;
const upload = (maxMb) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * MB, files: 1 } }).single('file');

router.use('/admin', auth.requireAuth);
// Express 5 leaves req.body undefined without a JSON body; multer replaces it on uploads.
router.use('/admin', (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') req.body = {};
  next();
});

// Midnight today in India, as a UTC DATETIME (created_at is UTC): dashboard "today" / "last 7 days". India has no
// daylight saving, so a fixed +05:30 (no MySQL time zone tables needed).
const IST_TODAY_UTC = "CONVERT_TZ(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), '+05:30', '+00:00')";

const DB_ERRORS = {
  ER_DUP_ENTRY: [409, 'That already exists'],
  ER_NO_REFERENCED_ROW_2: [400, 'It refers to something that does not exist (check the keys and product IDs)'],
  ER_ROW_IS_REFERENCED_2: [409, 'It is still used elsewhere (e.g. by leads or kits); deactivate it instead'],
  ER_DATA_TOO_LONG: [400, 'A value is too long'],
  ER_TRUNCATED_WRONG_VALUE: [400, 'A value has the wrong format'],
  ER_WARN_DATA_OUT_OF_RANGE: [400, 'A number is out of range'],
};

// Every admin route declares its permission (src/shared/permissions.js): "section:action", or "any" for a signed-in
// user (the route then limits what it returns). Commerce sections also need Commerce settings commerce_enabled (404
// while off). The start-up check at the end of this file refuses to start when an /admin route has no declaration.
const DECLARED = new Map(); // "GET /admin/x" -> perm
const COMMERCE_SECTIONS = new Set(permissions.SECTIONS.filter((x) => x.commerce).map((x) => x.key));
async function commerceOn() {
  try {
    const [[r]] = await db.query("SELECT value FROM commerce_settings WHERE setting_key = 'commerce_enabled'");
    return Boolean(r && r.value === '1');
  } catch {
    return false;
  }
}
async function commerceGate(req, res, next) {
  if (await commerceOn()) return next();
  return res.status(404).json({ success: false, message: 'Commerce is switched off (Settings > Commerce settings)' });
}
/** The guards for one declared route (also used by the few routes that send a file instead of JSON). */
function declare(method, path, perm) {
  const p = permissions.parsePerm(perm);
  const key = `${method.toUpperCase()} /admin${path}`;
  if (DECLARED.has(key)) throw new Error(`route declared twice: ${key}`);
  DECLARED.set(key, perm);
  return p.section && COMMERCE_SECTIONS.has(p.section) ? [commerceGate, auth.requirePerm(perm)] : [auth.requirePerm(perm)];
}
const PRODUCT_ENTITIES = ['products', 'categories', 'kits', 'size-picker'];
const entityPerm = (name, action) => `${PRODUCT_ENTITIES.includes(name) ? 'products' : 'content'}:${action}`;
const canDo = (req, section, action = 'view') => permissions.can(req.admin && req.admin.perms, section, action);

function route(method, path, perm, handler, opts = {}) {
  router[method](`/admin${path}`, ...declare(method, path, perm), ...(opts.before || []), async (req, res, next) => {
    try {
      const data = await handler(req, res);
      if (res.headersSent) return undefined;
      if (opts.content && method !== 'get') contentCache.bust();
      return res.status(opts.status || 200).json({ success: true, data: data === undefined ? null : data });
    } catch (err) {
      return next(err);
    }
  });
}

/** Runs fn(conn) in a transaction. */
async function tx(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

const by = (req) => req.admin.emp_id;
const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const page = (req) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const p = Math.max(Number(req.query.page) || 1, 1);
  return { limit, offset: (p - 1) * limit, page: p };
};

/** "Pavithran V V (DZIND148)" for the "Exported on ... by" line of the Excel downloads. */
async function exportedBy(req) {
  const id = req.admin.emp_id;
  try {
    const [[emp]] = await db.query(`SELECT emp_first_name, emp_last_name FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ?`, [id]);
    const name = emp ? [emp.emp_first_name, emp.emp_last_name].filter(Boolean).join(' ') : '';
    return name ? `${name} (${id})` : id;
  } catch {
    return id;
  }
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------
route('get', '/dashboard', 'any', async (req) => {
  const [[leads]] = await db.query(
    `SELECT SUM(created_at >= ${IST_TODAY_UTC}) AS today, SUM(created_at >= ${IST_TODAY_UTC} - INTERVAL 6 DAY) AS last7,
            SUM(status = 'new') AS open_new, COUNT(*) AS total FROM leads`
  );
  const [byForm] = await db.query(
    `SELECT form_type, COUNT(*) AS n FROM leads WHERE created_at >= ${IST_TODAY_UTC} - INTERVAL 6 DAY GROUP BY form_type ORDER BY n DESC`
  );
  const [mail] = await db.query('SELECT status, COUNT(*) AS n FROM mail_outbox GROUP BY status');
  const [sync] = await db.query('SELECT status, COUNT(*) AS n FROM sync_outbox GROUP BY status');
  const counts = (rows) => Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const [langs] = await db.query('SELECT lang_code, name_en, is_active, is_default FROM languages ORDER BY sort_order');
  const done = await entities.completeness();
  // The privacy / terms bodies are English by rule (CLAUDE.md): not "missing" for the attention panel.
  const [legal] = await db.query(
    `SELECT l.lang_code, COUNT(*) AS n FROM languages l
       CROSS JOIN (SELECT 'legal_privacy_body' AS k UNION ALL SELECT 'legal_terms_body') x
       LEFT JOIN ui_text t ON t.text_key = x.k AND t.lang_code = l.lang_code
      WHERE t.text_key IS NULL GROUP BY l.lang_code`
  );
  const legalMissing = Object.fromEntries(legal.map((r) => [r.lang_code, Number(r.n)]));
  const att = await attention(langs);
  const leadsOk = canDo(req, 'leads');
  const contentOk = canDo(req, 'content');
  const settingsOk = canDo(req, 'settings');
  // figures only for the sections this role can view (the dashboard is open to every signed-in user)
  return {
    can: { leads: leadsOk, content: contentOk, settings: settingsOk },
    leads: leadsOk ? { today: Number(leads.today) || 0, last7: Number(leads.last7) || 0, open_new: Number(leads.open_new) || 0, total: Number(leads.total) } : null,
    byForm: leadsOk ? byForm.map((r) => ({ form_type: r.form_type, n: Number(r.n) })) : [],
    outbox: leadsOk ? { mail: counts(mail), sync: counts(sync) } : { mail: {}, sync: {} },
    languages: contentOk ? langs.map((l) => ({ ...l, missing: done[l.lang_code].total - done[l.lang_code].have, pct: done[l.lang_code].pct, legalMissing: legalMissing[l.lang_code] || 0 })) : [],
    mailLogo: settingsOk ? logoCheck.status() : null, // state 'failing' = red notice: mails use the built-in logo
    fonts: contentOk ? fontManager.status() : [], // status 'full' = red notice: a subset could not be rebuilt, the full font is served
    attention: {
      ...att,
      staleNew: leadsOk ? att.staleNew : 0,
      failed: leadsOk ? att.failed : { leads: 0, mail: 0, sync: 0 },
      emptySettings: settingsOk ? att.emptySettings : [],
      noBrochure: contentOk ? att.noBrochure : [],
    },
  };
});

// "Attention needed" on the dashboard: only what applies; the screen links each line to where it is fixed.
async function attention(langs) {
  const [[a]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM leads WHERE status = 'new' AND created_at < NOW() - INTERVAL 24 HOUR) AS stale_new,
            (SELECT COUNT(*) FROM leads l WHERE ${FAILED_OUTBOX_SQL}) AS failed_leads,
            (SELECT COUNT(*) FROM mail_outbox WHERE status = 'failed' AND lead_id IS NOT NULL) AS failed_mail,
            (SELECT COUNT(*) FROM sync_outbox WHERE status = 'failed') AS failed_sync`
  );
  const [settings] = await db.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('gstin', 'ga4_measurement_id')");
  const empty = settings.filter((r) => !String(r.setting_value || '').trim()).map((r) => r.setting_key);
  const [noBrochure] = await db.query(
    `SELECT l.lang_code, l.name_en, l.is_default FROM languages l
      WHERE l.is_active = 1 AND NOT EXISTS (SELECT 1 FROM brochures b WHERE b.lang_code = l.lang_code AND b.is_active = 1)
      ORDER BY l.sort_order`
  );
  return {
    staleNew: Number(a.stale_new),
    failed: { leads: Number(a.failed_leads), mail: Number(a.failed_mail), sync: Number(a.failed_sync) },
    emptySettings: empty, // gstin, ga4_measurement_id
    noBrochure: noBrochure.map((l) => ({ lang_code: l.lang_code, name_en: l.name_en, is_default: Number(l.is_default) === 1 })),
    // languages whose translations are incomplete come from `languages` above (missing > 0)
    activeLanguages: langs.filter((l) => Number(l.is_active)).length,
  };
}

// Sidebar badge (every page change): New leads.
route('get', '/nav-counts', 'any', async (req) => {
  const [[r]] = await db.query("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'");
  return { newLeads: canDo(req, 'leads') ? Number(r.n) : 0, approvals: await approvals.countDecidable(req.admin) };
});

// ---------------------------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------------------------
const LEAD_STATUS = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];
const LEAD_LIST_COLS = `l.lead_id, l.lead_ref, l.form_type, l.full_name, l.first_name, l.last_name, l.business_name,
  l.business_type, l.town, l.phone, l.email, l.lang_code, l.status, l.assigned_to, l.source_page, l.source_ref, l.created_at`;

// A lead with a failed e-mail (mail_outbox) or a failed Google Sheet row (sync_outbox). Alias l = leads.
const FAILED_OUTBOX_SQL = `(EXISTS (SELECT 1 FROM mail_outbox m WHERE m.lead_id = l.lead_id AND m.status = 'failed')
  OR EXISTS (SELECT 1 FROM sync_outbox s WHERE s.lead_id = l.lead_id AND s.status = 'failed'))`;

function leadFilters(q) {
  const where = [];
  const params = [];
  if (q.age === '24h') where.push('l.created_at < NOW() - INTERVAL 24 HOUR'); // older than a day (dashboard: not handled)
  if (q.outbox === 'failed') where.push(FAILED_OUTBOX_SQL);
  if (q.form) { where.push('l.form_type = ?'); params.push(String(q.form)); }
  if (q.status) { where.push('l.status = ?'); params.push(String(q.status)); }
  if (q.lang) { where.push('l.lang_code = ?'); params.push(String(q.lang)); }
  // from / to are India dates (the admin's date pickers); created_at is UTC
  if (q.from) { where.push("l.created_at >= CONVERT_TZ(?, '+05:30', '+00:00')"); params.push(String(q.from)); }
  if (q.to) { where.push("l.created_at < CONVERT_TZ(? + INTERVAL 1 DAY, '+05:30', '+00:00')"); params.push(String(q.to)); }
  if (q.ref) { where.push('l.lead_ref = ?'); params.push(String(q.ref)); }
  if (q.q) {
    const like = `%${String(q.q).trim().slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push('(l.lead_ref LIKE ? OR l.full_name LIKE ? OR l.first_name LIKE ? OR l.last_name LIKE ? OR l.business_name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.town LIKE ?)');
    params.push(like, like, like, like, like, like, like, like);
  }
  for (const d of ['from', 'to']) if (q[d] && !/^\d{4}-\d{2}-\d{2}$/.test(String(q[d]))) throw new InputError(`${d}: date as YYYY-MM-DD`);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// "98765 43210": how the site writes a phone; text with a space is never taken for a number (no 9.88E+09, and no
// "number stored as text" flag in Excel).
const phoneText = (p) => (/^\d{10}$/.test(String(p || '')) ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

/** The leads matching the list filters (max 10000, newest first), for the CSV and Excel downloads. */
async function leadsForExport(query) {
  const f = leadFilters(query);
  const [rows] = await db.query(
    `SELECT l.lead_ref, l.created_at, l.form_type, l.status, l.full_name, l.first_name, l.last_name, l.business_name,
            l.business_type, l.town, l.phone, l.email, l.monthly_quantity, l.message, l.details_json, l.lang_code,
            l.source_page, l.source_ref, l.assigned_to, l.staff_notes,
            (SELECT GROUP_CONCAT(product_id ORDER BY product_id SEPARATOR ' ') FROM lead_products p WHERE p.lead_id = l.lead_id) AS products
       FROM leads l ${f.sql} ORDER BY l.lead_id DESC LIMIT 10000`,
    f.params
  );
  return rows;
}

// The list filters in words, for the Excel "Filters:" line (null = none).
const LEAD_FILTER_LABELS = { form: 'form', status: 'status', lang: 'language', from: 'from', to: 'to', q: 'search', ref: 'ref', age: 'older than', outbox: 'e-mail / sheet row' };
function leadFilterText(query) {
  const parts = Object.entries(LEAD_FILTER_LABELS)
    .filter(([k]) => typeof query[k] === 'string' && query[k].trim())
    .map(([k, label]) => `${label} = ${String(query[k]).trim().slice(0, 60)}`);
  return parts.length ? parts.join(', ') : null;
}

route('get', '/leads/export.csv', 'leads:edit', async (req, res) => {
  const rows = await leadsForExport(req.query);
  const head = ['lead_ref', 'created_at_ist', 'form_type', 'status', 'full_name', 'first_name', 'last_name', 'business_name',
    'business_type', 'town', 'phone', 'email', 'products', 'monthly_quantity', 'message', 'details', 'lang', 'source_page',
    'source_ref', 'assigned_to', 'staff_notes'];
  const body = csv.stringify([head, ...rows.map((r) => [r.lead_ref, r.created_at && theme.istStamp(r.created_at), r.form_type,
    r.status, r.full_name, r.first_name, r.last_name, r.business_name, r.business_type, r.town, r.phone, r.email, r.products,
    r.monthly_quantity, r.message, r.details_json ? JSON.stringify(r.details_json) : '', r.lang_code, r.source_page,
    r.source_ref, r.assigned_to, r.staff_notes])]);
  await audit(null, { empId: by(req), action: 'export', entity: 'lead', after: { filters: req.query, rows: rows.length } });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dfresh-leads-${theme.istStamp(new Date(), false)}.csv"`, 'Cache-Control': 'no-store' });
  res.send(body);
});

// Same leads and filters as the CSV, as a branded Excel file: phones and GST as text, received as a real date,
// the distributor details in their own columns.
route('get', '/leads/export.xlsx', 'leads:edit', async (req, res) => {
  const rows = await leadsForExport(req.query);
  const detail = (r, k) => {
    const d = r.details_json ? (typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json) : {};
    return d[k] ?? null;
  };
  const wb = theme.newWorkbook('dFresh Leads');
  theme.tableSheet(wb, 'Leads', {
    title: 'dFresh Leads',
    exportedBy: await exportedBy(req),
    filters: leadFilterText(req.query),
    // Lead ref + Name first: kept in view on screen and repeated on every printed page (2 pages wide), so each
    // page says whose row it is.
    freezeCols: 2,
    print: { pagesWide: 2, repeatCols: 2 },
    columns: [
      { header: 'Lead ref', width: 13 }, { header: 'Name', width: 22 }, { header: 'Received', type: 'date' },
      { header: 'Form', width: 12 }, { header: 'Status', width: 11 }, { header: 'Business / firm', width: 24 },
      { header: 'Business type', width: 15 }, { header: 'Town', width: 16 }, { header: 'Phone', width: 13 },
      { header: 'E-mail', width: 28 }, { header: 'Products', width: 30 }, { header: 'No. of products', type: 'number', width: 10 },
      { header: 'Monthly quantity', width: 16 }, { header: 'Message', width: 40, wrap: true }, { header: 'GST no.', width: 18 },
      { header: 'Areas covered', width: 24 }, { header: 'Godown / vehicles', width: 12 }, { header: 'Brands handled', width: 22 },
      { header: 'Monthly tissue sales', width: 14 }, { header: 'Language', width: 10 }, { header: 'Page', width: 18 },
      { header: 'Opened from', width: 16 }, { header: 'Assigned to', width: 13 }, { header: 'Staff notes', width: 36, wrap: true },
    ],
    rows: rows.map((r) => [
      r.lead_ref, r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' '), r.created_at, r.form_type, r.status,
      r.business_name, r.business_type, r.town, phoneText(r.phone), r.email, r.products, r.products ? r.products.split(' ').length : 0,
      r.monthly_quantity, r.message, detail(r, 'gst_no'), detail(r, 'areas'), detail(r, 'godown_vehicles'), detail(r, 'brands'),
      detail(r, 'monthly_sales'), r.lang_code, r.source_page, r.source_ref, r.assigned_to, r.staff_notes,
    ]),
  });
  const bytes = await theme.send(res, wb, `dFresh_Leads_${theme.istStamp(new Date(), false)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'lead', after: { filters: req.query, rows: rows.length, file: 'leads.xlsx', bytes } });
});

// Live admin (polled every 15 s while the tab is visible): leads newer than ?since=<lead_id>. Light: two counts and
// the newest id. No since = just the newest id (the starting point). { lastId, added, newLeads }
route('get', '/leads/changes', 'leads:view', async (req) => {
  const since = /^\d{1,15}$/.test(String(req.query.since || '')) ? Number(req.query.since) : null;
  const [[r]] = await db.query(
    `SELECT COALESCE(MAX(lead_id), 0) AS last_id, SUM(status = 'new') AS new_leads,
            SUM(lead_id > ?) AS added FROM leads`,
    [since === null ? Number.MAX_SAFE_INTEGER : since]
  );
  return { lastId: Number(r.last_id), added: Number(r.added) || 0, newLeads: Number(r.new_leads) || 0 };
});

route('get', '/leads', 'leads:view', async (req) => {
  const f = leadFilters(req.query);
  const pg = page(req);
  const [rows] = await db.query(`SELECT ${LEAD_LIST_COLS} FROM leads l ${f.sql} ORDER BY l.lead_id DESC LIMIT ? OFFSET ?`, [...f.params, pg.limit, pg.offset]);
  const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM leads l ${f.sql}`, f.params);
  return { rows, total: Number(c.n), page: pg.page, limit: pg.limit };
});

async function leadDetail(id) {
  const [[lead]] = await db.query(
    `SELECT ${LEAD_LIST_COLS}, l.monthly_quantity, l.message, l.details_json, l.consent_given, l.consent_text, l.consent_at,
            l.staff_notes, l.user_agent, l.sheet_synced_at, l.updated_at FROM leads l WHERE l.lead_id = ?`, [id]
  );
  if (!lead) return null;
  const [products] = await db.query(
    `SELECT lp.product_id, t.name FROM lead_products lp
       LEFT JOIN product_translations t ON t.product_id = lp.product_id AND t.lang_code = (SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1)
      WHERE lp.lead_id = ? ORDER BY lp.product_id`, [id]
  );
  const [mail] = await db.query(
    'SELECT mail_id AS id, purpose, to_email, status, attempts, last_error, created_at, sent_at, provider_msg_id FROM mail_outbox WHERE lead_id = ? ORDER BY mail_id', [id]
  );
  const [sync] = await db.query(
    'SELECT sync_id AS id, target, status, attempts, last_error, created_at, done_at FROM sync_outbox WHERE lead_id = ? ORDER BY sync_id', [id]
  );
  return { ...lead, products, outbox: { mail, sync } };
}

route('get', '/leads/:id', 'leads:view', async (req) => {
  const lead = await leadDetail(Number(req.params.id));
  if (!lead) throw new InputError('Lead not found', 404);
  return lead;
});

route('patch', '/leads/:id', 'leads:edit', async (req) => {
  const id = Number(req.params.id);
  const before = await leadDetail(id);
  if (!before) throw new InputError('Lead not found', 404);
  const set = {};
  if ('status' in req.body) {
    if (!LEAD_STATUS.includes(req.body.status)) throw new InputError(`status: one of ${LEAD_STATUS.join(', ')}`);
    set.status = req.body.status;
  }
  if ('assigned_to' in req.body) {
    const emp = str(req.body.assigned_to, 20);
    if (emp) {
      const [[u]] = await db.query('SELECT emp_id FROM admin_users WHERE emp_id = ?', [emp]);
      if (!u) throw new InputError('assigned_to: not a dFresh admin user');
    }
    set.assigned_to = emp;
  }
  if ('staff_notes' in req.body) {
    const notes = typeof req.body.staff_notes === 'string' ? req.body.staff_notes.slice(0, 5000) : null;
    set.staff_notes = notes && notes.trim() ? notes : null;
  }
  if (!Object.keys(set).length) throw new InputError('Nothing to change');
  await tx(async (q) => {
    await q.query(`UPDATE leads SET ${Object.keys(set).map((c) => `${c} = ?`).join(', ')} WHERE lead_id = ?`, [...Object.values(set), id]);
    const pick = (o) => Object.fromEntries(Object.keys(set).map((k) => [k, o[k]]));
    await audit(q, { empId: by(req), action: 'update', entity: 'lead', entityId: before.lead_ref, before: pick(before), after: set });
  });
  return leadDetail(id);
});

// Delete a lead (admin only: test leads before launch day, junk). Its products, e-mail rows and sheet-queue row go
// with it (ON DELETE CASCADE). A row the sheet sync already wrote stays in the Google Sheet: delete it there by its
// Lead Ref (the answer says whether there is one). Audited without the visitor's personal data.
route('delete', '/leads/:id', 'leads:delete', async (req) => {
  const id = Number(req.params.id);
  const before = await leadDetail(id);
  if (!before) throw new InputError('Lead not found', 404);
  await tx(async (q) => {
    await q.query('DELETE FROM leads WHERE lead_id = ?', [id]);
    await audit(q, {
      empId: by(req), action: 'delete', entity: 'lead', entityId: before.lead_ref,
      before: { lead_ref: before.lead_ref, form_type: before.form_type, created_at: before.created_at, sheet_synced_at: before.sheet_synced_at },
    });
  });
  return { lead_ref: before.lead_ref, sheetRow: Boolean(before.sheet_synced_at) };
});

route('post', '/outbox/:type/:id/retry', 'leads:edit', async (req) => {
  const box = { mail: ['mail_outbox', 'mail_id'], sync: ['sync_outbox', 'sync_id'] }[req.params.type];
  if (!box) throw new InputError('type: mail or sync', 404);
  const id = Number(req.params.id);
  return tx(async (q) => {
    const [[row]] = await q.query(`SELECT status, attempts, last_error FROM ${box[0]} WHERE ${box[1]} = ?`, [id]);
    if (!row) throw new InputError('Not found', 404);
    if (row.status !== 'failed') throw new InputError(`Only a failed row can be retried (this one is ${row.status})`, 409);
    await q.query(`UPDATE ${box[0]} SET status = 'pending', attempts = 0, next_attempt_at = NOW() WHERE ${box[1]} = ?`, [id]);
    await audit(q, { empId: by(req), action: 'retry', entity: box[0], entityId: id, before: row, after: { status: 'pending', attempts: 0 } });
    return { id, status: 'pending' };
  });
});

route('get', '/assignees', 'leads:view', async () => {
  const [rows] = await db.query(
    `SELECT a.emp_id, (SELECT r.name FROM roles r WHERE r.role_id = a.role_id) AS role, TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name
       FROM admin_users a LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id
      WHERE a.is_active = 1 ORDER BY name`
  );
  return rows;
});

// ---------------------------------------------------------------------------------------------
// Products: Excel and images (registered before the generic /products/:id routes)
// ---------------------------------------------------------------------------------------------
route('get', '/products/export.xlsx', 'products:edit', async (req, res) => {
  const wb = await excel.buildWorkbook(db, { who: await exportedBy(req) });
  const bytes = await theme.send(res, wb, `dFresh_Product_List_${theme.istStamp(new Date(), false)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'product', after: { file: 'products.xlsx', bytes } });
});

route('post', '/products/import', 'products:edit', async (req) => {
  if (!req.file) throw new InputError('Choose the .xlsx file');
  const dryRun = req.query.dryRun !== '0';
  // The dry run hands back the file's fingerprint; Apply must send it and the same file: a changed file needs a new
  // dry run. Apply checks everything again on the live data, inside its transaction.
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  if (dryRun) {
    const { plan, ...report } = await excel.diffWorkbook(db, req.file.buffer);
    return { dryRun: true, fileHash, ...report };
  }
  if (req.query.hash !== fileHash) throw new InputError('This file is not the one that passed the dry run (or it changed since). Run the dry run again.');
  const { report, changes } = await tx(async (q) => {
    const { plan, ...rep } = await excel.diffWorkbook(q, req.file.buffer);
    if (!rep.ok) throw new InputError(`Fix the ${rep.errors.length} error(s) first (run the dry run again): ${rep.errors.slice(0, 3).join(' | ')}`);
    const out = await excel.applyPlan(q, plan, by(req));
    for (const c of out) await audit(q, { empId: by(req), action: 'import', entity: c.entity, entityId: c.id, before: c.before, after: c.after });
    return { report: rep, changes: out };
  });
  contentCache.bust();
  return { dryRun: false, applied: changes.length, fileHash, ...report };
}, { before: [upload(5)] });

route('post', '/products/:id/images', 'products:edit', async (req) => {
  const [id] = entities.parseId(entities.ENTITIES.products, req.params.id);
  const position = Number(req.body.position);
  if (![1, 2, 3].includes(position)) throw new InputError('position: 1, 2 or 3');
  if (!req.file) throw new InputError('Choose a photo');
  const product = await entities.load('products', [id]);
  if (!product) throw new InputError('Product not found', 404);
  const saved = await media.saveProductImage(req.file.buffer, id, position);
  const old = product.images.find((i) => i.position === position);
  try {
    await tx(async (q) => {
      await q.query(
        `INSERT INTO product_images (product_id, position, file_name, width, height) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), width = VALUES(width), height = VALUES(height)`,
        [id, position, saved.file_name, saved.width, saved.height]
      );
      await audit(q, { empId: by(req), action: old ? 'update' : 'create', entity: 'product_image', entityId: `${id}#${position}`, before: old || null, after: { position, file_name: saved.file_name, bytes: saved.bytes } });
    });
  } catch (err) {
    media.removeProductImage(saved.file_name);
    throw err;
  }
  if (old && old.file_name !== saved.file_name) media.removeProductImage(old.file_name);
  return { ...saved, original_bytes: req.file.size };
}, { content: true, before: [upload(8)] });

route('delete', '/products/:id/images/:position', 'products:edit', async (req) => {
  const [id] = entities.parseId(entities.ENTITIES.products, req.params.id);
  const position = Number(req.params.position);
  const [[img]] = await db.query('SELECT position, file_name FROM product_images WHERE product_id = ? AND position = ?', [id, position]);
  if (!img) throw new InputError('No photo at that position', 404);
  await tx(async (q) => {
    await q.query('DELETE FROM product_images WHERE product_id = ? AND position = ?', [id, position]);
    await audit(q, { empId: by(req), action: 'delete', entity: 'product_image', entityId: `${id}#${position}`, before: img });
  });
  media.removeProductImage(img.file_name);
}, { content: true });

route('put', '/products/:id/images/order', 'products:edit', async (req) => {
  const [id] = entities.parseId(entities.ENTITIES.products, req.params.id);
  const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
  return tx(async (q) => {
    const [imgs] = await q.query('SELECT position, file_name FROM product_images WHERE product_id = ? ORDER BY position', [id]);
    const have = imgs.map((i) => i.position).sort().join(',');
    if ([...order].sort().join(',') !== have) throw new InputError(`order must list the current positions (${have})`);
    // Move out of the 1-3 range first: (product_id, position) is unique.
    await q.query('UPDATE product_images SET position = position + 10 WHERE product_id = ?', [id]);
    for (const [i, pos] of order.entries()) {
      await q.query('UPDATE product_images SET position = ? WHERE product_id = ? AND position = ?', [i + 1, id, pos + 10]);
    }
    await audit(q, { empId: by(req), action: 'reorder', entity: 'product_image', entityId: id, before: imgs, after: { order } });
    const [after] = await q.query('SELECT position, file_name FROM product_images WHERE product_id = ? ORDER BY position', [id]);
    return after;
  });
}, { content: true });

// Banner photos (desktop 1920x800, mobile 1080x1350)
route('post', '/banners/:id/image', 'content:edit', async (req) => {
  const [key] = entities.parseId(entities.ENTITIES.banners, req.params.id);
  const kind = req.query.kind;
  if (!['desktop', 'mobile'].includes(kind)) throw new InputError('kind: desktop or mobile');
  if (!req.file) throw new InputError('Choose a photo');
  const [[banner]] = await db.query('SELECT desktop_file, mobile_file FROM banners WHERE banner_key = ?', [key]);
  if (!banner) throw new InputError('Banner not found', 404);
  const saved = await media.saveBanner(req.file.buffer, key, kind);
  const col = `${kind}_file`;
  await tx(async (q) => {
    await q.query(`UPDATE banners SET ${col} = ?, updated_by = ? WHERE banner_key = ?`, [saved.file_name, by(req), key]);
    await audit(q, { empId: by(req), action: 'update', entity: 'banner', entityId: key, before: { [col]: banner[col] }, after: { [col]: saved.file_name } });
  });
  media.removeBanner(banner[col], kind);
  return saved;
}, { content: true, before: [upload(8)] });

// ---------------------------------------------------------------------------------------------
// Generic content sections (products, categories, banners, kits, towns, form-options, size-picker)
// ---------------------------------------------------------------------------------------------
// Button target per Button action (the admin offers the same choices, EntityPage.js): products / products_home have
// none (stored empty), products_category = a category key, section = a home section, form = a lead form.
const BANNER_SECTIONS = ['business', 'where', 'about', 'contact', 'products'];
const BANNER_FORMS = ['sample', 'quote', 'distributor'];
// Banner key: what it is used for (so a rename knows what to move):
//   - banners row + banner_translations (foreign key ON UPDATE CASCADE: follows by itself)
//   - leads.source_ref of leads sent from this banner's form button (BannerSlider passes it as the form's ref)
//   - audit_log.entity_id of this banner's history
//   - new photo file names start with it (<key>-desktop-<hash>.webp); stored names stay valid after a rename
//   - the analytics click event (banner_click { banner: key }): outside this database, earlier clicks keep the old key
const BANNER_KEY = /^[a-z0-9-]{2,30}$/;
async function bannerKeyCheck(q, key, self) {
  const k = String(key || '').trim();
  if (!k) throw new InputError('Key is required');
  if (!BANNER_KEY.test(k)) throw new InputError('Key: 2 to 30 characters, only lowercase letters a-z, digits 0-9 and hyphens (-). No spaces.');
  const [[taken]] = await q.query('SELECT banner_key FROM banners WHERE banner_key = ? AND banner_key <> ?', [k, self || '']);
  if (taken) throw new InputError(`Key '${k}' is already used by another banner. Pick another one.`);
  return k;
}
async function renameBanner(q, from, to, empId) {
  const k = await bannerKeyCheck(q, to, from);
  await q.query('UPDATE banners SET banner_key = ?, updated_by = ? WHERE banner_key = ?', [k, empId, from]); // translations cascade
  // leads from this banner's form; a kit key that happens to be the same word is a kit's lead, left alone
  await q.query('UPDATE leads SET source_ref = ? WHERE source_ref = ? AND NOT EXISTS (SELECT 1 FROM kits WHERE kit_key = ?)', [k, from, from]);
  await q.query("UPDATE audit_log SET entity_id = ? WHERE entity_type = 'banner' AND entity_id = ?", [k, from]);
  await audit(q, { empId, action: 'rename', entity: 'banner', entityId: k, before: { banner_key: from }, after: { banner_key: k } });
  return k;
}

// Town key: what uses it: the towns row + town_translations (ON UPDATE CASCADE) and the audit history. Leads keep the
// town the visitor typed (text), never the key; the site uses the key only inside the page (map pins).
const TOWN_KEY = /^[a-z0-9-]{2,30}$/;
async function townKeyCheck(q, key, self) {
  const k = String(key || '').trim();
  if (!k) throw new InputError('Key is required');
  if (!TOWN_KEY.test(k)) throw new InputError('Key: 2 to 30 characters, only lowercase letters a-z, digits 0-9 and hyphens (-). No spaces.');
  const [[taken]] = await q.query('SELECT town_key FROM towns WHERE town_key = ? AND town_key <> ?', [k, self || '']);
  if (taken) throw new InputError(`Key '${k}' is already used by another town. Pick another one.`);
  return k;
}
async function renameTown(q, from, to, empId) {
  const k = await townKeyCheck(q, to, from);
  await q.query('UPDATE towns SET town_key = ? WHERE town_key = ?', [k, from]); // translations cascade
  await q.query("UPDATE audit_log SET entity_id = ? WHERE entity_type = 'town' AND entity_id = ?", [k, from]);
  await audit(q, { empId, action: 'rename', entity: 'town', entityId: k, before: { town_key: from }, after: { town_key: k } });
  return k;
}
// Latitude / longitude: inside India (the admin checks the same, EntityPage.js GEO); empty is allowed.
function townGeoCheck(body) {
  for (const [k, min, max, label] of [['lat', 6, 37, 'Latitude'], ['lng', 68, 98, 'Longitude']]) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === undefined || String(v).trim() === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} must be a number from ${min} to ${max} (India).`);
  }
}

// Godown base: one town only; saving one as the base unticks the others.
async function oneBaseTown(q, row) {
  if (Number(row.is_base) === 1) await q.query('UPDATE towns SET is_base = 0 WHERE town_key <> ? AND is_base = 1', [row.town_key]);
}

// Form options: where each stored value is used. Leads keep the stored value (business_type column; monthly_sales and
// godown_vehicles (yes_no) inside details_json); kits keep a business_type. A value used by a lead never changes (old
// leads must stay readable); an unused one can be renamed (kits follow, in the same transaction).
const OPTION_VALUE = /^[a-z0-9_]{1,40}$/;
const LIST_KEY = /^[a-z0-9_]{2,40}$/;
async function optionUse(q, list, value) {
  let leads = 0;
  if (list === 'business_type') [[{ n: leads }]] = await q.query('SELECT COUNT(*) AS n FROM leads WHERE business_type = ?', [value]);
  else if (list === 'monthly_sales') [[{ n: leads }]] = await q.query("SELECT COUNT(*) AS n FROM leads WHERE JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.monthly_sales')) = ?", [value]);
  else if (list === 'yes_no') [[{ n: leads }]] = await q.query("SELECT COUNT(*) AS n FROM leads WHERE JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.godown_vehicles')) = ?", [value]);
  const [[{ n: kits }]] = list === 'business_type' ? await q.query('SELECT COUNT(*) AS n FROM kits WHERE business_type = ?', [value]) : [[{ n: 0 }]];
  return { leads: Number(leads), kits: Number(kits) };
}
async function optionGuard(q, body, current) {
  if (!current) {
    const list = String(body.list_key || '').trim();
    if (!LIST_KEY.test(list)) throw new InputError('List: 2 to 40 characters, only lowercase letters a-z, digits 0-9 and _ (e.g. business_type).');
    body.list_key = list;
    const v = String(body.option_value || '').trim();
    if (!OPTION_VALUE.test(v)) throw new InputError('Stored value: only lowercase letters a-z, digits 0-9 and _ (e.g. under_50k), up to 40.');
    const [[taken]] = await q.query('SELECT option_value FROM form_options WHERE list_key = ? AND option_value = ?', [list, v]);
    if (taken) throw new InputError(`'${v}' is already in the list ${list}.`);
    body.option_value = v;
  }
}
async function renameOption(q, current, to, empId) {
  const v = String(to || '').trim();
  if (!OPTION_VALUE.test(v)) throw new InputError('Stored value: only lowercase letters a-z, digits 0-9 and _ (e.g. under_50k), up to 40.');
  const use = await optionUse(q, current.list_key, current.option_value);
  if (use.leads) throw new InputError(`'${current.option_value}' is used in ${use.leads} lead(s), so it cannot change (old leads must stay readable). Add a new option and switch this one off instead.`);
  const [[taken]] = await q.query('SELECT option_value FROM form_options WHERE list_key = ? AND option_value = ?', [current.list_key, v]);
  if (taken) throw new InputError(`'${v}' is already in the list ${current.list_key}.`);
  await q.query('UPDATE form_options SET option_value = ? WHERE list_key = ? AND option_value = ?', [v, current.list_key, current.option_value]); // translations cascade
  if (current.list_key === 'business_type') await q.query('UPDATE kits SET business_type = ? WHERE business_type = ?', [v, current.option_value]);
  const oldId = `${current.list_key}~${current.option_value}`;
  const newId = `${current.list_key}~${v}`;
  await q.query("UPDATE audit_log SET entity_id = ? WHERE entity_type = 'form_option' AND entity_id = ?", [newId, oldId]);
  await audit(q, { empId, action: 'rename', entity: 'form_option', entityId: newId, before: { option_value: current.option_value }, after: { option_value: v } });
  return [current.list_key, v];
}
// Drag and drop inside one list: `values` must be exactly that list's stored values; they become 1..n.
async function reorderOptions(q, list, values) {
  const [rows] = await q.query('SELECT option_value FROM form_options WHERE list_key = ?', [list]);
  const have = new Set(rows.map((r) => r.option_value));
  if (!Array.isArray(values) || values.length !== have.size || new Set(values).size !== values.length || values.some((x) => !have.has(x))) {
    throw new InputError('The order must list every option of the list exactly once (reload the page and drag again)');
  }
  for (const [i, v] of values.entries()) await q.query('UPDATE form_options SET sort_order = ? WHERE list_key = ? AND option_value = ?', [i + 1, list, v]);
}

async function bannerGuard(q, body, current) {
  if (!current) body.banner_key = await bannerKeyCheck(q, body.banner_key, null);
  const desktop = current ? current.desktop_file : '';
  const mobile = current ? current.mobile_file : '';
  const active = 'is_active' in body ? Number(entities.coerce('is_active', { type: 'bool' }, body.is_active)) : (current ? current.is_active : 0);
  if (active && (!desktop || !mobile)) throw new InputError('Upload the desktop and the mobile photo before switching the banner on');
  if (!('cta_action' in body) && !('cta_target' in body)) return;
  const action = 'cta_action' in body ? body.cta_action : current && current.cta_action;
  const target = 'cta_target' in body ? body.cta_target : current && current.cta_target;
  const t = target === null || target === undefined ? '' : String(target).trim();
  if (action === 'products' || action === 'products_home') { body.cta_target = null; return; }
  if (action === 'products_category') {
    const [[cat]] = await q.query('SELECT category_key FROM categories WHERE category_key = ?', [t]);
    if (!cat) throw new InputError('Button target: pick one of the categories');
  } else if (action === 'section') {
    if (!BANNER_SECTIONS.includes(t)) throw new InputError(`Button target: one of ${BANNER_SECTIONS.join(', ')}`);
  } else if (action === 'form') {
    if (!BANNER_FORMS.includes(t)) throw new InputError(`Button target: one of ${BANNER_FORMS.join(', ')}`);
  } else {
    throw new InputError('Button action: one of products, products_home, products_category, section, form');
  }
  body.cta_target = t;
}

// A category's own Google / share texts (Translations group "Google and sharing", src/shared/pageMeta.js): created
// with the category in the default language (title "<name> | dFresh", description = the home description), removed
// with it (its ui_text rows go by ON DELETE CASCADE).
const seoKeys = (categoryKey) => [`seo_cat_${categoryKey}_t`, `seo_cat_${categoryKey}_d`];
async function categorySeoTexts(q, cat, empId) {
  const { def } = await entities.languages(q);
  const [t, d] = seoKeys(cat.category_key);
  const about = `Products page for the category "${cat.category_key}"`;
  await q.query(
    `INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html, max_chars) VALUES
       (?, 'Google and sharing', ?, 0, 60), (?, 'Google and sharing', ?, 0, 160)`,
    [t, `${about}: title in Google results, the browser tab and share previews. Changes no text on the page.`,
      d, `${about}: description in Google results and share previews. Changes no text on the page.`]
  );
  const name = cat.tr && cat.tr[def] ? cat.tr[def].name : cat.category_key;
  const [[home]] = await q.query("SELECT value FROM ui_text WHERE text_key = 'seo_home_d' AND lang_code = ?", [def]);
  await q.query('INSERT IGNORE INTO ui_text (text_key, lang_code, value, updated_by) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    [t, def, `${name} | dFresh`, empId, d, def, home ? home.value : name, empId]);
}

const AUDIT_LABEL = {
  products: 'product', categories: 'category', banners: 'banner', kits: 'kit', towns: 'town',
  'form-options': 'form_option', 'size-picker': 'size_picker',
};

// Size picker: "Selected first" belongs to one size only; ticking it on one row unticks the others.
async function oneSelectedFirst(q, row) {
  if (Number(row.is_default) === 1) await q.query('UPDATE size_picker SET is_default = 0 WHERE size_id <> ? AND is_default = 1', [row.size_id]);
}

// Featured on Home: the featured products in their new order (drag and drop), 1..n.
route('post', '/products/featured-order', 'products:edit', async (req) => tx(async (q) => {
  const [before] = await q.query('SELECT product_id, featured_order FROM products WHERE is_featured = 1 ORDER BY featured_order');
  await positions.reorderFeatured(q, req.body.order);
  await audit(q, { empId: by(req), action: 'reorder', entity: 'featured', before, after: { order: req.body.order } });
}), { content: true });

for (const name of Object.keys(entities.ENTITIES)) {
  const e = entities.ENTITIES[name];
  const label = AUDIT_LABEL[name];

  // banners also get photo_check: each photo's real size (missing / wrong size shows a warning in the admin)
  route('get', `/${name}`, entityPerm(name, 'view'), async () => {
    const rows = await entities.load(name);
    if (name === 'banners') for (const r of rows) r.photo_check = await media.bannerPhotoCheck(r);
    if (name === 'form-options') for (const r of rows) r.used = await optionUse(db, r.list_key, r.option_value);
    return rows;
  });

  route('get', `/${name}/:id`, entityPerm(name, 'view'), async (req) => {
    const row = await entities.load(name, entities.parseId(e, req.params.id));
    if (!row) throw new InputError('Not found', 404);
    if (name === 'banners') row.photo_check = await media.bannerPhotoCheck(row);
    if (name === 'form-options') row.used = await optionUse(db, row.list_key, row.option_value);
    return row;
  });

  // Drag and drop. Products: one category's main products or one main product's colour versions at a time
  // ({ category } or { parent }); categories, kits, banners: the whole list (positions.js: exactly every row, 1..n).
  route('post', `/${name}/reorder`, entityPerm(name, 'edit'), async (req) => tx(async (q) => {
    const before = (await entities.load(name, null, q)).map((r) => ({ id: entities.idOf(e, r), sort_order: r.sort_order }));
    if (name === 'form-options') {
      if (!req.body.list) throw new InputError('Say which list is reordered');
      await reorderOptions(q, String(req.body.list), (req.body.order || []).map((x) => String(x).split('~').pop()));
    } else if (positions.has(name)) {
      const of = name === 'products' ? { category_key: req.body.category || null, variant_of: req.body.parent || null } : {};
      if (name === 'products' && !of.category_key && !of.variant_of) throw new InputError('Say which category (or main product) is reordered');
      await positions.reorder(q, name, req.body.order, of);
    } else {
      await entities.reorder(q, name, req.body.order);
    }
    await audit(q, { empId: by(req), action: 'reorder', entity: label, before, after: { order: req.body.order, ...(name === 'products' ? { category: req.body.category, parent: req.body.parent } : {}) } });
  }), { content: true });

  route('post', `/${name}`, entityPerm(name, 'create'), async (req) => tx(async (q) => {
    if (name === 'banners') await bannerGuard(q, req.body, null);
    if (name === 'towns') { req.body.town_key = await townKeyCheck(q, req.body.town_key, null); townGeoCheck(req.body); }
    if (name === 'form-options') {
      await optionGuard(q, req.body, null);
      // the end of its list (the number the form showed is only a preview)
      const [[n]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM form_options WHERE list_key = ? FOR UPDATE', [req.body.list_key]);
      req.body.sort_order = Number(n.next);
    }
    await positions.prepare(q, name, req.body, null); // a new row without a position goes to the end of its list
    const keyValues = await entities.create(q, name, req.body || {}, by(req));
    const after = await entities.load(name, keyValues, q);
    if (name === 'size-picker') await oneSelectedFirst(q, after);
    if (name === 'towns') await oneBaseTown(q, after);
    if (name === 'categories') await categorySeoTexts(q, after, by(req));
    await audit(q, { empId: by(req), action: 'create', entity: label, entityId: entities.idOf(e, after), after });
    return after;
  }), { content: true, status: 201 });

  route('put', `/${name}/:id`, entityPerm(name, 'edit'), async (req) => tx(async (q) => {
    let keyValues = entities.parseId(e, req.params.id);
    const before = await entities.load(name, keyValues, q);
    if (!before) throw new InputError('Not found', 404);
    // a banner's key can be renamed: every reference moves with it, in this same transaction
    if (name === 'banners' && req.body && req.body.banner_key !== undefined && String(req.body.banner_key).trim() !== before.banner_key) {
      keyValues = [await renameBanner(q, before.banner_key, req.body.banner_key, by(req))];
    }
    if (name === 'towns') townGeoCheck(req.body || {});
    if (name === 'towns' && req.body && req.body.town_key !== undefined && String(req.body.town_key).trim() !== before.town_key) {
      keyValues = [await renameTown(q, before.town_key, req.body.town_key, by(req))];
    }
    if (name === 'form-options' && req.body && req.body.option_value !== undefined && String(req.body.option_value).trim() !== before.option_value) {
      keyValues = await renameOption(q, before, req.body.option_value, by(req));
    }
    if (name === 'banners') await bannerGuard(q, req.body || {}, before);
    const tidy = await positions.prepare(q, name, req.body || {}, before);
    await entities.update(q, name, keyValues, req.body || {}, by(req));
    await positions.tidyUp(q, name, tidy);
    const after = await entities.load(name, keyValues, q);
    if (name === 'size-picker') await oneSelectedFirst(q, after);
    if (name === 'towns') await oneBaseTown(q, after);
    if (name === 'form-options') after.used = await optionUse(q, after.list_key, after.option_value);
    await audit(q, { empId: by(req), action: 'update', entity: label, entityId: entities.idOf(e, after), before, after });
    return after;
  }), { content: true });

  route('delete', `/${name}/:id`, entityPerm(name, 'delete'), async (req) => {
    const keyValues = entities.parseId(e, req.params.id);
    const before = await tx(async (q) => {
      const row = await entities.load(name, keyValues, q);
      if (!row) throw new InputError('Not found', 404);
      await entities.remove(q, name, keyValues);
      await positions.afterDelete(q, name, row);
      if (name === 'categories') await q.query('DELETE FROM ui_text_keys WHERE text_key IN (?, ?)', seoKeys(row.category_key));
      await audit(q, { empId: by(req), action: 'delete', entity: label, entityId: req.params.id, before: row });
      return row;
    });
    if (name === 'products') before.images.forEach((i) => media.removeProductImage(i.file_name));
    if (name === 'banners') { media.removeBanner(before.desktop_file, 'desktop'); media.removeBanner(before.mobile_file, 'mobile'); }
  }, { content: true });
}

// ---------------------------------------------------------------------------------------------
// UI text (Translations grid)
// ---------------------------------------------------------------------------------------------
async function uiTextGrid() {
  const [keys] = await db.query(
    'SELECT text_key, group_name, description, allows_html, max_chars FROM ui_text_keys WHERE text_key NOT IN (?) ORDER BY group_name, text_key', [RETIRED_KEYS]
  );
  const [vals] = await db.query('SELECT text_key, lang_code, value FROM ui_text');
  const map = new Map(keys.map((k) => [k.text_key, {
    ...k, allows_html: Number(k.allows_html), max_chars: k.max_chars === null ? null : Number(k.max_chars),
    default_only: k.group_name === STAFF_GROUP, values: {},
  }]));
  for (const v of vals) if (map.has(v.text_key)) map.get(v.text_key).values[v.lang_code] = v.value;
  return [...map.values()];
}

route('get', '/ui-text', 'content:view', async () => {
  const langs = await entities.languages();
  return { languages: langs.codes, default: langs.def, keys: await uiTextGrid() };
});

route('get', '/ui-text/export.csv', 'content:edit', async (req, res) => {
  const langs = await entities.languages();
  const rows = await uiTextGrid();
  const body = csv.stringify([['key', 'group', 'description', ...langs.codes],
    ...rows.map((r) => [r.text_key, r.group_name, r.description, ...langs.codes.map((l) => r.values[l] ?? '')])]);
  await audit(null, { empId: by(req), action: 'export', entity: 'ui_text', after: { rows: rows.length, languages: langs.codes } });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dFresh_Translations.csv"', 'Cache-Control': 'no-store' });
  res.send(body);
});

// The same grid as a branded Excel file, for reading and review (the import stays CSV).
route('get', '/ui-text/export.xlsx', 'content:edit', async (req, res) => {
  const langs = await entities.languages();
  const [langRows] = await db.query('SELECT lang_code, name_en FROM languages');
  const nameOf = Object.fromEntries(langRows.map((l) => [l.lang_code, l.name_en]));
  const rows = await uiTextGrid();
  const wb = theme.newWorkbook('dFresh Translations');
  theme.tableSheet(wb, 'Translations', {
    title: 'dFresh Translations',
    exportedBy: await exportedBy(req),
    filters: null,
    freezeCols: 1,
    columns: [
      { header: 'Key', width: 22 }, { header: 'Group', width: 16 }, { header: 'Description', width: 34, wrap: true },
      ...langs.codes.map((l) => ({ header: `${nameOf[l] || l} (${l})`, width: 44, wrap: true })),
    ],
    rows: rows.map((r) => [r.text_key, r.group_name, r.description, ...langs.codes.map((l) => r.values[l] ?? null)]),
  });
  const bytes = await theme.send(res, wb, `dFresh_Translations_${theme.istStamp(new Date(), false)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'ui_text', after: { rows: rows.length, languages: langs.codes, file: 'translations.xlsx', bytes } });
});

/** Writes one ui_text cell; empty = delete (falls back to the default language), never for the default. */
async function setUiText(q, key, lang, value, empId, langs) {
  const v = typeof value === 'string' ? value.replace(/\r\n/g, '\n') : '';
  if (v.length > 20000) throw new InputError(`${key} (${lang}): too long`);
  const [[before]] = await q.query('SELECT value FROM ui_text WHERE text_key = ? AND lang_code = ?', [key, lang]);
  const old = before ? before.value : null;
  if (!v.trim()) {
    if (lang === langs.def) throw new InputError(`${key}: the ${lang} text cannot be empty`);
    if (old === null) return false;
    await q.query('DELETE FROM ui_text WHERE text_key = ? AND lang_code = ?', [key, lang]);
  } else {
    if (old === v) return false;
    await q.query(
      'INSERT INTO ui_text (text_key, lang_code, value, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)',
      [key, lang, v, empId]
    );
  }
  await audit(q, { empId, action: 'update', entity: 'ui_text', entityId: `${key}/${lang}`, before: { value: old }, after: { value: v.trim() ? v : null } });
  return true;
}

route('put', '/ui-text/:key/:lang', 'content:edit', async (req) => {
  const langs = await entities.languages();
  if (!langs.codes.includes(req.params.lang)) throw new InputError('Unknown language', 404);
  const [[k]] = await db.query('SELECT text_key FROM ui_text_keys WHERE text_key = ?', [req.params.key]);
  if (!k) throw new InputError('Unknown key', 404);
  const changed = await tx((q) => setUiText(q, req.params.key, req.params.lang, req.body.value, by(req), langs));
  return { changed };
}, { content: true });

route('post', '/ui-text/import', 'content:edit', async (req) => {
  if (!req.file) throw new InputError('Choose the CSV file');
  const dryRun = req.query.dryRun !== '0';
  let rows;
  try {
    rows = csv.parse(req.file.buffer.toString('utf8'));
  } catch (err) {
    throw new InputError(err.message);
  }
  const [head, ...data] = rows;
  if (!head || head[0] !== 'key') throw new InputError('First column must be "key" (use the exported sheet)');
  const langs = await entities.languages();
  const known = new Set((await uiTextGrid()).map((r) => r.text_key));
  const langCols = head.map((h, i) => [h, i]).filter(([h]) => langs.codes.includes(h));
  const unknownColumns = head.filter((h) => !['key', 'group', 'description'].includes(h) && !langs.codes.includes(h));
  const grid = new Map((await uiTextGrid()).map((r) => [r.text_key, r.values]));
  const changes = [];
  const errors = [];
  for (const [n, r] of data.entries()) {
    const key = (r[0] || '').trim();
    if (RETIRED_KEYS.includes(key)) continue; // a text the site no longer shows (text-groups.js): an older CSV may still have it
    if (!known.has(key)) { errors.push(`row ${n + 2}: unknown key "${key}"`); continue; }
    for (const [lang, i] of langCols) {
      const v = (r[i] ?? '').replace(/\r\n/g, '\n');
      const old = grid.get(key)[lang] ?? null;
      const now = v.trim() ? v : null;
      if (old === now) continue;
      if (!now && lang === langs.def) { errors.push(`row ${n + 2}: ${key} ${lang} cannot be empty`); continue; }
      changes.push({ key, lang, before: old, after: now });
    }
  }
  const report = { dryRun, changes: changes.length, list: changes.slice(0, 500), unknownColumns, errors };
  if (dryRun) return report;
  if (errors.length) throw new InputError(`Fix the ${errors.length} error(s) first`);
  await tx(async (q) => { for (const c of changes) await setUiText(q, c.key, c.lang, c.after || '', by(req), langs); });
  return report;
}, { content: true, before: [upload(2)] });

// ---------------------------------------------------------------------------------------------
// Languages (admin writes)
// ---------------------------------------------------------------------------------------------
const LANG_COLS = {
  name_en: { type: 'text', max: 50 }, native_name: { type: 'text', max: 50 }, switch_label: { type: 'text', max: 20 },
  html_lang: { type: 'text', max: 20 }, dir: { type: 'enum', values: ['ltr', 'rtl'] },
  font_family: { type: 'text', max: 120, nullable: true }, is_active: { type: 'bool' }, sort_order: { type: 'int' },
};

function langValues(body, creating) {
  // script (fonts/scripts.json, the admin's Script list) sets font_family and dir together
  if (typeof body.script === 'string' && body.script) {
    const s = fontManager.CATALOG.find((x) => x.script === body.script);
    if (!s) throw new InputError(`script: one of ${fontManager.CATALOG.map((x) => x.script).join(', ')}`);
    body = { ...body, font_family: s.family, dir: s.dir }; // eslint-disable-line no-param-reassign
  }
  const out = {};
  for (const [c, def] of Object.entries(LANG_COLS)) {
    if (!(c in body)) {
      if (creating && c === 'is_active') out[c] = 0;
      else if (creating && c === 'sort_order') out[c] = 99;
      else if (creating && c === 'dir') out[c] = 'ltr';
      else if (creating && !def.nullable) throw new InputError(`${c} is required`);
      continue;
    }
    out[c] = entities.coerce(c, def, body[c]);
  }
  if (out.html_lang && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(out.html_lang)) throw new InputError('html_lang like te-IN');
  // the server only has fonts for the scripts in its catalog
  if (out.font_family && !fontManager.CATALOG.some((x) => x.family === out.font_family)) {
    throw new InputError(`font_family: one of ${fontManager.CATALOG.map((x) => x.family).join(', ')} (pick the Script)`);
  }
  return out;
}

const LANG_SELECT = 'SELECT lang_code, name_en, native_name, switch_label, html_lang, dir, font_family, is_default, is_active, sort_order FROM languages';

route('get', '/fonts', 'content:view', async () => ({ scripts: fontManager.CATALOG, fonts: fontManager.status() }));

route('get', '/languages', 'any', async () => {
  const [rows] = await db.query(`${LANG_SELECT} ORDER BY sort_order, lang_code`);
  const done = await entities.completeness();
  const [bros] = await db.query('SELECT lang_code FROM brochures');
  const script = (family) => (fontManager.CATALOG.find((x) => x.family === family) || {}).script || null;
  return rows.map((r) => ({
    ...r,
    script: script(r.font_family),
    font: fontManager.familyStatus(r.font_family), // null while the language is off (its font is only built when used)
    completeness: done[r.lang_code],
    brochure: bros.some((b) => b.lang_code === r.lang_code),
  }));
});

route('post', '/languages', 'content:create', async (req) => tx(async (q) => {
  const code = String(req.body.lang_code || '').trim();
  if (!/^[a-z]{2,3}$/.test(code)) throw new InputError('lang_code: 2-3 lower-case letters (the URL prefix, e.g. te)');
  const vals = { lang_code: code, ...langValues(req.body, true), is_default: 0 };
  // a new language goes to the end of the list (any number from the form is ignored); FOR UPDATE: no shared number
  const [[n]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM languages FOR UPDATE');
  vals.sort_order = Number(n.next);
  const cols = Object.keys(vals);
  await q.query(`INSERT INTO languages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(vals));
  const [[after]] = await q.query(`${LANG_SELECT} WHERE lang_code = ?`, [code]);
  await audit(q, { empId: by(req), action: 'create', entity: 'language', entityId: code, after });
  return after;
}), { content: true, status: 201 });

route('put', '/languages/:code', 'content:edit', async (req) => tx(async (q) => {
  const [[before]] = await q.query(`${LANG_SELECT} WHERE lang_code = ?`, [req.params.code]);
  if (!before) throw new InputError('Language not found', 404);
  const vals = langValues(req.body, false);
  if (Number(before.is_default) === 1 && 'is_active' in vals && !vals.is_active) throw new InputError('The default language cannot be switched off');
  if (!Object.keys(vals).length) throw new InputError('Nothing to change');
  await q.query(`UPDATE languages SET ${Object.keys(vals).map((c) => `${c} = ?`).join(', ')} WHERE lang_code = ?`, [...Object.values(vals), before.lang_code]);
  const [[after]] = await q.query(`${LANG_SELECT} WHERE lang_code = ?`, [before.lang_code]);
  await audit(q, { empId: by(req), action: 'update', entity: 'language', entityId: before.lang_code, before, after });
  return after;
}), { content: true });

route('delete', '/languages/:code', 'content:delete', async (req) => tx(async (q) => {
  const [[before]] = await q.query(`${LANG_SELECT} WHERE lang_code = ?`, [req.params.code]);
  if (!before) throw new InputError('Language not found', 404);
  if (Number(before.is_default) === 1) throw new InputError('The default language cannot be deleted');
  if (Number(before.is_active) === 1) throw new InputError('Switch the language off before deleting it');
  const [[bro]] = await q.query('SELECT file_name FROM brochures WHERE lang_code = ?', [before.lang_code]);
  if (bro) throw new InputError('Delete this language\'s brochure first', 409);
  const counts = {};
  for (const t of ['ui_text', ...entities.TRANSLATED.map((x) => x.tr.table)]) {
    const [[c]] = await q.query(`SELECT COUNT(*) AS n FROM ${t} WHERE lang_code = ?`, [before.lang_code]);
    counts[t] = Number(c.n);
  }
  await q.query('DELETE FROM languages WHERE lang_code = ?', [before.lang_code]); // translations cascade
  await audit(q, { empId: by(req), action: 'delete', entity: 'language', entityId: before.lang_code, before: { ...before, translation_rows_deleted: counts } });
  return { deleted: before.lang_code, translation_rows_deleted: counts };
}), { content: true });

// ---------------------------------------------------------------------------------------------
// Brochures (PDF per language, private/brochures/<lang>/)
// ---------------------------------------------------------------------------------------------
route('get', '/brochures', 'content:view', async () => {
  const [rows] = await db.query('SELECT lang_code, file_name, file_size_kb, is_active, uploaded_by, uploaded_at FROM brochures ORDER BY lang_code');
  return rows.map((r) => ({ ...r, on_disk: Boolean(media.brochurePath(r.lang_code, r.file_name) && fs.existsSync(media.brochurePath(r.lang_code, r.file_name))) }));
});

route('get', '/brochures/:lang/file', 'content:view', async (req, res) => {
  const [[row]] = await db.query('SELECT lang_code, file_name FROM brochures WHERE lang_code = ?', [req.params.lang]);
  const file = row && media.brochurePath(row.lang_code, row.file_name);
  if (!file || !fs.existsSync(file)) throw new InputError('No brochure file for this language', 404);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${row.file_name}"`, 'Cache-Control': 'no-store' });
  res.send(fs.readFileSync(file));
});

route('post', '/brochures/:lang', 'content:create', async (req) => {
  const langs = await entities.languages();
  const lang = req.params.lang;
  if (!langs.codes.includes(lang)) throw new InputError('Unknown language', 404);
  if (!req.file) throw new InputError('Choose the PDF');
  const saved = media.saveBrochure(req.file.buffer, lang);
  const [[old]] = await db.query('SELECT file_name, file_size_kb FROM brochures WHERE lang_code = ?', [lang]);
  try {
    await tx(async (q) => {
      await q.query(
        `INSERT INTO brochures (lang_code, file_name, file_size_kb, is_active, uploaded_by) VALUES (?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_size_kb = VALUES(file_size_kb), is_active = 1,
                                 uploaded_by = VALUES(uploaded_by), uploaded_at = NOW()`,
        [lang, saved.file_name, saved.size_kb, by(req)]
      );
      await audit(q, { empId: by(req), action: old ? 'update' : 'create', entity: 'brochure', entityId: lang, before: old || null, after: saved });
    });
  } catch (err) {
    media.removeBrochure(lang, saved.file_name);
    throw err;
  }
  if (old && old.file_name !== saved.file_name) media.removeBrochure(lang, old.file_name);
  return saved;
}, { before: [upload(5)] });

route('delete', '/brochures/:lang', 'content:delete', async (req) => {
  const [[old]] = await db.query('SELECT lang_code, file_name, file_size_kb FROM brochures WHERE lang_code = ?', [req.params.lang]);
  if (!old) throw new InputError('No brochure for this language', 404);
  await tx(async (q) => {
    await q.query('DELETE FROM brochures WHERE lang_code = ?', [old.lang_code]);
    await audit(q, { empId: by(req), action: 'delete', entity: 'brochure', entityId: old.lang_code, before: old });
  });
  media.removeBrochure(old.lang_code, old.file_name);
});

// ---------------------------------------------------------------------------------------------
// Settings, admin users, audit log (admin only)
// ---------------------------------------------------------------------------------------------
route('get', '/settings', 'settings:view', async () => {
  const [rows] = await db.query('SELECT setting_key, setting_value, is_public, description, updated_by, updated_at FROM site_settings ORDER BY setting_key');
  return rows;
});

// Settings holding a picture (uploaded below; typed values are refused) and settings naming a product.
const IMAGE_SETTINGS = { share_image: media.saveShareImage, about_image: media.saveAboutImage };
const PRODUCT_SETTINGS = ['door_home_product', 'door_biz_product'];
// The sender of every mail (lead alerts, sign-in codes): admin only, whatever role the settings route ever gets, and
// mail_from must be a sender SendGrid accepts (sendgrid-sender-check.js), or every mail would be refused.
const SENDER_SETTINGS = ['mail_from', 'mail_from_name'];
const SENDER_WARNING = 'This address is not verified in SendGrid. All e-mails (lead alerts, login codes) would stop. Verify it in SendGrid first.';

route('put', '/settings/:key', 'settings:edit', async (req) => {
  const raw = typeof req.body.value === 'string' ? req.body.value.trim() : '';
  if (raw.length > 20000) throw new InputError('Too long');
  if (SENDER_SETTINGS.includes(req.params.key) && !canDo(req, 'settings', 'edit')) {
    throw new InputError('Only an admin can change the mail sender', 403);
  }
  if (req.params.key === 'two_step_login') throw new InputError('Use the switch: turning two-step sign-in on or off has its own steps');
  // phones, e-mails, GA4 ID, sheet ID: the same rules as the admin page (src/shared/settingRules.js), tidied
  if (settingRules.DERIVED[req.params.key]) throw new InputError(`${req.params.key} follows ${settingRules.DERIVED[req.params.key]}: change that one instead`);
  const checked = settingRules.checkSetting(req.params.key, raw);
  if (checked.error) throw new InputError(checked.error);
  const value = checked.value;
  if (IMAGE_SETTINGS[req.params.key] && value) throw new InputError('Use Upload to change this picture (or Remove to clear it)');
  if (PRODUCT_SETTINGS.includes(req.params.key)) {
    const [[p]] = await db.query('SELECT product_id FROM products WHERE product_id = ? AND variant_of IS NULL', [value]);
    if (!p) throw new InputError('Pick a product from the list');
  }
  // The hosted mail logo is fetched and checked BEFORE anything is saved (outside the transaction: up to 5 s).
  let logo = null;
  if (req.params.key === 'mail_logo_url' && value) {
    logo = await logoCheck.check(value);
    if (!logo.ok) throw new InputError(`Logo URL not saved: ${logo.reason}.`);
  }
  // mail_from: asked to SendGrid BEFORE anything is saved (read only, up to 6 s). Not verified = refused. Check could
  // not run (no network, key without the scope) = refused with code 'sender_unchecked' until the admin confirms the
  // same warning in the page (confirmUnverified). The outcome goes into the audit entry.
  let sendgrid;
  if (req.params.key === 'mail_from' && value) {
    const sg = await senderCheck.check(value);
    if (sg.state === 'not_verified') throw new InputError(SENDER_WARNING);
    if (sg.state === 'verified') sendgrid = sg.how;
    else if (req.body.confirmUnverified === true) sendgrid = `not checked (${sg.reason}); saved after the warning was confirmed`;
    else {
      const err = new InputError(`SendGrid could not be checked: ${sg.reason}. ${SENDER_WARNING}`, 409);
      err.code = 'sender_unchecked';
      throw err;
    }
  }
  const saved = await tx(async (q) => {
    const [[before]] = await q.query('SELECT setting_key, setting_value FROM site_settings WHERE setting_key = ?', [req.params.key]);
    if (!before) throw new InputError('Unknown setting', 404);
    await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [value, by(req), before.setting_key]);
    await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: before.setting_key, before: { value: before.setting_value }, after: sendgrid ? { value, sendgrid } : { value } });
    // settings computed from this one (the wa.me number from the WhatsApp display number), in the same transaction
    for (const [derived, source] of Object.entries(settingRules.DERIVED)) {
      if (source !== before.setting_key) continue;
      const next = derived === 'whatsapp_number' ? settingRules.whatsappNumber(value) : value;
      const [[old]] = await q.query('SELECT setting_value FROM site_settings WHERE setting_key = ?', [derived]);
      if (old && old.setting_value !== next) {
        await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [next, by(req), derived]);
        await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: derived, before: { value: old.setting_value }, after: { value: next } });
      }
    }
    return { setting_key: before.setting_key, setting_value: value, before: before.setting_value };
  });
  if (saved.setting_key === 'mail_logo_url') logoCheck.record(value, logo);
  if (IMAGE_SETTINGS[saved.setting_key]) media.removeSettingImage(saved.before);
  return { setting_key: saved.setting_key, setting_value: saved.setting_value };
}, { content: true });

// Two-step sign-in switch (site_settings two_step_login, read by Admin_login_server.js at every sign-in). Admin only,
// each change in the audit log. Off: one call (the page asks first). On: /on e-mails a code to the admin making the
// change; /on/confirm with that code switches it on. Without the code nothing is saved, so nobody is locked out by
// a mail that never arrives.
async function setTwoStep(req, value, how) {
  await tx(async (q) => {
    const [[before]] = await q.query("SELECT setting_value FROM site_settings WHERE setting_key = 'two_step_login' FOR UPDATE");
    if (!before) throw new InputError('The two_step_login setting is missing: apply database/migrations/20261017_two_step_login.sql', 404);
    if (before.setting_value === value) return;
    await q.query("UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = 'two_step_login'", [value, by(req)]);
    await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: 'two_step_login', before: { value: before.setting_value }, after: { value, how } });
  });
  return { setting_key: 'two_step_login', setting_value: value };
}

route('post', '/settings/two-step-login/off', 'settings:edit', async (req) => setTwoStep(req, 'off', 'turned off after the warning was confirmed'));

route('post', '/settings/two-step-login/on', 'settings:edit', async (req) => {
  const sent = await loginServer.sendSwitchCode(req.admin.emp_id);
  if (!sent.ok) throw new InputError(sent.message, 503);
  return { sentTo: sent.sentTo, minutes: sent.minutes };
});

route('post', '/settings/two-step-login/on/confirm', 'settings:edit', async (req) => {
  const checked = await loginServer.checkSwitchCode(req.admin.emp_id, typeof req.body.code === 'string' ? req.body.code.trim() : '');
  if (!checked.ok) {
    const err = new InputError(checked.message);
    if (checked.restart) err.code = 'code_restart';
    throw err;
  }
  return setTwoStep(req, 'on', 'turned on with a code e-mailed to this admin');
});

// Lead sheet: which spreadsheet an ID points to (read only: its title and tab names, nothing is written). For the
// "Test connection" button; works whether or not the sync is switched on (GSHEET_ENABLED).
route('get', '/settings/gsheet-check', 'settings:view', async (req) => {
  const checked = settingRules.checkSetting('gsheet_spreadsheet_id', String(req.query.id || ''));
  if (!checked.value) throw new InputError('No sheet ID to test');
  if (checked.error) throw new InputError(checked.error);
  const info = await gsheet.sheetInfo(checked.value);
  return { ...info, syncEnabled: process.env.GSHEET_ENABLED === 'true' };
});

// Share picture / About photo: upload -> generated files under /media, the setting holds the path.
route('post', '/settings/:key/image', 'settings:edit', async (req) => {
  const save = IMAGE_SETTINGS[req.params.key];
  if (!save) throw new InputError('This setting takes no picture', 404);
  if (!req.file) throw new InputError('Choose a picture');
  const saved = await save(req.file.buffer);
  const before = await tx(async (q) => {
    const [[row]] = await q.query('SELECT setting_key, setting_value FROM site_settings WHERE setting_key = ?', [req.params.key]);
    if (!row) throw new InputError('Unknown setting', 404);
    await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [saved.file_name, by(req), row.setting_key]);
    await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: row.setting_key, before: { value: row.setting_value }, after: { value: saved.file_name } });
    return row.setting_value;
  });
  if (before !== saved.file_name) media.removeSettingImage(before);
  return { ...saved, original_bytes: req.file.size };
}, { content: true, before: [upload(8)] });

// Mail logo in admin Settings: the built-in logo (preview when mail_logo_url is empty), the check state, and a
// test mail through the outbox (MAIL_TEST_TO outside production, the signed-in admin's own e-mail in production).
router.get('/admin/mail-logo/builtin.png', ...declare('get', '/mail-logo/builtin.png', 'settings:view'), (req, res) => {
  res.type('png').set('Cache-Control', 'private, max-age=300').sendFile(path.join(__dirname, 'mail-logo.png'));
});

route('get', '/mail-logo', 'settings:view', async () => logoCheck.status());

route('post', '/mail-logo/test-mail', 'settings:edit', async (req) => {
  let to;
  if (process.env.NODE_ENV === 'production') {
    const [[emp]] = await db.query(`SELECT emp_mail_id FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ?`, [req.admin.emp_id]);
    to = emp && emp.emp_mail_id;
    if (!to) throw new InputError('Your dAdmin account has no e-mail address');
  } else {
    to = (process.env.MAIL_TEST_TO || '').trim();
    if (!to) throw new InputError('MAIL_TEST_TO is not set in this server\'s .env, so a test mail has nowhere to go');
  }
  const [[company]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'company_name'");
  const [[setting]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'mail_logo_url'");
  const url = logoCheck.usableUrl(setting && setting.setting_value);
  const m = mailer.renderLogoTest({ logo: url ? 'url' : 'builtin', url, companyName: company ? company.setting_value : '' });
  // Not due for a minute: the worker pass leaves it alone, sendMailNow sends it now.
  const [ins] = await db.query(
    `INSERT INTO mail_outbox (to_email, subject, html_body, text_body, purpose, next_attempt_at)
     VALUES (?, ?, ?, ?, 'logo_test', NOW() + INTERVAL 1 MINUTE)`,
    [to, m.subject, m.html, m.text]
  );
  const r = await outboxWorker.sendMailNow(ins.insertId);
  if (r.status !== 'sent') {
    // A test that did not go out now is not retried later.
    await db.query("UPDATE mail_outbox SET status = 'cancelled', last_error = ? WHERE mail_id = ?", [String(r.error || r.reason || r.status).slice(0, 500), ins.insertId]);
    const why = r.status === 'off' ? (process.env.MAIL_ENABLED !== 'true' ? 'e-mail is switched off on this server' : r.reason) : r.error;
    throw new InputError(`Test mail not sent: ${why}`, 503);
  }
  return { to, logo: url ? 'url' : 'builtin', mail_id: ins.insertId, provider_id: r.providerId };
});

// dAdmin employee (read only; named columns only, never the rest of that table): name, e-mail, active, photo, and
// job_position / emp_department, which are ids into dadmin.job_position_config / department_config.
const USER_SELECT = `SELECT a.emp_id, a.role_id, r.name AS role_name, r.is_builtin, a.is_active, a.created_by, a.created_at,
  TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name, e.emp_mail_id AS email,
  e.job_position, e.emp_department, e.emp_profile_img AS photo,
  (e.emp_id IS NOT NULL AND (e.deleted_time IS NOT NULL OR e.active <> 1)) AS left_company,
  e.emp_id IS NULL AS not_in_dadmin
  FROM admin_users a LEFT JOIN roles r ON r.role_id = a.role_id LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id`;
async function roleExists(q, roleId) {
  const [[r]] = await q.query('SELECT role_id, name FROM roles WHERE role_id = ?', [Number(roleId)]);
  return r || null;
}

// Job title and department names. Production needs SELECT on these two dadmin tables (database/README.md); without it
// the names are simply left out.
async function dadminNames(q) {
  const out = { jobs: new Map(), depts: new Map() };
  try {
    const [jobs] = await q.query(`SELECT job_id, job_name FROM \`${auth.DADMIN}\`.job_position_config`);
    for (const j of jobs) out.jobs.set(String(j.job_id), j.job_name);
    const [depts] = await q.query(`SELECT department_id, department_name FROM \`${auth.DADMIN}\`.department_config`);
    for (const d of depts) out.depts.set(String(d.department_id), d.department_name);
  } catch (err) {
    if (!/denied|ER_TABLEACCESS|ER_NO_SUCH_TABLE/i.test(`${err.code} ${err.message}`)) throw err;
  }
  return out;
}
// A photo the browser can show: a URL or an image data URL of a sane size, else none (initials instead).
const photoOf = (v) => (typeof v === 'string' && (/^https?:\/\//.test(v) || (/^data:image\//.test(v) && v.length < 300000)) ? v : null);
function withNames(rows, names) {
  return rows.map(({ job_position: job, emp_department: dept, photo, ...r }) => ({
    ...r, designation: names.jobs.get(String(job)) || null, department: names.depts.get(String(dept)) || null, photo: photoOf(photo),
    left_company: Number(r.left_company) === 1, not_in_dadmin: Number(r.not_in_dadmin) === 1,
  }));
}
// Active users with the Admin role whose dAdmin account is still active (the ones who can actually sign in).
async function activeAdmins(q, exceptEmpId) {
  const [[r]] = await q.query(
    `SELECT COUNT(*) AS n FROM admin_users a JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id AND e.deleted_time IS NULL AND e.active = 1
      WHERE a.is_active = 1 AND a.role_id = ? AND a.emp_id <> ?`, [permissions.ADMIN_ROLE_ID, exceptEmpId || '']
  );
  return Number(r.n);
}

// The Add picker: active dAdmin employees who are not dFresh admin users yet, by name or emp_id.
route('get', '/users/employees', 'users:create', async (req) => {
  const term = String(req.query.q || '').trim().slice(0, 60);
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const [rows] = await db.query(
    `SELECT e.emp_id, TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name,
            e.emp_mail_id AS email, e.job_position, e.emp_department, e.emp_profile_img AS photo, 0 AS left_company, 0 AS not_in_dadmin
       FROM \`${auth.DADMIN}\`.employee e
      WHERE e.deleted_time IS NULL AND e.active = 1
        AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.emp_id = e.emp_id)
        AND (? = '' OR e.emp_id LIKE ? OR CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, '')) LIKE ?)
      ORDER BY e.emp_first_name, e.emp_last_name LIMIT 20`,
    [term, like, like]
  );
  return withNames(rows, await dadminNames(db)).map(({ left_company: _l, not_in_dadmin: _n, ...r }) => r); // eslint-disable-line no-unused-vars
});

route('get', '/users', 'users:view', async () => {
  const [rows] = await db.query(`${USER_SELECT} ORDER BY a.is_active DESC, name, a.emp_id`);
  return withNames(rows, await dadminNames(db));
});

route('post', '/users', 'users:create', async (req) => tx(async (q) => {
  const empId = str(req.body.emp_id, 20);
  if (!empId || !/^[A-Za-z0-9_-]{1,20}$/.test(empId)) throw new InputError('emp_id like DZIND148');
  const role = await roleExists(q, req.body.role_id);
  if (!role) throw new InputError('Choose a role');
  const [[emp]] = await q.query(`SELECT emp_id FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ? AND deleted_time IS NULL AND active = 1`, [empId]);
  if (!emp) throw new InputError('No active dAdmin employee with that emp_id');
  const [[already]] = await q.query('SELECT emp_id FROM admin_users WHERE emp_id = ?', [emp.emp_id]);
  if (already) throw new InputError(`${emp.emp_id} is already a dFresh admin user`);
  await q.query("INSERT INTO admin_users (emp_id, role, role_id, is_active, created_by) VALUES (?, 'viewer', ?, 1, ?)", [emp.emp_id, role.role_id, by(req)]);
  const [[after]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [emp.emp_id]);
  await audit(q, { empId: by(req), action: 'create', entity: 'admin_user', entityId: emp.emp_id, after: { role: after.role_name, is_active: after.is_active } });
  return withNames([after], await dadminNames(q))[0];
}), { status: 201 });

route('put', '/users/:empId', 'users:edit', async (req) => tx(async (q) => {
  const [[before]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [req.params.empId]);
  if (!before) throw new InputError('Not a dFresh admin user', 404);
  const set = {};
  if ('role_id' in req.body) {
    const role = await roleExists(q, req.body.role_id);
    if (!role) throw new InputError('Choose a role');
    set.role_id = role.role_id;
  }
  if ('is_active' in req.body) set.is_active = entities.coerce('is_active', { type: 'bool' }, req.body.is_active);
  if (!Object.keys(set).length) throw new InputError('Nothing to change');
  // nobody changes their own role or switches themselves off (ask another Admin)
  if (before.emp_id === by(req) && (set.is_active === 0 || (set.role_id && set.role_id !== before.role_id))) {
    throw new InputError('You cannot change your own role or deactivate yourself (ask another Admin)', 403);
  }
  // there must always be at least one active Admin who can sign in
  const losesAdmin = before.role_id === permissions.ADMIN_ROLE_ID && Number(before.is_active) === 1
    && (set.is_active === 0 || (set.role_id && set.role_id !== permissions.ADMIN_ROLE_ID));
  if (losesAdmin && (await activeAdmins(q, before.emp_id)) === 0) {
    throw new InputError('There must always be at least one active Admin. Make someone else Admin first.', 409);
  }
  await q.query(`UPDATE admin_users SET ${Object.keys(set).map((c) => `${c} = ?`).join(', ')} WHERE emp_id = ?`, [...Object.values(set), before.emp_id]);
  const [[after]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [before.emp_id]);
  const action = set.role_id && set.role_id !== before.role_id ? 'role_change' : set.is_active === 0 ? 'deactivate' : set.is_active === 1 ? 'reactivate' : 'update';
  await audit(q, { empId: by(req), action, entity: 'admin_user', entityId: before.emp_id, before: { role: before.role_name, is_active: before.is_active }, after: { role: after.role_name, is_active: after.is_active } });
  return withNames([after], await dadminNames(q))[0];
}));

route('get', '/audit', 'audit:view', async (req) => {
  const pg = page(req);
  const where = [];
  const params = [];
  if (req.query.entity) { where.push('entity_type = ?'); params.push(String(req.query.entity)); }
  if (req.query.emp) { where.push('emp_id = ?'); params.push(String(req.query.emp)); }
  if (req.query.id) { where.push('entity_id = ?'); params.push(String(req.query.id)); }
  if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await db.query(
    `SELECT audit_id, emp_id, action, entity_type, entity_id, before_json, after_json, created_at FROM audit_log ${w} ORDER BY audit_id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM audit_log ${w}`, params);
  return { rows, total: Number(c.n), page: pg.page, limit: pg.limit };
});

// Errors from any admin route: input / upload problems and DB constraint errors get a plain message.
// ---------------------------------------------------------------------------------------------
// Commerce DEMO (branch `commerce`, database dfresh_commerce only): SKUs (database/demo/commerce-demo-schema.sql)
// ---------------------------------------------------------------------------------------------
route('get', '/commerce/skus', 'inventory:view', async () => {
  const [rows] = await db.query(
    `SELECT s.sku_code, s.product_id, s.size_label, s.is_active,
            COALESCE(t.name, pt.name, s.product_id) AS name
       FROM skus s
       JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
      ORDER BY s.sku_code`
  );
  return rows;
});

// Inventory (migration 20261020_commerce_stock.sql, logic in stock.js). Section "inventory": view = stock, batches,
// stock-ins, write-offs, counts, reorder list, movements; create = stock in, write-off request, start a count, record
// damaged / returned; edit = reorder levels, suppliers, count quantities and submit, Excel export; approve = decide
// write-offs and count differences (Setup > Approvals). Costs and stock value only for a role that can view Reports or
// Products and prices.
const SKU_NAME = `COALESCE(t.name, pt.name, s.product_id)`;
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;
const stock = require('./stock');
const seesCost = (req) => canDo(req, 'reports') || canDo(req, 'products');
const asStock = (e) => (e instanceof stock.StockError ? new InputError(e.message, e.status) : e);

route('get', '/commerce/stock', 'inventory:view', async (req) => {
  const cs = await commerceSettings.read(db);
  const [rows] = await db.query(
    `SELECT s.sku_code, s.product_id, s.size_label, s.packs_per_carton, s.avg_cost, s.bin_location, p.category_key, p.track_batches, ${SKU_NAME} AS name,
            COALESCE(l.reorder_level, ?) AS reorder_level, COALESCE(l.reorder_qty, ?) AS reorder_qty,
            COALESCE(SUM(CASE WHEN m.stock_kind = 'returned' THEN m.delta END), 0) AS returned,
            COALESCE(SUM(CASE WHEN m.stock_kind = 'damaged' THEN m.delta END), 0) AS damaged,
            MAX(m.created_at) AS last_move,
            (SELECT COUNT(DISTINCT b.batch_id) FROM batches b JOIN stock_movements bm ON bm.batch_id = b.batch_id AND bm.stock_kind = 'good' WHERE b.sku_code = s.sku_code) AS batches
       FROM skus s ${SKU_JOIN}
       LEFT JOIN stock_levels l ON l.sku_code = s.sku_code AND l.location_id = 1
       LEFT JOIN stock_movements m ON m.sku_code = s.sku_code
      GROUP BY s.sku_code, s.product_id, s.size_label, s.packs_per_carton, s.avg_cost, s.bin_location, p.category_key, p.track_batches, t.name, pt.name, l.reorder_level, l.reorder_qty
      ORDER BY s.sku_code`, [Number(cs.low_level_default) || 20, Number(cs.reorder_qty_default) || 0]
  );
  const av = await stock.availability(db, rows.map((r) => r.sku_code));
  const cost = seesCost(req);
  const out = rows.map(({ avg_cost: ac, ...r }) => {
    const a = av.get(r.sku_code);
    return { ...r, ...a, returned: Number(r.returned), damaged: Number(r.damaged), reorder_level: Number(r.reorder_level), reorder_qty: Number(r.reorder_qty),
      track_batches: Number(r.track_batches) === 1, batches: Number(r.batches), low: a.available < Number(r.reorder_level),
      ...(cost ? { avg_cost: ac === null ? null : Number(ac), value: ac === null ? null : Math.round(a.good * Number(ac) * 100) / 100 } : {}) };
  });
  return { rows: out, seesCost: cost, totalValue: cost ? Math.round(out.reduce((x, r) => x + (r.value || 0), 0) * 100) / 100 : null, warnDays: Number(cs.expiry_warn_days) || 60 };
});

route('put', '/commerce/stock/:sku/levels', 'inventory:edit', async (req) => {
  const level = Number(req.body.reorder_level);
  const qty = Number(req.body.reorder_qty);
  if (!Number.isInteger(level) || level < 0 || level > 100000) throw new InputError('Reorder level: a whole number, 0 or more');
  if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) throw new InputError('Reorder quantity: a whole number, 0 or more (0 = suggest)');
  const [[s]] = await db.query('SELECT sku_code FROM skus WHERE sku_code = ?', [req.params.sku]);
  if (!s) throw new InputError('No SKU', 404);
  const bin = req.body.bin_location === undefined ? undefined : String(req.body.bin_location || '').trim().toUpperCase().slice(0, 30) || null;
  if (bin !== undefined) {
    if (bin && !/^[A-Z0-9 /-]{1,30}$/.test(bin)) throw new InputError('Bin: letters, digits, space, - or /, e.g. R2-S3');
    await db.query('UPDATE skus SET bin_location = ? WHERE sku_code = ?', [bin, s.sku_code]);
  }
  const [[before]] = await db.query('SELECT reorder_level, reorder_qty FROM stock_levels WHERE sku_code = ? AND location_id = 1', [s.sku_code]);
  await db.query(`INSERT INTO stock_levels (sku_code, location_id, reorder_level, reorder_qty, updated_by, updated_at) VALUES (?, 1, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE reorder_level = VALUES(reorder_level), reorder_qty = VALUES(reorder_qty), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`, [s.sku_code, level, qty, by(req)]);
  await audit(null, { empId: by(req), action: 'update', entity: 'stock_level', entityId: s.sku_code, before: before || null, after: { reorder_level: level, reorder_qty: qty, ...(bin !== undefined ? { bin_location: bin } : {}) } });
  return { sku_code: s.sku_code, reorder_level: level, reorder_qty: qty };
});

// Movement log: filters sku, type, from / to (India days), emp, batch (batch no.); newest first, at most 1000.
async function movementRows(req, limit) {
  const where = [];
  const params = [];
  if (req.query.sku) { where.push('m.sku_code = ?'); params.push(String(req.query.sku).toUpperCase()); }
  if (req.query.type) { where.push('m.move_type = ?'); params.push(String(req.query.type)); }
  if (req.query.emp) { where.push('m.emp_id = ?'); params.push(String(req.query.emp)); }
  if (req.query.batch) { where.push('b.batch_no = ?'); params.push(String(req.query.batch).toUpperCase()); }
  for (const [k, op] of [['from', '>='], ['to', '<=']]) {
    if (!req.query[k]) continue;
    if (!pricing.isDate(String(req.query[k]))) throw new InputError(`${k}: a date like 2026-10-01`);
    where.push(`DATE(CONVERT_TZ(m.created_at, '+00:00', '+05:30')) ${op} ?`); params.push(String(req.query[k]));
  }
  const [rows] = await db.query(
    `SELECT m.move_id, m.sku_code, m.move_type, m.stock_kind, m.delta, m.unit_cost, m.ref_type, m.ref_id, m.note, m.emp_id, m.created_at, b.batch_no,
            TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS emp_name
       FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = m.emp_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.move_id DESC LIMIT ?`, [...params, limit]
  );
  const cost = seesCost(req);
  return rows.map(({ unit_cost: uc, ...r }) => ({ ...r, type_label: stock.MOVE_LABEL[r.move_type] || r.move_type, ...(cost ? { unit_cost: uc === null ? null : Number(uc) } : {}) }));
}
route('get', '/commerce/movements', 'inventory:view', async (req) => {
  const rows = await movementRows(req, 1000);
  const [who] = await db.query(`SELECT DISTINCT m.emp_id, TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name
      FROM stock_movements m LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = m.emp_id ORDER BY m.emp_id`);
  return { rows, types: stock.MOVE_LABEL, who };
});
route('get', '/commerce/movements/export.xlsx', 'inventory:edit', async (req, res) => {
  const rows = await movementRows(req, 20000);
  const cost = seesCost(req);
  const wb = theme.newWorkbook('dFresh Stock movements');
  const filters = ['sku', 'type', 'from', 'to', 'emp', 'batch'].filter((k) => req.query[k]).map((k) => `${k}: ${req.query[k]}`).join(', ') || null;
  theme.tableSheet(wb, 'Movements', {
    title: 'dFresh Stock movements', exportedBy: await exportedBy(req), filters,
    columns: [{ header: 'When', type: 'date' }, { header: 'SKU' }, { header: 'Type' }, { header: 'Stock' }, { header: 'Change', type: 'number' }, { header: 'Batch' },
      ...(cost ? [{ header: 'Cost / pack (Rs)', type: 'number' }] : []), { header: 'Reference' }, { header: 'Note' }, { header: 'Who' }],
    rows: rows.map((r) => [r.created_at, r.sku_code, r.type_label, stock.KIND_LABEL[r.stock_kind], r.delta, r.batch_no, ...(cost ? [r.unit_cost] : []),
      r.ref_type ? `${r.ref_type} ${r.ref_id}` : null, r.note, `${r.emp_name || ''} (${r.emp_id})`]),
  });
  const bytes = await theme.send(res, wb, `dFresh_Stock_Movements_${theme.istStamp(new Date(), false)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'stock', after: { filters, rows: rows.length, file: 'movements.xlsx', bytes } });
});

// Record form: good -> damaged, or packs back into Returned (R) stock. Stock in, write-off and counts have their own tabs.
route('post', '/commerce/movements', 'inventory:create', async (req) => {
  try { return await tx((q) => stock.recordMove(q, req.body || {}, by(req))); } catch (e) { throw asStock(e); }
});

// Suppliers
const supplierValues = (b) => {
  const v = { name: String(b.name || '').trim().slice(0, 150), phone: String(b.phone || '').trim().slice(0, 20) || null, gstin: String(b.gstin || '').trim().toUpperCase() || null,
    address: String(b.address || '').trim().slice(0, 255) || null, is_active: b.is_active === false || b.is_active === 0 || b.is_active === '0' ? 0 : 1 };
  if (!v.name) throw new InputError('Name is required');
  if (v.gstin) { const g = settingRules.checkSetting('gstin', v.gstin); if (g.error) throw new InputError(`GSTIN: ${g.error}`); v.gstin = g.value; }
  return v;
};
route('get', '/commerce/suppliers', 'inventory:view', async () => {
  const [rows] = await db.query(`SELECT s.supplier_id, s.name, s.phone, s.gstin, s.address, s.is_active,
      (SELECT COUNT(*) FROM stock_ins i WHERE i.supplier_id = s.supplier_id) AS stock_ins, (SELECT MAX(received_on) FROM stock_ins i WHERE i.supplier_id = s.supplier_id) AS last_in
      FROM suppliers s ORDER BY s.is_active DESC, s.name`);
  return rows;
});
route('post', '/commerce/suppliers', 'inventory:create', async (req) => {
  const v = supplierValues(req.body || {});
  const [[dup]] = await db.query('SELECT supplier_id FROM suppliers WHERE name = ?', [v.name]);
  if (dup) throw new InputError(`A supplier called ${v.name} exists already`, 409);
  const [ins] = await db.query('INSERT INTO suppliers (name, phone, gstin, address, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)', [v.name, v.phone, v.gstin, v.address, v.is_active, by(req)]);
  await audit(null, { empId: by(req), action: 'create', entity: 'supplier', entityId: String(ins.insertId), after: v });
  return { supplier_id: ins.insertId, ...v };
}, { status: 201 });
route('put', '/commerce/suppliers/:id', 'inventory:edit', async (req) => {
  const v = supplierValues(req.body || {});
  const [[before]] = await db.query('SELECT name, phone, gstin, address, is_active FROM suppliers WHERE supplier_id = ?', [Number(req.params.id)]);
  if (!before) throw new InputError('No such supplier', 404);
  await db.query('UPDATE suppliers SET name = ?, phone = ?, gstin = ?, address = ?, is_active = ? WHERE supplier_id = ?', [v.name, v.phone, v.gstin, v.address, v.is_active, Number(req.params.id)]);
  await audit(null, { empId: by(req), action: 'update', entity: 'supplier', entityId: String(req.params.id), before, after: v });
  return { supplier_id: Number(req.params.id), ...v };
});

// Stock in
route('get', '/commerce/stock-ins', 'inventory:view', async (req) => {
  const [ins] = await db.query(`SELECT i.stock_in_id, i.kind, i.supplier_id, sp.name AS supplier, DATE_FORMAT(i.received_on, '%Y-%m-%d') AS received_on, i.reference, i.note, i.emp_id, i.created_at,
      TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS emp_name
      FROM stock_ins i LEFT JOIN suppliers sp ON sp.supplier_id = i.supplier_id LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = i.emp_id
      ORDER BY i.stock_in_id DESC LIMIT 200`);
  const [lines] = ins.length ? await db.query(`SELECT l.stock_in_id, l.sku_code, l.qty, l.unit_cost, l.avg_before, l.avg_after, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date
      FROM stock_in_lines l LEFT JOIN batches b ON b.batch_id = l.batch_id WHERE l.stock_in_id IN (?) ORDER BY l.line_id`, [ins.map((i) => i.stock_in_id)]) : [[]];
  const cost = seesCost(req);
  return { seesCost: cost, rows: ins.map((i) => {
    const ls = lines.filter((l) => l.stock_in_id === i.stock_in_id).map(({ unit_cost: uc, avg_before: ab, avg_after: aa, ...l }) => ({ ...l, ...(cost ? { unit_cost: Number(uc), avg_before: ab === null ? null : Number(ab), avg_after: Number(aa) } : {}) }));
    return { ...i, lines: ls, packs: ls.reduce((a, l) => a + l.qty, 0), ...(cost ? { value: Math.round(ls.reduce((a, l) => a + l.qty * l.unit_cost, 0) * 100) / 100 } : {}) };
  }) };
});
route('post', '/commerce/stock-ins', 'inventory:create', async (req) => {
  try {
    const r = await tx((q) => stock.stockIn(q, req.body || {}, by(req)));
    return seesCost(req) ? r : { stock_in_id: r.stock_in_id, lines: r.lines.map(({ avg_before: ab, avg_after: aa, ...l }) => l) }; // eslint-disable-line no-unused-vars
  } catch (e) { throw asStock(e); }
});

// Batches: expired / near expiry / ok with their good stock; the batches of one SKU with stock (write-off picker)
route('get', '/commerce/batches', 'inventory:view', async (req) => {
  if (req.query.sku) {
    const kind = stock.KIND_LABEL[req.query.kind] ? req.query.kind : 'good';
    return { rows: (await stock.batchStock(db, String(req.query.sku).toUpperCase(), kind)).filter((b) => b.qty > 0) };
  }
  return stock.batchList(db);
});

// Write-offs (photo optional, kept in the database and shown only here)
route('get', '/commerce/write-offs', 'inventory:view', async (req) => {
  const [rows] = await db.query(`SELECT w.write_off_id, w.sku_code, w.stock_kind, w.qty, w.reason_type, w.reason, w.value, w.status, w.approval_id, w.emp_id, w.created_at, w.posted_at,
      w.photo IS NOT NULL AS has_photo, b.batch_no, a.status AS approval_status, a.decided_by, a.note AS approval_note
      FROM write_offs w LEFT JOIN batches b ON b.batch_id = w.batch_id LEFT JOIN approvals a ON a.approval_id = w.approval_id ORDER BY w.write_off_id DESC LIMIT 200`);
  const cost = seesCost(req);
  const cs = await commerceSettings.read(db);
  return { types: stock.WRITE_OFF_TYPES, kinds: stock.KIND_LABEL, rule: { on: Boolean(cs.approve_writeoff_on), value: Number(cs.approve_writeoff_value_above), qty: Number(cs.approve_writeoff_qty_above) },
    rows: rows.map(({ value, ...r }) => ({ ...r, has_photo: Number(r.has_photo) === 1, ...(cost ? { value: value === null ? null : Number(value) } : {}) })) };
});
route('post', '/commerce/write-offs', 'inventory:create', async (req) => {
  try {
    const r = await tx((q) => stock.requestWriteOff(q, req.body || {}, by(req), req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : null));
    return seesCost(req) ? r : { ...r, value: undefined };
  } catch (e) { throw asStock(e); }
}, { before: [upload(5)] });
route('get', '/commerce/write-offs/:id/photo', 'inventory:view', async (req, res) => {
  const [[w]] = await db.query('SELECT photo, photo_type FROM write_offs WHERE write_off_id = ?', [Number(req.params.id)]);
  if (!w || !w.photo) throw new InputError('No photo', 404);
  res.set({ 'Content-Type': w.photo_type, 'Cache-Control': 'private, no-store' });
  res.send(w.photo);
});

// Stock counts
route('get', '/commerce/counts', 'inventory:view', async () => {
  const [rows] = await db.query(`SELECT c.count_id, c.scope, c.status, c.approval_id, c.started_by, c.started_at, c.submitted_by, c.submitted_at, c.closed_at,
      COALESCE(ct.name, c.scope) AS scope_label, a.decided_by, a.note AS approval_note,
      (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.count_id) AS line_count,
      (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.count_id AND l.counted IS NOT NULL) AS counted,
      (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.count_id AND l.expected IS NOT NULL AND l.counted <> l.expected) AS differences
      FROM stock_counts c LEFT JOIN category_translations ct ON ct.category_key = c.scope AND ct.lang_code = 'en' LEFT JOIN approvals a ON a.approval_id = c.approval_id
      ORDER BY c.count_id DESC LIMIT 100`);
  const [cats] = await db.query("SELECT c.category_key, COALESCE(t.name, c.category_key) AS label FROM categories c LEFT JOIN category_translations t ON t.category_key = c.category_key AND t.lang_code = 'en' ORDER BY c.sort_order");
  return { rows: rows.map((r) => ({ ...r, scope_label: r.scope === 'all' ? 'All SKUs' : r.scope_label })), categories: cats };
});
route('post', '/commerce/counts', 'inventory:create', async (req) => {
  try { return await tx((q) => stock.startCount(q, req.body.scope, by(req))); } catch (e) { throw asStock(e); }
}, { status: 201 });
route('get', '/commerce/counts/:id', 'inventory:view', async (req) => {
  try { return await stock.countDetail(db, Number(req.params.id)); } catch (e) { throw asStock(e); }
});
route('put', '/commerce/counts/:id', 'inventory:edit', async (req) => {
  try { return await tx((q) => stock.saveCount(q, Number(req.params.id), req.body.lines, by(req))); } catch (e) { throw asStock(e); }
});
route('post', '/commerce/counts/:id/submit', 'inventory:edit', async (req) => {
  try { return await tx((q) => stock.submitCount(q, Number(req.params.id), by(req))); } catch (e) { throw asStock(e); }
});

route('get', '/commerce/reorder', 'inventory:view', async () => stock.reorderList(db));

// Orders (migration 20261020_commerce_sales.sql, logic in commerce.js, invoices in invoices.js): entered in the admin;
// prices only here. Section "orders": view = list, order, invoice; create = New order; edit = edit, status, cancel,
// payments, Excel export; approve = may ask to order above the available stock (the request waits for approval).
const commerce = require('./commerce');
const { GST_STATES, stateName } = require('../shared/gstStates');
const asInput = (e) => (e instanceof commerce.CommerceError || e instanceof invoices.InvoiceError ? new InputError(e.message, e.status) : e);

// The New order / Edit order form: customers (price list, address, credit), SKUs with selling rules, today's own prices
// and the stock (good, reserved by other orders, available), coupons, terms, payment modes, the approval rules.
// ?order=DFO-.. : the stock leaves that order's own reservations out (editing it).
route('get', '/commerce/order-form', 'orders:view', async (req) => {
  if (!canDo(req, 'orders', 'create') && !canDo(req, 'orders', 'edit')) throw new InputError('This needs create or edit on Orders', 403);
  let except = 0;
  if (req.query.order) { const [[o]] = await db.query('SELECT order_id FROM orders WHERE order_no = ?', [String(req.query.order)]); except = o ? o.order_id : 0; }
  const [customers] = await db.query(
    `SELECT c.customer_id, c.name, c.business_name, c.phone, c.ctype, c.town, c.address, c.state_code, c.pincode, c.gstin, c.credit_days, c.credit_limit,
            COALESCE(ct.type_key, 'default') AS list_key,
            (SELECT COALESCE(SUM(w.amount), 0) FROM wallet_entries w WHERE w.customer_id = c.customer_id) AS wallet,
            (SELECT COALESCE(SUM(o.amount_due), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled' AND o.amount_due > 0) AS outstanding,
            (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = c.customer_id AND ${commerce.OVERDUE_SQL}) AS overdue
       FROM customers c LEFT JOIN customer_types ct ON ct.type_key = LOWER(c.ctype) OR ct.label = c.ctype ORDER BY c.name`
  );
  const today = pricing.istToday();
  const own = await pricing.ownPricesOn(db, today);
  const all = (await pricing.skuRows(db)).filter((s) => s.is_active);
  const stock = await commerce.availability(db, all.map((s) => s.sku_code), except);
  const skus = all.map((s) => ({ sku_code: s.sku_code, name: s.name, size_label: s.size_label, gst_rate: s.gst_rate, packs_per_carton: s.packs_per_carton,
    min_order_qty: s.min_order_qty, sell_unit: s.sell_unit, own: own.get(s.sku_code) || {}, ...stock.get(s.sku_code) }));
  const [coupons] = await db.query('SELECT code, kind, value, min_order, expires_on, usage_limit, used, is_active FROM coupons ORDER BY code');
  const cs = await commerceSettings.read(db);
  return {
    customers: customers.map((c) => ({ ...c, wallet: Number(c.wallet), outstanding: Number(c.outstanding), overdue: Number(c.overdue), credit_limit: Number(c.credit_limit) })),
    skus, coupons, terms: commerce.TERMS, lists: await pricing.lists(db), basis: await pricing.basis(db), today, states: GST_STATES,
    sellerState: cs.invoice_seller_state_code, roundOff: Boolean(cs.invoice_round_off), canOverride: canDo(req, 'orders', 'approve'),
    methods: (await db.query('SELECT method_id, label, kind FROM delivery_methods WHERE is_active = 1 ORDER BY sort_order, method_id'))[0],
    areas: (await db.query('SELECT area_id, label, towns, charge, free_above FROM delivery_areas WHERE is_active = 1 ORDER BY sort_order, area_id'))[0]
      .map((a) => ({ ...a, charge: Number(a.charge), free_above: a.free_above === null ? null : Number(a.free_above) })),
    deliveryGstRate: Number(cs.delivery_charge_gst_rate) || 0,
    approval: { on: Boolean(cs.approve_price_below_on), pct: Number(cs.approve_price_below_pct) || 0, credit: cs.approve_credit_order !== false, stock: cs.approve_over_available !== false },
  };
});

route('post', '/commerce/coupon-check', 'orders:view', async (req) => {
  try {
    const discount = await commerce.couponDiscount(db, String(req.body.code || '').trim().toUpperCase(), Number(req.body.subtotal) || 0);
    return { discount };
  } catch (e) { throw asInput(e); }
});

// List filters: status, pay (payment status), overdue=1, from / to (order day, India), type (customer type key),
// q (DFO number, invoice number, customer name or phone).
async function orderRows(req, limit = 500) {
  const where = [];
  const params = [];
  const st = String(req.query.status || '');
  if (commerce.STATUS_LABEL[st]) { where.push('o.status = ?'); params.push(st); }
  if (commerce.PAYMENT_STATUS[req.query.pay]) { where.push('o.payment_status = ?'); params.push(req.query.pay); }
  if (req.query.overdue === '1') where.push(`i.invoice_id IS NOT NULL AND ${commerce.OVERDUE_SQL}`);
  for (const [k, op] of [['from', '>='], ['to', '<=']]) {
    if (!req.query[k]) continue;
    if (!pricing.isDate(String(req.query[k]))) throw new InputError(`${k}: a date like 2026-10-01`);
    where.push(`DATE(CONVERT_TZ(o.created_at, '+00:00', '+05:30')) ${op} ?`); params.push(String(req.query[k]));
  }
  if (req.query.type) { where.push('COALESCE(ct.type_key, \'default\') = ?'); params.push(String(req.query.type)); }
  const term = String(req.query.q || '').trim().slice(0, 60);
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const digits = term.replace(/\D/g, '');
    where.push(`(o.order_no LIKE ? OR i.invoice_no LIKE ? OR c.name LIKE ? OR c.business_name LIKE ?${digits.length >= 4 ? " OR REGEXP_REPLACE(c.phone, '[^0-9]', '') LIKE ?" : ''})`);
    params.push(like, like, like, like, ...(digits.length >= 4 ? [`%${digits}%`] : []));
  }
  const [rows] = await db.query(
    `SELECT o.order_no, o.status, o.payment_status, o.payment_terms, o.gst_type, o.place_of_supply, o.coupon_code, o.total, o.amount_due, o.created_at,
            o.dispatched_at, o.delivered_at, c.name AS customer, c.phone, c.ctype, COALESCE(ct.type_key, 'default') AS type_key, o.ship_town AS town,
            i.invoice_no, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on,
            (i.invoice_id IS NOT NULL AND ${commerce.OVERDUE_SQL}) AS overdue,
            (SELECT SUM(qty) FROM order_items it WHERE it.order_id = o.order_id) AS units
       FROM orders o JOIN customers c ON c.customer_id = o.customer_id
       LEFT JOIN customer_types ct ON ct.type_key = LOWER(c.ctype) OR ct.label = c.ctype
       LEFT JOIN invoices i ON i.live_order_id = o.order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.order_id DESC LIMIT ?`, [...params, limit]
  );
  return rows.map((r) => ({ ...r, total: Number(r.total), amount_due: Number(r.amount_due), overdue: Number(r.overdue) === 1, units: Number(r.units) }));
}

route('get', '/commerce/orders', 'orders:view', async (req) => {
  const rows = await orderRows(req);
  const [counts] = await db.query('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const [[od]] = await db.query(`SELECT COUNT(*) AS n FROM orders o JOIN invoices i ON i.live_order_id = o.order_id WHERE ${commerce.OVERDUE_SQL}`);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])), overdue: Number(od.n), labels: commerce.STATUS_LABEL, payLabels: commerce.PAYMENT_STATUS, lists: await pricing.lists(db) };
});

route('get', '/commerce/orders/export.xlsx', 'orders:edit', async (req, res) => {
  const rows = await orderRows(req, 5000);
  const wb = theme.newWorkbook('dFresh Orders');
  const filters = ['status', 'pay', 'overdue', 'from', 'to', 'type', 'q'].filter((k) => req.query[k]).map((k) => `${k}: ${req.query[k]}`).join(', ') || null;
  theme.tableSheet(wb, 'Orders', {
    title: 'dFresh Orders', exportedBy: await exportedBy(req), filters,
    columns: [{ header: 'Order' }, { header: 'Date', type: 'date' }, { header: 'Customer' }, { header: 'Phone' }, { header: 'Type' }, { header: 'Status' },
      { header: 'Units', type: 'number' }, { header: 'Total (Rs)', type: 'number' }, { header: 'Payment' }, { header: 'Due (Rs)', type: 'number' },
      { header: 'Invoice' }, { header: 'Due on' }, { header: 'Overdue' }, { header: 'GST' }, { header: 'Ship to' }],
    rows: rows.map((r) => [r.order_no, r.created_at, r.customer, r.phone, r.ctype, commerce.STATUS_LABEL[r.status], r.units, r.total, commerce.PAYMENT_STATUS[r.payment_status],
      r.amount_due, r.invoice_no, r.due_on, r.overdue ? 'Yes' : '', r.gst_type === 'intra' ? 'CGST + SGST' : 'IGST', `${r.town || ''} (${stateName(r.place_of_supply)})`]),
  });
  const bytes = await theme.send(res, wb, `dFresh_Orders_${theme.istStamp(new Date(), false)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'order', after: { filters, rows: rows.length, file: 'orders.xlsx', bytes } });
});

route('get', '/commerce/orders/:no', 'orders:view', async (req) => {
  const [[o]] = await db.query(
    `SELECT o.*, c.name AS customer, c.phone, c.email, c.ctype, c.credit_days AS customer_credit_days, c.credit_limit
       FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_no = ?`, [req.params.no]
  );
  if (!o) throw new InputError('Order not found', 404);
  const [items] = await db.query(`SELECT i.sku_code, i.qty, i.price, i.list_price, i.hsn, i.gst_rate, i.taxable, i.cgst, i.sgst, i.igst, i.line_total, ${SKU_NAME} AS name, s.size_label,
       s.packs_per_carton, s.min_order_qty, s.sell_unit
       FROM order_items i JOIN skus s ON s.sku_code = i.sku_code ${SKU_JOIN} WHERE i.order_id = ? ORDER BY i.sku_code`, [o.order_id]);
  const [hist] = await db.query('SELECT from_status, to_status, note, emp_id, created_at FROM order_status_history WHERE order_id = ? ORDER BY id', [o.order_id]);
  const [pays] = await db.query("SELECT payment_id, kind, mode, amount, DATE_FORMAT(received_on, '%Y-%m-%d') AS received_on, reference, note, emp_id, created_at FROM payments WHERE order_id = ? ORDER BY payment_id", [o.order_id]);
  const [invs] = await db.query(`SELECT i.invoice_id, i.invoice_no, i.status, i.issued_at, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on, i.total, i.is_demo, i.cancelled_at, i.cancel_reason,
       cn.credit_note_id, cn.credit_note_no, cn.total AS cn_total, cn.issued_at AS cn_issued_at
       FROM invoices i LEFT JOIN credit_notes cn ON cn.invoice_id = i.invoice_id WHERE i.order_id = ? ORDER BY i.invoice_id`, [o.order_id]);
  const [appr] = await db.query("SELECT approval_id, kind, status, summary, requested_by, decided_by, note FROM approvals WHERE ref_type = 'order' AND ref_id = ? ORDER BY approval_id", [o.order_no]);
  const [res] = await db.query("SELECT sku_code, qty, status FROM stock_reservations WHERE order_id = ? AND status = 'active'", [o.order_id]);
  const batchesOut = await stock.batchesOfOrder(db, o.order_no);
  const [[dl]] = await db.query(`SELECT dm.label AS method, a.label AS area, cr.name AS courier, cr.tracking_url FROM orders o LEFT JOIN delivery_methods dm ON dm.method_id = o.delivery_method_id
      LEFT JOIN delivery_areas a ON a.area_id = o.delivery_area_id LEFT JOIN couriers cr ON cr.courier_id = o.courier_id WHERE o.order_id = ?`, [o.order_id]);
  const [trips] = await db.query(`SELECT s.stop_id, s.trip_id, s.status, s.receiver_name, s.failed_reason, s.cash_collected, s.photo IS NOT NULL AS has_photo, s.done_at, t.status AS trip_status, d.name AS driver, v.number AS vehicle
      FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id JOIN drivers d ON d.driver_id = t.driver_id JOIN vehicles v ON v.vehicle_id = t.vehicle_id WHERE s.order_id = ? ORDER BY s.stop_id`, [o.order_id]);
  const listLabel = (await pricing.lists(db)).find((l) => l.key === o.price_list);
  const cs = await commerceSettings.read(db);
  const live = invs.find((i) => i.status === 'issued');
  const overdue = Boolean(live && o.status !== 'cancelled' && Number(o.amount_due) > 0.005 && live.due_on < pricing.istToday() && (o.payment_terms !== 'cod' || o.status === 'delivered'));
  return {
    ...o, items, history: hist, payments: pays, batches: batchesOut, invoices: invs.map((i) => ({ ...i, is_demo: Number(i.is_demo) === 1 })),
    approvals: appr.map((a) => ({ ...a, kind_label: (approvals.KINDS[a.kind] || {}).label || a.kind })), reserved: res,
    status_label: commerce.STATUS_LABEL[o.status], pay_label: commerce.PAYMENT_STATUS[o.payment_status], terms_label: commerce.TERMS[o.payment_terms],
    editable: commerce.EDITABLE[o.status] || null, overdue, due_on: live ? live.due_on : null,
    gst_label: o.gst_type === 'intra' ? `CGST + SGST (${stateName(o.place_of_supply)}, same state as the seller)` : `IGST (${stateName(o.place_of_supply)}, another state)`,
    bill_state: stateName(o.bill_state_code), ship_state: stateName(o.ship_state_code),
    price_list_label: listLabel ? listLabel.label : o.price_list, prices_basis: (await pricing.basis(db)).short,
    modes: commerce.modesOffered(cs), modeLabels: commerce.MODES, cancelNeedsApproval: commerce.GONE.includes(o.status) && Boolean(cs.approve_cancel_after_dispatch),
    delivery_method: dl.method, delivery_area: dl.area, courier: dl.courier, tracking_link: dl.tracking_url && o.awb_no ? dl.tracking_url.replace('{awb}', encodeURIComponent(o.awb_no)) : null,
    trips: trips.map((x) => ({ ...x, has_photo: Number(x.has_photo) === 1, cash_collected: Number(x.cash_collected) })), gone: Boolean(o.dispatched_at),
  };
});

route('post', '/commerce/orders', 'orders:create', async (req) => {
  try {
    return await tx((q) => commerce.createOrder(q, req.body, by(req), { canOverride: canDo(req, 'orders', 'approve') }));
  } catch (e) { throw asInput(e); }
});

route('put', '/commerce/orders/:no', 'orders:edit', async (req) => {
  try {
    return await tx((q) => commerce.updateOrder(q, req.params.no, req.body, by(req), { canOverride: canDo(req, 'orders', 'approve') }));
  } catch (e) { throw asInput(e); }
});

route('post', '/commerce/orders/:no/cancel', 'orders:edit', async (req) => {
  try {
    return await tx((q) => commerce.cancelOrder(q, req.params.no, req.body.reason, by(req)));
  } catch (e) { throw asInput(e); }
});

route('post', '/commerce/orders/:no/payments', 'orders:edit', async (req) => {
  try {
    return await tx((q) => commerce.recordPayment(q, req.params.no, req.body || {}, by(req)));
  } catch (e) { throw asInput(e); }
});

// ---------------------------------------------------------------------------------------------
// Packing and delivery (docs/COMMERCE-SPEC.md 5.3, 5.4; logic in delivery.js). Section "packing": view = queues, pick
// list, pack check, slips; edit = start packing, scan, mark packed; approve = pack without a full scan (with a reason).
// Section "delivery": create = plan trips, the Delivery screen (all trips); edit = start / mark stops / cash / end
// trips, courier hand-over, pickup, re-attempt, return to the godown; view = My trips. A driver (delivery edit without
// create) acts only on trips whose driver is linked to them (Commerce settings > Drivers).
// ---------------------------------------------------------------------------------------------
const delivery = require('./delivery');
const asDelivery = (e) => (e instanceof delivery.DeliveryError || e instanceof commerce.CommerceError ? new InputError(e.message, e.status) : e);
const office = (req) => canDo(req, 'delivery', 'create');
const ORDER_LIST = `SELECT o.order_no, o.status, o.delivery_kind, o.payment_terms, o.amount_due, o.total, o.cartons, o.weight_kg, o.created_at, o.packed_at, o.packing_at,
       o.ship_name, o.ship_address, o.ship_town, o.ship_pincode, o.ship_phone, o.delivery_area_id, o.awb_no, o.courier_id, o.failed_reason, o.failed_at, o.courier_at,
       c.name AS customer, a.label AS area, dm.label AS method, cr.name AS courier, cr.tracking_url,
       (SELECT SUM(qty) FROM order_items i WHERE i.order_id = o.order_id) AS units
  FROM orders o JOIN customers c ON c.customer_id = o.customer_id
  LEFT JOIN delivery_areas a ON a.area_id = o.delivery_area_id LEFT JOIN delivery_methods dm ON dm.method_id = o.delivery_method_id
  LEFT JOIN couriers cr ON cr.courier_id = o.courier_id`;
const trackLink = (r) => (r.tracking_url && r.awb_no ? r.tracking_url.replace('{awb}', encodeURIComponent(r.awb_no)) : null);
const orderOut = (r) => ({ ...r, amount_due: Number(r.amount_due), total: Number(r.total), units: Number(r.units), tracking_link: trackLink(r) });

route('get', '/commerce/packing', 'packing:view', async () => {
  const [rows] = await db.query(`${ORDER_LIST}
      WHERE o.status IN ('new', 'packing') OR (o.status = 'packed' AND o.packed_at > UTC_TIMESTAMP() - INTERVAL 3 DAY) ORDER BY o.order_id`);
  const [held] = await db.query("SELECT DISTINCT ref_id FROM approvals WHERE ref_type = 'order' AND status = 'pending' AND kind IN ('price_below_list', 'over_available', 'credit_order')");
  const waiting = new Set(held.map((h) => h.ref_id));
  return { rows: rows.map((r) => ({ ...orderOut(r), waiting: waiting.has(r.order_no) })) };
});
route('post', '/commerce/packing/picklist', 'packing:view', async (req) => {
  try { return await delivery.pickList(db, (req.body.order_nos || []).map(String)); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/packing/start', 'packing:edit', async (req) => {
  try { return await tx((q) => delivery.startPacking(q, (req.body.order_nos || []).map(String), by(req))); } catch (e) { throw asDelivery(e); }
});
route('get', '/commerce/packing/:no', 'packing:view', async (req) => {
  const [[o]] = await db.query(`${ORDER_LIST} WHERE o.order_no = ?`, [req.params.no]);
  if (!o) throw new InputError('Order not found', 404);
  const [[id]] = await db.query('SELECT order_id FROM orders WHERE order_no = ?', [req.params.no]);
  const [scans] = await db.query('SELECT scan_id, code, qty, result, message, emp_id, created_at FROM pack_scans WHERE order_id = ? ORDER BY scan_id DESC LIMIT 40', [id.order_id]);
  return { order: orderOut(o), ...(await delivery.packState(db, id.order_id)), scans, canOverride: canDo(req, 'packing', 'approve') };
});
route('post', '/commerce/packing/:no/scan', 'packing:edit', async (req) => {
  try { return await tx((q) => delivery.packScan(q, req.params.no, req.body.code, by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/packing/:no/reset', 'packing:edit', async (req) => {
  try { return await tx((q) => delivery.resetScans(q, req.params.no, by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/packing/:no/packed', 'packing:edit', async (req) => {
  try { return await tx((q) => delivery.markPacked(q, req.params.no, req.body || {}, by(req), canDo(req, 'packing', 'approve'))); } catch (e) { throw asDelivery(e); }
});
// packing slip and carton labels: the order, its addresses, lines (with the picked batches), cartons
route('get', '/commerce/packing/:no/slip', 'packing:view', async (req) => {
  const [[o]] = await db.query(`SELECT o.order_id, o.order_no, o.status, o.cartons, o.weight_kg, o.delivery_kind, o.payment_terms, o.amount_due, o.note, o.awb_no, o.created_at,
      o.ship_name, o.ship_address, o.ship_town, o.ship_state_code, o.ship_pincode, o.ship_phone, c.name AS customer, dm.label AS method, cr.name AS courier
      FROM orders o JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN delivery_methods dm ON dm.method_id = o.delivery_method_id LEFT JOIN couriers cr ON cr.courier_id = o.courier_id
      WHERE o.order_no = ?`, [req.params.no]);
  if (!o) throw new InputError('Order not found', 404);
  const st = await delivery.packState(db, o.order_id);
  const [site] = await db.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('office_phone')");
  return { ...o, amount_due: Number(o.amount_due), ship_state: stateName(o.ship_state_code), lines: st.lines, phone: (site[0] || {}).setting_value || '' };
});

// the Delivery screen (office): packed orders by kind, failed ones, couriers on the way, trips, setup lists
route('get', '/commerce/delivery', 'delivery:create', async () => {
  const [rows] = await db.query(`${ORDER_LIST} WHERE o.status IN ('packed', 'failed', 'with_courier') ORDER BY o.order_id`);
  const [onTrip] = await db.query("SELECT s.order_id, o.order_no, t.trip_id FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id JOIN orders o ON o.order_id = s.order_id WHERE t.status = 'planned'");
  const planned = new Map(onTrip.map((x) => [x.order_no, x.trip_id]));
  const [trips] = await db.query(`SELECT t.trip_id, DATE_FORMAT(t.trip_date, '%Y-%m-%d') AS trip_date, t.status, t.cash_expected, t.cash_collected, t.cash_handed, t.started_at, t.ended_at,
      v.number AS vehicle, d.name AS driver, a.label AS area,
      (SELECT COUNT(*) FROM trip_stops s WHERE s.trip_id = t.trip_id) AS stops, (SELECT SUM(s.status = 'delivered') FROM trip_stops s WHERE s.trip_id = t.trip_id) AS delivered,
      (SELECT SUM(s.status = 'failed') FROM trip_stops s WHERE s.trip_id = t.trip_id) AS failed
      FROM delivery_trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id JOIN drivers d ON d.driver_id = t.driver_id LEFT JOIN delivery_areas a ON a.area_id = t.area_id
      ORDER BY t.trip_id DESC LIMIT 60`);
  const [vehicles] = await db.query('SELECT vehicle_id, number, type FROM vehicles WHERE is_active = 1 ORDER BY sort_order, vehicle_id');
  const [drivers] = await db.query('SELECT driver_id, name, phone, emp_id FROM drivers WHERE is_active = 1 ORDER BY sort_order, driver_id');
  const [couriers] = await db.query('SELECT courier_id, name, tracking_url FROM couriers WHERE is_active = 1 ORDER BY sort_order, courier_id');
  const [areas] = await db.query('SELECT area_id, label FROM delivery_areas WHERE is_active = 1 ORDER BY sort_order, area_id');
  const cs = await commerceSettings.read(db);
  return {
    orders: rows.map((r) => ({ ...orderOut(r), trip_id: planned.get(r.order_no) || null })),
    trips: trips.map((t) => ({ ...t, stops: Number(t.stops), delivered: Number(t.delivered) || 0, failed: Number(t.failed) || 0 })),
    vehicles, drivers, couriers, areas, failReasons: delivery.FAIL_REASONS, eway: { required: Boolean(cs.eway_bill_required), above: Number(cs.eway_bill_above) },
  };
});
route('post', '/commerce/trips', 'delivery:create', async (req) => {
  try { return await tx((q) => delivery.createTrip(q, req.body || {}, by(req))); } catch (e) { throw asDelivery(e); }
}, { status: 201 });

/** a trip with its stops (an office user: any trip; a driver: only their own) */
async function tripDetail(req, tripId) {
  const [[t]] = await db.query(`SELECT t.trip_id, DATE_FORMAT(t.trip_date, '%Y-%m-%d') AS trip_date, t.status, t.cash_expected, t.cash_collected, t.cash_handed, t.end_note,
      t.started_at, t.started_by, t.ended_at, t.ended_by, t.created_by, v.number AS vehicle, v.type AS vehicle_type, d.name AS driver, d.phone AS driver_phone, d.emp_id AS driver_emp, a.label AS area
      FROM delivery_trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id JOIN drivers d ON d.driver_id = t.driver_id LEFT JOIN delivery_areas a ON a.area_id = t.area_id WHERE t.trip_id = ?`, [tripId]);
  if (!t) throw new InputError('Trip not found', 404);
  const isOffice = office(req);
  if (!isOffice && t.driver_emp !== by(req)) throw new InputError('This is not one of your trips', 403);
  const [stops] = await db.query(`SELECT s.stop_id, s.seq, s.status, s.otp, s.receiver_name, s.photo IS NOT NULL AS has_photo, s.failed_reason, s.cash_collected, s.done_at, s.done_by,
      o.order_no, o.status AS order_status, o.payment_terms, o.amount_due, o.total, o.cartons, o.weight_kg, o.ship_name, o.ship_address, o.ship_town, o.ship_pincode, o.ship_phone, c.name AS customer
      FROM trip_stops s JOIN orders o ON o.order_id = s.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE s.trip_id = ? ORDER BY s.seq`, [tripId]);
  const cs = await commerceSettings.read(db);
  return { ...t, office: isOffice, otpOn: Boolean(cs.delivery_otp), failReasons: delivery.FAIL_REASONS,
    stops: stops.map(({ otp, ...s }) => ({ ...s, has_photo: Number(s.has_photo) === 1, amount_due: Number(s.amount_due), total: Number(s.total), cash_collected: Number(s.cash_collected),
      to_collect: s.payment_terms === 'cod' ? Math.max(Number(s.amount_due), 0) : 0, ...(isOffice ? { otp } : {}) })) };
}
route('get', '/commerce/trips/:id', 'delivery:view', async (req) => tripDetail(req, Number(req.params.id)));
route('put', '/commerce/trips/:id/stops', 'delivery:create', async (req) => {
  try { return await tx((q) => delivery.setStops(q, Number(req.params.id), (req.body.order_nos || []).map(String), by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/trips/:id/start', 'delivery:edit', async (req) => {
  await tripDetail(req, Number(req.params.id)); // a driver only their own trip
  try { return await tx((q) => delivery.startTrip(q, Number(req.params.id), by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/trips/:id/end', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.endTrip(q, Number(req.params.id), req.body || {}, by(req), office(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/stops/:id/delivered', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.stopDelivered(q, Number(req.params.id), req.body || {}, req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : null, by(req), office(req))); } catch (e) { throw asDelivery(e); }
}, { before: [upload(8)] });
route('post', '/commerce/stops/:id/failed', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.stopFailed(q, Number(req.params.id), req.body || {}, by(req), office(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/stops/:id/cash', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.stopCash(q, Number(req.params.id), req.body || {}, by(req), office(req))); } catch (e) { throw asDelivery(e); }
});
route('get', '/commerce/stops/:id/photo', 'delivery:view', async (req, res) => {
  const [[s]] = await db.query('SELECT trip_id, photo, photo_type FROM trip_stops WHERE stop_id = ?', [Number(req.params.id)]);
  if (!s || !s.photo) throw new InputError('No photo', 404);
  await tripDetail(req, s.trip_id);
  res.set({ 'Content-Type': s.photo_type, 'Cache-Control': 'private, no-store' });
  res.send(s.photo);
});
// My trips (drivers): the trips of the driver linked to this admin user, open ones and today's ended ones
route('get', '/commerce/my-trips', 'delivery:view', async (req) => {
  const [rows] = await db.query(`SELECT t.trip_id, DATE_FORMAT(t.trip_date, '%Y-%m-%d') AS trip_date, t.status, v.number AS vehicle, d.name AS driver,
      (SELECT COUNT(*) FROM trip_stops s WHERE s.trip_id = t.trip_id) AS stops, (SELECT SUM(s.status <> 'pending') FROM trip_stops s WHERE s.trip_id = t.trip_id) AS done
      FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      WHERE d.emp_id = ? AND (t.status IN ('planned', 'out') OR t.ended_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) ORDER BY t.trip_id DESC`, [by(req)]);
  const [[me]] = await db.query('SELECT name FROM drivers WHERE emp_id = ? LIMIT 1', [by(req)]);
  return { driver: me ? me.name : null, trips: rows.map((r) => ({ ...r, stops: Number(r.stops), done: Number(r.done) || 0 })) };
});
// after a failed delivery; courier; customer pickup
route('post', '/commerce/orders/:no/reattempt', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.reattempt(q, req.params.no, by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/orders/:no/return-to-godown', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.returnToGodown(q, req.params.no, req.body.reason, by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/orders/:no/courier', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.handToCourier(q, req.params.no, req.body || {}, by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/orders/:no/courier-delivered', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.courierDelivered(q, req.params.no, req.body || {}, by(req))); } catch (e) { throw asDelivery(e); }
});
route('post', '/commerce/orders/:no/picked-up', 'delivery:edit', async (req) => {
  try { return await tx((q) => delivery.pickedUp(q, req.params.no, req.body || {}, by(req))); } catch (e) { throw asDelivery(e); }
});

// An invoice or a credit note for printing (PDF from the browser's print dialog): the snapshot, the order's lines.
route('get', '/commerce/invoices/:id', 'orders:view', async (req) => {
  const [[inv]] = await db.query(
    `SELECT i.invoice_id, i.invoice_no, i.fy, i.status, i.issued_at, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on, i.place_of_supply, i.gst_type, i.taxable, i.delivery_charge, i.delivery_gst, i.cgst, i.sgst, i.igst,
            i.round_off, i.total, i.seller_name, i.seller_gstin, i.seller_address, i.seller_state_code, i.buyer_json, i.is_demo, i.cancelled_at, i.cancel_reason,
            o.order_no, o.order_id, o.subtotal, o.discount, o.coupon_code, o.wallet_used, o.payment_terms
       FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_id = ?`, [Number(req.params.id)]
  );
  if (!inv) throw new InputError('Invoice not found', 404);
  const [lines] = await db.query(`SELECT i.sku_code, i.qty, i.price, i.hsn, i.gst_rate, i.taxable, i.cgst, i.sgst, i.igst, i.line_total, ${SKU_NAME} AS name, s.size_label
       FROM order_items i JOIN skus s ON s.sku_code = i.sku_code ${SKU_JOIN} WHERE i.order_id = ? ORDER BY i.sku_code`, [inv.order_id]);
  const [cns] = await db.query('SELECT credit_note_id, credit_note_no, reason, taxable, cgst, sgst, igst, round_off, total, issued_at FROM credit_notes WHERE invoice_id = ?', [inv.invoice_id]);
  const [site] = await db.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('cin', 'office_phone', 'public_email')");
  const s = Object.fromEntries(site.map((x) => [x.setting_key, x.setting_value]));
  const buyer = typeof inv.buyer_json === 'string' ? JSON.parse(inv.buyer_json) : inv.buyer_json;
  return { ...inv, buyer_json: undefined, buyer, lines, credit_notes: cns, is_demo: Number(inv.is_demo) === 1, seller_state: stateName(inv.seller_state_code),
    pos_state: stateName(inv.place_of_supply), bill_state: stateName(buyer.bill.state_code), ship_state: stateName(buyer.ship.state_code), cin: s.cin, phone: s.office_phone, email: s.public_email };
});

// Returns (database/demo/commerce-demo-schema.sql)
route('post', '/commerce/orders/:no/returns', 'returns:create', async (req) => {
  try {
    return await tx(async (q) => {
      const r = await commerce.createReturn(q, req.params.no, req.body, by(req));
      await audit(q, { empId: by(req), action: 'create', entity: 'return', entityId: r.return_no, after: { order: req.params.no, amount: r.amount, outcome: r.outcome } });
      return r;
    });
  } catch (e) { throw asInput(e); }
});

route('get', '/commerce/returns', 'returns:view', async (req) => {
  const order = typeof req.query.order === 'string' && req.query.order ? req.query.order : null;
  const [rows] = await db.query(
    `SELECT r.return_no, r.reason, r.outcome, r.amount, r.created_at, r.emp_id, o.order_no, c.name AS customer, ro.order_no AS replacement_no,
            GROUP_CONCAT(CONCAT(ri.qty, ' x ', ri.sku_code, IF(ri.item_check = 'ok', ' (R)', ' damaged')) ORDER BY ri.sku_code SEPARATOR ', ') AS items
       FROM returns r JOIN orders o ON o.order_id = r.order_id JOIN customers c ON c.customer_id = o.customer_id
       LEFT JOIN orders ro ON ro.order_id = r.replacement_order_id
       LEFT JOIN return_items ri ON ri.return_id = r.return_id
      ${order ? 'WHERE o.order_no = ?' : ''}
      GROUP BY r.return_id ORDER BY r.return_id DESC`, order ? [order] : []
  );
  return rows.map((r) => ({ ...r, outcome_label: commerce.OUTCOMES[r.outcome] }));
});

// Customers (CRM, tables in database/demo/commerce-demo-schema.sql)
const CTYPES = ['Home', 'Hotel', 'Hospital', 'Office', 'Distributor'];
const CUSTOMER_FIELDS = ['name', 'business_name', 'phone', 'email', 'ctype', 'town', 'state_code', 'pincode', 'address', 'gstin', 'source', 'notes', 'follow_up'];
const customerRules = require('../shared/customerRules');

// New customer typed in the admin (phone / WhatsApp / walk-in). Same rules as the drawer; a phone (last 10 digits)
// or e-mail that is already a customer answers 409 code 'duplicate' with that customer, nothing saved.
route('post', '/commerce/customers', 'customers:create', async (req) => {
  const { values: v, errors } = customerRules.checkCustomer(req.body || {});
  if (Object.keys(errors).length) {
    const err = new InputError(Object.values(errors)[0]);
    err.code = 'fields';
    err.fields = errors;
    throw err;
  }
  const [[dup]] = await db.query(
    `SELECT customer_id, name FROM customers
      WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = ? OR (? IS NOT NULL AND LOWER(email) = LOWER(?)) LIMIT 1`,
    [customerRules.phoneDigits(v.phone), v.email, v.email]
  );
  if (dup) {
    const err = new InputError(`Already a customer: ${dup.name}`, 409);
    err.code = 'duplicate';
    err.fields = { customer_id: dup.customer_id, name: dup.name };
    throw err;
  }
  // credit terms start from the customer type's defaults (Commerce settings > Customer types)
  const [[ct]] = await db.query('SELECT default_credit_days, default_credit_limit FROM customer_types WHERE type_key = LOWER(?) OR label = ? LIMIT 1', [v.ctype, v.ctype]);
  const [ins] = await db.query(
    `INSERT INTO customers (name, business_name, phone, email, ctype, town, state_code, pincode, address, gstin, credit_days, credit_limit, source, notes, follow_up)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.name, v.business_name, v.phone, v.email, v.ctype, v.town, v.state_code, v.pincode, v.address, v.gstin, ct ? ct.default_credit_days : 0, ct ? ct.default_credit_limit : 0, v.source, v.notes, v.follow_up]
  );
  await audit(null, { empId: by(req), action: 'create', entity: 'customer', entityId: String(ins.insertId), after: { name: v.name, source: v.source, state: v.state_code } });
  return { customer_id: ins.insertId, name: v.name, ctype: v.ctype, phone: v.phone, wallet: 0, town: v.town };
});

route('get', '/commerce/customers', 'customers:view', async () => {
  const [rows] = await db.query(
    `SELECT c.customer_id, c.name, c.phone, c.ctype, c.town, c.follow_up, c.lead_id,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) AS orders,
            (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled') AS spent,
            (SELECT COALESCE(SUM(o.amount_due), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled' AND o.amount_due > 0) AS outstanding,
            (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = c.customer_id AND ${commerce.OVERDUE_SQL}) AS overdue,
            (SELECT COALESCE(SUM(w.amount), 0) FROM wallet_entries w WHERE w.customer_id = c.customer_id) AS wallet,
            (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.customer_id) AS last_order,
            c.follow_up IS NOT NULL AND c.follow_up <= DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) AS follow_due
       FROM customers c ORDER BY c.name`
  );
  return rows.map((r) => ({ ...r, orders: Number(r.orders), spent: Number(r.spent), wallet: Number(r.wallet), outstanding: Number(r.outstanding), overdue: Number(r.overdue), follow_due: Number(r.follow_due) === 1 }));
});

route('get', '/commerce/customers/:id', 'customers:view', async (req) => {
  const [[c]] = await db.query(`SELECT customer_id, name, business_name, phone, email, ctype, town, state_code, pincode, address, gstin, credit_days, credit_limit, source, notes,
      DATE_FORMAT(follow_up, '%Y-%m-%d') AS follow_up, lead_id, created_at FROM customers WHERE customer_id = ?`, [Number(req.params.id)]);
  if (!c) throw new InputError('Customer not found', 404);
  const [orders] = await db.query(`SELECT o.order_no, o.status, o.total, o.amount_due, o.payment_status, o.created_at, i.invoice_no, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on,
      (i.invoice_id IS NOT NULL AND ${commerce.OVERDUE_SQL}) AS overdue
      FROM orders o LEFT JOIN invoices i ON i.live_order_id = o.order_id WHERE o.customer_id = ? ORDER BY o.order_id DESC`, [c.customer_id]);
  const [[pendingCredit]] = await db.query("SELECT approval_id, summary FROM approvals WHERE kind = 'credit_raise' AND ref_type = 'customer' AND ref_id = ? AND status = 'pending' LIMIT 1", [String(c.customer_id)]);
  const [wallet] = await db.query(`SELECT w.entry_id, w.amount, w.reason, w.created_at, w.emp_id, o.order_no
      FROM wallet_entries w LEFT JOIN orders o ON o.order_id = w.order_id WHERE w.customer_id = ? ORDER BY w.entry_id DESC`, [c.customer_id]);
  let lead = null;
  if (c.lead_id) [[lead]] = await db.query('SELECT lead_ref, form_type, created_at FROM leads WHERE lead_id = ?', [c.lead_id]);
  return { ...c, credit_limit: Number(c.credit_limit), orders: orders.map((o) => ({ ...o, overdue: Number(o.overdue) === 1 })), wallet, balance: wallet.reduce((a, w) => a + Number(w.amount), 0),
    outstanding: orders.filter((o) => o.status !== 'cancelled' && Number(o.amount_due) > 0).reduce((a, o) => a + Number(o.amount_due), 0),
    pendingCredit: pendingCredit || null, lead: lead || null, ctypes: CTYPES, states: GST_STATES };
});

function customerValues(body) {
  const v = {};
  for (const f of CUSTOMER_FIELDS) {
    if (!(f in body)) continue;
    const x = typeof body[f] === 'string' ? body[f].trim() : body[f];
    v[f] = x === '' || x === undefined ? null : x;
  }
  if ('name' in v && !v.name) throw new InputError('Name is required');
  if ('phone' in v && !/^[0-9+ ]{8,20}$/.test(v.phone || '')) throw new InputError('Phone: 8 to 20 digits');
  if ('ctype' in v && !CTYPES.includes(v.ctype)) throw new InputError(`Type: ${CTYPES.join(', ')}`);
  if (v.follow_up && !/^\d{4}-\d{2}-\d{2}$/.test(v.follow_up)) throw new InputError('Follow-up: a date');
  if ('state_code' in v && !GST_STATES.some(([code]) => code === v.state_code)) throw new InputError('State: choose one');
  if (v.pincode && !/^[1-9]\d{5}$/.test(v.pincode)) throw new InputError('PIN code: 6 digits');
  return v;
}

// Credit terms of a customer: days apply at once; a higher limit waits for approval (Commerce setting), a lower one
// applies at once. Audited.
async function applyCredit(q, customerId, days, limit, empId) {
  const [[before]] = await q.query('SELECT credit_days, credit_limit FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);
  await q.query('UPDATE customers SET credit_days = ?, credit_limit = ? WHERE customer_id = ?', [days, limit, customerId]);
  await audit(q, { empId, action: 'credit_change', entity: 'customer', entityId: String(customerId), before: { credit_days: before.credit_days, credit_limit: Number(before.credit_limit) }, after: { credit_days: days, credit_limit: limit } });
}
approvals.onApproved('credit_raise', async (q, p, empId) => { await applyCredit(q, p.customer_id, p.credit_days, p.credit_limit, empId); });
route('put', '/commerce/customers/:id/credit', 'customers:edit', async (req) => {
  const days = Number(req.body.credit_days);
  const limit = Number(req.body.credit_limit);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new InputError('Credit days: 0 to 365');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(req.body.credit_limit ?? '').trim())) throw new InputError('Credit limit: Rs, 0 or more');
  return tx(async (q) => {
    const [[c]] = await q.query('SELECT customer_id, name, credit_days, credit_limit FROM customers WHERE customer_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!c) throw new InputError('Customer not found', 404);
    if (limit > Number(c.credit_limit) && await approvals.needed(q, 'credit_raise')) {
      const [[had]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'credit_raise' AND ref_type = 'customer' AND ref_id = ? AND status = 'pending'", [String(c.customer_id)]);
      if (had) throw new InputError(`A credit change for ${c.name} already waits for approval (#${had.approval_id})`, 409);
      const id = await approvals.request(q, { kind: 'credit_raise', refType: 'customer', refId: String(c.customer_id),
        summary: `${c.name}: credit limit Rs ${Number(c.credit_limit)} -> Rs ${limit}, ${c.credit_days} -> ${days} days`, amount: limit,
        payload: { customer_id: c.customer_id, credit_days: days, credit_limit: limit } }, by(req));
      return { pending: true, approval_id: id };
    }
    await applyCredit(q, c.customer_id, days, limit, by(req));
    return { pending: false, credit_days: days, credit_limit: limit };
  });
});

route('put', '/commerce/customers/:id', 'customers:edit', async (req) => {
  const v = customerValues(req.body);
  if (!Object.keys(v).length) throw new InputError('Nothing to change');
  const [r] = await db.query(`UPDATE customers SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE customer_id = ?`, [...Object.values(v), Number(req.params.id)]);
  if (!r.affectedRows) throw new InputError('Customer not found', 404);
  await audit(null, { empId: by(req), action: 'update', entity: 'customer', entityId: String(req.params.id), after: v });
  return { customer_id: Number(req.params.id) };
});

// A lead becomes a customer (once): name, phone, e-mail, town; type from the form and business type.
route('post', '/commerce/customers/from-lead/:leadId', 'customers:create', async (req) => {
  const [[l]] = await db.query('SELECT lead_id, lead_ref, form_type, full_name, business_name, business_type, town, phone, email FROM leads WHERE lead_id = ?', [Number(req.params.leadId)]);
  if (!l) throw new InputError('Lead not found', 404);
  const [[had]] = await db.query('SELECT customer_id, name FROM customers WHERE lead_id = ?', [l.lead_id]);
  if (had) return { customer_id: had.customer_id, name: had.name, existed: true };
  const bt = `${l.business_type || ''} ${l.business_name || ''}`.toLowerCase();
  const ctype = l.form_type === 'distributor' ? 'Distributor'
    : /hotel|restaurant|cafe|caterer|lodge|resort|food/.test(bt) ? 'Hotel'
      : /hospital|clinic|health|medical/.test(bt) ? 'Hospital'
        : /office|corporate|school|college|bank|it/.test(bt) ? 'Office' : 'Home';
  const name = l.business_name || l.full_name || l.lead_ref;
  const [ins] = await db.query('INSERT INTO customers (name, phone, email, ctype, town, notes, lead_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, `+91 ${l.phone}`, l.email, ctype, l.town, `From lead ${l.lead_ref}${l.full_name && l.business_name ? ` (contact: ${l.full_name})` : ''}`, l.lead_id]);
  await audit(null, { empId: by(req), action: 'create', entity: 'customer', entityId: String(ins.insertId), after: { from_lead: l.lead_ref, ctype } });
  return { customer_id: ins.insertId, name, ctype, existed: false };
});

// Promotions (coupons: database/demo/commerce-demo-schema.sql, cashback rule: database/demo/commerce-demo-schema.sql)
route('get', '/commerce/promotions', 'promotions:view', async () => {
  const [coupons] = await db.query(`SELECT code, kind, value, min_order, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on, usage_limit, used, is_active,
      expires_on IS NOT NULL AND expires_on < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) AS expired FROM coupons ORDER BY code`);
  const [[rule]] = await db.query('SELECT pct, min_order, is_active FROM cashback_rule WHERE rule_id = 1');
  const [[given]] = await db.query("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM wallet_entries WHERE reason LIKE 'Cashback%'");
  return { coupons: coupons.map((c) => ({ ...c, expired: Number(c.expired) === 1 })), cashback: rule, cashbackGiven: { total: Number(given.total), n: Number(given.n) } };
});

function couponValues(b) {
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new InputError('Code: 3 to 20 letters or digits');
  if (!['percent', 'fixed'].includes(b.kind)) throw new InputError('Type: percent or fixed');
  const value = Number(b.value);
  if (!(value > 0) || (b.kind === 'percent' && value > 90)) throw new InputError(b.kind === 'percent' ? 'Percent: 1 to 90' : 'Amount: above 0');
  const minOrder = Number(b.min_order) || 0;
  const limit = b.usage_limit === '' || b.usage_limit === null || b.usage_limit === undefined ? null : Number(b.usage_limit);
  if (limit !== null && !(Number.isInteger(limit) && limit > 0)) throw new InputError('Usage limit: a whole number, or empty for no limit');
  const exp = b.expires_on ? String(b.expires_on) : null;
  if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) throw new InputError('Expiry: a date');
  return { code, kind: b.kind, value, min_order: minOrder, expires_on: exp, usage_limit: limit, is_active: b.is_active === false || b.is_active === 0 ? 0 : 1 };
}

route('post', '/commerce/coupons', 'promotions:create', async (req) => {
  const v = couponValues(req.body);
  const [[had]] = await db.query('SELECT code FROM coupons WHERE code = ?', [v.code]);
  if (had) throw new InputError(`Coupon ${v.code} exists already`, 409);
  await db.query('INSERT INTO coupons (code, kind, value, min_order, expires_on, usage_limit, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [v.code, v.kind, v.value, v.min_order, v.expires_on, v.usage_limit, v.is_active]);
  await audit(null, { empId: by(req), action: 'create', entity: 'coupon', entityId: v.code, after: v });
  return v;
});

route('put', '/commerce/coupons/:code', 'promotions:edit', async (req) => {
  const v = couponValues({ ...req.body, code: req.params.code });
  const [r] = await db.query('UPDATE coupons SET kind = ?, value = ?, min_order = ?, expires_on = ?, usage_limit = ?, is_active = ? WHERE code = ?',
    [v.kind, v.value, v.min_order, v.expires_on, v.usage_limit, v.is_active, v.code]);
  if (!r.affectedRows) throw new InputError('No such coupon', 404);
  await audit(null, { empId: by(req), action: 'update', entity: 'coupon', entityId: v.code, after: v });
  return v;
});

route('put', '/commerce/cashback', 'promotions:edit', async (req) => {
  const pct = Number(req.body.pct);
  const minOrder = Number(req.body.min_order) || 0;
  if (!(pct >= 0 && pct <= 50)) throw new InputError('Cashback: 0 to 50 %');
  await db.query('UPDATE cashback_rule SET pct = ?, min_order = ?, is_active = ? WHERE rule_id = 1', [pct, minOrder, req.body.is_active ? 1 : 0]);
  await audit(null, { empId: by(req), action: 'update', entity: 'cashback', entityId: '1', after: { pct, minOrder, is_active: Boolean(req.body.is_active) } });
  return { pct, min_order: minOrder, is_active: req.body.is_active ? 1 : 0 };
});

// Operations dashboard (commerce): today in India time
// Open to every commerce user; each figure only for a role that can view its section (null otherwise).
route('get', '/commerce/ops', 'any', async (req) => {
  const can = { orders: canDo(req, 'orders'), pack: canDo(req, 'orders') || canDo(req, 'packing'), dispatch: canDo(req, 'orders') || canDo(req, 'delivery'),
    stock: canDo(req, 'inventory'), returns: canDo(req, 'returns'), wallet: canDo(req, 'customers') };
  const [[today]] = await db.query(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS value FROM orders WHERE created_at >= ${IST_TODAY_UTC} AND status NOT IN ('cancelled', 'approval')`);
  const [[st]] = await db.query("SELECT SUM(status = 'new') AS to_pack, SUM(status = 'packed') AS to_dispatch FROM orders");
  const [[ret]] = await db.query(`SELECT COUNT(*) AS n FROM returns r LEFT JOIN orders ro ON ro.order_id = r.replacement_order_id
      WHERE r.outcome = 'replacement' AND (ro.status IS NULL OR ro.status <> 'delivered')`);
  const [[w]] = await db.query(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS total,
      COALESCE(SUM(CASE WHEN amount > 0 AND reason LIKE 'Cashback%' THEN amount END), 0) AS cashback,
      COALESCE(SUM(CASE WHEN amount > 0 AND reason LIKE 'Refund%' THEN amount END), 0) AS refunds FROM wallet_entries`);
  const low = can.stock ? await stock.reorderList(db) : [];
  const dc = await delivery.opsCounts(db);
  const seePack = canDo(req, 'packing') || canDo(req, 'orders');
  const seeDeliver = canDo(req, 'delivery') || canDo(req, 'orders');
  const exp = can.stock ? (await stock.batchList(db)).rows.filter((b) => b.good > 0 && b.state !== 'ok') : [];
  const [next] = await db.query("SELECT o.order_no, o.created_at, c.name AS customer FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.status = 'new' ORDER BY o.order_id LIMIT 5");
  return {
    today: can.orders ? { n: Number(today.n), value: Number(today.value) } : null,
    toPack: can.pack ? Number(st.to_pack) || 0 : null, toDispatch: can.dispatch ? Number(st.to_dispatch) || 0 : null,
    openReturns: can.returns ? Number(ret.n) : null,
    walletGiven: can.wallet ? { total: Number(w.total), cashback: Number(w.cashback), refunds: Number(w.refunds) } : null,
    lowStock: can.stock ? low.map((r) => ({ sku_code: r.sku_code, name: r.name, available: r.available, reorder_level: r.reorder_level, suggested: r.suggested })) : null,
    expiry: can.stock ? { expired: exp.filter((b) => b.state === 'expired').length, near: exp.filter((b) => b.state === 'near').length } : null,
    nextToPack: can.pack ? next : null,
    packing: seePack ? { toPick: dc.toPick, toPack: dc.toPack } : null,
    delivery: seeDeliver ? { waitingTrip: dc.waitingTrip, waitingOther: dc.waitingOther, outNow: dc.outNow, withCourier: dc.withCourier, failed: dc.failed, codDue: dc.codDue, cashOnTrips: dc.cashOnTrips } : null,
  };
});

// ---------------------------------------------------------------------------------------------
// Products and prices (docs/COMMERCE-SPEC.md 4.3; logic in pricing.js, Excel in price-excel.js). Section "products":
// view = the grid, history; edit = prices, SKU fields, product HSN / GST, bulk change, Excel. Commerce must be on.
// ---------------------------------------------------------------------------------------------
const asPrice = (e) => {
  if (!(e instanceof pricing.PricingError)) return e;
  const err = new InputError(e.message, e.status);
  if (e.errors) { err.code = 'fields'; err.fields = e.errors; }
  return err;
};
const COMMERCE_ONLY = { before: [commerceGate] };
const effectiveOf = (v) => {
  const d = v ? String(v) : pricing.istToday();
  if (!pricing.isDate(d)) throw new InputError('Effective from: a date like 2026-11-01');
  if (d < pricing.istToday()) throw new InputError(`Effective from: today (${pricing.istToday()}) or later`);
  return d;
};

route('get', '/prices', 'products:view', async () => {
  const today = pricing.istToday();
  const rows = await pricing.skuRows(db);
  const own = await pricing.ownPricesOn(db, today);
  const next = await pricing.upcoming(db, today);
  const [cats] = await db.query(
    `SELECT c.category_key, COALESCE(t.name, c.category_key) AS label FROM categories c
       LEFT JOIN category_translations t ON t.category_key = c.category_key AND t.lang_code = 'en' ORDER BY c.sort_order`
  );
  const [[demo]] = await db.query("SELECT COUNT(*) AS n FROM price_changes WHERE source = 'seed'");
  return {
    today, basis: await pricing.basis(db), lists: await pricing.lists(db), gstRates: pricing.gstRates(await commerceSettings.read(db)),
    sellUnits: pricing.SELL_UNITS, categories: cats, demo: Number(demo.n) > 0,
    rows: rows.map((r) => ({ ...r, own: own.get(r.sku_code) || {}, upcoming: next.get(r.sku_code) || [] })),
  };
}, COMMERCE_ONLY);

route('put', '/prices', 'products:edit', async (req) => {
  try {
    return await tx(async (q) => {
      const r = await pricing.setPrices(q, req.body.changes, { effective: effectiveOf(req.body.effective_from), source: 'grid', empId: by(req) });
      return { changed: r.changed.length, skipped: r.skipped, effective_from: req.body.effective_from || pricing.istToday() };
    });
  } catch (e) { throw asPrice(e); }
}, COMMERCE_ONLY);

route('get', '/prices/history/:sku', 'products:view', async (req) => {
  const [rows] = await db.query(
    `SELECT c.change_id, c.list_key, c.old_price, c.new_price, c.effective_from, c.source, c.emp_id, c.changed_at,
            TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS emp_name
       FROM price_changes c LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = c.emp_id
      WHERE c.sku_code = ? ORDER BY c.change_id DESC LIMIT 200`, [String(req.params.sku)]
  );
  return rows.map((r) => ({ ...r, effective_from: pricing.ymd(r.effective_from), old_price: r.old_price === null ? null : Number(r.old_price), new_price: r.new_price === null ? null : Number(r.new_price) }));
}, COMMERCE_ONLY);

route('put', '/prices/skus/:sku', 'products:edit', async (req) => {
  const { values, errors } = pricing.checkSkuFields(req.body || {});
  if (Object.keys(errors).length) { const err = new InputError(Object.values(errors)[0]); err.code = 'fields'; err.fields = errors; throw err; }
  if (!Object.keys(values).length) throw new InputError('Nothing to change');
  try {
    return await tx(async (q) => ({ changed: await pricing.updateSku(q, String(req.params.sku), values, by(req)) }));
  } catch (e) { throw asPrice(e); }
}, COMMERCE_ONLY);

route('put', '/prices/products/:id', 'products:edit', async (req) => {
  const { values, errors } = pricing.checkTax(req.body || {}, pricing.gstRates(await commerceSettings.read(db)));
  if (Object.keys(errors).length) { const err = new InputError(Object.values(errors)[0]); err.code = 'fields'; err.fields = errors; throw err; }
  if (!Object.keys(values).length) throw new InputError('Nothing to change');
  try {
    return await tx(async (q) => ({ changed: await pricing.updateProductTax(q, String(req.params.id), values, by(req)) }));
  } catch (e) { throw asPrice(e); }
}, COMMERCE_ONLY);

// Bulk change: preview = the exact rows that would change (and their fingerprint); save sends the fingerprint back and
// is refused when the prices moved since the preview (someone else saved meanwhile).
const bulkPrint = (rows) => crypto.createHash('sha256').update(rows.map((r) => `${r.sku_code}/${r.list_key}:${r.old_price}>${r.new_price}`).join('|')).digest('hex');
route('post', '/prices/bulk', 'products:edit', async (req) => {
  try {
    if (req.body.preview) {
      const plan = await pricing.bulkPlan(db, req.body);
      return { preview: true, ...plan, fingerprint: bulkPrint(plan.rows) };
    }
    return await tx(async (q) => {
      const plan = await pricing.bulkPlan(q, req.body);
      if (!plan.rows.length) throw new InputError('Nothing would change');
      if (req.body.fingerprint !== bulkPrint(plan.rows)) throw new InputError('Prices changed since the preview: preview again', 409);
      const r = await pricing.setPrices(q, plan.rows.map((x) => ({ sku_code: x.sku_code, list_key: x.list_key, price: x.new_price })), { effective: plan.effective, source: 'bulk', empId: by(req) });
      await audit(q, { empId: by(req), action: 'bulk', entity: 'sku_price', entityId: String(req.body.list_key), after: { category: req.body.category_key || 'all', mode: req.body.mode, value: req.body.value, rounding: req.body.rounding, effective_from: plan.effective, prices: r.changed.length } });
      return { preview: false, changed: r.changed.length, effective: plan.effective };
    });
  } catch (e) { throw asPrice(e); }
}, COMMERCE_ONLY);

route('get', '/prices/export.xlsx', 'products:edit', async (req, res) => {
  const wb = await priceExcel.buildWorkbook(db, { who: await exportedBy(req) });
  const bytes = await theme.send(res, wb, `dFresh_Price_List_${theme.istStamp(new Date(), false)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'sku_price', after: { file: 'prices.xlsx', bytes } });
}, COMMERCE_ONLY);

// Import: dry run first (fingerprint of the file and the effective date), Apply only with that fingerprint; checked
// again inside the transaction.
route('post', '/prices/import', 'products:edit', async (req) => {
  if (!req.file) throw new InputError('Choose the .xlsx file');
  const dryRun = req.query.dryRun !== '0';
  const effective = effectiveOf(req.query.effective);
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).update(`|${effective}`).digest('hex');
  try {
    if (dryRun) {
      const { plan, ...report } = await priceExcel.diffWorkbook(db, req.file.buffer, effective);
      return { dryRun: true, fileHash, ...report };
    }
    if (req.query.hash !== fileHash) throw new InputError('This file (or its effective date) is not the one that passed the dry run. Run the dry run again.');
    return await tx(async (q) => {
      const { plan, ...report } = await priceExcel.diffWorkbook(q, req.file.buffer, effective);
      if (!report.ok) throw new InputError(`Fix the ${report.errors.length} error(s) first (run the dry run again): ${report.errors.slice(0, 3).join(' | ')}`);
      const applied = await priceExcel.applyPlan(q, plan, { effective, empId: by(req) });
      await audit(q, { empId: by(req), action: 'import', entity: 'sku_price', after: { effective_from: effective, ...report.summary, applied } });
      return { dryRun: false, applied, fileHash, ...report };
    });
  } catch (e) { throw asPrice(e); }
}, { before: [commerceGate, upload(5)] });

// ---------------------------------------------------------------------------------------------
// Roles and permissions (docs/COMMERCE-SPEC.md 1; migration 20261020_commerce_access.sql)
// ---------------------------------------------------------------------------------------------
/** a permission grid from the admin -> clean { section: { action: bool } } (create / edit / approve / delete imply view) */
function cleanGrid(raw) {
  const out = {};
  for (const sec of permissions.SECTION_KEYS) {
    const r = (raw && raw[sec]) || {};
    const row = Object.fromEntries(permissions.ACTIONS.map((a) => [a, Boolean(r[a]) && (!permissions.VIEW_ONLY.includes(sec) || a === 'view')]));
    if (permissions.ACTIONS.slice(1).some((a) => row[a])) row.view = true;
    out[sec] = row;
  }
  return out;
}
async function roleGrid(q, role) {
  if (permissions.BUILTIN[role.role_id]) return permissions.permsFor(role.role_id);
  const [rows] = await q.query('SELECT section, can_view, can_create, can_edit, can_approve, can_delete FROM role_permissions WHERE role_id = ?', [role.role_id]);
  return permissions.permsFor(role.role_id, rows);
}
async function saveGrid(q, roleId, grid) {
  await q.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  for (const [sec, g] of Object.entries(grid)) {
    if (!permissions.ACTIONS.some((a) => g[a])) continue;
    await q.query('INSERT INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_delete) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [roleId, sec, ...permissions.ACTIONS.map((a) => (g[a] ? 1 : 0))]);
  }
}
const roleName = (v) => {
  const n = String(v || '').trim();
  if (n.length < 2 || n.length > 60) throw new InputError('Name: 2 to 60 characters');
  return n;
};

route('get', '/roles', 'users:view', async () => {
  const [roles] = await db.query(`SELECT r.role_id, r.name, r.description, r.is_builtin, r.updated_by, r.updated_at,
      (SELECT COUNT(*) FROM admin_users a WHERE a.role_id = r.role_id AND a.is_active = 1) AS users
      FROM roles r ORDER BY r.is_builtin DESC, r.role_id`);
  const out = [];
  for (const r of roles) out.push({ ...r, is_builtin: Number(r.is_builtin) === 1, users: Number(r.users), perms: await roleGrid(db, r) });
  return { roles: out, sections: permissions.SECTIONS, actions: permissions.ACTIONS, viewOnly: permissions.VIEW_ONLY };
});

route('post', '/roles', 'users:create', async (req) => tx(async (q) => {
  const name = roleName(req.body.name);
  const [[dup]] = await q.query('SELECT role_id FROM roles WHERE name = ?', [name]);
  if (dup) throw new InputError(`A role called ${name} exists already`, 409);
  const grid = cleanGrid(req.body.perms);
  const [ins] = await q.query('INSERT INTO roles (name, description, is_builtin, created_by) VALUES (?, ?, 0, ?)', [name, String(req.body.description || '').trim().slice(0, 255) || null, by(req)]);
  await saveGrid(q, ins.insertId, grid);
  await audit(q, { empId: by(req), action: 'create', entity: 'role', entityId: String(ins.insertId), after: { name, perms: grid } });
  return { role_id: ins.insertId, name };
}), { status: 201 });

route('put', '/roles/:id', 'users:edit', async (req) => tx(async (q) => {
  const [[role]] = await q.query('SELECT role_id, name, description, is_builtin FROM roles WHERE role_id = ? FOR UPDATE', [Number(req.params.id)]);
  if (!role) throw new InputError('No such role', 404);
  if (Number(role.is_builtin)) throw new InputError(`${role.name} is built in and cannot be changed`, 409);
  const name = 'name' in req.body ? roleName(req.body.name) : role.name;
  const [[dup]] = await q.query('SELECT role_id FROM roles WHERE name = ? AND role_id <> ?', [name, role.role_id]);
  if (dup) throw new InputError(`A role called ${name} exists already`, 409);
  const beforeGrid = await roleGrid(q, role);
  const grid = 'perms' in req.body ? cleanGrid(req.body.perms) : beforeGrid;
  const description = 'description' in req.body ? String(req.body.description || '').trim().slice(0, 255) || null : role.description;
  await q.query('UPDATE roles SET name = ?, description = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE role_id = ?', [name, description, by(req), role.role_id]);
  await saveGrid(q, role.role_id, grid);
  await audit(q, { empId: by(req), action: 'update', entity: 'role', entityId: String(role.role_id), before: { name: role.name, description: role.description, perms: beforeGrid }, after: { name, description, perms: grid } });
  return { role_id: role.role_id, name };
}));

route('delete', '/roles/:id', 'users:delete', async (req) => tx(async (q) => {
  const [[role]] = await q.query('SELECT role_id, name, is_builtin FROM roles WHERE role_id = ? FOR UPDATE', [Number(req.params.id)]);
  if (!role) throw new InputError('No such role', 404);
  if (Number(role.is_builtin)) throw new InputError(`${role.name} is built in and cannot be deleted`, 409);
  const [[used]] = await q.query('SELECT COUNT(*) AS n FROM admin_users WHERE role_id = ?', [role.role_id]);
  if (Number(used.n)) throw new InputError(`${used.n} admin user(s) have ${role.name}: give them another role first`, 409);
  const grid = await roleGrid(q, role);
  await q.query('DELETE FROM roles WHERE role_id = ?', [role.role_id]);
  await audit(q, { empId: by(req), action: 'delete', entity: 'role', entityId: String(role.role_id), before: { name: role.name, perms: grid } });
  return null;
}));

// ---------------------------------------------------------------------------------------------
// Approvals (docs/COMMERCE-SPEC.md 2; logic in approvals.js). Open to every signed-in user: the queue only lists what
// the user may see, and approvals.decide checks approver role, "approve" on the section and "not your own request".
// ---------------------------------------------------------------------------------------------
const asApproval = (e) => (e instanceof approvals.ApprovalError ? new InputError(e.message, e.status) : e);
route('get', '/approvals', 'any', async (req) => {
  const status = ['pending', 'decided', 'mine'].includes(req.query.status) ? req.query.status : 'pending';
  return { rows: await approvals.list(req.admin, status), kinds: approvals.KINDS };
});
route('post', '/approvals/:id/decide', 'any', async (req) => {
  try { return await tx((q) => approvals.decide(q, Number(req.params.id), req.body.decision, req.body.note, req.admin)); } catch (e) { throw asApproval(e); }
});
route('post', '/approvals/:id/withdraw', 'any', async (req) => {
  try { return await tx((q) => approvals.withdraw(q, Number(req.params.id), req.admin)); } catch (e) { throw asApproval(e); }
});

// ---------------------------------------------------------------------------------------------
// Commerce settings (docs/COMMERCE-SPEC.md 3; commerce-settings.js). Settings section, not behind commerce_enabled
// (the on / off switch lives here).
// ---------------------------------------------------------------------------------------------
function financialYear(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  const y = Number(p.year);
  const start = Number(p.month) >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
route('get', '/commerce-settings', 'settings:view', async () => {
  const [rows] = await db.query('SELECT setting_key, grp, label, help, value, value_type, options, tbc, sort_order, updated_by, updated_at FROM commerce_settings ORDER BY sort_order, setting_key');
  const lists = {};
  for (const [key, l] of Object.entries(commerceSettings.LISTS)) {
    const [r] = await db.query(`SELECT ${[l.pk, ...Object.keys(l.cols).filter((c) => c !== l.pk)].join(', ')} FROM ${l.table} ORDER BY sort_order, ${l.pk}`);
    lists[key] = { label: l.label, pk: l.pk, auto: l.auto, cols: l.cols, rows: r };
  }
  const [roles] = await db.query('SELECT role_id, name FROM roles ORDER BY role_id');
  const cs = await commerceSettings.read(db);
  const fy = financialYear();
  const yy = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit' }).format(new Date());
  return {
    settings: rows.map((r) => ({ ...r, tbc: Number(r.tbc) === 1, options: r.options ? JSON.parse(r.options) : null })),
    lists, roles, invoiceDemo: commerceSettings.invoiceIsDemo(cs),
    numbers: { invoice: `${cs.invoice_prefix}/${fy}/${String(cs.invoice_start_no || 1).padStart(4, '0')}`, creditNote: `${cs.credit_note_prefix}/${fy}/0001`, order: `${cs.order_prefix}-${yy}nnnn`, ret: `${cs.return_prefix}-${yy}nnnn`, fy },
  };
});

route('put', '/commerce-settings/:key', 'settings:edit', async (req) => tx(async (q) => {
  const [[row]] = await q.query('SELECT setting_key, value, value_type, options FROM commerce_settings WHERE setting_key = ? FOR UPDATE', [req.params.key]);
  if (!row) throw new InputError('Unknown setting', 404);
  const [roles] = await q.query('SELECT role_id FROM roles');
  const checked = commerceSettings.check(row, req.body.value, roles.map((r) => r.role_id));
  if (checked.error) throw new InputError(checked.error);
  if (checked.value === row.value) return { setting_key: row.setting_key, value: row.value };
  await q.query('UPDATE commerce_settings SET value = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE setting_key = ?', [checked.value, by(req), row.setting_key]);
  await audit(q, { empId: by(req), action: 'update', entity: 'commerce_setting', entityId: row.setting_key, before: { value: row.value }, after: { value: checked.value } });
  return { setting_key: row.setting_key, value: checked.value };
}));

const listOf = (key) => {
  const l = commerceSettings.LISTS[key];
  if (!l) throw new InputError('Unknown list', 404);
  return l;
};
function listInput(l, body, creating) {
  const { values, errors } = commerceSettings.checkListRow(l, body || {}, { creating });
  if (Object.keys(errors).length) {
    const err = new InputError(Object.values(errors)[0]);
    err.code = 'fields';
    err.fields = errors;
    throw err;
  }
  return values;
}
route('post', '/commerce-settings/lists/:list', 'settings:create', async (req) => tx(async (q) => {
  const l = listOf(req.params.list);
  const v = listInput(l, req.body, true);
  if (!l.auto) {
    const [[dup]] = await q.query(`SELECT ${l.pk} FROM ${l.table} WHERE ${l.pk} = ?`, [v[l.pk]]);
    if (dup) throw new InputError(`${v[l.pk]} exists already`, 409);
  }
  const cols = Object.keys(v);
  const [ins] = await q.query(`INSERT INTO ${l.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => v[c]));
  const id = l.auto ? ins.insertId : v[l.pk];
  await audit(q, { empId: by(req), action: 'create', entity: `list_${req.params.list}`, entityId: String(id), after: v });
  return { id };
}), { status: 201 });

route('put', '/commerce-settings/lists/:list/:id', 'settings:edit', async (req) => tx(async (q) => {
  const l = listOf(req.params.list);
  const v = listInput(l, req.body, false);
  const [[before]] = await q.query(`SELECT * FROM ${l.table} WHERE ${l.pk} = ? FOR UPDATE`, [req.params.id]);
  if (!before) throw new InputError('Not found', 404);
  if (req.params.list === 'locations' && !v.is_active) {
    const [[c]] = await q.query('SELECT COUNT(*) AS n FROM locations WHERE is_active = 1 AND location_id <> ?', [req.params.id]);
    if (!Number(c.n)) throw new InputError('At least one stock location must stay on', 409);
  }
  const cols = Object.keys(v);
  await q.query(`UPDATE ${l.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${l.pk} = ?`, [...cols.map((c) => v[c]), req.params.id]);
  await audit(q, { empId: by(req), action: 'update', entity: `list_${req.params.list}`, entityId: String(req.params.id), before, after: v });
  return { id: req.params.id };
}));

route('delete', '/commerce-settings/lists/:list/:id', 'settings:delete', async (req) => tx(async (q) => {
  const l = listOf(req.params.list);
  const [[before]] = await q.query(`SELECT * FROM ${l.table} WHERE ${l.pk} = ? FOR UPDATE`, [req.params.id]);
  if (!before) throw new InputError('Not found', 404);
  const [[left]] = await q.query(`SELECT COUNT(*) AS n FROM ${l.table} WHERE ${l.pk} <> ?`, [req.params.id]);
  if (!Number(left.n)) throw new InputError('The last row of a list cannot be deleted (switch it off instead)', 409);
  await q.query(`DELETE FROM ${l.table} WHERE ${l.pk} = ?`, [req.params.id]);
  await audit(q, { empId: by(req), action: 'delete', entity: `list_${req.params.list}`, entityId: String(req.params.id), before });
  return null;
}));

router.use('/admin', (err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof InputError || err instanceof media.UploadError) {
    return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}), ...(err.fields ? { fields: err.fields } : {}) });
  }
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large' : 'Upload one file in the "file" field' });
  }
  if (DB_ERRORS[err.code]) {
    const [status, message] = DB_ERRORS[err.code];
    return res.status(status).json({ success: false, message });
  }
  console.error(`${req.method} ${req.originalUrl} failed:`, err.code || err.message);
  return res.status(500).json({ success: false, message: 'Server error' });
});

// Start-up check: every /admin route must have declared its permission (route() / declare()). An undeclared one would
// be open to every signed-in user, so the API refuses to start instead.
(function assertAllDeclared() {
  const missing = [];
  for (const layer of router.stack) {
    const r = layer.route;
    if (!r || typeof r.path !== 'string' || !r.path.startsWith('/admin')) continue;
    for (const m of Object.keys(r.methods)) if (!DECLARED.has(`${m.toUpperCase()} ${r.path}`)) missing.push(`${m.toUpperCase()} ${r.path}`);
  }
  if (missing.length) throw new Error(`admin routes without a permission declaration: ${missing.join(', ')}`);
}());

module.exports = router;
module.exports.DECLARED = DECLARED; // tests: every route and its permission
