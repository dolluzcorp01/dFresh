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
const fontManager = require('./font-manager');
const outboxWorker = require('./outbox-worker');
const gsheet = require('./gsheet');
const settingRules = require('../shared/settingRules');
const { STAFF_GROUP } = require('./text-groups');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const { InputError } = entities;
const MB = 1024 * 1024;
const upload = (maxMb) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * MB, files: 1 } }).single('file');

router.use('/admin', auth.requireAuth);
// Express 5 leaves req.body undefined without a JSON body; multer replaces it on uploads.
router.use('/admin', (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') req.body = {};
  next();
});

const DB_ERRORS = {
  ER_DUP_ENTRY: [409, 'That already exists'],
  ER_NO_REFERENCED_ROW_2: [400, 'It refers to something that does not exist (check the keys and product IDs)'],
  ER_ROW_IS_REFERENCED_2: [409, 'It is still used elsewhere (e.g. by leads or kits); deactivate it instead'],
  ER_DATA_TOO_LONG: [400, 'A value is too long'],
  ER_TRUNCATED_WRONG_VALUE: [400, 'A value has the wrong format'],
  ER_WARN_DATA_OUT_OF_RANGE: [400, 'A number is out of range'],
};

function route(method, path, role, handler, opts = {}) {
  router[method](`/admin${path}`, auth.requireRole(role), ...(opts.before || []), async (req, res, next) => {
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
route('get', '/dashboard', 'viewer', async () => {
  const [[leads]] = await db.query(
    `SELECT SUM(created_at >= CURDATE()) AS today, SUM(created_at >= CURDATE() - INTERVAL 6 DAY) AS last7,
            SUM(status = 'new') AS open_new, COUNT(*) AS total FROM leads`
  );
  const [byForm] = await db.query(
    `SELECT form_type, COUNT(*) AS n FROM leads WHERE created_at >= CURDATE() - INTERVAL 6 DAY GROUP BY form_type ORDER BY n DESC`
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
  return {
    leads: { today: Number(leads.today) || 0, last7: Number(leads.last7) || 0, open_new: Number(leads.open_new) || 0, total: Number(leads.total) },
    byForm: byForm.map((r) => ({ form_type: r.form_type, n: Number(r.n) })),
    outbox: { mail: counts(mail), sync: counts(sync) },
    languages: langs.map((l) => ({ ...l, missing: done[l.lang_code].total - done[l.lang_code].have, pct: done[l.lang_code].pct, legalMissing: legalMissing[l.lang_code] || 0 })),
    mailLogo: logoCheck.status(), // state 'failing' = red notice: mails use the built-in logo
    fonts: fontManager.status(), // status 'full' = red notice: a subset could not be rebuilt, the full font is served
    attention: await attention(langs),
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
route('get', '/nav-counts', 'viewer', async () => {
  const [[r]] = await db.query("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'");
  return { newLeads: Number(r.n) };
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
  if (q.from) { where.push('l.created_at >= ?'); params.push(String(q.from)); }
  if (q.to) { where.push('l.created_at < ? + INTERVAL 1 DAY'); params.push(String(q.to)); }
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

route('get', '/leads/export.csv', 'editor', async (req, res) => {
  const rows = await leadsForExport(req.query);
  const head = ['lead_ref', 'created_at', 'form_type', 'status', 'full_name', 'first_name', 'last_name', 'business_name',
    'business_type', 'town', 'phone', 'email', 'products', 'monthly_quantity', 'message', 'details', 'lang', 'source_page',
    'source_ref', 'assigned_to', 'staff_notes'];
  const body = csv.stringify([head, ...rows.map((r) => [r.lead_ref, r.created_at && r.created_at.toISOString(), r.form_type,
    r.status, r.full_name, r.first_name, r.last_name, r.business_name, r.business_type, r.town, r.phone, r.email, r.products,
    r.monthly_quantity, r.message, r.details_json ? JSON.stringify(r.details_json) : '', r.lang_code, r.source_page,
    r.source_ref, r.assigned_to, r.staff_notes])]);
  await audit(null, { empId: by(req), action: 'export', entity: 'lead', after: { filters: req.query, rows: rows.length } });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dfresh-leads-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  res.send(body);
});

// Same leads and filters as the CSV, as a branded Excel file: phones and GST as text, received as a real date,
// the distributor details in their own columns.
route('get', '/leads/export.xlsx', 'editor', async (req, res) => {
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
  const bytes = await theme.send(res, wb, `dFresh_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'lead', after: { filters: req.query, rows: rows.length, file: 'leads.xlsx', bytes } });
});

// Live admin (polled every 15 s while the tab is visible): leads newer than ?since=<lead_id>. Light: two counts and
// the newest id. No since = just the newest id (the starting point). { lastId, added, newLeads }
route('get', '/leads/changes', 'viewer', async (req) => {
  const since = /^\d{1,15}$/.test(String(req.query.since || '')) ? Number(req.query.since) : null;
  const [[r]] = await db.query(
    `SELECT COALESCE(MAX(lead_id), 0) AS last_id, SUM(status = 'new') AS new_leads,
            SUM(lead_id > ?) AS added FROM leads`,
    [since === null ? Number.MAX_SAFE_INTEGER : since]
  );
  return { lastId: Number(r.last_id), added: Number(r.added) || 0, newLeads: Number(r.new_leads) || 0 };
});

route('get', '/leads', 'viewer', async (req) => {
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

route('get', '/leads/:id', 'viewer', async (req) => {
  const lead = await leadDetail(Number(req.params.id));
  if (!lead) throw new InputError('Lead not found', 404);
  return lead;
});

route('patch', '/leads/:id', 'editor', async (req) => {
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

route('post', '/outbox/:type/:id/retry', 'editor', async (req) => {
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

route('get', '/assignees', 'viewer', async () => {
  const [rows] = await db.query(
    `SELECT a.emp_id, a.role, TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name
       FROM admin_users a LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id
      WHERE a.is_active = 1 ORDER BY name`
  );
  return rows;
});

// ---------------------------------------------------------------------------------------------
// Products: Excel and images (registered before the generic /products/:id routes)
// ---------------------------------------------------------------------------------------------
route('get', '/products/export.xlsx', 'editor', async (req, res) => {
  const wb = await excel.buildWorkbook(db, { who: await exportedBy(req) });
  const bytes = await theme.send(res, wb, `dFresh_Product_List_${new Date().toISOString().slice(0, 10)}.xlsx`);
  await audit(null, { empId: by(req), action: 'export', entity: 'product', after: { file: 'products.xlsx', bytes } });
});

route('post', '/products/import', 'admin', async (req) => {
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

route('post', '/products/:id/images', 'editor', async (req) => {
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

route('delete', '/products/:id/images/:position', 'editor', async (req) => {
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

route('put', '/products/:id/images/order', 'editor', async (req) => {
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
route('post', '/banners/:id/image', 'editor', async (req) => {
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
route('post', '/products/featured-order', 'editor', async (req) => tx(async (q) => {
  const [before] = await q.query('SELECT product_id, featured_order FROM products WHERE is_featured = 1 ORDER BY featured_order');
  await positions.reorderFeatured(q, req.body.order);
  await audit(q, { empId: by(req), action: 'reorder', entity: 'featured', before, after: { order: req.body.order } });
}), { content: true });

for (const name of Object.keys(entities.ENTITIES)) {
  const e = entities.ENTITIES[name];
  const label = AUDIT_LABEL[name];

  // banners also get photo_check: each photo's real size (missing / wrong size shows a warning in the admin)
  route('get', `/${name}`, 'viewer', async () => {
    const rows = await entities.load(name);
    if (name === 'banners') for (const r of rows) r.photo_check = await media.bannerPhotoCheck(r);
    if (name === 'form-options') for (const r of rows) r.used = await optionUse(db, r.list_key, r.option_value);
    return rows;
  });

  route('get', `/${name}/:id`, 'viewer', async (req) => {
    const row = await entities.load(name, entities.parseId(e, req.params.id));
    if (!row) throw new InputError('Not found', 404);
    if (name === 'banners') row.photo_check = await media.bannerPhotoCheck(row);
    if (name === 'form-options') row.used = await optionUse(db, row.list_key, row.option_value);
    return row;
  });

  // Drag and drop. Products: one category's main products or one main product's colour versions at a time
  // ({ category } or { parent }); categories, kits, banners: the whole list (positions.js: exactly every row, 1..n).
  route('post', `/${name}/reorder`, 'editor', async (req) => tx(async (q) => {
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

  route('post', `/${name}`, 'editor', async (req) => tx(async (q) => {
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

  route('put', `/${name}/:id`, 'editor', async (req) => tx(async (q) => {
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

  route('delete', `/${name}/:id`, 'editor', async (req) => {
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
  const [keys] = await db.query('SELECT text_key, group_name, description, allows_html, max_chars FROM ui_text_keys ORDER BY group_name, text_key');
  const [vals] = await db.query('SELECT text_key, lang_code, value FROM ui_text');
  const map = new Map(keys.map((k) => [k.text_key, {
    ...k, allows_html: Number(k.allows_html), max_chars: k.max_chars === null ? null : Number(k.max_chars),
    default_only: k.group_name === STAFF_GROUP, values: {},
  }]));
  for (const v of vals) if (map.has(v.text_key)) map.get(v.text_key).values[v.lang_code] = v.value;
  return [...map.values()];
}

route('get', '/ui-text', 'viewer', async () => {
  const langs = await entities.languages();
  return { languages: langs.codes, default: langs.def, keys: await uiTextGrid() };
});

route('get', '/ui-text/export.csv', 'editor', async (req, res) => {
  const langs = await entities.languages();
  const rows = await uiTextGrid();
  const body = csv.stringify([['key', 'group', 'description', ...langs.codes],
    ...rows.map((r) => [r.text_key, r.group_name, r.description, ...langs.codes.map((l) => r.values[l] ?? '')])]);
  await audit(null, { empId: by(req), action: 'export', entity: 'ui_text', after: { rows: rows.length, languages: langs.codes } });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dFresh_Translations.csv"', 'Cache-Control': 'no-store' });
  res.send(body);
});

// The same grid as a branded Excel file, for reading and review (the import stays CSV).
route('get', '/ui-text/export.xlsx', 'editor', async (req, res) => {
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
  const bytes = await theme.send(res, wb, `dFresh_Translations_${new Date().toISOString().slice(0, 10)}.xlsx`);
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

route('put', '/ui-text/:key/:lang', 'editor', async (req) => {
  const langs = await entities.languages();
  if (!langs.codes.includes(req.params.lang)) throw new InputError('Unknown language', 404);
  const [[k]] = await db.query('SELECT text_key FROM ui_text_keys WHERE text_key = ?', [req.params.key]);
  if (!k) throw new InputError('Unknown key', 404);
  const changed = await tx((q) => setUiText(q, req.params.key, req.params.lang, req.body.value, by(req), langs));
  return { changed };
}, { content: true });

route('post', '/ui-text/import', 'editor', async (req) => {
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

route('get', '/fonts', 'viewer', async () => ({ scripts: fontManager.CATALOG, fonts: fontManager.status() }));

route('get', '/languages', 'viewer', async () => {
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

route('post', '/languages', 'admin', async (req) => tx(async (q) => {
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

route('put', '/languages/:code', 'admin', async (req) => tx(async (q) => {
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

route('delete', '/languages/:code', 'admin', async (req) => tx(async (q) => {
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
route('get', '/brochures', 'viewer', async () => {
  const [rows] = await db.query('SELECT lang_code, file_name, file_size_kb, is_active, uploaded_by, uploaded_at FROM brochures ORDER BY lang_code');
  return rows.map((r) => ({ ...r, on_disk: Boolean(media.brochurePath(r.lang_code, r.file_name) && fs.existsSync(media.brochurePath(r.lang_code, r.file_name))) }));
});

route('get', '/brochures/:lang/file', 'viewer', async (req, res) => {
  const [[row]] = await db.query('SELECT lang_code, file_name FROM brochures WHERE lang_code = ?', [req.params.lang]);
  const file = row && media.brochurePath(row.lang_code, row.file_name);
  if (!file || !fs.existsSync(file)) throw new InputError('No brochure file for this language', 404);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${row.file_name}"`, 'Cache-Control': 'no-store' });
  res.send(fs.readFileSync(file));
});

route('post', '/brochures/:lang', 'editor', async (req) => {
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

route('delete', '/brochures/:lang', 'editor', async (req) => {
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
route('get', '/settings', 'admin', async () => {
  const [rows] = await db.query('SELECT setting_key, setting_value, is_public, description, updated_by, updated_at FROM site_settings ORDER BY setting_key');
  return rows;
});

// Settings holding a picture (uploaded below; typed values are refused) and settings naming a product.
const IMAGE_SETTINGS = { share_image: media.saveShareImage, about_image: media.saveAboutImage };
const PRODUCT_SETTINGS = ['door_home_product', 'door_biz_product'];

route('put', '/settings/:key', 'admin', async (req) => {
  const raw = typeof req.body.value === 'string' ? req.body.value.trim() : '';
  if (raw.length > 20000) throw new InputError('Too long');
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
  const saved = await tx(async (q) => {
    const [[before]] = await q.query('SELECT setting_key, setting_value FROM site_settings WHERE setting_key = ?', [req.params.key]);
    if (!before) throw new InputError('Unknown setting', 404);
    await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [value, by(req), before.setting_key]);
    await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: before.setting_key, before: { value: before.setting_value }, after: { value } });
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

// Lead sheet: which spreadsheet an ID points to (read only: its title and tab names, nothing is written). For the
// "Test connection" button; works whether or not the sync is switched on (GSHEET_ENABLED).
route('get', '/settings/gsheet-check', 'admin', async (req) => {
  const checked = settingRules.checkSetting('gsheet_spreadsheet_id', String(req.query.id || ''));
  if (!checked.value) throw new InputError('No sheet ID to test');
  if (checked.error) throw new InputError(checked.error);
  const info = await gsheet.sheetInfo(checked.value);
  return { ...info, syncEnabled: process.env.GSHEET_ENABLED === 'true' };
});

// Share picture / About photo: upload -> generated files under /media, the setting holds the path.
route('post', '/settings/:key/image', 'admin', async (req) => {
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
router.get('/admin/mail-logo/builtin.png', auth.requireRole('admin'), (req, res) => {
  res.type('png').set('Cache-Control', 'private, max-age=300').sendFile(path.join(__dirname, 'mail-logo.png'));
});

route('get', '/mail-logo', 'admin', async () => logoCheck.status());

route('post', '/mail-logo/test-mail', 'admin', async (req) => {
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
const USER_SELECT = `SELECT a.emp_id, a.role, a.is_active, a.created_by, a.created_at,
  TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name, e.emp_mail_id AS email,
  e.job_position, e.emp_department, e.emp_profile_img AS photo,
  (e.emp_id IS NOT NULL AND (e.deleted_time IS NOT NULL OR e.active <> 1)) AS left_company,
  e.emp_id IS NULL AS not_in_dadmin
  FROM admin_users a LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id`;
const ROLES = Object.keys(auth.ROLE_RANK);

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
// Active admins whose dAdmin account is still active (the ones who can actually sign in).
async function activeAdmins(q, exceptEmpId) {
  const [[r]] = await q.query(
    `SELECT COUNT(*) AS n FROM admin_users a JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id AND e.deleted_time IS NULL AND e.active = 1
      WHERE a.is_active = 1 AND a.role = 'admin' AND a.emp_id <> ?`, [exceptEmpId || '']
  );
  return Number(r.n);
}

// The Add picker: active dAdmin employees who are not dFresh admin users yet, by name or emp_id.
route('get', '/users/employees', 'admin', async (req) => {
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

route('get', '/users', 'admin', async () => {
  const [rows] = await db.query(`${USER_SELECT} ORDER BY a.is_active DESC, name, a.emp_id`);
  return withNames(rows, await dadminNames(db));
});

route('post', '/users', 'admin', async (req) => tx(async (q) => {
  const empId = str(req.body.emp_id, 20);
  if (!empId || !/^[A-Za-z0-9_-]{1,20}$/.test(empId)) throw new InputError('emp_id like DZIND148');
  if (!ROLES.includes(req.body.role)) throw new InputError(`role: ${ROLES.join(', ')}`);
  const [[emp]] = await q.query(`SELECT emp_id FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ? AND deleted_time IS NULL AND active = 1`, [empId]);
  if (!emp) throw new InputError('No active dAdmin employee with that emp_id');
  const [[already]] = await q.query('SELECT emp_id FROM admin_users WHERE emp_id = ?', [emp.emp_id]);
  if (already) throw new InputError(`${emp.emp_id} is already a dFresh admin user`);
  await q.query('INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, ?, 1, ?)', [emp.emp_id, req.body.role, by(req)]);
  const [[after]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [emp.emp_id]);
  await audit(q, { empId: by(req), action: 'create', entity: 'admin_user', entityId: emp.emp_id, after: { role: after.role, is_active: after.is_active } });
  return withNames([after], await dadminNames(q))[0];
}), { status: 201 });

route('put', '/users/:empId', 'admin', async (req) => tx(async (q) => {
  const [[before]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [req.params.empId]);
  if (!before) throw new InputError('Not a dFresh admin user', 404);
  const set = {};
  if ('role' in req.body) {
    if (!ROLES.includes(req.body.role)) throw new InputError(`role: ${ROLES.join(', ')}`);
    set.role = req.body.role;
  }
  if ('is_active' in req.body) set.is_active = entities.coerce('is_active', { type: 'bool' }, req.body.is_active);
  if (!Object.keys(set).length) throw new InputError('Nothing to change');
  if (before.emp_id === by(req) && (set.is_active === 0 || (set.role && set.role !== 'admin'))) {
    throw new InputError('You cannot deactivate yourself or remove your own admin role (ask another admin)');
  }
  // there must always be at least one active admin who can sign in
  const losesAdmin = before.role === 'admin' && Number(before.is_active) === 1 && (set.is_active === 0 || (set.role && set.role !== 'admin'));
  if (losesAdmin && (await activeAdmins(q, before.emp_id)) === 0) {
    throw new InputError('There must always be at least one active admin. Make someone else admin first.');
  }
  await q.query(`UPDATE admin_users SET ${Object.keys(set).map((c) => `${c} = ?`).join(', ')} WHERE emp_id = ?`, [...Object.values(set), before.emp_id]);
  const [[after]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [before.emp_id]);
  const action = set.role && set.role !== before.role ? 'role_change' : set.is_active === 0 ? 'deactivate' : set.is_active === 1 ? 'reactivate' : 'update';
  await audit(q, { empId: by(req), action, entity: 'admin_user', entityId: before.emp_id, before: { role: before.role, is_active: before.is_active }, after: { role: after.role, is_active: after.is_active } });
  return withNames([after], await dadminNames(q))[0];
}));

route('get', '/audit', 'admin', async (req) => {
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
router.use('/admin', (err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof InputError || err instanceof media.UploadError) {
    return res.status(err.status).json({ success: false, message: err.message });
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

module.exports = router;
