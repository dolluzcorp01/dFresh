// Section 10 Invoicing and GST (phase 21, v23). Rules on top of invoices.js (the invoice itself, its number and tax):
// - An invoice is made for a packed shipment before the goods leave (one invoice per shipment: a part shipment's balance
//   is its own order, phase 20): Money > Billing > Invoices > To invoice, with its date (GST at that date's rate, phase
//   15) and the papers it needs. Leaving the godown makes it when nobody did, and refuses while a paper is missing.
// - E-way bill (switch "E-way bill needed" with its limit): needed when the invoice, or the day's invoices to that
//   customer from that godown together (one load, v23 Low3 a), pass the limit. 12 digits, not a made-up number (no
//   leading 0, not one digit repeated, not 0123... or 9876...), used once, valid today or later.
// - E-invoice (switch on): a B2B invoice needs its IRN (64 hex) and ack number (12 to 15 digits), typed from the portal.
// - Cancel an invoice on its own (cancel_invoice approval): only while nothing is paid or credited on it, no debit note,
//   no credit note waiting, the goods have not left, and its month is open (else an "after export" request). The
//   number stays used; the ledger gets a reversing line; the packs can be invoiced again.
// - Credit notes: goods back from a delivery or a return are credited at the invoice price with no approval (made where
//   the goods come back); a price correction (no goods) waits for approval (credit_no_return). All credit notes on one
//   invoice together never pass its value, and returns still open on it hold their room (v23 Low3 b). A note keeps the
//   invoice's buyer and tax (Y8); the money goes to whoever that customer is now.
// - Debit notes DFS: an extra charge on an invoice at its main GST rate, due by the customer's days; refused on a
//   cancelled invoice or one whose cancel waits (Y7).
// - Delivery challans DFT (per godown, the transfer series): goods sent without a sale; they leave the Good shelf.
// - GSTR-1 (reports.gst) and GSTR-3B data per month: output = invoices - credit notes + debit notes; input = the
//   supplier bills of the month (approved).
const { audit } = require('./audit');
const approvals = require('./approvals');
const books = require('./books');
const numbering = require('./numbering');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const invoices = require('./invoices');
const stock = require('./stock');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const IST = (col) => `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+05:30'), '%Y-%m-%d')`;
const commerce = () => require('./commerce'); // eslint-disable-line global-require
const CN_WHY = ['Price correction', 'Other'];
const DN_WHY = ['Freight not charged on the invoice', 'Price raised as agreed', 'Interest on late payment', 'Other'];
const DC_WHY = ['Free samples', 'Sent on approval', 'Exhibition or trade fair', 'Job work', 'Other'];
const LEFT = ['dispatched', 'out_for_delivery', 'delivered', 'refused', 'failed'];

class BillingError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; if (fields) this.fields = fields; }
}
const fail = (fields, status = 400) => { throw new BillingError(Object.values(fields)[0], status, fields); };

// ---------------------------------------------------------------- the papers: e-way bill and e-invoice
async function rules(q) {
  const cs = await commerceSettings.read(q);
  return { eway: String(cs.eway_bill_required) === '1' || cs.eway_bill_required === true, limit: Number(cs.eway_bill_above) || 50000, einvoice: cs.einvoice_mode === 'on' };
}
/** the load of one customer from one godown on one day (India date), with `extra` for an invoice not saved yet */
async function dayLoad(q, customerId, godownId, day, { exceptInvoice = 0, extra = 0 } = {}) {
  const [[r]] = await q.query(`SELECT COALESCE(SUM(i.total), 0) AS n FROM invoices i JOIN orders o ON o.order_id = i.order_id
      WHERE o.customer_id = ? AND o.godown_id = ? AND i.status = 'issued' AND ${IST('i.issued_at')} = ? AND i.invoice_id <> ?`, [customerId, godownId, day, exceptInvoice]);
  return r2(Number(r.n) + extra);
}
/** what an invoice needs before the goods leave -> { ewb: why | '', irn: bool } */
async function needs(q, { total, customerId, godownId, day, gstin, invoiceId = 0 }) {
  const ru = await rules(q);
  let ewb = '';
  if (ru.eway) {
    const load = await dayLoad(q, customerId, godownId, day, { exceptInvoice: invoiceId, extra: Number(total) });
    if (Number(total) > ru.limit) ewb = `${rs(total)} is above ${rs(ru.limit)}`;
    else if (load > ru.limit) ewb = `with the other invoices to this customer from this godown today the load is ${rs(load)}, above ${rs(ru.limit)}`;
  }
  return { ewb, irn: ru.einvoice && Boolean(gstin), limit: ru.limit };
}
/** a real-looking e-way bill number (v23 Low3 a) -> '' | why not */
function ewbWhy(no) {
  if (!/^\d{12}$/.test(no)) return '12 digits.';
  if (/^0/.test(no) || /^(\d)\1{11}$/.test(no) || '012345678901234567890'.includes(no) || '987654321098765432109'.includes(no)) return 'This is not an e-way bill number. Copy it from the e-way bill portal.';
  return '';
}
/** check the papers typed for an invoice -> { ewb_no, ewb_valid, irn, ack_no } (only the ones needed or given) */
async function readPapers(q, b, need, invoiceId = 0) {
  const errs = {}; const out = {};
  const today = pricing.istToday();
  const ewbGiven = String(b.ewb_no || '').replace(/\s/g, '');
  if (need.ewb || ewbGiven) {
    const no = ewbGiven;
    const why = ewbWhy(no);
    if (why) errs.ewb_no = why;
    else {
      const [[dup]] = await q.query('SELECT invoice_no FROM invoices WHERE ewb_no = ? AND invoice_id <> ?', [no, invoiceId]);
      if (dup) errs.ewb_no = `Already used on ${dup.invoice_no}.`;
    }
    const v = String(b.ewb_valid || '');
    if (!pricing.isDate(v) || v < today) errs.ewb_valid = 'Today or later.';
    out.ewb_no = no; out.ewb_valid = v;
  }
  const irnGiven = String(b.irn || '').trim().toLowerCase();
  if (need.irn || irnGiven) {
    const ack = String(b.ack_no || '').trim();
    if (!/^[0-9a-f]{64}$/.test(irnGiven)) errs.irn = '64 letters and digits (0-9, a-f).';
    if (!/^\d{12,15}$/.test(ack)) errs.ack_no = '12 to 15 digits.';
    out.irn = irnGiven; out.ack_no = ack;
  }
  if (Object.keys(errs).length) fail(errs);
  return out;
}
async function invoiceRow(q, where, args, lock = false) {
  const [[v]] = await q.query(`SELECT i.*, o.order_no, o.eway_bill_no AS order_ewb, o.customer_id, o.godown_id, o.status AS order_status, o.amount_paid, o.amount_due, o.dispatched_at, o.created_at AS order_at,
      ${IST('i.issued_at')} AS day, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_day, c.name AS customer, c.customer_no
      FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE ${where}${lock ? ' FOR UPDATE' : ''}`, args);
  if (!v) return null;
  v.buyer = typeof v.buyer_json === 'string' ? JSON.parse(v.buyer_json) : v.buyer_json;
  return v;
}
/** the papers an issued invoice still lacks -> ['e-invoice IRN', 'e-way bill'] */
async function papersMissing(q, v) {
  if (v.status !== 'issued') return [];
  const n = await needs(q, { total: v.total, customerId: v.customer_id, godownId: v.godown_id, day: v.day, gstin: v.buyer && v.buyer.bill && v.buyer.bill.gstin, invoiceId: v.invoice_id });
  const out = [];
  if (n.irn && !v.irn) out.push('e-invoice IRN');
  if (n.ewb && !v.ewb_no && !v.order_ewb) out.push('e-way bill'); // phase 20: a courier booking may carry it on the order
  return out;
}
/** before goods leave: every paper of its invoice is there (q in the leaving transaction) -> '' | why not */
async function leaveCheck(q, orderId) {
  const v = await invoiceRow(q, "i.order_id = ? AND i.status = 'issued'", [orderId]);
  if (!v) return '';
  const m = await papersMissing(q, v);
  return m.length ? `Missing before the goods leave: ${v.invoice_no}: ${m.join(' and ')}. Add it in Money > Billing > Invoices.` : '';
}

// ---------------------------------------------------------------- invoices
/** packed shipments with no invoice yet (the To invoice tab) */
async function toInvoice(q, where = '1 = 1', args = []) {
  const [rows] = await q.query(`SELECT o.order_id, o.order_no, o.godown_id, o.status, o.delivery_kind, o.total, o.packed_at, o.customer_id, c.name AS customer, c.customer_no, o.parent_id,
      (SELECT GROUP_CONCAT(CONCAT(it.sku_code, ' ', it.qty) ORDER BY it.line_id SEPARATOR ', ') FROM order_items it WHERE it.order_id = o.order_id) AS packed,
      (SELECT it.sku_code FROM order_items it WHERE it.order_id = o.order_id ORDER BY it.line_id LIMIT 1) AS first_sku
      FROM orders o JOIN customers c ON c.customer_id = o.customer_id
     WHERE o.status = 'packed' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.order_id AND i.status = 'issued') AND ${where} ORDER BY o.packed_at, o.order_id`, args);
  return rows;
}
/** what the invoice of a packed order would be on `day` (nothing saved) */
async function preview(q, orderNo, day = null) {
  const [[o]] = await q.query(`SELECT o.order_id, o.order_no, o.customer_id, o.godown_id, o.status, o.payment_terms, o.credit_days, o.bill_gstin, o.bill_name, o.place_of_supply, o.gst_type, o.total, o.taxable, o.delivery_charge,
      o.cgst, o.sgst, o.igst, o.round_off, ${IST('o.created_at')} AS order_day FROM orders o WHERE o.order_no = ?`, [orderNo]);
  if (!o) throw new BillingError(`No order ${orderNo}`, 404);
  const d = day || pricing.istToday();
  const n = await needs(q, { total: o.total, customerId: o.customer_id, godownId: o.godown_id, day: d, gstin: o.bill_gstin });
  return { order: o, day: d, kind: o.bill_gstin ? 'B2B' : 'B2C', next_no: await numbering.sampleFor(q, 'invoice', o.godown_id, new Date(`${d}T06:30:00Z`)), needs: n,
    due_days: o.payment_terms === 'credit' ? Number(o.credit_days) || 0 : 0 };
}
/** make the invoice of a packed shipment: b = { date, note, ewb_no, ewb_valid, irn, ack_no } */
async function makeInvoice(q, orderNo, b, empId) {
  const [[o]] = await q.query(`SELECT order_id, order_no, customer_id, godown_id, status, bill_gstin, total, ${IST('created_at')} AS order_day FROM orders WHERE order_no = ? FOR UPDATE`, [orderNo]);
  if (!o) throw new BillingError(`No order ${orderNo}`, 404);
  const [[live]] = await q.query("SELECT invoice_no FROM invoices WHERE order_id = ? AND status = 'issued'", [o.order_id]);
  if (live) throw new BillingError(`${orderNo} already has invoice ${live.invoice_no}`, 409);
  if (o.status !== 'packed') throw new BillingError(`${orderNo} is not packed: an invoice is made for what is packed, before the goods leave`, 409);
  const today = pricing.istToday();
  const day = String(b.date || today);
  if (!pricing.isDate(day) || day > today || day < o.order_day) fail({ date: `Between the order date (${o.order_day}) and today.` });
  const lw = await books.lockWhy(q, day);
  if (lw) fail({ date: lw });
  const n = await needs(q, { total: o.total, customerId: o.customer_id, godownId: o.godown_id, day, gstin: o.bill_gstin });
  const papers = await readPapers(q, b, n);
  const at = day === today ? null : `${day}T06:30:00Z`;
  const made = await invoices.issue(q, o.order_id, empId, { at });
  const [[inv]] = await q.query('SELECT invoice_id, invoice_no, total, DATE_FORMAT(due_on, \'%Y-%m-%d\') AS due_on FROM invoices WHERE invoice_no = ?', [made.invoice_no]);
  // the total may change with the rate of the invoice date: the papers follow the saved invoice
  const n2 = await needs(q, { total: inv.total, customerId: o.customer_id, godownId: o.godown_id, day, gstin: o.bill_gstin, invoiceId: inv.invoice_id });
  if (n2.ewb && !papers.ewb_no) fail({ ewb_no: `12 digits, from the e-way bill portal. Needed: ${n2.ewb}.` });
  const note = String(b.note || '').trim().slice(0, 120) || null;
  await q.query('UPDATE invoices SET note = ?, ewb_no = ?, ewb_valid = ?, irn = ?, ack_no = ? WHERE invoice_id = ?', [note, papers.ewb_no || null, papers.ewb_valid || null, papers.irn || null, papers.ack_no || null, inv.invoice_id]);
  const used = made.on_account_used || []; // invoices.issue used what was on account (an advance first)
  const v = await invoiceRow(q, 'i.invoice_id = ?', [inv.invoice_id]);
  const miss = await papersMissing(q, v);
  return { invoice_no: inv.invoice_no, total: Number(inv.total), due_on: inv.due_on, on_account_used: used,
    message: `${rs(inv.total)} posted to ${v.customer}'s ledger, due ${inv.due_on}.${used.length ? ` On account used: ${used.join(', ')}.` : ''}${miss.length ? ` Add the ${miss.join(' and ')} before the goods leave.` : ' The goods can leave.'}` };
}
/** add the papers to an issued invoice (before the goods leave) */
async function addPapers(q, invoiceNo, b, empId) {
  const v = await invoiceRow(q, 'i.invoice_no = ?', [invoiceNo], true);
  if (!v) throw new BillingError(`No invoice ${invoiceNo}`, 404);
  if (v.status !== 'issued') throw new BillingError(`${invoiceNo} is cancelled`, 409);
  const n = await needs(q, { total: v.total, customerId: v.customer_id, godownId: v.godown_id, day: v.day, gstin: v.buyer.bill.gstin, invoiceId: v.invoice_id });
  const p = await readPapers(q, b, { ewb: n.ewb && !v.ewb_no ? n.ewb : '', irn: n.irn && !v.irn }, v.invoice_id);
  await q.query('UPDATE invoices SET ewb_no = COALESCE(?, ewb_no), ewb_valid = COALESCE(?, ewb_valid), irn = COALESCE(?, irn), ack_no = COALESCE(?, ack_no) WHERE invoice_id = ?',
    [p.ewb_no || null, p.ewb_valid || null, p.irn || null, p.ack_no || null, v.invoice_id]);
  await audit(q, { empId, action: 'papers', entity: 'invoice', entityId: invoiceNo, after: { ewb_no: p.ewb_no, ewb_valid: p.ewb_valid, irn: p.irn ? `${p.irn.slice(0, 8)}...` : undefined, ack_no: p.ack_no } });
  const miss = await papersMissing(q, await invoiceRow(q, 'i.invoice_id = ?', [v.invoice_id]));
  return { message: miss.length ? `Still missing ${miss.join(' and ')}.` : 'The goods can leave.' };
}

/** why an issued invoice cannot be cancelled now ('' = it can) */
async function cancelBlock(q, v) {
  if (v.status !== 'issued') return `${v.invoice_no} is cancelled already.`;
  const [[cnw]] = await q.query("SELECT GROUP_CONCAT(credit_note_no) AS n FROM credit_notes WHERE invoice_id = ? AND status = 'waiting'", [v.invoice_id]);
  if (cnw.n) return `A credit note on ${v.invoice_no} waits for approval (${cnw.n}). Decide it first (or withdraw it), then cancel.`;
  const [[dn]] = await q.query("SELECT GROUP_CONCAT(debit_note_no) AS n FROM debit_notes WHERE invoice_id = ? AND status = 'done'", [v.invoice_id]);
  if (dn.n) return `${dn.n} is on ${v.invoice_no}. An invoice with a debit note is not cancelled: make a credit note for the invoice and one for the debit note instead.`;
  const [[cn]] = await q.query("SELECT COALESCE(SUM(total), 0) AS n FROM credit_notes WHERE invoice_id = ? AND status = 'done' AND kind <> 'cancel'", [v.invoice_id]);
  const [[pd]] = await q.query("SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS n FROM payments WHERE order_id = ? AND reversed_at IS NULL", [v.order_id]);
  if (Number(cn.n) > 0.004 || Number(pd.n) > 0.004) return `${rs(Number(cn.n) + Number(pd.n))} has been paid or credited against ${v.invoice_no}. Make a credit note instead.`;
  if (v.dispatched_at || LEFT.includes(v.order_status)) return `The goods of ${v.invoice_no} have left (${v.order_no} is ${String(v.order_status).replace(/_/g, ' ')}). Make a credit note for what comes back instead.`;
  return '';
}
async function askCancel(q, invoiceNo, reason, empId) {
  const v = await invoiceRow(q, 'i.invoice_no = ?', [invoiceNo], true);
  if (!v) throw new BillingError(`No invoice ${invoiceNo}`, 404);
  const why = String(reason || '').trim().slice(0, 120);
  if (why.length < 3) fail({ reason: 'Give the reason.' });
  if (v.cancel_approval_id) {
    const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE approval_id = ? AND status = 'pending'", [v.cancel_approval_id]);
    if (w) throw new BillingError(`The cancel of ${invoiceNo} already waits for approval (#${w.approval_id})`, 409);
  }
  const block = await cancelBlock(q, v);
  if (block) throw new BillingError(block, 409);
  await books.guardRecord(q, { date: v.day, key: `inv:${v.invoice_id}`, label: `Cancel invoice ${invoiceNo}`, godownId: v.godown_id }, empId);
  if (await approvals.needed(q, 'cancel_invoice', { amount: Number(v.total), target: `cust:${v.customer_id}` })) {
    const id = await approvals.request(q, { kind: 'cancel_invoice', godownId: v.godown_id, target: `cust:${v.customer_id}`, refType: 'invoice', refId: invoiceNo, amount: Number(v.total), recordDate: v.day,
      summary: `Cancel ${invoiceNo} for ${v.customer} (${rs(v.total)}): ${why}`, payload: { invoice_id: v.invoice_id, invoice_no: invoiceNo } }, empId);
    await q.query('UPDATE invoices SET cancel_approval_id = ?, cancel_ask_why = ? WHERE invoice_id = ?', [id, why, v.invoice_id]);
    await audit(q, { empId, action: 'request', entity: 'invoice', entityId: invoiceNo, after: { cancel: why, approval: id } });
    return { waiting: true, approval_id: id, message: `Cancelling an invoice needs a second person (request ${id}).` };
  }
  await q.query('UPDATE invoices SET cancel_ask_why = ? WHERE invoice_id = ?', [why, v.invoice_id]);
  await approvals.direct(q, 'cancel_invoice', { amount: Number(v.total), target: `cust:${v.customer_id}` }, empId);
  await cancelAlone(q, v.invoice_id, empId);
  return { done: true, message: `${invoiceNo} cancelled. The ledger has a reversing line; ${v.order_no} can be invoiced again.` };
}
async function cancelAlone(q, invoiceId, empId) {
  const v = await invoiceRow(q, 'i.invoice_id = ?', [invoiceId], true);
  if (!v || v.status !== 'issued') return;
  const block = await cancelBlock(q, v);
  if (block) throw new BillingError(block, 409);
  await q.query("UPDATE invoices SET status = 'cancelled', cancel_kind = 'alone', live_order_id = NULL, cancelled_at = UTC_TIMESTAMP(), cancel_reason = cancel_ask_why, cancelled_by = ? WHERE invoice_id = ?", [empId, invoiceId]);
  await commerce().refreshPayment(q, v.order_id);
  await audit(q, { empId, action: 'cancel', entity: 'invoice', entityId: v.invoice_no, before: { status: 'issued' }, after: { status: 'cancelled', reason: v.cancel_ask_why, alone: true } });
}
approvals.onApproved('cancel_invoice', async (q, p, empId) => { if (p && p.invoice_id) await cancelAlone(q, p.invoice_id, empId); });
approvals.onClosed('cancel_invoice', async (q, p) => { if (p && p.invoice_id) await q.query('UPDATE invoices SET cancel_approval_id = NULL WHERE invoice_id = ? AND status = \'issued\'', [p.invoice_id]); });
approvals.onRecheck('cancel_invoice', async (q, p) => {
  if (!p || !p.invoice_id) return '';
  const v = await invoiceRow(q, 'i.invoice_id = ?', [p.invoice_id]);
  if (!v || v.status !== 'issued') return '';
  const b = await cancelBlock(q, v);
  if (b) return `${b} (since the cancel was asked)`;
  const lw = await books.lockWhy(q, v.day, `inv:${v.invoice_id}`);
  return lw ? `${v.day.slice(0, 7)} is now with the CA and locked.` : '';
});

// ---------------------------------------------------------------- credit notes
/** the value of returns still open on an invoice's order (no credit note yet): they hold their room (v23 Low3 b) */
async function returnsHeld(q, orderId, exceptReturn = 0) {
  const [rows] = await q.query(`SELECT ri.sku_code, SUM(IF(ri.qty_received > 0, ri.qty_received, ri.qty)) AS qty FROM returns r JOIN return_items ri ON ri.return_id = r.return_id
      WHERE r.order_id = ? AND r.return_id <> ? AND r.status NOT IN ('closed', 'cancelled', 'rejected', 'refunded', 'replaced')
        AND NOT EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.return_id = r.return_id AND cn.status <> 'rejected') GROUP BY ri.sku_code`, [orderId, exceptReturn]);
  if (!rows.length) return 0;
  const [items] = await q.query('SELECT sku_code, SUM(qty) AS qty, SUM(line_total) AS total FROM order_items WHERE order_id = ? GROUP BY sku_code', [orderId]);
  let t = 0;
  for (const r of rows) { const it = items.find((x) => x.sku_code === r.sku_code); if (it && Number(it.qty)) t += (Number(it.total) / Number(it.qty)) * Number(r.qty); }
  return r2(t);
}
/** room left for credit notes on an invoice (its value less every credit note on it and the returns still open) */
async function noteRoom(q, invoiceId, { exceptCn = 0, exceptReturn = 0 } = {}) {
  const [[v]] = await q.query('SELECT invoice_id, order_id, total FROM invoices WHERE invoice_id = ?', [invoiceId]);
  const [[c]] = await q.query("SELECT COALESCE(SUM(total), 0) AS n FROM credit_notes WHERE invoice_id = ? AND status IN ('done', 'waiting') AND kind <> 'cancel' AND credit_note_id <> ?", [invoiceId, exceptCn]);
  const held = await returnsHeld(q, v.order_id, exceptReturn);
  return { room: r2(Number(v.total) - Number(c.n) - held), held, total: r2(v.total), used: r2(c.n) };
}
/** the invoice's main GST rate (the rate with the most taxable value) */
async function mainRate(q, orderId) {
  const [rows] = await q.query('SELECT gst_rate, SUM(taxable) AS t FROM order_items WHERE order_id = ? AND is_free = 0 GROUP BY gst_rate ORDER BY t DESC LIMIT 1', [orderId]);
  return rows.length ? Number(rows[0].gst_rate) : 18;
}
async function taxOf(q, taxable, rate, gstType) {
  const cs = await commerceSettings.read(q);
  const tax = r2((taxable * rate) / 100);
  const cg = gstType === 'intra' ? r2(tax / 2) : 0;
  const sg = gstType === 'intra' ? r2(tax - cg) : 0;
  const ig = gstType === 'intra' ? 0 : tax;
  const before = r2(taxable + tax);
  const ro = cs.invoice_round_off ? r2(Math.round(before) - before) : 0;
  return { taxable: r2(taxable), cgst: cg, sgst: sg, igst: ig, round_off: ro, total: r2(before + ro) };
}
/** a credit note with no goods back: b = { invoice_no, why, amount (without GST), note } */
async function creditPrice(q, b, empId) {
  const errs = {};
  const v = b.invoice_no ? await invoiceRow(q, 'i.invoice_no = ?', [String(b.invoice_no)], true) : null;
  if (!v) errs.invoice_no = 'Choose the invoice.';
  else if (v.status !== 'issued') errs.invoice_no = `${v.invoice_no} is cancelled: no credit note on it.`;
  else if (v.cancel_approval_id && (await q.query("SELECT 1 FROM approvals WHERE approval_id = ? AND status = 'pending'", [v.cancel_approval_id]))[0].length) errs.invoice_no = `${v.invoice_no} waits to be cancelled. Decide the cancel first.`;
  const why = CN_WHY.includes(b.why) ? b.why : 'Price correction';
  const s = String(b.amount ?? '').trim();
  const amt = r2(Number(s));
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || amt <= 0) errs.amount = 'More than 0.';
  else if (v && amt > r2(Number(v.taxable) + Number(v.delivery_charge)) + 0.004) errs.amount = `More than the invoice value without GST (${rs(r2(Number(v.taxable) + Number(v.delivery_charge)))}).`;
  const note = String(b.note || '').trim().slice(0, 120);
  if (note.length < 5) errs.note = 'Say what was agreed.';
  if (Object.keys(errs).length) fail(errs);
  const today = pricing.istToday();
  const lw = await books.lockWhy(q, today);
  if (lw) throw new BillingError(lw, 409);
  const rate = await mainRate(q, v.order_id);
  const t = await taxOf(q, amt, rate, v.gst_type);
  const room = await noteRoom(q, v.invoice_id);
  if (t.total > room.room + 0.004) fail({ amount: `Too much for ${v.invoice_no}: credit notes on it together cannot pass the invoice value ${rs(v.total)}. Room left: ${rs(Math.max(0, room.room))}${room.held ? ` (${rs(room.held)} is held for returns still open on it)` : ''}.` }, 409);
  const no = await numbering.issue(q, 'credit', v.godown_id);
  const fy = numbering.fyOf(new Date());
  const seq = Number(no.split('/').pop());
  const kind = why === 'Other' ? 'other' : 'price';
  const [ins] = await q.query(`INSERT INTO credit_notes (credit_note_no, fy, seq, invoice_id, reason, status, kind, note, gst_rate, taxable, cgst, sgst, igst, round_off, total, issued_at, emp_id)
      VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)`, [no, fy.fy, seq, v.invoice_id, `${why}: ${note}`.slice(0, 255), kind, note, rate, t.taxable, t.cgst, t.sgst, t.igst, t.round_off, t.total, empId]);
  if (await approvals.needed(q, 'credit_no_return', { amount: t.total, target: `cust:${v.customer_id}` })) {
    const id = await approvals.request(q, { kind: 'credit_no_return', godownId: v.godown_id, target: `cust:${v.customer_id}`, refType: 'credit_note', refId: no, amount: t.total,
      summary: `Credit note ${no} for ${v.customer} against ${v.invoice_no}: ${why} (${rs(t.total)})`, payload: { credit_note_id: ins.insertId, credit_note_no: no } }, empId);
    await q.query('UPDATE credit_notes SET approval_id = ? WHERE credit_note_id = ?', [id, ins.insertId]);
    await audit(q, { empId, action: 'request', entity: 'credit_note', entityId: no, after: { invoice: v.invoice_no, total: t.total, why, note } });
    return { waiting: true, credit_note_no: no, total: t.total, approval_id: id, message: `${no}: no goods come back, so a second person signs it (request ${id}).` };
  }
  await approvals.direct(q, 'credit_no_return', { amount: t.total, target: `cust:${v.customer_id}` }, empId);
  await postCredit(q, ins.insertId, empId);
  return { done: true, credit_note_no: no, total: t.total, message: `${rs(t.total)} off ${v.customer}'s balance.` };
}
async function postCredit(q, cnId, empId) {
  const [[c]] = await q.query("SELECT cn.credit_note_id, cn.credit_note_no, cn.invoice_id, cn.total, cn.taxable, cn.reason, i.order_id, i.invoice_no FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id WHERE cn.credit_note_id = ? AND cn.status = 'waiting' FOR UPDATE", [cnId]);
  if (!c) return;
  await q.query("UPDATE credit_notes SET status = 'done', decided_by = ? WHERE credit_note_id = ?", [empId, cnId]);
  await commerce().refreshPayment(q, c.order_id);
  // phase 22 (v23 14.5): the cashback on the order gives back its share of a price correction (all of it under the rule's minimum, W2)
  await require('./promotions').reverseCashback(q, c.order_id, Number(c.taxable), null, c.credit_note_no, empId); // eslint-disable-line global-require
  await audit(q, { empId, action: 'issue', entity: 'credit_note', entityId: c.credit_note_no, after: { invoice: c.invoice_no, total: Number(c.total), reason: c.reason } });
}
approvals.onApproved('credit_no_return', async (q, p, empId) => { if (p && p.credit_note_id) await postCredit(q, p.credit_note_id, empId); });
approvals.onClosed('credit_no_return', async (q, p, status, empId) => {
  if (!p || !p.credit_note_id) return;
  await q.query("UPDATE credit_notes SET status = 'rejected', decided_by = ? WHERE credit_note_id = ? AND status = 'waiting'", [empId, p.credit_note_id]);
});
approvals.onRecheck('credit_no_return', async (q, p) => {
  if (!p || !p.credit_note_id) return '';
  const [[c]] = await q.query('SELECT cn.invoice_id, cn.total, cn.status, i.invoice_no, i.status AS inv_status, i.cancel_approval_id FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id WHERE cn.credit_note_id = ?', [p.credit_note_id]);
  if (!c || c.status !== 'waiting') return '';
  if (c.inv_status !== 'issued') return `${c.invoice_no} is cancelled: no credit note on it.`;
  if (c.cancel_approval_id && (await q.query("SELECT 1 FROM approvals WHERE approval_id = ? AND status = 'pending'", [c.cancel_approval_id]))[0].length) return `${c.invoice_no} is waiting to be cancelled: no credit note on it.`;
  const room = await noteRoom(q, c.invoice_id, { exceptCn: p.credit_note_id });
  return Number(c.total) > room.room + 0.004 ? `Other credit notes on ${c.invoice_no} leave room for only ${rs(Math.max(0, room.room))}, not ${rs(c.total)}.` : '';
});

// ---------------------------------------------------------------- debit notes
async function debitNote(q, b, empId) {
  const errs = {};
  const v = b.invoice_no ? await invoiceRow(q, 'i.invoice_no = ?', [String(b.invoice_no)], true) : null;
  if (!v) errs.invoice_no = 'Choose the invoice.';
  else if (v.status !== 'issued') errs.invoice_no = `${v.invoice_no} is cancelled.`;
  else if (v.cancel_approval_id && (await q.query("SELECT 1 FROM approvals WHERE approval_id = ? AND status = 'pending'", [v.cancel_approval_id]))[0].length) errs.invoice_no = `${v.invoice_no} waits to be cancelled. Decide the cancel first.`;
  const why = DN_WHY.includes(b.why) ? b.why : null;
  if (!why) errs.why = `Why: ${DN_WHY.join(', ')}`;
  const s = String(b.amount ?? '').trim();
  const amt = r2(Number(s));
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || amt <= 0) errs.amount = 'More than 0.';
  if (Object.keys(errs).length) fail(errs);
  const today = pricing.istToday();
  const lw = await books.lockWhy(q, today);
  if (lw) throw new BillingError(lw, 409);
  const rate = await mainRate(q, v.order_id);
  const t = await taxOf(q, amt, rate, v.gst_type);
  const [[cu]] = await q.query('SELECT credit_days FROM customers WHERE customer_id = ?', [v.customer_id]);
  const days = Number(cu.credit_days) || 0;
  const no = await numbering.issue(q, 'sdebit', v.godown_id);
  const fy = numbering.fyOf(new Date());
  const note = String(b.note || '').trim().slice(0, 120) || null;
  await q.query(`INSERT INTO debit_notes (debit_note_no, fy, invoice_id, customer_id, godown_id, reason, note, gst_type, gst_rate, taxable, cgst, sgst, igst, round_off, total, due_on, issued_at, emp_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), UTC_TIMESTAMP(), ?)`,
  [no, fy.fy, v.invoice_id, v.customer_id, v.godown_id, why, note, v.gst_type, rate, t.taxable, t.cgst, t.sgst, t.igst, t.round_off, t.total, today, days, empId]);
  const [[d]] = await q.query("SELECT DATE_FORMAT(due_on, '%Y-%m-%d') AS due FROM debit_notes WHERE debit_note_no = ?", [no]);
  await audit(q, { empId, action: 'issue', entity: 'debit_note', entityId: no, after: { invoice: v.invoice_no, total: t.total, why, note, due_on: d.due } });
  return { debit_note_no: no, total: t.total, due_on: d.due, message: `${rs(t.total)} added to ${v.customer}'s balance, due ${d.due}.` };
}

// ---------------------------------------------------------------- delivery challans
/** goods sent without a sale: b = { godown_id, why, to_name, to_address, lines: [{ sku_code, qty }] } */
async function makeChallan(q, b, empId) {
  const errs = {};
  const godown = Number(b.godown_id);
  const [[g]] = await q.query('SELECT location_id, name FROM locations WHERE location_id = ? AND is_active = 1', [godown]);
  if (!g) errs.godown_id = 'Choose the godown.';
  const why = DC_WHY.includes(b.why) ? b.why : null;
  if (!why) errs.why = `Why: ${DC_WHY.join(', ')}`;
  const to = String(b.to_name || '').trim().slice(0, 80);
  const addr = String(b.to_address || '').trim().slice(0, 120);
  if (to.length < 2) errs.to_name = 'Who gets the goods.';
  if (addr.length < 3) errs.to_address = 'Where they go.';
  const raw = Array.isArray(b.lines) ? b.lines : [];
  const lines = []; const seen = new Set();
  const codes = raw.map((l) => String(l.sku_code || '').trim().toUpperCase()).filter(Boolean);
  if (codes.length) await stock.lockSkus(q, codes);
  for (const [i, l] of raw.entries()) {
    const sku = String(l.sku_code || '').trim().toUpperCase(); const qn = String(l.qty ?? '').trim();
    if (!sku && !qn) continue;
    const [[s]] = await q.query("SELECT sku_code, avg_cost, std_cost, status FROM skus WHERE sku_code = ? AND sku_type <> 'raw'", [sku]);
    if (!s) { errs[`lines.${i}.sku_code`] = 'Choose the item.'; continue; }
    if (seen.has(sku)) { errs[`lines.${i}.sku_code`] = 'Already on this challan.'; continue; }
    seen.add(sku);
    const n = Number(qn);
    if (!Number.isInteger(n) || n < 1) { errs[`lines.${i}.qty`] = 'A whole number, at least 1.'; continue; }
    if (g) {
      const a = (await stock.availability(q, [sku], 0, { godown, lock: true })).get(sku);
      const free = Math.max(0, Number(a.good) - Number(a.reserved) - Number(a.expired || 0));
      if (n > free) { errs[`lines.${i}.qty`] = `${sku}: only ${free} free at ${g.name}.`; continue; }
    }
    lines.push({ sku, qty: n, cost: s.avg_cost === null ? (s.std_cost === null ? null : Number(s.std_cost)) : Number(s.avg_cost) });
  }
  if (!lines.length && !Object.keys(errs).some((k) => k.startsWith('lines.'))) errs['lines.0.sku_code'] = 'Add at least one item.';
  if (Object.keys(errs).length) fail(errs);
  for (const l of lines) { const f = await stock.frozenBy(q, godown, l.sku); if (f) throw new BillingError(f, 409); }
  await books.assertOpen(q, pricing.istToday());
  const no = await numbering.issue(q, 'challan', godown);
  const value = r2(lines.reduce((a, l) => a + (l.cost || 0) * l.qty, 0));
  const [ins] = await q.query('INSERT INTO delivery_challans (challan_no, godown_id, why, to_name, to_address, value, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [no, godown, why, to, addr, value, empId]);
  for (const l of lines) {
    const lots = await stock.moveStock(q, { sku: l.sku, godown, shelf: 'good', qty: -l.qty, what: 'challan', noScanned: true, unitCost: l.cost === null ? null : r2(l.cost),
      doc: { type: 'challan', id: no }, note: `Challan: ${why} to ${to}` }, empId);
    for (const x of lots) await q.query('INSERT INTO delivery_challan_lines (challan_id, sku_code, batch_id, qty, unit_cost) VALUES (?, ?, ?, ?, ?)', [ins.insertId, l.sku, x.batch_id || null, x.qty, l.cost]);
  }
  await audit(q, { empId, action: 'issue', entity: 'challan', entityId: no, after: { godown: g.name, why, to, lines: lines.map((l) => `${l.sku} ${l.qty}`), value } });
  return { challan_no: no, value, message: `${lines.reduce((a, l) => a + l.qty, 0)} packs left the shelf at ${g.name} (${why.toLowerCase()}). Print it to go with the goods.` };
}

// ---------------------------------------------------------------- GSTR-3B data
/** one month's output and input tax for the CA: output = invoices - credit notes + debit notes, input = supplier bills */
async function gstr3b(q, month, scope = null) {
  const reports = require('./reports'); // eslint-disable-line global-require
  const from = `${month}-01`;
  const to = books.lastDay(month);
  const facts = (await reports.salesFacts(q, { from, to, scope })).filter((r) => r.sku_code !== '(round off)');
  const out = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  for (const f of facts) { out.taxable += f.taxable; out.igst += f.igst; out.cgst += f.cgst; out.sgst += f.sgst; }
  const { inScope } = require('./scope-sql'); // eslint-disable-line global-require
  const [bills] = await q.query(`SELECT taxable, freight, gst, inter_state FROM supplier_bills WHERE status IN ('unpaid', 'part', 'paid') AND DATE_FORMAT(bill_date, '%Y-%m') = ? AND ${inScope('godown_id', scope)}`, [month]);
  const inp = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  for (const b of bills) {
    inp.taxable += Number(b.taxable) + Number(b.freight);
    if (Number(b.inter_state)) inp.igst += Number(b.gst);
    else { const h = r2(Number(b.gst) / 2); inp.cgst += h; inp.sgst += r2(Number(b.gst) - h); }
  }
  Object.keys(out).forEach((k) => { out[k] = r2(out[k]); }); Object.keys(inp).forEach((k) => { inp[k] = r2(inp[k]); });
  const pay = { igst: r2(out.igst - inp.igst), cgst: r2(out.cgst - inp.cgst), sgst: r2(out.sgst - inp.sgst) };
  return { month, output: { ...out, tax: r2(out.igst + out.cgst + out.sgst) }, input: { ...inp, tax: r2(inp.igst + inp.cgst + inp.sgst), bills: bills.length }, to_pay: { ...pay, tax: r2(pay.igst + pay.cgst + pay.sgst) } };
}

module.exports = {
  BillingError, CN_WHY, DN_WHY, DC_WHY, rules, needs, ewbWhy, readPapers, invoiceRow, papersMissing, leaveCheck, toInvoice, preview, makeInvoice, addPapers,
  cancelBlock, askCancel, cancelAlone, returnsHeld, noteRoom, mainRate, creditPrice, postCredit, debitNote, makeChallan, gstr3b, dayLoad,
};
