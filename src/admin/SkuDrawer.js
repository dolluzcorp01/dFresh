// The SKU side panel (phase 14, v23 DRAWERS.sku; API /catalogue/skus in catalogue.js): one form in sections (Pack,
// Selling, Stock, Barcodes, Tax; a raw material has no Selling and no shelf-life fields, and its own HSN code, phase 16). Save stays
// off until something changes, closing or Cancel with changes asks first, a refused save marks each field in red under
// it, marks its section tab red and opens the first one. Barcodes are added / removed straight away (refused while the
// form has unsaved typing). Used by Products and SKUs and by Raw materials; other pages link to /admin/products?sku=CODE.
// Also exports the small pieces both pages share: PIcon, Fld, DTabs, StatusPill, ProductThumb, RawThumb.
import { useEffect, useMemo, useState } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { DISCARD, Drawer, LIcon, Loading, Pill, money, useAction, useCan, useConfirm, useLoad, useToast } from './ui';

// Lucide icons (ISC) the shared LIcon set does not carry yet, copied from docs/reference/dFresh_Back_Office_v23.html
const EXTRA = {
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  'scan-barcode': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M17 7v10"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

/** LIcon plus the few icons this screen needs that the shared set does not have yet */
export function PIcon({ name, size }) {
  const d = EXTRA[name];
  if (!d) return <LIcon name={name} size={size} />;
  return <svg className={`a-i${size ? ` a-i-${size}` : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: d }} />; // eslint-disable-line react/no-danger
}

/** the DOM id of a field by its API key: tr.en.description -> p14-tr-en-description */
export const fid = (key) => `p14-${String(key).replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** one field as v23 .fld: label above, help under it, the error under that in red */
export function Fld({ k, label, req, hint, error, full, children }) {
  return (
    <div className={`a-field p14-fld${error ? ' a-err' : ''}${full ? ' p14-full' : ''}`}>
      <label className="p14-l" htmlFor={fid(k)}>{label}{req && <span className="a-req" aria-hidden="true"> *</span>}</label>
      {children}
      {hint && <small className="a-hint">{hint}</small>}
      {error && <small className="a-emsg p14-emsg" role="alert"><LIcon name="circle-x" size="sm" />{error}</small>}
    </div>
  );
}

/** the section tabs of a panel: tabs [{ key, label, icon, count, bad }] */
export function DTabs({ tabs, value, onChange, label }) {
  return (
    <div className={`a-tabs p14-dtabs${tabs.length > 5 ? ' p14-many' : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={t.bad ? 'haserr' : undefined} onClick={() => onChange(t.key)}>
          <span>{t.label}</span>
          {t.count !== undefined && t.count !== '' && t.count !== 0 && <span className="a-ncount">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

const TONE = { draft: 'gray', active: 'good', hidden: 'info', discontinued: 'warn', archived: 'gray' };
/** a product or SKU status as its v23 pill */
export function StatusPill({ status, label }) {
  return <Pill tone={TONE[status] || 'gray'}>{label || status}</Pill>;
}

/** the product picture in a 44 px box (v23 .thumb); a striped box when it has none yet */
export function ProductThumb({ file, label }) {
  return (
    <span className="p14-thumb" title={file ? undefined : 'No picture yet'}>
      {file ? <img src={mediaUrl(`/media/products/400/${file}`)} alt={label || ''} width="44" height="44" loading="lazy" /> : <span className="p14-nopic" aria-hidden="true"><PIcon name="image" size="sm" /></span>}
    </span>
  );
}
/** a raw material has no photo: the package icon (v23 skuPic) */
export function RawThumb() {
  return <span className="p14-thumb p14-rawpic" aria-hidden="true"><LIcon name="package" /></span>;
}

const SOURCE = [['made', 'Made by dFresh'], ['bought', 'Bought in'], ['both', 'Made and bought']];
const SELL = [['pack', 'Packs only'], ['carton', 'Full cartons only'], ['both', 'Packs or cartons']];
const TAB_OF = {
  size_label: 'pack', raw_name: 'pack', unit_code: 'pack', source: 'pack', status: 'pack', net_qty: 'pack', mrp: 'pack', std_cost: 'pack',
  sell_unit: 'sell', min_order_qty: 'sell', step_qty: 'sell', substitutes: 'sell',
  packs_per_carton: 'stock', per_pallet: 'stock', weight_kg: 'stock', dims: 'stock', shelf_life_months: 'stock', track_batches: 'stock', near_expiry_days: 'stock',
  hsn_code: 'tax', gst_rate: 'tax',
};
const tabOf = (k) => TAB_OF[k] || (/^(reorder|units)\./.test(k) ? 'stock' : 'pack');
const str = (v) => (v === null || v === undefined ? '' : String(v));

function startOf(s) {
  return {
    size_label: s.size_label || '', raw_name: s.raw_name || s.name || '', unit_code: s.unit_code || '', source: s.source, status: s.status,
    net_qty: s.net_qty || '', mrp: str(s.mrp), std_cost: str(s.std_cost),
    sell_unit: s.sell_unit, min_order_qty: str(s.min_order_qty), step_qty: str(s.step_qty), substitutes: s.substitutes || [],
    packs_per_carton: str(s.packs_per_carton), per_pallet: str(s.per_pallet), weight_kg: str(s.weight_kg), dims: s.dims || '',
    shelf_life_months: str(s.shelf_life_months), track_batches: Boolean(s.track_batches), near_expiry_days: str(s.near_expiry_days),
    hsn_code: s.hsn_code || '', gst_rate: str(s.gst_rate),
    reorder: Object.fromEntries((s.godowns || []).map((g) => [g.godown_id, str(g.reorder || 0)])),
    units: (s.units || []).map((u) => ({ unit_code: u.unit_code, base_qty: str(u.base_qty) })),
  };
}

/**
 * <SkuDrawer code="DF001-M100" onClose onSaved onBack skus /> - the SKU side panel.
 * onSaved(): after any change (save, barcode) so the page reloads its list; onBack (optional): the "Product" button in
 * the foot (a pack opened from its product); skus (optional): [{ sku_code, name, status, ready, product_status }] for
 * the Substitutes choice (loaded here when not given).
 */
export default function SkuDrawer({ code, onClose, onSaved, onBack, skus }) {
  const load = useLoad(`/catalogue/skus/${encodeURIComponent(code)}`);
  const units = useLoad('/catalogue/units');
  const s = load.data;
  const raw = Boolean(s && s.type === 'raw');
  const list = useLoad(s && !raw && !skus ? '/catalogue/products' : null);
  const canEdit = useCan('products', 'edit');
  const canCancel = useCan('products', 'cancel');
  const act = useAction();
  const bc = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(null);
  const [errs, setErrs] = useState({});
  const [tab, setTab] = useState('pack');
  const [nb, setNb] = useState({ code: '', kind: 'supplier' });

  const start = useMemo(() => (s ? startOf(s) : null), [s]);
  const f = form || start;
  const dirty = Boolean(form && start && JSON.stringify(form) !== JSON.stringify(start));

  // a refused save: every field in red, its tab red, the first one opened and focused (v23 failed())
  useEffect(() => {
    const keys = Object.keys(act.fields || {});
    setErrs(act.fields || {});
    if (!keys.length) return;
    setTab(tabOf(keys[0]));
    setTimeout(() => { const el = document.getElementById(fid(keys[0])); if (el) el.focus(); }, 0);
  }, [act.fields]);

  if (!s || !f) {
    return <Drawer title={code} onClose={onClose}><Loading state={load}>{null}</Loading></Drawer>;
  }

  const set = (k, v) => {
    setForm({ ...f, [k]: v });
    if (errs[k]) {
      const n = { ...errs }; delete n[k]; setErrs(n);
      if (!Object.keys(n).length) act.setMsg(null);
    }
  };
  const err = (k) => errs[k];
  const blocked = () => { if (dirty) { toast('warn', 'Save or cancel your changes first', 'Then do this.'); return true; } return false; };
  const cancel = async () => { if (dirty && !(await confirm(DISCARD))) return; onClose(); };
  const ro = !canEdit;

  const save = () => act.run(async () => {
    const body = { source: f.source, status: f.status, packs_per_carton: f.packs_per_carton, per_pallet: f.per_pallet, weight_kg: f.weight_kg, dims: f.dims,
      reorder: f.reorder, units: f.units.filter((u) => u.unit_code) };
    if (raw) Object.assign(body, { raw_name: f.raw_name, unit_code: f.unit_code, hsn_code: f.hsn_code });
    else {
      Object.assign(body, { size_label: f.size_label, net_qty: f.net_qty, mrp: f.mrp, sell_unit: f.sell_unit, min_order_qty: f.min_order_qty, step_qty: f.step_qty,
        substitutes: f.substitutes, shelf_life_months: f.shelf_life_months, track_batches: f.track_batches, near_expiry_days: f.near_expiry_days,
        hsn_code: f.hsn_code });
    }
    if (s.sees_cost) body.std_cost = f.std_cost;
    const r = await api.send('PUT', `/catalogue/skus/${encodeURIComponent(s.sku_code)}`, body);
    load.setData(r.sku);
    setForm(null);
    setErrs({});
    toast(r.waiting ? 'warn' : 'good', `${s.sku_code} saved`, r.message);
    if (onSaved) onSaved();
  });

  const addBarcode = () => {
    if (blocked()) return;
    if (!nb.code.trim()) { toast('bad', 'Not added', 'Scan or type the barcode.'); return; }
    bc.run(async () => {
      const r = await api.send('POST', `/catalogue/skus/${encodeURIComponent(s.sku_code)}/barcodes`, { barcode: nb.code.trim(), kind: nb.kind });
      setNb({ code: '', kind: nb.kind });
      toast('good', 'Barcode added', r.message);
      load.reload();
      if (onSaved) onSaved();
    });
  };
  const delBarcode = async (b) => {
    if (blocked()) return;
    if (!(await confirm({ title: `Remove barcode ${b.barcode}?`, message: `Scanning it will no longer find ${s.sku_code}.`, action: 'Remove', danger: true }))) return;
    bc.run(async () => {
      const r = await api.send('DELETE', `/catalogue/skus/${encodeURIComponent(s.sku_code)}/barcodes/${encodeURIComponent(b.barcode)}`);
      toast('good', 'Barcode removed', r && r.message);
      load.reload();
      if (onSaved) onSaved();
    });
  };

  const cartonNow = Number(f.packs_per_carton) || s.packs_per_carton;
  const baseName = raw ? ((units.data || []).find((u) => u.unit_code === f.unit_code) || { name: f.unit_code }).name : 'packs';
  const unitChoices = (units.data || []).filter((u) => u.unit_code !== 'pack' && u.unit_code !== 'carton' && u.unit_code !== (raw ? f.unit_code : ''));
  const subChoices = (skus || (list.data && list.data.skus) || []).filter((x) => x.sku_code !== s.sku_code);
  const tabErr = (t) => Object.keys(errs).some((k) => tabOf(k) === t);
  const tabs = [
    { key: 'pack', label: 'Pack', icon: 'package' },
    ...(raw ? [] : [{ key: 'sell', label: 'Selling', icon: 'shopping-cart' }]),
    { key: 'stock', label: 'Stock', icon: 'warehouse' },
    { key: 'barcodes', label: 'Barcodes', icon: 'scan-barcode', count: (s.barcodes || []).length },
    { key: 'tax', label: 'Tax', icon: 'receipt' },
  ].map((t) => ({ ...t, bad: tabErr(t.key) }));
  const shared = 'Belongs to the product: every pack of it shares this.';

  const status = (
    <>
      <StatusPill status={s.status} label={s.status_label} />
      {s.status === 'active' && !s.ready && <Pill tone="bad" title={raw ? 'Set its weight first' : 'Set weight and HSN before it can be sold'}>Not ready</Pill>}
      <span className="a-sp p14-sp" />
      {(s.godowns || []).map((g) => <Pill key={g.godown_id} tone="gray" title={g.name}>{String(g.name).split(' ')[0]}: {g.stock}</Pill>)}
    </>
  );
  const footer = (
    <>
      {onBack && <button type="button" className="a-btn a-btn-ghost" onClick={async () => { if (dirty && !(await confirm(DISCARD))) return; onBack(); }}><PIcon name="chevron-left" size="sm" />Product</button>}
      <span className="a-sp p14-sp" />
      {canEdit ? (
        <>
          <button type="button" className="a-btn a-btn-ghost" onClick={cancel}>Cancel</button>
          <button type="button" className="a-btn" disabled={!dirty || act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button>
        </>
      ) : <button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>}
    </>
  );

  return (
    <Drawer title={s.sku_code} sub={s.name} onClose={onClose} dirty={dirty} status={status} footer={footer}
      thumb={raw ? <LIcon name="package" /> : s.image ? mediaUrl(`/media/products/400/${s.image}`) : <PIcon name="image" />}>
      {act.note}
      {bc.note}
      {!canEdit && <div className="a-alert a-alert-info" role="status"><PIcon name="eye" /><div className="a-alert-tx"><b>View only.</b> Your role can see Products but not change them.</div></div>}
      <DTabs tabs={tabs} value={tab} onChange={setTab} label="Sections" />

      <div className="p14-form" hidden={tab !== 'pack'}>
        <Fld k="sku_code" label="SKU code" hint="Locked once saved: orders, invoices and labels point at it.">
          <input id={fid('sku_code')} value={s.sku_code} disabled />
        </Fld>
        {raw ? (
          <>
            <Fld k="raw_name" label="Name" req error={err('raw_name')}>
              <input id={fid('raw_name')} value={f.raw_name} maxLength={60} disabled={ro} onChange={(e) => set('raw_name', e.target.value)} />
            </Fld>
            <Fld k="unit_code" label="Counted in" req error={err('unit_code')}>
              <select id={fid('unit_code')} value={f.unit_code} disabled={ro} onChange={(e) => set('unit_code', e.target.value)}>
                {(units.data || []).map((u) => <option key={u.unit_code} value={u.unit_code}>{u.name}</option>)}
              </select>
            </Fld>
          </>
        ) : (
          <Fld k="size_label" label="Pack label" req error={err('size_label')}>
            <input id={fid('size_label')} value={f.size_label} maxLength={120} disabled={ro} onChange={(e) => set('size_label', e.target.value)} />
          </Fld>
        )}
        <Fld k="source" label="Made or bought" req error={err('source')} hint="Bought stock comes in on a purchase order (section 3), made stock from a production run (section 4).">
          <select id={fid('source')} value={f.source} disabled={ro} onChange={(e) => set('source', e.target.value)}>
            {SOURCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Fld>
        <Fld k="status" label="Status" error={err('status')}>
          <select id={fid('status')} value={f.status} disabled={ro || !canCancel} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="discontinued">Discontinued (sell what is left)</option>
            <option value="archived">Archived</option>
          </select>
        </Fld>
        {!raw && (
          <>
            <Fld k="net_qty" label="Net quantity" error={err('net_qty')} hint={'Printed on the pack label, like "100 napkins" or "4 rolls".'}>
              <input id={fid('net_qty')} value={f.net_qty} maxLength={40} placeholder="e.g. 100 napkins" disabled={ro} onChange={(e) => set('net_qty', e.target.value)} />
            </Fld>
            <Fld k="mrp" label="MRP per pack (Rs, with GST)" error={err('mrp')}
              hint={`Printed on retail packs. No price list may charge more.${s.max_price ? ` Highest price today or planned: ${money(s.max_price.inc)} with GST (${s.max_price.list}).` : ''}`}>
              <input id={fid('mrp')} type="number" min="0" step="0.01" value={f.mrp} placeholder="not set yet" disabled={ro} onChange={(e) => set('mrp', e.target.value)} />
            </Fld>
          </>
        )}
        {s.sees_cost && (
          <Fld k="std_cost" label={`Standard cost per ${raw ? String(baseName).toLowerCase() : 'pack'} (Rs, without GST)`} error={err('std_cost')}
            hint={`Admin and Sub-admin only. Price lists warn when they sell below it.${s.avg_cost !== null && s.avg_cost !== undefined ? ` Average cost so far: ${money(s.avg_cost)}.` : ''}`}>
            <input id={fid('std_cost')} type="number" min="0" step="0.01" value={f.std_cost} placeholder="not set yet" disabled={ro} onChange={(e) => set('std_cost', e.target.value)} />
            {s.cost_waiting && <Pill tone="warn">A lower cost waits for a second Admin</Pill>}
          </Fld>
        )}
      </div>

      {!raw && (
        <div className="p14-form" hidden={tab !== 'sell'}>
          <Fld k="sell_unit" label="Customers buy in" req error={err('sell_unit')}>
            <select id={fid('sell_unit')} value={f.sell_unit} disabled={ro} onChange={(e) => set('sell_unit', e.target.value)}>
              {SELL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Fld>
          <Fld k="min_order_qty" label="Minimum order (packs)" req error={err('min_order_qty')}>
            <input id={fid('min_order_qty')} type="number" min="1" step="1" value={f.min_order_qty} disabled={ro} onChange={(e) => set('min_order_qty', e.target.value)} />
          </Fld>
          <Fld k="step_qty" label="In steps of (packs)" req error={err('step_qty')} hint="Order quantities must be a multiple of this.">
            <input id={fid('step_qty')} type="number" min="1" step="1" value={f.step_qty} disabled={ro} onChange={(e) => set('step_qty', e.target.value)} />
          </Fld>
          <div className="p14-fsec">If this is out, offer</div>
          <Fld k="substitutes" label="Substitutes" full error={err('substitutes')} hint="Only active, ready packs. Hold Ctrl to pick more than one.">
            <select id={fid('substitutes')} multiple size={5} value={f.substitutes} disabled={ro}
              onChange={(e) => set('substitutes', Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {subChoices.map((x) => <option key={x.sku_code} value={x.sku_code}>{x.sku_code} · {x.name}{x.size_label ? ` (${x.size_label})` : ''}</option>)}
            </select>
          </Fld>
        </div>
      )}

      <div className="p14-form" hidden={tab !== 'stock'}>
        <div className="p14-fsec">Cartons</div>
        <Fld k="packs_per_carton" label={`${raw ? 'Units' : 'Packs'} per carton`} req error={err('packs_per_carton')} hint="A change applies to cartons arriving from today. Cartons in stock keep their count.">
          <input id={fid('packs_per_carton')} type="number" min="1" step="1" value={f.packs_per_carton} disabled={ro} onChange={(e) => set('packs_per_carton', e.target.value)} />
        </Fld>
        <Fld k="per_pallet" label="Cartons per pallet" error={err('per_pallet')}>
          <input id={fid('per_pallet')} type="number" min="1" step="1" value={f.per_pallet} placeholder="optional" disabled={ro} onChange={(e) => set('per_pallet', e.target.value)} />
        </Fld>
        <div className="p14-full">
          <b className="p14-small-h">Carton size history</b>
          <p className="p14-hist">{(s.cartons || []).map((c) => `${c.packs} packs from ${c.from_date}`).join(' · ') || '-'}</p>
          {(s.cartons || []).length > 1 && <p className="a-hint-s">Cartons already in stock keep the count they were packed with.</p>}
        </div>
        <div className="p14-fsec">Size{raw ? '' : ' and shelf life'}</div>
        <Fld k="weight_kg" label="Weight (kg)" req error={err('weight_kg')} hint="Delivery trips are planned by weight.">
          <input id={fid('weight_kg')} type="number" min="0" step="0.01" value={f.weight_kg} disabled={ro} onChange={(e) => set('weight_kg', e.target.value)} />
        </Fld>
        <Fld k="dims" label="Size L x W x H (cm)" error={err('dims')}>
          <input id={fid('dims')} value={f.dims} maxLength={30} placeholder="optional, e.g. 30x20x12" disabled={ro} onChange={(e) => set('dims', e.target.value)} />
        </Fld>
        {!raw && (
          <>
            <Fld k="shelf_life_months" label="Shelf life (months)" req error={err('shelf_life_months')} hint={`0 = never expires. ${shared}`}>
              <input id={fid('shelf_life_months')} type="number" min="0" step="1" value={f.shelf_life_months} disabled={ro} onChange={(e) => set('shelf_life_months', e.target.value)} />
            </Fld>
            <Fld k="track_batches" label="Batch tracking" req error={err('track_batches')} hint={`Anything that expires must be batch tracked: the date belongs to a batch. ${shared}`}>
              <select id={fid('track_batches')} value={f.track_batches ? '1' : ''} disabled={ro} onChange={(e) => set('track_batches', e.target.value === '1')}>
                <option value="1">On</option><option value="">Off</option>
              </select>
            </Fld>
            <Fld k="near_expiry_days" label="Warn days before expiry" error={err('near_expiry_days')} hint={`Empty = the default (${s.near_default} days). ${shared}`}>
              <input id={fid('near_expiry_days')} type="number" min="0" step="1" value={f.near_expiry_days} placeholder={`default ${s.near_default}`} disabled={ro} onChange={(e) => set('near_expiry_days', e.target.value)} />
            </Fld>
          </>
        )}
        <div className="p14-fsec">Reorder level ({raw ? String(baseName).toLowerCase() : 'packs'})</div>
        {(s.godowns || []).map((g) => (
          <Fld key={g.godown_id} k={`reorder.${g.godown_id}`} label={g.name} req error={err(`reorder.${g.godown_id}`)}>
            <input id={fid(`reorder.${g.godown_id}`)} type="number" min="0" step="1" value={f.reorder[g.godown_id] ?? ''} disabled={ro}
              onChange={(e) => { const reorder = { ...f.reorder, [g.godown_id]: e.target.value }; set('reorder', reorder); if (errs[`reorder.${g.godown_id}`]) { const n = { ...errs }; delete n[`reorder.${g.godown_id}`]; setErrs(n); } }} />
          </Fld>
        ))}
        <div className="p14-fsec">Other units</div>
        <div className="p14-full">
          <p className="a-hint-s p14-mt0">Stock is always counted in {raw ? String(baseName).toLowerCase() : 'packs'}. Add a unit people order or count in, and how many {raw ? String(baseName).toLowerCase() : 'packs'} it holds. Cartons come from Packs per carton.</p>
          {f.units.map((u, i) => (
            <div key={i} className={`p14-unitrow${err(`units.${i}`) ? ' a-err' : ''}`}>
              <span>1</span>
              <select id={fid(`units.${i}`)} aria-label={`Unit ${i + 1}`} value={u.unit_code} disabled={ro}
                onChange={(e) => { const n = f.units.map((x, j) => (j === i ? { ...x, unit_code: e.target.value } : x)); set('units', n); }}>
                <option value="">Choose...</option>
                {unitChoices.map((x) => <option key={x.unit_code} value={x.unit_code}>{x.name}</option>)}
              </select>
              <span>=</span>
              <input type="number" min="0" step="any" aria-label={`How many ${raw ? baseName : 'packs'} in unit ${i + 1}`} value={u.base_qty} disabled={ro}
                onChange={(e) => { const n = f.units.map((x, j) => (j === i ? { ...x, base_qty: e.target.value } : x)); set('units', n); }} />
              <span>{raw ? String(baseName).toLowerCase() : 'packs'}</span>
              {!ro && <button type="button" className="a-iconbtn" aria-label={`Remove unit ${i + 1}`} onClick={() => set('units', f.units.filter((_, j) => j !== i))}><PIcon name="trash-2" size="sm" /></button>}
              {err(`units.${i}`) && <small className="a-emsg p14-emsg p14-full" role="alert"><LIcon name="circle-x" size="sm" />{err(`units.${i}`)}</small>}
            </div>
          ))}
          {!ro && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => set('units', [...f.units, { unit_code: '', base_qty: '' }])}><LIcon name="plus" size="sm" />Add a unit</button>}
        </div>
      </div>

      <div hidden={tab !== 'barcodes'}>
        <div className="a-tw p14-flat">
          <table className="a-table">
            <tbody>
              {(s.barcodes || []).map((b) => (
                <tr key={b.barcode}>
                  <td className="a-mono">{b.barcode}</td>
                  <td>{b.kind_label}{b.kind === 'carton' && <small className="a-sub-l">1 scan = {cartonNow} packs</small>}</td>
                  <td className="a-num">
                    {canEdit && b.kind !== 'own' && !b.builtin
                      ? <button type="button" className="a-iconbtn p14-del" disabled={bc.busy} aria-label={`Remove barcode ${b.barcode}`} onClick={() => delBarcode(b)}><PIcon name="trash-2" size="sm" /></button>
                      : <span className="a-muted p14-small">kept</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="a-hint-s">Its own code{raw ? '' : ` and ${s.sku_code}#C (one carton)`} always find it and cannot be removed.</p>
        {canEdit && (
          <div className="p14-inline">
            <label className="p14-fi"><PIcon name="scan-barcode" size="sm" /><input value={nb.code} placeholder="Scan or type a barcode" aria-label="New barcode"
              onChange={(e) => setNb({ ...nb, code: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addBarcode(); }} /></label>
            <select className="p14-sel" aria-label="Barcode kind" value={nb.kind} onChange={(e) => setNb({ ...nb, kind: e.target.value })}>
              <option value="supplier">Supplier EAN</option><option value="carton">Carton</option>
            </select>
            <button type="button" className="a-btn" disabled={bc.busy} onClick={addBarcode}>Add</button>
          </div>
        )}
      </div>

      <div className="p14-form" hidden={tab !== 'tax'}>
        {raw ? (
          <>
            <Fld k="hsn_code" label="HSN code" error={err('hsn_code')} hint="A code from Masters > Tax and units > HSN and GST rates. The GST on its purchase comes from that code's rate on the bill date.">
              <input id={fid('hsn_code')} value={f.hsn_code} inputMode="numeric" maxLength={8} disabled={ro} onChange={(e) => set('hsn_code', e.target.value.replace(/\D/g, ''))} />
            </Fld>
            <Fld k="gst_rate" label="GST rate today" error={err('gst_rate')} hint="Read only: it comes from the HSN code (Masters > Tax and units > HSN and GST rates).">
              <input id={fid('gst_rate')} value={f.gst_rate === '' ? '' : `${f.gst_rate}%`} disabled readOnly />
            </Fld>
          </>
        ) : (
          <>
            <Fld k="hsn_code" label="HSN code" req error={err('hsn_code')} hint={`A code from Masters > Tax and units > HSN and GST rates. ${shared}`}>
              <input id={fid('hsn_code')} value={f.hsn_code} inputMode="numeric" maxLength={8} disabled={ro} onChange={(e) => set('hsn_code', e.target.value.replace(/\D/g, ''))} />
            </Fld>
            <Fld k="gst_rate" label="GST rate today" error={err('gst_rate')} hint="Read only: it comes from the HSN code (Masters > Tax and units > HSN and GST rates), with the date each rate starts.">
              <input id={fid('gst_rate')} value={f.gst_rate === '' ? '' : `${f.gst_rate}%`} disabled readOnly />
            </Fld>
          </>
        )}
      </div>
    </Drawer>
  );
}
