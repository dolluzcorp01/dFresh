// The second-Admin gate (phase 12b; v23 Foundation, fix proof F1, N1, N13, N14, Y5, Y10). A change that loosens a
// control or widens who can sign does not happen at once: it becomes a "rule_change" request (a bank detail: a
// "company_bank" request) that only another Admin signs (approval-engine.js), and the change is made, in the same
// transaction, when it is approved. Until then everything stays as it is.
// - What waits: an approval rule switched off or its limit raised; a switch that loosens a control (LOOSEN below);
//   moving "Books closed up to" back; a role's wider rights (any Approve, a higher limit, See cost); adding or
//   bringing back someone who can sign (they stay inactive); a higher personal limit; a wider godown scope; a role
//   that signs more; taking the Admin role away; narrowing an Admin's godowns or lowering an Admin's limit.
// - Each request carries { t, dk, ... } in its payload: t = what to do (APPLY below, or registered by the module that
//   owns the change), dk = what it changes (one waiting request per dk: asking again answers "Already waiting").
// - A bank change and anything that changes who can sign is never overridden (approval-engine NEVER_OVERRIDE).
const { audit } = require('./audit');
const approvals = require('./approvals');
const engine = require('./approval-engine');

class GateError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

// Switches (Commerce settings) whose change in this direction loosens a control (v23 SW_WEAK, Y5)
const LOOSEN = {
  approval_expiry_days: 'up', split_days: 'down', wallet_max_use_pct: 'up', return_window_days: 'up', eway_bill_above: 'up',
  manual_discount_allowed: 'on', returned_resell: 'on', delivery_otp: 'off', eway_bill_required: 'off',
  return_outside_window: ['refuse', 'approval'], cashback_credit_at: ['after_window', 'delivery'],
  quarantine: 'off', freight_cost: 'off', claim_days: 'up', // phase 16 (v23 Y5: freight into the average cost off is a weakening)
};
// ranges that stop silly values (v23 SW_RANGE)
// (phase 13: every number on the Switches page has one; the page shows them and the PUT enforces them)
const RANGE = {
  approval_expiry_days: [1, 30], split_days: [1, 30], wallet_max_use_pct: [0, 100], return_window_days: [0, 60],
  eway_bill_above: [0, 500000], order_min_value_default: [0, 100000], expiry_warn_days: [1, 365], slow_moving_days: [7, 365],
  claim_days: [0, 90],
};

/** does changing setting `key` from `from` to `to` (stored text) loosen a control? */
function settingLoosens(key, from, to) {
  const w = LOOSEN[key];
  if (!w) return false;
  if (Array.isArray(w)) return from === w[0] && to === w[1];
  if (w === 'up') return Number(to) > Number(from);
  if (w === 'down') return Number(to) < Number(from);
  if (w === 'on') return from !== '1' && to === '1';
  return from === '1' && to !== '1'; // off
}

const handlers = {};
/** a module registers what a waiting change of type t does once approved, and (optionally) when it is not */
function on(t, { apply, closed = null, recheck = null }) { handlers[t] = { apply, closed, recheck }; }

/** "Waiting for Shoban B" / "Nobody can sign it today ..." for a request just made */
async function waitingLine(q, approvalId) {
  const s = await approvals.signers(q, approvalId);
  return s.length ? `Waiting for ${s.map((x) => x.name).join(' or ')}.` : 'Nobody can sign it today: it waits for a second Admin (an override is possible only when every other Admin is away).';
}

/**
 * hold a change for a second Admin -> { waiting: true, approval_id, message } (or the one already waiting for the
 * same thing: { already: true }). kind: rule_change (default), company_bank or supplier_bank.
 */
async function ask(q, { t, dk, summary, payload = {}, kind = 'rule_change' }, empId) {
  const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE kind = ? AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [kind, dk]);
  if (w) return { waiting: true, already: true, approval_id: w.approval_id, message: `Already waiting: ${await waitingLine(q, w.approval_id)}` };
  const id = await approvals.request(q, { kind, godownId: 1, refType: 'rule_change', refId: String(dk).slice(0, 60), summary, payload: { ...payload, t, dk } }, empId);
  return { waiting: true, approval_id: id, message: `${summary}. Until a second Admin signs, it stays as it is. ${await waitingLine(q, id)}` };
}

/** pending change of this thing (dk), if any -> approval_id */
async function pending(q, dk, kind = 'rule_change') {
  const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE kind = ? AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [kind, dk]);
  return w ? w.approval_id : null;
}

// ---------------------------------------------------------------- the changes this module makes itself
on('rule', {
  async apply(q, p, empId) {
    const [[r]] = await q.query('SELECT kind, is_on, limit_value, limit_packs FROM approval_rules WHERE kind = ? FOR UPDATE', [p.kind]);
    if (!r) return;
    await q.query('UPDATE approval_rules SET is_on = ?, limit_value = ?, limit_packs = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE kind = ?', [p.on, p.value, p.packs, empId, p.kind]);
    await audit(q, { empId, action: 'update', entity: 'approval_rule', entityId: p.kind, before: { on: Number(r.is_on), limit: r.limit_value === null ? null : Number(r.limit_value), packs: r.limit_packs },
      after: { on: p.on, limit: p.value, packs: p.packs, approved: true } });
  },
});
async function setSetting(q, key, value, empId) {
  const [[row]] = await q.query('SELECT value FROM commerce_settings WHERE setting_key = ? FOR UPDATE', [key]);
  if (!row) return;
  await q.query('UPDATE commerce_settings SET value = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE setting_key = ?', [value, empId, key]);
  await audit(q, { empId, action: 'update', entity: 'commerce_setting', entityId: key, before: { value: row.value }, after: { value, approved: true } });
}
on('switch', { apply: (q, p, empId) => setSetting(q, p.key, p.value, empId) });
on('books', { apply: (q, p, empId) => setSetting(q, 'books_closed_to', p.value, empId) });
on('bank', { apply: (q, p, empId) => setSetting(q, p.key, p.value, empId) });

approvals.onApproved('rule_change', async (q, p, empId) => { if (p && handlers[p.t]) await handlers[p.t].apply(q, p, empId); });
approvals.onApproved('company_bank', async (q, p, empId) => { if (p && handlers[p.t]) await handlers[p.t].apply(q, p, empId); });
approvals.onApproved('supplier_bank', async (q, p, empId) => { if (p && handlers[p.t]) await handlers[p.t].apply(q, p, empId); });
approvals.onClosed('supplier_bank', async (q, p, status, empId) => { if (p && handlers[p.t] && handlers[p.t].closed) await handlers[p.t].closed(q, p, status, empId); });
approvals.onClosed('rule_change', async (q, p, status, empId) => { if (p && handlers[p.t] && handlers[p.t].closed) await handlers[p.t].closed(q, p, status, empId); });
approvals.onRecheck('rule_change', async (q, p) => (p && handlers[p.t] && handlers[p.t].recheck ? handlers[p.t].recheck(q, p) : ''));

module.exports = { GateError, LOOSEN, RANGE, settingLoosens, on, ask, pending, waitingLine, NEVER_OVERRIDE: engine.NEVER_OVERRIDE };
