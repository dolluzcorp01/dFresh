// Commerce > Orders (docs/COMMERCE-SPEC.md 5.1, 5.2, 6; API /commerce/orders, logic in src/backend_routes/commerce.js).
// List: status chips (with Overdue), payment status, customer type, date range, search by DFO / invoice / customer /
// phone, Excel export (edit on Orders). Order drawer: status steps, addresses with the GST type (CGST + SGST in the
// seller's state, IGST elsewhere), lines with their tax, totals, payments (record a payment or a refund, receipts
// list, balance due), invoices and credit notes (print / save as PDF; DEMO watermark while the seller GSTIN is a
// placeholder), approvals, history. Edit: New / Waiting for approval freely, Packed with a reason (stock re-reserved),
// never after dispatch. Cancel always asks for a reason; after dispatch it waits for approval.
// New / Edit order: customer (price list, credit, overdue), payment terms, billing and shipping address, lines with
// the available stock per SKU (an override above it waits for approval), prices from the list, coupon, wallet.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLoad } from './ui';
import { ReturnForm, ReturnsTable } from './CommerceReturns';
import { NewCustomerDrawer } from './CommerceCustomers';
import { PriceBasis } from './Prices';
import { GST_STATES, stateName } from '../shared/gstStates';

const FLOW = ['new', 'packed', 'dispatched', 'delivered'];
const STATUSES = ['approval', ...FLOW, 'cancelled'];
const LABEL = { approval: 'Waiting for approval', new: 'New', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const PAY = { unpaid: 'Unpaid', partly_paid: 'Part paid', paid: 'Paid', refunded: 'Refunded' };
const NEXT_BTN = { new: 'Mark packed', packed: 'Dispatch (stock out, invoice)', dispatched: 'Mark delivered' };
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const round2 = (n) => Math.round(n * 100) / 100;
const addrLines = (a, state) => [a.name, a.address, [a.town, a.pincode].filter(Boolean).join(' '), state, a.gstin ? `GSTIN ${a.gstin}` : null, a.phone].filter(Boolean);

// ---------------------------------------------------------------- printing (new window; print or save as PDF)
function printDoc(title, body, demo) {
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

function invoiceHtml(inv) {
  const intra = inv.gst_type === 'intra';
  const lines = inv.lines.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}<br><small>${esc(i.sku_code)} - ${esc(i.size_label)}</small></td><td>${esc(i.hsn)}</td>
    <td class="n">${i.qty}</td><td class="n">${Number(i.price).toFixed(2)}</td><td class="n">${Number(i.taxable).toFixed(2)}</td>
    ${intra ? `<td class="n">${(i.gst_rate / 2).toFixed(1)}% ${Number(i.cgst).toFixed(2)}</td><td class="n">${(i.gst_rate / 2).toFixed(1)}% ${Number(i.sgst).toFixed(2)}</td>`
    : `<td class="n">${Number(i.gst_rate).toFixed(1)}% ${Number(i.igst).toFixed(2)}</td>`}
    <td class="n">${Number(i.line_total).toFixed(2)}</td></tr>`).join('');
  const b = inv.buyer.bill;
  const s = inv.buyer.ship;
  return `<div class="row"><div><h1>Tax invoice</h1><b>${esc(inv.seller_name)}</b><br>${esc(inv.seller_address)}<br>
    GSTIN: ${esc(inv.is_demo ? 'to be confirmed' : inv.seller_gstin)} &middot; State: ${esc(inv.seller_state)} (${esc(inv.seller_state_code)})${inv.cin ? ` &middot; CIN: ${esc(inv.cin)}` : ''}<br>${esc(inv.phone)} &middot; ${esc(inv.email)}</div>
    <div><b>Invoice ${esc(inv.invoice_no)}</b><br>Date: ${day(new Date(inv.issued_at).toISOString())}<br>Order: ${esc(inv.order_no)}<br>Due on: ${day(inv.due_on)}<br>
    Place of supply: ${esc(inv.pos_state)} (${esc(inv.place_of_supply)})<br>${intra ? 'CGST + SGST (same state)' : 'IGST (inter-state)'}</div></div>
    ${inv.status === 'cancelled' ? `<div class="cancelled">CANCELLED ${inv.cancel_reason ? `- ${esc(inv.cancel_reason)}` : ''}</div>` : ''}
    <div class="row"><div><b>Bill to</b><br>${addrLines(b, `${inv.bill_state} (${b.state_code})`).map(esc).join('<br>')}</div>
    <div><b>Ship to</b><br>${addrLines(s, `${inv.ship_state} (${s.state_code})`).map(esc).join('<br>')}</div></div>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Taxable</th>${intra ? '<th class="n">CGST</th><th class="n">SGST</th>' : '<th class="n">IGST</th>'}<th class="n">Amount</th></tr></thead>
    <tbody>${lines}</tbody></table>
    <table class="tot"><tbody>
    <tr><td>Subtotal</td><td class="n">${Number(inv.subtotal).toFixed(2)}</td></tr>
    ${Number(inv.discount) > 0 ? `<tr><td>Discount${inv.coupon_code ? ` (${esc(inv.coupon_code)})` : ''}</td><td class="n">- ${Number(inv.discount).toFixed(2)}</td></tr>` : ''}
    <tr><td>Taxable value</td><td class="n">${Number(inv.taxable).toFixed(2)}</td></tr>
    ${intra ? `<tr><td>CGST</td><td class="n">${Number(inv.cgst).toFixed(2)}</td></tr><tr><td>SGST</td><td class="n">${Number(inv.sgst).toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="n">${Number(inv.igst).toFixed(2)}</td></tr>`}
    ${Number(inv.round_off) ? `<tr><td>Round off</td><td class="n">${Number(inv.round_off).toFixed(2)}</td></tr>` : ''}
    <tr class="grand"><td>Invoice total</td><td class="n">Rs ${Number(inv.total).toFixed(2)}</td></tr>
    ${Number(inv.wallet_used) > 0 ? `<tr><td>Paid from wallet</td><td class="n">- ${Number(inv.wallet_used).toFixed(2)}</td></tr>` : ''}
    </tbody></table><p><small>Marketed by dFresh. Prices per pack before GST. This is a computer-generated invoice.</small></p>`;
}

function creditNoteHtml(inv, cn) {
  const intra = inv.gst_type === 'intra';
  return `<h1>Credit note ${esc(cn.credit_note_no)}</h1><p>Date: ${day(new Date(cn.issued_at).toISOString())}<br>Against invoice <b>${esc(inv.invoice_no)}</b> (order ${esc(inv.order_no)})<br>Reason: ${esc(cn.reason)}</p>
    <p><b>${esc(inv.seller_name)}</b><br>GSTIN: ${esc(inv.is_demo ? 'to be confirmed' : inv.seller_gstin)}</p>
    <p><b>To</b><br>${addrLines(inv.buyer.bill, inv.bill_state).map(esc).join('<br>')}</p>
    <table class="tot"><tbody><tr><td>Taxable value</td><td class="n">${Number(cn.taxable).toFixed(2)}</td></tr>
    ${intra ? `<tr><td>CGST</td><td class="n">${Number(cn.cgst).toFixed(2)}</td></tr><tr><td>SGST</td><td class="n">${Number(cn.sgst).toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="n">${Number(cn.igst).toFixed(2)}</td></tr>`}
    ${Number(cn.round_off) ? `<tr><td>Round off</td><td class="n">${Number(cn.round_off).toFixed(2)}</td></tr>` : ''}
    <tr class="grand"><td>Credit total</td><td class="n">Rs ${Number(cn.total).toFixed(2)}</td></tr></tbody></table>`;
}

// ---------------------------------------------------------------- list
export default function CommerceOrders() {
  const location = useLocation();
  const urlStatus = new URLSearchParams(location.search).get('status') || '';
  const [f, setF] = useState({ status: STATUSES.includes(urlStatus) ? urlStatus : '', pay: '', overdue: '', type: '', from: '', to: '', q: '' });
  useEffect(() => { if (STATUSES.includes(urlStatus)) setF((x) => ({ ...x, status: urlStatus })); }, [urlStatus]);
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 350); return () => clearTimeout(t); }, [search]);
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const list = useLoad(`/commerce/orders${qs ? `?${qs}` : ''}`);
  const [open, setOpen] = useState(null); // order_no
  const [creating, setCreating] = useState(false);
  const canEdit = useCan('orders', 'edit');
  const canCreate = useCan('orders', 'create');
  const act = useAction();
  const d = list.data;
  // the customer types stay in the filter while the list reloads
  const [types, setTypes] = useState([]);
  useEffect(() => { if (d && d.lists) setTypes(d.lists.filter((l) => l.key !== 'default')); }, [d]);
  const counts = (d && d.counts) || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const exportXlsx = () => act.run(() => api.download(`/commerce/orders/export.xlsx${qs ? `?${qs}` : ''}`, 'dFresh_Orders.xlsx'));

  return (
    <section>
      <h1>Orders</h1>
      <InfoCard title="Orders entered in the admin">
        <ul>
          <li>Phone, WhatsApp and B2B orders. New &gt; Packed &gt; Dispatched (stock out, tax invoice) &gt; Delivered. Prices only in the admin.</li>
          <li>Edit a New order freely, a Packed one with a reason; never after dispatch. Cancel asks for a reason; after dispatch it needs approval.</li>
          <li>Payments are recorded by hand on the order; an unpaid invoice after its due date is <span className="a-overdue">Overdue</span>.</li>
        </ul>
      </InfoCard>
      {act.note}
      <div className="a-toolbar">
        <div className="a-chips" role="group" aria-label="Status">
          <button type="button" className={`a-chip${!f.status && !f.overdue ? ' on' : ''}`} onClick={() => set({ status: '', overdue: '' })}>All {all}</button>
          {STATUSES.filter((s) => FLOW.includes(s) || counts[s]).map((s) => <button key={s} type="button" className={`a-chip${f.status === s ? ' on' : ''}`} onClick={() => set({ status: s, overdue: '' })}>{LABEL[s]} {counts[s] || 0}</button>)}
          <button type="button" className={`a-chip${f.overdue ? ' on' : ''}`} onClick={() => set({ overdue: f.overdue ? '' : '1', status: '' })}>Overdue {(d && d.overdue) || 0}</button>
        </div>
        {canCreate && <button type="button" className="a-btn" onClick={() => setCreating(true)}>New order</button>}
      </div>
      <div className="a-filters">
        <input type="search" placeholder="DFO, invoice, customer or phone" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>Payment <select value={f.pay} onChange={(e) => set({ pay: e.target.value })}><option value="">All</option>{Object.entries(PAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Customer type <select value={f.type} onChange={(e) => set({ type: e.target.value })}><option value="">All</option>{types.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        <label>From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {canEdit && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={exportXlsx}>Excel</button>}
      </div>
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-orders">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th className="a-num">Total</th><th className="a-num">Due</th><th>Invoice</th><th>Received</th></tr></thead>
            <tbody>
              {((d && d.rows) || []).map((o) => (
                <tr key={o.order_no} className="a-rowlink" tabIndex={0} onClick={() => setOpen(o.order_no)} onKeyDown={(e) => e.key === 'Enter' && setOpen(o.order_no)}>
                  <td><code>{o.order_no}</code></td>
                  <td>{o.customer} <small className="a-muted">{o.ctype}, {o.town}{o.gst_type === 'inter' ? ', IGST' : ''}</small></td>
                  <td><span className={`a-ostatus a-ostatus-${o.status}`}>{LABEL[o.status]}</span></td>
                  <td><span className={`a-pay a-pay-${o.payment_status}`}>{PAY[o.payment_status]}</span>{o.overdue && <span className="a-overdue">Overdue</span>}</td>
                  <td className="a-num">{rs(o.total)}</td>
                  <td className="a-num">{o.status !== 'cancelled' && o.amount_due > 0 ? rs(o.amount_due) : o.amount_due < 0 ? <span className="a-bad">refund {rs(-o.amount_due)}</span> : ''}</td>
                  <td>{o.invoice_no || ''}{o.due_on && <small className="a-muted a-person-sub">due {day(o.due_on)}</small>}</td>
                  <td>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d && !d.rows.length && <p className="a-muted">No order matches.</p>}
        </div>
      </Loading>
      {open && <OrderDrawer no={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {creating && <OrderForm onClose={() => setCreating(false)} onSaved={(no) => { setCreating(false); list.reload(); setOpen(no); }} />}
    </section>
  );
}

// ---------------------------------------------------------------- order drawer
function OrderDrawer({ no, canEdit, onClose, onChanged }) {
  const o = useLoad(`/commerce/orders/${no}`);
  const canReturn = useCan('returns', 'create');
  const rets = useLoad(`/commerce/returns?order=${no}`);
  const [panel, setPanel] = useState(null); // 'return' | 'cancel' | 'edit'
  const act = useAction();
  const confirm = useConfirm();
  const d = o.data;
  const next = d && FLOW.includes(d.status) ? FLOW[FLOW.indexOf(d.status) + 1] : null;
  const reload = () => { o.reload(); onChanged(); };
  const advance = async () => {
    if (next === 'dispatched' && !(await confirm({
      title: `Dispatch ${no}?`, message: `Takes ${d.items.reduce((a, i) => a + i.qty, 0)} packs out of the Kanchipuram godown (${d.items.map((i) => `${i.qty} x ${i.sku_code}`).join(', ')}) and issues the tax invoice.`,
      action: 'Dispatch',
    }))) return;
    act.run(async () => {
      const r = await api.send('POST', `/commerce/orders/${no}/status`, { to: next });
      reload();
      act.setMsg({ kind: 'ok', text: `${no} is now ${LABEL[r.status]}${r.invoice_no ? `: invoice ${r.invoice_no} issued` : ''}.` });
    });
  };
  const printInvoice = (id, cn) => act.run(async () => {
    const inv = await api.get(`/commerce/invoices/${id}`);
    const ok = cn ? printDoc(`Credit note ${cn}`, creditNoteHtml(inv, inv.credit_notes.find((c) => c.credit_note_no === cn)), inv.is_demo)
      : printDoc(`Invoice ${inv.invoice_no}`, invoiceHtml(inv), inv.is_demo);
    if (!ok) act.setMsg({ kind: 'error', text: 'Allow pop-ups to open the invoice.' });
  });
  const live = d && d.invoices.find((i) => i.status === 'issued');
  const pendingCancel = d && d.approvals.find((a) => a.kind === 'cancel_after_dispatch' && a.status === 'pending');
  if (panel === 'edit' && d) return <OrderForm order={d} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); reload(); act.setMsg({ kind: 'ok', text: `${no} saved.` }); }} />;
  return (
    <Drawer title={`Order ${no}`} onClose={onClose}
      footer={d ? (
        <>
          {canEdit && d.editable && <button type="button" className="a-btn a-btn-ghost" onClick={() => setPanel('edit')}>Edit{d.editable === 'reason' ? ' (with reason)' : ''}</button>}
          {canEdit && next && <button type="button" className="a-btn" disabled={act.busy} onClick={advance}>{NEXT_BTN[d.status]}</button>}
          {live && <button type="button" className="a-btn a-btn-ghost" onClick={() => printInvoice(live.invoice_id)}>Invoice {live.invoice_no}</button>}
          {canReturn && d.status === 'delivered' && <button type="button" className="a-btn a-btn-ghost" onClick={() => setPanel('return')}>Return items</button>}
          {canEdit && !['cancelled', 'delivered'].includes(d.status) && !pendingCancel && <button type="button" className="a-btn a-btn-danger" onClick={() => setPanel('cancel')}>Cancel order</button>}
        </>
      ) : null}>
      <Loading state={o}>
        {d && (
          <>
            {act.note}
            {d.status === 'approval' && <Notice kind="warn">Waiting for approval ({d.approvals.filter((a) => a.status === 'pending').map((a) => a.kind_label).join(', ')}). It cannot be packed until someone else approves (Setup &gt; Approvals).</Notice>}
            {d.status === 'packed' && d.approvals.some((a) => a.status === 'pending' && a.kind !== 'cancel_after_dispatch') && <Notice kind="warn">An edit waits for approval: it cannot be dispatched until then.</Notice>}
            {pendingCancel && <Notice kind="warn">Cancelling waits for approval (request #{pendingCancel.approval_id}): {pendingCancel.summary}</Notice>}
            {d.status === 'cancelled' && <Notice kind="error">Cancelled: {d.cancel_reason}. Reserved stock released, coupon and wallet use given back{d.invoices.length ? ', invoice cancelled with a credit note' : ''}.</Notice>}
            {panel === 'cancel' && <CancelPanel order={d} onDone={(r) => { setPanel(null); reload(); act.setMsg({ kind: r.pending ? 'info' : 'ok', text: r.pending ? `Cancelling ${no} after dispatch waits for approval (request #${r.approval_id}).` : `${no} cancelled.` }); }} onCancel={() => setPanel(null)} />}
            {d.status !== 'cancelled' && d.status !== 'approval' && (
              <ol className="a-steps">
                {FLOW.map((s) => <li key={s} className={FLOW.indexOf(s) <= FLOW.indexOf(d.status) ? 'done' : ''}>{LABEL[s]}<small>{fmtDate(d[s === 'new' ? 'confirmed_at' : `${s}_at`])}</small></li>)}
              </ol>
            )}
            <dl className="a-dl">
              <div><dt>Customer</dt><dd>{d.customer} ({d.ctype}) - {d.phone}</dd></div>
              <div><dt>Terms</dt><dd>{d.terms_label}{d.payment_terms === 'credit' ? `, ${d.credit_days} days` : ''}</dd></div>
              <div><dt>Price list</dt><dd>{d.price_list_label} (list prices {d.prices_basis})</dd></div>
              {d.note && <div><dt>Note</dt><dd>{d.note}</dd></div>}
            </dl>
            <div className="a-addr">
              <div className="a-card"><h4>Bill to</h4>{addrLines({ name: d.bill_name, address: d.bill_address, town: d.bill_town, pincode: d.bill_pincode, gstin: d.bill_gstin, phone: d.bill_phone }, `${d.bill_state} (${d.bill_state_code})`).map((l) => <div key={l}>{l}</div>)}</div>
              <div className="a-card"><h4>Ship to</h4>{addrLines({ name: d.ship_name, address: d.ship_address, town: d.ship_town, pincode: d.ship_pincode, phone: d.ship_phone }, `${d.ship_state} (${d.ship_state_code})`).map((l) => <div key={l}>{l}</div>)}</div>
            </div>
            <p className="a-gst">GST: {d.gst_label}</p>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>SKU</th><th>Item</th><th className="a-num">Qty</th><th className="a-num">Price</th><th className="a-num">Taxable</th>
                  {d.gst_type === 'intra' ? <><th className="a-num">CGST</th><th className="a-num">SGST</th></> : <th className="a-num">IGST</th>}<th className="a-num">Amount</th></tr></thead>
                <tbody>{d.items.map((i) => (
                  <tr key={i.sku_code}><td><code>{i.sku_code}</code></td><td>{i.name}<small className="a-muted a-person-sub">HSN {i.hsn} · GST {Number(i.gst_rate)}%{i.list_price != null && Number(i.list_price) !== Number(i.price) ? ` · list ${rs(i.list_price)}` : ''}</small></td>
                    <td className="a-num">{i.qty}</td><td className="a-num">{rs(i.price)}</td><td className="a-num">{rs(i.taxable)}</td>
                    {d.gst_type === 'intra' ? <><td className="a-num">{rs(i.cgst)}</td><td className="a-num">{rs(i.sgst)}</td></> : <td className="a-num">{rs(i.igst)}</td>}
                    <td className="a-num">{rs(i.line_total)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <Totals t={{ ...d, coupon: d.coupon_code }} paid={d.amount_paid} due={d.amount_due} cancelled={d.status === 'cancelled'} />
            {d.reserved.length > 0 && <p className="a-muted">Stock reserved: {d.reserved.map((r) => `${r.qty} x ${r.sku_code}`).join(', ')}</p>}
            <Payments order={d} canEdit={canEdit} onChanged={reload} />
            {d.invoices.length > 0 && (
              <>
                <h3>Invoices</h3>
                <table className="a-table"><tbody>{d.invoices.map((i) => (
                  <tr key={i.invoice_id}>
                    <td><b>{i.invoice_no}</b>{i.is_demo && <small className="a-muted"> (DEMO)</small>}<small className="a-muted a-person-sub">issued {fmtDate(i.issued_at)} · due {day(i.due_on)}</small></td>
                    <td>{i.status === 'cancelled' ? <span className="a-status a-status-off">Cancelled</span> : <span className="a-status a-ap-approved">Issued</span>}{i.status === 'issued' && d.overdue && <span className="a-overdue">Overdue</span>}
                      {i.cancel_reason && <small className="a-muted a-person-sub">{i.cancel_reason}</small>}</td>
                    <td className="a-num">{rs(i.total)}</td>
                    <td><button type="button" className="a-link" onClick={() => printInvoice(i.invoice_id)}>Print / PDF</button>
                      {i.credit_note_no && <> · <button type="button" className="a-link" onClick={() => printInvoice(i.invoice_id, i.credit_note_no)}>Credit note {i.credit_note_no}</button></>}</td>
                  </tr>
                ))}</tbody></table>
              </>
            )}
            {d.approvals.length > 0 && (
              <>
                <h3>Approvals</h3>
                <ul className="a-hist">{d.approvals.map((a) => <li key={a.approval_id}>#{a.approval_id} {a.kind_label}: <b>{a.status}</b>{a.decided_by ? ` by ${a.decided_by}` : ''}{a.note ? ` - "${a.note}"` : ''}</li>)}</ul>
              </>
            )}
            {panel === 'return' && (
              <ReturnForm order={d} onCancel={() => setPanel(null)}
                onDone={(r) => { setPanel(null); rets.reload(); onChanged(); act.setMsg({ kind: 'ok', text: `${r.return_no} saved: ${r.outcome === 'wallet' ? `Rs ${r.amount} to the wallet` : r.outcome === 'replacement' ? `replacement order ${r.replacement_no}` : `refund Rs ${r.amount} (demo)`}` }); }} />
            )}
            {rets.data && rets.data.length > 0 && <><h3>Returns</h3><ReturnsTable rows={rets.data} compact /></>}
            <h3>History</h3>
            <ul className="a-hist">{d.history.map((h, n) => (
              <li key={n}>{fmtDate(h.created_at)} · <b>{h.to_status === 'edited' ? 'Edited' : LABEL[h.to_status] || h.to_status}</b>{h.note ? ` - ${h.note}` : ''} <small className="a-muted">({h.emp_id})</small></li>
            ))}</ul>
          </>
        )}
      </Loading>
    </Drawer>
  );
}

function CancelPanel({ order, onDone, onCancel }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const after = order.status === 'dispatched';
  const go = () => act.run(async () => onDone(await api.send('POST', `/commerce/orders/${order.order_no}/cancel`, { reason })));
  return (
    <div className="a-card">
      <h3>Cancel {order.order_no}</h3>
      <p className="a-muted">{after ? (order.cancelNeedsApproval ? 'It is dispatched: cancelling waits for approval. When approved the goods come back to stock and the invoice is cancelled with a credit note.' : 'It is dispatched: the goods come back to stock and the invoice is cancelled with a credit note.')
        : 'Reserved stock is released; coupon use and wallet credit are given back.'}{Number(order.amount_paid) > 0 ? ` ${rs(order.amount_paid)} was paid: record the refund on the order afterwards.` : ''}</p>
      {act.note}
      <label className="a-field"><span>Why is it cancelled? (required)</span><textarea rows={2} maxLength={255} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} /></label>
      <span className="a-row">
        <button type="button" className="a-btn a-btn-danger" disabled={act.busy || !reason.trim()} onClick={go}>{after && order.cancelNeedsApproval ? 'Ask to cancel' : 'Cancel the order'}</button>
        <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={onCancel}>Keep it</button>
      </span>
    </div>
  );
}

function Payments({ order, canEdit, onChanged }) {
  const act = useAction();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const blank = { kind: 'payment', amount: '', mode: Object.keys(order.modes)[0], received_on: today, reference: '', note: '' };
  const [f, setF] = useState(null);
  const refundDue = Number(order.amount_due) < -0.005;
  const canPay = order.status !== 'cancelled' && Number(order.amount_due) > 0.005;
  const save = () => act.run(async () => {
    const r = await api.send('POST', `/commerce/orders/${order.order_no}/payments`, f);
    setF(null); onChanged();
    act.setMsg({ kind: 'ok', text: `${f.kind === 'refund' ? 'Refund' : 'Payment'} of ${rs(f.amount)} recorded: ${PAY[r.status]}${r.due > 0 ? `, ${rs(r.due)} still due` : ''}.` });
  });
  return (
    <>
      <h3>Payments <span className={`a-pay a-pay-${order.payment_status}`}>{order.pay_label}</span>{order.overdue && <span className="a-overdue">Overdue</span>}</h3>
      {act.note}
      {order.payments.length ? (
        <div className="a-scroll">
          <table className="a-table"><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th className="a-num">Amount</th><th>By</th></tr></thead>
            <tbody>{order.payments.map((p) => (
              <tr key={p.payment_id}><td>{day(p.received_on)}</td><td>{order.modeLabels[p.mode] || p.mode}{p.kind === 'refund' ? ' (refund)' : ''}</td><td>{p.reference || ''}{p.note && <small className="a-muted a-person-sub">{p.note}</small>}</td>
                <td className={`a-num${p.kind === 'refund' ? ' a-bad' : ''}`}>{p.kind === 'refund' ? '- ' : ''}{rs(p.amount)}</td><td>{p.emp_id}<small className="a-muted a-person-sub">{fmtDate(p.created_at)}</small></td></tr>
            ))}</tbody></table>
        </div>
      ) : <p className="a-muted">No payment recorded yet.</p>}
      {refundDue && <p className="a-bad">Refund due to the customer: {rs(-order.amount_due)}</p>}
      {canEdit && !f && (canPay || refundDue) && (
        <p><button type="button" className="a-btn a-btn-sm" onClick={() => setF({ ...blank, kind: canPay ? 'payment' : 'refund', amount: String(Math.abs(Number(order.amount_due)).toFixed(2)) })}>{canPay ? 'Record a payment' : 'Record the refund'}</button></p>
      )}
      {f && (
        <div className="a-card">
          <div className="a-grid2">
            <label className="a-field"><span>{f.kind === 'refund' ? 'Refund' : 'Amount received'} (Rs)</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
            <label className="a-field"><span>Mode</span><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{Object.entries(order.modes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="a-field"><span>Date</span><input type="date" max={today} value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} /></label>
            <label className="a-field"><span>Reference {f.mode === 'cash' ? '(optional)' : '(UTR / cheque / transaction no.)'}</span><input maxLength={60} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
          </div>
          <label className="a-field"><span>Note</span><input maxLength={255} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <span className="a-row">
            <button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save {f.kind === 'refund' ? 'refund' : 'payment'}</button>
            <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setF(null)}>Cancel</button>
          </span>
        </div>
      )}
    </>
  );
}

function Totals({ t, paid = null, due = null, cancelled = false }) {
  const intra = t.gst_type === 'intra';
  return (
    <dl className="a-dl a-totals">
      <div><dt>Subtotal</dt><dd>{rs(t.subtotal)}</dd></div>
      {Number(t.discount) > 0 && <div><dt>Discount{t.coupon ? ` (${t.coupon})` : ''}</dt><dd>- {rs(t.discount)}</dd></div>}
      <div><dt>Taxable</dt><dd>{rs(t.taxable)}</dd></div>
      {intra ? <><div><dt>CGST</dt><dd>{rs(t.cgst)}</dd></div><div><dt>SGST</dt><dd>{rs(t.sgst)}</dd></div></> : <div><dt>IGST</dt><dd>{rs(t.igst)}</dd></div>}
      {Number(t.round_off) !== 0 && <div><dt>Round off</dt><dd>{rs(t.round_off)}</dd></div>}
      <div className="a-grand"><dt>Total</dt><dd>{rs(t.total)}</dd></div>
      {Number(t.wallet_used) > 0 && <div><dt>Paid from wallet</dt><dd>- {rs(t.wallet_used)}</dd></div>}
      {paid !== null && Number(paid) !== 0 && <div><dt>Paid</dt><dd>- {rs(paid)}</dd></div>}
      {due !== null && !cancelled && <div className="a-grand"><dt>Balance due</dt><dd>{rs(Math.max(Number(due), 0))}</dd></div>}
    </dl>
  );
}

// ---------------------------------------------------------------- new / edit order
// the list price of a SKU for a price list: its own price, else Default (pricing.resolve on the server)
const listPrice = (sku, listKey) => {
  if (!sku) return null;
  const own = sku.own || {};
  if (listKey !== 'default' && own[listKey] != null) return Number(own[listKey]);
  return own.default != null ? Number(own.default) : null;
};
// quantity rules (pricing.qtyProblem on the server) for `packs` packs
function qtyProblem(sku, packs) {
  const ppc = Number(sku.packs_per_carton) || 1;
  const min = Number(sku.min_order_qty) || 1;
  if (packs < min) return `Minimum order is ${min} pack${min === 1 ? '' : 's'}${ppc > 1 && min % ppc === 0 ? ` (${min / ppc} carton${min / ppc === 1 ? '' : 's'})` : ''}`;
  if (sku.sell_unit === 'carton' && ppc > 1 && packs % ppc !== 0) return `Sold in full cartons of ${ppc} packs: ${packs} packs is not a whole number of cartons`;
  return null;
}
const unitsOf = (sku) => (!sku ? ['pack'] : sku.sell_unit === 'carton' ? ['carton'] : sku.sell_unit === 'both' && Number(sku.packs_per_carton) > 1 ? ['pack', 'carton'] : ['pack']);
const blankLine = () => ({ sku_code: '', qty: 1, unit: 'pack', price: '', auto: true });
// the same tax rules as commerce.js taxTotals(), for the live preview (the server recomputes on save)
function previewTax(items, discount, gstType, roundOff) {
  const subtotal = round2(items.reduce((a, i) => a + i.qty * i.price, 0));
  const disc = Math.min(discount, subtotal);
  const share = subtotal ? (subtotal - disc) / subtotal : 0;
  let taxable = 0; let cgst = 0; let igst = 0;
  for (const i of items) {
    const tx = round2(i.qty * i.price * share);
    taxable += tx;
    if (gstType === 'intra') cgst += round2((tx * i.gst_rate) / 200); else igst += round2((tx * i.gst_rate) / 100);
  }
  const before = round2(taxable + 2 * cgst + igst);
  const ro = roundOff ? round2(Math.round(before) - before) : 0;
  return { subtotal, discount: disc, taxable: round2(taxable), cgst: round2(cgst), sgst: round2(cgst), igst: round2(igst), round_off: ro, total: round2(before + ro), gst_type: gstType };
}
const fromOrder = (o, which) => (which === 'bill'
  ? { name: o.bill_name, gstin: o.bill_gstin || '', address: o.bill_address || '', town: o.bill_town || '', state_code: o.bill_state_code, pincode: o.bill_pincode || '', phone: o.bill_phone || '' }
  : { name: o.ship_name, address: o.ship_address || '', town: o.ship_town || '', state_code: o.ship_state_code, pincode: o.ship_pincode || '', phone: o.ship_phone || '' });
const fromCustomer = (c) => ({ name: c.business_name || c.name, gstin: c.gstin || '', address: c.address || '', town: c.town || '', state_code: c.state_code || '33', pincode: c.pincode || '', phone: c.phone || '' });

/** New order (no `order`) or Edit order (`order` = the order's detail). */
function OrderForm({ order = null, onClose, onSaved }) {
  const editing = Boolean(order);
  const form = useLoad(`/commerce/order-form${editing ? `?order=${order.order_no}` : ''}`);
  const act = useAction();
  const [customerId, setCustomerId] = useState(editing ? String(order.customer_id) : '');
  const [terms, setTerms] = useState(editing ? order.payment_terms : 'cod');
  const [lines, setLines] = useState(() => (editing ? order.items.map((i) => ({ sku_code: i.sku_code, qty: i.qty, unit: 'pack', price: Number(i.list_price) === Number(i.price) ? '' : String(Number(i.price)), auto: Number(i.list_price) === Number(i.price) })) : [blankLine()]));
  const [bill, setBill] = useState(editing ? fromOrder(order, 'bill') : null);
  const [ship, setShip] = useState(editing ? fromOrder(order, 'ship') : null);
  const [sameShip, setSameShip] = useState(!editing);
  const [coupon, setCoupon] = useState(editing ? order.coupon_code || '' : '');
  const [couponState, setCouponState] = useState(editing && order.coupon_code ? { discount: Number(order.discount) } : null);
  const [wallet, setWallet] = useState(editing && Number(order.wallet_used) ? String(Number(order.wallet_used)) : '');
  const [note, setNote] = useState(editing ? order.note || '' : '');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const f = form.data;
  const pickCustomer = (id) => { setAddingCustomer(false); form.reload(); setCustomerId(String(id)); setWallet(''); };
  const skuMap = useMemo(() => new Map(((f && f.skus) || []).map((s) => [s.sku_code, s])), [f]);
  const customer = f && f.customers.find((c) => String(c.customer_id) === String(customerId));
  // a new order takes the customer's address (both); the form keeps what was typed afterwards
  useEffect(() => { if (!editing && customer) { setBill(fromCustomer(customer)); setShip(fromCustomer(customer)); setSameShip(true); } }, [customerId, Boolean(customer)]); // eslint-disable-line react-hooks/exhaustive-deps
  const listKey = customer ? customer.list_key : 'default';
  const list = f ? f.lists.find((l) => l.key === listKey) || { key: 'default', label: 'Default' } : null;
  const inclusive = Boolean(f && f.basis.inclusive);
  const shipTo = sameShip ? bill : ship;
  const gstType = shipTo && f && shipTo.state_code === f.sellerState ? 'intra' : 'inter';
  const rows = lines.map((l) => {
    const sku = skuMap.get(l.sku_code.trim().toUpperCase());
    const packs = (Number(l.qty) || 0) * (sku && l.unit === 'carton' ? Number(sku.packs_per_carton) || 1 : 1);
    const lp = listPrice(sku, listKey);
    const price = l.price === '' ? lp : Number(l.price);
    const below = lp && price !== null && price < lp ? Math.round(((lp - price) / lp) * 10000) / 100 : 0;
    const qtyBad = !sku ? null : !Number.isInteger(Number(l.qty)) || Number(l.qty) < 1 ? 'Quantity: a whole number from 1' : qtyProblem(sku, packs);
    const short = Boolean(sku && packs > sku.available);
    return { l, sku, packs, lp, price, below, problem: qtyBad, short, needsApproval: Boolean(f && f.approval.on && below > f.approval.pct) };
  });
  const items = rows.filter((r) => r.sku).map((r) => ({ sku_code: r.sku.sku_code, qty: r.packs, gst_rate: r.sku.gst_rate,
    price: r.price === null ? 0 : inclusive ? round2(r.price / (1 + r.sku.gst_rate / 100)) : r.price }));
  const anyShort = rows.some((r) => r.short);
  const blocked = rows.some((r) => r.problem || (r.sku && r.price === null)) || (anyShort && !override) || !bill || !bill.name || (editing && order.editable === 'reason' && !reason.trim());
  const discount = couponState && couponState.discount ? couponState.discount : 0;
  const t = previewTax(items, discount, gstType, Boolean(f && f.roundOff));
  const maxWallet = customer ? customer.wallet + (editing ? Number(order.wallet_used) : 0) : 0;
  const walletUse = Math.min(Number(wallet) || 0, maxWallet, t.total);
  const thisDue = round2(t.total - walletUse);
  const creditOver = Boolean(customer && !editing && terms === 'credit' && customer.outstanding + thisDue > customer.credit_limit + 0.005);
  const overdueHold = Boolean(customer && !editing && customer.overdue > 0);
  const held = rows.some((r) => r.needsApproval) || Boolean(anyShort && override && f && f.approval.stock) || Boolean(f && f.approval.credit && (creditOver || overdueHold));
  const dirty = Boolean(customerId || lines.some((l) => l.sku_code));

  // a typed price stays; an empty one shows (and sends) the list price of the customer's type
  const setLine = (n, patch) => setLines((ls) => ls.map((l, i) => {
    if (i !== n) return l;
    const nl = { ...l, ...patch };
    if ('price' in patch) nl.auto = patch.price === '';
    if ('sku_code' in patch) {
      const sku = skuMap.get(String(nl.sku_code).trim().toUpperCase());
      const units = unitsOf(sku);
      if (!units.includes(nl.unit)) nl.unit = units[0];
      if (sku && nl.unit === 'pack' && Number(nl.qty) < Number(sku.min_order_qty)) nl.qty = Number(sku.min_order_qty);
    }
    return nl;
  }));
  const checkCoupon = () => act.run(async () => {
    setCouponState(null);
    if (!coupon.trim()) return;
    try {
      const r = await api.send('POST', '/commerce/coupon-check', { code: coupon, subtotal: t.subtotal });
      setCouponState({ discount: r.discount });
    } catch (e) { setCouponState({ error: e.message }); }
  });
  const save = () => act.run(async () => {
    const body = {
      payment_terms: terms, note, coupon_code: couponState && couponState.discount ? coupon.trim().toUpperCase() : null, wallet_use: walletUse,
      items: rows.filter((r) => r.l.sku_code).map((r) => ({ sku_code: r.l.sku_code.trim().toUpperCase(), qty: r.packs, price: r.l.auto ? '' : r.l.price })),
      bill, ship: sameShip ? { ...bill } : ship, override_stock: override,
    };
    const r = editing
      ? await api.send('PUT', `/commerce/orders/${order.order_no}`, { ...body, version: order.version, reason })
      : await api.send('POST', '/commerce/orders', { ...body, customer_id: customerId });
    onSaved(r.order_no);
  });
  const addr = (a, setA, which) => a && (
    <div className="a-card">
      <h4>{which === 'bill' ? 'Bill to' : 'Ship to'}</h4>
      <div className="a-grid2">
        <label className="a-field"><span>Name</span><input value={a.name} maxLength={150} aria-label={`${which} name`} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
        {which === 'bill' && <label className="a-field"><span>GSTIN</span><input value={a.gstin} placeholder="33ABCDE1234F1Z5" aria-label="bill GSTIN" onChange={(e) => setA({ ...a, gstin: e.target.value })} /></label>}
        <label className="a-field"><span>Address</span><input value={a.address} maxLength={255} aria-label={`${which} address`} onChange={(e) => setA({ ...a, address: e.target.value })} /></label>
        <label className="a-field"><span>Town</span><input value={a.town} maxLength={80} aria-label={`${which} town`} onChange={(e) => setA({ ...a, town: e.target.value })} /></label>
        <label className="a-field"><span>State</span><select value={a.state_code} aria-label={`${which} state`} onChange={(e) => setA({ ...a, state_code: e.target.value })}>{GST_STATES.map(([c, nm]) => <option key={c} value={c}>{nm} ({c})</option>)}</select></label>
        <label className="a-field"><span>PIN code</span><input value={a.pincode} inputMode="numeric" maxLength={6} aria-label={`${which} PIN`} onChange={(e) => setA({ ...a, pincode: e.target.value })} /></label>
        <label className="a-field"><span>Phone</span><input value={a.phone} aria-label={`${which} phone`} onChange={(e) => setA({ ...a, phone: e.target.value })} /></label>
      </div>
    </div>
  );

  return (
    <Drawer title={editing ? `Edit ${order.order_no}` : 'New order'} onClose={onClose} dirty={dirty}
      footer={<>
        <button type="button" className="a-btn" disabled={act.busy || !customerId || !items.length || blocked} onClick={save}>{held ? 'Save - send for approval' : editing ? 'Save changes' : 'Save order'}</button>
        {held && <span className="a-muted">It waits for approval: {[rows.some((r) => r.needsApproval) && 'price below the list', anyShort && override && 'more than available', creditOver && 'over the credit limit', overdueHold && 'overdue invoices'].filter(Boolean).join(', ')}.</span>}
      </>}>
      <Loading state={form}>
        {f && (
          <>
            {act.note}
            <PriceBasis basis={f.basis} />
            {editing && order.editable === 'reason' && (
              <Notice kind="warn">{order.order_no} is packed: changing it needs a reason; the stock is re-reserved and the packer re-packs it.</Notice>
            )}
            {editing ? <p><b>{order.customer}</b> ({order.ctype}) - the customer cannot change; cancel and enter a new order instead.</p> : (
              <label className="a-field"><span>Customer <button type="button" className="a-link a-newcust" onClick={() => setAddingCustomer(true)}>+ New customer</button></span>
                <select value={customerId} aria-label="Customer" onChange={(e) => { setCustomerId(e.target.value); setWallet(''); }}>
                  <option value="">Choose...</option>
                  {f.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name} - {c.ctype}{c.town ? `, ${c.town}` : ''} ({c.phone}){c.overdue ? ' - OVERDUE' : ''}</option>)}
                </select>
              </label>
            )}
            {addingCustomer && <NewCustomerDrawer onClose={() => setAddingCustomer(false)} onSaved={(c) => pickCustomer(c.customer_id)} onOpenExisting={pickCustomer} />}
            {customer && (
              <p className="a-muted a-custline">Price list: <b>{list.label}</b>. Credit: {customer.credit_limit > 0 ? `${customer.credit_days} days, limit ${rs(customer.credit_limit)}` : 'none'}; owes {rs(customer.outstanding)}
                {customer.overdue > 0 && <span className="a-overdue">{customer.overdue} overdue</span>}</p>
            )}
            <div className="a-grid2">
              <label className="a-field"><span>Payment terms</span>
                <select value={terms} aria-label="Payment terms" onChange={(e) => setTerms(e.target.value)}>{Object.entries(f.terms).map(([k, v]) => <option key={k} value={k}>{v}{k === 'credit' && customer ? ` (${customer.credit_days} days)` : ''}</option>)}</select>
              </label>
              <label className="a-field"><span>Note</span><input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. WhatsApp order, deliver before 10 am" /></label>
            </div>
            {creditOver && <Notice kind="warn">Over the credit limit: {rs(customer.outstanding)} open + this order {rs(thisDue)} &gt; {rs(customer.credit_limit)}. It waits for approval.</Notice>}
            {overdueHold && <Notice kind="warn">{customer.name} has {customer.overdue} overdue invoice{customer.overdue === 1 ? '' : 's'}: a new order waits for approval.</Notice>}
            {bill && (
              <>
                <div className="a-addr">{addr(bill, setBill, 'bill')}{!sameShip && addr(ship, setShip, 'ship')}</div>
                <label className="a-inline"><input type="checkbox" checked={sameShip} onChange={(e) => { setSameShip(e.target.checked); if (!e.target.checked) setShip({ ...bill }); }} /> Ship to the billing address</label>
                <p className="a-gst">GST: {gstType === 'intra' ? `CGST + SGST (${stateName(shipTo.state_code)}, the seller's state)` : `IGST (${stateName(shipTo.state_code)} is another state)`}</p>
              </>
            )}
            <h3>Items</h3>
            <datalist id="order-skus">{f.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.name} - {s.size_label}</option>)}</datalist>
            <table className="a-table a-orderlines">
              <thead><tr><th>SKU (scan or type)</th><th className="a-num">Qty</th><th className="a-num">Price / pack ({f.basis.short})</th><th className="a-num">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map(({ l, sku, packs, lp, price, below, problem, short, needsApproval }, n) => {
                  const units = unitsOf(sku);
                  return (
                    <tr key={n} className={problem || needsApproval || short ? 'a-pending' : undefined}>
                      <td><input list="order-skus" value={l.sku_code} aria-label={`SKU ${n + 1}`} onChange={(e) => setLine(n, { sku_code: e.target.value })} />
                        <small className={sku ? 'a-muted' : 'a-bad'}>{l.sku_code ? (sku ? `${sku.name} - ${sku.size_label}` : 'Unknown SKU') : ''}</small>
                        {sku && <small className="a-muted a-ordernote">Carton {sku.packs_per_carton} packs · min {sku.min_order_qty} · {sku.sell_unit === 'carton' ? 'full cartons only' : sku.sell_unit === 'both' ? 'packs or cartons' : 'packs'}</small>}
                        {sku && <small className={`a-avail${short ? ' a-bad' : ' a-muted'}`}>Available {sku.available} (in stock {sku.good}, reserved {sku.reserved})</small>}</td>
                      <td className="a-num">
                        <span className="a-row">
                          <input type="number" min="1" step="1" className="a-qty" value={l.qty} aria-label={`Qty ${n + 1}`} onChange={(e) => setLine(n, { qty: e.target.value })} />
                          {units.length > 1 ? (
                            <select value={l.unit} aria-label={`Unit ${n + 1}`} onChange={(e) => setLine(n, { unit: e.target.value })}><option value="pack">packs</option><option value="carton">cartons</option></select>
                          ) : <span className="a-muted">{units[0] === 'carton' ? 'cartons' : 'packs'}</span>}
                        </span>
                        {sku && l.unit === 'carton' && <small className="a-muted a-ordernote">= {packs} packs</small>}
                        {problem && <small className="a-bad a-ordernote" role="alert">{problem}</small>}
                        {short && <small className="a-bad a-ordernote" role="alert">Only {Math.max(sku.available, 0)} available</small>}
                      </td>
                      <td className="a-num"><input type="number" min="0" step="0.5" className="a-price" value={l.price} placeholder={lp == null ? '' : String(lp)} aria-label={`Price ${n + 1}`} onChange={(e) => setLine(n, { price: e.target.value })} />
                        {sku && (lp == null ? <small className="a-bad a-ordernote" role="alert">No {list.label} or Default price: set it in Products and prices</small>
                          : <small className="a-muted a-ordernote">{list.label} list: {rs(lp)}{l.auto ? ' (used)' : ''}</small>)}
                        {below > 0 && <small className={`a-ordernote ${needsApproval ? 'a-bad' : 'a-muted'}`}>{below}% below the list{needsApproval ? ': needs approval' : ''}</small>}</td>
                      <td className="a-num">{sku && price !== null ? rs(packs * price) : ''}</td>
                      <td>{lines.length > 1 && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== n))} aria-label="Remove line">x</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</button>
            {anyShort && (f.canOverride ? (
              <label className="a-inline a-override"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Order more than available anyway{f.approval.stock ? ' (waits for approval by someone else)' : ''}</label>
            ) : <Notice kind="error">More than the available stock: lower the quantity (only a role with &quot;approve&quot; on Orders can ask for an override).</Notice>)}
            <div className="a-grid2">
              <label className="a-field"><span>Coupon</span>
                <span className="a-row">
                  <input list="order-coupons" value={coupon} onChange={(e) => { setCoupon(e.target.value); setCouponState(null); }} placeholder="e.g. WELCOME10" />
                  <button type="button" className="a-btn a-btn-sm" disabled={!coupon.trim() || !items.length || act.busy} onClick={checkCoupon}>Apply</button>
                </span>
                <datalist id="order-coupons">{f.coupons.filter((c) => Number(c.is_active)).map((c) => <option key={c.code} value={c.code}>{c.kind === 'percent' ? `${Number(c.value)}%` : rs(c.value)} off, min {rs(c.min_order)}</option>)}</datalist>
                {couponState && couponState.error && <small className="a-bad" role="alert">{couponState.error}</small>}
                {couponState && couponState.discount > 0 && <small className="a-ok">{coupon.toUpperCase()}: - {rs(couponState.discount)}</small>}
              </label>
              <label className="a-field"><span>Use wallet {customer ? `(balance ${rs(maxWallet)})` : ''}</span>
                <input type="number" min="0" step="1" value={wallet} disabled={!customer || maxWallet <= 0} onChange={(e) => setWallet(e.target.value)} placeholder={customer && maxWallet > 0 ? 'Amount' : 'No wallet balance'} />
              </label>
            </div>
            {editing && <label className="a-field"><span>Why is it changed?{order.editable === 'reason' ? ' (required)' : ' (optional)'}</span><input value={reason} maxLength={255} aria-label="Reason for the change" onChange={(e) => setReason(e.target.value)} /></label>}
            <Totals t={{ ...t, coupon: discount ? coupon.toUpperCase() : null, wallet_used: walletUse }} />
          </>
        )}
      </Loading>
    </Drawer>
  );
}
