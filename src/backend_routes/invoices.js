// Tax invoices and credit notes (docs/COMMERCE-SPEC.md 4.6, 6). An invoice is a snapshot of the order on the day it
// is issued (at dispatch, or at confirm: Commerce setting invoice_issue_at): seller and buyer details, place of supply,
// CGST + SGST or IGST, round-off and totals; the lines are the order's lines, which can no longer change once it is
// dispatched. Numbers: DFI/26-27/0001 per financial year (numbering.js, gap free inside the transaction).
// While the seller GSTIN is a placeholder the invoice is marked is_demo and prints "DEMO - not a tax invoice".
// An invoice is never deleted: cancel() marks it cancelled and issues a credit note (DFC/26-27/0001) for its full
// value. Every step is audited.
const { audit } = require('./audit');
const commerceSettings = require('./commerce-settings');
const numbering = require('./numbering');

class InvoiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** issue the invoice of an order (q inside a transaction) -> { invoice_id, invoice_no } */
async function issue(q, orderId, empId, { at = null } = {}) {
  const [[o]] = await q.query(
    `SELECT order_id, order_no, status, payment_terms, credit_days, place_of_supply, gst_type, taxable, delivery_charge, delivery_gst, cgst, sgst, igst, round_off, total,
            bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone,
            ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone
       FROM orders WHERE order_id = ? FOR UPDATE`, [orderId]
  );
  if (!o) throw new InvoiceError('No such order', 404);
  const [[live]] = await q.query('SELECT invoice_no FROM invoices WHERE live_order_id = ?', [orderId]);
  if (live) return { invoice_no: live.invoice_no, existed: true };
  const cs = await commerceSettings.read(q);
  const when = at ? new Date(at) : new Date();
  const fy = numbering.fyOf(when);
  const seq = await numbering.next(q, `${cs.invoice_prefix}-${fy.fy}`, cs.invoice_start_no || 1);
  const invoiceNo = `${cs.invoice_prefix}/${fy.short}/${numbering.pad(seq)}`;
  const day = numbering.istParts(when).ymd;
  const dueDays = o.payment_terms === 'credit' ? Number(o.credit_days) || 0 : 0;
  const buyer = {
    bill: { name: o.bill_name, gstin: o.bill_gstin, address: o.bill_address, town: o.bill_town, state_code: o.bill_state_code, pincode: o.bill_pincode, phone: o.bill_phone },
    ship: { name: o.ship_name, address: o.ship_address, town: o.ship_town, state_code: o.ship_state_code, pincode: o.ship_pincode, phone: o.ship_phone },
  };
  const [ins] = await q.query(
    `INSERT INTO invoices (invoice_no, fy, seq, order_id, live_order_id, issued_at, due_on, place_of_supply, gst_type, taxable, delivery_charge, delivery_gst, cgst, sgst, igst,
       round_off, total, seller_name, seller_gstin, seller_address, seller_state_code, buyer_json, is_demo, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoiceNo, fy.fy, seq, o.order_id, o.order_id, when, day, dueDays, o.place_of_supply, o.gst_type, o.taxable, o.delivery_charge, o.delivery_gst, o.cgst, o.sgst, o.igst,
      o.round_off, o.total, cs.invoice_seller_name, cs.invoice_seller_gstin, cs.invoice_seller_address, cs.invoice_seller_state_code,
      JSON.stringify(buyer), commerceSettings.invoiceIsDemo(cs) ? 1 : 0, empId]
  );
  await audit(q, { empId, action: 'issue', entity: 'invoice', entityId: invoiceNo, after: { order: o.order_no, total: Number(o.total), gst_type: o.gst_type, due_in_days: dueDays } });
  return { invoice_id: ins.insertId, invoice_no: invoiceNo };
}

/** cancel the live invoice of an order and issue its credit note -> { invoice_no, credit_note_no } | null (none) */
async function cancelForOrder(q, orderId, reason, empId) {
  const [[inv]] = await q.query('SELECT invoice_id, invoice_no, taxable, cgst, sgst, igst, round_off, total FROM invoices WHERE live_order_id = ? FOR UPDATE', [orderId]);
  if (!inv) return null;
  const why = String(reason || '').trim().slice(0, 255) || 'Order cancelled';
  await q.query("UPDATE invoices SET status = 'cancelled', live_order_id = NULL, cancelled_at = UTC_TIMESTAMP(), cancel_reason = ?, cancelled_by = ? WHERE invoice_id = ?",
    [why, empId, inv.invoice_id]);
  const cs = await commerceSettings.read(q);
  const fy = numbering.fyOf(new Date());
  const seq = await numbering.next(q, `${cs.credit_note_prefix}-${fy.fy}`, 1);
  const cnNo = `${cs.credit_note_prefix}/${fy.short}/${numbering.pad(seq)}`;
  await q.query(
    `INSERT INTO credit_notes (credit_note_no, fy, seq, invoice_id, reason, taxable, cgst, sgst, igst, round_off, total, issued_at, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)`,
    [cnNo, fy.fy, seq, inv.invoice_id, why, inv.taxable, inv.cgst, inv.sgst, inv.igst, inv.round_off, inv.total, empId]
  );
  await audit(q, { empId, action: 'cancel', entity: 'invoice', entityId: inv.invoice_no, before: { status: 'issued' }, after: { status: 'cancelled', reason: why, credit_note: cnNo } });
  await audit(q, { empId, action: 'issue', entity: 'credit_note', entityId: cnNo, after: { invoice: inv.invoice_no, total: Number(inv.total), reason: why } });
  return { invoice_no: inv.invoice_no, credit_note_no: cnNo };
}

module.exports = { InvoiceError, issue, cancelForOrder };
