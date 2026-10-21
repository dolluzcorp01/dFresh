// Commerce > Promotions (docs/COMMERCE-SPEC.md 3; API /commerce/promotions, logic in src/backend_routes/promotions.js).
// Tabs:
// - Coupons: percent (with a cap) / fixed / free delivery; minimum order; valid from / to; uses in all and per customer;
//   customer types or named customers; SKUs or categories included / excluded; on / off; the usage list per coupon.
// - Offers (no code, applied in New order and shown on the line): quantity slab (from N packs or cartons, n % off) and
//   buy X get Y free (a free line at Rs 0 that takes stock), per customer type, with dates.
// - Cashback: rules per customer type (percent, minimum order, maximum per order, dates, on / off); when it is credited
//   (Commerce setting); Run now = wallet expiry and the cashback whose return window has passed (also hourly).
// - Wallets: a customer's statement and the manual credit / debit (WalletPanel).
// View = everything; create = new coupon / offer / rule and manual wallet changes; edit = change and switch on / off.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useLoad } from './ui';
import { rs } from './printKit';
import WalletPanel from './WalletPanel';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const dates = (x) => (x.valid_from || x.valid_to ? `${x.valid_from ? day(x.valid_from) : 'any time'} to ${x.valid_to ? day(x.valid_to) : 'no end'}` : 'no dates');
const nz = (v) => (v === null || v === undefined ? '' : String(v));
const TABS = [['coupons', 'Coupons'], ['offers', 'Offers'], ['cashback', 'Cashback'], ['wallets', 'Wallets']];

/** chips picked from a list (customer types, customers, SKUs / categories) */
function Picker({ label, options, values, onChange }) {
  const left = options.filter((o) => !values.includes(o.value));
  return (
    <div className="a-field">
      <span>{label}</span>
      <div className="a-chips">
        {values.map((v) => <span key={v} className="a-chip on">{(options.find((o) => o.value === v) || { label: v }).label} <button type="button" className="a-x" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>)}
        {left.length > 0 && <select value="" aria-label={label} onChange={(e) => e.target.value && onChange([...values, e.target.value])}><option value="">+ add</option>{left.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
      </div>
    </div>
  );
}

export default function CommercePromotions() {
  const data = useLoad('/commerce/promotions');
  const [tab, setTab] = useState('coupons');
  const d = data.data;
  return (
    <section>
      <h1>Promotions</h1>
      <InfoCard title="Coupons, offers, cashback and wallets">
        <ul>
          <li>One coupon per order, typed in New order. Offers apply by themselves and show on the order line; {d && d.settings.offers_with_coupon ? 'they combine with a coupon' : 'an order with an offer takes no coupon'} (Commerce settings &gt; Promotions).</li>
          <li>Offers + coupon + manual discount above {d && d.settings.discount_limit !== null ? `${d.settings.discount_limit}%` : 'the limit'} of the goods wait for approval.</li>
          <li>Cashback goes to the wallet {d && d.settings.cashback_credit_at === 'delivery' ? 'on delivery' : `once the return window (${d ? d.settings.return_window_days : ''} days) has passed`}; a later refund takes it back. Wallet use: at most {d ? d.settings.wallet_max_use_pct : ''}% of an order.</li>
        </ul>
      </InfoCard>
      <div className="a-chips a-tabs" role="tablist" aria-label="Promotions">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <Loading state={data}>
        {d && tab === 'coupons' && <Coupons d={d} reload={data.reload} />}
        {d && tab === 'offers' && <Offers d={d} reload={data.reload} />}
        {d && tab === 'cashback' && <Cashback d={d} reload={data.reload} />}
        {d && tab === 'wallets' && <Wallets d={d} />}
      </Loading>
    </section>
  );
}

// ---------------------------------------------------------------- coupons
const COUPON0 = { code: '', description: '', kind: 'percent', value: '', min_order: '0', max_discount: '', valid_from: '', valid_to: '', total_limit: '', per_customer_limit: '', is_active: true, types: [], customers: [], include: [], exclude: [] };
function couponText(c) {
  const v = c.kind === 'percent' ? `${c.value}% off${c.max_discount !== null ? `, at most ${rs(c.max_discount)}` : ''}` : c.kind === 'fixed' ? `${rs(c.value)} off` : 'Free delivery';
  return `${v}${c.min_order > 0 ? `, from ${rs(c.min_order)}` : ''}`;
}
function Coupons({ d, reload }) {
  const canCreate = useCan('promotions', 'create');
  const canEdit = useCan('promotions', 'edit');
  const act = useAction();
  const [form, setForm] = useState(null); // { ...values, editing }
  const [usage, setUsage] = useState(null);
  const skuOpts = [...d.categories.map((c) => ({ value: `cat:${c}`, label: `Category: ${c}` })), ...d.skus.map((s) => ({ value: s.sku_code, label: `${s.sku_code} - ${s.name} ${s.size_label}` }))];
  const scopeText = (c) => [c.types.length ? `types: ${c.types.join(', ')}` : null, c.customers.length ? `${c.customers.length} customer(s)` : null,
    c.include.length ? `only ${c.include.map((x) => x.replace('cat:', '')).join(', ')}` : null, c.exclude.length ? `not ${c.exclude.map((x) => x.replace('cat:', '')).join(', ')}` : null].filter(Boolean).join('; ') || 'everyone, every SKU';
  const toggle = (c) => act.run(async () => { await api.send('PUT', `/commerce/coupons/${c.code}`, { ...c, is_active: !c.is_active }); reload(); }, `${c.code} switched ${c.is_active ? 'off' : 'on'}`);
  const save = () => act.run(async () => {
    if (form.editing) await api.send('PUT', `/commerce/coupons/${form.code}`, form); else await api.send('POST', '/commerce/coupons', form);
    setForm(null); reload();
  }, `Coupon ${form.code.toUpperCase()} saved`);
  const set = (patch) => setForm({ ...form, ...patch });
  return (
    <>
      {act.note}
      {canCreate && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => setForm({ ...COUPON0 })}>New coupon</button></div>}
      <div className="a-scroll">
        <table className="a-table">
          <thead><tr><th>Code</th><th>Discount</th><th>Who / what</th><th>Valid</th><th className="a-num">Uses</th><th className="a-num">Given</th><th>On</th><th /></tr></thead>
          <tbody>{d.coupons.map((c) => (
            <tr key={c.code} className={c.is_active ? undefined : 'a-offrow'}>
              <td><code>{c.code}</code>{c.description && <small className="a-muted a-person-sub">{c.description}</small>}</td>
              <td>{couponText(c)}</td><td>{scopeText(c)}</td><td>{dates(c)}</td>
              <td className="a-num">{c.uses}{c.total_limit !== null ? ` / ${c.total_limit}` : ''}{c.per_customer_limit !== null && <small className="a-muted a-person-sub">{c.per_customer_limit} per customer</small>}</td>
              <td className="a-num">{rs(c.given)}</td>
              <td>{canEdit ? <button type="button" className={`a-status ${c.is_active ? 'a-ap-approved' : 'a-status-off'}`} onClick={() => toggle(c)}>{c.is_active ? 'On' : 'Off'}</button> : c.is_active ? 'On' : 'Off'}</td>
              <td><span className="a-row"><button type="button" className="a-link" onClick={() => setUsage(c.code)}>Usage</button>{canEdit && <button type="button" className="a-link" onClick={() => setForm({ ...c, value: nz(c.value), min_order: nz(c.min_order), max_discount: nz(c.max_discount), valid_from: c.valid_from || '', valid_to: c.valid_to || '', total_limit: nz(c.total_limit), per_customer_limit: nz(c.per_customer_limit), editing: true })}>Edit</button>}</span></td>
            </tr>
          ))}</tbody>
        </table>
        {!d.coupons.length && <p className="a-muted">No coupon yet.</p>}
      </div>
      {form && (
        <Drawer title={form.editing ? `Coupon ${form.code}` : 'New coupon'} onClose={() => setForm(null)} dirty footer={<button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save coupon</button>}>
          {act.note}
          <div className="a-grid2">
            <label className="a-field"><span>Code</span><input value={form.code} disabled={form.editing} maxLength={20} aria-label="Coupon code" onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></label>
            <label className="a-field"><span>Type</span><select value={form.kind} aria-label="Coupon type" onChange={(e) => set({ kind: e.target.value })}>{Object.entries(d.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {form.kind !== 'free_delivery' && <label className="a-field"><span>{form.kind === 'percent' ? 'Percent off' : 'Amount off (Rs)'}</span><input inputMode="decimal" value={form.value} aria-label="Coupon value" onChange={(e) => set({ value: e.target.value })} /></label>}
            {form.kind === 'percent' && <label className="a-field"><span>At most (Rs, empty = no cap)</span><input inputMode="decimal" value={form.max_discount} aria-label="Coupon cap" onChange={(e) => set({ max_discount: e.target.value })} /></label>}
            <label className="a-field"><span>Minimum order (goods, Rs)</span><input inputMode="decimal" value={form.min_order} aria-label="Coupon minimum order" onChange={(e) => set({ min_order: e.target.value })} /></label>
            <label className="a-field"><span>Valid from</span><input type="date" value={form.valid_from} aria-label="Valid from" onChange={(e) => set({ valid_from: e.target.value })} /></label>
            <label className="a-field"><span>Valid to</span><input type="date" value={form.valid_to} aria-label="Valid to" onChange={(e) => set({ valid_to: e.target.value })} /></label>
            <label className="a-field"><span>Uses in all (empty = no limit)</span><input inputMode="numeric" value={form.total_limit} aria-label="Uses in all" onChange={(e) => set({ total_limit: e.target.value })} /></label>
            <label className="a-field"><span>Uses per customer (empty = no limit)</span><input inputMode="numeric" value={form.per_customer_limit} aria-label="Uses per customer" onChange={(e) => set({ per_customer_limit: e.target.value })} /></label>
          </div>
          <label className="a-field"><span>Description (shown in New order)</span><input value={form.description || ''} maxLength={200} onChange={(e) => set({ description: e.target.value })} /></label>
          <p className="a-muted">Who: no type and no customer = everyone; otherwise a customer of one of the types or one of the named customers.</p>
          <Picker label="Customer types" options={d.types.map((t) => ({ value: t.type_key, label: t.label }))} values={form.types} onChange={(v) => set({ types: v })} />
          <Picker label="Named customers" options={d.customers.map((c) => ({ value: c.customer_id, label: `${c.name} (${c.ctype})` }))} values={form.customers} onChange={(v) => set({ customers: v.map(Number) })} />
          {form.kind !== 'free_delivery' && (
            <>
              <Picker label="Only on (empty = every SKU)" options={skuOpts} values={form.include} onChange={(v) => set({ include: v })} />
              <Picker label="Never on" options={skuOpts} values={form.exclude} onChange={(v) => set({ exclude: v })} />
            </>
          )}
          <label className="a-inline"><input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> On</label>
        </Drawer>
      )}
      {usage && <UsageDrawer code={usage} onClose={() => setUsage(null)} />}
    </>
  );
}
function UsageDrawer({ code, onClose }) {
  const u = useLoad(`/commerce/coupons/${code}/usage`);
  return (
    <Drawer title={`Coupon ${code}: usage`} onClose={onClose}>
      <Loading state={u}>
        {u.data && (u.data.length ? (
          <table className="a-table"><thead><tr><th>Order</th><th>Customer</th><th className="a-num">Discount</th><th>When</th></tr></thead>
            <tbody>{u.data.map((r) => (
              <tr key={r.id} className={r.status === 'active' ? undefined : 'a-offrow'}><td><code>{r.order_no}</code><small className="a-muted a-person-sub">{r.order_status.replace(/_/g, ' ')}{r.status === 'released' ? ' - given back' : ''}</small></td>
                <td>{r.customer}<small className="a-muted a-person-sub">{r.ctype}</small></td><td className="a-num">{rs(r.amount)}</td><td>{fmtDate(r.created_at)}</td></tr>
            ))}</tbody></table>
        ) : <p className="a-muted">Not used yet.</p>)}
      </Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------- offers
const OFFER0 = { name: '', kind: 'slab', target: '', min_qty: '', min_unit: 'carton', pct: '', buy_qty: '', get_qty: '', get_sku_code: '', valid_from: '', valid_to: '', is_active: true, types: [] };
function Offers({ d, reload }) {
  const canCreate = useCan('promotions', 'create');
  const canEdit = useCan('promotions', 'edit');
  const act = useAction();
  const [form, setForm] = useState(null);
  const set = (patch) => setForm({ ...form, ...patch });
  const targetOf = (o) => (o.sku_code ? o.sku_code : `cat:${o.category_key}`);
  const toForm = (o) => ({ ...o, target: targetOf(o), min_qty: nz(o.min_qty), pct: nz(o.pct), buy_qty: nz(o.buy_qty), get_qty: nz(o.get_qty), get_sku_code: o.get_sku_code || '', valid_from: o.valid_from || '', valid_to: o.valid_to || '', editing: true });
  const save = () => act.run(async () => {
    if (form.editing) await api.send('PUT', `/commerce/offers/${form.offer_id}`, form); else await api.send('POST', '/commerce/offers', form);
    setForm(null); reload();
  }, `Offer "${form.name}" saved`);
  const toggle = (o) => act.run(async () => { await api.send('PUT', `/commerce/offers/${o.offer_id}`, { ...toForm(o), is_active: !o.is_active }); reload(); }, `${o.name} switched ${o.is_active ? 'off' : 'on'}`);
  return (
    <>
      {act.note}
      {canCreate && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => setForm({ ...OFFER0 })}>New offer</button></div>}
      <div className="a-scroll">
        <table className="a-table">
          <thead><tr><th>Offer</th><th>On</th><th>Rule</th><th>Customer types</th><th>Valid</th><th className="a-num">Orders</th><th>On / off</th><th /></tr></thead>
          <tbody>{d.offers.map((o) => (
            <tr key={o.offer_id} className={o.is_active ? undefined : 'a-offrow'}>
              <td>{o.name}<small className="a-muted a-person-sub">{d.offerKinds[o.kind]}</small></td><td>{o.sku_code ? <code>{o.sku_code}</code> : `category ${o.category_key}`}</td>
              <td>{o.text}</td><td>{o.types.length ? o.types.join(', ') : 'all'}</td><td>{dates(o)}</td><td className="a-num">{o.orders}</td>
              <td>{canEdit ? <button type="button" className={`a-status ${o.is_active ? 'a-ap-approved' : 'a-status-off'}`} onClick={() => toggle(o)}>{o.is_active ? 'On' : 'Off'}</button> : o.is_active ? 'On' : 'Off'}</td>
              <td>{canEdit && <button type="button" className="a-link" onClick={() => setForm(toForm(o))}>Edit</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!d.offers.length && <p className="a-muted">No offer yet.</p>}
      </div>
      {form && (
        <Drawer title={form.editing ? `Offer: ${form.name}` : 'New offer'} onClose={() => setForm(null)} dirty footer={<button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save offer</button>}>
          {act.note}
          <label className="a-field"><span>Name (shown on the order line)</span><input value={form.name} maxLength={120} aria-label="Offer name" onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="a-grid2">
            <label className="a-field"><span>Type</span><select value={form.kind} aria-label="Offer type" onChange={(e) => set({ kind: e.target.value })}>{Object.entries(d.offerKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="a-field"><span>On</span><select value={form.target} aria-label="Offer on" onChange={(e) => set({ target: e.target.value })}><option value="">Choose...</option>
              {d.categories.map((c) => <option key={c} value={`cat:${c}`}>Category: {c}</option>)}{d.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.sku_code} - {s.name} {s.size_label}</option>)}</select></label>
            {form.kind === 'slab' ? (
              <>
                <label className="a-field"><span>From (quantity)</span><span className="a-row"><input inputMode="numeric" className="a-qty" value={form.min_qty} aria-label="From quantity" onChange={(e) => set({ min_qty: e.target.value })} />
                  <select value={form.min_unit} aria-label="Unit" onChange={(e) => set({ min_unit: e.target.value })}><option value="carton">cartons</option><option value="pack">packs</option></select></span></label>
                <label className="a-field"><span>Percent off the line</span><input inputMode="decimal" value={form.pct} aria-label="Percent off" onChange={(e) => set({ pct: e.target.value })} /></label>
              </>
            ) : (
              <>
                <label className="a-field"><span>For every (packs bought)</span><input inputMode="numeric" value={form.buy_qty} aria-label="Buy packs" onChange={(e) => set({ buy_qty: e.target.value })} /></label>
                <label className="a-field"><span>Free (packs)</span><input inputMode="numeric" value={form.get_qty} aria-label="Free packs" onChange={(e) => set({ get_qty: e.target.value })} /></label>
                <label className="a-field"><span>Free SKU (empty = the same SKU)</span><input list="promo-skus" value={form.get_sku_code} aria-label="Free SKU" onChange={(e) => set({ get_sku_code: e.target.value.toUpperCase() })} /></label>
              </>
            )}
            <label className="a-field"><span>Valid from</span><input type="date" value={form.valid_from} onChange={(e) => set({ valid_from: e.target.value })} /></label>
            <label className="a-field"><span>Valid to</span><input type="date" value={form.valid_to} onChange={(e) => set({ valid_to: e.target.value })} /></label>
          </div>
          <datalist id="promo-skus">{d.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.name}</option>)}</datalist>
          <Picker label="Customer types (empty = all)" options={d.types.map((t) => ({ value: t.type_key, label: t.label }))} values={form.types} onChange={(v) => set({ types: v })} />
          <label className="a-inline"><input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> On</label>
        </Drawer>
      )}
    </>
  );
}

// ---------------------------------------------------------------- cashback
const RULE0 = { name: '', type_key: '', pct: '', min_order: '0', max_per_order: '', valid_from: '', valid_to: '', is_active: true };
function Cashback({ d, reload }) {
  const canCreate = useCan('promotions', 'create');
  const canEdit = useCan('promotions', 'edit');
  const act = useAction();
  const [form, setForm] = useState(null);
  const [ran, setRan] = useState(null);
  const set = (patch) => setForm({ ...form, ...patch });
  const toForm = (r) => ({ ...r, type_key: r.type_key || '', pct: nz(r.pct), min_order: nz(r.min_order), max_per_order: nz(r.max_per_order), valid_from: r.valid_from || '', valid_to: r.valid_to || '', editing: true });
  const save = () => act.run(async () => {
    if (form.editing) await api.send('PUT', `/commerce/cashback-rules/${form.rule_id}`, form); else await api.send('POST', '/commerce/cashback-rules', form);
    setForm(null); reload();
  }, `Rule "${form.name}" saved`);
  const toggle = (r) => act.run(async () => { await api.send('PUT', `/commerce/cashback-rules/${r.rule_id}`, { ...toForm(r), is_active: !r.is_active }); reload(); }, `${r.name} switched ${r.is_active ? 'off' : 'on'}`);
  const run = () => act.run(async () => { setRan(await api.send('POST', '/commerce/promotions/run-jobs')); reload(); });
  const typeLabel = (k) => (k ? (d.types.find((t) => t.type_key === k) || { label: k }).label : 'All types');
  return (
    <>
      {act.note}
      <p className="a-muted">Credited {d.settings.cashback_credit_at === 'delivery' ? 'on delivery' : `once the return window (${d.settings.return_window_days} days after delivery) has passed`}, on the goods value before GST after discounts and returns.
        Cashback in the wallet expires after {d.settings.expiry.cashback || 'no'} days; refunds {d.settings.expiry.refund ? `after ${d.settings.expiry.refund} days` : 'never'}. Under GST it is used as a {d.settings.gst === 'payment' ? 'payment' : 'discount on the next invoice'} (Commerce settings).</p>
      <div className="a-toolbar">
        {canCreate && <button type="button" className="a-btn" onClick={() => setForm({ ...RULE0 })}>New rule</button>}
        {canEdit && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={run}>Run now (expiry and due cashback)</button>}
      </div>
      {ran && <Notice kind="ok" onClose={() => setRan(null)}>Run now: {ran.cashback.length ? ran.cashback.map((x) => `${x.order_no} ${x.amount > 0 ? rs(x.amount) : 'no cashback'}`).join(', ') : 'no order due for cashback'}; {ran.expired.length} wallet credit(s) expired.</Notice>}
      <div className="a-scroll">
        <table className="a-table">
          <thead><tr><th>Rule</th><th>Customer type</th><th className="a-num">Cashback</th><th className="a-num">Min. order</th><th className="a-num">Max. per order</th><th>Valid</th><th>On</th><th /></tr></thead>
          <tbody>{d.rules.map((r) => (
            <tr key={r.rule_id} className={r.is_active ? undefined : 'a-offrow'}>
              <td>{r.name}</td><td>{typeLabel(r.type_key)}</td><td className="a-num">{r.pct}%</td><td className="a-num">{r.min_order ? rs(r.min_order) : '-'}</td><td className="a-num">{r.max_per_order !== null ? rs(r.max_per_order) : 'no max'}</td><td>{dates(r)}</td>
              <td>{canEdit ? <button type="button" className={`a-status ${r.is_active ? 'a-ap-approved' : 'a-status-off'}`} onClick={() => toggle(r)}>{r.is_active ? 'On' : 'Off'}</button> : r.is_active ? 'On' : 'Off'}</td>
              <td>{canEdit && <button type="button" className="a-link" onClick={() => setForm(toForm(r))}>Edit</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!d.rules.length && <p className="a-muted">No cashback rule: no cashback is given.</p>}
      </div>
      {form && (
        <Drawer title={form.editing ? `Rule: ${form.name}` : 'New cashback rule'} onClose={() => setForm(null)} dirty footer={<button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save rule</button>}>
          {act.note}
          <label className="a-field"><span>Name</span><input value={form.name} maxLength={120} aria-label="Rule name" onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="a-grid2">
            <label className="a-field"><span>Customer type</span><select value={form.type_key} aria-label="Rule customer type" onChange={(e) => set({ type_key: e.target.value })}><option value="">All types</option>{d.types.map((t) => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}</select></label>
            <label className="a-field"><span>Cashback (%)</span><input inputMode="decimal" value={form.pct} aria-label="Cashback percent" onChange={(e) => set({ pct: e.target.value })} /></label>
            <label className="a-field"><span>Minimum order (goods, Rs)</span><input inputMode="decimal" value={form.min_order} aria-label="Rule minimum" onChange={(e) => set({ min_order: e.target.value })} /></label>
            <label className="a-field"><span>At most per order (Rs, empty = no max)</span><input inputMode="decimal" value={form.max_per_order} aria-label="Rule maximum" onChange={(e) => set({ max_per_order: e.target.value })} /></label>
            <label className="a-field"><span>Valid from</span><input type="date" value={form.valid_from} onChange={(e) => set({ valid_from: e.target.value })} /></label>
            <label className="a-field"><span>Valid to</span><input type="date" value={form.valid_to} onChange={(e) => set({ valid_to: e.target.value })} /></label>
          </div>
          <label className="a-inline"><input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> On</label>
        </Drawer>
      )}
    </>
  );
}

// ---------------------------------------------------------------- wallets
function Wallets({ d }) {
  const [cid, setCid] = useState('');
  return (
    <>
      <label className="a-field"><span>Customer</span><select value={cid} aria-label="Wallet customer" onChange={(e) => setCid(e.target.value)}><option value="">Choose...</option>{d.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name} ({c.ctype})</option>)}</select></label>
      {cid && <WalletPanel key={cid} customerId={cid} />}
    </>
  );
}
