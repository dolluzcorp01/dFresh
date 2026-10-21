// Tax invoice and credit note printing (new window; print or save as PDF), shared by Orders and Returns. The DEMO
// watermark shows while the seller GSTIN is a placeholder. A credit note for returned packs lists its lines at the
// invoice's own tax (CGST + SGST or IGST as invoiced); a cancellation credit note shows the totals only.
import { api } from './adminApi';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const istDay = (v) => day(new Date(new Date(v).getTime() + 5.5 * 3600e3).toISOString());
/** a round-off with its sign: +0.08, -0.34 (GST figures stay unrounded; only the total is rounded to the rupee) */
export const signed = (n) => `${Number(n) > 0 ? '+' : Number(n) < 0 ? '-' : ''}${Math.abs(Number(n)).toFixed(2)}`;
export const addrLines = (a, state) => [a.name, a.address, [a.town, a.pincode].filter(Boolean).join(' '), state, a.gstin ? `GSTIN ${a.gstin}` : null, a.phone].filter(Boolean);

export function printDoc(title, body, demo) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A4; margin: 12mm; } body { font-family: Arial, sans-serif; color: #121214; font-size: 12px; margin: 0; }
  .demo { background: #fdf1f1; color: #9b1c1c; padding: 6px 10px; font-weight: 700; margin-bottom: 10px; }
  .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
  .wm span { transform: rotate(-30deg); font-size: 56px; font-weight: 800; color: rgba(155, 28, 28, .13); white-space: nowrap; }
  body > *:not(.wm) { position: relative; z-index: 1; }
  h1 { font-size: 18px; margin: 0 0 4px; } .row { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f6f3ea; } .n { text-align: right; white-space: nowrap; } small { color: #555; }
  .tot { width: 340px; margin-left: auto; margin-top: 10px; } .tot td { border: none; padding: 3px 6px; } .grand td { font-weight: 700; font-size: 14px; border-top: 2px solid #121214; }
  .cancelled { border: 3px solid #b3261e; color: #b3261e; display: inline-block; padding: 4px 10px; font-weight: 800; margin: 6px 0; }
  .bar { padding: 8px 0; } @media print { .bar { display: none; } }
  </style></head><body>${demo ? '<div class="wm"><span>DEMO - not a tax invoice</span></div><div class="demo">DEMO - not a tax invoice (the seller GSTIN is still to be confirmed)</div>' : ''}
  <div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export function invoiceHtml(inv) {
  const intra = inv.gst_type === 'intra';
  const lines = inv.lines.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}<br><small>${esc(i.sku_code)} - ${esc(i.size_label)}</small>${Number(i.is_free) ? `<br><b>FREE</b> <small>(${esc(i.offer_name || 'offer')})</small>`
    : Number(i.offer_discount) > 0 ? `<br><small>Offer ${esc(i.offer_name || '')}: - ${Number(i.offer_discount).toFixed(2)}</small>` : ''}</td><td>${esc(i.hsn)}</td>
    <td class="n">${i.qty}</td><td class="n">${Number(i.price).toFixed(2)}</td><td class="n">${Number(i.taxable).toFixed(2)}</td>
    ${intra ? `<td class="n">${(i.gst_rate / 2).toFixed(1)}% ${Number(i.cgst).toFixed(2)}</td><td class="n">${(i.gst_rate / 2).toFixed(1)}% ${Number(i.sgst).toFixed(2)}</td>`
    : `<td class="n">${Number(i.gst_rate).toFixed(1)}% ${Number(i.igst).toFixed(2)}</td>`}
    <td class="n">${Number(i.line_total).toFixed(2)}</td></tr>`).join('');
  const b = inv.buyer.bill;
  const s = inv.buyer.ship;
  const cns = inv.credit_notes || [];
  return `<div class="row"><div><h1>Tax invoice</h1><b>${esc(inv.seller_name)}</b><br>${esc(inv.seller_address)}<br>
    GSTIN: ${esc(inv.is_demo ? 'to be confirmed' : inv.seller_gstin)} &middot; State: ${esc(inv.seller_state)} (${esc(inv.seller_state_code)})${inv.cin ? ` &middot; CIN: ${esc(inv.cin)}` : ''}<br>${esc(inv.phone)} &middot; ${esc(inv.email)}</div>
    <div><b>Invoice ${esc(inv.invoice_no)}</b><br>Date: ${istDay(inv.issued_at)}<br>Order: ${esc(inv.order_no)}<br>Due on: ${day(inv.due_on)}<br>
    Place of supply: ${esc(inv.pos_state)} (${esc(inv.place_of_supply)})<br>${intra ? 'CGST + SGST (same state)' : 'IGST (inter-state)'}</div></div>
    ${inv.status === 'cancelled' ? `<div class="cancelled">CANCELLED ${inv.cancel_reason ? `- ${esc(inv.cancel_reason)}` : ''}</div>` : ''}
    <div class="row"><div><b>Bill to</b><br>${addrLines(b, `${inv.bill_state} (${b.state_code})`).map(esc).join('<br>')}</div>
    <div><b>Ship to</b><br>${addrLines(s, `${inv.ship_state} (${s.state_code})`).map(esc).join('<br>')}</div></div>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Taxable</th>${intra ? '<th class="n">CGST</th><th class="n">SGST</th>' : '<th class="n">IGST</th>'}<th class="n">Amount</th></tr></thead>
    <tbody>${lines}${Number(inv.delivery_charge) > 0 ? `<tr><td></td><td>Delivery charge</td><td>SAC 9965</td><td class="n"></td><td class="n"></td><td class="n">${Number(inv.delivery_charge).toFixed(2)}</td>
      ${intra ? `<td class="n">${(Number(inv.delivery_gst) / 2).toFixed(2)}</td><td class="n">${(Number(inv.delivery_gst) / 2).toFixed(2)}</td>` : `<td class="n">${Number(inv.delivery_gst).toFixed(2)}</td>`}
      <td class="n">${(Number(inv.delivery_charge) + Number(inv.delivery_gst)).toFixed(2)}</td></tr>` : ''}</tbody></table>
    <table class="tot"><tbody>
    <tr><td>Goods</td><td class="n">${Number(inv.subtotal).toFixed(2)}</td></tr>
    ${Number(inv.offer_discount) > 0 ? `<tr><td>Offers</td><td class="n">- ${Number(inv.offer_discount).toFixed(2)}</td></tr>` : ''}
    ${Number(inv.discount) > 0 ? `<tr><td>Coupon${inv.coupon_code ? ` ${esc(inv.coupon_code)}` : ''}</td><td class="n">- ${Number(inv.discount).toFixed(2)}</td></tr>` : ''}
    ${Number(inv.manual_discount) > 0 ? `<tr><td>Discount${inv.manual_discount_reason ? ` (${esc(inv.manual_discount_reason)})` : ''}</td><td class="n">- ${Number(inv.manual_discount).toFixed(2)}</td></tr>` : ''}
    ${Number(inv.wallet_discount) > 0 ? `<tr><td>Wallet cashback as a discount<br><small>Rs ${Number(inv.wallet_discount).toFixed(2)} incl. GST from the wallet: the taxable value is lowered (GST setting)</small></td><td class="n">- ${inv.lines.reduce((a, l) => a + Number(l.wallet_discount || 0), 0).toFixed(2)}</td></tr>` : ''}
    ${Number(inv.delivery_charge) > 0 ? `<tr><td>Delivery charge</td><td class="n">${Number(inv.delivery_charge).toFixed(2)}</td></tr>` : ''}
    ${Number(inv.delivery_waived) > 0 ? `<tr><td>Delivery charge ${Number(inv.delivery_waived).toFixed(2)} waived${inv.coupon_code ? ` (${esc(inv.coupon_code)})` : ''}</td><td class="n">0.00</td></tr>` : ''}
    <tr><td>Taxable value</td><td class="n">${Number(inv.taxable).toFixed(2)}</td></tr>
    ${intra ? `<tr><td>CGST</td><td class="n">${Number(inv.cgst).toFixed(2)}</td></tr><tr><td>SGST</td><td class="n">${Number(inv.sgst).toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="n">${Number(inv.igst).toFixed(2)}</td></tr>`}
    ${Number(inv.round_off) ? `<tr><td>Total before round off</td><td class="n">${(Number(inv.total) - Number(inv.round_off)).toFixed(2)}</td></tr><tr><td>Round off</td><td class="n">${signed(inv.round_off)}</td></tr>` : ''}
    <tr class="grand"><td>Invoice total</td><td class="n">Rs ${Number(inv.total).toFixed(2)}</td></tr>
    ${Number(inv.wallet_used) - Number(inv.wallet_discount) > 0.005 ? `<tr><td>Paid from wallet (a payment, taxable value unchanged)</td><td class="n">- ${(Number(inv.wallet_used) - Number(inv.wallet_discount)).toFixed(2)}</td></tr>
      <tr class="grand"><td>To pay</td><td class="n">Rs ${(Number(inv.total) - (Number(inv.wallet_used) - Number(inv.wallet_discount))).toFixed(2)}</td></tr>` : ''}
    </tbody></table>
    ${cns.length ? `<p><b>Credit notes against this invoice:</b> ${cns.map((c) => `${esc(c.credit_note_no)} (${istDay(c.issued_at)}, Rs ${Number(c.total).toFixed(2)}${c.reason ? ` - ${esc(c.reason)}` : ''})`).join('; ')}</p>` : ''}
    <p><small>Marketed by dFresh. Prices per pack before GST. This is a computer-generated invoice.</small></p>`;
}

/** cn = GET /commerce/credit-notes/:id (the invoice snapshot plus the credit note's own lines) */
export function creditNoteHtml(cn) {
  const intra = cn.gst_type === 'intra';
  const lines = (cn.lines || []).map((l, n) => `<tr><td>${n + 1}</td><td>${esc(l.name)}<br><small>${esc(l.sku_code)} - ${esc(l.size_label)}</small></td><td>${esc(l.hsn)}</td>
    <td class="n">${l.qty}</td><td class="n">${Number(l.taxable).toFixed(2)}</td>
    ${intra ? `<td class="n">${(l.gst_rate / 2).toFixed(1)}% ${Number(l.cgst).toFixed(2)}</td><td class="n">${(l.gst_rate / 2).toFixed(1)}% ${Number(l.sgst).toFixed(2)}</td>`
    : `<td class="n">${Number(l.gst_rate).toFixed(1)}% ${Number(l.igst).toFixed(2)}</td>`}
    <td class="n">${Number(l.line_total).toFixed(2)}</td></tr>`).join('');
  return `<div class="row"><div><h1>Credit note</h1><b>${esc(cn.seller_name)}</b><br>${esc(cn.seller_address)}<br>
    GSTIN: ${esc(cn.is_demo ? 'to be confirmed' : cn.seller_gstin)} &middot; State: ${esc(cn.seller_state)} (${esc(cn.seller_state_code)})</div>
    <div><b>Credit note ${esc(cn.credit_note_no)}</b><br>Date: ${istDay(cn.issued_at)}<br>Against invoice <b>${esc(cn.invoice_no)}</b> of ${istDay(cn.invoice_date)}<br>Order: ${esc(cn.order_no)}${cn.return_no ? `<br>Return: ${esc(cn.return_no)}` : ''}<br>
    Place of supply: ${esc(cn.pos_state)} (${esc(cn.place_of_supply)})<br>${intra ? 'CGST + SGST (as invoiced)' : 'IGST (as invoiced)'}</div></div>
    <div class="row"><div><b>To</b><br>${addrLines(cn.buyer.bill, `${cn.bill_state} (${cn.buyer.bill.state_code})`).map(esc).join('<br>')}</div><div>Reason: ${esc(cn.reason)}</div></div>
    ${lines ? `<table><thead><tr><th>#</th><th>Item returned</th><th>HSN</th><th class="n">Qty</th><th class="n">Taxable</th>${intra ? '<th class="n">CGST</th><th class="n">SGST</th>' : '<th class="n">IGST</th>'}<th class="n">Amount</th></tr></thead><tbody>${lines}</tbody></table>` : ''}
    <table class="tot"><tbody><tr><td>Taxable value</td><td class="n">${Number(cn.taxable).toFixed(2)}</td></tr>
    ${intra ? `<tr><td>CGST</td><td class="n">${Number(cn.cgst).toFixed(2)}</td></tr><tr><td>SGST</td><td class="n">${Number(cn.sgst).toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="n">${Number(cn.igst).toFixed(2)}</td></tr>`}
    ${Number(cn.round_off) ? `<tr><td>Total before round off</td><td class="n">${(Number(cn.total) - Number(cn.round_off)).toFixed(2)}</td></tr><tr><td>Round off</td><td class="n">${signed(cn.round_off)}</td></tr>` : ''}
    <tr class="grand"><td>Credit total</td><td class="n">Rs ${Number(cn.total).toFixed(2)}</td></tr></tbody></table>
    <p><small>Marketed by dFresh. This is a computer-generated credit note.</small></p>`;
}

/** fetch and print: an invoice (id) -> false when pop-ups are blocked */
export async function printInvoice(id) {
  const inv = await api.get(`/commerce/invoices/${id}`);
  return printDoc(`Invoice ${inv.invoice_no}`, invoiceHtml(inv), inv.is_demo);
}
export async function printCreditNote(id) {
  const cn = await api.get(`/commerce/credit-notes/${id}`);
  return printDoc(`Credit note ${cn.credit_note_no}`, creditNoteHtml(cn), cn.is_demo);
}
