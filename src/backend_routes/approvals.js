// Approvals (docs/COMMERCE-SPEC.md section 2; gap map D4; tables approvals, approval_rules, approval_directs).
// A module that holds an action calls needed(q, kind, facts) and, when true, request(q, ...) instead of doing it; it
// registers onApproved(kind, fn) so the action runs (in the same transaction) when someone approves, optionally
// onClosed(kind, fn) for a request that ends without approval (rejected, withdrawn, expired), and onRecheck(kind, fn)
// to check again at the moment it is signed (the thing may have changed since it was asked: fn returns why it cannot
// go through now, or '').
// - The rule of each kind (on / off, Rs / % / every one, limit, packs, locked) is a row of approval_rules (Admin >
//   Approval rules). Rs rules count together: the requests and direct actions of one kind for one target (a customer,
//   supplier or payee; else by one person) within "Days that count together" (Commerce setting split_days) are added
//   before the limit, both for "does it need approval" and for "whose limit covers it".
// - Every request names its godown (only people who work there sign it), the date of its record (12b's month lock),
//   and may name people who never sign it (e.g. the sender and receiver of a transfer).
// - Who signs: approval-engine.js (the ladder: Approve on the section, the godown, a limit that covers the amount, not
//   the requester, not on leave, or with the powers of someone on leave they stand in for). A reject needs a note.
//   Pending requests older than approval_expiry_days expire (checked whenever the queue is read). Every step is audited.
// - Phase 12b: a request signed later checks the month lock on the date of its record (books.js); an expired request
//   can be sent again by the person who raised it (a fresh request with the same details; a module whose closer undid
//   the record registers onAgain to open it again, else it is refused); an Admin may override a waiting rule change
//   when every other Admin is away (approval-engine overrideProblem): it applies 24 hours later unless an Admin
//   cancels it, and stops if the other Admin is back (sweepOverrides, every minute). Every Admin is told each time.
const { getDBConnection } = require('../../config/db');
const { audit } = require('./audit');
const permissions = require('../shared/permissions');
const commerceSettings = require('./commerce-settings');
const notifications = require('./notifications');
const engine = require('./approval-engine');
const godowns = require('./godowns');
const pricing = require('./pricing');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

// label and section of each kind (the same as approval_rules; kept here for the screens that name a kind)
const KINDS = {
  rule_change: { label: 'Weaken an approval rule', section: 'settings' },
  company_bank: { label: 'Company bank account', section: 'settings' },
  supplier_bank: { label: 'Supplier bank account', section: 'inventory' },
  refund: { label: 'Refund', section: 'returns' },
  write_off: { label: 'Stock write-off', section: 'inventory' },
  discount: { label: 'Discount above the limit', section: 'orders' },
  cancel_after_dispatch: { label: 'Cancel after dispatch', section: 'orders' },
  goodwill_credit: { label: 'Manual wallet credit', section: 'promotions' },
  wallet_debit: { label: 'Manual wallet debit', section: 'promotions' },
  credit_raise: { label: 'Credit limit raise', section: 'customers' },
  price_below_list: { label: 'Price below the list', section: 'products' }, // phase 15: replaced by price_floor and margin_floor
  margin_floor: { label: 'Price below cost plus the margin floor', section: 'prices' },
  special_price: { label: 'Special price for a customer', section: 'prices' },
  price_floor: { label: 'Order line below the lowest allowed price', section: 'prices' },
  over_available: { label: 'Order above the available stock', section: 'orders' },
  credit_order: { label: 'Order over the credit limit or with overdue invoices', section: 'customers' },
  stock_count: { label: 'Stock count differences', section: 'inventory' },
  return_window: { label: 'Return outside the window', section: 'returns' },
  no_refund: { label: 'Return with no refund', section: 'returns' },
  restock: { label: 'Recheck: returned (R) to good stock', section: 'inventory' },
  price_list: { label: 'Customer price list', section: 'customers' },
  customer_merge: { label: 'Merge customers', section: 'customers' },
  customer_hold: { label: 'Order for a customer on hold', section: 'customers' },
  after_export: { label: 'Change after export to the CA', section: 'settings' },
};
const handlers = {};
const closers = {};
const recheckers = {};
const agains = {};

class ApprovalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** a module registers what runs when its kind of request is approved: fn(q, payload, deciderEmpId) */
function onApproved(kind, fn) { handlers[kind] = fn; }
/** ... and what runs when it ends without approval: fn(q, payload, status, empId) */
function onClosed(kind, fn) { closers[kind] = fn; }
/** ... and the check at the moment it is signed: fn(q, payload, row) -> '' or why it cannot go through now */
function onRecheck(kind, fn) { recheckers[kind] = fn; }
/** ... and how "Send again" opens its record again after it expired: fn(q, payload, row) -> '' or why it cannot */
function onAgain(kind, fn) { agains[kind] = fn; }
const payloadOf = (row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
const excludedOf = (row) => { const x = typeof row.excluded === 'string' ? JSON.parse(row.excluded) : row.excluded; return Array.isArray(x) ? x : []; };
async function close(q, row, status, empId) {
  if (closers[row.kind]) await closers[row.kind](q, payloadOf(row) || {}, status, empId);
}

const SECTION_LABEL = Object.fromEntries(permissions.SECTIONS.map((s) => [s.key, s.label]));
const sectionLabel = (s) => SECTION_LABEL[s] || s;

// ---------------------------------------------------------------- rules
async function rules(q) {
  const [rows] = await q.query('SELECT kind, label, section, is_on, unit, limit_value, limit_packs, locked, sort_order, updated_by, updated_at FROM approval_rules ORDER BY sort_order, kind');
  return rows.map((r) => ({ ...r, is_on: Number(r.is_on) === 1, locked: Number(r.locked) === 1, limit_value: r.limit_value === null ? null : Number(r.limit_value),
    limit_packs: r.limit_packs === null ? null : Number(r.limit_packs) }));
}
async function rule(q, kind) {
  const r = (await rules(q)).find((x) => x.kind === kind);
  if (!r) throw new Error(`unknown approval kind ${kind}`);
  return r;
}

/** the IST date window of "Days that count together" ending today -> the first day */
async function splitFrom(q) {
  const s = await commerceSettings.read(q);
  const days = Number(s.split_days) > 0 ? Number(s.split_days) : 3;
  return { days, from: engine.addDays(pricing.istToday(), 1 - days) };
}
const IST_DAY = (col) => `DATE(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;

/**
 * the requests (pending or approved, not expired) and direct actions of one kind for one target (else by one person)
 * since `from` -> { total, count }. exceptId: the request itself is left out (it is added by the caller).
 */
async function splitPast(q, kind, { target = null, by = null, exceptId = 0 } = {}) {
  const { from, days } = await splitFrom(q);
  const s = await commerceSettings.read(q);
  const who = target ? ['target = ?', target] : ['requested_by = ?', by];
  const [[r]] = await q.query(
    `SELECT COALESCE(SUM(amount), 0) AS t, COUNT(*) AS n FROM approvals
      WHERE kind = ? AND ${who[0]} AND approval_id <> ? AND ${IST_DAY('requested_at')} >= ?
        AND (status = 'approved' OR (status = 'pending' AND requested_at >= UTC_TIMESTAMP() - INTERVAL ? DAY))`,
    [kind, who[1], exceptId || 0, from, Number(s.approval_expiry_days) || 7]
  );
  const [[d]] = await q.query(`SELECT COALESCE(SUM(amount), 0) AS t, COUNT(*) AS n FROM approval_directs WHERE kind = ? AND ${target ? 'target = ?' : 'done_by = ?'} AND ${IST_DAY('done_at')} >= ?`,
    [kind, target || by, from]);
  return { total: Number(r.t) + Number(d.t), count: Number(r.n) + Number(d.n), days };
}

/**
 * does this action need approval under its rule? facts = { amount, qty, pct, target, by }
 * -> { needs, total, count, days } (Rs rules: total = this amount and what it counts together with)
 */
async function check(q, kind, facts = {}) {
  const r = await rule(q, kind);
  const past = r.unit === 'Rs' && r.is_on && (facts.target || facts.by) ? await splitPast(q, kind, { target: facts.target, by: facts.by }) : { total: 0, count: 0, days: 0 };
  const out = engine.needs(r, facts, past);
  return { ...out, days: past.days };
}
/** true when the action must wait for approval */
async function needed(q, kind, facts = {}) { return (await check(q, kind, facts)).needs; }

/** an action of a Rs rule went through without approval: it counts with later requests of its kind and target */
async function direct(q, kind, { amount, target = null }, empId) {
  const r = await rule(q, kind);
  if (r.unit !== 'Rs' || !r.is_on || !(Number(amount) > 0)) return;
  await q.query('INSERT INTO approval_directs (kind, target, amount, done_by) VALUES (?, ?, ?, ?)', [kind, target, Number(amount), empId]);
}

/**
 * hold an action: -> approval_id. godownId is required (only people who work there sign it); target: 'cust:12',
 * 'sup:3'... (Rs rules count together per target); recordDate: the date the record will carry (default today);
 * excluded: emp ids that may never sign it.
 */
async function request(q, { kind, godownId, refType = null, refId = null, target = null, recordDate = null, summary, amount = null, payload = null, excluded = null }, empId) {
  const r = await rule(q, kind);
  if (!godownId) throw new Error(`approvals.request ${kind}: the godown is required`);
  const [ins] = await q.query(
    `INSERT INTO approvals (kind, section, godown_id, ref_type, ref_id, target, record_date, summary, amount, payload, excluded, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, r.section, Number(godownId), refType, refId === null ? null : String(refId), target, recordDate || pricing.istToday(), String(summary).slice(0, 255),
      amount, payload ? JSON.stringify(payload) : null, excluded && excluded.length ? JSON.stringify(excluded) : null, empId]
  );
  await audit(q, { empId, action: 'request', entity: 'approval', entityId: String(ins.insertId), after: { kind, godown: godownId, refType, refId, target, summary, amount } });
  await notifications.approvalWaiting(q, ins.insertId); // to the people on its ladder
  return ins.insertId;
}

// ---------------------------------------------------------------- people and the ladder
/** every admin user as a person for the engine (name from dAdmin; someone inactive, here or in dAdmin, has left) */
async function people(q) {
  const auth = require('./auth'); // eslint-disable-line global-require
  const [rows] = await q.query(
    `SELECT a.emp_id, a.role_id, a.is_active, r.name AS role_name, r.limit_kind AS role_limit_kind, r.limit_amount AS role_limit_amount, r.see_cost, r.own_customers_only,
            a.limit_kind, a.limit_amount, a.godowns_all, DATE_FORMAT(a.leave_from, '%Y-%m-%d') AS leave_from, DATE_FORMAT(a.leave_to, '%Y-%m-%d') AS leave_to,
            a.stand_in, a.leave_set_by, a.pending_add, DATE_FORMAT(CONVERT_TZ(a.left_at, '+00:00', '+05:30'), '%Y-%m-%d') AS left_on, a.left_by,
            e.emp_first_name, e.emp_last_name, e.active AS emp_active, e.deleted_time
       FROM admin_users a JOIN roles r ON r.role_id = a.role_id
       LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = a.emp_id ORDER BY a.emp_id`
  );
  const out = [];
  for (const u of rows) {
    const p = await auth.buildAdmin(q, u);
    out.push({ ...p, name: [u.emp_first_name, u.emp_last_name].filter(Boolean).join(' ') || u.emp_id,
      active: Number(u.is_active) === 1 && Number(u.emp_active) === 1 && !u.deleted_time, pending: Number(u.pending_add) === 1,
      left: Number(u.is_active) === 1 ? null : { at: u.left_on || null, by: u.left_by || null } });
  }
  return out;
}

async function context(q, peopleList) {
  const s = await commerceSettings.read(q);
  const gs = await godowns.list(q);
  const { days } = await splitFrom(q);
  return { people: peopleList || await people(q), today: pricing.istToday(), expiryDays: Number(s.approval_expiry_days) || 7, splitDays: days,
    godownNames: Object.fromEntries(gs.map((g) => [g.godown_id, g.name])), sectionLabel };
}

/** a request row as the engine reads it (+ requested_on: its India date) */
function asRequest(row) {
  return { ...row, amount: row.amount === null ? 0 : Number(row.amount), excluded: excludedOf(row), requested_on: row.requested_on };
}
const ROW_COLS = `a.approval_id, a.kind, a.section, a.godown_id, a.ref_type, a.ref_id, a.target, DATE_FORMAT(a.record_date, '%Y-%m-%d') AS record_date, a.summary, a.amount,
  a.payload, a.excluded, a.status, a.requested_by, a.requested_at, DATE_FORMAT(${IST_DAY('a.requested_at')}, '%Y-%m-%d') AS requested_on,
  a.decided_by, a.decided_via, a.decided_at, a.note, a.resent_id`;

/** the total a Rs request counts together with (itself included) -> { total, count } */
async function splitOf(q, row) {
  const r = await rule(q, row.kind);
  if (r.unit !== 'Rs') return { total: Number(row.amount) || 0, count: 1 };
  const past = await splitPast(q, row.kind, { target: row.target, by: row.target ? null : row.requested_by, exceptId: row.approval_id });
  return { total: past.total + (Number(row.amount) || 0), count: past.count + 1 };
}

/** who can sign this request today (smallest limit first) -> [{ emp_id, name, via, limit }] */
async function signers(q, approvalId, ctx = null) {
  const [[row]] = await q.query(`SELECT ${ROW_COLS} FROM approvals a WHERE a.approval_id = ?`, [approvalId]);
  if (!row) return [];
  const c = ctx || await context(q);
  const lad = engine.ladder(asRequest(row), { ...c, split: await splitOf(q, row) });
  return lad.map((x) => ({ emp_id: x.person.emp_id, name: x.person.name, via: x.via ? { emp_id: x.via.emp_id, name: x.via.name } : null, limit: engine.limitText(x.limit), person: x.person }));
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

/** the signed-in person as the engine sees them (with their name) */
function meAmong(ctx, admin) {
  return ctx.people.find((p) => p.emp_id === admin.emp_id) || { ...admin, name: admin.emp_id, active: true };
}

/**
 * the queue for this person (req: their godown scope and the header picker): pending, decided ones, or their own.
 * As v23: a request shows when they can sign it now (also as someone's stand-in), raised it or decided it; the Super
 * admin, Admin and Sub-admin also see every other request at the godowns they see ("Everything else waiting").
 * Each row: can_decide / why_not, via (signing for whom), the ladder, the counting-together note.
 */
async function list(req, status) {
  const admin = req.admin;
  await expireOld(db);
  const where = status === 'pending' ? "a.status = 'pending'" : status === 'mine' ? 'a.requested_by = ?' : "a.status <> 'pending'";
  const [rows] = await db.query(`SELECT ${ROW_COLS} FROM approvals a WHERE ${where} ORDER BY a.approval_id DESC LIMIT 300`, status === 'mine' ? [admin.emp_id] : []);
  const ctx = await context(db);
  const me = meAmong(ctx, admin);
  const scope = godowns.viewScope(req);
  const seesAll = permissions.isAdminRole(admin.role_id) || Number(admin.role_id) === permissions.SUBADMIN_ROLE_ID;
  const ovr = await overridesOf(db, rows.map((r) => r.approval_id));
  const out = [];
  for (const r of rows) {
    const q = asRequest(r);
    const split = await splitOf(db, r);
    const d = engine.decide(me, q, { ...ctx, split });
    const sees = r.requested_by === admin.emp_id || d.ok || r.decided_by === admin.emp_id
      || (seesAll && (scope === null || scope.includes(Number(r.godown_id))));
    if (!sees) continue;
    const lad = r.status === 'pending' ? engine.ladder(q, { ...ctx, split }) : [];
    const via = r.decided_via && r.decided_via !== 'override' ? ctx.people.find((p) => p.emp_id === r.decided_via) : null;
    const o = ovr[r.approval_id] || null;
    const waitingOvr = o && o.status === 'waiting' ? o : null;
    const ovrWhy = r.status === 'pending' && admin.is_admin ? engine.overrideProblem(me, { ...q, payload: payloadOf(r) }, { ...ctx, split }, waitingOvr) : null;
    const dec = r.decided_by ? ctx.people.find((p) => p.emp_id === r.decided_by) : null;
    const asker = ctx.people.find((p) => p.emp_id === r.requested_by);
    out.push({
      ...r, payload: undefined, excluded: q.excluded, kind_label: (payloadOf(r) || {}).label || (KINDS[r.kind] || {}).label || r.kind, godown: ctx.godownNames[r.godown_id] || null,
      amount: admin.seesCost || !['write_off', 'stock_count', 'restock'].includes(r.kind) ? r.amount : null, // a cost figure: See cost only
      requested_by_name: asker ? asker.name : r.requested_by, decided_by_name: dec ? dec.name : r.decided_by,
      decided_via_name: r.decided_via === 'override' ? 'an override (24 hours, nobody cancelled)' : via ? via.name : null,
      override: o ? { ...o, set_by_name: (ctx.people.find((p) => p.emp_id === o.set_by) || {}).name || o.set_by,
        ended_by_name: o.ended_by ? (ctx.people.find((p) => p.emp_id === o.ended_by) || {}).name || o.ended_by : null } : null,
      can_override: ovrWhy === '', override_why_not: ovrWhy || null, can_cancel_override: Boolean(waitingOvr && admin.is_admin),
      can_send_again: r.status === 'expired' && r.requested_by === admin.emp_id && !r.resent_id,
      can_decide: r.status === 'pending' && d.ok, why_not: d.ok ? null : d.why, via: d.ok && d.via ? { emp_id: d.via.emp_id, name: d.via.name } : null,
      signers: lad.map((x) => ({ emp_id: x.person.emp_id, name: x.person.name, via: x.via ? x.via.name : null, limit: engine.limitText(x.limit) })),
      split_note: engine.splitNote(split, ctx.splitDays), mine: r.requested_by === admin.emp_id,
    });
  }
  return out;
}

/** menu badge: pending requests this person can sign */
async function countDecidable(admin) {
  try {
    const [rows] = await db.query(`SELECT ${ROW_COLS} FROM approvals a WHERE a.status = 'pending'`);
    if (!rows.length) return 0;
    const ctx = await context(db);
    const me = meAmong(ctx, admin);
    let n = 0;
    for (const r of rows) if (engine.decide(me, asRequest(r), { ...ctx, split: await splitOf(db, r) }).ok) n += 1;
    return n;
  } catch {
    return 0;
  }
}

// kinds that are not a dated business record (the month lock does not apply to them)
const UNDATED = ['rule_change', 'company_bank', 'after_export'];

async function decide(q, id, decision, note, admin) {
  if (!['approved', 'rejected'].includes(decision)) throw new ApprovalError('Approve or reject');
  const text = String(note || '').trim().slice(0, 500);
  if (decision === 'rejected' && !text) throw new ApprovalError('Say why it is rejected');
  const [[row]] = await q.query(`SELECT ${ROW_COLS} FROM approvals a WHERE a.approval_id = ? FOR UPDATE`, [id]);
  if (!row) throw new ApprovalError('No such request', 404);
  const ctx = await context(q);
  const d = engine.decide(meAmong(ctx, admin), asRequest(row), { ...ctx, split: await splitOf(q, row) });
  if (!d.ok) throw new ApprovalError(`You cannot decide this request: ${d.why}`, 403);
  if (decision === 'approved' && !UNDATED.includes(row.kind)) { // v23 T2: it posts on the date of its record
    const lockWhy = await require('./books').lockWhy(q, row.record_date || row.requested_on); // eslint-disable-line global-require
    if (lockWhy) throw new ApprovalError(`Cannot approve now: ${lockWhy} Reject it with a note; the person asks again.`, 409);
  }
  if (decision === 'approved' && recheckers[row.kind]) {
    const why = await recheckers[row.kind](q, payloadOf(row) || {}, row);
    if (why) throw new ApprovalError(`Cannot approve now: ${why}`, 409);
  }
  const via = d.via ? d.via.emp_id : null;
  await q.query('UPDATE approvals SET status = ?, decided_by = ?, decided_via = ?, decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ?', [decision, admin.emp_id, via, text || null, id]);
  let ran = false;
  if (decision === 'approved' && handlers[row.kind]) {
    await handlers[row.kind](q, payloadOf(row), admin.emp_id);
    ran = true;
  }
  if (decision === 'rejected' && closers[row.kind]) { await close(q, row, 'rejected', admin.emp_id); ran = true; }
  await audit(q, { empId: admin.emp_id, action: decision === 'approved' ? 'approve' : 'reject', entity: 'approval', entityId: String(id), before: { status: 'pending' },
    after: { status: decision, note: text || null, summary: row.summary, ran, ...(via ? { for: via, signed_by: admin.emp_id } : {}) } });
  return { approval_id: id, status: decision, ran, via: d.via ? { emp_id: d.via.emp_id, name: d.via.name } : null };
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

// ---------------------------------------------------------------- Send again (phase 12b)
/** the person who raised an expired request asks again: a fresh request with the same details -> new approval_id */
async function sendAgain(q, id, admin) {
  const [[row]] = await q.query(`SELECT ${ROW_COLS} FROM approvals a WHERE a.approval_id = ? FOR UPDATE`, [id]);
  if (!row) throw new ApprovalError('No such request', 404);
  if (row.requested_by !== admin.emp_id) throw new ApprovalError('Only the person who raised it can send it again', 403);
  if (row.status !== 'expired') throw new ApprovalError(`Only an expired request is sent again (this one is ${row.status})`, 409);
  if (row.resent_id) throw new ApprovalError(`Already sent again as request ${row.resent_id}`, 409);
  const p = payloadOf(row) || null;
  if (agains[row.kind]) {
    const why = await agains[row.kind](q, p || {}, row);
    if (why) throw new ApprovalError(`Cannot send it again: ${why}`, 409);
  } else if (closers[row.kind]) {
    throw new ApprovalError('Cannot send it again: when it expired, what it was about was closed. Ask again from where it was raised.', 409);
  }
  const newId = await request(q, { kind: row.kind, godownId: row.godown_id, refType: row.ref_type, refId: row.ref_id, target: row.target, summary: row.summary,
    amount: row.amount === null ? null : Number(row.amount), payload: p, excluded: excludedOf(row) }, admin.emp_id);
  await q.query('UPDATE approvals SET resent_id = ? WHERE approval_id = ?', [newId, id]);
  await audit(q, { empId: admin.emp_id, action: 'send_again', entity: 'approval', entityId: String(id), after: { new_request: newId } });
  return { approval_id: newId, from: id };
}

// ---------------------------------------------------------------- override (phase 12b)
const IST = (col) => `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+05:30'), '%Y-%m-%d %H:%i')`;
const OVR_COLS = `override_id, approval_id, set_by, reason, ${IST('set_at')} AS set_at, ${IST('apply_at')} AS apply_at,
  DATE_FORMAT(apply_at, '%Y-%m-%dT%H:%i:%sZ') AS apply_at_utc, status, ended_by, ${IST('ended_at')} AS ended_at, why`;
/** the latest override of each request -> { approval_id: row } */
async function overridesOf(q, ids) {
  if (!ids.length) return {};
  const [rows] = await q.query(`SELECT ${OVR_COLS} FROM approval_overrides WHERE approval_id IN (?) ORDER BY override_id`, [ids]);
  return Object.fromEntries(rows.map((r) => [r.approval_id, r]));
}
const letters = (s) => (String(s || '').match(/\p{L}/gu) || []).length;
const alert = (q, a) => notifications.adminAlert(q, a);

/** an Admin overrides a waiting rule change: it applies 24 hours later unless an Admin cancels it */
async function setOverride(q, id, reason, admin) {
  const text = String(reason || '').trim().slice(0, 500);
  if (letters(text) < 10) throw new ApprovalError('Reason: at least 10 letters (it goes into the audit log and to every Admin)');
  const [[row]] = await q.query(`SELECT ${ROW_COLS} FROM approvals a WHERE a.approval_id = ? FOR UPDATE`, [id]);
  if (!row) throw new ApprovalError('No such request', 404);
  const ctx = await context(q);
  const me = meAmong(ctx, admin);
  const [[waiting]] = await q.query("SELECT override_id FROM approval_overrides WHERE approval_id = ? AND status = 'waiting'", [id]);
  const why = engine.overrideProblem(me, { ...asRequest(row), payload: payloadOf(row) }, { ...ctx, split: await splitOf(q, row) }, waiting || null);
  if (why) throw new ApprovalError(`No override: ${why}`, 403);
  const [ins] = await q.query('INSERT INTO approval_overrides (approval_id, set_by, reason, apply_at) VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL 24 HOUR)', [id, admin.emp_id, text]);
  const [[o]] = await q.query(`SELECT ${OVR_COLS} FROM approval_overrides WHERE override_id = ?`, [ins.insertId]);
  await audit(q, { empId: admin.emp_id, action: 'override_set', entity: 'approval', entityId: String(id), after: { reason: text, applies_at: o.apply_at, summary: row.summary } });
  await alert(q, { subject: `Override set: ${row.summary}`, ref: `approval ${id}`, by: admin.emp_id,
    body: `${me.name} has overridden "${row.summary}" because every other Admin is away.\nReason: ${text}\nIt applies at ${o.apply_at} (India time) unless an Admin cancels it in Approvals.` });
  return { approval_id: id, override: o };
}

/** any Admin cancels a waiting override */
async function cancelOverride(q, id, admin, note = '') {
  if (!admin.is_admin) throw new ApprovalError('Only an Admin cancels an override', 403);
  const [[o]] = await q.query("SELECT override_id FROM approval_overrides WHERE approval_id = ? AND status = 'waiting' FOR UPDATE", [id]);
  if (!o) throw new ApprovalError('No override waits on this request', 409);
  const [[row]] = await q.query('SELECT summary FROM approvals WHERE approval_id = ?', [id]);
  const why = String(note || '').trim().slice(0, 500) || 'cancelled by an Admin';
  await q.query("UPDATE approval_overrides SET status = 'cancelled', ended_by = ?, ended_at = UTC_TIMESTAMP(), why = ? WHERE override_id = ?", [admin.emp_id, why, o.override_id]);
  await audit(q, { empId: admin.emp_id, action: 'override_cancel', entity: 'approval', entityId: String(id), after: { why } });
  const me = meAmong(await context(q), admin);
  await alert(q, { subject: `Override cancelled: ${row.summary}`, ref: `approval ${id}`, by: admin.emp_id, body: `${me.name} cancelled the override of "${row.summary}". It waits for a second Admin again.` });
  return { approval_id: id, cancelled: true };
}

/** one waiting override that is due: stop it (the other Admin is back, or the request ended), or apply it */
async function settleOverride(q, o) {
  const [[row]] = await q.query(`SELECT ${ROW_COLS} FROM approvals a WHERE a.approval_id = ? FOR UPDATE`, [o.approval_id]);
  const end = async (status, why) => {
    await q.query("UPDATE approval_overrides SET status = ?, ended_by = 'system', ended_at = UTC_TIMESTAMP(), why = ? WHERE override_id = ?", [status, why, o.override_id]);
    await audit(q, { empId: 'system', action: `override_${status}`, entity: 'approval', entityId: String(o.approval_id), after: { why } });
  };
  if (!row || row.status !== 'pending') { await end('stopped', `the request is ${row ? row.status : 'gone'}`); return 'stopped'; }
  const ctx = await context(q);
  const by = ctx.people.find((p) => p.emp_id === o.set_by);
  if (!by || by.active === false || !engine.othersAway(by, ctx.people, ctx.today)) { // v23 Y3: re-checked when it applies
    await end('stopped', 'the other Admin is back, so they decide it');
    await alert(q, { subject: `Override stopped: ${row.summary}`, ref: `approval ${row.approval_id}`, body: `The override of "${row.summary}" did not apply: the other Admin is back and decides it.` });
    return 'stopped';
  }
  const p = payloadOf(row) || {};
  const why = recheckers[row.kind] ? await recheckers[row.kind](q, p, row) : '';
  if (why) {
    await q.query("UPDATE approvals SET status = 'rejected', decided_by = ?, decided_via = 'override', decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ?",
      [o.set_by, `Override could not apply: ${why}`.slice(0, 500), row.approval_id]);
    await close(q, row, 'rejected', o.set_by);
    await end('failed', why);
    await alert(q, { subject: `Override could not apply: ${row.summary}`, ref: `approval ${row.approval_id}`, body: `The override of "${row.summary}" could not apply: ${why}` });
    return 'failed';
  }
  await q.query("UPDATE approvals SET status = 'approved', decided_by = ?, decided_via = 'override', decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ?",
    [o.set_by, `Override: ${o.reason}`.slice(0, 500), row.approval_id]);
  if (handlers[row.kind]) await handlers[row.kind](q, p, o.set_by);
  await end('applied', 'nobody cancelled it in 24 hours');
  await audit(q, { empId: o.set_by, action: 'approve', entity: 'approval', entityId: String(row.approval_id), before: { status: 'pending' },
    after: { status: 'approved', via: 'override', reason: o.reason, summary: row.summary } });
  await alert(q, { subject: `Override applied: ${row.summary}`, ref: `approval ${row.approval_id}`, body: `The override of "${row.summary}" applied after 24 hours.\nReason: ${o.reason}` });
  return 'applied';
}

/** every due override (each in its own transaction), then the daily notices about an Admin marked as left */
async function sweepOverrides() {
  const [due] = await db.query("SELECT override_id, approval_id, set_by, reason FROM approval_overrides WHERE status = 'waiting' AND apply_at <= UTC_TIMESTAMP()");
  const out = [];
  for (const o of due) {
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      out.push({ approval_id: o.approval_id, result: await settleOverride(c, o) });
      await c.commit();
    } catch (e) {
      await c.rollback();
      console.error('override sweep failed:', e.code || e.message);
    } finally { c.release(); }
  }
  await leftNotices(db).catch((e) => console.error('left notices failed:', e.code || e.message));
  return out;
}

/** v23 N2: an Admin marked as left by someone else: a notice to every Admin once a day for 7 days */
async function leftNotices(q) {
  const ctx = await context(q);
  for (const x of ctx.people.filter((p) => p.is_admin && p.active === false && p.left && p.left.at && p.left.by && p.left.by !== p.emp_id)) {
    const d = engine.dayDiff(x.left.at, ctx.today);
    if (d < 1 || d > 7) continue;
    const ref = `left ${x.emp_id} ${ctx.today}`;
    const [[sent]] = await q.query("SELECT log_id FROM notification_log WHERE event_key = 'admin_alert' AND ref = ? LIMIT 1", [ref]);
    if (sent) continue;
    const marker = ctx.people.find((p) => p.emp_id === x.left.by);
    const mName = marker ? marker.name : x.left.by;
    await alert(q, { subject: `Reminder: ${x.name} is marked as left`, ref,
      body: `Day ${d} of 7: ${x.name} was marked as left by ${mName} on ${x.left.at}. ${d < 7 ? `An override by ${mName} cannot use this until ${engine.addDays(x.left.at, 7)}.` : 'From today an override can use it.'}` });
  }
}

let timer = null;
/** the 24 hours are checked every minute (server.js starts it), not only when a page is read */
function startOverrideJob() {
  if (timer) return;
  timer = setInterval(() => { sweepOverrides().catch((e) => console.error('override sweep failed:', e.code || e.message)); }, 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  sendAgain, onAgain, setOverride, cancelOverride, settleOverride, sweepOverrides, leftNotices, startOverrideJob, overridesOf, UNDATED,
  KINDS, ApprovalError, onApproved, onClosed, onRecheck, rules, rule, check, needed, direct, request, people, context, signers, list, countDecidable,
  decide, withdraw, expireOld, splitPast,
};
