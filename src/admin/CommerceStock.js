// Commerce > Inventory (docs/COMMERCE-SPEC.md 4.4; API /commerce/stock ..., logic in src/backend_routes/stock.js), at
// one location, the Kanchipuram godown. Tabs (?tab=):
// - Stock: per SKU good, expired (batches past expiry, blocked from orders), reserved by confirmed orders, available,
//   returned (R), damaged; reorder level and quantity (edit); average cost and stock value (only for a role that can
//   view Reports or Products and prices). Record: good -> damaged, or packs back into Returned (R).
// - Stock in, Write-offs, Counts, Suppliers: InventoryWork.js.
// - Batches: every batch with good stock, Expired / Near expiry (Commerce setting days) / OK.
// - Reorder: SKUs whose available stock is below the reorder level, with a suggested quantity in full cartons.
// - Movements: every change of stock with filters (SKU, type, dates, who, batch) and an Excel export (edit).
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, fmtDate, useAction, useCan, useLoad } from './ui';
import { StockIns, WriteOffs, Counts, Suppliers } from './InventoryWork';

const TABS = [['stock', 'Stock'], ['in', 'Stock in'], ['batches', 'Batches'], ['writeoffs', 'Write-offs'], ['counts', 'Counts'], ['reorder', 'Reorder'], ['moves', 'Movements'], ['suppliers', 'Suppliers']];
const KIND = { good: 'Good', returned: 'Returned (R)', damaged: 'Damaged' };
const rs = (n) => (n === null || n === undefined ? '-' : `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function CommerceStock() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = new URLSearchParams(location.search).get('tab') || 'stock';
  const stock = useLoad('/commerce/stock');
  const setTab = (t) => navigate(`/admin/commerce/stock${t === 'stock' ? '' : `?tab=${t}`}`);
  return (
    <section>
      <h1>Inventory</h1>
      <InfoCard title="Stock at the Kanchipuram godown">
        <ul>
          <li>Stock is the sum of movements, never typed in. It comes in through Stock in (production or purchase) and goes out at dispatch, by write-off or by an approved count.</li>
          <li>Available = good stock - expired batches - stock reserved by confirmed orders. Products tracked by batch go out earliest expiry first; expired stock cannot be ordered.</li>
          <li>Write-offs above the threshold and count differences wait for approval (Setup &gt; Approvals).</li>
        </ul>
      </InfoCard>
      <div className="a-chips a-tabs" role="tablist" aria-label="Inventory">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'stock' && <StockTab stock={stock} />}
      {tab === 'in' && <StockIns stock={stock} />}
      {tab === 'batches' && <Batches />}
      {tab === 'writeoffs' && <WriteOffs stock={stock} />}
      {tab === 'counts' && <Counts />}
      {tab === 'reorder' && <Reorder />}
      {tab === 'moves' && <Movements />}
      {tab === 'suppliers' && <Suppliers />}
    </section>
  );
}

function StockTab({ stock }) {
  const canEdit = useCan('inventory', 'edit');
  const canRecord = useCan('inventory', 'create');
  const act = useAction();
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [form, setForm] = useState({ sku_code: '', move_type: 'damaged', qty: '', note: '' });
  const [levels, setLevels] = useState({}); // sku -> { reorder_level, reorder_qty } typed (pending)
  const d = stock.data;
  const rows = useMemo(() => (d ? d.rows : []), [d]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!lowOnly || r.low) && (!s || [r.sku_code, r.name, r.size_label].some((v) => String(v).toLowerCase().includes(s))));
  }, [rows, q, lowOnly]);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const record = (e) => {
    e.preventDefault();
    act.run(async () => {
      await api.send('POST', '/commerce/movements', { ...form, sku_code: form.sku_code.trim().toUpperCase(), qty: Number(form.qty) });
      setForm({ ...form, qty: '', note: '' });
      stock.reload();
    }, `${form.move_type === 'damaged' ? 'Moved to damaged' : 'Back into Returned (R)'}: ${form.qty} x ${form.sku_code.toUpperCase()}`);
  };
  const lv = (r) => levels[r.sku_code] || { reorder_level: String(r.reorder_level), reorder_qty: String(r.reorder_qty) };
  const lvDirty = (r) => Boolean(levels[r.sku_code]) && (levels[r.sku_code].reorder_level !== String(r.reorder_level) || levels[r.sku_code].reorder_qty !== String(r.reorder_qty));
  const saveLevel = (r) => act.run(async () => {
    await api.send('PUT', `/commerce/stock/${encodeURIComponent(r.sku_code)}/levels`, { reorder_level: Number(lv(r).reorder_level), reorder_qty: Number(lv(r).reorder_qty) });
    setLevels((l) => { const n = { ...l }; delete n[r.sku_code]; return n; });
    stock.reload();
  }, `Reorder level for ${r.sku_code} saved`);

  return (
    <Loading state={stock}>
      {d && (
        <>
          {act.note}
          <div className="a-stats">
            <div className="a-stat"><b>{sum('good')}</b><span>packs good</span></div>
            <div className="a-stat"><b>{sum('available')}</b><span>available</span></div>
            <div className="a-stat"><b>{sum('reserved')}</b><span>reserved for orders</span></div>
            {sum('expired') > 0 && <div className="a-stat a-stat-bad"><b>{sum('expired')}</b><span>expired (blocked)</span></div>}
            <div className={`a-stat${rows.some((r) => r.low) ? ' a-stat-bad' : ''}`}><b>{rows.filter((r) => r.low).length}</b><span>below reorder level</span></div>
            {d.seesCost && <div className="a-stat"><b>{rs(d.totalValue)}</b><span>stock value (average cost)</span></div>}
          </div>
          <div className="a-toolbar">
            <input type="search" placeholder="Search SKU or product" aria-label="Search stock" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="a-inline"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Below reorder level only</label>
          </div>
          <div className="a-scroll">
            <table className="a-table a-stocktable">
              <thead><tr>
                <th>SKU</th><th>Product</th><th className="a-num">Good</th><th className="a-num" title="Batches past their expiry date">Expired</th><th className="a-num" title="Held by confirmed orders">Reserved</th>
                <th className="a-num" title="Good - expired - reserved">Available</th><th className="a-num">(R)</th><th className="a-num">Damaged</th><th>Reorder level / qty</th>
                {d.seesCost && <><th className="a-num">Avg cost</th><th className="a-num">Value</th></>}<th>Last movement</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.sku_code} className={r.low ? 'a-lowrow' : undefined}>
                    <td><code>{r.sku_code}</code>{r.track_batches && <small className="a-muted a-person-sub">batches: {r.batches}</small>}</td>
                    <td>{r.name} <small className="a-muted">{r.size_label}</small></td>
                    <td className="a-num"><b>{r.good}</b></td>
                    <td className={`a-num${r.expired ? ' a-bad' : ''}`}>{r.expired || ''}</td>
                    <td className="a-num">{r.reserved || ''}</td>
                    <td className={`a-num${r.available < 0 ? ' a-bad' : ''}`}><b>{r.available}</b> {r.low && <span className="a-status a-status-bad">Low</span>}</td>
                    <td className="a-num">{r.returned || ''}</td>
                    <td className="a-num">{r.damaged || ''}</td>
                    <td>
                      {canEdit ? (
                        <span className="a-row">
                          <input type="number" min="0" step="1" className="a-qty" aria-label={`Reorder level ${r.sku_code}`} value={lv(r).reorder_level} onChange={(e) => setLevels({ ...levels, [r.sku_code]: { ...lv(r), reorder_level: e.target.value } })} />
                          <input type="number" min="0" step="1" className="a-qty" aria-label={`Reorder qty ${r.sku_code}`} value={lv(r).reorder_qty} onChange={(e) => setLevels({ ...levels, [r.sku_code]: { ...lv(r), reorder_qty: e.target.value } })} />
                          {lvDirty(r) && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => saveLevel(r)}>Save</button>}
                        </span>
                      ) : `${r.reorder_level} / ${r.reorder_qty || 'suggest'}`}
                    </td>
                    {d.seesCost && <><td className="a-num">{rs(r.avg_cost)}</td><td className="a-num">{rs(r.value)}</td></>}
                    <td>{fmtDate(r.last_move)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canRecord && (
            <form className="a-card a-moveform" onSubmit={record}>
              <h2>Record damaged or returned packs</h2>
              <p className="a-muted">Stock in, write-offs and counts have their own tabs. Here: good packs found damaged in the godown, or packs back into Returned (R).</p>
              <div className="a-toolbar">
                <label className="a-field"><span>SKU (scan or type)</span><input value={form.sku_code} list="stock-skus" onChange={(e) => setForm({ ...form, sku_code: e.target.value })} required /></label>
                <datalist id="stock-skus">{rows.map((r) => <option key={r.sku_code} value={r.sku_code}>{r.name}</option>)}</datalist>
                <label className="a-field"><span>What</span><select value={form.move_type} onChange={(e) => setForm({ ...form, move_type: e.target.value })}><option value="damaged">Damaged (good -&gt; damaged)</option><option value="return">Returned (to (R) stock)</option></select></label>
                <label className="a-field"><span>Packs</span><input className="a-qty" type="number" min="1" step="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required /></label>
                <label className="a-field"><span>Note</span><input value={form.note} maxLength={255} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                <button type="submit" className="a-btn" disabled={act.busy}>Record</button>
              </div>
            </form>
          )}
        </>
      )}
    </Loading>
  );
}

function Batches() {
  const data = useLoad('/commerce/batches');
  const [show, setShow] = useState('stock'); // stock | near | expired | all
  const d = data.data;
  const rows = d ? d.rows.filter((r) => (show === 'all' ? true : show === 'stock' ? r.good > 0 : r.state === show && r.good > 0)) : [];
  const n = (st) => (d ? d.rows.filter((r) => r.state === st && r.good > 0).length : 0);
  return (
    <Loading state={data}>
      {d && (
        <>
          <p className="a-muted">Near expiry = within {d.warnDays} days (Commerce settings &gt; Inventory). Expired stock is blocked from orders: write it off.</p>
          <div className="a-chips" role="group" aria-label="Batches">
            {[['stock', 'With stock'], ['near', `Near expiry ${n('near')}`], ['expired', `Expired ${n('expired')}`], ['all', 'All']].map(([k, l]) => <button key={k} type="button" className={`a-chip${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
          </div>
          <div className="a-scroll">
            <table className="a-table">
              <thead><tr><th>SKU</th><th>Product</th><th>Batch</th><th>Made</th><th>Expires</th><th>State</th><th className="a-num">Good</th><th className="a-num">Damaged</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.batch_id}><td><code>{r.sku_code}</code></td><td>{r.name} <small className="a-muted">{r.size_label}</small></td><td><b>{r.batch_no}</b></td><td>{day(r.mfg_date)}</td><td>{day(r.expiry_date)}</td>
                  <td>{r.state === 'expired' ? <span className="a-status a-status-bad">Expired {-r.days_left} days ago</span> : r.state === 'near' ? <span className="a-status a-status-test">Expires in {r.days_left} days</span> : <span className="a-muted">{r.days_left} days left</span>}</td>
                  <td className="a-num">{r.good}</td><td className="a-num">{r.damaged || ''}</td></tr>
              ))}</tbody>
            </table>
            {!rows.length && <p className="a-muted">No batch here.</p>}
          </div>
        </>
      )}
    </Loading>
  );
}

function Reorder() {
  const data = useLoad('/commerce/reorder');
  return (
    <Loading state={data}>
      {data.data && (
        data.data.length ? (
          <>
            <p className="a-muted">SKUs whose available stock is below the reorder level. Suggested = the reorder quantity, or up to twice the level, in full cartons.</p>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>SKU</th><th>Product</th><th className="a-num">Available</th><th className="a-num">Reorder level</th><th className="a-num">Suggested</th><th className="a-num">Cartons</th></tr></thead>
                <tbody>{data.data.map((r) => (
                  <tr key={r.sku_code}><td><code>{r.sku_code}</code></td><td>{r.name} <small className="a-muted">{r.size_label}</small></td><td className="a-num a-bad">{r.available}</td>
                    <td className="a-num">{r.reorder_level}</td><td className="a-num"><b>{r.suggested}</b></td><td className="a-num">{r.cartons} x {r.packs_per_carton}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ) : <p className="a-muted">Every SKU is above its reorder level.</p>
      )}
    </Loading>
  );
}

function Movements() {
  const [f, setF] = useState({ sku: '', type: '', from: '', to: '', emp: '', batch: '' });
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const data = useLoad(`/commerce/movements${qs ? `?${qs}` : ''}`);
  const canExport = useCan('inventory', 'edit');
  const act = useAction();
  const d = data.data;
  // the filter choices stay while the list reloads
  const [types, setTypes] = useState({});
  const [who, setWho] = useState([]);
  useEffect(() => { if (d) { setTypes(d.types); setWho(d.who); } }, [d]);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const cost = Boolean(d && d.rows.some((r) => 'unit_cost' in r));
  return (
    <>
      {act.note}
      <div className="a-filters">
        <label>SKU <input value={f.sku} size={12} aria-label="Filter SKU" onChange={(e) => set({ sku: e.target.value.trim() })} /></label>
        <label>Type <select value={f.type} aria-label="Filter type" onChange={(e) => set({ type: e.target.value })}><option value="">All</option>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Who <select value={f.emp} aria-label="Filter who" onChange={(e) => set({ emp: e.target.value })}><option value="">Anyone</option>{who.map((w) => <option key={w.emp_id} value={w.emp_id}>{w.name || w.emp_id} ({w.emp_id})</option>)}</select></label>
        <label>Batch <input value={f.batch} size={9} aria-label="Filter batch" onChange={(e) => set({ batch: e.target.value.trim() })} /></label>
        <label>From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {canExport && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => act.run(() => api.download(`/commerce/movements/export.xlsx${qs ? `?${qs}` : ''}`, 'dFresh_Stock_Movements.xlsx'))}>Excel</button>}
      </div>
      <Loading state={data}>
        {d && (
          <div className="a-scroll">
            <table className="a-table a-moves">
              <thead><tr><th>When</th><th>SKU</th><th>Type</th><th className="a-num">Change</th><th>Stock</th><th>Batch</th>{cost && <th className="a-num">Cost / pack</th>}<th>Reference / note</th><th>Who</th></tr></thead>
              <tbody>
                {d.rows.map((m) => (
                  <tr key={m.move_id}>
                    <td>{fmtDate(m.created_at)}</td>
                    <td><code>{m.sku_code}{m.stock_kind === 'returned' ? ' (R)' : ''}</code></td>
                    <td>{m.type_label}</td>
                    <td className={`a-num ${m.delta < 0 ? 'a-bad' : ''}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                    <td>{KIND[m.stock_kind]}</td>
                    <td>{m.batch_no || ''}</td>
                    {cost && <td className="a-num">{m.unit_cost == null ? '' : rs(m.unit_cost)}</td>}
                    <td>{m.ref_type ? <small className="a-muted">{m.ref_type} {m.ref_id} </small> : null}{m.note}</td>
                    <td>{m.emp_name || m.emp_id} <small className="a-muted">{m.emp_id}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.rows.length && <p className="a-muted">No movement matches.</p>}
          </div>
        )}
      </Loading>
    </>
  );
}
