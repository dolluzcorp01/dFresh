// Marketing (phase 22, v23 viewOffers / viewCoupons / viewCbRules / viewWallets and their drawers; API /commerce/promotions,
// /commerce/{offers|coupons|cashback-rules}[/:id[/send|/stop]], /marketing/wallets; rules in promotions.js).
// Offers, coupons and cashback rules each have tabs Live / Waiting for approval / Drafts and later (draft, starts later,
// sent back) / Ended. A new one is sent for approval at once (or kept as a draft) and goes live only when every rule
// it needs is signed ("New offer or coupon goes live", "Offer or coupon below cost", "New cashback rule goes live").
// A live one changed to give more (bigger %, lower minimum, longer, wider) is signed again; it stops applying until
// then. Stop ends one; orders already made keep it. Customer wallets: usable, pending (cashback still in the return
// window), running out in 30 days and kept for open orders, per customer of the godowns one works at; a row opens the
// statement with the manual credit or debit (approval as the Commerce setting says).
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useConfirm, useLoad, useToast } from './ui';
import { Picker, UsageDrawer, couponText } from './CommercePromotions';
import WalletPanel from './WalletPanel';

const GROUPS = [['live', 'Live', ['live']], ['waiting', 'Waiting for approval', ['waiting']], ['later', 'Drafts and later', ['draft', 'scheduled', 'rejected']], ['ended', 'Ended', ['ended']]];
const TONE = { live: 'good', waiting: 'warn', draft: 'gray', scheduled: 'info', rejected: 'bad', ended: 'gray' };
const nz = (v) => (v === null || v === undefined ? '' : String(v));
const dates = (x) => `${x.valid_from || 'any time'} to ${x.valid_to || 'no end'}`;

/** status tabs over `shown` (the ?tab= of the address) */
function useGroup(rows) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = new URLSearchParams(location.search).get('tab');
  const g = GROUPS.some(([k]) => k === t) ? t : 'live';
  const of = (k) => (rows || []).filter((r) => GROUPS.find((x) => x[0] === k)[2].includes(r.shown));
  return { group: g, list: of(g), tabs: GROUPS.map(([key, label]) => ({ key, label, count: of(key).length })), set: (k) => navigate(`${location.pathname}?tab=${k}`) };
}
function StatusPill({ x, labels }) {
  return <><Pill tone={TONE[x.shown]}>{labels[x.shown] || x.shown}</Pill>{x.shown === 'rejected' && x.rej_note && <small className="a-muted a-p15-sub">{x.rej_note}</small>}</>;
}
/** the waiting approvals and the Stop / Send buttons of the drawer of one offer, coupon or rule */
function Lifecycle({ x, path, labels, can, onDone }) {
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const send = () => act.run(async () => { const r = await api.send('POST', `${path}/send`); toast(r.status === 'live' ? 'good' : 'warn', r.status === 'live' ? 'Live' : 'Sent for approval', r.message); onDone(); });
  const stop = async () => {
    if (!(await confirm({ title: 'Stop it now?', message: 'It ends today: no new order gets it. Orders already made keep it.', action: 'Stop', danger: true }))) return;
    act.run(async () => { const r = await api.send('POST', `${path}/stop`); toast('good', 'Stopped', r.message); onDone(); });
  };
  return (
    <>
      {act.note}
      <dl className="a-dl"><div><dt>Status</dt><dd><StatusPill x={x} labels={labels} /></dd></div></dl>
      {x.waiting.length > 0 && <Alert tone="warn" title="Waiting for approval.">{x.waiting.map((w) => `#${w.approval_id} ${w.label}: ${w.summary}`).join('; ')}</Alert>}
      <span className="a-row">
        {can.create && ['draft', 'rejected'].includes(x.status) && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={send}><LIcon name="send" size="sm" />Send for approval</button>}
        {can.edit && ['live', 'waiting'].includes(x.status) && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={stop}>Stop</button>}
      </span>
    </>
  );
}
function promoPage(d) {
  return d && d.settings.offers_with_coupon ? 'Offers and a coupon can go on one order (Commerce settings)' : 'No coupon on an order that has an offer (Commerce settings)';
}

// ---------------------------------------------------------------------------------------------------------------- Offers
const OFFER0 = { name: '', kind: 'slab', target: '', min_qty: '', min_unit: 'carton', pct: '', buy_qty: '', get_qty: '', get_sku_code: '', valid_from: '', valid_to: '', is_active: true, types: [], customers: [], with_coupon: '', budget: '' };
export function Offers() {
  const data = useLoad('/commerce/promotions');
  const d = data.data;
  const g = useGroup(d && d.offers);
  const [form, setForm] = useState(null);
  const typeName = (k) => ((d && d.types.find((t) => t.type_key === k)) || { label: k }).label;
  const who = (o) => [o.types.length ? o.types.map(typeName).join(', ') : null, o.customers.length ? o.customers.map((c) => c.name).join(', ') : null].filter(Boolean).join('; ') || 'Everyone';
  const cols = [
    { key: 'name', label: 'Offer', sort: true, render: (o) => <><b>{o.name}</b><small className="a-muted a-p15-sub"><span className="a-mono">#{o.offer_id}</span> · {dates(o)}</small></> },
    { key: 'what', label: 'What', hideSm: true, render: (o) => <>{o.text}<small className="a-muted a-p15-sub">{o.sku_code || `category ${o.category_key}`}</small></> },
    { key: 'who', label: 'For', hideSm: true, render: who },
    { key: 'given', label: 'Given', num: true, sort: true, render: (o) => <>{money(o.given)}{o.budget !== null && <small className="a-muted a-p15-sub">of {money(o.budget)}</small>}<small className="a-muted a-p15-sub">{o.orders} order{o.orders === 1 ? '' : 's'}{o.free_packs ? `, ${o.free_packs} free` : ''}</small></> },
    { key: 'status', label: 'Status', render: (o) => <StatusPill x={o} labels={d.statusLabels} /> },
  ];
  const toForm = (o) => ({ ...o, target: o.sku_code ? o.sku_code : `cat:${o.category_key}`, min_qty: nz(o.min_qty), pct: nz(o.pct), buy_qty: nz(o.buy_qty), get_qty: nz(o.get_qty), get_sku_code: o.get_sku_code || '', valid_from: o.valid_from || '', valid_to: o.valid_to || '',
    customers: o.customers.map((c) => c.customer_id), with_coupon: o.with_coupon === null ? '' : o.with_coupon ? '1' : '0', budget: nz(o.budget), editing: true });
  return (
    <section>
      <PageHead sub="Offers that apply by themselves on orders" rules={['Applies by itself on orders', promoPage(d), 'Goes live once approved']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setForm({ ...OFFER0 })}><LIcon name="plus" size="sm" />New offer</button>} />
      <Loading state={data}>{d && <>
        <Tabs label="Offers" value={g.group} onChange={g.set} tabs={g.tabs} />
        <div className="a-listcard"><Table columns={cols} rows={g.list} rowKey={(o) => o.offer_id} label="Offers" onRowClick={(o) => setForm(toForm(o))} empty={{ icon: 'gift', title: 'Nothing here', text: 'No offer in this list.' }} /></div>
      </>}</Loading>
      {form && <OfferDrawer d={d} form={form} setForm={setForm} onDone={() => { setForm(null); data.reload(); }} />}
    </section>
  );
}
function OfferDrawer({ d, form, setForm, onDone }) {
  const act = useAction();
  const toast = useToast();
  const set = (patch) => setForm({ ...form, ...patch });
  const x = form.editing ? d.offers.find((o) => o.offer_id === form.offer_id) : null;
  const canChange = x ? (['draft', 'rejected'].includes(x.status) ? d.can.create : x.status === 'live' && d.can.edit) : d.can.create;
  const body = () => ({ ...form, with_coupon: form.with_coupon === '' ? null : form.with_coupon === '1' });
  const save = (draft) => act.run(async () => {
    const r = form.editing ? await api.send('PUT', `/commerce/offers/${form.offer_id}`, { ...body(), send: !draft }) : await api.send('POST', '/commerce/offers', { ...body(), draft });
    toast(r.status === 'live' ? 'good' : r.status === 'waiting' ? 'warn' : 'info', `Offer "${form.name}" saved`, r.message); onDone();
  });
  return (
    <Drawer title={form.editing ? `Offer: ${form.name}` : 'New offer'} onClose={() => setForm(null)} dirty={canChange} wide
      footer={canChange && <span className="a-row">
        {(!x || ['draft', 'rejected'].includes(x.status)) && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => save(true)}>Save as draft</button>}
        <button type="button" className="a-btn" disabled={act.busy} onClick={() => save(false)}>{x && x.status === 'live' ? 'Save' : 'Save and send for approval'}</button></span>}>
      {act.note}
      {x && <Lifecycle x={x} path={`/commerce/offers/${x.offer_id}`} labels={d.statusLabels} can={d.can} onDone={onDone} />}
      {x && x.status === 'live' && canChange && <p className="a-hint-s">A change that gives more (bigger %, more free packs, longer, more customers, a bigger budget) is signed again and stops applying until then.</p>}
      <fieldset disabled={!canChange} className="a-plain">
        <label className="a-field"><span>Name (shown on the order line)</span><input value={form.name} maxLength={120} aria-label="Offer name" onChange={(e) => set({ name: e.target.value })} /></label>
        <div className="a-grid2">
          <label className="a-field"><span>Type</span><select value={form.kind} aria-label="Offer type" onChange={(e) => set({ kind: e.target.value })}>{Object.entries(d.offerKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="a-field"><span>On</span><select value={form.target} aria-label="Offer on" onChange={(e) => set({ target: e.target.value })}><option value="">Choose...</option>
            {d.categories.map((c) => <option key={c} value={`cat:${c}`}>Category: {c}</option>)}{d.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.sku_code} - {s.name} {s.size_label}</option>)}</select></label>
          {form.kind === 'slab' ? <>
            <label className="a-field"><span>From (quantity)</span><span className="a-row"><input inputMode="numeric" className="a-qty" value={form.min_qty} aria-label="From quantity" onChange={(e) => set({ min_qty: e.target.value })} />
              <select value={form.min_unit} aria-label="Unit" onChange={(e) => set({ min_unit: e.target.value })}><option value="carton">cartons</option><option value="pack">packs</option></select></span></label>
            <label className="a-field"><span>Percent off the line</span><input inputMode="decimal" value={form.pct} aria-label="Percent off" onChange={(e) => set({ pct: e.target.value })} /></label>
          </> : <>
            <label className="a-field"><span>For every (packs bought)</span><input inputMode="numeric" value={form.buy_qty} aria-label="Buy packs" onChange={(e) => set({ buy_qty: e.target.value })} /></label>
            <label className="a-field"><span>Free (packs)</span><input inputMode="numeric" value={form.get_qty} aria-label="Free packs" onChange={(e) => set({ get_qty: e.target.value })} /></label>
            <label className="a-field"><span>Free SKU (empty = the same SKU)</span><input list="mk-skus" value={form.get_sku_code} aria-label="Free SKU" onChange={(e) => set({ get_sku_code: e.target.value.toUpperCase() })} /></label>
          </>}
          <label className="a-field"><span>Valid from</span><input type="date" value={form.valid_from} aria-label="Valid from" onChange={(e) => set({ valid_from: e.target.value })} /></label>
          <label className="a-field"><span>Valid to</span><input type="date" value={form.valid_to} aria-label="Valid to" onChange={(e) => set({ valid_to: e.target.value })} /></label>
          <label className="a-field"><span>With a coupon on the same order</span><select value={form.with_coupon} aria-label="With a coupon" onChange={(e) => set({ with_coupon: e.target.value })}>
            <option value="">As the Commerce setting ({d.settings.offers_with_coupon ? 'yes' : 'no'})</option><option value="1">Yes, a coupon can be added</option><option value="0">No coupon with this offer</option></select></label>
          <label className="a-field"><span>Budget (Rs given in all, empty = no limit)</span><input inputMode="decimal" value={form.budget} aria-label="Offer budget" onChange={(e) => set({ budget: e.target.value })} /></label>
        </div>
        <datalist id="mk-skus">{d.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.name}</option>)}</datalist>
        <p className="a-hint-s">Who: no type and no customer = everyone; otherwise a customer of one of the types or one of the named customers.</p>
        <Picker label="Customer types" options={d.types.map((t) => ({ value: t.type_key, label: t.label }))} values={form.types} onChange={(v) => set({ types: v })} />
        <Picker label="Named customers" options={d.customers.map((c) => ({ value: String(c.customer_id), label: `${c.name} (${c.ctype})` }))} values={form.customers.map(String)} onChange={(v) => set({ customers: v.map(Number) })} />
      </fieldset>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Coupons
const COUPON0 = { code: '', description: '', kind: 'percent', value: '', min_order: '0', max_discount: '', valid_from: '', valid_to: '', total_limit: '', per_customer_limit: '', is_active: true, types: [], customers: [], include: [], exclude: [] };
export function Coupons() {
  const data = useLoad('/commerce/promotions');
  const d = data.data;
  const g = useGroup(d && d.coupons);
  const [form, setForm] = useState(null);
  const [usage, setUsage] = useState(null);
  const cols = [
    { key: 'code', label: 'Code', sort: true, render: (c) => <><b className="a-mono">{c.code}</b><small className="a-muted a-p15-sub">{dates(c)}</small></> },
    { key: 'gives', label: 'Gives', render: (c) => <>{couponText(c)}{c.description && <small className="a-muted a-p15-sub">{c.description}</small>}</> },
    { key: 'uses', label: 'Used', num: true, sort: true, render: (c) => <>{c.uses}{c.total_limit !== null ? ` of ${c.total_limit}` : ''}<small className="a-muted a-p15-sub">{c.per_customer_limit !== null ? `${c.per_customer_limit} a customer` : 'no limit a customer'}</small></> },
    { key: 'given', label: 'Given', num: true, hideSm: true, sort: true, render: (c) => money(c.given) },
    { key: 'status', label: 'Status', render: (c) => <StatusPill x={c} labels={d.statusLabels} /> },
  ];
  const toForm = (c) => ({ ...c, value: nz(c.value), min_order: nz(c.min_order), max_discount: nz(c.max_discount), valid_from: c.valid_from || '', valid_to: c.valid_to || '', total_limit: nz(c.total_limit), per_customer_limit: nz(c.per_customer_limit), editing: true });
  return (
    <section>
      <PageHead sub="Discount codes typed on an order" rules={['Typed on the order (website in stage 3)', 'One coupon per order', 'Goes live once approved; above the discount limit it is signed again']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setForm({ ...COUPON0 })}><LIcon name="plus" size="sm" />New coupon</button>} />
      <Loading state={data}>{d && <>
        <Tabs label="Coupons" value={g.group} onChange={g.set} tabs={g.tabs} />
        <div className="a-listcard"><Table columns={cols} rows={g.list} rowKey={(c) => c.code} label="Coupons" onRowClick={(c) => setForm(toForm(c))} empty={{ icon: 'tag', title: 'Nothing here', text: 'No coupon in this list.' }} /></div>
      </>}</Loading>
      {form && <CouponDrawer d={d} form={form} setForm={setForm} onUsage={setUsage} onDone={() => { setForm(null); data.reload(); }} />}
      {usage && <UsageDrawer code={usage} onClose={() => setUsage(null)} />}
    </section>
  );
}
function CouponDrawer({ d, form, setForm, onUsage, onDone }) {
  const act = useAction();
  const toast = useToast();
  const set = (patch) => setForm({ ...form, ...patch });
  const x = form.editing ? d.coupons.find((c) => c.code === form.code) : null;
  const canChange = x ? (['draft', 'rejected'].includes(x.status) ? d.can.create : x.status === 'live' && d.can.edit) : d.can.create;
  const skuOpts = [...d.categories.map((c) => ({ value: `cat:${c}`, label: `Category: ${c}` })), ...d.skus.map((s) => ({ value: s.sku_code, label: `${s.sku_code} - ${s.name} ${s.size_label}` }))];
  const save = (draft) => act.run(async () => {
    const r = form.editing ? await api.send('PUT', `/commerce/coupons/${form.code}`, { ...form, send: !draft }) : await api.send('POST', '/commerce/coupons', { ...form, draft });
    toast(r.status === 'live' ? 'good' : r.status === 'waiting' ? 'warn' : 'info', `Coupon ${form.code.toUpperCase()} saved`, r.message); onDone();
  });
  return (
    <Drawer title={form.editing ? `Coupon ${form.code}` : 'New coupon'} onClose={() => setForm(null)} dirty={canChange} wide
      footer={canChange && <span className="a-row">
        {(!x || ['draft', 'rejected'].includes(x.status)) && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => save(true)}>Save as draft</button>}
        <button type="button" className="a-btn" disabled={act.busy} onClick={() => save(false)}>{x && x.status === 'live' ? 'Save' : 'Save and send for approval'}</button></span>}>
      {act.note}
      {x && <Lifecycle x={x} path={`/commerce/coupons/${x.code}`} labels={d.statusLabels} can={d.can} onDone={onDone} />}
      {x && <p><button type="button" className="a-link" onClick={() => onUsage(x.code)}>Usage ({x.uses})</button></p>}
      <fieldset disabled={!canChange} className="a-plain">
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
        <label className="a-field"><span>Description (shown in New order)</span><input value={form.description || ''} maxLength={200} aria-label="Coupon description" onChange={(e) => set({ description: e.target.value })} /></label>
        <p className="a-hint-s">Who: no type and no customer = everyone; otherwise a customer of one of the types or one of the named customers.</p>
        <Picker label="Customer types" options={d.types.map((t) => ({ value: t.type_key, label: t.label }))} values={form.types} onChange={(v) => set({ types: v })} />
        <Picker label="Named customers" options={d.customers.map((c) => ({ value: String(c.customer_id), label: `${c.name} (${c.ctype})` }))} values={form.customers.map(String)} onChange={(v) => set({ customers: v.map(Number) })} />
        {form.kind !== 'free_delivery' && <>
          <Picker label="Only on (empty = every SKU)" options={skuOpts} values={form.include} onChange={(v) => set({ include: v })} />
          <Picker label="Never on" options={skuOpts} values={form.exclude} onChange={(v) => set({ exclude: v })} />
        </>}
      </fieldset>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Cashback rules
const RULE0 = { name: '', type_key: '', pct: '', min_order: '0', max_per_order: '', valid_from: '', valid_to: '', is_active: true };
export function CashbackRules() {
  const data = useLoad('/commerce/promotions');
  const d = data.data;
  const g = useGroup(d && d.rules);
  const [form, setForm] = useState(null);
  const act = useAction();
  const toast = useToast();
  const typeLabel = (k) => (k ? ((d && d.types.find((t) => t.type_key === k)) || { label: k }).label : 'All types');
  const cols = [
    { key: 'name', label: 'Rule', sort: true, render: (r) => <><b>{r.name}</b><small className="a-muted a-p15-sub"><span className="a-mono">#{r.rule_id}</span> · {dates(r)}</small></> },
    { key: 'gives', label: 'Gives', hideSm: true, render: (r) => <>{r.pct}% back{r.max_per_order !== null ? `, at most ${money(r.max_per_order)}` : ''}<small className="a-muted a-p15-sub">{r.min_order ? `from ${money(r.min_order)} of goods` : 'any order'}</small></> },
    { key: 'who', label: 'For', hideSm: true, render: (r) => typeLabel(r.type_key) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill x={r} labels={d.statusLabels} /> },
  ];
  const run = () => act.run(async () => { const r = await api.send('POST', '/commerce/promotions/run-jobs'); toast('good', 'Run now', `${r.cashback.length ? r.cashback.map((x) => `${x.order_no} ${x.amount > 0 ? money(x.amount) : 'no cashback'}`).join(', ') : 'No order due for cashback'}; ${r.expired.length} wallet credit(s) expired.`); data.reload(); });
  const toForm = (r) => ({ ...r, type_key: r.type_key || '', pct: nz(r.pct), min_order: nz(r.min_order), max_per_order: nz(r.max_per_order), valid_from: r.valid_from || '', valid_to: r.valid_to || '', editing: true });
  return (
    <section>
      <PageHead sub="A % of the goods back as wallet credit" rules={['Earned on the goods, without GST', `Credited ${d && d.settings.cashback_credit_at === 'delivery' ? 'on delivery' : 'after the return window'}`, 'Goes live once approved']}
        actions={d && <span className="a-row">{d.can.edit && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={run}>Run now</button>}
          {d.can.create && <button type="button" className="a-btn" onClick={() => setForm({ ...RULE0 })}><LIcon name="plus" size="sm" />New rule</button>}</span>} />
      {act.note}
      <Loading state={data}>{d && <>
        {!d.settings.wallet_on && <WalletOff />}
        <Alert tone="info" title="A return can take it back.">If a return takes the goods under the rule&apos;s minimum, all of that order&apos;s cashback is taken back; otherwise its share.</Alert>
        <Tabs label="Cashback rules" value={g.group} onChange={g.set} tabs={g.tabs} />
        <div className="a-listcard"><Table columns={cols} rows={g.list} rowKey={(r) => r.rule_id} label="Cashback rules" onRowClick={(r) => setForm(toForm(r))} empty={{ icon: 'wallet', title: 'Nothing here', text: 'No rule in this list.' }} /></div>
      </>}</Loading>
      {form && <RuleDrawer d={d} form={form} setForm={setForm} onDone={() => { setForm(null); data.reload(); }} />}
    </section>
  );
}
function RuleDrawer({ d, form, setForm, onDone }) {
  const act = useAction();
  const toast = useToast();
  const set = (patch) => setForm({ ...form, ...patch });
  const x = form.editing ? d.rules.find((r) => r.rule_id === form.rule_id) : null;
  const canChange = x ? (['draft', 'rejected'].includes(x.status) ? d.can.create : x.status === 'live' && d.can.edit) : d.can.create;
  const save = (draft) => act.run(async () => {
    const r = form.editing ? await api.send('PUT', `/commerce/cashback-rules/${form.rule_id}`, { ...form, send: !draft }) : await api.send('POST', '/commerce/cashback-rules', { ...form, draft });
    toast(r.status === 'live' ? 'good' : r.status === 'waiting' ? 'warn' : 'info', `Rule "${form.name}" saved`, r.message); onDone();
  });
  return (
    <Drawer title={form.editing ? `Rule: ${form.name}` : 'New cashback rule'} onClose={() => setForm(null)} dirty={canChange}
      footer={canChange && <span className="a-row">
        {(!x || ['draft', 'rejected'].includes(x.status)) && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => save(true)}>Save as draft</button>}
        <button type="button" className="a-btn" disabled={act.busy} onClick={() => save(false)}>{x && x.status === 'live' ? 'Save' : 'Save and send for approval'}</button></span>}>
      {act.note}
      {x && <Lifecycle x={x} path={`/commerce/cashback-rules/${x.rule_id}`} labels={d.statusLabels} can={d.can} onDone={onDone} />}
      {x && x.status === 'live' && canChange && <p className="a-hint-s">A looser rule (more %, lower minimum, higher cap, longer, more customers) is signed again and stops until then.</p>}
      <fieldset disabled={!canChange} className="a-plain">
        <label className="a-field"><span>Name</span><input value={form.name} maxLength={120} aria-label="Rule name" onChange={(e) => set({ name: e.target.value })} /></label>
        <div className="a-grid2">
          <label className="a-field"><span>Customer type</span><select value={form.type_key} aria-label="Rule customer type" onChange={(e) => set({ type_key: e.target.value })}><option value="">All types</option>{d.types.map((t) => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}</select></label>
          <label className="a-field"><span>Cashback (%)</span><input inputMode="decimal" value={form.pct} aria-label="Cashback percent" onChange={(e) => set({ pct: e.target.value })} /></label>
          <label className="a-field"><span>Minimum order (goods, Rs)</span><input inputMode="decimal" value={form.min_order} aria-label="Rule minimum" onChange={(e) => set({ min_order: e.target.value })} /></label>
          <label className="a-field"><span>At most per order (Rs, empty = no max)</span><input inputMode="decimal" value={form.max_per_order} aria-label="Rule maximum" onChange={(e) => set({ max_per_order: e.target.value })} /></label>
          <label className="a-field"><span>Valid from</span><input type="date" value={form.valid_from} aria-label="Valid from" onChange={(e) => set({ valid_from: e.target.value })} /></label>
          <label className="a-field"><span>Valid to</span><input type="date" value={form.valid_to} aria-label="Valid to" onChange={(e) => set({ valid_to: e.target.value })} /></label>
        </div>
        <p className="a-hint-s">Cashback in the wallet expires after {d.settings.expiry.cashback || 'no'} days; it can pay at most {d.settings.wallet_max_use_pct}% of an order (Commerce settings).</p>
      </fieldset>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Customer wallets
/** v23 wOffBox: the wallet switch is off (balances stay saved) */
function WalletOff() {
  return <Alert tone="warn" title="The wallet is off.">Admin &gt; Switches &gt; Money: "Customer wallet and cashback on". While it is off, orders take no wallet and no cashback is earned; the balances below stay saved.</Alert>;
}
export function CustomerWallets() {
  const data = useLoad('/marketing/wallets');
  const d = data.data;
  const act = useAction();
  const exportCsv = () => act.run(async () => { await api.download('/marketing/wallets.csv', 'dfresh-wallets.csv'); });
  const [open, setOpen] = useState(null);
  const cols = [
    { key: 'name', label: 'Customer', sort: true, render: (c) => <><b>{c.name}</b><small className="a-muted a-p15-sub">{c.customer_no}</small></> },
    { key: 'usable', label: 'Usable', num: true, sort: true, render: (c) => <><b>{money(c.usable)}</b>{c.kept > 0.004 && <small className="a-muted a-p15-sub">{money(c.kept)} kept for open orders</small>}</> },
    { key: 'pending', label: 'Pending', num: true, sort: true, render: (c) => money(c.pending) },
    { key: 'expiring', label: 'Runs out in 30 days', num: true, hideSm: true, sort: true, render: (c) => (c.expiring > 0.004 ? <><b className="a-bad">{money(c.expiring)}</b><small className="a-muted a-p15-sub">from {c.first_expiry}</small></> : '-') },
  ];
  return (
    <section>
      <PageHead sub="Each customer's wallet credit" rules={['Usable: can go on an order now', 'Pending: waits for the return window', 'Wallet money is a discount, never cash']}
        actions={d && d.can.export && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={exportCsv}><LIcon name="download" size="sm" />Export</button>} />
      {act.note}
      <Loading state={data}>{d && <>
        {!d.wallet_on && <WalletOff />}
        <Alert tone="info" title={`${money(d.totals.usable)} usable in all customers' wallets.`}>{money(d.totals.expiring)} runs out in the next 30 days; {money(d.totals.pending)} pending. A wallet pays at most {d.max_use_pct}% of an order, oldest expiry first.</Alert>
        <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(c) => c.customer_id} label="Customer wallets" onRowClick={(c) => setOpen(c)} initialSort={{ key: 'usable', dir: -1 }}
          empty={{ icon: 'wallet', title: 'No wallets yet', text: 'Customers show here once they earn cashback or get a credit.' }} /></div>
      </>}</Loading>
      {open && (
        <Drawer title={`Wallet: ${open.name}`} onClose={() => { setOpen(null); data.reload(); }} wide>
          <dl className="a-dl"><div><dt>Usable</dt><dd><b>{money(open.usable)}</b>{open.kept > 0.004 ? ` · ${money(open.kept)} kept for open orders` : ''}</dd></div>
            <div><dt>Pending</dt><dd>{money(open.pending)} (cashback of delivered orders still in the return window)</dd></div>
            <div><dt>Runs out in 30 days</dt><dd>{money(open.expiring)}</dd></div></dl>
          <WalletPanel customerId={open.customer_id} onChanged={data.reload} />
        </Drawer>
      )}
    </section>
  );
}
