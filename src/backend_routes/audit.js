// audit_log writer: every admin write records who, what, and the row before / after (spec F).
// Pass the transaction connection when the write is in one, so the audit row commits or rolls back with it.
const { getDBConnection } = require('../../config/db');
const permissions = require('../shared/permissions');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

async function audit(q, { empId, action, entity, entityId = null, before = null, after = null }) {
  await (q || db).query(
    `INSERT INTO audit_log (emp_id, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empId, action, entity, entityId === null ? null : String(entityId).slice(0, 80), json(before), json(after)]
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the log (phase 13, v23 Audit log). Every entity type belongs to one v23 "screen", and every screen to the role
// section whose View lets a person see its rows. This list is the ONE place that maps them; an entity type that is in
// no rule lands in "Other" (Super admin and Admin only) until it is added here.
// Who sees what (v23 tests 0.16, 0.21, 0.49 and "One audit log for every section"):
//   - Super admin and Admin: every row of every person, and Export CSV (the export itself is audited).
//   - a role with View on "Audit log" (Sub-admin by default): the rows of every screen whose section the role may view,
//     never Company (bank, GSTIN, seller details: Super admin and Admin only) nor Other; the "Everybody" list; no export.
//   - everybody else signed in: only the changes they made themselves (GET /audit/mine), no "Everybody" list.
// Writers already mask money and account numbers where they must; the log shows the stored values as they are.
const COMPANY_COMMERCE_KEYS = ['invoice_seller_name', 'invoice_seller_gstin', 'invoice_seller_address', 'invoice_seller_state_code',
  'invoice_bank_details', 'books_closed_to'];
const COMPANY_SITE_KEYS = ['company_name', 'gstin', 'cin', 'office_phone', 'public_email'];
const NUMBERING_KEYS = ['invoice_prefix', 'credit_note_prefix', 'order_prefix', 'return_prefix', 'invoice_start_no', 'customer_prefix'];

// key, label, section (null = anyone who may read the log; 'admin' = Super admin and Admin only), match rules:
// { types } entity_type in the list (+ ids: entity_id in the list, + idLike: entity_id LIKE), or { like } entity_type LIKE.
// The first rule that matches wins, so the narrow rules (the Company keys) come before the wide ones.
const SCREENS = [
  { key: 'company', label: 'Company', section: 'admin', match: [{ types: ['commerce_setting'], ids: COMPANY_COMMERCE_KEYS },
    { types: ['setting'], ids: COMPANY_SITE_KEYS }, { like: 'company%' }, { like: 'bank%' }, { like: 'upi%' }] },
  { key: 'staff', label: 'Staff', section: 'users', match: [{ types: ['admin_user'] }] },
  { key: 'signin', label: 'Sign-in', section: 'users', match: [{ types: ['admin_login'] }] },
  { key: 'roles', label: 'Roles', section: 'users', match: [{ types: ['role'] }] },
  { key: 'godowns', label: 'Godowns', section: 'settings', match: [{ types: ['godown'] }, { like: 'shelf%' }] },
  { key: 'numbering', label: 'Numbering', section: 'settings', match: [{ types: ['commerce_setting'], ids: NUMBERING_KEYS }, { like: 'number%' }, { like: 'document_series%' }, { like: 'doc_series%' }] },
  { key: 'notifications', label: 'Notifications', section: 'settings', match: [{ types: ['commerce_setting'], idLike: 'notify%' }, { types: ['notification_jobs'] }] },
  { key: 'templates', label: 'Message templates', section: 'settings', match: [{ types: ['notification_template'] }] },
  { key: 'outbox', label: 'Outbox', section: 'settings', match: [{ types: ['notification', 'mail_outbox', 'sync_outbox'] }] },
  { key: 'switches', label: 'Switches', section: 'settings', match: [{ types: ['commerce_setting'] }, { like: 'switch%' }] },
  { key: 'approval_rules', label: 'Approval rules', section: 'settings', match: [{ types: ['approval_rule'] }] },
  { key: 'approvals', label: 'Approvals', section: null, match: [{ types: ['approval'] }] },
  { key: 'site_settings', label: 'Site settings', section: 'settings', match: [{ types: ['setting'] }] },
  { key: 'languages', label: 'Languages', section: 'content', match: [{ types: ['language'] }] },
  { key: 'translations', label: 'Translations', section: 'content', match: [{ types: ['ui_text'] }] },
  { key: 'website', label: 'Website content', section: 'content', match: [{ types: ['banner', 'town', 'form_option', 'brochure'] }] },
  { key: 'products', label: 'Products', section: 'products', match: [{ types: ['product', 'product_image', 'category', 'kit', 'size_picker', 'featured', 'product_tax', 'sku', 'barcode', 'unit'] }] },
  { key: 'prices', label: 'Prices', section: 'prices', match: [{ types: ['sku_price', 'price_list', 'special_price'] }] }, // phase 15
  { key: 'tax', label: 'Tax', section: 'prices', match: [{ types: ['hsn_code', 'hsn_rate', 'gst_rate'] }] }, // phase 15
  { key: 'brand', label: 'Logo and brand images', section: 'content', match: [{ types: ['brand'] }] }, // phase 15 step 9
  { key: 'leads', label: 'Leads', section: 'leads', match: [{ types: ['lead'] }] },
  { key: 'customers', label: 'Customers', section: 'customers', match: [{ types: ['customer', 'follow_up', 'segment'] }] },
  { key: 'orders', label: 'Orders', section: 'orders', match: [{ types: ['order', 'payment'] }] },
  { key: 'invoices', label: 'Invoices', section: 'orders', match: [{ types: ['invoice'] }] },
  { key: 'returns', label: 'Returns', section: 'returns', match: [{ types: ['return', 'credit_note'] }] },
  { key: 'suppliers', label: 'Suppliers', section: 'buying', match: [{ types: ['supplier'] }] }, // phase 16
  { key: 'buying', label: 'Purchase', section: 'buying', match: [{ types: ['indent', 'purchase_order', 'goods_in', 'quality_check', 'supplier_bill', 'claim'] }] }, // phase 16
  { key: 'supplier_payments', label: 'Supplier payments', section: 'money', match: [{ types: ['supplier_payment'] }] }, // phase 16
  { key: 'stock', label: 'Stock', section: 'inventory', match: [{ types: ['stock', 'stock_count', 'stock_level', 'write_off'] }] },
  { key: 'delivery', label: 'Delivery', section: 'delivery', match: [{ types: ['trip'] }] },
  { key: 'promotions', label: 'Promotions', section: 'promotions', match: [{ types: ['coupon', 'cashback_rule', 'offer', 'promotions'] }] },
  { key: 'wallet', label: 'Wallet', section: 'promotions', match: [{ types: ['wallet'] }] },
  { key: 'reports', label: 'Reports', section: 'reports', match: [{ types: ['report'] }] },
  { key: 'books', label: 'Export to CA', section: 'reports', match: [{ types: ['month'] }] },
  { key: 'audit', label: 'Audit log', section: 'audit', match: [{ types: ['audit_log'] }] },
  { key: 'other', label: 'Other', section: 'admin', match: [] },
];
const SCREEN = Object.fromEntries(SCREENS.map((s) => [s.key, s]));

/** 'all' (Super admin, Admin) | 'sections' (View on Audit log) | 'own' */
function scopeOf(admin) {
  if (admin && permissions.isAdminRole(admin.role_id)) return 'all';
  return admin && permissions.can(admin.perms, 'audit', 'view') ? 'sections' : 'own';
}

/** the screens whose rows this person may see (scope 'own': every screen is offered, the rows are their own only) */
function screensFor(admin, scope = scopeOf(admin)) {
  if (scope === 'all' || scope === 'own') return SCREENS;
  return SCREENS.filter((s) => s.section === null || (s.section !== 'admin' && permissions.can(admin.perms, s.section, 'view')));
}

/** SQL CASE giving the screen key of an audit_log row: { sql, args } (built from the constants above, parameterised) */
function screenCase() {
  const parts = [];
  const args = [];
  for (const s of SCREENS) {
    for (const m of s.match) {
      const cond = [];
      if (m.types) { cond.push(`entity_type IN (${m.types.map(() => '?').join(', ')})`); args.push(...m.types); }
      if (m.ids) { cond.push(`entity_id IN (${m.ids.map(() => '?').join(', ')})`); args.push(...m.ids); }
      if (m.idLike) { cond.push('entity_id LIKE ?'); args.push(m.idLike); }
      if (m.like) { cond.push('entity_type LIKE ?'); args.push(m.like); }
      parts.push(`WHEN ${cond.join(' AND ')} THEN ?`);
      args.push(s.key);
    }
  }
  return { sql: `(CASE ${parts.join(' ')} ELSE 'other' END)`, args };
}

const asObj = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
};
const text = (v, max) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && max && s.length > max ? `${s.slice(0, max)}...` : s;
};

/**
 * The change of one row as v23 shows it: [{ field, from, to }], only the fields that differ (a create has only "to", a
 * delete only "from"). A value that is not an object is one line with field null.
 */
function changesOf(row, max = 300) {
  const b = asObj(row.before_json);
  const a = asObj(row.after_json);
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(b) && !isObj(a)) {
    if (b === null && a === null) return [];
    return [{ field: null, from: b === null ? null : text(b, max), to: a === null ? null : text(a, max) }];
  }
  const bo = isObj(b) ? b : {};
  const ao = isObj(a) ? a : {};
  const keys = [...new Set([...Object.keys(bo), ...Object.keys(ao)])];
  return keys.filter((k) => JSON.stringify(bo[k]) !== JSON.stringify(ao[k]))
    .map((k) => ({ field: k, from: k in bo ? text(bo[k], max) : null, to: k in ao ? text(ao[k], max) : null }));
}

module.exports = { audit, SCREENS, SCREEN, scopeOf, screensFor, screenCase, changesOf };
