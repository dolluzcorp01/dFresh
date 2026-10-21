// Approvals (docs/COMMERCE-SPEC.md section 2; table approvals, migration 20261020_commerce_approvals.sql).
// A module that holds an action calls needed(q, kind, facts) and, when true, request(q, ...) instead of doing it; it
// registers onApproved(kind, fn) so the action runs (in the same transaction) when someone approves, and optionally
// onClosed(kind, fn) for a request that ends without approval (rejected, withdrawn, expired).
// Who may decide: a user whose role is one of the approver roles (Commerce settings approver_role_ids), who has
// "approve" on the request's section, and who is not the requester. A reject needs a note. Pending requests older
// than approval_expiry_days expire (checked whenever the queue is read). Every step is audited.
const { getDBConnection } = require('../../config/db');
const { audit } = require('./audit');
const permissions = require('../shared/permissions');
const commerceSettings = require('./commerce-settings');
const notifications = require('./notifications');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const KINDS = {
  refund: { label: 'Refund', section: 'returns' },
  write_off: { label: 'Stock write-off', section: 'inventory' },
  discount: { label: 'Discount above the limit', section: 'orders' },
  cancel_after_dispatch: { label: 'Cancel after dispatch', section: 'orders' },
  goodwill_credit: { label: 'Manual wallet credit', section: 'promotions' },
  wallet_debit: { label: 'Manual wallet debit', section: 'promotions' },
  credit_raise: { label: 'Credit limit raise', section: 'customers' },
  price_below_list: { label: 'Price below the list', section: 'products' },
  over_available: { label: 'Order above the available stock', section: 'orders' },
  credit_order: { label: 'Order over the credit limit or with overdue invoices', section: 'customers' },
  stock_count: { label: 'Stock count differences', section: 'inventory' },
  return_window: { label: 'Return outside the window', section: 'returns' },
  no_refund: { label: 'Return with no refund', section: 'returns' },
  restock: { label: 'Recheck: returned (R) to good stock', section: 'inventory' },
  price_list: { label: 'Customer price list', section: 'customers' },
  customer_merge: { label: 'Merge customers', section: 'customers' },
  customer_hold: { label: 'Order for a customer on hold', section: 'customers' },
};
const handlers = {};
const closers = {};

class ApprovalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** a module registers what runs when its kind of request is approved: fn(q, payload, deciderEmpId) */
function onApproved(kind, fn) { handlers[kind] = fn; }
/** ... and what runs when it ends without approval: fn(q, payload, status, empId) */
function onClosed(kind, fn) { closers[kind] = fn; }
const payloadOf = (row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
async function close(q, row, status, empId) {
  if (closers[row.kind]) await closers[row.kind](q, payloadOf(row) || {}, status, empId);
}

/** does this action need approval under the current settings? facts = { amount, qty, pct } */
async function needed(q, kind, facts = {}) {
  const s = await commerceSettings.read(q);
  switch (kind) {
    case 'refund': return s.approve_refund_on && (facts.amount || 0) > s.approve_refund_above;
    case 'write_off': return s.approve_writeoff_on && ((facts.amount || 0) > s.approve_writeoff_value_above || (facts.qty || 0) > s.approve_writeoff_qty_above);
    case 'discount': return s.approve_discount_on && (facts.pct || 0) > s.approve_discount_pct_above;
    case 'cancel_after_dispatch': return s.approve_cancel_after_dispatch;
    case 'goodwill_credit': case 'wallet_debit': return s.approve_goodwill_credit;
    case 'credit_raise': return s.approve_credit_raise;
    case 'price_below_list': return s.approve_price_below_on && (facts.pct || 0) > s.approve_price_below_pct;
    case 'over_available': return s.approve_over_available !== false;
    case 'credit_order': return s.approve_credit_order !== false;
    case 'stock_count': return true;
    case 'return_window': case 'restock': return true;
    case 'no_refund': return s.approve_no_refund !== false;
    case 'price_list': return s.approve_price_list !== false;
    case 'customer_merge': case 'customer_hold': return true;
    default: throw new Error(`unknown approval kind ${kind}`);
  }
}

/** hold an action: -> approval_id */
async function request(q, { kind, refType = null, refId = null, summary, amount = null, payload = null }, empId) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown approval kind ${kind}`);
  const [ins] = await q.query(
    'INSERT INTO approvals (kind, section, ref_type, ref_id, summary, amount, payload, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [kind, k.section, refType, refId === null ? null : String(refId), String(summary).slice(0, 255), amount, payload ? JSON.stringify(payload) : null, empId]
  );
  await audit(q, { empId, action: 'request', entity: 'approval', entityId: String(ins.insertId), after: { kind, refType, refId, summary, amount } });
  await notifications.approvalWaiting(q, ins.insertId); // to the users who may decide it
  return ins.insertId;
}

async function expireOld(q) {
  const s = await commerceSettings.read(q);
  const [old] = await q.query("SELECT approval_id, kind, payload FROM approvals WHERE status = 'pending' AND requested_at < UTC_TIMESTAMP() - INTERVAL ? DAY", [s.approval_expiry_days || 7]);
  for (const r of old) {
    const [res] = await q.query("UPDATE approvals SET status = 'expired', decided_at = UTC_TIMESTAMP() WHERE approval_id = ? AND status = 'pending'", [r.approval_id]);
    if (res.affectedRows) await close(q, r, 'expired', 'system');
    await audit(q, { empId: 'system', action: 'expire', entity: 'approval', entityId: String(r.approval_id) });
  }
}

/** why this user cannot decide this request, or null when they can */
function cannotDecide(admin, row, approverRoles) {
  if (row.status !== 'pending') return `already ${row.status}`;
  if (row.requested_by === admin.emp_id) return 'you raised it: someone else must decide';
  if (!approverRoles.includes(Number(admin.role_id))) return 'your role is not an approver role (Commerce settings > Approvals)';
  if (!permissions.can(admin.perms, row.section, 'approve')) return `your role has no "approve" on ${(permissions.SECTIONS.find((x) => x.key === row.section) || {}).label}`;
  return null;
}

/** the queue for this user: pending they can decide or raised, and the decided ones they could see */
async function list(admin, status) {
  await expireOld(db);
  const s = await commerceSettings.read(db);
  const where = status === 'pending' ? "a.status = 'pending'" : status === 'mine' ? 'a.requested_by = ?' : "a.status <> 'pending'";
  const [rows] = await db.query(
    `SELECT a.approval_id, a.kind, a.section, a.ref_type, a.ref_id, a.summary, a.amount, a.payload, a.status, a.requested_by, a.requested_at,
            a.decided_by, a.decided_at, a.note FROM approvals a WHERE ${where} ORDER BY a.approval_id DESC LIMIT 300`, status === 'mine' ? [admin.emp_id] : []
  );
  return rows
    .filter((r) => r.requested_by === admin.emp_id || permissions.can(admin.perms, r.section, 'view'))
    .map((r) => {
      const why = cannotDecide(admin, r, s.approver_role_ids || []);
      return { ...r, kind_label: (KINDS[r.kind] || {}).label || r.kind, can_decide: !why, why_not: why, mine: r.requested_by === admin.emp_id };
    });
}

/** sidebar badge: pending requests this user can decide */
async function countDecidable(admin) {
  try {
    const s = await commerceSettings.read(db);
    const [rows] = await db.query("SELECT approval_id, section, status, requested_by FROM approvals WHERE status = 'pending'");
    return rows.filter((r) => !cannotDecide(admin, r, s.approver_role_ids || [])).length;
  } catch {
    return 0;
  }
}

async function decide(q, id, decision, note, admin) {
  if (!['approved', 'rejected'].includes(decision)) throw new ApprovalError('Approve or reject');
  const text = String(note || '').trim().slice(0, 500);
  if (decision === 'rejected' && !text) throw new ApprovalError('Say why it is rejected');
  const [[row]] = await q.query('SELECT approval_id, kind, section, status, requested_by, payload, summary FROM approvals WHERE approval_id = ? FOR UPDATE', [id]);
  if (!row) throw new ApprovalError('No such request', 404);
  const s = await commerceSettings.read(q);
  const why = cannotDecide(admin, row, s.approver_role_ids || []);
  if (why) throw new ApprovalError(`You cannot decide this request: ${why}`, 403);
  await q.query('UPDATE approvals SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ?', [decision, admin.emp_id, text || null, id]);
  let ran = false;
  if (decision === 'approved' && handlers[row.kind]) {
    await handlers[row.kind](q, payloadOf(row), admin.emp_id);
    ran = true;
  }
  if (decision === 'rejected' && closers[row.kind]) { await close(q, row, 'rejected', admin.emp_id); ran = true; }
  await audit(q, { empId: admin.emp_id, action: decision === 'approved' ? 'approve' : 'reject', entity: 'approval', entityId: String(id), before: { status: 'pending' }, after: { status: decision, note: text || null, summary: row.summary, ran } });
  return { approval_id: id, status: decision, ran };
}

async function withdraw(q, id, admin) {
  const [[row]] = await q.query('SELECT approval_id, kind, payload, status, requested_by FROM approvals WHERE approval_id = ? FOR UPDATE', [id]);
  if (!row) throw new ApprovalError('No such request', 404);
  if (row.requested_by !== admin.emp_id) throw new ApprovalError('Only the person who raised it can withdraw it', 403);
  if (row.status !== 'pending') throw new ApprovalError(`It is already ${row.status}`, 409);
  await q.query("UPDATE approvals SET status = 'withdrawn', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE approval_id = ?", [admin.emp_id, id]);
  await close(q, row, 'withdrawn', admin.emp_id);
  await audit(q, { empId: admin.emp_id, action: 'withdraw', entity: 'approval', entityId: String(id), before: { status: 'pending' }, after: { status: 'withdrawn' } });
  return { approval_id: id, status: 'withdrawn' };
}

module.exports = { KINDS, ApprovalError, onApproved, onClosed, needed, request, list, countDecidable, decide, withdraw, expireOld, cannotDecide };
