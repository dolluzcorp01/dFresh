// Masters > Prices > Price lists (phase 15, v23 viewLists; API /prices/* in prices.js). Two tabs: Price lists (the
// cards; a card opens the list) and Check a price (who, what, how many, when -> the price, step by step).
// A list: Rate card, Export, Import, Settings and Change many prices; a table of every pack with the price typed,
// without and with GST, the carton with GST, the margin (See cost only), the lowest allowed price and the next
// change (or a change waiting for approval). A row opens the price panel: history, a new price from a date, the
// lowest allowed price (Admin only) and the pack's own quantity prices. The server checks everything (one price
// guard: MRP, lowest allowed price, cost plus the margin floor -> approval) and its message shows under the field.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { splitMsg } from './Units';
import { mediaUrl } from '../utils/api';
import {
  Alert, Drawer, Empty, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useAdmin, useCan, useLoad, useToast, useUpload, UploadProgress,
} from './ui';

const typedWord = (t) => (t === 'inc' ? 'with GST' : 'without GST');
const rs = (n) => (n === null || n === undefined ? '-' : money(n));

/** the "Prices are typed ..." line of a list (also used by New order) */
export function PriceBasis({ basis }) {
  return <p className="a-hint-s a-p15-basis"><LIcon name="info" size="sm" />{basis.label}</p>;
}

export default function Prices() {
  const loc = useLocation();
  const nav = useNavigate();
  const qs = new URLSearchParams(loc.search);
  const listKey = qs.get('list');
  const tab = qs.get('tab') === 'check' ? 'check' : 'lists';
  const go = (p) => nav(`/admin/prices${p ? `?${p}` : ''}`);
  const data = useLoad('/prices/lists');
  const canCreate = useCan('prices', 'create');
  const { me } = useAdmin();
  const canEdit = useCan('prices', 'edit');
  const [newList, setNewList] = useState(false);
  const d = data.data;

  if (listKey) return <ListPage key={listKey} listKey={listKey} back={() => go('')} meta={d} reloadMeta={data.reload} />;
  return (
    <section>
      <PageHead sub="Price per customer type" actions={canCreate && tab === 'lists' && (
        <button type="button" className="a-btn" onClick={() => setNewList(true)}><LIcon name="plus" size="sm" />New price list</button>)} />
      {!canEdit && <ViewOnly me={me} />}
      <Alert tone="info" title="Sample prices.">Every price here is a sample until sir sets the real ones. Each list says whether its prices are typed with or without GST; every screen shows both.</Alert>
      <Tabs label="Price lists" value={tab} onChange={(k) => go(k === 'check' ? 'tab=check' : '')}
        tabs={[{ key: 'lists', label: 'Price lists' }, { key: 'check', label: 'Check a price' }]} />
      {tab === 'check' ? <CheckPrice /> : (
        <Loading state={data}>
          {d && (
            <>
              <div className="a-p15-cards">
                {d.lists.map((l) => (
                  <button key={l.key} type="button" className="a-card a-p15-lcard" onClick={() => go(`list=${encodeURIComponent(l.key)}`)}>
                    <span className="a-p15-lhead"><span className="a-p15-thumb"><LIcon name="tag" /></span>
                      <span><b>{l.name}</b><small className="a-muted">{l.type_labels.length ? `For: ${l.type_labels.join(', ')}` : 'Not linked to a customer type'}</small></span></span>
                    {l.about && <span>{l.about}</span>}
                    <span className="a-p15-pills">
                      <Pill tone="gray">Typed {typedWord(l.typed)}</Pill>
                      <Pill tone={l.priced === l.packs ? 'good' : 'warn'}>{l.priced} of {l.packs} priced</Pill>
                      {l.slabs > 0 && <Pill tone="gray">{l.slabs} slab{l.slabs === 1 ? '' : 's'}</Pill>}
                      {l.is_default && <Pill tone="gold">Default</Pill>}
                      {l.status === 'archived' && <Pill tone="gray">Archived</Pill>}
                      {l.waiting > 0 && <Pill tone="warn">{l.waiting} waiting for approval</Pill>}
                    </span>
                  </button>
                ))}
              </div>
              <p className="a-hint-s">A customer type without its own list uses the default list. Each type belongs to one list.</p>
            </>
          )}
        </Loading>
      )}
      {newList && d && <ListSettings meta={d} onClose={() => setNewList(false)} onSaved={(out) => { setNewList(false); data.reload(); if (out && out.list_key) go(`list=${out.list_key}`); }} />}
    </section>
  );
}

function ViewOnly({ me }) {
  return <Alert tone="info" title="View only.">{me && me.role_name ? `${me.role_name} can` : 'Your role can'} see prices but not change them. Rights come from the role in Foundation (section 0).</Alert>;
}

// ---------------------------------------------------------------- one list
function ListPage({ listKey, back, meta, reloadMeta }) {
  const nav = useNavigate();
  const data = useLoad(`/prices/lists/${encodeURIComponent(listKey)}`);
  const { me } = useAdmin();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null); // sku | 'settings' | 'bulk' | 'import' | 'card'
  const d = data.data;
  const l = d && d.list;
  const reload = () => { data.reload(); reloadMeta(); };
  const rows = useMemo(() => (d ? d.rows.filter((r) => (!cat || r.category_key === cat)
    && (!q || `${r.sku_code} ${r.name} ${r.size_label}`.toLowerCase().includes(q.toLowerCase()))) : []), [d, q, cat]);
  const exportFile = async () => {
    try { await api.download(`/prices/lists/${encodeURIComponent(listKey)}/export.xlsx`, `dfresh-prices-${listKey}.xlsx`); toast('good', 'Downloaded', 'Change price and from, keep the rest.'); } catch (e) { toast('bad', 'Not downloaded', e.message); }
  };
  const waiting = d ? d.rows.filter((r) => r.waiting).length : 0;
  const columns = d ? [
    { key: 'pack', label: 'Pack', render: (r) => <><b>{r.name}</b><small className="a-muted a-p15-sub">{r.sku_code} · {r.size_label}{r.own_bands ? ' · own quantity prices' : ''}</small></> },
    { key: 'typed', label: 'Price typed', num: true, render: (r) => (r.typed === null ? <Pill tone="warn">Not priced</Pill> : <><b>{rs(r.typed)}</b>{r.fallback && <small className="a-muted"> from {meta ? (meta.lists.find((x) => x.is_default) || {}).name : 'default'}</small>}</>) },
    { key: 'ex', label: 'Without GST', num: true, render: (r) => rs(r.ex) },
    { key: 'inc', label: 'With GST', num: true, render: (r) => rs(r.inc) },
    { key: 'carton', label: 'Carton', num: true, render: (r) => (r.carton_inc === null ? '-' : <>{rs(r.carton_inc)}<small className="a-muted a-p15-sub">{r.per_carton} packs</small></>) },
    ...(d.seeCost ? [{ key: 'margin', label: 'Margin', num: true, render: (r) => (r.std_cost === null || r.std_cost === undefined ? <span className="a-muted">no cost</span> : r.margin === null ? '-' : <Pill tone={r.margin_tone}>{r.margin}%</Pill>) }] : []),
    { key: 'floor', label: 'Lowest allowed', num: true, render: (r) => (r.min_price === null ? '-' : <>{rs(r.min_price)}{r.below_floor && <> <Pill tone="bad">below</Pill></>}</>) },
    { key: 'next', label: 'Next change', render: (r) => (r.waiting ? <Pill tone="warn">{rs(r.waiting.price)} from {r.waiting.from}, waiting</Pill>
      : r.next ? `${rs(r.next.price)} from ${r.next.from}` : <span className="a-muted">-</span>) },
  ] : [];
  return (
    <section>
      <PageHead sub="Price per customer type" />
      <Loading state={data}>
        {d && (
          <>
            {!d.can.edit && <ViewOnly me={me} />}
            <Alert tone="info" title="Sample prices.">Every price here is a sample until sir sets the real ones. Each list says whether its prices are typed with or without GST; every screen shows both.</Alert>
            <Tabs label="Price lists" value="lists" onChange={(k) => (k === 'check' ? nav('/admin/prices?tab=check') : back())}
              tabs={[{ key: 'lists', label: 'Price lists' }, { key: 'check', label: 'Check a price' }]} />
            <div className="a-card a-p15-bar">
              <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={back}><LIcon name="arrow-left" size="sm" />All lists</button>
              <b className="a-p15-lname">{l.name}</b>
              <Pill tone="gray">Typed {typedWord(l.typed)}</Pill>
              {l.is_default && <Pill tone="gold">Default</Pill>}
              {waiting > 0 && <Pill tone="warn">{waiting} waiting for approval</Pill>}
              <span className="a-p15-sp" />
              <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setOpen('card')}><LIcon name="file-text" size="sm" />Rate card</button>
              {d.can.export && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={exportFile}><LIcon name="download" size="sm" />Export</button>}
              {d.can.edit && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setOpen('import')}><LIcon name="upload" size="sm" />Import</button>}
              {d.can.edit && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setOpen('settings')}><LIcon name="settings" size="sm" />Settings</button>}
              {d.can.edit && <button type="button" className="a-btn a-btn-sm" onClick={() => setOpen('bulk')}><LIcon name="percent" size="sm" />Change many prices</button>}
            </div>
            {l.about && <p className="a-hint-s">{l.about}</p>}
            <div className="a-listcard">
              <div className="a-p15-filters">
                <label className="a-p14-in"><LIcon name="search" size="sm" /><input value={q} placeholder="Find a pack" aria-label="Find a pack" onChange={(e) => setQ(e.target.value)} /></label>
                <select value={cat} aria-label="Category" onChange={(e) => setCat(e.target.value)}>
                  <option value="">All categories</option>
                  {d.categories.map((c) => <option key={c.category_key} value={c.category_key}>{c.name}</option>)}
                </select>
              </div>
              <div className="a-countline"><b>{rows.length}</b> packs · prices today ({d.today}){d.seeCost ? ' · margin is seen by Super admin, Admin and Sub-admin only' : ''}</div>
              <Table columns={columns} rows={rows} rowKey={(r) => r.sku_code} label={`${l.name} prices`} onRowClick={(r) => setOpen(r.sku_code)}
                empty={{ icon: 'inbox', title: 'No pack matches', text: 'Change the search or the category.' }} />
            </div>
            {open === 'settings' && <ListSettings meta={meta} list={l} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
            {open === 'bulk' && <BulkDrawer list={l} categories={d.categories} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
            {open === 'import' && <ImportDrawer list={l} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
            {open === 'card' && <RateCard listKey={l.key} onClose={() => setOpen(null)} />}
            {open && !['settings', 'bulk', 'import', 'card'].includes(open) && <PriceDrawer list={l} sku={open} onClose={() => setOpen(null)} onSaved={reload} />}
          </>
        )}
      </Loading>
    </section>
  );
}

// ---------------------------------------------------------------- list settings (new list too)
function ListSettings({ meta, list = null, onClose, onSaved }) {
  const creating = !list;
  const act = useAction();
  const toast = useToast();
  const start = useMemo(() => (creating
    ? { name: '', about: '', copy_from: '', adjust: '', typed: 'ex', round_to: '1', types: [], is_default: false, status: 'active' }
    : { name: list.name, about: list.about || '', typed: list.typed, round_to: String(list.round_to), types: list.types, is_default: list.is_default, status: list.status }), [creating, list]);
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const tick = (t, on) => setF((x) => ({ ...x, types: on ? [...x.types, t] : x.types.filter((y) => y !== t) }));
  const save = () => act.run(async () => {
    setErr({});
    try {
      const body = { ...f, round_to: Number(f.round_to), adjust: f.adjust === '' ? 0 : Number(f.adjust) };
      const out = creating ? await api.send('POST', '/prices/lists', body) : await api.send('PUT', `/prices/lists/${encodeURIComponent(list.key)}`, body);
      toast('good', creating ? 'Price list created' : 'Saved', out.message);
      onSaved(out);
    } catch (e) { if (e.data && e.data.fields) setErr(e.data.fields); throw e; }
  });
  const fd = (name, label, x = {}) => ({ name, label, error: err[name], ...x });
  return (
    <Drawer title={creating ? 'New price list' : `${list.name}: settings`} onClose={onClose} dirty={dirty}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}><LIcon name="check" size="sm" />{creating ? 'Create list' : 'Save'}</button></>}>
      {act.note}
      <div className="a-grid2">
        <Field def={fd('name', 'Name', { required: true, wide: true })} value={f.name} onChange={(v) => set('name')(String(v).slice(0, 40))} />
        <Field def={fd('about', 'Who it is for', { wide: true, help: 'Shown on the list so staff pick the right one.' })} value={f.about} onChange={(v) => set('about')(String(v).slice(0, 120))} />
        {creating && <Field def={fd('copy_from', 'Copy prices from', { type: 'select', options: meta.lists.map((l) => ({ value: l.key, label: l.name })) })} value={f.copy_from} onChange={set('copy_from')} />}
        {creating && <Field def={fd('adjust', 'Adjust by %', { type: 'number', help: 'e.g. -5 for 5% lower. Floors still apply.' })} value={f.adjust} onChange={set('adjust')} />}
        <Field def={fd('typed', 'Prices are typed', { type: 'select', allowEmpty: false, wide: true, help: 'Changing it converts every price so the customer pays the same.',
          options: [{ value: 'ex', label: 'Without GST' }, { value: 'inc', label: 'With GST (GST is inside the price)' }] })} value={f.typed} onChange={set('typed')} />
        <Field def={fd('round_to', 'Round worked-out prices to', { type: 'select', allowEmpty: false, wide: true, help: 'Used for slabs and percentage changes.',
          options: [{ value: '0', label: 'Paise (no rounding)' }, { value: '0.5', label: '50 paise' }, { value: '1', label: 'Rs 1' }] })} value={f.round_to} onChange={set('round_to')} />
      </div>
      <h3 className="a-p14-fsec">Customer types that use this list</h3>
      <div className="a-p15-types">
        {meta.types.map((t) => {
          const now = meta.lists.find((l) => l.key === t.list_key);
          return (
            <label key={t.type_key} className="a-check"><input type="checkbox" checked={f.types.includes(t.type_key)} onChange={(e) => tick(t.type_key, e.target.checked)} />
              {t.label}{now && (!list || now.key !== list.key) && <small className="a-muted"> now in {now.name}</small>}</label>
          );
        })}
      </div>
      {!creating && (
        <>
          <h3 className="a-p14-fsec">Default and status</h3>
          <div className="a-grid2">
            <Field def={fd('is_default', 'Default list', { type: 'select', allowEmpty: false, options: [{ value: '0', label: 'No' }, { value: '1', label: 'Yes: types without a list use this one' }] })}
              value={f.is_default ? '1' : '0'} onChange={(v) => set('is_default')(v === '1')} />
            <Field def={fd('status', 'Status', { type: 'select', allowEmpty: false, options: [{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived (kept for history)' }] })}
              value={f.status} onChange={set('status')} />
          </div>
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- the price panel of one pack
function PriceDrawer({ list, sku, onClose, onSaved }) {
  const data = useLoad(`/prices/lists/${encodeURIComponent(list.key)}/skus/${encodeURIComponent(sku)}`);
  const act = useAction();
  const toast = useToast();
  const d = data.data;
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  useEffect(() => {
    if (!d) return;
    const bands = d.bands.map((b) => ({ min: String(b.min), price: String(b.price) }));
    while (bands.length < 3) bands.push({ min: '', price: '' });
    setF({ price: '', from: d.today, min_price: d.min_price === null ? '' : String(d.min_price), bands });
  }, [d]);
  const startBands = d ? JSON.stringify(d.bands.map((b) => ({ min: String(b.min), price: String(b.price) }))) : '';
  const cleanBands = (bs) => bs.filter((b) => b.min !== '' || b.price !== '');
  const dirty = Boolean(f && d && (f.price !== '' || f.min_price !== (d.min_price === null ? '' : String(d.min_price)) || JSON.stringify(cleanBands(f.bands)) !== startBands));
  const edit = d && d.can.edit;
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('PUT', `/prices/lists/${encodeURIComponent(list.key)}/skus/${encodeURIComponent(sku)}`, {
        price: f.price, from: f.from, min_price: f.min_price, bands: JSON.stringify(cleanBands(f.bands)) !== startBands ? cleanBands(f.bands) : undefined });
      toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Sent for approval' : 'Saved', out.message);
      onSaved();
      data.reload();
    } catch (e) { if (e.data && e.data.fields) setErr(e.data.fields); throw e; }
  });
  const setBand = (i, k, v) => setF((x) => ({ ...x, bands: x.bands.map((b, j) => (j === i ? { ...b, [k]: v } : b)) }));
  return (
    <Drawer title={sku} sub={list.name} thumb={<LIcon name="tag" />} onClose={onClose} dirty={edit && dirty}
      footer={edit ? <><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}><LIcon name="check" size="sm" />Save</button></>
        : <><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      <Loading state={data}>
        {d && f && (
          <>
            {act.note}
            <div className="a-p15-pills">
              <Pill tone="gray">MRP {d.mrp === null ? 'not set' : rs(d.mrp)}</Pill>
              {d.std_cost !== undefined && <Pill tone="gray">Cost {d.std_cost === null ? 'not set' : rs(d.std_cost)}</Pill>}
              <Pill tone="gray">GST {d.rate === null ? 'unknown' : `${d.rate}%`} (HSN {d.hsn})</Pill>
            </div>
            {d.std_cost !== undefined && d.std_cost !== null && d.now && d.now.ex !== null && d.now.ex < d.std_cost && (
              <Alert tone="bad" title="Sells below the standard cost.">Each pack sells for {rs(d.now.ex)} without GST and costs {rs(d.std_cost)}.</Alert>)}
            {d.waiting && (
              <Alert tone="warn" title={`${d.waiting.no}: ${rs(d.waiting.price)} from ${d.waiting.from} waits for approval.`}>
                {d.waiting.why} Raised by {d.waiting.raised_by}. Until it is approved the current price stays.{d.waiting.mine ? ' You raised it, so someone else approves it (Home > Approvals).' : ' Approve it in Home > Approvals.'}
              </Alert>
            )}
            <h3 className="a-p14-fsec">Price history</h3>
            {d.history.length ? (
              <ul className="a-p15-hist">
                {d.history.map((h) => (
                  <li key={h.from}>{rs(h.price)} {typedWord(h.basis)} <span className="a-muted">from {h.from}</span>
                    {d.now && h.from === d.now.from && !d.now.fallback && <> <Pill tone="good">Today</Pill></>}{h.from > d.today && <> <Pill tone="gray">From {h.from}</Pill></>}</li>
                ))}
              </ul>
            ) : <Alert tone="warn" title="Not priced.">{d.now && d.now.fallback ? `This list has no price of its own: it uses the default list's ${rs(d.now.typed)}.` : 'This pack cannot be sold to customers on this list.'}</Alert>}
            <h3 className="a-p14-fsec">{d.history.length ? 'New price' : 'First price'}</h3>
            <div className="a-grid2">
              <Field def={{ name: 'price', label: `Price per pack (${typedWord(list.typed)})`, type: 'number', min: 0, step: '0.01', locked: !edit, error: err.price }} value={f.price} onChange={(v) => setF((x) => ({ ...x, price: v }))} />
              <Field def={{ name: 'from', label: 'Starts on', type: 'date', locked: !edit, error: err.from, help: 'Today or later. Never backwards.' }} value={f.from} onChange={(v) => setF((x) => ({ ...x, from: v }))} />
              <Field def={{ name: 'min_price', label: 'Lowest allowed price (without GST)', type: 'number', min: 0, step: '0.01', locked: !edit || !d.can.admin, error: err.min_price, wide: true,
                help: `One floor for this pack in every list and special price. Admin only.${d.floor_waiting ? ` Lowering it to ${d.floor_waiting.value === null ? 'none' : rs(d.floor_waiting.value)} waits for a second Admin.` : ''}` }}
              value={f.min_price} onChange={(v) => setF((x) => ({ ...x, min_price: v }))} />
            </div>
            {d.need !== undefined && d.need !== null && <p className="a-hint-s">Cost plus the margin floor: {rs(d.need)} without GST. A lower price waits for approval.</p>}
            <h3 className="a-p14-fsec">Own quantity prices for this pack (optional)</h3>
            <p className="a-hint-s">Set these to override the list slabs for this pack only. Leave empty to use the list slabs.</p>
            {f.bands.map((b, i) => (
              <div key={i} className={`a-field a-p14-kitrow${err[`bands.${i}`] ? ' a-err' : ''}`}>
                <span>Band {i + 1}: from how many packs, and the price</span>
                <div className="a-p14-kr">
                  <input type="number" min="2" step="1" value={b.min} disabled={!edit} placeholder="Packs" aria-label={`Band ${i + 1} from packs`} onChange={(e) => setBand(i, 'min', e.target.value)} />
                  <input type="number" min="0" step="0.01" value={b.price} disabled={!edit} placeholder={typedWord(list.typed)} aria-label={`Band ${i + 1} price`} onChange={(e) => setBand(i, 'price', e.target.value)} />
                </div>
                {err[`bands.${i}`] && <small className="a-emsg" role="alert">{err[`bands.${i}`]}</small>}
              </div>
            ))}
            <p className="a-hint-s">Quotes and orders keep the price they were made with; a new price only applies to new ones from its start date.</p>
          </>
        )}
      </Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------- change many prices
function BulkDrawer({ list, categories, onClose, onDone }) {
  const toast = useToast();
  const act = useAction();
  const [f, setF] = useState({ category_key: '', mode: 'pct', value: '5', from: '' });
  const [plan, setPlan] = useState(null);
  const body = () => ({ ...f, from: f.from || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) });
  const preview = () => act.run(async () => { setPlan(await api.send('POST', `/prices/lists/${encodeURIComponent(list.key)}/bulk`, body())); });
  const apply = () => act.run(async () => {
    const out = await api.send('POST', `/prices/lists/${encodeURIComponent(list.key)}/bulk`, { ...body(), apply: true });
    toast('good', `${out.changed} prices changed`, out.message.replace(/^\d+ prices changed\. /, ''));
    onDone();
  });
  const set = (k) => (v) => { setPlan(null); setF((x) => ({ ...x, [k]: v })); };
  const go = plan ? plan.preview.filter((r) => !r.skip) : [];
  return (
    <Drawer title={`${list.name}: change many prices`} onClose={onClose} dirty={Boolean(plan)}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={preview}>Preview</button>
        <button type="button" className="a-btn" disabled={act.busy || !go.length} onClick={apply}><LIcon name="check" size="sm" />Apply {go.length || ''}</button></>}>
      {act.note}
      <div className="a-grid2">
        <Field def={{ name: 'b-cat', label: 'Category', type: 'select', options: categories.map((c) => ({ value: c.category_key, label: c.name })) }} value={f.category_key} onChange={set('category_key')} />
        <Field def={{ name: 'b-mode', label: 'By', type: 'select', allowEmpty: false, options: [{ value: 'pct', label: 'Percent' }, { value: 'amount', label: 'Rupees per pack' }] }} value={f.mode} onChange={set('mode')} />
        <Field def={{ name: 'b-val', label: f.mode === 'pct' ? 'Percent (e.g. 5 or -3)' : 'Rupees (e.g. 2 or -1.50)', type: 'number' }} value={f.value} onChange={set('value')} />
        <Field def={{ name: 'b-from', label: 'Starts on', type: 'date', help: 'Today or later.' }} value={f.from} onChange={set('from')} />
      </div>
      {plan && (
        <>
          <div className="a-countline"><b>{go.length}</b> prices change from {plan.from}{plan.preview.length - go.length ? `, ${plan.preview.length - go.length} skipped` : ''}</div>
          <div className="a-scroll"><table className="a-table">
            <thead><tr><th>Pack</th><th className="a-num">Now</th><th className="a-num">New</th><th>Note</th></tr></thead>
            <tbody>{plan.preview.map((r) => (
              <tr key={r.sku_code}><td><b>{r.sku_code}</b> <span className="a-muted">{r.name}</span></td><td className="a-num">{rs(r.old)}</td><td className="a-num">{rs(r.next)}</td>
                <td>{r.skip ? <Pill tone="warn">{r.skip}</Pill> : null}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- import
function ImportDrawer({ list, onClose, onDone }) {
  const up = useUpload();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try { setRep(await up.send('check', `/prices/lists/${encodeURIComponent(list.key)}/import?dryRun=1`, file)); } catch (e) { toast('bad', 'Not checked', e.message); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const out = await up.send('apply', `/prices/lists/${encodeURIComponent(list.key)}/import?dryRun=0&hash=${rep.fileHash}`, file);
      toast('good', 'Imported', out.message);
      onDone();
    } catch (e) { toast('bad', 'Not imported', e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer title={`${list.name}: import prices`} onClose={onClose}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        <button type="button" className="a-btn a-btn-ghost" disabled={busy || !file} onClick={check}>Check the file</button>
        {rep && rep.ok && rep.changes.length > 0 && <button type="button" className="a-btn" disabled={busy} onClick={apply}><LIcon name="check" size="sm" />Apply</button>}</>}>
      <p className="a-hint-s">Start from Export. Change price and from (today or later), keep the rest. One file per list. Nothing is saved while one error is left.</p>
      <input type="file" accept=".xlsx" aria-label="Price file" onChange={(e) => { setFile(e.target.files[0] || null); setRep(null); }} />
      <UploadProgress state={up.state} />
      {rep && (
        <>
          <Alert tone={rep.ok ? 'good' : 'bad'} title={rep.summary} />
          {rep.errors.length > 0 && <ul className="a-p15-errs">{rep.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {rep.ok && rep.changes.length > 0 && <ul className="a-p15-hist">{rep.changes.map((c) => <li key={c.sku_code}><b>{c.sku_code}</b> {rs(c.old)} to {rs(c.price)} from {c.from}</li>)}</ul>}
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- rate card (prints alone)
function RateCard({ listKey, onClose }) {
  const data = useLoad(`/prices/lists/${encodeURIComponent(listKey)}/rate-card`);
  const { me } = useAdmin();
  const logo = me && me.logo_square; // the square logo (Logo and brand images), else the logo of today
  // print shows only the rate card (adminStyles @media print, body class while printing)
  const printCard = () => { document.body.classList.add('a-printing-card'); window.print(); setTimeout(() => document.body.classList.remove('a-printing-card'), 500); };
  const d = data.data;
  return (
    <Drawer title="Rate card" onClose={onClose} wide
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        <button type="button" className="a-btn" onClick={printCard}><LIcon name="printer" size="sm" />Print</button></>}>
      <p className="a-hint-s">Print, or choose &quot;Save as PDF&quot; in the print window, to share it.</p>
      <Loading state={data}>
        {d && (
          <div className="a-p15-card a-printonly-area">
            <div className="a-p15-cardhead">
              <img src={mediaUrl(logo || '/media/logo/favicon-192.png')} alt="" width="40" height="40" />
              <div><b>{d.company.brand} price list · {d.list.name}</b><small>{d.company.name} · {d.company.phone} · {d.company.email}</small>
                <small>Prices from {d.today}. Subject to change; your order confirmation is final.</small></div>
            </div>
            <table className="a-table">
              <thead><tr><th>Product</th><th>Pack</th><th className="a-num">Per carton</th><th className="a-num">Price per pack</th><th className="a-num">GST</th><th className="a-num">With GST</th><th className="a-num">Carton with GST</th><th className="a-num">MRP</th></tr></thead>
              <tbody>{d.rows.map((r, i) => (
                <tr key={i}><td>{r.product}</td><td>{r.pack}</td><td className="a-num">{r.per_carton}</td><td className="a-num">{rs(r.ex)}</td><td className="a-num">{r.rate}%</td>
                  <td className="a-num">{rs(r.inc)}</td><td className="a-num">{rs(r.carton_inc)}</td><td className="a-num">{rs(r.mrp)}</td></tr>
              ))}</tbody>
            </table>
            {d.slabs.length > 0 && <p>Buy more, pay less: {d.slabs.map((s) => `${s.pct}% off from ${s.min} packs`).join(', ')}.</p>}
            <p className="a-muted">{d.rows.length} packs. Prices without GST are the price per pack; GST is added on the invoice.</p>
          </div>
        )}
      </Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------- check a price
function CheckPrice() {
  const opts = useLoad('/prices/check-options');
  const o = opts.data;
  const [f, setF] = useState(null);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (o && !f) setF({ customer: o.customers[0] ? String(o.customers[0].customer_id) : '', type: o.types[0] ? o.types[0].type_key : '', sku: o.skus[0] ? o.skus[0].sku_code : '', qty: '24', date: o.today, pos: o.seller_state });
  }, [o, f]);
  useEffect(() => {
    if (!f || !f.sku) return;
    const p = new URLSearchParams({ sku: f.sku, qty: f.qty || '1', date: f.date, pos: f.pos, ...(f.customer ? { customer: f.customer } : { type: f.type }) });
    api.get(`/prices/check?${p}`).then((r) => { setRes(r); setError(''); }, (e) => { setRes(null); setError(splitMsg(e.message, 'Not worked out')[1]); });
  }, [f]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Loading state={opts}>
      {o && f && (
        <div className="a-p15-check">
          <div className="a-card">
            <h3 className="a-p14-fsec">Who, what, how many, when</h3>
            <Field def={{ name: 'c-cust', label: 'Customer', type: 'select', help: 'Sample customers until section 6.', options: [{ value: '', label: 'No customer, just a type' }, ...o.customers.map((c) => ({ value: String(c.customer_id), label: `${c.name} (${c.customer_no})` }))], allowEmpty: false }}
              value={f.customer} onChange={set('customer')} />
            {!f.customer && <Field def={{ name: 'c-type', label: 'Customer type', type: 'select', allowEmpty: false, options: o.types.map((t) => ({ value: t.type_key, label: t.label })) }} value={f.type} onChange={set('type')} />}
            <Field def={{ name: 'c-sku', label: 'Pack', type: 'select', allowEmpty: false, options: o.skus.map((s) => ({ value: s.sku_code, label: `${s.sku_code} · ${s.name}` })) }} value={f.sku} onChange={set('sku')} />
            <Field def={{ name: 'c-pos', label: 'Place of supply', type: 'select', allowEmpty: false, help: 'Same state as the company: CGST + SGST. Another state: IGST.', options: o.states }} value={f.pos} onChange={set('pos')} />
            <div className="a-grid2">
              <Field def={{ name: 'c-qty', label: 'Quantity (packs)', type: 'number', min: 1, step: '1' }} value={f.qty} onChange={set('qty')} />
              <Field def={{ name: 'c-date', label: 'On date', type: 'date' }} value={f.date} onChange={set('date')} />
            </div>
          </div>
          <div className="a-card">
            <h3 className="a-p14-fsec">The price</h3>
            {error && <Alert tone="bad" title="Cannot work it out.">{error}</Alert>}
            {res && (
              <>
                <dl className="a-p15-price">
                  <div><dt>Each, without GST</dt><dd>{rs(res.ex)}</dd></div>
                  <div><dt>Each, with GST</dt><dd>{rs(res.inc)}</dd></div>
                  <div><dt>{res.qty} packs, with GST</dt><dd>{rs(res.total_inc)}</dd></div>
                </dl>
                {res.warn.map((w) => <Alert key={w.kind} tone="bad" title={w.t}>{w.d}</Alert>)}
                <h4>How it was worked out</h4>
                <ol className="a-p15-steps">{res.steps.map((s, i) => <li key={i}><b>{s.t}</b><span>{s.d}</span></li>)}</ol>
              </>
            )}
            {!res && !error && <Empty icon="calculator" title="Pick a pack">The price shows here.</Empty>}
          </div>
        </div>
      )}
    </Loading>
  );
}

export { ViewOnly, typedWord, rs };
