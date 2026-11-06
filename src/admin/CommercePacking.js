// Packing prints (packing slip and carton labels, from GET /commerce/packing/:no/slip; the old pick list print). The
// Packing pages themselves are in Packing.js (phase 20).
import { barcodeSvg, esc, printPage, rs } from './printKit';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const KIND = { own: 'Own vehicle', courier: 'Courier', pickup: 'Customer pickup' };

export function printPickList(data) {
  const rows = data.rows.map((r) => `<tr><td><b>${esc(r.bin_location || '-')}</b></td><td><b>${esc(r.sku_code)}</b><br><small>${esc(r.name)} - ${esc(r.size_label)}</small></td>
    <td>${r.batch_no ? `${esc(r.batch_no)}<br><small>exp. ${day(r.expiry_date)}</small>` : '<span class="muted">-</span>'}</td>
    <td class="n"><b>${r.qty}</b>${r.packs_per_carton > 1 && r.qty >= r.packs_per_carton ? `<br><small>${Math.floor(r.qty / r.packs_per_carton)} carton(s) + ${r.qty % r.packs_per_carton}</small>` : ''}</td>
    <td><small>${r.orders.map(esc).join('<br>')}</small></td><td class="tick"><span class="box"></span></td></tr>`).join('');
  return printPage({
    title: `Pick list ${data.orders.map((o) => o.order_no).join(', ')}`,
    body: `<div class="row"><div><h1>Pick list</h1><div class="muted">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} · Kanchipuram godown</div></div>
      <div>${data.orders.map((o) => `<div><b>${esc(o.order_no)}</b> ${esc(o.customer)}</div>`).join('')}</div></div>
      <p class="muted">Walk by bin. Batch-tracked products: take the batch shown (earliest expiry first).</p>
      <table><thead><tr><th>Bin</th><th>SKU</th><th>Batch</th><th class="n">Packs</th><th>For orders</th><th class="tick">OK</th></tr></thead><tbody>${rows}</tbody></table>`,
  });
}

function slipAddress(s) {
  return [esc(s.ship_name), esc(s.ship_address), esc([s.ship_town, s.ship_pincode].filter(Boolean).join(' ')), esc(s.ship_state), s.ship_phone ? `Phone ${esc(s.ship_phone)}` : ''].filter(Boolean).join('<br>');
}
export function printSlip(s) {
  const lines = s.lines.map((l) => `<tr><td>${esc(l.sku_code)}</td><td>${esc(l.name)} - ${esc(l.size_label)}</td><td>${esc(l.batch_no || '')}${l.expiry_date ? ` <small>exp. ${day(l.expiry_date)}</small>` : ''}</td><td class="n">${l.need}</td></tr>`).join('');
  return printPage({
    title: `Packing slip ${s.order_no}`,
    body: `<div class="row"><div><h1>Packing slip</h1><b>dFresh</b> - Kanchipuram<br>${esc(s.phone)}</div><div>${barcodeSvg(s.order_no)}</div></div>
      <div class="row"><div><h2>Deliver to</h2>${slipAddress(s)}</div>
      <div><h2>Order ${esc(s.order_no)}</h2>${esc(s.customer)}<br>Ordered ${day(s.created_at)}<br>${esc(s.method || KIND[s.delivery_kind])}${s.courier ? `: ${esc(s.courier)}` : ''}${s.awb_no ? ` AWB ${esc(s.awb_no)}` : ''}<br>
      Cartons: <b>${s.cartons || '-'}</b> · Weight: ${s.weight_kg ? `${Number(s.weight_kg)} kg` : '-'}${s.payment_terms === 'cod' && s.amount_due > 0 ? `<br><b>Collect on delivery: ${rs(s.amount_due)}</b>` : ''}</div></div>
      <table><thead><tr><th>SKU</th><th>Item</th><th>Batch</th><th class="n">Packs</th></tr></thead><tbody>${lines}</tbody></table>
      ${s.note ? `<p>Note: ${esc(s.note)}</p>` : ''}<p class="muted">Received in good condition: ______________________ (name, signature)</p>`,
  });
}
export function printCartonLabels(s) {
  const n = Math.max(Number(s.cartons) || 1, 1);
  const labels = Array.from({ length: n }, (_, i) => `<div class="label"><div class="row"><b class="brand">dFresh</b><b class="cx">Carton ${i + 1} of ${n}</b></div>
    <div class="to">${slipAddress(s)}</div>${barcodeSvg(s.order_no, { height: 56, width: 2 })}
    <div class="row"><span>${esc(s.method || KIND[s.delivery_kind])}${s.awb_no ? ` · AWB ${esc(s.awb_no)}` : ''}</span><span>${s.payment_terms === 'cod' && s.amount_due > 0 ? `COD ${rs(s.amount_due)}` : 'Prepaid / credit'}</span></div></div>`).join('');
  return printPage({
    title: `Carton labels ${s.order_no}`, size: '100mm 150mm', margin: '4mm',
    css: '.label { height: 138mm; border: 1px dashed #999; padding: 4mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; } .label:last-child { page-break-after: auto; } .brand { font-size: 20px; } .cx { font-size: 16px; } .to { font-size: 15px; line-height: 1.35; }',
    body: labels,
  });
}
