// Documents as PDF (phase 10): the tax invoice, the credit note and the statement of account, attached to the
// notification mails (built when the mail is sent, outbox-worker.js) and downloadable in the admin. The same data as
// the printed versions (invoiceData / creditNoteData feed GET /commerce/invoices/:id and /credit-notes/:id, and
// src/admin/invoicePrint.js prints them in the browser), so the PDF and the print never disagree. A4, the dFresh logo
// on an ink band, labels in English; names, addresses and notes print in whatever script they were typed in
// (pdf-writer.js: pdfkit with the Noto fonts). "DEMO - not a tax invoice" while the seller GSTIN is a placeholder.
const fs = require('fs');
const path = require('path');
const { Pdf, PAGE_W } = require('./pdf-writer');
const commerceSettings = require('./commerce-settings');
const customers = require('./customers');
const { stateName, posReason } = require('../shared/gstStates');

const SKU_NAME = 'COALESCE(t.name, pt.name, s.product_id)';
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;

const INK = '#121214';
const GOLD = '#E5BF24';
const GREY = '#5c5a52';
const LINE = '#d6d0bf';
const HEAD_BG = '#f6f3ea';
const M = 36; // page margin
const CW = PAGE_W - 2 * M;

// ---------------------------------------------------------------- data (shared with the admin print routes)
async function siteContact(q) {
  const [site] = await q.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('cin', 'office_phone', 'public_email')");
  return Object.fromEntries(site.map((x) => [x.setting_key, x.setting_value]));
}

/** an invoice with its lines and credit notes -> the object GET /commerce/invoices/:id returns (null when none) */
async function invoiceData(q, id) {
  const [[inv]] = await q.query(
    `SELECT i.invoice_id, i.invoice_no, i.fy, i.status, i.issued_at, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on, i.place_of_supply, i.gst_type, i.taxable, i.delivery_charge, i.delivery_gst, i.cgst, i.sgst, i.igst,
            i.round_off, i.total, i.seller_name, i.seller_gstin, i.seller_address, i.seller_state_code, i.buyer_json, i.is_demo, i.cancelled_at, i.cancel_reason,
            o.order_no, o.order_id, o.subtotal, o.discount, o.offer_discount, o.manual_discount, o.manual_discount_reason, o.delivery_waived, o.coupon_code, o.wallet_used, o.wallet_discount,
            o.wallet_gst, o.payment_terms
       FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_id = ?`, [Number(id)]
  );
  if (!inv) return null;
  const [lines] = await q.query(`SELECT i.sku_code, i.is_free, i.qty, i.price, i.list_price, i.offer_discount, i.coupon_discount, i.wallet_discount, i.hsn, i.gst_rate, i.taxable, i.cgst, i.sgst, i.igst,
       i.line_total, ${SKU_NAME} AS name, s.size_label, f.name AS offer_name
       FROM order_items i JOIN skus s ON s.sku_code = i.sku_code ${SKU_JOIN} LEFT JOIN offers f ON f.offer_id = i.offer_id WHERE i.order_id = ? ORDER BY i.sku_code, i.is_free`, [inv.order_id]);
  const [cns] = await q.query('SELECT credit_note_id, credit_note_no, reason, taxable, cgst, sgst, igst, round_off, total, issued_at FROM credit_notes WHERE invoice_id = ?', [inv.invoice_id]);
  const s = await siteContact(q);
  const buyer = typeof inv.buyer_json === 'string' ? JSON.parse(inv.buyer_json) : inv.buyer_json;
  return { ...inv, buyer_json: undefined, buyer, lines, credit_notes: cns, is_demo: Number(inv.is_demo) === 1, seller_state: stateName(inv.seller_state_code),
    pos_state: stateName(inv.place_of_supply), pos_reason: posReason(buyer.bill.gstin, inv.place_of_supply), bill_state: stateName(buyer.bill.state_code), ship_state: stateName(buyer.ship.state_code), cin: s.cin, phone: s.office_phone, email: s.public_email,
    bank: String((await commerceSettings.read(q)).invoice_bank_details || '').trim() || null }; // Commerce setting: printed when filled
}

/** a credit note with the invoice snapshot and its own lines (null when none) */
async function creditNoteData(q, id) {
  const [[cn]] = await q.query(`SELECT cn.credit_note_id, cn.credit_note_no, cn.reason, cn.taxable, cn.cgst, cn.sgst, cn.igst, cn.round_off, cn.total, cn.issued_at, cn.return_id, r.return_no,
      i.invoice_no, i.issued_at AS invoice_date, i.gst_type, i.place_of_supply, i.seller_name, i.seller_gstin, i.seller_address, i.seller_state_code, i.buyer_json, i.is_demo, o.order_no
      FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id LEFT JOIN returns r ON r.return_id = cn.return_id
      WHERE cn.credit_note_id = ?`, [Number(id)]);
  if (!cn) return null;
  const [lines] = await q.query(`SELECT l.sku_code, l.hsn, l.gst_rate, l.qty, l.taxable, l.cgst, l.sgst, l.igst, l.line_total, ${SKU_NAME} AS name, s.size_label
      FROM credit_note_lines l JOIN skus s ON s.sku_code = l.sku_code ${SKU_JOIN} WHERE l.credit_note_id = ? ORDER BY l.id`, [cn.credit_note_id]);
  const buyer = typeof cn.buyer_json === 'string' ? JSON.parse(cn.buyer_json) : cn.buyer_json;
  return { ...cn, buyer_json: undefined, buyer, lines, is_demo: Number(cn.is_demo) === 1, seller_state: stateName(cn.seller_state_code), pos_state: stateName(cn.place_of_supply),
    pos_reason: posReason(buyer.bill.gstin, cn.place_of_supply), bill_state: stateName(buyer.bill.state_code) };
}

/** the statement of account of a customer (as the Customers drawer shows it) */
async function statementData(q, customerId, { from = null, to = null } = {}) {
  const [[c]] = await q.query('SELECT customer_id, customer_no, name, business_name, phone, credit_days, credit_limit FROM customers WHERE customer_id = ?', [Number(customerId)]);
  if (!c) return null;
  const addr = (await customers.addressesOf(q, c.customer_id)).find((a) => a.kind === 'billing' && a.is_default) || null;
  const cs = await commerceSettings.read(q);
  return { customer: { ...c, credit_limit: Number(c.credit_limit) }, bill: addr, from, to, seller: { name: cs.invoice_seller_name, address: cs.invoice_seller_address }, ...(await customers.statement(q, c.customer_id, { from, to })) };
}

// ---------------------------------------------------------------- layout
let logoPng = null; // the mail logo (on-dark), read once
const logo = () => {
  if (!logoPng) logoPng = fs.readFileSync(path.join(__dirname, 'mail-logo.png'));
  return logoPng;
};
const LOGO_RATIO = 124 / 68; // mail-logo.png
const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => `${Number(n) > 0 ? '+' : Number(n) < 0 ? '-' : ''}${Math.abs(Number(n)).toFixed(2)}`;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const istDay = (v) => (v ? day(new Date(new Date(v).getTime() + 5.5 * 3600e3).toISOString()) : '');
const addrLines = (a, state) => [a.name, a.address, [a.town, a.pincode].filter(Boolean).join(' '), state, a.gstin ? `GSTIN ${a.gstin}` : null, a.phone].filter(Boolean);

/** a page writer with a cursor, the dFresh header on every page and page numbers at the end */
class Doc {
  constructor(title, demo) {
    this.pdf = new Pdf({ title });
    this.title = title;
    this.demo = demo;
    this.y = 0;
  }

  async start() {
    this.logo = logo();
    this.header();
    return this;
  }

  header() {
    const p = this.pdf;
    p.rect(0, 0, PAGE_W, 54, { fill: INK });
    p.rect(0, 54, PAGE_W, 3, { fill: GOLD });
    const h = 30;
    p.image(this.logo, M, 12, LOGO_RATIO * h, h);
    p.text(M, 20, this.title, { size: 14, bold: true, color: '#FCFBF6', align: 'right', width: CW });
    this.y = 72;
    if (this.demo) {
      p.rect(M, this.y, CW, 18, { fill: '#fdf1f1' });
      p.text(M + 6, this.y + 4, 'DEMO - not a tax invoice (the seller GSTIN is still to be confirmed)', { size: 9, bold: true, color: '#9b1c1c' });
      this.y += 26;
    }
  }

  /** room for h more points, else a new page */
  need(h) {
    if (this.y + h <= 842 - 48) return false;
    this.pdf.addPage();
    this.header();
    return true;
  }

  /** two blocks of lines side by side (seller | document facts, bill to | ship to) */
  columns(left, right, { size = 9 } = {}) {
    const lh = size * 1.35; const half = CW / 2 - 8;
    const L = left.flatMap(([t, b]) => this.pdf.wrap(t, half, size, b).map((x) => [x, b]));
    const R = right.flatMap(([t, b]) => this.pdf.wrap(t, half, size, b).map((x) => [x, b]));
    this.need(Math.max(L.length, R.length) * lh);
    L.forEach(([t, b], i) => this.pdf.text(M, this.y + i * lh, t, { size, bold: b }));
    R.forEach(([t, b], i) => this.pdf.text(M + CW / 2 + 8, this.y + i * lh, t, { size, bold: b }));
    this.y += Math.max(L.length, R.length) * lh + 10;
  }

  /** a table: cols = [{ label, w (share), align }], rows = arrays of cell text (a cell may hold \n) */
  table(cols, rows, { size = 8.5 } = {}) {
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * CW);
    const lh = size * 1.3; const pad = 4;
    const head = () => {
      const hl = cols.map((c, i) => this.pdf.wrap(c.label, widths[i] - 2 * pad, size, true));
      const hh = Math.max(...hl.map((l) => l.length)) * lh + 2 * pad;
      this.pdf.rect(M, this.y, CW, hh, { fill: HEAD_BG });
      let x = M;
      hl.forEach((ls, i) => { ls.forEach((t, k) => this.pdf.text(x + pad, this.y + pad + k * lh, t, { size, bold: true, align: cols[i].align || 'left', width: widths[i] - 2 * pad })); x += widths[i]; });
      this.y += hh;
      this.pdf.line(M, this.y, M + CW, this.y, { color: LINE });
    };
    head();
    for (const r of rows) {
      const cells = r.map((v, i) => this.pdf.wrap(String(v ?? ''), widths[i] - 2 * pad, size, false));
      const rh = Math.max(...cells.map((l) => l.length)) * lh + 2 * pad;
      if (this.need(rh)) head();
      let x = M;
      cells.forEach((ls, i) => { ls.forEach((t, k) => this.pdf.text(x + pad, this.y + pad + k * lh, t, { size, align: cols[i].align || 'left', width: widths[i] - 2 * pad })); x += widths[i]; });
      this.y += rh;
      this.pdf.line(M, this.y, M + CW, this.y, { color: LINE });
    }
    this.y += 10;
  }

  /** label / amount pairs on the right; grand = bold with a rule above */
  totals(rows) {
    const w = 250; const x = M + CW - w;
    for (const [label, value, grand] of rows) {
      const ls = this.pdf.wrap(label, w - 90, grand ? 10 : 9, grand);
      const rh = ls.length * 12 + (grand ? 6 : 2);
      this.need(rh);
      if (grand) { this.pdf.line(x, this.y, x + w, this.y, { color: INK, width: 1.2 }); this.y += 4; }
      ls.forEach((t, k) => this.pdf.text(x, this.y + k * 12, t, { size: grand ? 10 : 9, bold: grand }));
      this.pdf.text(x + w - 90, this.y, value, { size: grand ? 10 : 9, bold: grand, align: 'right', width: 90 });
      this.y += rh;
    }
    this.y += 8;
  }

  para(t, { size = 8.5, color = GREY, bold = false } = {}) {
    const ls = this.pdf.wrap(t, CW, size, bold);
    this.need(ls.length * size * 1.35);
    ls.forEach((x, i) => this.pdf.text(M, this.y + i * size * 1.35, x, { size, color, bold }));
    this.y += ls.length * size * 1.35 + 6;
  }

  finish() {
    const n = this.pdf.pageCount;
    for (let i = 0; i < n; i += 1) this.pdf.onPage(i).text(M, 842 - 30, `${this.title} - page ${i + 1} of ${n}`, { size: 7.5, color: GREY, align: 'right', width: CW });
    return this.pdf.toBuffer();
  }
}

// ---------------------------------------------------------------- the three documents
async function invoicePdf(q, id) {
  const inv = await invoiceData(q, id);
  if (!inv) return null;
  const intra = inv.gst_type === 'intra';
  const d = await new Doc(`Tax invoice ${inv.invoice_no}`, inv.is_demo).start();
  d.columns(
    [[inv.seller_name, true], [inv.seller_address], [`GSTIN: ${inv.is_demo ? 'to be confirmed' : inv.seller_gstin}`], [`State: ${inv.seller_state} (${inv.seller_state_code})${inv.cin ? ` - CIN ${inv.cin}` : ''}`], [[inv.phone, inv.email].filter(Boolean).join(' - ')]],
    [[`Invoice ${inv.invoice_no}`, true], [`Date: ${istDay(inv.issued_at)}`], [`Order: ${inv.order_no}`], [`Due on: ${day(inv.due_on)}`], [`Place of supply: ${inv.pos_state} (${inv.place_of_supply})`], [inv.pos_reason || ''],
      [intra ? 'CGST + SGST (same state as the seller)' : 'IGST (inter-state)']],
  );
  if (inv.status === 'cancelled') d.para(`CANCELLED${inv.cancel_reason ? ` - ${inv.cancel_reason}` : ''}`, { size: 11, bold: true, color: '#b3261e' });
  d.columns([['Bill to', true], ...addrLines(inv.buyer.bill, `${inv.bill_state} (${inv.buyer.bill.state_code})`).map((x) => [x])],
    [['Ship to', true], ...addrLines(inv.buyer.ship, `${inv.ship_state} (${inv.buyer.ship.state_code})`).map((x) => [x])]);
  const cols = [{ label: '#', w: 3 }, { label: 'Item', w: 27 }, { label: 'HSN', w: 12 }, { label: 'Qty', w: 6, align: 'right' }, { label: 'Rate', w: 10, align: 'right' }, { label: 'Taxable', w: 11, align: 'right' },
    ...(intra ? [{ label: 'CGST', w: 12, align: 'right' }, { label: 'SGST', w: 12, align: 'right' }] : [{ label: 'IGST', w: 14, align: 'right' }]), { label: 'Amount', w: 12, align: 'right' }];
  const rows = inv.lines.map((i, n) => [n + 1, `${i.name}\n${i.sku_code} - ${i.size_label}${Number(i.is_free) ? `\nFREE (${i.offer_name || 'offer'})` : Number(i.offer_discount) > 0 ? `\nOffer ${i.offer_name || ''}: - ${Number(i.offer_discount).toFixed(2)}` : ''}`,
    i.hsn, i.qty, money(i.price), money(i.taxable),
    ...(intra ? [`${(i.gst_rate / 2).toFixed(1)}% ${money(i.cgst)}`, `${(i.gst_rate / 2).toFixed(1)}% ${money(i.sgst)}`] : [`${Number(i.gst_rate).toFixed(1)}% ${money(i.igst)}`]), money(i.line_total)]);
  if (Number(inv.delivery_charge) > 0) {
    rows.push(['', 'Delivery charge', 'SAC 9965', '', '', money(inv.delivery_charge),
      ...(intra ? [money(Number(inv.delivery_gst) / 2), money(Number(inv.delivery_gst) / 2)] : [money(inv.delivery_gst)]), money(Number(inv.delivery_charge) + Number(inv.delivery_gst))]);
  }
  d.table(cols, rows);
  const walletPaid = Number(inv.wallet_used) - Number(inv.wallet_discount);
  d.totals([
    ['Goods', money(inv.subtotal)],
    ...(Number(inv.offer_discount) > 0 ? [['Offers', `- ${money(inv.offer_discount)}`]] : []),
    ...(Number(inv.discount) > 0 ? [[`Coupon${inv.coupon_code ? ` ${inv.coupon_code}` : ''}`, `- ${money(inv.discount)}`]] : []),
    ...(Number(inv.manual_discount) > 0 ? [[`Discount${inv.manual_discount_reason ? ` (${inv.manual_discount_reason})` : ''}`, `- ${money(inv.manual_discount)}`]] : []),
    ...(Number(inv.wallet_discount) > 0 ? [['Wallet cashback as a discount', `- ${money(inv.lines.reduce((a, l) => a + Number(l.wallet_discount || 0), 0))}`]] : []),
    ...(Number(inv.delivery_charge) > 0 ? [['Delivery charge', money(inv.delivery_charge)]] : []),
    ...(Number(inv.delivery_waived) > 0 ? [[`Delivery charge ${money(inv.delivery_waived)} waived`, '0.00']] : []),
    ['Taxable value', money(inv.taxable)],
    ...(intra ? [['CGST', money(inv.cgst)], ['SGST', money(inv.sgst)]] : [['IGST', money(inv.igst)]]),
    ...(Number(inv.round_off) ? [['Total before round off', money(Number(inv.total) - Number(inv.round_off))], ['Round off', signed(inv.round_off)]] : []),
    ['Invoice total', `Rs ${money(inv.total)}`, true],
    ...(walletPaid > 0.005 ? [['Paid from wallet', `- ${money(walletPaid)}`], ['To pay', `Rs ${money(Number(inv.total) - walletPaid)}`, true]] : []),
  ]);
  if (inv.credit_notes.length) d.para(`Credit notes against this invoice: ${inv.credit_notes.map((c) => `${c.credit_note_no} (${istDay(c.issued_at)}, Rs ${money(c.total)}${c.reason ? ` - ${c.reason}` : ''})`).join('; ')}`, { color: INK });
  if (inv.bank) d.para(`Pay to: ${inv.bank}`, { color: INK });
  d.para('Marketed by dFresh. Prices per pack before GST. This is a computer-generated invoice.');
  return { filename: `${inv.invoice_no.replace(/\//g, '-')}.pdf`, buffer: await d.finish() };
}

async function creditNotePdf(q, id) {
  const cn = await creditNoteData(q, id);
  if (!cn) return null;
  const intra = cn.gst_type === 'intra';
  const d = await new Doc(`Credit note ${cn.credit_note_no}`, cn.is_demo).start();
  d.columns(
    [[cn.seller_name, true], [cn.seller_address], [`GSTIN: ${cn.is_demo ? 'to be confirmed' : cn.seller_gstin}`], [`State: ${cn.seller_state} (${cn.seller_state_code})`]],
    [[`Credit note ${cn.credit_note_no}`, true], [`Date: ${istDay(cn.issued_at)}`], [`Against invoice ${cn.invoice_no} of ${istDay(cn.invoice_date)}`], [`Order: ${cn.order_no}`], ...(cn.return_no ? [[`Return: ${cn.return_no}`]] : []),
      [`Place of supply: ${cn.pos_state} (${cn.place_of_supply}), as invoiced`], [intra ? 'CGST + SGST (as invoiced)' : 'IGST (as invoiced)']],
  );
  d.columns([['To', true], ...addrLines(cn.buyer.bill, `${cn.bill_state} (${cn.buyer.bill.state_code})`).map((x) => [x])], [['Reason', true], [cn.reason || '']]);
  if (cn.lines.length) {
    d.table([{ label: '#', w: 3 }, { label: 'Item returned', w: 31 }, { label: 'HSN', w: 12 }, { label: 'Qty', w: 6, align: 'right' }, { label: 'Taxable', w: 12, align: 'right' },
      ...(intra ? [{ label: 'CGST', w: 13, align: 'right' }, { label: 'SGST', w: 13, align: 'right' }] : [{ label: 'IGST', w: 16, align: 'right' }]), { label: 'Amount', w: 12, align: 'right' }],
    cn.lines.map((l, n) => [n + 1, `${l.name}\n${l.sku_code} - ${l.size_label}`, l.hsn, l.qty, money(l.taxable),
      ...(intra ? [`${(l.gst_rate / 2).toFixed(1)}% ${money(l.cgst)}`, `${(l.gst_rate / 2).toFixed(1)}% ${money(l.sgst)}`] : [`${Number(l.gst_rate).toFixed(1)}% ${money(l.igst)}`]), money(l.line_total)]));
  }
  d.totals([['Taxable value', money(cn.taxable)], ...(intra ? [['CGST', money(cn.cgst)], ['SGST', money(cn.sgst)]] : [['IGST', money(cn.igst)]]),
    ...(Number(cn.round_off) ? [['Total before round off', money(Number(cn.total) - Number(cn.round_off))], ['Round off', signed(cn.round_off)]] : []), ['Credit total', `Rs ${money(cn.total)}`, true]]);
  d.para('Marketed by dFresh. This is a computer-generated credit note.');
  return { filename: `${cn.credit_note_no.replace(/\//g, '-')}.pdf`, buffer: await d.finish() };
}

const BUCKETS = [['d0_30', '0-30 days'], ['d31_60', '31-60 days'], ['d61_90', '61-90 days'], ['d90', 'Over 90 days']];
async function statementPdf(q, customerId, range = {}) {
  const st = await statementData(q, customerId, range);
  if (!st) return null;
  const c = st.customer;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const d = await new Doc(`Statement ${c.customer_no}`, false).start();
  d.columns([[st.seller.name, true], [st.seller.address || '']],
    [['Statement of account', true], [`Date: ${day(today)}`], [`Period: ${st.from ? day(st.from) : 'from the first entry'} to ${st.to ? day(st.to) : day(today)}`]]);
  d.columns([['To', true], [`${c.business_name || c.name} (${c.customer_no})`], ...(st.bill ? addrLines(st.bill, `${st.bill.state} (${st.bill.state_code})`).slice(1).map((x) => [x]) : [[c.phone]])],
    [['Terms', true], [`Credit: ${c.credit_days} days, limit Rs ${money(c.credit_limit)}`], [`Outstanding: Rs ${money(st.outstanding)}`, true]]);
  d.table([{ label: 'Date', w: 12 }, { label: 'Entry', w: 46 }, { label: 'Debit', w: 14, align: 'right' }, { label: 'Credit', w: 14, align: 'right' }, { label: 'Balance', w: 14, align: 'right' }],
    [...(st.from ? [[day(st.from), 'Opening balance', '', '', money(st.opening)]] : []),
      ...st.lines.map((l) => [day(l.day), l.text, l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '', money(l.balance)])]);
  d.totals([['Closing balance', `Rs ${money(st.closing)}`, true]]);
  if (st.open.length) {
    d.para('Open invoices', { size: 10, bold: true, color: INK });
    d.table([{ label: 'Invoice', w: 22 }, { label: 'Order', w: 18 }, { label: 'Date', w: 15 }, { label: 'Due on', w: 15 }, { label: 'Days', w: 10, align: 'right' }, { label: 'Owed', w: 20, align: 'right' }],
      st.open.map((o) => [o.invoice_no, o.order_no, day(o.day), `${day(o.due_on)}${o.overdue ? ' (overdue)' : ''}`, o.age, money(o.amount_due)]));
    d.table(BUCKETS.map(([, label]) => ({ label, w: 25, align: 'right' })), [BUCKETS.map(([k]) => money(st.ageing[k]))]);
  }
  d.para('Ageing by the invoice date. Please send the payment reference (UTR or cheque number) with every payment. This is a computer-generated statement.');
  return { filename: `Statement-${c.customer_no}-${today}.pdf`, buffer: await d.finish() };
}

/** an attachment spec from mail_outbox.attachments -> { filename, buffer } | null (the document is gone) */
async function build(q, a) {
  if (a.kind === 'invoice') return invoicePdf(q, a.id);
  if (a.kind === 'credit_note') return creditNotePdf(q, a.id);
  if (a.kind === 'statement') return statementPdf(q, a.id, {});
  throw new Error(`unknown attachment kind ${a.kind}`);
}

module.exports = { SKU_NAME, SKU_JOIN, invoiceData, creditNoteData, statementData, invoicePdf, creditNotePdf, statementPdf, build };
