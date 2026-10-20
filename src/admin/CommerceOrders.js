// dFresh Commerce (DEMO, database dfresh_commerce): orders entered in the admin (phone / WhatsApp / B2B).
// List with status filters; an order's drawer moves it New > Packed > Dispatched (stock out, asked first) > Delivered
// and opens the GST invoice (print / save as PDF). New order: customer, SKUs + qty + price (prices only in the admin),
// coupon, wallet, payment (COD / Razorpay demo / bank transfer). Logic: src/backend_routes/commerce.js.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, fmtDate, useAction, useCan, useConfirm, useLoad } from './ui';
import { ReturnForm, ReturnsTable } from './CommerceReturns';
import { NewCustomerDrawer } from './CommerceCustomers';

const FLOW = ['new', 'packed', 'dispatched', 'delivered'];
const LABEL = { new: 'New', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered' };
const NEXT_BTN = { new: 'Mark packed', packed: 'Dispatch (stock out)', dispatched: 'Mark delivered' };
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// GST invoice in a new window (intrastate: CGST + SGST, half the rate each). DEMO: says so on the page.
function printInvoice(o) {
  const share = Number(o.subtotal) ? (Number(o.subtotal) - Number(o.discount)) / Number(o.subtotal) : 0;
  const lines = o.items.map((i, n) => {
    const taxable = i.qty * i.price * share;
    const half = (taxable * (i.gst_rate / 100)) / 2;
    return `<tr><td>${n + 1}</td><td>${esc(i.name)}<br><small>${esc(i.sku_code)} - ${esc(i.size_label)}</small></td><td>4818</td>
      <td class="n">${i.qty}</td><td class="n">${Number(i.price).toFixed(2)}</td><td class="n">${taxable.toFixed(2)}</td>
      <td class="n">${(i.gst_rate / 2).toFixed(1)}% ${half.toFixed(2)}</td><td class="n">${(i.gst_rate / 2).toFixed(1)}% ${half.toFixed(2)}</td>
      <td class="n">${(taxable + 2 * half).toFixed(2)}</td></tr>`;
  }).join('');
  const s = o.seller || {};
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
</style></head><body><div class="bar">Print, or choose "Save as PDF".</div>
<div class="demo">DEMO - not a valid tax invoice</div>
<div class="row"><div><h1>Tax invoice</h1><b>${esc(s.company_name)}</b><br>Marketed by dFresh, Kanchipuram<br>
GSTIN: ${esc(s.gstin || 'to be confirmed')} &middot; CIN: ${esc(s.cin)}<br>${esc(s.office_phone)} &middot; ${esc(s.public_email)}</div>
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
  const [status, setStatus] = useState(FLOW.includes(urlStatus) ? urlStatus : '');
  useEffect(() => { if (FLOW.includes(urlStatus)) setStatus(urlStatus); }, [urlStatus]);
  const list = useLoad(`/commerce/orders${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState(null); // order_no
  const [creating, setCreating] = useState(false);
  const canEdit = useCan('editor');
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
          {FLOW.map((s) => <button key={s} type="button" className={`a-chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{LABEL[s]} {counts[s] || 0}</button>)}
        </div>
        {canEdit && <button type="button" className="a-btn" onClick={() => setCreating(true)}>New order</button>}
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
  const rets = useLoad(`/commerce/returns?order=${no}`);
  const [returning, setReturning] = useState(false);
  const act = useAction();
  const confirm = useConfirm();
  const d = o.data;
  const next = d ? FLOW[FLOW.indexOf(d.status) + 1] : null;
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
          <button type="button" className="a-btn a-btn-ghost" onClick={() => { if (!printInvoice(d)) act.setMsg({ kind: 'error', text: 'Allow pop-ups to open the invoice.' }); }}>GST invoice</button>
          {canEdit && next && <button type="button" className="a-btn" disabled={act.busy} onClick={advance}>{NEXT_BTN[d.status]}</button>}
          {canEdit && d.status === 'delivered' && !returning && <button type="button" className="a-btn" onClick={() => setReturning(true)}>Return items</button>}
        </>
      ) : null}>
      <Loading state={o}>
        {d && (
          <>
            {act.note}
            <ol className="a-steps">
              {FLOW.map((s) => <li key={s} className={FLOW.indexOf(s) <= FLOW.indexOf(d.status) ? 'done' : ''}>{LABEL[s]}<small>{fmtDate(d[s === 'new' ? 'created_at' : `${s}_at`])}</small></li>)}
            </ol>
            <dl className="a-dl">
              <div><dt>Customer</dt><dd>{d.customer} ({d.ctype}) - {d.phone}</dd></div>
              <div><dt>Address</dt><dd>{[d.address, d.town].filter(Boolean).join(', ')}</dd></div>
              <div><dt>Payment</dt><dd>{d.payment_label}{d.payment === 'razorpay' ? ' - paid (demo)' : ''}</dd></div>
              {d.note && <div><dt>Note</dt><dd>{d.note}</dd></div>}
            </dl>
            <table className="a-table">
              <thead><tr><th>SKU</th><th>Item</th><th className="a-num">Qty</th><th className="a-num">Price</th><th className="a-num">Amount</th></tr></thead>
              <tbody>{d.items.map((i) => <tr key={i.sku_code}><td><code>{i.sku_code}</code></td><td>{i.name}</td><td className="a-num">{i.qty}</td><td className="a-num">{rs(i.price)}</td><td className="a-num">{rs(i.qty * i.price)}</td></tr>)}</tbody>
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

// the same money rules as commerce.js totals(), for the live preview (the server recomputes on save)
function preview(items, discount, wallet) {
  const subtotal = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const share = subtotal ? (subtotal - discount) / subtotal : 0;
  const gst = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0) * share * ((Number(i.gst_rate) || 18) / 100), 0);
  const before = subtotal - discount + gst;
  const walletUsed = Math.min(wallet, before);
  return { subtotal, discount, gst, walletUsed, total: before - walletUsed };
}

function NewOrder({ onClose, onSaved }) {
  const form = useLoad('/commerce/order-form');
  const act = useAction();
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState([{ sku_code: '', qty: 1, price: '' }]);
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
  const items = lines.map((l) => ({ ...l, gst_rate: (skuMap.get(l.sku_code.trim().toUpperCase()) || {}).gst_rate || 18 })).filter((l) => skuMap.has(l.sku_code.trim().toUpperCase()));
  const discount = couponState && couponState.discount ? couponState.discount : 0;
  const t = preview(items, discount, Math.min(Number(wallet) || 0, customer ? customer.wallet : 0));
  const dirty = Boolean(customerId || lines.some((l) => l.sku_code));

  const setLine = (n, patch) => setLines((ls) => ls.map((l, i) => {
    if (i !== n) return l;
    const nl = { ...l, ...patch };
    const sku = skuMap.get(String(nl.sku_code).trim().toUpperCase());
    if ('sku_code' in patch && sku && (l.price === '' || l.price === undefined)) nl.price = String(sku.price);
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
      wallet_use: t.walletUsed, items: lines.filter((l) => l.sku_code).map((l) => ({ sku_code: l.sku_code.trim().toUpperCase(), qty: Number(l.qty), price: Number(l.price) })),
    });
    onSaved(r.order_no);
  });

  return (
    <Drawer title="New order" onClose={onClose} dirty={dirty}
      footer={<button type="button" className="a-btn" disabled={act.busy || !customerId || !items.length} onClick={save}>Save order</button>}>
      <Loading state={form}>
        {f && (
          <>
            {act.note}
            <label className="a-field"><span>Customer <button type="button" className="a-link a-newcust" onClick={() => setAddingCustomer(true)}>+ New customer</button></span>
              <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setWallet(''); }}>
                <option value="">Choose...</option>
                {f.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name} - {c.ctype}{c.town ? `, ${c.town}` : ''} ({c.phone})</option>)}
              </select>
            </label>
            {addingCustomer && <NewCustomerDrawer onClose={() => setAddingCustomer(false)} onSaved={(c) => pickCustomer(c.customer_id)} onOpenExisting={pickCustomer} />}
            <h3>Items</h3>
            <datalist id="order-skus">{f.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.name} - {s.size_label}</option>)}</datalist>
            <table className="a-table a-orderlines">
              <thead><tr><th>SKU (scan or type)</th><th className="a-num">Qty</th><th className="a-num">Price / pack</th><th className="a-num">Amount</th><th /></tr></thead>
              <tbody>
                {lines.map((l, n) => {
                  const sku = skuMap.get(l.sku_code.trim().toUpperCase());
                  return (
                    <tr key={n}>
                      <td><input list="order-skus" value={l.sku_code} aria-label={`SKU ${n + 1}`} onChange={(e) => setLine(n, { sku_code: e.target.value })} />
                        <small className={sku ? 'a-muted' : 'a-bad'}>{l.sku_code ? (sku ? `${sku.name} - ${sku.size_label}` : 'Unknown SKU') : ''}</small></td>
                      <td className="a-num"><input type="number" min="1" step="1" className="a-qty" value={l.qty} aria-label={`Qty ${n + 1}`} onChange={(e) => setLine(n, { qty: e.target.value })} /></td>
                      <td className="a-num"><input type="number" min="0" step="0.5" className="a-price" value={l.price} aria-label={`Price ${n + 1}`} onChange={(e) => setLine(n, { price: e.target.value })} /></td>
                      <td className="a-num">{sku ? rs((Number(l.qty) || 0) * (Number(l.price) || 0)) : ''}</td>
                      <td>{lines.length > 1 && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== n))} aria-label="Remove line">x</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => [...ls, { sku_code: '', qty: 1, price: '' }])}>Add line</button>
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
