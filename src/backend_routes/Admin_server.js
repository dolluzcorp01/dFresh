// Admin API /api/dfresh/admin/* (spec F, docs/06_API.md). Sign-in lives in Admin_login_server.js.
// - Every route is registered through route(method, path, role, handler, opts): the role argument is
//   mandatory, so no route can exist without a role check. requireAuth runs before all of them.
//   Roles: viewer (read), editor (content + leads), admin (also settings, users, languages, Excel import).
// - Every write records audit_log (before / after) in the same transaction as the change.
// - opts.content: a successful write busts the public content cache, so the site shows it on the next request.
// - DB constraint errors become 400 / 409 with a plain message; nothing else leaks.
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { getDBConnection } = require('../../config/db');
const auth = require('./auth');
const entities = require('./admin-entities');
const media = require('./admin-media');
const excel = require('./product-excel');
const csv = require('./csv');
const contentCache = require('./content-cache');
const { audit } = require('./audit');

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
  return {
    leads: { today: Number(leads.today) || 0, last7: Number(leads.last7) || 0, open_new: Number(leads.open_new) || 0, total: Number(leads.total) },
    byForm: byForm.map((r) => ({ form_type: r.form_type, n: Number(r.n) })),
    outbox: { mail: counts(mail), sync: counts(sync) },
    languages: langs.map((l) => ({ ...l, missing: done[l.lang_code].total - done[l.lang_code].have, pct: done[l.lang_code].pct })),
  };
});

// ---------------------------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------------------------
const LEAD_STATUS = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];
const LEAD_LIST_COLS = `l.lead_id, l.lead_ref, l.form_type, l.full_name, l.first_name, l.last_name, l.business_name,
  l.business_type, l.town, l.phone, l.email, l.lang_code, l.status, l.assigned_to, l.source_page, l.source_ref, l.created_at`;

function leadFilters(q) {
  const where = [];
  const params = [];
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

route('get', '/leads/export.csv', 'editor', async (req, res) => {
  const f = leadFilters(req.query);
  const [rows] = await db.query(
    `SELECT l.lead_ref, l.created_at, l.form_type, l.status, l.full_name, l.first_name, l.last_name, l.business_name,
            l.business_type, l.town, l.phone, l.email, l.monthly_quantity, l.message, l.details_json, l.lang_code,
            l.source_page, l.source_ref, l.assigned_to, l.staff_notes,
            (SELECT GROUP_CONCAT(product_id ORDER BY product_id SEPARATOR ' ') FROM lead_products p WHERE p.lead_id = l.lead_id) AS products
       FROM leads l ${f.sql} ORDER BY l.lead_id DESC LIMIT 10000`,
    f.params
  );
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
  const wb = await excel.buildWorkbook(db);
  const buf = await wb.xlsx.writeBuffer();
  await audit(null, { empId: by(req), action: 'export', entity: 'product', after: { file: 'products.xlsx', bytes: buf.byteLength } });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="dFresh_Product_List_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.send(Buffer.from(buf));
});

route('post', '/products/import', 'admin', async (req) => {
  if (!req.file) throw new InputError('Choose the .xlsx file');
  const dryRun = req.query.dryRun !== '0';
  const result = await excel.diffWorkbook(db, req.file.buffer);
  const { plan, ...report } = result;
  if (dryRun) return { dryRun: true, ...report };
  if (!result.ok) throw new InputError(`Fix the ${result.errors.length} error(s) first (run the dry run)`);
  const changes = await tx(async (q) => {
    const out = await excel.applyPlan(q, plan, by(req));
    for (const c of out) await audit(q, { empId: by(req), action: 'import', entity: c.entity, entityId: c.id, before: c.before, after: c.after });
    return out;
  });
  contentCache.bust();
  return { dryRun: false, applied: changes.length, ...report };
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
function bannerGuard(body, current) {
  const desktop = current ? current.desktop_file : '';
  const mobile = current ? current.mobile_file : '';
  const active = 'is_active' in body ? Number(entities.coerce('is_active', { type: 'bool' }, body.is_active)) : (current ? current.is_active : 0);
  if (active && (!desktop || !mobile)) throw new InputError('Upload the desktop and the mobile photo before switching the banner on');
}

const AUDIT_LABEL = {
  products: 'product', categories: 'category', banners: 'banner', kits: 'kit', towns: 'town',
  'form-options': 'form_option', 'size-picker': 'size_picker',
};

for (const name of Object.keys(entities.ENTITIES)) {
  const e = entities.ENTITIES[name];
  const label = AUDIT_LABEL[name];

  route('get', `/${name}`, 'viewer', async () => entities.load(name));

  route('get', `/${name}/:id`, 'viewer', async (req) => {
    const row = await entities.load(name, entities.parseId(e, req.params.id));
    if (!row) throw new InputError('Not found', 404);
    return row;
  });

  route('post', `/${name}/reorder`, 'editor', async (req) => tx(async (q) => {
    const before = (await entities.load(name, null, q)).map((r) => ({ id: entities.idOf(e, r), sort_order: r.sort_order }));
    await entities.reorder(q, name, req.body.order);
    await audit(q, { empId: by(req), action: 'reorder', entity: label, before, after: { order: req.body.order } });
  }), { content: true });

  route('post', `/${name}`, 'editor', async (req) => tx(async (q) => {
    if (name === 'banners') bannerGuard(req.body, null);
    const keyValues = await entities.create(q, name, req.body || {}, by(req));
    const after = await entities.load(name, keyValues, q);
    await audit(q, { empId: by(req), action: 'create', entity: label, entityId: entities.idOf(e, after), after });
    return after;
  }), { content: true, status: 201 });

  route('put', `/${name}/:id`, 'editor', async (req) => tx(async (q) => {
    const keyValues = entities.parseId(e, req.params.id);
    const before = await entities.load(name, keyValues, q);
    if (!before) throw new InputError('Not found', 404);
    if (name === 'banners') bannerGuard(req.body || {}, before);
    await entities.update(q, name, keyValues, req.body || {}, by(req));
    const after = await entities.load(name, keyValues, q);
    await audit(q, { empId: by(req), action: 'update', entity: label, entityId: req.params.id, before, after });
    return after;
  }), { content: true });

  route('delete', `/${name}/:id`, 'editor', async (req) => {
    const keyValues = entities.parseId(e, req.params.id);
    const before = await tx(async (q) => {
      const row = await entities.load(name, keyValues, q);
      if (!row) throw new InputError('Not found', 404);
      await entities.remove(q, name, keyValues);
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
  const [keys] = await db.query('SELECT text_key, group_name, description, allows_html FROM ui_text_keys ORDER BY group_name, text_key');
  const [vals] = await db.query('SELECT text_key, lang_code, value FROM ui_text');
  const map = new Map(keys.map((k) => [k.text_key, { ...k, allows_html: Number(k.allows_html), values: {} }]));
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
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dfresh-translations-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
  res.send(body);
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
  // font_family goes into a Google Fonts URL and a CSS variable: letters, digits and spaces only.
  if (out.font_family && !/^[A-Za-z0-9 ]{2,120}$/.test(out.font_family)) throw new InputError('font_family: a Google Font name, e.g. Noto Sans Telugu');
  return out;
}

const LANG_SELECT = 'SELECT lang_code, name_en, native_name, switch_label, html_lang, dir, font_family, is_default, is_active, sort_order FROM languages';

route('get', '/languages', 'viewer', async () => {
  const [rows] = await db.query(`${LANG_SELECT} ORDER BY sort_order, lang_code`);
  const done = await entities.completeness();
  const [bros] = await db.query('SELECT lang_code FROM brochures');
  return rows.map((r) => ({ ...r, completeness: done[r.lang_code], brochure: bros.some((b) => b.lang_code === r.lang_code) }));
});

route('post', '/languages', 'admin', async (req) => tx(async (q) => {
  const code = String(req.body.lang_code || '').trim();
  if (!/^[a-z]{2,3}$/.test(code)) throw new InputError('lang_code: 2-3 lower-case letters (the URL prefix, e.g. te)');
  const vals = { lang_code: code, ...langValues(req.body, true), is_default: 0 };
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

route('put', '/settings/:key', 'admin', async (req) => tx(async (q) => {
  const [[before]] = await q.query('SELECT setting_key, setting_value FROM site_settings WHERE setting_key = ?', [req.params.key]);
  if (!before) throw new InputError('Unknown setting', 404);
  const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';
  if (value.length > 20000) throw new InputError('Too long');
  if (['mail_from', 'lead_email', 'public_email'].includes(before.setting_key) && value && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(value)) {
    throw new InputError('A plain e-mail address, e.g. connect@dolluzcorp.com');
  }
  await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [value, by(req), before.setting_key]);
  await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: before.setting_key, before: { value: before.setting_value }, after: { value } });
  return { setting_key: before.setting_key, setting_value: value };
}), { content: true });

const USER_SELECT = `SELECT a.emp_id, a.role, a.is_active, a.created_by, a.created_at,
  TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name, e.emp_mail_id AS email,
  e.deleted_time IS NOT NULL AS deleted_in_dadmin
  FROM admin_users a LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id`;
const ROLES = Object.keys(auth.ROLE_RANK);

route('get', '/users', 'admin', async () => {
  const [rows] = await db.query(`${USER_SELECT} ORDER BY a.is_active DESC, a.emp_id`);
  return rows;
});

route('post', '/users', 'admin', async (req) => tx(async (q) => {
  const empId = str(req.body.emp_id, 20);
  if (!empId || !/^[A-Za-z0-9_-]{1,20}$/.test(empId)) throw new InputError('emp_id like DZIND148');
  if (!ROLES.includes(req.body.role)) throw new InputError(`role: ${ROLES.join(', ')}`);
  const [[emp]] = await q.query(`SELECT emp_id FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ? AND deleted_time IS NULL`, [empId]);
  if (!emp) throw new InputError('No active dAdmin employee with that emp_id');
  await q.query('INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, ?, 1, ?)', [emp.emp_id, req.body.role, by(req)]);
  const [[after]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [emp.emp_id]);
  await audit(q, { empId: by(req), action: 'create', entity: 'admin_user', entityId: emp.emp_id, after });
  return after;
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
    throw new InputError('You cannot remove your own admin access (ask another admin)');
  }
  await q.query(`UPDATE admin_users SET ${Object.keys(set).map((c) => `${c} = ?`).join(', ')} WHERE emp_id = ?`, [...Object.values(set), before.emp_id]);
  const [[after]] = await q.query(`${USER_SELECT} WHERE a.emp_id = ?`, [before.emp_id]);
  await audit(q, { empId: by(req), action: 'update', entity: 'admin_user', entityId: before.emp_id, before, after });
  return after;
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
