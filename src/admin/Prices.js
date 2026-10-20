// Commerce > Products and prices (docs/COMMERCE-SPEC.md 4.3; API /prices, logic in src/backend_routes/pricing.js).
// A grid of SKUs x price lists (Default + one per customer type). Type a price: the cell turns yellow and a bar at the
// bottom says how many changes wait, from which date they apply, Save / Cancel. An empty cell on a customer type's
// list uses the Default price (shown greyed); a SKU without a Default price has a red "Missing" badge. Filter by
// category, search, "missing prices only". The SKU drawer: carton size, minimum order, sold in packs / cartons / both,
// the product's HSN and GST rate, today's prices and the full price history. Bulk change: a percent or an amount on
// one list or all, one category or all, preview first. Excel: export, then import with a dry run (same rules as the
// product import). Whether prices include GST (Commerce setting) is shown at the top of every price screen.
// View only on Products and prices: everything is shown, nothing can be typed.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, UploadProgress, fmtDate, useAction, useCan, useConfirm, useLeaveGuard, useLoad, useUpload } from './ui';

const rs = (n) => (n === null || n === undefined ? '-' : `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const num = (n) => (n === null || n === undefined ? '' : String(Number(n)));
const dmy = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const cellId = (sku, list) => `${sku}/${list}`;
const SOURCE = { grid: 'Grid', bulk: 'Bulk change', import: 'Excel import', seed: 'Demo seed' };

/** the price at the top of every price screen: excl. / incl. GST, from Commerce settings */
export function PriceBasis({ basis }) {
  const canSettings = useCan('settings', 'view');
  if (!basis) return null;
  return (
    <Notice kind="info">
      <b>{basis.label}.</b> Every price here is per pack.{' '}
      {canSettings ? <Link to="/admin/commerce-settings#cs-prices_include_gst">Change in Commerce settings</Link> : 'Set in Commerce settings by an Admin.'}
    </Notice>
  );
}

export default function Prices() {
  const data = useLoad('/prices');
  const canEdit = useCan('products', 'edit');
  const act = useAction();
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [missing, setMissing] = useState(''); // '' | 'default' | 'any'
  const [edits, setEdits] = useState({}); // "SKU/list" -> typed text
  const [errors, setErrors] = useState({});
  const [effective, setEffective] = useState('');
  const [open, setOpen] = useState(null); // sku_code
  const [panel, setPanel] = useState(null); // 'bulk' | 'excel'
  const d = data.data;
  const dirty = Object.keys(edits).length > 0;
  useLeaveGuard(dirty);

  const rows = useMemo(() => {
    if (!d) return [];
    const term = search.trim().toLowerCase();
    return d.rows.filter((r) => (!cat || r.category_key === cat)
      && (!term || r.sku_code.toLowerCase().includes(term) || String(r.name).toLowerCase().includes(term))
      && (!missing || (missing === 'default' ? r.own.default == null : d.lists.some((l) => r.own[l.key] == null))));
  }, [d, cat, search, missing]);
  const noDefault = d ? d.rows.filter((r) => r.own.default == null).length : 0;

  const typed = (sku, list) => edits[cellId(sku, list)];
  const setCell = (r, list, v) => {
    const id = cellId(r.sku_code, list);
    const now = r.own[list] == null ? '' : num(r.own[list]);
    setEdits((e) => { const n = { ...e }; if (v.trim() === now) delete n[id]; else n[id] = v; return n; });
    setErrors((e) => { if (!e[id]) return e; const n = { ...e }; delete n[id]; return n; });
  };
  const cancel = () => { setEdits({}); setErrors({}); setEffective(''); };
  const save = () => act.run(async () => {
    const changes = Object.entries(edits).map(([id, v]) => { const [sku, list] = id.split('/'); return { sku_code: sku, list_key: list, price: v.trim() === '' ? null : v.trim() }; });
    try {
      const r = await api.send('PUT', '/prices', { changes, effective_from: effective || undefined });
      cancel();
      data.reload();
      act.setMsg({ kind: 'ok', text: `${r.changed} price${r.changed === 1 ? '' : 's'} saved, effective from ${dmy(r.effective_from)}. Every change is in the price history and the audit log.` });
    } catch (e) {
      if (e.data && e.data.code === 'fields') { setErrors(e.data.fields || {}); }
      throw e;
    }
  });

  return (
    <section className="a-prices">
      <h1>Products and prices</h1>
      <InfoCard title="Price lists">
        <ul>
          <li>One price per SKU per list: Default, and one list per customer type (Commerce settings &gt; Customer types). An order takes the price of its customer&apos;s type on the order day.</li>
          <li>An empty cell on a customer type&apos;s list uses the Default price (greyed). A SKU without a Default price cannot be ordered: red <span className="a-miss">Missing</span>.</li>
          <li>Type prices, then Save in the bar at the bottom; choose a later &quot;effective from&quot; date to schedule them. Orders already taken keep their prices.</li>
          <li>Click a SKU for carton size, minimum order, HSN, GST rate and its full price history.</li>
        </ul>
      </InfoCard>
      <Loading state={data}>
        {d && (
          <>
            <PriceBasis basis={d.basis} />
            {d.demo && <Notice kind="warn">Commerce DEMO: these prices are demo values from the seed, not dFresh&apos;s real prices.</Notice>}
            {!canEdit && <Notice kind="info">Read only: your role can view prices but not change them.</Notice>}
            {act.note}
            <div className="a-toolbar">
              <label className="a-inline">Category{' '}
                <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{d.categories.map((c) => <option key={c.category_key} value={c.category_key}>{c.label}</option>)}</select>
              </label>
              <input type="search" placeholder="Search SKU or product" aria-label="Search SKU or product" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="a-chips" role="group" aria-label="Missing prices">
                <button type="button" className={`a-chip${missing === '' ? ' on' : ''}`} onClick={() => setMissing('')}>All {d.rows.length}</button>
                <button type="button" className={`a-chip${missing === 'default' ? ' on' : ''}`} onClick={() => setMissing('default')}>No Default price {noDefault}</button>
                <button type="button" className={`a-chip${missing === 'any' ? ' on' : ''}`} onClick={() => setMissing('any')}>Uses Default somewhere</button>
              </div>
              {canEdit && <button type="button" className="a-btn" disabled={dirty} title={dirty ? 'Save or cancel the typed prices first' : undefined} onClick={() => setPanel('bulk')}>Bulk change</button>}
              {canEdit && <button type="button" className="a-btn a-btn-ghost" disabled={dirty} onClick={() => setPanel('excel')}>Excel</button>}
            </div>
            <div className="a-scroll">
              <table className="a-table a-pricegrid">
                <thead>
                  <tr>
                    <th>SKU</th><th>Product</th><th className="a-num">GST</th><th className="a-num" title="Packs per carton">Carton</th><th className="a-num" title="Minimum order (packs)">Min</th>
                    {d.lists.map((l) => <th key={l.key} className="a-num">{l.label}{l.is_active ? '' : ' (off)'}<small className="a-muted a-person-sub">{d.basis.short}</small></th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sku_code} className={r.is_active ? undefined : 'a-off'}>
                      <td><button type="button" className="a-link" onClick={() => setOpen(r.sku_code)}><code>{r.sku_code}</code></button></td>
                      <td>{r.name}<small className="a-muted a-person-sub">{r.size_label}{r.is_active ? '' : ' - switched off'}</small></td>
                      <td className="a-num">{r.gst_rate}%</td>
                      <td className="a-num">{r.packs_per_carton}</td>
                      <td className="a-num">{r.min_order_qty}</td>
                      {d.lists.map((l) => {
                        const id = cellId(r.sku_code, l.key);
                        const own = r.own[l.key];
                        const t = typed(r.sku_code, l.key);
                        const shown = t !== undefined ? t : num(own);
                        const def = l.key === 'default' ? null : (typed(r.sku_code, 'default') ?? num(r.own.default));
                        const next = r.upcoming.filter((u) => u.list_key === l.key);
                        return (
                          <td key={l.key} className={`a-num a-pricecell${t !== undefined ? ' a-pending' : ''}${errors[id] ? ' a-cell-bad' : ''}`}>
                            {canEdit ? (
                              <input inputMode="decimal" value={shown} aria-label={`${r.sku_code} ${l.label} price`} aria-invalid={Boolean(errors[id])}
                                placeholder={def ? `= ${def}` : ''} title={errors[id] || (own == null && def ? `Uses the Default price (${def})` : undefined)}
                                onChange={(e) => setCell(r, l.key, e.target.value)} />
                            ) : (
                              own != null ? <span>{num(own)}</span> : <span className="a-muted" title="Uses the Default price">{def ? `= ${def}` : '-'}</span>
                            )}
                            {l.key === 'default' && own == null && t === undefined && <span className="a-miss">Missing</span>}
                            {errors[id] && <small className="a-bad" role="alert">{errors[id]}</small>}
                            {next.map((u) => <small key={u.effective_from} className="a-muted a-next">from {dmy(u.effective_from)}: {u.price == null ? 'Default' : u.price}</small>)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p className="a-muted">No SKU matches.</p>}
            </div>
            {dirty && (
              <div className="a-savebar" role="region" aria-label="Unsaved prices">
                <b>{Object.keys(edits).length} price change{Object.keys(edits).length === 1 ? '' : 's'}</b>
                <label className="a-inline">Effective from{' '}
                  <input type="date" min={d.today} value={effective || d.today} onChange={(e) => setEffective(e.target.value)} />
                </label>
                <span className="a-muted">{(effective || d.today) === d.today ? 'today: new orders use them at once' : 'scheduled: orders before that day keep the current prices'}</span>
                <span className="a-row">
                  <button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save</button>
                  <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={cancel}>Cancel</button>
                </span>
              </div>
            )}
            {open && <SkuDrawer sku={d.rows.find((r) => r.sku_code === open)} meta={d} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={data.reload} />}
            {panel === 'bulk' && <BulkDrawer meta={d} onClose={() => setPanel(null)} onSaved={(text) => { setPanel(null); data.reload(); act.setMsg({ kind: 'ok', text }); }} />}
            {panel === 'excel' && <ExcelDrawer meta={d} onClose={() => setPanel(null)} onApplied={data.reload} />}
          </>
        )}
      </Loading>
    </section>
  );
}

function SkuDrawer({ sku, meta, canEdit, onClose, onSaved }) {
  const hist = useLoad(`/prices/history/${encodeURIComponent(sku.sku_code)}`);
  const act = useAction();
  const [f, setF] = useState({ packs_per_carton: String(sku.packs_per_carton), min_order_qty: String(sku.min_order_qty), sell_unit: sku.sell_unit });
  const [tax, setTax] = useState({ hsn_code: sku.hsn_code, gst_rate: String(sku.gst_rate) });
  const [errors, setErrors] = useState({});
  const sizes = meta.rows.filter((r) => r.product_id === sku.product_id).length;
  const skuDirty = f.packs_per_carton !== String(sku.packs_per_carton) || f.min_order_qty !== String(sku.min_order_qty) || f.sell_unit !== sku.sell_unit;
  const taxDirty = tax.hsn_code !== sku.hsn_code || tax.gst_rate !== String(sku.gst_rate);
  const listLabel = (k) => (meta.lists.find((l) => l.key === k) || {}).label || k;
  const send = (path, body, text) => act.run(async () => {
    try {
      await api.send('PUT', path, body);
      setErrors({});
      onSaved();
    } catch (e) {
      if (e.data && e.data.code === 'fields') setErrors(e.data.fields || {});
      throw e;
    }
  }, text);
  return (
    <Drawer title={`${sku.sku_code} - ${sku.name}`} onClose={onClose} dirty={canEdit && (skuDirty || taxDirty)}>
      {act.note}
      <PriceBasis basis={meta.basis} />
      <p className="a-muted">{sku.size_label} · {sku.category}{sku.is_active ? '' : ' · switched off'}</p>
      <h3>Selling</h3>
      <fieldset className="a-plainset" disabled={!canEdit}>
        <div className="a-grid2">
          <label className="a-field"><span>Packs per carton</span><input inputMode="numeric" value={f.packs_per_carton} onChange={(e) => setF({ ...f, packs_per_carton: e.target.value })} />
            {errors.packs_per_carton && <small className="a-bad" role="alert">{errors.packs_per_carton}</small>}</label>
          <label className="a-field"><span>Minimum order (packs)</span><input inputMode="numeric" value={f.min_order_qty} onChange={(e) => setF({ ...f, min_order_qty: e.target.value })} />
            {errors.min_order_qty && <small className="a-bad" role="alert">{errors.min_order_qty}</small>}</label>
          <label className="a-field"><span>Sold in</span>
            <select value={f.sell_unit} onChange={(e) => setF({ ...f, sell_unit: e.target.value })}>
              {Object.entries(meta.sellUnits).map(([k, v]) => <option key={k} value={k}>{v}{k === 'carton' ? ' (full cartons only)' : ''}</option>)}
            </select></label>
        </div>
        {canEdit && <p><button type="button" className="a-btn a-btn-sm" disabled={!skuDirty || act.busy} onClick={() => send(`/prices/skus/${encodeURIComponent(sku.sku_code)}`, f, `${sku.sku_code}: selling rules saved`)}>Save selling rules</button></p>}
        <h3>Tax (the product: {sizes} size{sizes === 1 ? '' : 's'})</h3>
        <div className="a-grid2">
          <label className="a-field"><span>HSN code</span><input inputMode="numeric" maxLength={8} value={tax.hsn_code} onChange={(e) => setTax({ ...tax, hsn_code: e.target.value })} />
            {errors.hsn_code ? <small className="a-bad" role="alert">{errors.hsn_code}</small> : <small className="a-muted">4, 6 or 8 digits</small>}</label>
          <label className="a-field"><span>GST rate</span>
            <select value={tax.gst_rate} onChange={(e) => setTax({ ...tax, gst_rate: e.target.value })}>
              {[...new Set([...meta.gstRates, Number(sku.gst_rate)])].sort((a, b) => a - b).map((g) => <option key={g} value={String(g)}>{g} %{meta.gstRates.includes(g) ? '' : ' (no longer offered)'}</option>)}
            </select>
            {errors.gst_rate && <small className="a-bad" role="alert">{errors.gst_rate}</small>}</label>
        </div>
        {canEdit && <p><button type="button" className="a-btn a-btn-sm" disabled={!taxDirty || act.busy} onClick={() => send(`/prices/products/${encodeURIComponent(sku.product_id)}`, tax, `${sku.name}: HSN and GST saved for every size`)}>Save tax</button></p>}
      </fieldset>
      <h3>Prices today ({meta.basis.short})</h3>
      <table className="a-table">
        <tbody>{meta.lists.map((l) => {
          const own = sku.own[l.key];
          return <tr key={l.key}><th scope="row">{l.label}</th><td className="a-num">{own != null ? rs(own) : sku.own.default != null && l.key !== 'default' ? <span className="a-muted">{rs(sku.own.default)} (Default)</span> : <span className="a-miss">Missing</span>}</td></tr>;
        })}</tbody>
      </table>
      {sku.upcoming.length > 0 && <p>Scheduled: {sku.upcoming.map((u) => `${listLabel(u.list_key)} ${u.price == null ? 'back to Default' : rs(u.price)} from ${dmy(u.effective_from)}`).join('; ')}</p>}
      <h3>Price history</h3>
      <Loading state={hist}>
        {hist.data && (hist.data.length ? (
          <div className="a-scroll">
            <table className="a-table">
              <thead><tr><th>List</th><th className="a-num">Old</th><th className="a-num">New</th><th>Effective from</th><th>By</th><th>When</th></tr></thead>
              <tbody>{hist.data.map((h) => (
                <tr key={h.change_id}>
                  <td>{listLabel(h.list_key)}</td><td className="a-num">{h.old_price == null ? <span className="a-muted">-</span> : num(h.old_price)}</td>
                  <td className="a-num">{h.new_price == null ? <span className="a-muted">Default</span> : num(h.new_price)}</td>
                  <td>{dmy(h.effective_from)}</td><td>{h.emp_name || h.emp_id}<small className="a-muted a-person-sub">{SOURCE[h.source] || h.source}</small></td><td>{fmtDate(h.changed_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="a-muted">No price changes yet.</p>)}
      </Loading>
    </Drawer>
  );
}

function BulkDrawer({ meta, onClose, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({ list_key: 'all', category_key: '', mode: 'pct', value: '', rounding: '1', effective: meta.today });
  const [preview, setPreview] = useState(null); // { rows, fingerprint, key }
  const key = JSON.stringify(f);
  const fresh = preview && preview.key === key;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const listLabel = (k) => (meta.lists.find((l) => l.key === k) || {}).label || k;
  const run = () => act.run(async () => {
    setPreview(null);
    const r = await api.send('POST', '/prices/bulk', { ...f, preview: true });
    setPreview({ ...r, key });
  });
  const save = () => act.run(async () => {
    const r = await api.send('POST', '/prices/bulk', { ...f, preview: false, fingerprint: preview.fingerprint });
    onSaved(`Bulk change saved: ${r.changed} price${r.changed === 1 ? '' : 's'}, effective from ${dmy(r.effective)}.`);
  });
  return (
    <Drawer title="Bulk change" onClose={onClose} dirty={Boolean(f.value)}
      footer={<>
        <button type="button" className="a-btn a-btn-ghost" disabled={act.busy || !f.value} onClick={run}>Preview</button>
        <button type="button" className="a-btn" disabled={act.busy || !fresh || !preview.rows.length} onClick={save}>{fresh && preview.rows.length ? `Save ${preview.rows.length} prices` : 'Save'}</button>
      </>}>
      <PriceBasis basis={meta.basis} />
      <p className="a-muted">Moves the own prices of the chosen list(s); a list that uses the Default price follows the Default list. Preview first: Save is offered only for that preview.</p>
      {act.note}
      <div className="a-grid2">
        <label className="a-field"><span>Price list</span>
          <select value={f.list_key} onChange={(e) => set({ list_key: e.target.value })}><option value="all">All lists</option>{meta.lists.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        <label className="a-field"><span>Category</span>
          <select value={f.category_key} onChange={(e) => set({ category_key: e.target.value })}><option value="">All categories</option>{meta.categories.map((c) => <option key={c.category_key} value={c.category_key}>{c.label}</option>)}</select></label>
        <label className="a-field"><span>Change by</span>
          <select value={f.mode} onChange={(e) => set({ mode: e.target.value })}><option value="pct">Percent (%)</option><option value="amount">Rupees (Rs)</option></select></label>
        <label className="a-field"><span>{f.mode === 'pct' ? 'Percent (e.g. 5 or -3)' : 'Rupees (e.g. 2 or -1.50)'}</span>
          <input inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value })} /></label>
        <label className="a-field"><span>Round the new price to</span>
          <select value={f.rounding} onChange={(e) => set({ rounding: e.target.value })}><option value="1">Rs 1</option><option value="0.5">Rs 0.50</option><option value="0.01">Rs 0.01 (no rounding)</option></select></label>
        <label className="a-field"><span>Effective from</span><input type="date" min={meta.today} value={f.effective} onChange={(e) => set({ effective: e.target.value })} /></label>
      </div>
      {preview && !fresh && <Notice kind="warn">The choices changed since the preview: preview again.</Notice>}
      {preview && (
        preview.rows.length ? (
          <>
            <h3>Preview: {preview.rows.length} price{preview.rows.length === 1 ? '' : 's'} from {dmy(preview.effective)}</h3>
            <div className="a-scroll">
              <table className="a-table a-difftable">
                <thead><tr><th>SKU</th><th>Product</th><th>List</th><th className="a-num">Now</th><th className="a-num">New</th><th className="a-num">Change</th></tr></thead>
                <tbody>{preview.rows.map((r) => (
                  <tr key={`${r.sku_code}/${r.list_key}`}><td><code>{r.sku_code}</code></td><td>{r.name}<small className="a-muted a-person-sub">{r.size_label}</small></td><td>{listLabel(r.list_key)}</td>
                    <td className="a-num">{num(r.old_price)}</td><td className="a-num"><b>{num(r.new_price)}</b></td>
                    <td className="a-num">{r.new_price > r.old_price ? '+' : ''}{(r.new_price - r.old_price).toFixed(2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ) : <p className="a-muted">Nothing would change with these choices.</p>
      )}
    </Drawer>
  );
}

function ExcelDrawer({ meta, onClose, onApplied }) {
  const act = useAction();
  const up = useUpload();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [effective, setEffective] = useState(meta.today);
  const [report, setReport] = useState(null);
  const [applied, setApplied] = useState(null);
  const reset = () => { setFile(null); setReport(null); if (inputRef.current) inputRef.current.value = ''; };
  const exportXlsx = () => act.run(() => api.download('/prices/export.xlsx', 'dFresh_Price_List.xlsx'));
  const dryRun = () => act.run(async () => {
    setApplied(null);
    const r = await up.send('dry', `/prices/import?dryRun=1&effective=${effective}`, file);
    setReport({ ...r, file, effective });
  });
  const s = report && report.summary;
  const hasChanges = s && s.prices + s.skus + s.products > 0;
  const canApply = Boolean(report && report.ok && report.file === file && report.effective === effective && hasChanges);
  const apply = async () => {
    if (!(await confirm({ title: 'Apply this price list?', message: `${s.prices} price(s), ${s.skus} SKU(s) and ${s.products} product tax change(s), effective from ${dmy(effective)}.`, action: 'Apply', danger: true }))) return;
    act.run(async () => {
      const r = await up.send('apply', `/prices/import?dryRun=0&effective=${effective}&hash=${encodeURIComponent(report.fileHash)}`, file);
      setApplied(r.summary);
      reset();
      onApplied();
    });
  };
  return (
    <Drawer title="Price list in Excel" onClose={onClose}>
      <PriceBasis basis={meta.basis} />
      {act.note}
      <h3>Export</h3>
      <p>Every SKU with HSN, GST rate, carton size, minimum order, how it is sold and one Price_ column per list (today&apos;s own prices; empty = uses Default).</p>
      <button type="button" className="a-btn" disabled={act.busy} onClick={exportXlsx}>Download prices .xlsx</button>
      <h3>Import</h3>
      <p className="a-muted">Run the dry run: it lists every change and every error. Apply is offered only for that same file and date with 0 errors.</p>
      {applied && <Notice kind="ok">Applied: {applied.prices} price(s), {applied.skus} SKU(s), {applied.products} product tax change(s).</Notice>}
      <div className="a-toolbar">
        <input ref={inputRef} type="file" accept=".xlsx" aria-label="Price list file (.xlsx)" disabled={act.busy} onChange={(e) => { setFile(e.target.files[0] || null); setReport(null); setApplied(null); }} />
        <label className="a-inline">Effective from <input type="date" min={meta.today} value={effective} onChange={(e) => { setEffective(e.target.value); setReport(null); }} /></label>
        <button type="button" className="a-btn" disabled={!file || act.busy} onClick={dryRun}>{up.is('dry') ? <UploadProgress state={up.state} /> : 'Dry run'}</button>
        {canApply && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={apply}>{up.is('apply') ? <UploadProgress state={up.state} /> : 'Apply changes'}</button>}
      </div>
      {report && (
        <div className="a-report">
          <p><strong>Dry run ({dmy(report.effective)}):</strong> {s.prices} price change(s), {s.skus} SKU change(s), {s.products} product tax change(s), {s.errors} error(s).</p>
          {report.ok && !hasChanges && <p className="a-muted">No differences: nothing to apply.</p>}
          {report.errors.length > 0 && <Notice kind="error"><ul>{report.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
          {report.unknownColumns.length > 0 && <Notice kind="warn">Unknown columns (not imported): {report.unknownColumns.join(', ')}</Notice>}
          {report.notes.map((n) => <Notice key={n}>{n}</Notice>)}
          {report.prices.length > 0 && (
            <table className="a-table a-difftable">
              <thead><tr><th>SKU</th><th>List</th><th className="a-num">Now</th><th className="a-num">From the sheet</th></tr></thead>
              <tbody>{report.prices.map((p) => <tr key={`${p.sku_code}/${p.list}`}><td><code>{p.sku_code}</code> <small className="a-muted">{p.name}</small></td><td>{p.list}</td><td className="a-num">{p.before == null ? '-' : num(p.before)}</td><td className="a-num">{p.after == null ? 'Default' : num(p.after)}</td></tr>)}</tbody>
            </table>
          )}
          {[...report.skus.map((x) => ({ ...x, who: x.sku_code })), ...report.products.map((x) => ({ ...x, who: `${x.product_id} (${x.name})` }))].length > 0 && (
            <table className="a-table a-difftable">
              <thead><tr><th>SKU / product</th><th>Field</th><th>Now</th><th>From the sheet</th></tr></thead>
              <tbody>{[...report.skus.map((x) => ({ ...x, who: x.sku_code })), ...report.products.map((x) => ({ ...x, who: `${x.product_id} (${x.name})` }))].map((x) => (
                <tr key={`${x.who}-${x.field}`}><td><code>{x.who}</code></td><td>{x.field}</td><td>{String(x.before)}</td><td>{String(x.after)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </Drawer>
  );
}
