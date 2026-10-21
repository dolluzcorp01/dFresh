// The customer wallet (docs/COMMERCE-SPEC.md 4.5; migration 20261021_commerce_wallet_promotions.sql). Shared by the
// orders (use, give back), returns (refund to the wallet, cashback taken back), promotions (cashback, manual credit /
// debit, expiry) and the demo seed.
// - Balance = SUM(amount). A credit (cashback, refund, manual) keeps `remaining` and its expiry date (Commerce settings:
//   days per source, 0 = never; refunds never expire by default).
// - A use on an order or a debit takes from the credits oldest first (wallet_allocations); a cancelled or edited order
//   gives back exactly what it took, to the same credits.
// - Expiry (the hourly job and the Run now button): what is left of an expired credit leaves the wallet as an
//   "expired" entry.
// Every entry is audited.
const { audit } = require('./audit');
const commerceSettings = require('./commerce-settings');

const SOURCES = { cashback: 'Cashback', refund: 'Refund', manual: 'Manual', used: 'Used on an order', expired: 'Expired', reversed: 'Cashback taken back' };
const CREDITS = ['cashback', 'refund', 'manual'];
const round2 = (n) => Math.round(n * 100) / 100;
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";

async function balance(q, customerId) {
  const [[r]] = await q.query('SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_entries WHERE customer_id = ?', [customerId]);
  return round2(Number(r.bal));
}

/** the credits that can still be used, oldest first, as if `orderId`'s own uses were given back (editing it) */
async function usable(q, customerId, orderId = 0) {
  const [rows] = await q.query(
    `SELECT e.entry_id, e.source, e.created_at, e.remaining + COALESCE((SELECT SUM(a.amount) FROM wallet_allocations a JOIN wallet_entries u ON u.entry_id = a.debit_entry_id
              WHERE a.credit_entry_id = e.entry_id AND a.given_back = 0 AND u.source = 'used' AND u.order_id = ?), 0) AS left_amt
       FROM wallet_entries e
      WHERE e.customer_id = ? AND e.source IN ('cashback', 'refund', 'manual') AND (e.expires_on IS NULL OR e.expires_on >= ${IST_TODAY})
      ORDER BY e.created_at, e.entry_id`, [orderId || 0, customerId]);
  return rows.map((r) => ({ entry_id: r.entry_id, source: r.source, left: round2(Number(r.left_amt)) })).filter((r) => r.left > 0.005);
}

/** how `amount` would be taken (oldest first) -> { take: [{ entry_id, source, amount }], total, bySource } */
async function plan(q, customerId, amount, orderId = 0) {
  let left = round2(amount);
  const take = [];
  for (const c of await usable(q, customerId, orderId)) {
    if (left <= 0.005) break;
    const t = round2(Math.min(left, c.left));
    take.push({ entry_id: c.entry_id, source: c.source, amount: t });
    left = round2(left - t);
  }
  const bySource = {};
  take.forEach((t) => { bySource[t.source] = round2((bySource[t.source] || 0) + t.amount); });
  return { take, total: round2(take.reduce((a, t) => a + t.amount, 0)), bySource };
}

async function expiryFor(q, source) {
  const s = await commerceSettings.read(q);
  const days = Number(s[`wallet_expiry_${source}_days`]) || 0;
  if (!days) return null;
  return new Date(Date.now() + 5.5 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
}

/** a credit: cashback | refund | manual -> entry_id */
async function credit(q, { customerId, source, amount, reason, orderId = null, returnId = null, approvalId = null, expiresOn }, empId) {
  if (!CREDITS.includes(source)) throw new Error(`wallet.credit: ${source}`);
  const amt = round2(amount);
  if (amt <= 0) return null;
  const exp = expiresOn === undefined ? await expiryFor(q, source) : expiresOn;
  const [ins] = await q.query(
    'INSERT INTO wallet_entries (customer_id, source, amount, remaining, expires_on, reason, order_id, return_id, approval_id, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [customerId, source, amt, amt, exp, String(reason).slice(0, 200), orderId, returnId, approvalId, empId]);
  await audit(q, { empId, action: 'credit', entity: 'wallet', entityId: String(customerId), after: { entry: ins.insertId, source, amount: amt, expires_on: exp, reason } });
  return ins.insertId;
}

/** a debit (used on an order, cashback reversed, manual): takes from the credits oldest first; may leave a negative balance */
async function debit(q, { customerId, source, amount, reason, orderId = null, returnId = null, approvalId = null }, empId) {
  const amt = round2(amount);
  if (amt <= 0) return null;
  const p = await plan(q, customerId, amt);
  const [ins] = await q.query('INSERT INTO wallet_entries (customer_id, source, amount, reason, order_id, return_id, approval_id, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [customerId, source, -amt, String(reason).slice(0, 200), orderId, returnId, approvalId, empId]);
  for (const t of p.take) {
    await q.query('INSERT INTO wallet_allocations (debit_entry_id, credit_entry_id, amount) VALUES (?, ?, ?)', [ins.insertId, t.entry_id, t.amount]);
    await q.query('UPDATE wallet_entries SET remaining = remaining - ? WHERE entry_id = ?', [t.amount, t.entry_id]);
  }
  await audit(q, { empId, action: 'debit', entity: 'wallet', entityId: String(customerId), after: { entry: ins.insertId, source, amount: -amt, reason, order_id: orderId, took: p.take } });
  return { entry_id: ins.insertId, bySource: p.bySource };
}

/** an order uses the wallet -> { bySource } (what each source gave) */
async function use(q, customerId, amount, orderId, orderNo, empId) {
  const bal = await balance(q, customerId);
  if (round2(amount) > bal + 0.005) throw Object.assign(new Error(`The wallet has only Rs ${bal.toFixed(2)}`), { status: 400 });
  return debit(q, { customerId, source: 'used', amount, reason: `Used on ${orderNo}`, orderId }, empId);
}

/** the order's uses go back to the credits they came from (cancelled, or edited before using again) -> amount */
async function giveBack(q, orderId, why, empId) {
  const [alloc] = await q.query(
    `SELECT a.id, a.credit_entry_id, a.amount, u.customer_id FROM wallet_allocations a JOIN wallet_entries u ON u.entry_id = a.debit_entry_id
      WHERE u.order_id = ? AND u.source = 'used' AND u.amount < 0 AND a.given_back = 0 FOR UPDATE`, [orderId]);
  const [[used]] = await q.query("SELECT customer_id, COALESCE(-SUM(amount), 0) AS net FROM wallet_entries WHERE order_id = ? AND source = 'used' GROUP BY customer_id", [orderId]);
  if (!used || Number(used.net) <= 0.005) return 0;
  for (const a of alloc) {
    await q.query('UPDATE wallet_entries SET remaining = remaining + ? WHERE entry_id = ?', [a.amount, a.credit_entry_id]);
    await q.query('UPDATE wallet_allocations SET given_back = 1 WHERE id = ?', [a.id]);
  }
  const amt = round2(Number(used.net));
  await q.query("INSERT INTO wallet_entries (customer_id, source, amount, reason, order_id, emp_id) VALUES (?, 'used', ?, ?, ?, ?)", [used.customer_id, amt, String(why).slice(0, 200), orderId, empId]);
  await audit(q, { empId, action: 'give_back', entity: 'wallet', entityId: String(used.customer_id), after: { order_id: orderId, amount: amt, why } });
  return amt;
}

/** expired credits leave the wallet (never more than the balance) -> [{ customer_id, amount }] */
async function expireDue(q, empId = 'system') {
  const [due] = await q.query(`SELECT entry_id, customer_id, remaining, source, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on FROM wallet_entries
      WHERE expires_on IS NOT NULL AND expires_on < ${IST_TODAY} AND remaining > 0.005 ORDER BY customer_id, entry_id FOR UPDATE`);
  const out = [];
  for (const e of due) {
    const bal = await balance(q, e.customer_id);
    const amt = round2(Math.min(Number(e.remaining), Math.max(bal, 0)));
    await q.query('UPDATE wallet_entries SET remaining = 0 WHERE entry_id = ?', [e.entry_id]);
    if (amt <= 0.005) continue;
    const [ins] = await q.query("INSERT INTO wallet_entries (customer_id, source, amount, reason, emp_id) VALUES (?, 'expired', ?, ?, ?)",
      [e.customer_id, -amt, `${SOURCES[e.source]} credit #${e.entry_id} expired on ${e.expires_on}`, empId]);
    await q.query('INSERT INTO wallet_allocations (debit_entry_id, credit_entry_id, amount) VALUES (?, ?, ?)', [ins.insertId, e.entry_id, amt]);
    await audit(q, { empId, action: 'expire', entity: 'wallet', entityId: String(e.customer_id), after: { credit: e.entry_id, amount: -amt } });
    out.push({ customer_id: e.customer_id, amount: amt });
  }
  return out;
}

/** the statement: entries oldest first with the running balance, what expires next */
async function statement(q, customerId) {
  const [rows] = await q.query(
    `SELECT w.entry_id, w.source, w.amount, w.remaining, DATE_FORMAT(w.expires_on, '%Y-%m-%d') AS expires_on, w.reason, w.created_at, w.emp_id, w.approval_id, o.order_no, r.return_no
       FROM wallet_entries w LEFT JOIN orders o ON o.order_id = w.order_id LEFT JOIN returns r ON r.return_id = w.return_id
      WHERE w.customer_id = ? ORDER BY w.created_at, w.entry_id`, [customerId]);
  let run = 0;
  const entries = rows.map((r) => {
    run = round2(run + Number(r.amount));
    return { ...r, amount: Number(r.amount), remaining: r.remaining === null ? null : Number(r.remaining), balance: run, source_label: SOURCES[r.source] };
  });
  const expiring = entries.filter((e) => e.expires_on && e.remaining > 0.005).map((e) => ({ entry_id: e.entry_id, source: e.source, remaining: e.remaining, expires_on: e.expires_on }));
  return { entries, balance: run, expiring };
}

module.exports = { SOURCES, balance, usable, plan, credit, debit, use, giveBack, expireDue, statement };
