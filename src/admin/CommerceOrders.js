// Commerce > Orders (docs/COMMERCE-SPEC.md 5.1, 5.2, 6; API /commerce/orders, logic in src/backend_routes/commerce.js).
// Phase 5: packing (Commerce > Packing) and delivery (Commerce > Delivery, My trips) move the order on; the drawer shows
// the delivery method, area and charge, courier AWB with its tracking link, cartons, trips and proof of delivery.
// List: status chips (with Overdue), payment status, customer type, date range, search by DFO / invoice / customer /
// phone, Excel export (edit on Orders). Order drawer: status steps, addresses with the GST type (CGST + SGST in the
// seller's state, IGST elsewhere), lines with their tax, totals, payments (record a payment or a refund, receipts
// list, balance due), invoices and every credit note against them (print / save as PDF, invoicePrint.js; DEMO
// watermark while the seller GSTIN is a placeholder), returns of the order (New return on a delivered order, phase 6),
// approvals, history. Edit: New / Waiting for approval freely, Packed with a reason (stock re-reserved),
// never after dispatch. Cancel always asks for a reason; after dispatch it waits for approval.
// New / Edit order: customer (price list, credit, overdue), payment terms, billing and shipping address, lines with
// the available stock per SKU (an override above it waits for approval), prices from the list. Phase 7: the server
// works the order out as it is typed (/commerce/orders/preview): automatic offers on the lines and free lines, one
// coupon, a manual discount with a reason, the wallet (at most the setting % of the order, cashback as a discount or a
// payment by the GST setting), the totals and what will wait for approval.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLoad } from './ui';
import { NewReturn, ReturnDrawer, ReturnsTable } from './CommerceReturns';
import { addrLines, printCreditNote, printInvoice as printInvoiceDoc, signed } from './invoicePrint';
import { NewCustomerDrawer } from './CommerceCustomers';
import { PriceBasis } from './Prices';
import { NoteStatus } from './Notifications';
import { GST_STATES, placeOfSupply, stateName } from '../shared/gstStates';

const FLOWS = {
  own: ['new', 'packing', 'packed', 'out_for_delivery', 'delivered'], courier: ['new', 'packing', 'packed', 'with_courier', 'delivered'], pickup: ['new', 'packing', 'packed', 'delivered'],
};
const STATUSES = ['approval', 'new', 'packing', 'packed', 'out_for_delivery', 'with_courier', 'failed', 'delivered', 'cancelled'];
const MAIN = ['new', 'packing', 'packed', 'out_for_delivery', 'delivered'];
const GONE = ['out_for_delivery', 'with_courier', 'failed'];
const LABEL = { approval: 'Waiting for approval', new: 'New', packing: 'Packing', packed: 'Packed', out_for_delivery: 'Out for delivery', with_courier: 'Handed to courier', failed: 'Delivery failed', delivered: 'Delivered', cancelled: 'Cancelled' };
const STAMP = { new: 'confirmed_at', packing: 'packing_at', packed: 'packed_at', out_for_delivery: 'out_at', with_courier: 'courier_at', delivered: 'delivered_at' };
const PAY = { unpaid: 'Unpaid', partly_paid: 'Part paid', paid: 'Paid', refunded: 'Refunded', part_refunded: 'Part refunded' };
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const round2 = (n) => Math.round(n * 100) / 100;

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
          <li>Phone, WhatsApp and B2B orders. New &gt; Packing &gt; Packed (Packing) &gt; Out for delivery, Handed to courier or collected (Delivery) &gt; Delivered. The goods leave the godown with the tax invoice.</li>
          <li>Edit a New order freely, a Packing or Packed one with a reason (it is checked again); never once the goods left. Cancel asks for a reason; after the goods left it needs approval.</li>
          <li>Payments are recorded by hand on the order; an unpaid invoice after its due date is <span className="a-overdue">Overdue</span>.</li>
        </ul>
      </InfoCard>
      {act.note}
      <div className="a-toolbar">
        <div className="a-chips" role="group" aria-label="Status">
          <button type="button" className={`a-chip${!f.status && !f.overdue ? ' on' : ''}`} onClick={() => set({ status: '', overdue: '' })}>All {all}</button>
          {STATUSES.filter((s) => MAIN.includes(s) || counts[s]).map((s) => <button key={s} type="button" className={`a-chip${f.status === s ? ' on' : ''}`} onClick={() => set({ status: s, overdue: '' })}>{LABEL[s]} {counts[s] || 0}</button>)}
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
  const [openReturn, setOpenReturn] = useState(null);
  const act = useAction();
  const confirm = useConfirm();
  const d = o.data;
  const canPack = useCan('packing', 'edit');
  const reload = () => { o.reload(); onChanged(); };
  const startPacking = async () => {
    if (!(await confirm({ title: `Start packing ${no}?`, message: 'The SKUs are picked now (batches earliest expiry first); then scan it in Packing.', action: 'Start packing' }))) return;
    act.run(async () => { await api.send('POST', '/commerce/packing/start', { order_nos: [no] }); reload(); }, `${no} is Packing: scan it in Commerce > Packing`);
  };
  const flow = d ? FLOWS[d.delivery_kind] || FLOWS.own : [];
  const printInvoice = (id, cnId) => act.run(async () => {
    if (!(await (cnId ? printCreditNote(cnId) : printInvoiceDoc(id)))) act.setMsg({ kind: 'error', text: 'Allow pop-ups to open the invoice.' });
  });
  const live = d && d.invoices.find((i) => i.status === 'issued');
  const pendingCancel = d && d.approvals.find((a) => a.kind === 'cancel_after_dispatch' && a.status === 'pending');
  if (panel === 'edit' && d) return <OrderForm order={d} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); reload(); act.setMsg({ kind: 'ok', text: `${no} saved.` }); }} />;
  return (
    <Drawer title={`Order ${no}`} onClose={onClose}
      footer={d ? (
        <>
          {canEdit && d.editable && <button type="button" className="a-btn a-btn-ghost" onClick={() => setPanel('edit')}>Edit{d.editable === 'reason' ? ' (with reason)' : ''}</button>}
          {canPack && d.status === 'new' && <button type="button" className="a-btn" disabled={act.busy} onClick={startPacking}>Start packing</button>}
          {d.status === 'packing' && <Link className="a-btn" to="/admin/commerce/packing">Scan in Packing</Link>}
          {live && <button type="button" className="a-btn a-btn-ghost" onClick={() => printInvoice(live.invoice_id)}>Invoice {live.invoice_no}</button>}
          {canReturn && d.status === 'delivered' && <button type="button" className="a-btn a-btn-ghost" onClick={() => setPanel('return')}>New return</button>}
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
                {flow.map((s) => <li key={s} className={flow.indexOf(s) <= flow.indexOf(d.status === 'failed' ? 'packed' : d.status) ? 'done' : ''}>{LABEL[s]}<small>{fmtDate(d[STAMP[s]])}</small></li>)}
              </ol>
            )}
            {d.status === 'failed' && <Notice kind="error">Delivery failed: {d.failed_reason}. Re-attempt or return it to the godown in Commerce &gt; Delivery &gt; Failed.</Notice>}
            <dl className="a-dl">
              <div><dt>Customer</dt><dd>{d.customer} ({d.ctype}) - {d.phone}</dd></div>
              <div><dt>Terms</dt><dd>{d.terms_label}{d.payment_terms === 'credit' ? `, ${d.credit_days} days` : ''}</dd></div>
              <div><dt>Price list</dt><dd>{d.price_list_label} (list prices {d.prices_basis})</dd></div>
              <div><dt>Delivery messages to</dt><dd>{d.contact ? `${d.contact.name}${d.contact.email ? ` <${d.contact.email}>` : ' (no e-mail)'}` : 'The contact with the shipping phone, else the first contact with an e-mail'}</dd></div>
              {d.note && <div><dt>Note</dt><dd>{d.note}</dd></div>}
            </dl>
            <div className="a-addr">
              <div className="a-card"><h4>Bill to</h4>{addrLines({ name: d.bill_name, address: d.bill_address, town: d.bill_town, pincode: d.bill_pincode, gstin: d.bill_gstin, phone: d.bill_phone }, `${d.bill_state} (${d.bill_state_code})`).map((l) => <div key={l}>{l}</div>)}</div>
              <div className="a-card"><h4>Ship to</h4>{addrLines({ name: d.ship_name, address: d.ship_address, town: d.ship_town, pincode: d.ship_pincode, phone: d.ship_phone }, `${d.ship_state} (${d.ship_state_code})`).map((l) => <div key={l}>{l}</div>)}</div>
            </div>
            <p className="a-gst">GST: {d.gst_label}</p>
            <div className="a-card a-deliv">
              <h4>Delivery</h4>
              <div>{d.delivery_method}{d.delivery_area ? ` · ${d.delivery_area}` : ''}{Number(d.delivery_charge) > 0 ? ` · charge ${rs(d.delivery_charge)} + GST ${rs(d.delivery_gst)}` : ' · no delivery charge'}</div>
              {d.cartons && <div>{d.cartons} carton(s), {Number(d.weight_kg)} kg{d.pack_override ? ` · packed with override: ${d.pack_override}` : ''}</div>}
              {d.awb_no && <div>{d.courier} AWB <b>{d.awb_no}</b>{d.tracking_link && <> · <a href={d.tracking_link} target="_blank" rel="noreferrer">Track the parcel</a></>}{d.eway_bill_no ? ` · e-way bill ${d.eway_bill_no}` : ''}</div>}
              {d.trips.map((t) => <div key={t.stop_id}>Trip T-{t.trip_id}{t.kind === 'pickup' ? ' (return pickup)' : ''} ({t.vehicle}, {t.driver}): {t.status.replace('_', ' ')}{t.receiver_name ? `, received by ${t.receiver_name}` : ''}{t.failed_reason ? ` - ${t.failed_reason}` : ''}{t.cash_collected > 0 ? `, cash ${rs(t.cash_collected)}` : ''}{t.done_at ? ` · ${fmtDate(t.done_at)}` : ''}</div>)}
              {d.received_by && !d.trips.some((t) => t.receiver_name) && <div>Received by {d.received_by}</div>}
            </div>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>SKU</th><th>Item</th><th className="a-num">Qty</th><th className="a-num">Price</th><th className="a-num">Taxable</th>
                  {d.gst_type === 'intra' ? <><th className="a-num">CGST</th><th className="a-num">SGST</th></> : <th className="a-num">IGST</th>}<th className="a-num">Amount</th></tr></thead>
                <tbody>{d.items.map((i) => (
                  <tr key={`${i.sku_code}${i.is_free ? '-free' : ''}`} className={i.is_free ? 'a-freeline' : undefined}><td><code>{i.sku_code}</code>{i.is_free && <> <span className="a-status a-ap-approved">Free</span></>}</td>
                    <td>{i.name}<small className="a-muted a-person-sub">HSN {i.hsn} · GST {Number(i.gst_rate)}%{!i.is_free && i.list_price != null && Number(i.list_price) !== Number(i.price) ? ` · list ${rs(i.list_price)}` : ''}</small>
                      {i.offer_label && <small className="a-ok a-person-sub">{i.offer_label}{Number(i.offer_discount) > 0 ? `: - ${rs(i.offer_discount)}` : ''}</small>}
                      {Number(i.coupon_discount) > 0 && <small className="a-muted a-person-sub">coupon / manual share - {rs(i.coupon_discount)}</small>}
                      {Number(i.wallet_discount) > 0 && <small className="a-muted a-person-sub">wallet cashback share - {rs(i.wallet_discount)} (taxable)</small>}</td>
                    <td className="a-num">{i.qty}</td><td className="a-num">{rs(i.price)}</td><td className="a-num">{rs(i.taxable)}</td>
                    {d.gst_type === 'intra' ? <><td className="a-num">{rs(i.cgst)}</td><td className="a-num">{rs(i.sgst)}</td></> : <td className="a-num">{rs(i.igst)}</td>}
                    <td className="a-num">{rs(i.line_total)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <Totals t={{ ...d, coupon: d.coupon_code }} paid={d.amount_paid} due={d.amount_due} cancelled={d.status === 'cancelled'} />
            {Number(d.manual_discount) > 0 && <p className="a-muted">Manual discount: {d.manual_discount_reason}</p>}
            {Number(d.wallet_used) > 0 && <p className="a-muted">Wallet {rs(d.wallet_used)}: {Number(d.wallet_discount) > 0 ? `${rs(d.wallet_discount)} as a discount (cashback / manual credit, GST setting "Discount")` : ''}{Number(d.wallet_discount) > 0 && Number(d.wallet_used) - Number(d.wallet_discount) > 0.005 ? ', ' : ''}{Number(d.wallet_used) - Number(d.wallet_discount) > 0.005 ? `${rs(Number(d.wallet_used) - Number(d.wallet_discount))} as a payment` : ''}.</p>}
            {d.status === 'delivered' && d.cashback && (
              <p className="a-cashback">{d.cashback.amount === null ? `Cashback: worked out on ${day(d.cashback.due_on)}, ${d.cashback.mode === 'delivery' ? 'on delivery' : 'once the return window has passed'}.`
                : d.cashback.amount > 0 ? `Cashback ${rs(d.cashback.amount)} credited to the wallet on ${fmtDate(d.cashback.at)}.` : 'No cashback on this order (no rule for this customer type, or below its minimum).'}</p>
            )}
            {d.walletEntries.length > 0 && <ul className="a-hist">{d.walletEntries.map((w) => <li key={w.entry_id}>{fmtDate(w.created_at)} · wallet {w.amount > 0 ? '+' : '-'} {rs(Math.abs(w.amount))} - {w.reason}</li>)}</ul>}
            {d.reserved.length > 0 && <p className="a-muted">Stock reserved: {d.reserved.map((r) => `${r.qty} x ${r.sku_code}`).join(', ')}</p>}
            {d.batches && d.batches.length > 0 && <p className="a-batchesout">Batches sent (earliest expiry first): {d.batches.map((b) => `${b.qty} x ${b.sku_code} batch ${b.batch_no}, expires ${day(b.expiry_date)}`).join('; ')}</p>}
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
                      {i.credit_notes.map((c) => <small key={c.credit_note_id} className="a-person-sub"><button type="button" className="a-link" onClick={() => printInvoice(i.invoice_id, c.credit_note_id)}>Credit note {c.credit_note_no}</button> {rs(c.total)}{c.return_no ? ` (${c.return_no})` : ''}</small>)}</td>
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
              <NewReturn orderNo={no} onCancel={() => setPanel(null)}
                onDone={(r) => { setPanel(null); rets.reload(); onChanged(); setOpenReturn(r.return_no); }} />
            )}
            {rets.data && rets.data.rows.length > 0 && <><h3>Returns</h3><ReturnsTable rows={rets.data.rows} compact onOpen={setOpenReturn} /></>}
            {openReturn && <ReturnDrawer no={openReturn} onClose={() => { setOpenReturn(null); rets.reload(); reload(); }} />}
            {d.notifications.length > 0 && (
              <>
                <h3>Messages</h3>
                <ul className="a-hist">{d.notifications.map((m) => (
                  <li key={m.log_id}>{fmtDate(m.created_at)} · <b>{m.event_label}</b> to {m.recipient || m.recipient_name || '-'}{m.attachments.length ? ` (${m.attachments.join(', ').replace('_', ' ')} PDF)` : ''} <NoteStatus row={m} />
                    {m.status === 'skipped' && <small className="a-muted"> {m.skip_reason}</small>}{m.status === 'failed' && <small className="a-bad"> {m.last_error}</small>}</li>
                ))}</ul>
              </>
            )}
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
  const after = GONE.includes(order.status);
  const go = () => act.run(async () => onDone(await api.send('POST', `/commerce/orders/${order.order_no}/cancel`, { reason })));
  return (
    <div className="a-card">
      <h3>Cancel {order.order_no}</h3>
      <p className="a-muted">{after ? (order.cancelNeedsApproval ? 'The goods have left the godown: cancelling waits for approval. When approved the goods come back to stock and the invoice is cancelled with a credit note.' : 'The goods have left: they come back to stock and the invoice is cancelled with a credit note.')
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
  const walletPaid = Number(t.wallet_used || 0) - Number(t.wallet_discount || 0);
  return (
    <dl className="a-dl a-totals">
      <div><dt>Goods</dt><dd>{rs(t.subtotal)}</dd></div>
      {Number(t.offer_discount) > 0 && <div><dt>Offers</dt><dd>- {rs(t.offer_discount)}</dd></div>}
      {Number(t.discount) > 0 && <div><dt>Coupon{t.coupon ? ` ${t.coupon}` : ''}</dt><dd>- {rs(t.discount)}</dd></div>}
      {Number(t.manual_discount) > 0 && <div><dt>Manual discount</dt><dd>- {rs(t.manual_discount)}</dd></div>}
      {Number(t.wallet_discount) > 0 && <div><dt>Wallet cashback (discount)</dt><dd>- {rs(t.wallet_discount)}<small className="a-muted a-person-sub">incl. GST: lowers the taxable value</small></dd></div>}
      {Number(t.delivery_charge) > 0 && <div><dt>Delivery charge</dt><dd>{rs(t.delivery_charge)}</dd></div>}
      {Number(t.delivery_waived) > 0 && <div><dt>Delivery charge</dt><dd>{rs(0)}<small className="a-muted a-person-sub">{rs(t.delivery_waived)} waived{t.coupon ? ` (${t.coupon})` : ''}</small></dd></div>}
      <div><dt>Taxable</dt><dd>{rs(t.taxable)}</dd></div>
      {intra ? <><div><dt>CGST</dt><dd>{rs(t.cgst)}</dd></div><div><dt>SGST</dt><dd>{rs(t.sgst)}</dd></div></> : <div><dt>IGST</dt><dd>{rs(t.igst)}</dd></div>}
      {Number(t.round_off) !== 0 && <div><dt>Round off</dt><dd>{signed(t.round_off)}</dd></div>}
      <div className="a-grand"><dt>Total</dt><dd>{rs(t.total)}</dd></div>
      {walletPaid > 0.005 && <div><dt>Paid from wallet</dt><dd>- {rs(walletPaid)}</dd></div>}
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
const fromOrder = (o, which) => (which === 'bill'
  ? { name: o.bill_name, gstin: o.bill_gstin || '', address: o.bill_address || '', town: o.bill_town || '', state_code: o.bill_state_code, pincode: o.bill_pincode || '', phone: o.bill_phone || '' }
  : { name: o.ship_name, address: o.ship_address || '', town: o.ship_town || '', state_code: o.ship_state_code, pincode: o.ship_pincode || '', phone: o.ship_phone || '' });
/** a customer address (phase 8) as the form's address fields */
const fromAddress = (a) => ({ name: a.name, gstin: a.gstin || '', address: a.address || '', town: a.town || '', state_code: a.state_code, pincode: a.pincode || '', phone: a.phone || '' });
const addrLabel = (a) => `${a.label || a.name}${a.gstin ? ` - GSTIN ${a.gstin}` : ''} (${a.town || ''} ${a.state_code})${a.is_default ? ' - default' : ''}`;

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
  const [billId, setBillId] = useState(editing && order.bill_address_id ? String(order.bill_address_id) : '');
  const [shipId, setShipId] = useState(editing && order.ship_address_id ? String(order.ship_address_id) : '');
  const [contactId, setContactId] = useState(editing && order.contact_id ? String(order.contact_id) : ''); // '' = the rule (shipping phone)
  const [coupon, setCoupon] = useState(editing ? order.coupon_code || '' : '');
  const [couponApplied, setCouponApplied] = useState(editing ? order.coupon_code || '' : '');
  const [manual, setManual] = useState(editing && Number(order.manual_discount) ? { amount: String(Number(order.manual_discount)), reason: order.manual_discount_reason || '' } : { amount: '', reason: '' });
  const [wallet, setWallet] = useState(editing && Number(order.wallet_used) ? String(Number(order.wallet_used)) : '');
  const [pv, setPv] = useState(null); // the server's preview: { totals, lines, offers, coupon, wallet, holds, ... } or { error }
  const [note, setNote] = useState(editing ? order.note || '' : '');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [methodId, setMethodId] = useState(editing && order.delivery_method_id ? String(order.delivery_method_id) : '');
  const [areaId, setAreaId] = useState(editing && order.delivery_area_id ? String(order.delivery_area_id) : ''); // '' = from the address
  const [addingCustomer, setAddingCustomer] = useState(false);
  const f = form.data;
  const pickCustomer = (id) => { setAddingCustomer(false); form.reload(); setCustomerId(String(id)); setWallet(''); };
  const skuMap = useMemo(() => new Map(((f && f.skus) || []).map((s) => [s.sku_code, s])), [f]);
  const customer = f && f.customers.find((c) => String(c.customer_id) === String(customerId));
  // a new order takes the customer's address (both); the form keeps what was typed afterwards
  // a new order takes the customer's default billing and shipping address (phase 8: one of each kind, chosen below)
  const billAddrs = customer ? customer.addresses.filter((a) => a.kind === 'billing') : [];
  const shipAddrs = customer ? customer.addresses.filter((a) => a.kind === 'shipping') : [];
  useEffect(() => {
    if (editing || !customer) return;
    const b = billAddrs[0]; const sh = shipAddrs[0];
    setBillId(b ? String(b.address_id) : ''); setShipId(sh ? String(sh.address_id) : '');
    setBill(b ? fromAddress(b) : { name: customer.business_name || customer.name, gstin: '', address: '', town: '', state_code: '33', pincode: '', phone: customer.phone });
    setShip(sh ? fromAddress(sh) : b ? { ...fromAddress(b), gstin: '' } : null);
  }, [customerId, Boolean(customer)]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseAddr = (kind, idv) => {
    const a = customer.addresses.find((x) => String(x.address_id) === idv);
    if (kind === 'billing') { setBillId(idv); if (a) setBill(fromAddress(a)); } else { setShipId(idv); setAreaId(''); if (a) setShip(fromAddress(a)); }
  };
  const listKey = customer ? customer.list_key : 'default';
  const list = f ? f.lists.find((l) => l.key === listKey) || { key: 'default', label: 'Default' } : null;
  const inclusive = Boolean(f && f.basis.inclusive);
  const shipTo = ship || bill;
  const pos = shipTo && f ? placeOfSupply(bill && bill.gstin, shipTo.state_code, f.posRule) : null; // the server's rule (gstStates.js)
  const gstType = pos && pos.code === f.sellerState ? 'intra' : 'inter';
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
  // delivery: the method (own vehicle by default), the area from the shipping PIN code or town (or chosen), its charge
  const method = f ? (f.methods.find((m) => String(m.method_id) === methodId) || f.methods.find((m) => m.kind === 'own') || f.methods[0]) : null;
  const words = (a) => String(a.towns || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const autoArea = f && shipTo ? (f.areas.find((a) => shipTo.pincode && words(a).includes(String(shipTo.pincode))) || f.areas.find((a) => shipTo.town && words(a).includes(String(shipTo.town).trim().toLowerCase())) || null) : null;
  const area = f && method && method.kind !== 'pickup' ? (areaId ? f.areas.find((a) => String(a.area_id) === areaId) : autoArea) : null;
  const P = pv && pv.totals ? pv : null;
  const t = P ? { ...P.totals, gst_type: P.gst_type } : null;
  const freeDelivery = Boolean(P && P.delivery_area && P.delivery_area.free);
  const thisDue = t ? t.due : 0;
  const creditOver = Boolean(customer && !editing && terms === 'credit' && customer.outstanding + thisDue > customer.credit_limit + 0.005);
  const overdueHold = Boolean(customer && !editing && customer.overdue > 0);
  const held = P ? P.holds.length > 0 : rows.some((r) => r.needsApproval);
  const lineOf = (sku) => (P ? P.lines.find((x) => x.sku_code === sku && !x.is_free) : null);
  const freeLines = P ? P.lines.filter((x) => x.is_free) : [];
  const dirty = Boolean(customerId || lines.some((l) => l.sku_code));
  // what the server makes of it (offers, coupon, wallet, totals, approvals), shortly after each change
  const body = () => ({
    payment_terms: terms, note, coupon_code: couponApplied.trim().toUpperCase() || null, wallet_use: Number(wallet) || 0,
    manual_discount: manual.amount, manual_discount_reason: manual.reason,
    items: rows.filter((r) => r.l.sku_code && r.sku).map((r) => ({ sku_code: r.l.sku_code.trim().toUpperCase(), qty: r.packs, price: r.l.auto ? '' : r.l.price })),
    bill, ship: ship || { ...bill }, bill_address_id: billId, ship_address_id: shipId, contact_id: contactId, override_stock: override, delivery_method_id: method ? method.method_id : '', delivery_area_id: areaId,
  });
  const ready = Boolean(customerId && bill && bill.name && rows.some((r) => r.sku) && !rows.some((r) => r.problem));
  const key = ready ? JSON.stringify({ ...body(), customer_id: customerId }) : '';
  const seq = useRef(0);
  useEffect(() => {
    if (!key) { setPv(null); return undefined; }
    const n = ++seq.current;
    const timer = setTimeout(() => {
      api.send('POST', '/commerce/orders/preview', { ...JSON.parse(key), ...(editing ? { order_no: order.order_no } : {}) })
        .then((r) => n === seq.current && setPv(r), (e) => n === seq.current && setPv({ error: e.message }));
    }, 350);
    return () => clearTimeout(timer);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const save = () => act.run(async () => {
    const b = { ...body(), coupon_code: P && P.coupon ? P.coupon.code : null, wallet_use: P ? P.totals.wallet_used : 0 };
    const r = editing
      ? await api.send('PUT', `/commerce/orders/${order.order_no}`, { ...b, version: order.version, reason })
      : await api.send('POST', '/commerce/orders', { ...b, customer_id: customerId });
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
        <button type="button" className="a-btn" disabled={act.busy || !customerId || !items.length || blocked || !P || Boolean(pv && pv.error)} onClick={save}>{held ? 'Save - send for approval' : editing ? 'Save changes' : 'Save order'}</button>
        {held && P && <span className="a-muted">It waits for approval: {P.holds.map((h) => h.label.toLowerCase()).join(', ')}.</span>}
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
                  {f.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_no} {c.name} - {c.ctype}{c.town ? `, ${c.town}` : ''} ({c.phone}){c.status === 'on_hold' ? ' - ON HOLD' : ''}{c.overdue ? ' - OVERDUE' : ''}</option>)}
                </select>
              </label>
            )}
            {addingCustomer && <NewCustomerDrawer onClose={() => setAddingCustomer(false)} onSaved={(c) => pickCustomer(c.customer_id)} onOpenExisting={pickCustomer} />}
            {customer && (
              <p className="a-muted a-custline">Price list: <b>{list.label}</b>{customer.own_list ? ' (its own, not its type\'s)' : ''}. Credit: {customer.credit_limit > 0 ? `${customer.credit_days} days, limit ${rs(customer.credit_limit)}` : 'none'}; owes {rs(customer.outstanding)}
                {customer.overdue > 0 && <span className="a-overdue">{customer.overdue} overdue</span>}</p>
            )}
            <div className="a-grid2">
              <label className="a-field"><span>Payment terms</span>
                <select value={terms} aria-label="Payment terms" onChange={(e) => setTerms(e.target.value)}>{Object.entries(f.terms).map(([k, v]) => <option key={k} value={k}>{v}{k === 'credit' && customer ? ` (${customer.credit_days} days)` : ''}</option>)}</select>
              </label>
              <label className="a-field"><span>Note</span><input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. WhatsApp order, deliver before 10 am" /></label>
            </div>
            {creditOver && <Notice kind="warn">Over the credit limit: {rs(customer.outstanding)} open + this order {rs(thisDue)} &gt; {rs(customer.credit_limit)}. It waits for approval.</Notice>}
            {customer && customer.status === 'on_hold' && <Notice kind="warn">{customer.name} is on hold{customer.hold_reason ? `: ${customer.hold_reason}` : ''}. A new order waits for approval.</Notice>}
            {overdueHold && <Notice kind="warn">{customer.name} has {customer.overdue} overdue invoice{customer.overdue === 1 ? '' : 's'}: a new order waits for approval.</Notice>}
            {bill && (
              <>
                {customer && (
                  <div className="a-grid2">
                    <label className="a-field"><span>Bill to (its GSTIN goes on the invoice)</span>
                      <select value={billId} aria-label="Billing address" onChange={(e) => chooseAddr('billing', e.target.value)}>{billAddrs.map((a) => <option key={a.address_id} value={a.address_id}>{addrLabel(a)}</option>)}</select></label>
                    <label className="a-field"><span>Ship to (the GST follows this state)</span>
                      <select value={shipId} aria-label="Shipping address" onChange={(e) => chooseAddr('shipping', e.target.value)}>{shipAddrs.map((a) => <option key={a.address_id} value={a.address_id}>{addrLabel(a)}</option>)}</select></label>
                    <label className="a-field"><span>Delivery messages to (e-mail)</span>
                      <select value={contactId} aria-label="Order contact" onChange={(e) => setContactId(e.target.value)}>
                        <option value="">The contact with the shipping phone</option>
                        {(customer.contacts || []).map((c) => <option key={c.contact_id} value={c.contact_id}>{c.name}{c.role ? ` (${c.role})` : ''} - {c.email || 'no e-mail'}</option>)}
                      </select></label>
                  </div>
                )}
                <div className="a-addr">{addr(bill, setBill, 'bill')}{ship && addr(ship, setShip, 'ship')}</div>
                <p className="a-gst">GST: {gstType === 'intra' ? 'CGST + SGST' : 'IGST'} - place of supply {stateName(pos.code)} ({pos.code}): {pos.reason}{gstType === 'intra' ? ", the seller's state" : ", another state than the seller's"}</p>
                <div className="a-grid2">
                  <label className="a-field"><span>Delivery</span>
                    <select value={method ? String(method.method_id) : ''} aria-label="Delivery method" onChange={(e) => setMethodId(e.target.value)}>{f.methods.map((m) => <option key={m.method_id} value={m.method_id}>{m.label}</option>)}</select></label>
                  {method && method.kind !== 'pickup' && (
                    <label className="a-field"><span>Delivery area</span>
                      <select value={areaId} aria-label="Delivery area" onChange={(e) => setAreaId(e.target.value)}>
                        <option value="">From the address{autoArea ? `: ${autoArea.label}` : ': none matches (no charge)'}</option>
                        {f.areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.label}</option>)}</select></label>
                  )}
                </div>
                <p className="a-muted a-delivline">{method && method.kind === 'pickup' ? 'Customer pickup at the godown: no delivery charge.'
                  : area ? `${area.label}: Rs ${area.charge}${area.free_above !== null ? `, free above Rs ${area.free_above}` : ''}${freeDelivery ? ' - free for this order' : area.charge > 0 ? ` + GST ${f.deliveryGstRate}%` : ''}` : 'No delivery area matches this address: no delivery charge.'}</p>
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
                        {sku && <small className={`a-avail${short ? ' a-bad' : ' a-muted'}`}>Available {sku.available} (in stock {sku.good}{sku.expired ? `, expired ${sku.expired} blocked` : ''}, reserved {sku.reserved})</small>}</td>
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
                      <td className="a-num">{sku && price !== null ? rs(packs * price) : ''}
                        {lineOf(sku && sku.sku_code) && lineOf(sku.sku_code).offer_label && <small className="a-ok a-ordernote">{lineOf(sku.sku_code).offer_label}{lineOf(sku.sku_code).offer_discount > 0 ? `: - ${rs(lineOf(sku.sku_code).offer_discount)}` : ''}</small>}
                        {P && P.coupon && P.coupon.excluded.includes(sku && sku.sku_code) && <small className="a-muted a-ordernote">not in coupon {P.coupon.code}</small>}</td>
                      <td>{lines.length > 1 && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== n))} aria-label="Remove line">x</button>}</td>
                    </tr>
                  );
                })}
                {freeLines.map((x) => (
                  <tr key={`free-${x.sku_code}`} className="a-freeline">
                    <td><code>{x.sku_code}</code> <span className="a-status a-ap-approved">Free</span><small className="a-ok a-ordernote">{x.offer_label}</small></td>
                    <td className="a-num">{x.qty} pack{x.qty === 1 ? '' : 's'}</td><td className="a-num">{rs(0)}{x.list_price ? <small className="a-muted a-ordernote">list {rs(x.list_price)}</small> : null}</td><td className="a-num">{rs(0)}</td><td />
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</button>
            {anyShort && (f.canOverride ? (
              <label className="a-inline a-override"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Order more than available anyway{f.approval.stock ? ' (waits for approval by someone else)' : ''}</label>
            ) : <Notice kind="error">More than the available stock: lower the quantity (only a role with &quot;approve&quot; on Orders can ask for an override).</Notice>)}
            <div className="a-grid2">
              <label className="a-field"><span>Coupon (one per order)</span>
                <span className="a-row">
                  <input list="order-coupons" value={coupon} aria-label="Coupon" onChange={(e) => setCoupon(e.target.value)} placeholder="e.g. WELCOME10" />
                  <button type="button" className="a-btn a-btn-sm" disabled={!coupon.trim() || !items.length} onClick={() => setCouponApplied(coupon.trim().toUpperCase())}>Apply</button>
                  {couponApplied && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { setCoupon(''); setCouponApplied(''); }}>Remove</button>}
                </span>
                <datalist id="order-coupons">{f.coupons.map((c) => <option key={c.code} value={c.code}>{c.description || c.kind}</option>)}</datalist>
                {pv && pv.coupon_error && <small className="a-bad" role="alert">{pv.coupon_error}</small>}
                {P && P.coupon && <small className="a-ok" role="status">{P.coupon.code}: {P.coupon.kind === 'free_delivery' ? `delivery charge ${rs(P.coupon.delivery_waived)} waived` : `- ${rs(P.coupon.discount)}`}
                  {P.coupon.capped ? ` (capped at ${rs(P.coupon.cap)})` : ''}{P.coupon.excluded.length ? `; not on ${P.coupon.excluded.join(', ')} (excluded)` : ''}</small>}
              </label>
              <label className="a-field"><span>Use wallet {customer ? `(usable ${rs(P ? P.wallet.usable : customer.wallet)})` : ''}</span>
                <input type="number" min="0" step="1" value={wallet} aria-label="Use wallet" disabled={!customer || (P ? P.wallet.usable <= 0 : customer.wallet <= 0)} onChange={(e) => setWallet(e.target.value)} placeholder={customer ? 'Amount' : 'Choose the customer'} />
                {P && <small className="a-muted">At most {P.wallet.max_pct}% of the order: {rs(P.wallet.cap)}. Under GST: {P.wallet.gst === 'discount' ? 'cashback and manual credit lower the taxable value; refunds count as paid' : 'the wallet counts as a payment'}.</small>}
                {pv && pv.wallet_error && <small className="a-bad" role="alert">{pv.wallet_error}</small>}
              </label>
            </div>
            {f.manualDiscount && (
              <div className="a-grid2">
                <label className="a-field"><span>Manual discount (Rs, optional)</span><input inputMode="decimal" value={manual.amount} aria-label="Manual discount" onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></label>
                {Number(manual.amount) > 0 && <label className="a-field"><span>Why? (required)</span><input value={manual.reason} maxLength={255} aria-label="Manual discount reason" onChange={(e) => setManual({ ...manual, reason: e.target.value })} /></label>}
              </div>
            )}
            {P && P.discount.total > 0 && (
              <p className={P.holds.some((h) => h.kind === 'discount') ? 'a-bad' : 'a-muted'}>Discounts {rs(P.discount.total)} = {P.discount.pct}% of the goods
                {P.discount.limit !== null ? (P.holds.some((h) => h.kind === 'discount') ? `: above ${P.discount.limit}%, it waits for approval` : ` (approval above ${P.discount.limit}%)`) : ''}.</p>
            )}
            {P && P.holds.length > 0 && <Notice kind="warn">Waits for approval: {P.holds.map((h) => `${h.label} - ${h.what}`).join('; ')}</Notice>}
            {pv && pv.error && <Notice kind="error">{pv.error}</Notice>}
            {editing && <label className="a-field"><span>Why is it changed?{order.editable === 'reason' ? ' (required)' : ' (optional)'}</span><input value={reason} maxLength={255} aria-label="Reason for the change" onChange={(e) => setReason(e.target.value)} /></label>}
            {t ? <Totals t={{ ...t, coupon: P.coupon ? P.coupon.code : null }} due={t.due} /> : <p className="a-muted">The totals show once the customer, the address and a line are in.</p>}
          </>
        )}
      </Loading>
    </Drawer>
  );
}
