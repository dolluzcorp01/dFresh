// Money > Payments > Supplier payments (phase 16, v23 section 11 "SUPPLIER PAYMENTS"; bills from buying-routes.js).
// Rights: the roles grid row "Payments" (money): view = the page (for the office: a role limited to its own customers
// does not see it), create = pay, approve = sign a payment above the limit (Home > Approvals).
// - A bill is paid only once it is matched or its difference approved (unpaid or part paid); oldest due first, and the
//   micro and small (MSME) bills past 45 days are flagged first.
// - Money goes only to the supplier's APPROVED bank account: no approved account = no payment of any kind (v22 B6); a
//   new account waiting for a second Admin does not stop payments, they go to the approved one (v23 Low). The account is
//   kept with the payment; a payment signed later checks it is still the approved one.
// - Above the "Pay a supplier" rule (Rs 25,000) a second person signs it; payments to one supplier within "Days that
//   count together" add up (split counting). Money already waiting in another payment cannot be asked for twice (v21).
// - The payment date checks the month lock (books.js); a payment signed later checks it on that date.
const buy = require('./buying');
const { audit } = require('./audit');
const approvals = require('./approvals');
const secondAdmin = require('./second-admin');
const numbering = require('./numbering');
const books = require('./books');
const godowns = require('./godowns');
const rules = require('../shared/buyRules');

const { r2, rs, BuyError } = buy;
const MODES = Object.fromEntries(rules.PAY_MODES);

/** money of a bill already asked for in payments still waiting (except one) */
async function pending(q, billId, exceptPay = 0) {
  const [[r]] = await q.query("SELECT COALESCE(SUM(pl.amount), 0) AS n FROM supplier_payment_lines pl JOIN supplier_payments p ON p.pay_id = pl.pay_id WHERE pl.bill_id = ? AND p.status = 'waiting' AND p.pay_id <> ?", [billId, Number(exceptPay) || 0]);
  return r2(r.n);
}
/** what can still be asked for on a bill: left to pay less what other payments wait for */
async function free(q, b, exceptPay = 0) { return r2(Math.max(0, Number(b.total) - Number(b.paid) - (await pending(q, b.bill_id, exceptPay)))); }

async function paySupplier(q, payId, empId) {
  const [[p]] = await q.query('SELECT pay_id, pay_no, supplier_id, amount, mode, reference FROM supplier_payments WHERE pay_id = ? FOR UPDATE', [payId]);
  await q.query("UPDATE supplier_payments SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE pay_id = ?", [payId]);
  const [ls] = await q.query('SELECT bill_id FROM supplier_payment_lines WHERE pay_id = ?', [payId]);
  for (const l of ls) await buy.setBillPaid(q, l.bill_id);
  await audit(q, { empId, action: 'pay', entity: 'supplier_payment', entityId: p.pay_no, after: { amount: Number(p.amount), mode: MODES[p.mode], reference: p.reference } });
}

function register({ route, tx, db, by, InputError, canDo, commerceGate }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e instanceof BuyError || e instanceof books.BooksError || e instanceof godowns.GodownError) { const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x; }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const office = (req) => { if (req.admin.ownOnly) throw new InputError('Supplier payments are for the office, not for a role limited to its own customers.', 403); };
  const scopeOf = (req) => godowns.viewScope(req);

  async function openBills(q, req, supplierId = null) {
    const sc = scopeOf(req);
    const [gw, gp] = godowns.where('b.godown_id', sc);
    const [rows] = await q.query(`SELECT b.bill_id, b.bill_no, b.supplier_bill_no, b.supplier_id, s.name AS supplier, s.msme_type, s.bank_acc, b.godown_id, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due_date,
        b.total, b.paid FROM supplier_bills b JOIN suppliers s ON s.supplier_id = b.supplier_id
        WHERE b.status IN ('unpaid', 'part') AND b.total - b.paid > 0.004 AND ${gw}${supplierId ? ' AND b.supplier_id = ?' : ''} ORDER BY b.due_date, b.bill_id`, supplierId ? [...gp, Number(supplierId)] : gp);
    const out = [];
    for (const b of rows) out.push({ ...b, left: r2(Number(b.total) - Number(b.paid)), pending: await pending(q, b.bill_id), free: await free(q, b), msme_late: buy.msmeSmall(b) && b.due_date < buy.today() });
    return out;
  }
  route('get', '/money/supplier-payments', 'money:view', wrap(async (req) => {
    office(req);
    const bills = await openBills(db, req);
    const [waits] = await db.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.supplier_id')) AS sid FROM approvals WHERE kind = 'supplier_bank' AND status = 'pending'");
    const bankWait = new Set(waits.map((w) => Number(w.sid)));
    const by_supplier = [];
    for (const b of bills) {
      let s = by_supplier.find((x) => x.supplier_id === b.supplier_id);
      if (!s) { s = { supplier_id: b.supplier_id, name: b.supplier, msme: b.msme_type, bank_waiting: bankWait.has(b.supplier_id), no_bank: !b.bank_acc, bills: [], total: 0 }; by_supplier.push(s); }
      s.bills.push({ bill_id: b.bill_id, bill_no: b.bill_no, their_no: b.supplier_bill_no, left: b.left, due_date: b.due_date, msme_late: b.msme_late });
      s.total = r2(s.total + b.left);
    }
    const [gw, gp] = godowns.where('b.godown_id', scopeOf(req));
    const [pays] = await db.query(`SELECT DISTINCT p.pay_id, p.pay_no, p.supplier_id, s.name AS supplier, p.amount, p.mode, p.reference, DATE_FORMAT(p.paid_on, '%Y-%m-%d') AS paid_on, p.status, p.approval_id
        FROM supplier_payments p JOIN suppliers s ON s.supplier_id = p.supplier_id JOIN supplier_payment_lines pl ON pl.pay_id = p.pay_id JOIN supplier_bills b ON b.bill_id = pl.bill_id
        WHERE ${gw} ORDER BY p.pay_id DESC`, gp);
    const ids = pays.map((p) => p.pay_id);
    const [pl] = ids.length ? await db.query('SELECT pl.pay_id, b.bill_no, pl.amount FROM supplier_payment_lines pl JOIN supplier_bills b ON b.bill_id = pl.bill_id WHERE pl.pay_id IN (?)', [ids]) : [[]];
    const rows = [];
    for (const p of pays) rows.push({ ...p, amount: Number(p.amount), mode_label: MODES[p.mode], bills: pl.filter((x) => x.pay_id === p.pay_id).map((x) => ({ bill_no: x.bill_no, amount: Number(x.amount) })),
      waiting: p.status === 'waiting' && p.approval_id ? await secondAdmin.waitingLine(db, p.approval_id) : null });
    const rule = await approvals.rule(db, 'supplier_pay');
    return { to_pay: by_supplier, msme_late: bills.filter((b) => b.msme_late).length, waiting: rows.filter((r) => r.status === 'waiting'), paid: rows.filter((r) => r.status === 'paid'),
      counts: { to_pay: bills.length, waiting: rows.filter((r) => r.status === 'waiting').length, paid: rows.filter((r) => r.status === 'paid').length },
      rule: { on: rule.is_on, above: rule.limit_value }, can: { create: canDo(req, 'money', 'create') } };
  }), G);
  route('get', '/money/supplier-payments/form/:supplier', 'money:create', wrap(async (req) => {
    office(req);
    const s = await buy.supplierOf(db, req.params.supplier);
    if (!s) throw new InputError('No such supplier', 404);
    const [[w]] = await db.query("SELECT approval_id FROM approvals WHERE kind = 'supplier_bank' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`supbank:${s.supplier_id}`]);
    const bills = await openBills(db, req, s.supplier_id);
    return { supplier: { supplier_id: s.supplier_id, name: s.name, msme: s.msme_type },
      bank: s.bank_acc ? { holder: s.bank_holder || s.name, name: s.bank_name, acc: rules.maskAcc(s.bank_acc), ending: s.bank_acc.slice(-4), ifsc: s.bank_ifsc } : null, bank_waiting: Boolean(w),
      bills: bills.map((b) => ({ bill_id: b.bill_id, bill_no: b.bill_no, their_no: b.supplier_bill_no, due_date: b.due_date, left: b.left, pending: b.pending, free: b.free, msme_late: b.msme_late })),
      modes: rules.PAY_MODES, today: buy.today(), rule: (await approvals.rule(db, 'supplier_pay')) };
  }), G);
  route('post', '/money/supplier-payments', 'money:create', wrap(async (req) => tx(async (q) => {
    office(req);
    const b = req.body || {};
    const s = await buy.supplierOf(q, b.supplier_id, true);
    if (!s) throw new InputError('No such supplier', 404);
    // v22 B6: no approved account, no payment of any kind; v23: a change waiting does not stop payments to the approved one
    if (!s.bank_acc) throw new InputError(`${s.name} has no approved bank account. Add one in Suppliers first; every payment mode waits for it.`, 409);
    const e = {};
    const raw = (Array.isArray(b.bills) ? b.bills : []).filter((x) => x && x.bill_id);
    if (!raw.length) throw new InputError('Tick a bill: choose at least one bill to pay.');
    const lines = [];
    let gid = null;
    for (const [i, x] of raw.entries()) {
      const [[bl]] = await q.query('SELECT bill_id, bill_no, supplier_id, godown_id, status, total, paid FROM supplier_bills WHERE bill_id = ? FOR UPDATE', [Number(x.bill_id)]);
      if (!bl || bl.supplier_id !== s.supplier_id) { e[`bills.${i}.amount`] = 'Not a bill of this supplier.'; continue; }
      godowns.assertSees(req, bl.godown_id, 'Not found');
      if (!['unpaid', 'part'].includes(bl.status)) { e[`bills.${i}.amount`] = `${bl.bill_no} is ${bl.status === 'waiting' ? 'waiting for approval: it is paid only once matched or approved' : bl.status}.`; continue; }
      const fr = await free(q, bl);
      const amt = r2(x.amount);
      if (!(amt > 0) || amt > fr + 0.004) { const pd = await pending(q, bl.bill_id); e[`bills.${i}.amount`] = `${bl.bill_no}: 0 to ${rs(fr)}${pd ? ` (${rs(pd)} is already waiting in another payment)` : ''}.`; continue; }
      gid = gid || bl.godown_id;
      lines.push({ bill_id: bl.bill_id, bill_no: bl.bill_no, amount: amt });
    }
    const ref = String(b.reference || '').trim().slice(0, 30);
    if (ref.length < 6) e.reference = 'The UTR or cheque number.';
    const mode = MODES[b.mode] ? b.mode : null;
    if (!mode) e.mode = 'Choose how it was paid.';
    const dt = String(b.paid_on || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || dt > buy.today()) e.paid_on = 'Today or earlier.'; else { const lw = await books.lockWhy(q, dt); if (lw) e.paid_on = lw; }
    if (Object.keys(e).length) buy.bad(e);
    const total = r2(lines.reduce((a, l) => a + l.amount, 0));
    const no = await numbering.issue(q, 'spay', null, new Date(`${dt}T12:00:00+05:30`));
    const [ins] = await q.query('INSERT INTO supplier_payments (pay_no, supplier_id, amount, mode, reference, paid_on, to_acc, to_ifsc, status, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [no, s.supplier_id, total, mode, ref, dt, s.bank_acc, s.bank_ifsc, 'waiting', by(req)]);
    for (const l of lines) await q.query('INSERT INTO supplier_payment_lines (pay_id, bill_id, amount) VALUES (?, ?, ?)', [ins.insertId, l.bill_id, l.amount]);
    const target = `sup:${s.supplier_id}`;
    const c = await approvals.check(q, 'supplier_pay', { amount: total, target });
    await audit(q, { empId: by(req), action: 'create', entity: 'supplier_payment', entityId: no, after: { supplier: s.name, amount: total, bills: lines.map((l) => `${l.bill_no} ${l.amount}`), to: rules.maskAcc(s.bank_acc), waiting: c.needs } });
    if (c.needs) {
      const before = r2(c.total - total);
      const note = before > 0 ? ` With ${c.count} more in the last ${c.days} days (${rs(before)}), the total is ${rs(c.total)}.` : '';
      const aid = await approvals.request(q, { kind: 'supplier_pay', godownId: gid, refType: 'supplier_payment', refId: no, target, recordDate: dt, amount: total,
        summary: `Pay ${s.name} ${rs(total)} for ${lines.map((l) => l.bill_no).join(', ')} to ${rules.maskAcc(s.bank_acc)}${note}`, payload: { t: 'spay', pay_id: ins.insertId, supplier_id: s.supplier_id } }, by(req));
      await q.query('UPDATE supplier_payments SET approval_id = ? WHERE pay_id = ?', [aid, ins.insertId]);
      return { pay_no: no, waiting: true, message: `Above ${buy.rs0((await approvals.rule(q, 'supplier_pay')).limit_value)}: a second person signs it before the money goes.${note} ${await secondAdmin.waitingLine(q, aid)}` };
    }
    await approvals.direct(q, 'supplier_pay', { amount: total, target }, by(req));
    await paySupplier(q, ins.insertId, by(req));
    return { pay_no: no, message: `${no} paid: ${rs(total)} to ${s.name} (${rules.maskAcc(s.bank_acc)}). The bills are updated.` };
  })), { ...G, status: 201 });

  approvals.onApproved('supplier_pay', async (q, p, empId) => {
    const [[x]] = await q.query('SELECT pay_id, status FROM supplier_payments WHERE pay_id = ? FOR UPDATE', [p.pay_id]);
    if (!x || x.status !== 'waiting') return;
    await paySupplier(q, x.pay_id, empId);
  });
  approvals.onClosed('supplier_pay', async (q, p, status, empId) => {
    if (status === 'expired') return;
    const [[x]] = await q.query('SELECT pay_id, pay_no, status FROM supplier_payments WHERE pay_id = ? FOR UPDATE', [p.pay_id]);
    if (!x || x.status !== 'waiting') return;
    await q.query("UPDATE supplier_payments SET status = 'rejected' WHERE pay_id = ?", [x.pay_id]);
    await audit(q, { empId, action: 'reject', entity: 'supplier_payment', entityId: x.pay_no, after: { status: status === 'withdrawn' ? 'withdrawn' : 'rejected' } });
  });
  // v21: checked again when signed: the approved account, and what is still left on each bill
  approvals.onRecheck('supplier_pay', async (q, p) => {
    const [[x]] = await q.query('SELECT pay_id, supplier_id, to_acc, status FROM supplier_payments WHERE pay_id = ?', [p.pay_id]);
    if (!x || x.status !== 'waiting') return '';
    const [[s]] = await q.query('SELECT name, bank_acc FROM suppliers WHERE supplier_id = ?', [x.supplier_id]);
    if (!s.bank_acc) return `${s.name} has no approved bank account. No payment until one is signed.`;
    if (s.bank_acc !== x.to_acc) return `This payment was for account ${String(x.to_acc).slice(-4)}, which is no longer the approved one. Raise it again.`;
    const [ls] = await q.query('SELECT pl.amount, b.bill_id, b.bill_no, b.total, b.paid, b.status FROM supplier_payment_lines pl JOIN supplier_bills b ON b.bill_id = pl.bill_id WHERE pl.pay_id = ?', [x.pay_id]);
    const badOnes = [];
    for (const l of ls) { const fr = await free(q, l, x.pay_id); if (Number(l.amount) > fr + 0.004) badOnes.push(`${l.bill_no} has ${rs(fr)} left to pay now (paid ${rs(l.paid)}), not ${rs(l.amount)}`); }
    return badOnes.length ? `${badOnes.join('. ')}.` : '';
  });
  approvals.onAgain('supplier_pay', async () => '');
}

module.exports = { register, pending, free };
