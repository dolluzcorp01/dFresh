// dFresh Commerce (DEMO, database dfresh_commerce): orders entered in the admin (phone / WhatsApp / B2B).
// List with status filters; an order's drawer moves it New > Packed > Dispatched (stock out, asked first) > Delivered
// and opens the GST invoice (print / save as PDF). New order: customer, SKUs + qty + price (prices only in the admin),
// coupon, wallet, payment (COD / Razorpay demo / bank transfer). Logic: src/backend_routes/commerce.js.
// Prices (phase 2): the price fills from the customer type's price list (Default when the type has none) and can be
// changed; quantities in packs or cartons follow each SKU's minimum order and carton rule (clear message per line); a
// price below the list by more than the Commerce setting is saved as "Waiting for approval" (Approvals).
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLoad } from './ui';
import { ReturnForm, ReturnsTable } from './CommerceReturns';
import { NewCustomerDrawer } from './CommerceCustomers';
import { PriceBasis } from './Prices';

const FLOW = ['new', 'packed', 'dispatched', 'delivered'];
const STATUSES = ['approval', ...FLOW, 'cancelled'];
const LABEL = { approval: 'Waiting for approval', new: 'New', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const NEXT_BTN = { new: 'Mark packed', packed: 'Dispatch (stock out)', dispatched: 'Mark delivered' };
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// GST invoice in a new window (intrastate: CGST + SGST, half the rate each). DEMO: says so on the page.
function printInvoice(o) {
  const share = Number(o.subtotal) ? (Number(o.subtotal) - Number(o.discount)) / Number(o.subtotal) : 0;
  const lines = o.items.map((i, n) => {
    const taxable = i.qty * i.price * share;
    const half = (taxable * (i.gst_rate / 100)) / 2;
    return `<tr><td>${n + 1}</td><td>${esc(i.name)}<br><small>${esc(i.sku_code)} - ${esc(i.size_label)}</small></td><td>${esc(i.hsn || '4818')}</td>
      <td class="n">${i.qty}</td><td class="n">${Number(i.price).toFixed(2)}</td><td class="n">${taxable.toFixed(2)}</td>
      <td class="n">${(i.gst_rate / 2).toFixed(1)}% ${half.toFixed(2)}</td><td class="n">${(i.gst_rate / 2).toFixed(1)}% ${half.toFixed(2)}</td>
      <td class="n">${(taxable + 2 * half).toFixed(2)}</td></tr>`;
  }).join('');
  const s = o.seller || {};
  const demo = o.invoice_demo !== false; // the seller GSTIN is still a placeholder (Commerce settings > Invoice)
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.order_no)}</title><style>
  @page { size: A4; margin: 12mm; } body { font-family: Arial, sans-serif; color: #121214; font-size: 12px; margin: 0; }
  .demo { background: #fdf1f1; color: #9b1c1c; padding: 6px 10px; font-weight: 700; margin-bottom: 10px; }
  h1 { font-size: 18px; margin: 0 0 4px; } .row { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f6f3ea; } .n { text-align: right; white-space: nowrap; } small { color: #555; }
  .tot { width: 320px; margin-left: auto; margin-top: 10px; } .tot td { border: none; padding: 3px 6px; } .grand td { font-weight: 700; font-size: 14px; border-top: 2px solid #121214; }
  .bar { padding: 8px 0; } @media print { .bar { display: none; } }
  .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
  .wm span { transform: rotate(-30deg); font-size: 56px; font-weight: 800; color: rgba(155, 28, 28, .13); white-space: nowrap; }
  body > *:not(.wm) { position: relative; z-index: 1; }
</style></head><body><div class="bar">Print, or choose "Save as PDF".</div>
${demo ? '<div class="wm"><span>DEMO - not a tax invoice</span></div><div class="demo">DEMO - not a tax invoice (the seller GSTIN is still to be confirmed)</div>' : ''}
<div class="row"><div><h1>Tax invoice</h1><b>${esc(s.name)}</b><br>${esc(s.address)}<br>
GSTIN: ${esc(demo ? 'to be confirmed' : s.gstin)} &middot; CIN: ${esc(s.cin)}<br>${esc(s.phone)} &middot; ${esc(s.email)}${s.bank ? `<br>Bank: ${esc(s.bank)}` : ''}</div>
<div><b>Invoice ${esc(o.order_no)}</b><br>Date: ${esc(new Date(o.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }))}<br>
Payment: ${esc(o.payment_label)}<br>Place of supply: Tamil Nadu (33)</div></div>
<div class="row"><div><b>Bill to</b><br>${esc(o.customer)}<br>${esc(o.address || '')}${o.town ? `, ${esc(o.town)}` : ''}<br>Phone ${esc(o.phone)}${o.customer_gstin ? `<br>GSTIN ${esc(o.customer_gstin)}` : ''}</div></div>
<table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Taxable</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Amount</th></tr></thead>
<tbody>${lines}</tbody></table>
<table class="tot"><tr><td>Subtotal</td><td class="n">${Number(o.subtotal).toFixed(2)}</td></tr>
${Number(o.discount) ? `<tr><td>Discount${o.coupon_code ? ` (${esc(o.coupon_code)})` : ''}</td><td class="n">-${Number(o.discount).toFixed(2)}</td></tr>` : ''}
<tr><td>GST</td><td class="n">${Number(o.gst).toFixed(2)}</td></tr>
${Number(o.wallet_used) ? `<tr><td>Paid from wallet</td><td class="n">-${Number(o.wallet_used).toFixed(2)}</td></tr>` : ''}
<tr class="grand"><td>Total (INR)</td><td class="n">${Number(o.total).toFixed(2)}</td></tr></table>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export default function CommerceOrders() {
  const location = useLocation();
  const urlStatus = new URLSearchParams(location.search).get('status') || '';
  const [status, setStatus] = useState(STATUSES.includes(urlStatus) ? urlStatus : '');
  useEffect(() => { if (STATUSES.includes(urlStatus)) setStatus(urlStatus); }, [urlStatus]);
  const list = useLoad(`/commerce/orders${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState(null); // order_no
  const [creating, setCreating] = useState(false);
  const canEdit = useCan('orders', 'edit');
  const canCreate = useCan('orders', 'create');
  const counts = (list.data && list.data.counts) || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <section>
      <h1>Orders</h1>
      <InfoCard title="Commerce demo - orders entered in the admin">
        <ul>
          <li>Phone, WhatsApp and B2B orders are entered here. Prices live only in the admin, never on the public site.</li>
          <li>New &gt; Packed &gt; Dispatched &gt; Delivered. Dispatched takes the stock out of the Kanchipuram godown.</li>
          <li>Open an order for its GST invoice (print or save as PDF). DEMO data, no real payments.</li>
        </ul>
      </InfoCard>
      <div className="a-toolbar">
        <div className="a-chips" role="group" aria-label="Status">
          <button type="button" className={`a-chip${status === '' ? ' on' : ''}`} onClick={() => setStatus('')}>All {all}</button>
          {STATUSES.filter((s) => FLOW.includes(s) || counts[s]).map((s) => <button key={s} type="button" className={`a-chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{LABEL[s]} {counts[s] || 0}</button>)}
        </div>
        {canCreate && <button type="button" className="a-btn" onClick={() => setCreating(true)}>New order</button>}
      </div>
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-orders">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="a-num">Units</th><th className="a-num">Total</th><th>Payment</th><th>Received</th></tr></thead>
            <tbody>
              {((list.data && list.data.rows) || []).map((o) => (
                <tr key={o.order_no} className="a-rowlink" tabIndex={0} onClick={() => setOpen(o.order_no)} onKeyDown={(e) => e.key === 'Enter' && setOpen(o.order_no)}>
                  <td><code>{o.order_no}</code></td>
                  <td>{o.customer} <small className="a-muted">{o.ctype}, {o.town}</small></td>
                  <td><span className={`a-ostatus a-ostatus-${o.status}`}>{LABEL[o.status]}</span></td>
                  <td className="a-num">{o.units}</td>
                  <td className="a-num">{rs(o.total)}</td>
                  <td>{o.payment === 'razorpay' ? 'Razorpay (demo)' : o.payment === 'cod' ? 'COD' : 'Bank'}{o.coupon_code ? <small className="a-muted"> {o.coupon_code}</small> : null}</td>
                  <td>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open && <OrderDrawer no={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {creating && <NewOrder onClose={() => setCreating(false)} onSaved={(no) => { setCreating(false); list.reload(); setOpen(no); }} />}
    </section>
  );
}

function OrderDrawer({ no, canEdit, onClose, onChanged }) {
  const o = useLoad(`/commerce/orders/${no}`);
  const canReturn = useCan('returns', 'create');
  const rets = useLoad(`/commerce/returns?order=${no}`);
  const [returning, setReturning] = useState(false);
  const act = useAction();
  const confirm = useConfirm();
  const d = o.data;
  const next = d && FLOW.includes(d.status) ? FLOW[FLOW.indexOf(d.status) + 1] : null;
  const advance = async () => {
    if (next === 'dispatched' && !(await confirm({
      title: `Dispatch ${no}?`, message: `Takes ${d.items.reduce((a, i) => a + i.qty, 0)} units out of the Kanchipuram godown stock (${d.items.map((i) => `${i.qty} x ${i.sku_code}`).join(', ')}).`,
      action: 'Dispatch',
    }))) return;
    act.run(async () => { await api.send('POST', `/commerce/orders/${no}/status`, { to: next }); o.reload(); onChanged(); }, `${no} is now ${LABEL[next]}`);
  };
  return (
    <Drawer title={`Order ${no}`} onClose={onClose}
      footer={d ? (
        <>
          {FLOW.includes(d.status) && <button type="button" className="a-btn a-btn-ghost" onClick={() => { if (!printInvoice(d)) act.setMsg({ kind: 'error', text: 'Allow pop-ups to open the invoice.' }); }}>GST invoice</button>}
          {canEdit && next && <button type="button" className="a-btn" disabled={act.busy} onClick={advance}>{NEXT_BTN[d.status]}</button>}
          {canReturn && d.status === 'delivered' && !returning && <button type="button" className="a-btn" onClick={() => setReturning(true)}>Return items</button>}
        </>
      ) : null}>
      <Loading state={o}>
        {d && (
          <>
            {act.note}
            {d.status === 'approval' && (
              <Notice kind="warn">Waiting for approval: a price is below the {d.price_list_label} list by more than the limit.
                {d.approval ? ` Request #${d.approval.approval_id} is ${d.approval.status}.` : ''} It cannot be packed until someone else approves it (Setup &gt; Approvals).</Notice>
            )}
            {d.status === 'cancelled' && <Notice kind="error">Cancelled{d.cancel_reason ? `: ${d.cancel_reason}` : ''}{d.approval && d.approval.note ? ` - "${d.approval.note}"` : ''}. Coupon and wallet use were given back.</Notice>}
            <ol className="a-steps">
              {FLOW.map((s) => <li key={s} className={FLOW.indexOf(s) <= FLOW.indexOf(d.status) ? 'done' : ''}>{LABEL[s]}<small>{fmtDate(d[s === 'new' ? 'created_at' : `${s}_at`])}</small></li>)}
            </ol>
            <dl className="a-dl">
              <div><dt>Customer</dt><dd>{d.customer} ({d.ctype}) - {d.phone}</dd></div>
              <div><dt>Address</dt><dd>{[d.address, d.town].filter(Boolean).join(', ')}</dd></div>
              <div><dt>Payment</dt><dd>{d.payment_label}{d.payment === 'razorpay' ? ' - paid (demo)' : ''}</dd></div>
              {d.price_list && <div><dt>Price list</dt><dd>{d.price_list_label} (list prices {d.prices_basis})</dd></div>}
              {d.note && <div><dt>Note</dt><dd>{d.note}</dd></div>}
            </dl>
            <table className="a-table">
              <thead><tr><th>SKU</th><th>Item</th><th className="a-num">Qty</th><th className="a-num">Price (excl. GST)</th><th className="a-num">List</th><th className="a-num">Amount</th></tr></thead>
              <tbody>{d.items.map((i) => (
                <tr key={i.sku_code}><td><code>{i.sku_code}</code></td><td>{i.name}<small className="a-muted a-person-sub">HSN {i.hsn || '-'} · GST {Number(i.gst_rate)}%</small></td><td className="a-num">{i.qty}</td><td className="a-num">{rs(i.price)}</td>
                  <td className="a-num">{i.list_price == null ? '-' : rs(i.list_price)}</td><td className="a-num">{rs(i.qty * i.price)}</td></tr>
              ))}</tbody>
            </table>
            <Totals t={{ subtotal: d.subtotal, discount: d.discount, coupon: d.coupon_code, gst: d.gst, walletUsed: d.wallet_used, total: d.total }} />
            {returning && (
              <ReturnForm order={d} onCancel={() => setReturning(false)}
                onDone={(r) => { setReturning(false); rets.reload(); onChanged(); act.setMsg({ kind: 'ok', text: `${r.return_no} saved: ${r.outcome === 'wallet' ? `Rs ${r.amount} to the wallet` : r.outcome === 'replacement' ? `replacement order ${r.replacement_no}` : `refund Rs ${r.amount} (demo)`}` }); }} />
            )}
            {rets.data && rets.data.length > 0 && <><h3>Returns</h3><ReturnsTable rows={rets.data} compact /></>}
          </>
        )}
      </Loading>
    </Drawer>
  );
}

function Totals({ t }) {
  return (
    <dl className="a-dl a-totals">
      <div><dt>Subtotal</dt><dd>{rs(t.subtotal)}</dd></div>
      {Number(t.discount) > 0 && <div><dt>Discount{t.coupon ? ` (${t.coupon})` : ''}</dt><dd>- {rs(t.discount)}</dd></div>}
      <div><dt>GST</dt><dd>{rs(t.gst)}</dd></div>
      {Number(t.walletUsed) > 0 && <div><dt>Wallet</dt><dd>- {rs(t.walletUsed)}</dd></div>}
      <div className="a-grand"><dt>Total</dt><dd>{rs(t.total)}</dd></div>
    </dl>
  );
}

// the same money rules as commerce.js totals(), for the live preview (the server recomputes on save); i.price is the
// price before GST (already split out when the lists include GST)
function preview(items, discount, wallet) {
  const subtotal = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const share = subtotal ? (subtotal - discount) / subtotal : 0;
  const gst = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0) * share * ((Number(i.gst_rate) || 0) / 100), 0);
  const before = subtotal - discount + gst;
  const walletUsed = Math.min(wallet, before);
  return { subtotal, discount, gst, walletUsed, total: before - walletUsed };
}

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

function NewOrder({ onClose, onSaved }) {
  const form = useLoad('/commerce/order-form');
  const act = useAction();
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [coupon, setCoupon] = useState('');
  const [couponState, setCouponState] = useState(null); // { discount } | { error }
  const [wallet, setWallet] = useState('');
  const [payment, setPayment] = useState('cod');
  const [note, setNote] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const f = form.data;
  // a customer added here (or an existing one from the duplicate check) is selected; everything else stays filled in
  const pickCustomer = (id) => { setAddingCustomer(false); form.reload(); setCustomerId(String(id)); setWallet(''); };
  const skuMap = useMemo(() => new Map(((f && f.skus) || []).map((s) => [s.sku_code, s])), [f]);
  const customer = f && f.customers.find((c) => String(c.customer_id) === String(customerId));
  const listKey = customer ? customer.list_key : 'default';
  const list = f ? f.lists.find((l) => l.key === listKey) || { key: 'default', label: 'Default' } : null;
  const inclusive = Boolean(f && f.basis.inclusive);
  // each line in packs, its list price and what is wrong with it
  const rows = lines.map((l) => {
    const sku = skuMap.get(l.sku_code.trim().toUpperCase());
    const packs = (Number(l.qty) || 0) * (sku && l.unit === 'carton' ? Number(sku.packs_per_carton) || 1 : 1);
    const lp = listPrice(sku, listKey);
    const price = l.price === '' ? lp : Number(l.price);
    const below = lp && price !== null && price < lp ? Math.round(((lp - price) / lp) * 10000) / 100 : 0;
    const problem = !sku ? null : !Number.isInteger(Number(l.qty)) || Number(l.qty) < 1 ? 'Quantity: a whole number from 1' : qtyProblem(sku, packs);
    return { l, sku, packs, lp, price, below, problem, needsApproval: Boolean(f && f.approval.on && below > f.approval.pct) };
  });
  const items = rows.filter((r) => r.sku).map((r) => ({ sku_code: r.sku.sku_code, qty: r.packs, gst_rate: r.sku.gst_rate,
    price: r.price === null ? 0 : inclusive ? Math.round((r.price / (1 + r.sku.gst_rate / 100)) * 100) / 100 : r.price }));
  const blocked = rows.some((r) => r.problem || (r.sku && r.price === null));
  const held = rows.some((r) => r.needsApproval);
  const discount = couponState && couponState.discount ? couponState.discount : 0;
  const t = preview(items, discount, Math.min(Number(wallet) || 0, customer ? customer.wallet : 0));
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
    const r = await api.send('POST', '/commerce/orders', {
      customer_id: customerId, payment, note, coupon_code: couponState && couponState.discount ? coupon.trim().toUpperCase() : null,
      wallet_use: t.walletUsed, items: rows.filter((r) => r.l.sku_code).map((r) => ({ sku_code: r.l.sku_code.trim().toUpperCase(), qty: r.packs, price: r.l.auto ? '' : r.l.price })),
    });
    onSaved(r.order_no);
  });

  return (
    <Drawer title="New order" onClose={onClose} dirty={dirty}
      footer={<>
        <button type="button" className="a-btn" disabled={act.busy || !customerId || !items.length || blocked} onClick={save}>{held ? 'Save - send for approval' : 'Save order'}</button>
        {held && <span className="a-muted">A price is more than {f.approval.pct}% below the {list.label} list: the order waits for approval.</span>}
      </>}>
      <Loading state={form}>
        {f && (
          <>
            {act.note}
            <PriceBasis basis={f.basis} />
            <label className="a-field"><span>Customer <button type="button" className="a-link a-newcust" onClick={() => setAddingCustomer(true)}>+ New customer</button></span>
              <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setWallet(''); }}>
                <option value="">Choose...</option>
                {f.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name} - {c.ctype}{c.town ? `, ${c.town}` : ''} ({c.phone})</option>)}
              </select>
            </label>
            {addingCustomer && <NewCustomerDrawer onClose={() => setAddingCustomer(false)} onSaved={(c) => pickCustomer(c.customer_id)} onOpenExisting={pickCustomer} />}
            {customer && <p className="a-muted">Price list: <b>{list.label}</b>{list.key === 'default' ? ' (no list for this customer type)' : ''}. Prices fill from it; a SKU without a {list.label} price uses the Default list.</p>}
            <h3>Items</h3>
            <datalist id="order-skus">{f.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.name} - {s.size_label}</option>)}</datalist>
            <table className="a-table a-orderlines">
              <thead><tr><th>SKU (scan or type)</th><th className="a-num">Qty</th><th className="a-num">Price / pack ({f.basis.short})</th><th className="a-num">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map(({ l, sku, packs, lp, price, below, problem, needsApproval }, n) => {
                  const units = unitsOf(sku);
                  return (
                    <tr key={n} className={problem || needsApproval ? 'a-pending' : undefined}>
                      <td><input list="order-skus" value={l.sku_code} aria-label={`SKU ${n + 1}`} onChange={(e) => setLine(n, { sku_code: e.target.value })} />
                        <small className={sku ? 'a-muted' : 'a-bad'}>{l.sku_code ? (sku ? `${sku.name} - ${sku.size_label}` : 'Unknown SKU') : ''}</small>
                        {sku && <small className="a-muted a-ordernote">Carton {sku.packs_per_carton} packs · min {sku.min_order_qty} · {sku.sell_unit === 'carton' ? 'full cartons only' : sku.sell_unit === 'both' ? 'packs or cartons' : 'packs'}</small>}</td>
                      <td className="a-num">
                        <span className="a-row">
                          <input type="number" min="1" step="1" className="a-qty" value={l.qty} aria-label={`Qty ${n + 1}`} onChange={(e) => setLine(n, { qty: e.target.value })} />
                          {units.length > 1 ? (
                            <select value={l.unit} aria-label={`Unit ${n + 1}`} onChange={(e) => setLine(n, { unit: e.target.value })}><option value="pack">packs</option><option value="carton">cartons</option></select>
                          ) : <span className="a-muted">{units[0] === 'carton' ? 'cartons' : 'packs'}</span>}
                        </span>
                        {sku && l.unit === 'carton' && <small className="a-muted a-ordernote">= {packs} packs</small>}
                        {problem && <small className="a-bad a-ordernote" role="alert">{problem}</small>}
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
              <label className="a-field"><span>Use wallet {customer ? `(balance ${rs(customer.wallet)})` : ''}</span>
                <input type="number" min="0" step="1" value={wallet} disabled={!customer || customer.wallet <= 0} onChange={(e) => setWallet(e.target.value)} placeholder={customer && customer.wallet > 0 ? 'Amount' : 'No wallet balance'} />
              </label>
              <label className="a-field"><span>Payment</span>
                <select value={payment} onChange={(e) => setPayment(e.target.value)}>{Object.entries(f.payments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="a-field"><span>Note</span><input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. WhatsApp order, deliver before 10 am" /></label>
            </div>
            {payment === 'razorpay' && <p className="a-muted">Razorpay (demo): no real payment; the order is saved as paid online.</p>}
            <Totals t={{ ...t, coupon: discount ? coupon.toUpperCase() : null }} />
          </>
        )}
      </Loading>
    </Drawer>
  );
}
