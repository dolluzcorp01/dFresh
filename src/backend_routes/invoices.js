// Tax invoices and credit notes (docs/COMMERCE-SPEC.md 4.6, 6). An invoice is a snapshot of the order on the day it
// is issued (at dispatch, or at confirm: Commerce setting invoice_issue_at): seller and buyer details (the seller, its
// default approved bank account and UPI ID from Admin > Company, company.js), place of supply,
// CGST + SGST or IGST, round-off and totals; the lines are the order's lines, which can no longer change once it is
// dispatched. Numbers: DFI/26-27/0001 per financial year (numbering.js, gap free inside the transaction).
// While the seller GSTIN is a placeholder the invoice is marked is_demo and prints "DEMO - not a tax invoice".
// An invoice is never deleted: cancel() marks it cancelled and issues a credit note (DFC/26-27/0001) for its full
// value. Every step is audited.
const { audit } = require('./audit');
const books = require('./books');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const company = require('./company');
const numbering = require('./numbering');
const notifications = require('./notifications');
const tax = require('./tax');
const r2 = (n) => Math.round(n * 100) / 100;

class InvoiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * phase 15 (v23 H.49): an invoice uses the GST rate of its own date. A line whose HSN code has another rate on `day`
 * than the order was priced with is taxed again at that rate (its taxable value stays), and the order's tax, round off,
 * total and amount due follow, so the order, the invoice screen and the saved invoice agree -> lines changed
 */
async function retaxOn(q, orderId, day, roundOff) {
  const [lines] = await q.query('SELECT line_id, hsn, gst_rate, taxable FROM order_items WHERE order_id = ? FOR UPDATE', [orderId]);
  const rates = await tax.ratesOn(q, day);
  const [[o]] = await q.query('SELECT gst_type, taxable, delivery_gst, total, round_off FROM orders WHERE order_id = ?', [orderId]);
  let n = 0;
  for (const l of lines) {
    const r = rates.get(l.hsn);
    if (r === undefined || Number(l.gst_rate) === r) continue;
    const t = Number(l.taxable);
    const half = o.gst_type === 'intra' ? r2((t * r) / 200) : 0;
    const igst = o.gst_type === 'inter' ? r2((t * r) / 100) : 0;
    await q.query('UPDATE order_items SET gst_rate = ?, cgst = ?, sgst = ?, igst = ?, line_total = ? WHERE line_id = ?', [r, half, half, igst, r2(t + 2 * half + igst), l.line_id]);
    n += 1;
  }
  if (!n) return 0;
  const [[sum]] = await q.query('SELECT COALESCE(SUM(cgst), 0) AS c, COALESCE(SUM(sgst), 0) AS s, COALESCE(SUM(igst), 0) AS i FROM order_items WHERE order_id = ?', [orderId]);
  const dg = Number(o.delivery_gst);
  const [c, sg, ig] = o.gst_type === 'intra' ? [r2(Number(sum.c) + dg / 2), r2(Number(sum.s) + dg / 2), r2(Number(sum.i))] : [r2(Number(sum.c)), r2(Number(sum.s)), r2(Number(sum.i) + dg)];
  const before = r2(Number(o.taxable) + c + sg + ig);
  const ro = roundOff ? r2(Math.round(before) - before) : 0;
  const total = r2(before + ro);
  await q.query('UPDATE orders SET cgst = ?, sgst = ?, igst = ?, round_off = ?, total = ?, amount_due = amount_due + ? WHERE order_id = ?', [c, sg, ig, ro, total, r2(total - Number(o.total)), orderId]);
  return n;
}

/** issue the invoice of an order (q inside a transaction) -> { invoice_id, invoice_no } */
async function issue(q, orderId, empId, { at = null } = {}) {
  const [[o]] = await q.query(
    `SELECT order_id, order_no, godown_id, status, payment_terms, credit_days, place_of_supply, gst_type, taxable, delivery_charge, delivery_gst, cgst, sgst, igst, round_off, total,
            bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone,
            ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone
       FROM orders WHERE order_id = ? FOR UPDATE`, [orderId]
  );
  if (!o) throw new InvoiceError('No such order', 404);
  const [[live]] = await q.query('SELECT invoice_no FROM invoices WHERE live_order_id = ?', [orderId]);
  if (live) return { invoice_no: live.invoice_no, existed: true };
  const cs = await commerceSettings.read(q);
  const co = await company.facts(q); // phase 13: the seller, and the bank + UPI it prints, from Admin > Company
  const when = at ? new Date(at) : new Date();
  if (await retaxOn(q, orderId, numbering.istParts(when).ymd, co.round_off)) { // the rate of the invoice date
    const [[t]] = await q.query('SELECT taxable, delivery_gst, cgst, sgst, igst, round_off, total FROM orders WHERE order_id = ?', [orderId]);
    Object.assign(o, t);
  }
  await books.assertOpen(q, new Date(when.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)); // phase 12b month lock
  const fy = numbering.fyOf(when);
  const g = await numbering.godownSegment(q, o.godown_id);
  const seq = await numbering.next(q, `${cs.invoice_prefix}-${g.key}${fy.fy}`, g.key ? 1 : cs.invoice_start_no || 1);
  const invoiceNo = `${cs.invoice_prefix}/${g.seg}${fy.short}/${numbering.pad(seq)}`;
  const day = numbering.istParts(when).ymd;
  const dueDays = o.payment_terms === 'credit' ? Number(o.credit_days) || 0 : 0;
  const buyer = {
    bill: { name: o.bill_name, gstin: o.bill_gstin, address: o.bill_address, town: o.bill_town, state_code: o.bill_state_code, pincode: o.bill_pincode, phone: o.bill_phone },
    ship: { name: o.ship_name, address: o.ship_address, town: o.ship_town, state_code: o.ship_state_code, pincode: o.ship_pincode, phone: o.ship_phone },
  };
  const [ins] = await q.query(
    `INSERT INTO invoices (invoice_no, fy, seq, order_id, live_order_id, issued_at, due_on, place_of_supply, gst_type, taxable, delivery_charge, delivery_gst, cgst, sgst, igst,
       round_off, total, seller_name, seller_gstin, seller_address, seller_state_code, seller_bank, seller_upi, buyer_json, is_demo, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoiceNo, fy.fy, seq, o.order_id, o.order_id, when, day, dueDays, o.place_of_supply, o.gst_type, o.taxable, o.delivery_charge, o.delivery_gst, o.cgst, o.sgst, o.igst,
      o.round_off, o.total, co.name, co.gstin || commerceSettings.GSTIN_PLACEHOLDER, co.address, co.state_code, co.bank, co.upi,
      JSON.stringify(buyer), commerceSettings.invoiceIsDemo(cs) ? 1 : 0, empId]
  );
  await audit(q, { empId, action: 'issue', entity: 'invoice', entityId: invoiceNo, after: { order: o.order_no, total: Number(o.total), gst_type: o.gst_type, due_in_days: dueDays } });
  await notifications.invoiceIssued(q, ins.insertId); // the invoice PDF to the invoice contacts
  // phase 21 (D2): what the customer has on account (an advance first) is used on the new invoice
  const used = await require('./money').applyOnAccount(q, o.order_id, empId); // eslint-disable-line global-require
  return { invoice_id: ins.insertId, invoice_no: invoiceNo, on_account_used: used };
}

/** the godown of an invoice (its order's): credit notes are numbered per godown like invoices */
async function godownOfInvoice(q, invoiceId) {
  const [[r]] = await q.query('SELECT o.godown_id FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_id = ?', [invoiceId]);
  return r.godown_id;
}

/** cancel the live invoice of an order and issue its credit note -> { invoice_no, credit_note_no } | null (none) */
async function cancelForOrder(q, orderId, reason, empId) {
  const [[inv]] = await q.query('SELECT invoice_id, invoice_no, taxable, cgst, sgst, igst, round_off, total FROM invoices WHERE live_order_id = ? FOR UPDATE', [orderId]);
  if (!inv) return null;
  // phase 12b: cancelling an invoice of an exported month asks first (after_export), then may be done again
  const [[d]] = await q.query("SELECT DATE_FORMAT(CONVERT_TZ(issued_at, '+00:00', '+05:30'), '%Y-%m-%d') AS day FROM invoices WHERE invoice_id = ?", [inv.invoice_id]);
  await books.guardRecord(q, { date: d.day, key: `inv:${inv.invoice_id}`, label: `Cancel invoice ${inv.invoice_no}`, godownId: await godownOfInvoice(q, inv.invoice_id) }, empId);
  await books.assertOpen(q, pricing.istToday()); // its credit note is dated today
  const why = String(reason || '').trim().slice(0, 255) || 'Order cancelled';
  await q.query("UPDATE invoices SET status = 'cancelled', cancel_kind = 'order', live_order_id = NULL, cancelled_at = UTC_TIMESTAMP(), cancel_reason = ?, cancelled_by = ? WHERE invoice_id = ?",
    [why, empId, inv.invoice_id]);
  const cs = await commerceSettings.read(q);
  const fy = numbering.fyOf(new Date());
  const g = await numbering.godownSegment(q, await godownOfInvoice(q, inv.invoice_id));
  const seq = await numbering.next(q, `${cs.credit_note_prefix}-${g.key}${fy.fy}`, 1);
  const cnNo = `${cs.credit_note_prefix}/${g.seg}${fy.short}/${numbering.pad(seq)}`;
  await q.query(
    `INSERT INTO credit_notes (credit_note_no, fy, seq, invoice_id, reason, kind, taxable, cgst, sgst, igst, round_off, total, issued_at, emp_id)
     VALUES (?, ?, ?, ?, ?, 'cancel', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)`,
    [cnNo, fy.fy, seq, inv.invoice_id, why, inv.taxable, inv.cgst, inv.sgst, inv.igst, inv.round_off, inv.total, empId]
  );
  await audit(q, { empId, action: 'cancel', entity: 'invoice', entityId: inv.invoice_no, before: { status: 'issued' }, after: { status: 'cancelled', reason: why, credit_note: cnNo } });
  await audit(q, { empId, action: 'issue', entity: 'credit_note', entityId: cnNo, after: { invoice: inv.invoice_no, total: Number(inv.total), reason: why } });
  return { invoice_no: inv.invoice_no, credit_note_no: cnNo };
}

/**
 * Credit note for returned packs (phase 6): lines = [{ sku_code, qty }] of the order's live invoice; each line at the
 * invoice's own tax (taxable, CGST + SGST or IGST of that order line, in proportion to the packs). Round-off as the
 * invoice (Commerce setting). -> { credit_note_id, credit_note_no, total, taxable, cgst, sgst, igst }
 */
async function creditNoteForReturn(q, orderId, lines, reason, returnId, empId) {
  const [[inv]] = await q.query('SELECT invoice_id, invoice_no, gst_type FROM invoices WHERE live_order_id = ? FOR UPDATE', [orderId]);
  if (!inv) throw new InvoiceError('The order has no live tax invoice to credit', 409);
  await books.assertOpen(q, pricing.istToday()); // phase 12b month lock: the credit note is dated today
  // per SKU over its paid and free lines (buy X get Y): a returned pack is worth its share of what was invoiced
  const [items] = await q.query(`SELECT sku_code, SUM(qty) AS qty, MAX(hsn) AS hsn, MAX(gst_rate) AS gst_rate, SUM(taxable) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(igst) AS igst
      FROM order_items WHERE order_id = ? GROUP BY sku_code`, [orderId]);
  items.forEach((i) => { i.qty = Number(i.qty); });
  const out = [];
  for (const l of lines.filter((x) => x.qty > 0)) {
    const it = items.find((i) => i.sku_code === l.sku_code);
    if (!it || l.qty > it.qty) throw new InvoiceError(`${l.sku_code}: ${l.qty} packs is more than invoiced`, 409);
    const p = l.qty / it.qty;
    const row = { sku_code: l.sku_code, hsn: it.hsn, gst_rate: Number(it.gst_rate), qty: l.qty, taxable: r2(Number(it.taxable) * p), cgst: r2(Number(it.cgst) * p), sgst: r2(Number(it.sgst) * p), igst: r2(Number(it.igst) * p) };
    row.line_total = r2(row.taxable + row.cgst + row.sgst + row.igst);
    out.push(row);
  }
  if (!out.length) throw new InvoiceError('Nothing to credit');
  const sum = (k) => r2(out.reduce((a, x) => a + x[k], 0));
  const [taxable, cgst, sgst, igst] = [sum('taxable'), sum('cgst'), sum('sgst'), sum('igst')];
  const before = r2(taxable + cgst + sgst + igst);
  const cs = await commerceSettings.read(q);
  const ro = cs.invoice_round_off ? r2(Math.round(before) - before) : 0;
  const total = r2(before + ro);
  // phase 21 (v23): all credit notes on one invoice together never pass its value; other returns still open hold their room
  const room = await require('./billing').noteRoom(q, inv.invoice_id, { exceptReturn: returnId || 0 }); // eslint-disable-line global-require
  if (total > room.room + 0.004) throw new InvoiceError(`Too much for ${inv.invoice_no}: credit notes on it together cannot pass the invoice value. Room left: Rs ${Math.max(0, room.room).toFixed(2)}${room.held ? ` (Rs ${room.held.toFixed(2)} is held for other returns still open on it)` : ''}.`, 409);
  const fy = numbering.fyOf(new Date());
  const g = await numbering.godownSegment(q, await godownOfInvoice(q, inv.invoice_id));
  const seq = await numbering.next(q, `${cs.credit_note_prefix}-${g.key}${fy.fy}`, 1);
  const cnNo = `${cs.credit_note_prefix}/${g.seg}${fy.short}/${numbering.pad(seq)}`;
  const why = String(reason || '').trim().slice(0, 255) || 'Goods returned';
  const [ins] = await q.query(
    `INSERT INTO credit_notes (credit_note_no, fy, seq, invoice_id, return_id, reason, taxable, cgst, sgst, igst, round_off, total, issued_at, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)`,
    [cnNo, fy.fy, seq, inv.invoice_id, returnId, why, taxable, cgst, sgst, igst, ro, total, empId]
  );
  for (const x of out) {
    await q.query('INSERT INTO credit_note_lines (credit_note_id, sku_code, hsn, gst_rate, qty, taxable, cgst, sgst, igst, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ins.insertId, x.sku_code, x.hsn, x.gst_rate, x.qty, x.taxable, x.cgst, x.sgst, x.igst, x.line_total]);
  }
  await audit(q, { empId, action: 'issue', entity: 'credit_note', entityId: cnNo, after: { invoice: inv.invoice_no, gst_type: inv.gst_type, total, taxable, cgst, sgst, igst, lines: out.map((x) => `${x.qty} x ${x.sku_code}`), reason: why } });
  return { credit_note_id: ins.insertId, credit_note_no: cnNo, invoice_no: inv.invoice_no, gst_type: inv.gst_type, total, taxable, cgst, sgst, igst, round_off: ro };
}

module.exports = { InvoiceError, issue, cancelForOrder, creditNoteForReturn };
