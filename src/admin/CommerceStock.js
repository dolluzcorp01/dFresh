// Inventory (docs/COMMERCE-SPEC.md 4.4; API /commerce/stock ..., logic in src/backend_routes/stock.js), per godown
// (phase 12a: the godowns in view, the header picker narrows them). Tabs (?tab=), in the order stock moves:
// Stock in, Stock (the default), Batches, Reorder, Counts, Write-offs, Movements.
// - Stock: per godown and SKU good, expired (batches past expiry, blocked from orders), reserved by confirmed orders,
//   available, and the other shelves (labels from the API: QC hold, Damaged, Returned (R), Rejected, Display); reorder
//   level and quantity per godown (edit); average cost and stock value (only for a role with See cost). Record: good ->
//   damaged, or packs back into Returned (R), in one godown. Recheck (phase 6): Returned (R) packs back to good stock,
//   only when Commerce settings allow resale, always through approval.
// - Stock in, Write-offs, Counts: InventoryWork.js (Suppliers moved to Masters > Partners > Suppliers in phase 16).
// - Batches: every batch with good stock, Expired / Near expiry (Commerce setting days) / OK.
// - Reorder: SKUs whose available stock is below the reorder level, with a suggested quantity in full cartons.
// - Movements: every change of stock with filters (SKU, type, dates, who, batch) and an Excel export (edit).
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, PageHead, Pill, Table, Tabs, fmtDate, useAction, useCan, useLoad } from './ui';
import { StockIns, WriteOffs, Counts } from './InventoryWork';
import GodownField, { useGodown } from './GodownField';

// the shelves besides Good, in the order of the stock table (labels come from the API: stock.KIND_LABEL)
const SHELF_COLS = [['hold', 'hold'], ['damaged', 'dmg'], ['returned', 'ret'], ['rejected', 'rej'], ['display', 'disp']];
// in the order stock moves (suppliers: Masters > Partners > Suppliers, phase 16): what comes in, what is there (the default tab), by batch, what to reorder, counting it,
// writing off, and the full movement log
const TABS = [['in', 'Stock in'], ['stock', 'Stock'], ['batches', 'Batches'], ['reorder', 'Reorder'], ['counts', 'Counts'], ['writeoffs', 'Write-offs'], ['moves', 'Movements']];
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
      <PageHead sub="What we have in each godown, how it came in and how it left." />
      <InfoCard title="Stock per godown">
        <ul>
          <li>Stock is the sum of movements, never typed in. It comes in through Stock in (production) or Purchase > Goods in (bought, after Quality check) and goes out at dispatch, by write-off or by an approved count.</li>
          <li>Available = good stock - expired batches - stock reserved by confirmed orders. Products tracked by batch go out earliest expiry first; expired stock cannot be ordered.</li>
          <li>Each godown has its own stock, reorder levels and counts; the godown picker at the top shows one godown or all of yours.</li>
          <li>Write-offs above the threshold and count differences wait for approval (Approvals, top of the menu).</li>
        </ul>
      </InfoCard>
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label }))} value={tab} onChange={setTab} label="Inventory" />
      {tab === 'stock' && <StockTab stock={stock} />}
      {tab === 'in' && <StockIns stock={stock} />}
      {tab === 'batches' && <Batches />}
      {tab === 'writeoffs' && <WriteOffs stock={stock} />}
      {tab === 'counts' && <Counts />}
      {tab === 'reorder' && <Reorder />}
      {tab === 'moves' && <Movements />}
      {tab === 'suppliers' && <Navigate to="/admin/suppliers" replace />}
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
  const [godown, setGodown, godownList] = useGodown();
  const [levels, setLevels] = useState({}); // godown-sku -> { reorder_level, reorder_qty } typed (pending)
  const d = stock.data;
  const rows = useMemo(() => (d ? d.rows : []), [d]);
  const many = Boolean(d && d.godowns.length > 1); // more than one godown in view: a Godown column
  const shelves = d ? SHELF_COLS.filter(([k, kind]) => ['dmg', 'ret'].includes(kind) || rows.some((r) => r[k])) : [];
  const key = (r) => `${r.godown_id}-${r.sku_code}`;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!lowOnly || r.low) && (!s || [r.sku_code, r.name, r.size_label].some((v) => String(v).toLowerCase().includes(s))));
  }, [rows, q, lowOnly]);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const record = (e) => {
    e.preventDefault();
    act.run(async () => {
      await api.send('POST', '/commerce/movements', { ...form, godown_id: godown, sku_code: form.sku_code.trim().toUpperCase(), qty: Number(form.qty) });
      setForm({ ...form, qty: '', note: '' });
      stock.reload();
    }, `${form.move_type === 'damaged' ? 'Moved to damaged' : 'Back into Returned (R)'}: ${form.qty} x ${form.sku_code.toUpperCase()}`);
  };
  const lv = (r) => levels[key(r)] || { reorder_level: String(r.reorder_level), reorder_qty: String(r.reorder_qty), bin_location: r.bin_location || '' };
  const lvDirty = (r) => Boolean(levels[key(r)]) && (levels[key(r)].reorder_level !== String(r.reorder_level) || levels[key(r)].reorder_qty !== String(r.reorder_qty)
    || levels[key(r)].bin_location !== (r.bin_location || ''));
  const saveLevel = (r) => act.run(async () => {
    await api.send('PUT', `/commerce/stock/${encodeURIComponent(r.sku_code)}/levels`, { godown_id: r.godown_id, reorder_level: Number(lv(r).reorder_level), reorder_qty: Number(lv(r).reorder_qty), bin_location: lv(r).bin_location });
    setLevels((l) => { const n = { ...l }; delete n[key(r)]; return n; });
    stock.reload();
  }, `${r.sku_code} saved`);

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
                {many && <th>Godown</th>}<th>SKU</th><th>Product</th><th className="a-num">Good</th><th className="a-num" title="Batches past their expiry date">Expired</th><th className="a-num" title="Held by confirmed orders">Reserved</th>
                <th className="a-num" title="Good - expired - reserved">Available</th>{shelves.map(([k, kind]) => <th key={k} className="a-num">{d.shelves[kind]}</th>)}<th>Bin · reorder level / qty</th>
                {d.seesCost && <><th className="a-num">Avg cost</th><th className="a-num">Value</th></>}<th>Last movement</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={key(r)} className={r.low ? 'a-lowrow' : undefined}>
                    {many && <td title={r.godown}>{r.godown_code}</td>}
                    <td><code>{r.sku_code}</code>{r.track_batches && <small className="a-muted a-person-sub">batches: {r.batches}</small>}</td>
                    <td>{r.name} <small className="a-muted">{r.size_label}</small></td>
                    <td className="a-num"><b>{r.good}</b></td>
                    <td className={`a-num${r.expired ? ' a-bad' : ''}`}>{r.expired || ''}</td>
                    <td className="a-num">{r.reserved || ''}</td>
                    <td className={`a-num${r.available < 0 ? ' a-bad' : ''}`}><b>{r.available}</b> {r.low && <span className="a-status a-status-bad">Low</span>}</td>
                    {shelves.map(([k]) => <td key={k} className="a-num">{r[k] || ''}</td>)}
                    <td>
                      {canEdit ? (
                        <span className="a-row">
                          <input className="a-bin" maxLength={30} aria-label={`Bin ${r.sku_code}`} placeholder="Bin" value={lv(r).bin_location} onChange={(e) => setLevels({ ...levels, [r.sku_code]: { ...lv(r), bin_location: e.target.value } })} />
                          <input type="number" min="0" step="1" className="a-qty" aria-label={`Reorder level ${r.sku_code}`} value={lv(r).reorder_level} onChange={(e) => setLevels({ ...levels, [r.sku_code]: { ...lv(r), reorder_level: e.target.value } })} />
                          <input type="number" min="0" step="1" className="a-qty" aria-label={`Reorder qty ${r.sku_code}`} value={lv(r).reorder_qty} onChange={(e) => setLevels({ ...levels, [r.sku_code]: { ...lv(r), reorder_qty: e.target.value } })} />
                          {lvDirty(r) && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => saveLevel(r)}>Save</button>}
                        </span>
                      ) : `${r.bin_location ? `${r.bin_location} · ` : ''}${r.reorder_level} / ${r.reorder_qty || 'suggest'}`}
                    </td>
                    {d.seesCost && <><td className="a-num">{rs(r.avg_cost)}</td><td className="a-num">{rs(r.value)}</td></>}
                    <td>{fmtDate(r.last_move)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && rows.some((r) => r.returned > 0) && <Recheck rows={rows.filter((r) => r.returned > 0)} resell={d.resell} many={many} />}
          {canRecord && (
            <form className="a-card a-moveform" onSubmit={record}>
              <h2>Record damaged or returned packs</h2>
              <p className="a-muted">Stock in, write-offs and counts have their own tabs. Here: good packs found damaged in the godown, or packs back into Returned (R).</p>
              <div className="a-toolbar">
                <GodownField value={godown} onChange={setGodown} list={godownList} />
                <label className="a-field"><span>SKU (scan or type)</span><input value={form.sku_code} list="stock-skus" onChange={(e) => setForm({ ...form, sku_code: e.target.value })} required /></label>
                <datalist id="stock-skus">{rows.filter((r) => String(r.godown_id) === godown).map((r) => <option key={r.sku_code} value={r.sku_code}>{r.name}</option>)}</datalist>
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

/** Recheck: Returned (R) packs back to good stock (approval); only when the setting allows resale */
function Recheck({ rows, resell, many }) {
  const act = useAction();
  const [f, setF] = useState({ row: '', batch_id: '', qty: '', note: '' }); // row = godown-sku
  const row = rows.find((r) => `${r.godown_id}-${r.sku_code}` === f.row);
  const batches = useLoad(row && row.track_batches ? `/commerce/batches?sku=${encodeURIComponent(row.sku_code)}&kind=ret&godown_id=${row.godown_id}` : null);
  const save = (e) => {
    e.preventDefault();
    act.run(async () => {
      const r = await api.send('POST', '/commerce/stock/recheck', { godown_id: row.godown_id, sku_code: row.sku_code, batch_id: f.batch_id, qty: Number(f.qty), note: f.note });
      setF({ row: '', batch_id: '', qty: '', note: '' });
      act.setMsg({ kind: 'info', text: `Recheck of ${f.qty} x ${row.sku_code} sent for approval (request #${r.approval_id}): the packs move to good stock when it is approved.` });
    });
  };
  return (
    <form className="a-card a-moveform" onSubmit={save}>
      <h2>Recheck Returned (R) packs</h2>
      {act.note}
      {!resell ? <p className="a-muted">Returned stock cannot be sold again (Commerce settings &gt; Returns): it stays in (R) until written off.</p> : (
        <>
          <p className="a-muted">Packs checked again and fit to sell move from (R) to good stock after approval (Approvals, top of the menu).</p>
          <div className="a-toolbar">
            <label className="a-field"><span>SKU</span><select value={f.row} aria-label="Recheck SKU" onChange={(e) => setF({ ...f, row: e.target.value, batch_id: '' })} required>
              <option value="">Choose...</option>{rows.map((r) => <option key={`${r.godown_id}-${r.sku_code}`} value={`${r.godown_id}-${r.sku_code}`}>{many ? `${r.godown_code} ` : ''}{r.sku_code} ({r.returned} in (R))</option>)}</select></label>
            {row && row.track_batches && (
              <label className="a-field"><span>Batch</span><select value={f.batch_id} aria-label="Recheck batch" onChange={(e) => setF({ ...f, batch_id: e.target.value })}>
                <option value="">Choose...</option>{(batches.data ? batches.data.rows : []).map((b) => <option key={b.batch_id || 'none'} value={b.batch_id || ''}>{b.batch_no || 'no batch'} ({b.qty}){b.expired ? ' expired' : ''}</option>)}</select></label>
            )}
            <label className="a-field"><span>Packs</span><input className="a-qty" type="number" min="1" step="1" value={f.qty} aria-label="Recheck packs" onChange={(e) => setF({ ...f, qty: e.target.value })} required /></label>
            <label className="a-field"><span>What did the check find?</span><input value={f.note} maxLength={200} aria-label="Recheck note" placeholder="sealed, clean, sellable" onChange={(e) => setF({ ...f, note: e.target.value })} required /></label>
            <button type="submit" className="a-btn" disabled={act.busy}>Ask to move to good stock</button>
          </div>
        </>
      )}
    </form>
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
          <Table label="Batches" rows={rows} rowKey={(r) => r.batch_id} empty={{ icon: 'package', title: 'No batch here.' }}
            columns={[
              { key: 'sku_code', label: 'SKU', sort: true, render: (r) => <code>{r.sku_code}</code> },
              { key: 'name', label: 'Product', sort: true, render: (r) => <>{r.name} <small className="a-muted">{r.size_label}</small></> },
              { key: 'batch_no', label: 'Batch', sort: true, render: (r) => <b>{r.batch_no}</b> },
              { key: 'mfg_date', label: 'Made', sort: true, render: (r) => day(r.mfg_date) },
              { key: 'expiry_date', label: 'Expires', sort: true, render: (r) => day(r.expiry_date) },
              { key: 'state', label: 'State', render: (r) => (r.state === 'expired' ? <Pill tone="bad">Expired {-r.days_left} days ago</Pill> : r.state === 'near' ? <Pill tone="warn">Expires in {r.days_left} days</Pill> : <span className="a-muted">{r.days_left} days left</span>) },
              { key: 'good', label: 'Good', num: true, sort: true },
              { key: 'damaged', label: 'Damaged', num: true, sort: true, render: (r) => r.damaged || '' },
            ]} />
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
            <Table label="Reorder" rows={data.data} rowKey={(r) => `${r.godown_id}-${r.sku_code}`}
              columns={[
                { key: 'godown_code', label: 'Godown', sort: true, render: (r) => <span title={r.godown}>{r.godown_code}</span> },
                { key: 'sku_code', label: 'SKU', sort: true, render: (r) => <code>{r.sku_code}</code> },
                { key: 'name', label: 'Product', sort: true, render: (r) => <>{r.name} <small className="a-muted">{r.size_label}</small></> },
                { key: 'available', label: 'Available', num: true, sort: true, render: (r) => <span className="a-bad">{r.available}</span> },
                { key: 'reorder_level', label: 'Reorder level', num: true, sort: true },
                { key: 'suggested', label: 'Suggested', num: true, sort: true, render: (r) => <b>{r.suggested}</b> },
                { key: 'cartons', label: 'Cartons', num: true, render: (r) => `${r.cartons} x ${r.packs_per_carton}` },
              ]} />
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
  const canExport = useCan('inventory', 'export');
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
          <Table label="Movements" className="a-moves" rows={d.rows} rowKey={(m) => m.move_id} empty={{ icon: 'arrow-up-down', title: 'No movement matches.' }}
            columns={[
              { key: 'created_at', label: 'When', sort: true, render: (m) => fmtDate(m.created_at) },
              { key: 'godown_code', label: 'Godown', sort: true },
              { key: 'sku_code', label: 'SKU', sort: true, render: (m) => <code>{m.sku_code}{m.stock_kind === 'ret' ? ' (R)' : ''}</code> },
              { key: 'type_label', label: 'Type', sort: true },
              { key: 'delta', label: 'Change', num: true, sort: true, render: (m) => <span className={m.delta < 0 ? 'a-bad' : undefined}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span> },
              { key: 'stock_kind', label: 'Shelf', render: (m) => m.shelf_label },
              { key: 'batch_no', label: 'Batch', render: (m) => m.batch_no || '' },
              cost && { key: 'unit_cost', label: 'Cost / pack', num: true, render: (m) => (m.unit_cost == null ? '' : rs(m.unit_cost)) },
              { key: 'note', label: 'Reference / note', render: (m) => <>{m.ref_type ? <small className="a-muted">{m.ref_type} {m.ref_id} </small> : null}{m.note}</> },
              { key: 'who', label: 'Who', render: (m) => <>{m.emp_name || m.emp_id} <small className="a-muted">{m.emp_id}</small></> },
            ].filter(Boolean)} />
        )}
      </Loading>
    </>
  );
}
