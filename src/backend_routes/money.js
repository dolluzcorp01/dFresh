// Section 11 Payments and receivables (phase 21, v23; decision D2): money in is a receipt of the CUSTOMER, not of an
// order. A receipt (DFRC/26-27/0001, per financial year) settles the oldest dues first (invoices, debit notes, charges,
// the order the ageing uses), or the invoice the customer names first; an amount equal to one invoice's balance goes to
// that invoice (the screen picks it, v23 Low3 d). What it settles is kept: one payments row per order / invoice it pays
// (so an order's paid / due / payment status work as before, commerce.refreshPayment) and receipt_dues rows for debit
// notes and charges. What is left stays on account and the next invoice of that customer takes it (advances too).
// - Cash from trips and pickups and a payment recorded on an order (commerce.recordPayment) become receipts too, set
//   against that order.
// - Cheques: received (a post-dated cheque waits for its date), deposited, cleared or bounced. A bounce reverses its
//   receipt (what it settled is open again), adds the bank charge (a charge below the standard waits for approval of
//   the waiver), and puts the customer on hold with the reason. Waiving a charge later needs approval.
// - Bad debts: the dues more than 30 days late are written off with approval; the customer is then blocked.
// - Refunds of a credit balance (to bank, UPI, cash or the wallet): only real money (not cheques still to clear, not
//   refunds already waiting); above the rule a second person signs it. Refund numbers DFRF.
// - Every save checks the month lock on its own date (books.js).
// - The customer ledger (statement) is every document in date order with the running balance:
//   balance = invoices + debit notes + charges + bounced cheques + refunds paid out - credit notes - receipts
//             - cancelled invoices (on their own) - waivers - bad debts written off - what the wallet paid.
const { audit } = require('./audit');
const approvals = require('./approvals');
const books = require('./books');
const numbering = require('./numbering');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const notifications = require('./notifications');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const IST = (col) => `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+05:30'), '%Y-%m-%d')`;
const commerce = () => require('./commerce'); // eslint-disable-line global-require
const MODES = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer (NEFT / RTGS / IMPS)', cheque: 'Cheque' };
const OLD_MODES = { ...MODES, razorpay: 'Razorpay', card: 'Card', wallet: 'Wallet' };
const REFUND_MODES = { bank: 'Bank transfer (NEFT / RTGS / IMPS)', upi: 'UPI', cash: 'Cash', wallet: 'The customer wallet' };
const BOUNCE_WHY = ['Funds insufficient', 'Signature differs', 'Account closed', 'Payment stopped by drawer', 'Other'];
const SOURCES = { office: 'Recorded in Payments', order: 'Recorded on the order', trip: 'Cash on a trip', pickup: 'Paid at pickup', advance: 'Advance on an order', migrated: 'Before receipts (per order)', online: 'Paid online' };

class MoneyError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; if (fields) this.fields = fields; }
}
const fail = (fields, status = 400) => { throw new MoneyError(Object.values(fields)[0], status, fields); };

// ---------------------------------------------------------------- what a customer owes, item by item
/**
 * the open items of a customer, oldest first: invoices with something left (their order's amount due), debit notes
 * and charges not yet settled -> [{ kind, id, no, order_id, order_no, day, due_on, left, total, at }]
 */
async function openItems(q, customerId) {
  const [rows] = await q.query(
    `SELECT 'invoice' AS kind, i.invoice_id AS id, i.invoice_no AS no, o.order_id, o.order_no, ${IST('i.issued_at')} AS day, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on,
            o.amount_due AS \`left\`, i.total, i.issued_at AS at, o.godown_id
       FROM invoices i JOIN orders o ON o.order_id = i.order_id
      WHERE o.customer_id = ? AND i.status = 'issued' AND o.status <> 'cancelled' AND o.amount_due > 0.005
     UNION ALL
     SELECT 'debit', d.debit_note_id, d.debit_note_no, NULL, NULL, ${IST('d.issued_at')}, DATE_FORMAT(d.due_on, '%Y-%m-%d'), d.total - d.paid, d.total, d.issued_at, d.godown_id
       FROM debit_notes d WHERE d.customer_id = ? AND d.status = 'done' AND d.total - d.paid > 0.005
     UNION ALL
     SELECT 'charge', ch.charge_id, ch.text, NULL, NULL, ${IST('ch.created_at')}, DATE_FORMAT(ch.due_on, '%Y-%m-%d'), ch.amount - ch.paid - ch.waived, ch.amount, ch.created_at, NULL
       FROM customer_charges ch WHERE ch.customer_id = ? AND ch.amount - ch.paid - ch.waived > 0.005
      ORDER BY at, no`, [customerId, customerId, customerId]);
  return rows.map((r) => ({ ...r, left: r2(r.left), total: r2(r.total) }));
}

/** receipts with money not yet set against anything (on account), oldest first */
async function unapplied(q, customerId, { lock = false } = {}) {
  const [rows] = await q.query(
    `SELECT r.receipt_id, r.receipt_no, r.order_id, r.mode, r.received_on, r.reference, r.amount,
            r.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.receipt_id = r.receipt_id AND p.kind = 'payment' AND p.reversed_at IS NULL), 0)
                     - COALESCE((SELECT SUM(d.amount) FROM receipt_dues d WHERE d.receipt_id = r.receipt_id AND d.reversed_at IS NULL), 0) AS \`left\`
       FROM receipts r WHERE r.customer_id = ? AND r.status = 'ok' HAVING \`left\` > 0.005 ORDER BY r.received_on, r.receipt_id${lock ? ' FOR UPDATE' : ''}`, [customerId]);
  return rows.map((r) => ({ ...r, left: r2(r.left), amount: r2(r.amount) }));
}

/** what a receipt of `amount` would settle: the named item first (if any), then the oldest -> { lines, extra } */
function plan(items, amount, toNo = null) {
  const list = items.slice();
  if (toNo) list.sort((a, b) => (a.no === toNo ? 0 : 1) - (b.no === toNo ? 0 : 1));
  let left = r2(amount);
  const lines = [];
  for (const it of list) {
    if (left <= 0.004) break;
    const t = r2(Math.min(it.left, left));
    lines.push({ kind: it.kind, id: it.id, no: it.no, order_id: it.order_id, due_on: it.due_on, amount: t, full: t >= it.left - 0.004 });
    left = r2(left - t);
  }
  return { lines, extra: r2(left) };
}

/** set `amount` of receipt r against one open item */
async function allocate(q, r, it, amount, empId, note = null) {
  if (amount <= 0.004) return;
  if (it.kind === 'invoice' || it.kind === 'order') {
    await q.query('INSERT INTO payments (order_id, receipt_id, invoice_id, kind, mode, amount, received_on, reference, note, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [it.order_id, r.receipt_id, it.kind === 'invoice' ? it.id : null, 'payment', r.mode, r2(amount), r.received_on, r.reference || null, (note || `Receipt ${r.receipt_no}`).slice(0, 255), empId]);
    await commerce().refreshPayment(q, it.order_id);
    return;
  }
  await q.query('INSERT INTO receipt_dues (receipt_id, due_kind, due_id, amount) VALUES (?, ?, ?, ?)', [r.receipt_id, it.kind, it.id, r2(amount)]);
  if (it.kind === 'debit') await q.query('UPDATE debit_notes SET paid = paid + ? WHERE debit_note_id = ?', [r2(amount), it.id]);
  if (it.kind === 'charge') await q.query('UPDATE customer_charges SET paid = paid + ? WHERE charge_id = ?', [r2(amount), it.id]);
}

/** a customer's balance and overdue now (the ledger closing; overdue = open items past their due date) */
async function balanceOf(q, customerId) {
  const st = await statement(q, customerId);
  return { balance: st.closing, overdue: st.overdue, on_account: st.on_account };
}

// ---------------------------------------------------------------- receipts

/**
 * record a receipt for a customer. b = { customer_id, amount, received_on, mode, reference, cheque_no, cheque_bank,
 * cheque_date, to (an invoice / note number to set it against first), note }. opts = { source, orderId (the order it
 * came with), only: an order to settle and nothing else (a payment recorded on an order) }
 * -> { receipt_no, receipt_id, settles, extra, message }
 */
async function recordReceipt(q, b, empId, opts = {}) {
  const today = pricing.istToday();
  const customerId = Number(b.customer_id);
  const [[cu]] = await q.query('SELECT customer_id, customer_no, name, godown_id FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);
  if (!cu) fail({ customer_id: 'Choose the customer.' });
  const errs = {};
  const s = String(b.amount ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || Number(s) <= 0) errs.amount = 'More than 0, like 1500 or 1500.50.';
  const day = String(b.received_on || today);
  if (!pricing.isDate(day) || day > today) errs.received_on = 'Today or earlier.';
  else { const why = await books.lockWhy(q, day); if (why) errs.received_on = why; }
  const mode = String(b.mode || '');
  if (!MODES[mode] && !(opts.source && OLD_MODES[mode])) errs.mode = `How: ${Object.values(MODES).join(', ')}`;
  let reference = String(b.reference || '').trim().slice(0, 60) || null;
  let chq = null;
  if (mode === 'upi' || mode === 'bank') {
    if (!reference || reference.length < 6) errs.reference = 'The UTR or UPI reference (at least 6 characters).';
    else {
      const [[dup]] = await q.query("SELECT receipt_no FROM receipts WHERE reference = ? AND mode = ? AND status = 'ok' LIMIT 1", [reference, mode]);
      if (dup) errs.reference = `Already used on receipt ${dup.receipt_no}.`;
    }
  }
  if (mode === 'cheque' && opts.legacyCheque) { // a cheque recorded on an order without its bank (before phase 21): reference only, not in the register
    if (!reference) errs.reference = 'Cheque: give the cheque number.';
  } else if (mode === 'cheque') {
    const no = String(b.cheque_no || reference || '').trim();
    const bank = String(b.cheque_bank || '').trim().slice(0, 60);
    const cd = String(b.cheque_date || '').trim();
    if (!/^\d{6}$/.test(no)) errs.cheque_no = '6 digits.';
    else {
      const [[dup]] = await q.query('SELECT cheque_id FROM cheques WHERE customer_id = ? AND cheque_no = ?', [customerId, no]);
      if (dup) errs.cheque_no = 'This cheque is already in the register.';
    }
    if (bank.length < 3) errs.cheque_bank = 'Their bank and branch.';
    if (!pricing.isDate(cd)) errs.cheque_date = 'The date on the cheque.';
    else if ((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${cd}T00:00:00Z`)) / 864e5 > 90) errs.cheque_date = 'Older than 3 months: the bank will not take it.';
    chq = { no, bank, date: cd };
    reference = no;
  }
  if (Object.keys(errs).length) fail(errs);
  const amount = r2(Number(s));
  let items;
  if (opts.only) {
    const [[o]] = await q.query("SELECT o.order_id, o.order_no, o.amount_due, o.status, i.invoice_id, i.invoice_no FROM orders o LEFT JOIN invoices i ON i.order_id = o.order_id AND i.status = 'issued' WHERE o.order_id = ? FOR UPDATE", [opts.only]);
    items = [{ kind: o.invoice_id ? 'invoice' : 'order', id: o.invoice_id || o.order_id, no: o.invoice_no || o.order_no, order_id: o.order_id, left: r2(o.amount_due) }];
    if (amount > r2(o.amount_due) + 0.005) throw new MoneyError(`More than the balance due (${rs(Math.max(Number(o.amount_due), 0))})`);
  } else items = await openItems(q, customerId);
  const to = String(b.to || '').trim() || null;
  if (to && !items.some((x) => x.no === to)) fail({ to: `${to} has nothing left to pay.` });
  const no = await numbering.issue(q, 'receipt', null, new Date(`${day}T06:30:00Z`));
  const toInv = to ? items.find((x) => x.no === to && x.kind === 'invoice') : null;
  const [ins] = await q.query(
    `INSERT INTO receipts (receipt_no, customer_id, amount, mode, received_on, reference, note, source, order_id, to_invoice_id, status, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)`,
    [no, customerId, amount, mode, day, reference, String(b.note || '').trim().slice(0, 255) || null, opts.source || 'office', opts.orderId || null, toInv ? toInv.id : null, empId]);
  const r = { receipt_id: ins.insertId, receipt_no: no, mode, received_on: day, reference };
  if (chq) {
    const [c] = await q.query('INSERT INTO cheques (receipt_id, customer_id, cheque_no, bank, cheque_date, amount, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [r.receipt_id, customerId, chq.no, chq.bank, chq.date, amount, empId]);
    await q.query('UPDATE receipts SET cheque_id = ? WHERE receipt_id = ?', [c.insertId, r.receipt_id]);
  }
  const p = opts.hold ? { lines: [], extra: amount } : plan(items, amount, to);
  let firstPay = null;
  for (const l of p.lines) {
    await allocate(q, r, l, l.amount, empId, b.note ? String(b.note) : null);
    if (!firstPay && (l.kind === 'invoice' || l.kind === 'order')) { const [[x]] = await q.query('SELECT MAX(payment_id) AS id FROM payments WHERE receipt_id = ?', [r.receipt_id]); firstPay = x.id; }
  }
  if (firstPay) await notifications.paymentReceived(q, firstPay);
  await audit(q, { empId, action: 'record', entity: 'receipt', entityId: no, after: { customer: cu.customer_no, amount, mode, received_on: day, reference, source: opts.source || 'office', settles: p.lines.map((l) => `${l.no} ${l.amount}`), on_account: p.extra } });
  const settles = p.lines.map((l) => ({ no: l.no, amount: l.amount, full: l.full }));
  const message = `${rs(amount)} from ${cu.name}. ${settles.length ? `Settles ${settles.map((x) => `${x.no}${x.full ? '' : ' (part)'}`).join(', ')}.` : ''}${p.extra > 0.004 ? ` ${rs(p.extra)} on account.` : ''}${chq && chq.date > today ? ` Post-dated: deposit it on ${chq.date}.` : ''}`.trim();
  return { receipt_id: r.receipt_id, receipt_no: no, settles, extra: p.extra, message };
}

/** a new invoice takes what is on account: receipts of that order first (an advance), then the oldest */
async function applyOnAccount(q, orderId, empId) {
  const [[o]] = await q.query("SELECT o.order_id, o.customer_id, o.amount_due, i.invoice_id, i.invoice_no FROM orders o JOIN invoices i ON i.order_id = o.order_id AND i.status = 'issued' WHERE o.order_id = ?", [orderId]);
  if (!o || Number(o.amount_due) <= 0.005) return [];
  const list = (await unapplied(q, o.customer_id, { lock: true })).sort((a, b) => (a.order_id === orderId ? 0 : 1) - (b.order_id === orderId ? 0 : 1));
  let left = r2(o.amount_due);
  const used = [];
  for (const r of list) {
    if (left <= 0.004) break;
    const t = r2(Math.min(left, r.left));
    await allocate(q, { ...r, received_on: typeof r.received_on === 'string' ? r.received_on : r.received_on.toISOString().slice(0, 10) }, { kind: 'invoice', id: o.invoice_id, order_id: o.order_id }, t, empId, `Receipt ${r.receipt_no}: on account, used on ${o.invoice_no}`);
    used.push(`${r.receipt_no} ${t}`);
    left = r2(left - t);
  }
  if (used.length) await audit(q, { empId, action: 'apply', entity: 'invoice', entityId: o.invoice_no, after: { on_account_used: used } });
  return used;
}

// ---------------------------------------------------------------- cheques
async function lockCheque(q, id) {
  const [[c]] = await q.query('SELECT c.*, cu.name AS customer, cu.customer_no, cu.status AS cust_status, cu.hold_reason FROM cheques c JOIN customers cu ON cu.customer_id = c.customer_id WHERE c.cheque_id = ? FOR UPDATE', [Number(id)]);
  if (!c) throw new MoneyError('No such cheque', 404);
  return c;
}
async function deposit(q, id, empId) {
  const c = await lockCheque(q, id);
  const today = pricing.istToday();
  if (c.status !== 'received') throw new MoneyError(`Cheque ${c.cheque_no} is ${c.status}`, 409);
  const cd = typeof c.cheque_date === 'string' ? c.cheque_date : c.cheque_date.toISOString().slice(0, 10);
  if (cd > today) throw new MoneyError(`Post-dated: it can be deposited on ${cd}.`, 409);
  await q.query("UPDATE cheques SET status = 'deposited', deposited_on = ? WHERE cheque_id = ?", [today, c.cheque_id]);
  await audit(q, { empId, action: 'deposit', entity: 'cheque', entityId: c.cheque_no, after: { amount: Number(c.amount), customer: c.customer_no } });
  return { message: 'Mark it Cleared or Bounced when the bank tells you.' };
}
async function clear(q, id, empId) {
  const c = await lockCheque(q, id);
  if (c.status !== 'deposited') throw new MoneyError(`Cheque ${c.cheque_no} is ${c.status}: deposit it first`, 409);
  await q.query("UPDATE cheques SET status = 'cleared', done_on = ? WHERE cheque_id = ?", [pricing.istToday(), c.cheque_id]);
  await audit(q, { empId, action: 'clear', entity: 'cheque', entityId: c.cheque_no, after: { amount: Number(c.amount) } });
  return { message: `${c.cheque_no} ${rs(c.amount)} cleared.` };
}

/** reverse what a receipt settled (a bounced cheque): invoices, notes and charges are open again */
async function reverseReceipt(q, receiptId) {
  const [pays] = await q.query("SELECT payment_id, order_id FROM payments WHERE receipt_id = ? AND kind = 'payment' AND reversed_at IS NULL", [receiptId]);
  await q.query("UPDATE payments SET reversed_at = UTC_TIMESTAMP() WHERE receipt_id = ? AND kind = 'payment' AND reversed_at IS NULL", [receiptId]);
  for (const o of [...new Set(pays.map((x) => x.order_id))]) await commerce().refreshPayment(q, o);
  const [dues] = await q.query('SELECT alloc_id, due_kind, due_id, amount FROM receipt_dues WHERE receipt_id = ? AND reversed_at IS NULL', [receiptId]);
  for (const d of dues) {
    if (d.due_kind === 'debit') await q.query('UPDATE debit_notes SET paid = paid - ? WHERE debit_note_id = ?', [d.amount, d.due_id]);
    if (d.due_kind === 'charge') await q.query('UPDATE customer_charges SET paid = paid - ? WHERE charge_id = ?', [d.amount, d.due_id]);
  }
  await q.query('UPDATE receipt_dues SET reversed_at = UTC_TIMESTAMP() WHERE receipt_id = ? AND reversed_at IS NULL', [receiptId]);
}

/** a deposited cheque bounced: b = { why, charge } (charge below the standard: the rest waits for approval as a waiver) */
async function bounce(q, id, b, empId, admin = null) {
  const c = await lockCheque(q, id);
  const today = pricing.istToday();
  if (c.status !== 'deposited') throw new MoneyError(`Cheque ${c.cheque_no} is ${c.status}: only a deposited cheque bounces`, 409);
  await books.assertOpen(q, today);
  const why = BOUNCE_WHY.includes(b.why) ? b.why : null;
  if (!why) fail({ why: `The bank's reason: ${BOUNCE_WHY.join(', ')}` });
  const cs = await commerceSettings.read(q);
  const std = Number(cs.bounce_charge === undefined ? 500 : cs.bounce_charge) || 0;
  const raw = String(b.charge ?? '').trim();
  if (!/^\d{1,6}$/.test(raw)) fail({ charge: 'A whole number, 0 or more.' });
  const asked = Number(raw);
  await q.query("UPDATE cheques SET status = 'bounced', done_on = ?, bounce_why = ? WHERE cheque_id = ?", [today, why, c.cheque_id]);
  await q.query("UPDATE receipts SET status = 'bounced' WHERE receipt_id = ?", [c.receipt_id]);
  await reverseReceipt(q, c.receipt_id);
  const charge = Math.max(asked, std);
  let chargeId = null;
  if (charge > 0) {
    const [ins] = await q.query('INSERT INTO customer_charges (customer_id, kind, text, amount, due_on, cheque_id, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [c.customer_id, 'bounce', `Bounce charge, cheque ${c.cheque_no}`, charge, today, c.cheque_id, empId]);
    chargeId = ins.insertId;
    await q.query('UPDATE cheques SET charge_id = ? WHERE cheque_id = ?', [chargeId, c.cheque_id]);
  }
  let waitId = null;
  const less = r2(std - asked);
  if (chargeId && less > 0.004) {
    const w = await askWaive(q, chargeId, less, empId, `Charge ${rs(asked)} instead of the standard ${rs(std)} on bounced cheque ${c.cheque_no} (${c.customer})`);
    waitId = w.approval_id || null;
  }
  // the customer goes on hold, so new orders wait (a block stays a block)
  if (c.cust_status === 'active') {
    const reason = `Cheque ${c.cheque_no} for ${rs(c.amount)} bounced on ${today} (${why}). Orders wait until it is cleared.`;
    await q.query("UPDATE customers SET status = 'hold', hold_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE customer_id = ?", [reason, empId, c.customer_id]);
    await audit(q, { empId, action: 'status', entity: 'customer', entityId: c.customer_no, before: { status: c.cust_status }, after: { status: 'hold', reason } });
  }
  await audit(q, { empId, action: 'bounce', entity: 'cheque', entityId: c.cheque_no, after: { amount: Number(c.amount), why, charge, waiver_waiting: waitId } });
  void admin;
  return { message: `${rs(c.amount)}${charge ? ` plus ${rs(charge)} charge` : ''} back on ${c.customer}'s account; the customer is On hold.${waitId ? ` Lowering the charge by ${rs(less)} waits for approval (request ${waitId}).` : ''}`, waiting: Boolean(waitId) };
}

/** waive (part of) a charge: approval waive_bounce (rule) -> { approval_id } | { done } */
async function askWaive(q, chargeId, amount, empId, summary = null) {
  const [[ch]] = await q.query('SELECT ch.*, cu.name, cu.godown_id, c.cheque_no FROM customer_charges ch JOIN customers cu ON cu.customer_id = ch.customer_id LEFT JOIN cheques c ON c.cheque_id = ch.cheque_id WHERE ch.charge_id = ? FOR UPDATE', [chargeId]);
  if (!ch) throw new MoneyError('No such charge', 404);
  const left = r2(Number(ch.amount) - Number(ch.waived));
  const amt = r2(amount === undefined || amount === null ? left : amount);
  if (amt <= 0.004 || amt > left + 0.004) throw new MoneyError(`Up to ${rs(left)} can be waived`, 409);
  if (ch.waive_approval_id) {
    const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE approval_id = ? AND status = 'pending'", [ch.waive_approval_id]);
    if (w) throw new MoneyError(`A waiver of this charge already waits for approval (#${w.approval_id})`, 409);
  }
  await books.assertOpen(q, pricing.istToday());
  if (await approvals.needed(q, 'waive_bounce', { amount: amt, target: `cust:${ch.customer_id}` })) {
    const id = await approvals.request(q, { kind: 'waive_bounce', godownId: ch.godown_id || 1, target: `cust:${ch.customer_id}`, refType: 'customer', refId: String(ch.customer_id), amount: amt,
      summary: summary || `Waive the ${rs(amt)} bounce charge on cheque ${ch.cheque_no || ''} (${ch.name})`, payload: { charge_id: chargeId, amount: amt } }, empId);
    await q.query('UPDATE customer_charges SET waive_approval_id = ? WHERE charge_id = ?', [id, chargeId]);
    return { approval_id: id, waiting: true, message: `Waiting for approval (request ${id}).` };
  }
  await approvals.direct(q, 'waive_bounce', { amount: amt, target: `cust:${ch.customer_id}` }, empId);
  await waive(q, chargeId, amt, empId);
  return { done: true, message: `${rs(amt)} waived.` };
}
async function waive(q, chargeId, amount, empId) {
  const [[ch]] = await q.query('SELECT * FROM customer_charges WHERE charge_id = ? FOR UPDATE', [chargeId]);
  const amt = r2(Math.min(Number(amount), Number(ch.amount) - Number(ch.waived)));
  if (amt <= 0.004) return;
  // what a receipt already paid of this charge goes back on account
  const over = r2(Number(ch.paid) + Number(ch.waived) + amt - Number(ch.amount));
  if (over > 0.004) {
    const [allocs] = await q.query("SELECT alloc_id, amount FROM receipt_dues WHERE due_kind = 'charge' AND due_id = ? AND reversed_at IS NULL ORDER BY alloc_id DESC", [chargeId]);
    let back = over;
    for (const a of allocs) {
      if (back <= 0.004) break;
      const t = r2(Math.min(back, Number(a.amount)));
      if (t >= Number(a.amount) - 0.004) await q.query('UPDATE receipt_dues SET reversed_at = UTC_TIMESTAMP() WHERE alloc_id = ?', [a.alloc_id]);
      else await q.query('UPDATE receipt_dues SET amount = amount - ? WHERE alloc_id = ?', [t, a.alloc_id]);
      back = r2(back - t);
    }
    await q.query('UPDATE customer_charges SET paid = paid - ? WHERE charge_id = ?', [over, chargeId]);
  }
  await q.query('UPDATE customer_charges SET waived = waived + ?, waived_at = UTC_TIMESTAMP(), waive_approval_id = NULL WHERE charge_id = ?', [amt, chargeId]);
  await audit(q, { empId, action: 'waive', entity: 'charge', entityId: String(chargeId), after: { amount: amt, text: ch.text } });
}
approvals.onApproved('waive_bounce', async (q, p, empId) => { if (p && p.charge_id) await waive(q, p.charge_id, p.amount, empId); });
approvals.onClosed('waive_bounce', async (q, p) => { if (p && p.charge_id) await q.query('UPDATE customer_charges SET waive_approval_id = NULL WHERE charge_id = ?', [p.charge_id]); });
approvals.onRecheck('waive_bounce', async (q, p) => {
  if (!p || !p.charge_id) return '';
  const [[ch]] = await q.query('SELECT amount, waived FROM customer_charges WHERE charge_id = ?', [p.charge_id]);
  return ch && Number(ch.amount) - Number(ch.waived) < Number(p.amount) - 0.004 ? 'Already waived.' : '';
});

// ---------------------------------------------------------------- bad debts
/** the dues more than 30 days late (by their due date) */
async function late30(q, customerId) {
  const items = await openItems(q, customerId);
  const today = pricing.istToday();
  const days = (d) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 864e5);
  const late = items.filter((x) => x.due_on && days(x.due_on) > 30);
  return { items: late, amount: r2(late.reduce((a, x) => a + x.left, 0)) };
}
async function askBadDebt(q, customerId, empId) {
  const [[cu]] = await q.query('SELECT customer_id, customer_no, name, godown_id, status FROM customers WHERE customer_id = ? FOR UPDATE', [Number(customerId)]);
  if (!cu) throw new MoneyError('No such customer', 404);
  const today = pricing.istToday();
  await books.assertOpen(q, today);
  const [[w]] = await q.query("SELECT bad_debt_id FROM bad_debts WHERE customer_id = ? AND status = 'waiting'", [cu.customer_id]);
  if (w) throw new MoneyError(`A write-off for ${cu.name} already waits for approval`, 409);
  const l = await late30(q, cu.customer_id);
  if (l.amount <= 0.004) throw new MoneyError(`${cu.name} has nothing more than 30 days late`, 409);
  const why = 'More than 30 days late, not recovered.';
  const [ins] = await q.query('INSERT INTO bad_debts (customer_id, amount, why, emp_id) VALUES (?, ?, ?, ?)', [cu.customer_id, l.amount, why, empId]);
  if (await approvals.needed(q, 'bad_debt', { amount: l.amount, target: `cust:${cu.customer_id}` })) {
    const id = await approvals.request(q, { kind: 'bad_debt', godownId: cu.godown_id || 1, target: `cust:${cu.customer_id}`, refType: 'customer', refId: String(cu.customer_id), amount: l.amount,
      summary: `Write off ${rs(l.amount)} owed by ${cu.customer_no} ${cu.name} (more than 30 days late)`, payload: { bad_debt_id: ins.insertId, customer_id: cu.customer_id, amount: l.amount } }, empId);
    await q.query('UPDATE bad_debts SET approval_id = ? WHERE bad_debt_id = ?', [id, ins.insertId]);
    await audit(q, { empId, action: 'request', entity: 'bad_debt', entityId: cu.customer_no, after: { amount: l.amount, items: l.items.map((x) => `${x.no} ${x.left}`) } });
    return { waiting: true, approval_id: id, amount: l.amount, message: `Writing off ${rs(l.amount)} needs a second person (request ${id}).` };
  }
  await writeOff(q, ins.insertId, empId);
  return { done: true, amount: l.amount, message: `${rs(l.amount)} written off; ${cu.name} is blocked.` };
}
async function writeOff(q, badDebtId, empId) {
  const [[d]] = await q.query("SELECT * FROM bad_debts WHERE bad_debt_id = ? AND status = 'waiting' FOR UPDATE", [badDebtId]);
  if (!d) return;
  const l = await late30(q, d.customer_id);
  let left = r2(d.amount);
  for (const it of l.items) {
    if (left <= 0.004) break;
    const t = r2(Math.min(left, it.left));
    if (it.kind === 'invoice') {
      await q.query("INSERT INTO payments (order_id, invoice_id, kind, mode, amount, received_on, note, emp_id) VALUES (?, ?, 'writeoff', 'writeoff', ?, ?, ?, ?)", [it.order_id, it.id, t, pricing.istToday(), `Bad debt written off (#${badDebtId})`, empId]);
      await commerce().refreshPayment(q, it.order_id);
    } else if (it.kind === 'debit') await q.query('UPDATE debit_notes SET paid = paid + ? WHERE debit_note_id = ?', [t, it.id]);
    else if (it.kind === 'charge') await q.query('UPDATE customer_charges SET waived = waived + ? WHERE charge_id = ?', [t, it.id]);
    left = r2(left - t);
  }
  await q.query("UPDATE bad_debts SET status = 'done', done_at = UTC_TIMESTAMP() WHERE bad_debt_id = ?", [badDebtId]);
  const [[cu]] = await q.query('SELECT customer_id, customer_no, status, hold_reason FROM customers WHERE customer_id = ?', [d.customer_id]);
  const reason = `Bad debt of ${rs(d.amount)} written off on ${pricing.istToday()}. ${d.why}`;
  await q.query("UPDATE customers SET status = 'blocked', hold_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE customer_id = ?", [reason, empId, d.customer_id]);
  await audit(q, { empId, action: 'write_off', entity: 'bad_debt', entityId: cu.customer_no, before: { status: cu.status }, after: { amount: Number(d.amount), status: 'blocked', reason } });
}
approvals.onApproved('bad_debt', async (q, p, empId) => { if (p && p.bad_debt_id) await writeOff(q, p.bad_debt_id, empId); });
approvals.onClosed('bad_debt', async (q, p, status) => { if (p && p.bad_debt_id) await q.query("UPDATE bad_debts SET status = ? WHERE bad_debt_id = ? AND status = 'waiting'", [status === 'rejected' ? 'rejected' : 'closed', p.bad_debt_id]); });
approvals.onRecheck('bad_debt', async (q, p) => {
  if (!p || !p.customer_id) return '';
  const [[cu]] = await q.query('SELECT name FROM customers WHERE customer_id = ?', [p.customer_id]);
  const now = (await late30(q, p.customer_id)).amount;
  return Math.abs(now - Number(p.amount)) > 0.004 ? `${cu.name} now owes ${rs(now)} more than 30 days late, not the ${rs(p.amount)} asked${now < Number(p.amount) ? ' (a payment came in)' : ''}.` : '';
});

// ---------------------------------------------------------------- refunds of a credit balance
/** credit that is real money: the credit balance less cheques not yet cleared and refunds already waiting */
async function refundable(q, customerId, exceptRefund = 0) {
  const st = await statement(q, customerId);
  const credit = r2(Math.max(0, -st.closing));
  const [[u]] = await q.query("SELECT COALESCE(SUM(c.amount), 0) AS n FROM cheques c JOIN receipts r ON r.receipt_id = c.receipt_id WHERE c.customer_id = ? AND c.status IN ('received', 'deposited') AND r.status = 'ok'", [customerId]);
  const [[w]] = await q.query("SELECT COALESCE(SUM(amount), 0) AS n FROM refunds WHERE customer_id = ? AND return_id IS NULL AND status = 'approval' AND refund_id <> ?", [customerId, exceptRefund]);
  return { credit, uncleared: r2(u.n), waiting: r2(w.n), can: r2(Math.max(0, credit - Number(u.n) - Number(w.n))) };
}
async function askRefund(q, b, empId) {
  const customerId = Number(b.customer_id);
  const [[cu]] = await q.query('SELECT customer_id, customer_no, name, godown_id FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);
  if (!cu) throw new MoneyError('No such customer', 404);
  const rf = await refundable(q, customerId);
  const errs = {};
  const s = String(b.amount ?? '').trim();
  const amount = r2(Number(s));
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || amount <= 0 || amount > rf.can + 0.004) errs.amount = `0 to ${rs(rf.can)}${rf.uncleared ? ` (${rs(rf.uncleared)} is in cheques not yet cleared)` : ''}${rf.waiting ? ` (${rs(rf.waiting)} is in refunds waiting)` : ''}.`;
  const mode = String(b.mode || '');
  if (!REFUND_MODES[mode]) errs.mode = `How: ${Object.values(REFUND_MODES).join(', ')}`;
  const reference = String(b.reference || '').trim().slice(0, 60) || null;
  if (['bank', 'upi'].includes(mode) && (!reference || reference.length < 6)) errs.reference = 'The UTR or UPI reference.';
  const why = String(b.why || '').trim().slice(0, 120);
  if (why.length < 5) errs.why = 'Say why.';
  if (!Object.keys(errs).length) { const lw = await books.lockWhy(q, pricing.istToday()); if (lw) errs.amount = lw; }
  if (Object.keys(errs).length) fail(errs);
  const no = await numbering.issue(q, 'refundv');
  const [ins] = await q.query("INSERT INTO refunds (refund_no, return_id, order_id, customer_id, method, mode, reference, amount, why, refund_day, status, emp_id) VALUES (?, NULL, NULL, ?, 'balance', ?, ?, ?, ?, ?, 'approval', ?)",
    [no, customerId, mode, reference, amount, why, pricing.istToday(), empId]);
  if (await approvals.needed(q, 'refund', { amount, target: `cust:${customerId}` })) {
    const id = await approvals.request(q, { kind: 'refund', godownId: cu.godown_id || 1, target: `cust:${customerId}`, refType: 'customer', refId: String(customerId), amount,
      summary: `Refund ${rs(amount)} to ${cu.name}: ${why}`, payload: { refund_id: ins.insertId, credit: true, customer_id: customerId, amount } }, empId);
    await q.query('UPDATE refunds SET approval_id = ? WHERE refund_id = ?', [id, ins.insertId]);
    await audit(q, { empId, action: 'request', entity: 'refund', entityId: no, after: { customer: cu.customer_no, amount, mode, why } });
    return { waiting: true, refund_no: no, approval_id: id, message: `Above the rule: a second person signs it (request ${id}).` };
  }
  await approvals.direct(q, 'refund', { amount, target: `cust:${customerId}` }, empId);
  await payRefund(q, ins.insertId, empId);
  return { done: true, refund_no: no, message: `${rs(amount)} back to ${cu.name}.` };
}
/** pay a credit-balance refund: it uses what is on account first, then the credit left on overpaid orders */
async function payRefund(q, refundId, empId) {
  const [[f]] = await q.query("SELECT * FROM refunds WHERE refund_id = ? AND return_id IS NULL AND status = 'approval' FOR UPDATE", [refundId]);
  if (!f) return;
  let left = r2(f.amount);
  for (const r of await unapplied(q, f.customer_id, { lock: true })) {
    if (left <= 0.004) break;
    const t = r2(Math.min(left, r.left));
    await q.query("INSERT INTO receipt_dues (receipt_id, due_kind, due_id, amount) VALUES (?, 'refund', ?, ?)", [r.receipt_id, refundId, t]);
    left = r2(left - t);
  }
  if (left > 0.004) {
    const [over] = await q.query("SELECT order_id, order_no, -amount_due AS credit FROM orders WHERE customer_id = ? AND amount_due < -0.005 ORDER BY order_id", [f.customer_id]);
    for (const o of over) {
      if (left <= 0.004) break;
      const t = r2(Math.min(left, Number(o.credit)));
      await q.query("INSERT INTO payments (order_id, kind, mode, amount, received_on, reference, note, emp_id) VALUES (?, 'refund', ?, ?, ?, ?, ?, ?)", [o.order_id, f.mode, t, pricing.istToday(), f.reference, `Refund ${f.refund_no}: ${f.why}`.slice(0, 255), empId]);
      await commerce().refreshPayment(q, o.order_id);
      left = r2(left - t);
    }
  }
  if (f.mode === 'wallet') {
    const wallet = require('./wallet'); // eslint-disable-line global-require
    await wallet.credit(q, { customerId: f.customer_id, source: 'refund', amount: Number(f.amount), reason: `Refund ${f.refund_no}: ${f.why}` }, empId);
  }
  await q.query("UPDATE refunds SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE refund_id = ?", [refundId]);
  await audit(q, { empId, action: 'refund', entity: 'refund', entityId: f.refund_no, after: { amount: Number(f.amount), mode: f.mode, reference: f.reference, why: f.why } });
}
approvals.onApproved('refund', async (q, p, empId) => { if (p && p.credit && p.refund_id) await payRefund(q, p.refund_id, empId); });
approvals.onClosed('refund', async (q, p, status) => { if (p && p.credit && p.refund_id) await q.query("UPDATE refunds SET status = 'rejected' WHERE refund_id = ? AND status = 'approval'", [p.refund_id]); void status; });
approvals.onRecheck('refund', async (q, p) => {
  if (!p || !p.credit || !p.refund_id) return '';
  const rf = await refundable(q, p.customer_id, p.refund_id);
  return Number(p.amount) > rf.can + 0.004 ? `Only ${rs(rf.can)} can be refunded now${rf.uncleared ? ` (${rs(rf.uncleared)} is in cheques not yet cleared)` : ''}${rf.waiting ? ` (${rs(rf.waiting)} is in other refunds waiting)` : ''}, not ${rs(p.amount)}.` : '';
});

// ---------------------------------------------------------------- the customer ledger
/**
 * the statement of a customer: every money line in date order with the running balance, the opening balance before
 * `from`, the open items with their age and the ageing by days overdue (phase 22, v23: not due, 1-30, 31-60, 61-90, 90+ days
 * after the due date), overdue, on account
 */
async function statement(q, id, { from = null, to = null } = {}) {
  const [rows] = await q.query(
    `SELECT ${IST('i.issued_at')} AS day, i.issued_at AS at, 'invoice' AS kind, CONCAT('Invoice ', i.invoice_no, ' (', o.order_no, ')', IF(i.status = 'cancelled', ' - cancelled', '')) AS text, i.total AS debit, 0 AS credit, i.invoice_no AS doc
       FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = ?
     UNION ALL SELECT ${IST('i.cancelled_at')}, i.cancelled_at, 'cancel', CONCAT('Invoice ', i.invoice_no, ' cancelled: ', COALESCE(i.cancel_reason, '')), 0, i.total, i.invoice_no
       FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = ? AND i.status = 'cancelled' AND i.cancel_kind = 'alone'
     UNION ALL SELECT ${IST('cn.issued_at')}, cn.issued_at, 'credit_note', CONCAT('Credit note ', cn.credit_note_no, ' against ', i.invoice_no, IF(r.return_no IS NULL, IF(cn.kind IN ('price', 'other'), CONCAT(': ', cn.reason), ''), CONCAT(' (return ', r.return_no, ')'))), 0, cn.total, cn.credit_note_no
       FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id LEFT JOIN returns r ON r.return_id = cn.return_id WHERE o.customer_id = ? AND cn.status = 'done'
     UNION ALL SELECT ${IST('d.issued_at')}, d.issued_at, 'debit_note', CONCAT('Debit note ', d.debit_note_no, ' against ', i.invoice_no, ': ', d.reason), d.total, 0, d.debit_note_no
       FROM debit_notes d JOIN invoices i ON i.invoice_id = d.invoice_id WHERE d.customer_id = ? AND d.status = 'done'
     UNION ALL SELECT DATE_FORMAT(r.received_on, '%Y-%m-%d'), r.created_at, 'receipt', CONCAT('Receipt ', r.receipt_no, ' ', r.mode, IF(r.reference IS NULL, '', CONCAT(' ', r.reference)), IF(r.order_id IS NULL, '', CONCAT(' (', (SELECT x.order_no FROM orders x WHERE x.order_id = r.order_id), ')'))), 0, r.amount, r.receipt_no
       FROM receipts r WHERE r.customer_id = ?
     UNION ALL SELECT DATE_FORMAT(c.done_on, '%Y-%m-%d'), c.created_at + INTERVAL 1 SECOND, 'bounce', CONCAT('Cheque ', c.cheque_no, ' bounced (', r.receipt_no, '): ', COALESCE(c.bounce_why, '')), r.amount, 0, r.receipt_no
       FROM cheques c JOIN receipts r ON r.receipt_id = c.receipt_id WHERE c.customer_id = ? AND c.status = 'bounced'
     UNION ALL SELECT ${IST('ch.created_at')}, ch.created_at, 'charge', ch.text, ch.amount, 0, CONCAT('CHG-', ch.charge_id)
       FROM customer_charges ch WHERE ch.customer_id = ?
     UNION ALL SELECT ${IST('COALESCE(ch.waived_at, ch.created_at)')}, COALESCE(ch.waived_at, ch.created_at), 'waive', CONCAT('Charge waived: ', ch.text), 0, ch.waived, CONCAT('CHG-', ch.charge_id)
       FROM customer_charges ch WHERE ch.customer_id = ? AND ch.waived > 0.005
     UNION ALL SELECT ${IST('b.done_at')}, b.done_at, 'bad_debt', CONCAT('Bad debt written off: ', b.why), 0, b.amount, CONCAT('BD-', b.bad_debt_id)
       FROM bad_debts b WHERE b.customer_id = ? AND b.status = 'done'
     UNION ALL SELECT DATE_FORMAT(p.received_on, '%Y-%m-%d'), p.created_at, p.kind, CONCAT('Refund paid ', p.mode, IF(p.reference IS NULL, '', CONCAT(' ', p.reference)), ' (', o.order_no, ')'), p.amount, 0, NULL
       FROM payments p JOIN orders o ON o.order_id = p.order_id WHERE o.customer_id = ? AND p.kind = 'refund' AND p.reversed_at IS NULL AND NOT (p.note LIKE 'Refund DFRF%')
     UNION ALL SELECT DATE_FORMAT(COALESCE(f.refund_day, f.paid_at), '%Y-%m-%d'), f.paid_at, 'refund', CONCAT('Refund ', f.refund_no, ' ', f.mode, IF(f.reference IS NULL, '', CONCAT(' ', f.reference)), ': ', COALESCE(f.why, '')), f.amount, 0, f.refund_no
       FROM refunds f WHERE f.customer_id = ? AND f.return_id IS NULL AND f.status = 'paid'
     UNION ALL SELECT ${IST('i.issued_at')}, i.issued_at, 'wallet', CONCAT('Paid from the wallet (', o.order_no, ')'), 0, o.wallet_used - o.wallet_discount, NULL
       FROM orders o JOIN invoices i ON i.order_id = o.order_id AND i.status = 'issued' WHERE o.customer_id = ? AND o.wallet_used - o.wallet_discount > 0.005
     UNION ALL SELECT ${IST('f.paid_at')}, f.paid_at, 'refund_wallet', CONCAT('Refund to the wallet (', r.return_no, ')'), f.amount, 0, NULL
       FROM refunds f JOIN returns r ON r.return_id = f.return_id JOIN orders o ON o.order_id = f.order_id WHERE o.customer_id = ? AND f.method = 'wallet' AND f.status = 'paid'
     ORDER BY day, at`, Array(14).fill(id));
  let bal = 0;
  let opening = 0;
  const lines = [];
  for (const r of rows) {
    const d = Number(r.debit) || 0; const c = Number(r.credit) || 0;
    if (from && r.day < from) { opening = r2(opening + d - c); bal = opening; continue; }
    if (to && r.day > to) continue;
    bal = r2(bal + d - c);
    lines.push({ day: r.day, kind: r.kind, text: r.text, doc: r.doc, debit: r2(d), credit: r2(c), balance: bal });
  }
  const items = await openItems(q, id);
  const today = pricing.istToday();
  const ageDays = (d) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 864e5);
  const ageing = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  const open = items.map((x) => {
    const a = ageDays(x.day);
    const late = ageDays(x.due_on || x.day); // days overdue: 0 or less = not due yet
    const bk = late <= 0 ? 'not_due' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90';
    ageing[bk] = r2(ageing[bk] + x.left);
    return { kind: x.kind, invoice_no: x.no, order_no: x.order_no, day: x.day, due_on: x.due_on, amount_due: x.left, age: a, late: Math.max(0, late), bucket: bk, overdue: Boolean(x.due_on && x.due_on < today) };
  });
  const onAcc = r2((await unapplied(q, id)).reduce((a, x) => a + x.left, 0));
  const [[ov]] = await q.query(`SELECT COALESCE(SUM(o.amount_due), 0) AS n FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = ? AND ${commerce().OVERDUE_SQL}`, [id]);
  const overdue = r2(Number(ov.n) + open.filter((x) => x.kind !== 'invoice' && x.overdue).reduce((a, x) => a + x.amount_due, 0));
  // the closing of the whole ledger (not only the lines shown) is the balance
  const closing = to ? bal : r2(rows.reduce((a, r) => a + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0));
  return { opening, lines, closing: from || to ? bal : closing, balance: closing, open, ageing, overdue, on_account: onAcc, outstanding: r2(open.reduce((x, o) => x + o.amount_due, 0)) };
}

module.exports = {
  MoneyError, MODES, OLD_MODES, REFUND_MODES, BOUNCE_WHY, SOURCES, openItems, unapplied, plan, recordReceipt, applyOnAccount, balanceOf, statement,
  deposit, clear, bounce, askWaive, waive, late30, askBadDebt, writeOff, refundable, askRefund, payRefund, reverseReceipt,
};
