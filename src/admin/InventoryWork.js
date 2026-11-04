// Inventory: the tabs where stock is changed (API in src/backend_routes/stock.js via Admin_server.js).
// Godowns (phase 12a): a stock in, a write-off and a count each belong to one godown (the Godown select, GodownField.js).
// - Stock in: Production (our Kanchipuram unit; until phase 17 Production runs). Bought goods come in through Purchase >
//   Goods in (phase 16: against a PO, to QC hold); the purchase stock-ins of before stay listed. Date, reference (batch sheet no.),
//   lines in packs or cartons with the cost per pack; a scanner (or typing a SKU and Enter) adds a line or one more of
//   it. Batch-tracked products ask for batch no., manufacture and expiry date. A role that can see costs sees the
//   average cost before -> after.
// - Write-offs: damaged / expired / lost / sample, from a shelf (good, QC hold, damaged, returned...: labels from the API) (a batch for tracked products),
//   reason, photo optional; above the Commerce setting thresholds it waits for approval.
// - Counts: all SKUs or a category; enter or scan the counted packs, see the difference with the system; submit sends
//   the differences to approval, which posts them as count movements.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './adminApi';
import { Drawer, Loading, Notice, Pill, Table, UploadProgress, fmtDate, useAction, useCan, useConfirm, useLoad, useUpload } from './ui';
import GodownField, { useGodown } from './GodownField';
const rs = (n) => (n === null || n === undefined ? '-' : `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
// a stock row's packs on a shelf (the /commerce/stock row's field for each shelf)
const SHELF_FIELD = { good: 'good', hold: 'hold', dmg: 'damaged', ret: 'returned', rej: 'rejected', disp: 'display' };
/** the /commerce/stock rows of one godown, by SKU */
const skusOf = (stock, godown) => new Map(((stock.data && stock.data.rows) || []).filter((r) => String(r.godown_id) === String(godown)).map((r) => [r.sku_code, r]));

/** a scan box: a barcode scanner types the code and Enter; onCode(code) */
function ScanBox({ onCode, label = 'Scan a barcode or type a SKU and press Enter' }) {
  const [v, setV] = useState('');
  return (
    <label className="a-field a-scanbox"><span>{label}</span>
      <input value={v} aria-label="Scan" placeholder="e.g. DF001-M100" onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (v.trim()) onCode(v.trim().toUpperCase()); setV(''); } }} />
    </label>
  );
}

// ---------------------------------------------------------------- stock in
export function StockIns({ stock }) {
  const list = useLoad('/commerce/stock-ins');
  const canCreate = useCan('inventory', 'create');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const d = list.data;
  return (
    <>
      {msg && <Notice kind="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {canCreate && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => setOpen(true)}>New stock in</button></div>}
      <Loading state={list}>
        {d && (
          <Table label="Stock in" rows={d.rows} rowKey={(x) => x.stock_in_id} empty={{ icon: 'package', title: 'No stock in yet.' }}
            columns={[
              { key: 'stock_in_id', label: '#', sort: true, render: (x) => `SI-${x.stock_in_id}` },
              { key: 'received_on', label: 'Date', sort: true, render: (x) => day(x.received_on) },
              { key: 'godown_code', label: 'Godown', sort: true, render: (x) => <span title={x.godown}>{x.godown_code}</span> },
              { key: 'from', label: 'From', render: (x) => (x.kind === 'production' ? 'Production (Kanchipuram unit)' : `Purchase: ${x.supplier}`) },
              { key: 'reference', label: 'Reference', render: (x) => <>{x.reference}{x.note && <small className="a-muted a-person-sub">{x.note}</small>}</> },
              { key: 'lines', label: 'Lines', className: 'a-silines', render: (x) => <>{x.lines.slice(0, 6).map((l) => <div key={`${l.sku_code}${l.batch_no}`}>{l.qty} x <code>{l.sku_code}</code>{l.batch_no ? ` batch ${l.batch_no} (exp. ${day(l.expiry_date)})` : ''}{d.seesCost ? ` @ ${rs(l.unit_cost)} · avg ${rs(l.avg_before)} -> ${rs(l.avg_after)}` : ''}</div>)}
                {x.lines.length > 6 && <small className="a-muted">+ {x.lines.length - 6} more</small>}</> },
              { key: 'packs', label: 'Packs', num: true, sort: true },
              d.seesCost && { key: 'value', label: 'Value', num: true, sort: true, render: (x) => rs(x.value) },
              { key: 'by', label: 'By', render: (x) => <>{x.emp_name || x.emp_id}<small className="a-muted a-person-sub">{fmtDate(x.created_at)}</small></> },
            ].filter(Boolean)} />
        )}
      </Loading>
      {open && <StockInDrawer stock={stock} onClose={() => setOpen(false)} onSaved={(text) => { setOpen(false); setMsg(text); list.reload(); stock.reload(); }} />}
    </>
  );
}

function StockInDrawer({ stock, onClose, onSaved }) {
  const act = useAction();
  const [f, setF] = useState({ kind: 'production', received_on: today(), reference: '', note: '' });
  const [godown, setGodown, godownList] = useGodown();
  const [lines, setLines] = useState([]);
  const [scanMsg, setScanMsg] = useState(null);
  const skus = useMemo(() => skusOf(stock, godown), [stock, godown]);
  const seesCost = Boolean(stock.data && stock.data.seesCost);
  const add = async (raw, carton = null) => {
    let code = raw;
    let s = skus.get(code);
    if (!s && carton === null) {
      // phase 14: a supplier EAN or a carton code finds its SKU too (Masters > Catalogue > Barcodes and labels)
      const hit = await api.send('POST', '/catalogue/scan', { code: raw }).catch(() => null);
      if (hit && hit.sku && skus.get(hit.sku)) { add(hit.sku, hit.kind === 'carton'); return; }
      setScanMsg({ kind: 'error', text: hit && hit.bad ? `${raw} is a misread: its EAN-13 check digit is wrong. Scan it again.` : `${raw}: no such SKU${hit && hit.noted ? ' (noted for the office)' : ''}` });
      return;
    }
    if (!s) { setScanMsg({ kind: 'error', text: `${code}: no such SKU` }); return; }
    code = s.sku_code || code;
    setLines((ls) => {
      const at = ls.findIndex((l) => l.sku_code === code);
      if (at >= 0) return ls.map((l, i) => (i === at ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l));
      return [...ls, { sku_code: code, qty: '1', unit: carton ? 'carton' : 'pack', unit_cost: '', batch_no: '', mfg_date: '', expiry_date: '' }];
    });
    setScanMsg({ kind: 'ok', text: `${code} ${s.name} - ${s.size_label}` });
  };
  const setLine = (n, patch) => setLines((ls) => ls.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const packs = (l) => { const s = skus.get(l.sku_code); return (Number(l.qty) || 0) * (l.unit === 'carton' && s ? Number(s.packs_per_carton) : 1); };
  const save = () => act.run(async () => {
    const r = await api.send('POST', '/commerce/stock-ins', { ...f, godown_id: godown, lines: lines.map((l) => ({ sku_code: l.sku_code, qty: packs(l), unit_cost: l.unit_cost, batch_no: l.batch_no, mfg_date: l.mfg_date, expiry_date: l.expiry_date })) });
    onSaved(`Stock in SI-${r.stock_in_id} saved: ${r.lines.map((l) => `${l.qty} x ${l.sku_code}${l.avg_after !== undefined ? ` (avg ${rs(l.avg_before)} -> ${rs(l.avg_after)})` : ''}`).join(', ')}.`);
  });
  const total = lines.reduce((a, l) => a + packs(l) * (Number(l.unit_cost) || 0), 0);
  return (
    <Drawer title="New stock in" onClose={onClose} wide dirty={lines.length > 0}
      footer={<button type="button" className="a-btn" disabled={act.busy || !lines.length} onClick={save}>Save stock in</button>}>
      {act.note}
      <Notice kind="info">Production from our Kanchipuram unit. Bought goods come in through Purchase &gt; Goods in, against a purchase order, and wait in QC hold.</Notice>
      <div className="a-grid2">
        <GodownField value={godown} onChange={setGodown} list={godownList} label="Into godown" disabled={lines.length > 0} />
        <label className="a-field"><span>Date received</span><input type="date" max={today()} value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} /></label>
        <label className="a-field"><span>Batch sheet no.</span><input value={f.reference} maxLength={60} aria-label="Reference" onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      </div>
      <ScanBox onCode={add} />
      {scanMsg && <small className={scanMsg.kind === 'error' ? 'a-bad' : 'a-muted'} role="status">{scanMsg.text}</small>}
      <div className="a-scroll">
        <table className="a-table a-silines-form">
          <thead><tr><th>SKU</th><th className="a-num">Qty</th><th className="a-num">Cost / pack (Rs)</th><th>Batch</th><th /></tr></thead>
          <tbody>{lines.map((l, n) => {
            const s = skus.get(l.sku_code);
            const p = packs(l);
            const after = seesCost && s && Number(l.unit_cost) > 0 && p > 0 ? (s.avg_cost == null || s.good <= 0 ? Number(l.unit_cost) : (s.good * s.avg_cost + p * Number(l.unit_cost)) / (s.good + p)) : null;
            return (
              <tr key={l.sku_code}>
                <td><code>{l.sku_code}</code><small className="a-muted a-person-sub">{s.name} - {s.size_label}</small>
                  {after !== null && <small className="a-muted a-person-sub">avg cost {rs(s.avg_cost)} -&gt; {rs(after)}</small>}</td>
                <td className="a-num"><span className="a-row">
                  <input type="number" min="1" step="1" className="a-qty" value={l.qty} aria-label={`Qty ${l.sku_code}`} onChange={(e) => setLine(n, { qty: e.target.value })} />
                  {Number(s.packs_per_carton) > 1 ? <select value={l.unit} aria-label={`Unit ${l.sku_code}`} onChange={(e) => setLine(n, { unit: e.target.value })}><option value="pack">packs</option><option value="carton">cartons</option></select> : <span className="a-muted">packs</span>}
                </span>{l.unit === 'carton' && <small className="a-muted a-ordernote">= {p} packs</small>}</td>
                <td className="a-num"><input inputMode="decimal" className="a-price" value={l.unit_cost} aria-label={`Cost ${l.sku_code}`} onChange={(e) => setLine(n, { unit_cost: e.target.value })} /></td>
                <td>{s.track_batches ? (
                  <span className="a-batchfields">
                    <input value={l.batch_no} placeholder="Batch no." aria-label={`Batch ${l.sku_code}`} onChange={(e) => setLine(n, { batch_no: e.target.value })} />
                    <label>Made <input type="date" value={l.mfg_date} aria-label={`Made ${l.sku_code}`} onChange={(e) => setLine(n, { mfg_date: e.target.value })} /></label>
                    <label>Expires <input type="date" value={l.expiry_date} aria-label={`Expires ${l.sku_code}`} onChange={(e) => setLine(n, { expiry_date: e.target.value })} /></label>
                  </span>) : <span className="a-muted">not tracked</span>}</td>
                <td><button type="button" className="a-btn a-btn-sm a-btn-ghost" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, i) => i !== n))}>x</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {!lines.length && <p className="a-muted">Scan or type a SKU above to add the first line.</p>}
      {lines.length > 0 && <p><b>{lines.reduce((a, l) => a + packs(l), 0)} packs</b>{total > 0 ? `, ${rs(total)} at cost` : ''}</p>}
      <label className="a-field"><span>Note</span><input value={f.note} maxLength={255} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
    </Drawer>
  );
}

// ---------------------------------------------------------------- write-offs
export function WriteOffs({ stock }) {
  const list = useLoad('/commerce/write-offs');
  const photoAct = useAction();
  const canCreate = useCan('inventory', 'create');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const d = list.data;
  return (
    <>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {photoAct.note}
      {d && <p className="a-muted">{d.rule.on ? `Above Rs ${d.rule.value} (at average cost) or ${d.rule.qty} packs a write-off waits for approval.` : 'Write-offs post at once (approval switched off in Commerce settings).'}</p>}
      {canCreate && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => setOpen(true)}>New write-off</button></div>}
      <Loading state={list}>
        {d && (
          <Table label="Write-offs" rows={d.rows} rowKey={(w) => w.write_off_id} empty={{ icon: 'package', title: 'No write-off yet.' }}
            columns={[
              { key: 'write_off_id', label: '#', sort: true, render: (w) => `WO-${w.write_off_id}` },
              { key: 'sku_code', label: 'SKU', sort: true, render: (w) => <><code>{w.sku_code}</code>{w.batch_no && <small className="a-muted a-person-sub">batch {w.batch_no}</small>}</> },
              { key: 'godown_code', label: 'Godown', sort: true },
              { key: 'stock_kind', label: 'From', render: (w) => d.kinds[w.stock_kind] },
              { key: 'qty', label: 'Packs', num: true, sort: true },
              { key: 'why', label: 'Why', render: (w) => <><b>{d.types[w.reason_type]}</b> - {w.reason}</> },
              d.rows.some((r) => 'value' in r) && { key: 'value', label: 'Value', num: true, render: (w) => ('value' in w ? rs(w.value) : '') },
              { key: 'status', label: 'Status', render: (w) => <>{w.status === 'posted' ? <Pill tone="good">Posted</Pill> : w.status === 'pending' ? <Pill tone="warn">Waiting for approval #{w.approval_id}</Pill> : <Pill tone="bad">Rejected</Pill>}
                {w.approval_note && <small className="a-muted a-person-sub">&quot;{w.approval_note}&quot; ({w.decided_by})</small>}</> },
              { key: 'by', label: 'By', render: (w) => <>{w.emp_id}<small className="a-muted a-person-sub">{fmtDate(w.created_at)}</small></> },
              { key: 'photo', label: 'Photo', render: (w) => (w.has_photo ? <button type="button" className="a-link" onClick={() => photoAct.run(async () => { if (!(await api.open(`/commerce/write-offs/${w.write_off_id}/photo`))) photoAct.setMsg({ kind: 'error', text: 'Allow pop-ups to see the photo.' }); })}>View</button> : '') },
            ].filter(Boolean)} />
        )}
      </Loading>
      {open && d && <WriteOffDrawer stock={stock} types={d.types} kinds={d.kinds} onClose={() => setOpen(false)}
        onSaved={(r) => { setOpen(false); list.reload(); stock.reload(); setMsg(r.status === 'pending' ? { kind: 'info', text: `Write-off WO-${r.write_off_id} is above the threshold: it waits for approval (#${r.approval_id}). Stock stays until it is approved.` } : { kind: 'ok', text: `Write-off WO-${r.write_off_id} posted: the packs are out of stock.` }); }} />}
    </>
  );
}

function WriteOffDrawer({ stock, types, kinds, onClose, onSaved }) {
  const act = useAction();
  const up = useUpload();
  const fileRef = useRef(null);
  const [f, setF] = useState({ sku_code: '', stock_kind: 'good', batch_id: '', qty: '', reason_type: 'damaged', reason: '' });
  const [godown, setGodown, godownList] = useGodown();
  const [photo, setPhoto] = useState(null);
  const [batches, setBatches] = useState([]);
  const skus = useMemo(() => skusOf(stock, godown), [stock, godown]);
  const s = skus.get(f.sku_code.trim().toUpperCase());
  useEffect(() => {
    let alive = true;
    setBatches([]);
    if (s && s.track_batches) api.get(`/commerce/batches?sku=${encodeURIComponent(s.sku_code)}&kind=${f.stock_kind}&godown_id=${godown}`).then((r) => { if (alive) setBatches(r.rows.filter((b) => b.batch_id)); }, () => {});
    return () => { alive = false; };
  }, [s && s.sku_code, f.stock_kind, godown]); // eslint-disable-line react-hooks/exhaustive-deps
  const have = s ? s[SHELF_FIELD[f.stock_kind]] : null;
  const save = () => act.run(async () => {
    const body = { ...f, godown_id: godown, sku_code: f.sku_code.trim().toUpperCase() };
    const r = photo ? await up.send('photo', '/commerce/write-offs', photo, body) : await api.send('POST', '/commerce/write-offs', body);
    onSaved(r);
  });
  return (
    <Drawer title="New write-off" onClose={onClose} dirty={Boolean(f.sku_code || f.reason)}
      footer={<button type="button" className="a-btn a-btn-danger" disabled={act.busy || !s || !f.qty || !f.reason.trim()} onClick={save}>{up.is('photo') ? <UploadProgress state={up.state} /> : 'Write off'}</button>}>
      {act.note}
      <div className="a-grid2">
        <GodownField value={godown} onChange={(v) => { setGodown(v); setF({ ...f, batch_id: '' }); }} list={godownList} />
        <label className="a-field"><span>SKU (scan or type)</span><input value={f.sku_code} list="wo-skus" aria-label="Write-off SKU" onChange={(e) => setF({ ...f, sku_code: e.target.value, batch_id: '' })} />
          <datalist id="wo-skus">{[...skus.values()].map((r) => <option key={r.sku_code} value={r.sku_code}>{r.name}</option>)}</datalist>
          {s && <small className="a-muted">{s.name} - {s.size_label}: {s.good} good ({s.expired} expired), {s.damaged} damaged, {s.returned} returned</small>}</label>
        <label className="a-field"><span>From</span><select value={f.stock_kind} aria-label="Write-off from" onChange={(e) => setF({ ...f, stock_kind: e.target.value, batch_id: '' })}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v} shelf</option>)}</select></label>
        {s && s.track_batches && (
          <label className="a-field"><span>Batch{f.stock_kind === 'good' ? ' (required)' : ''}</span>
            <select value={f.batch_id} aria-label="Write-off batch" onChange={(e) => setF({ ...f, batch_id: e.target.value })}><option value="">Choose...</option>
              {batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no} - expires {day(b.expiry_date)}{b.expired ? ' (EXPIRED)' : ''} - {b.qty} packs</option>)}</select></label>
        )}
        <label className="a-field"><span>Packs{have !== null ? ` (${have} there)` : ''}</span><input type="number" min="1" step="1" value={f.qty} aria-label="Write-off packs" onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
        <label className="a-field"><span>Why</span><select value={f.reason_type} aria-label="Write-off why" onChange={(e) => setF({ ...f, reason_type: e.target.value })}>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label className="a-field"><span>What happened (required)</span><textarea rows={2} maxLength={255} value={f.reason} aria-label="Write-off reason" onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      <label className="a-field"><span>Photo (optional, JPEG / PNG / WebP)</span><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} /></label>
    </Drawer>
  );
}

// ---------------------------------------------------------------- counts
export function Counts() {
  const list = useLoad('/commerce/counts');
  const canCreate = useCan('inventory', 'create');
  const act = useAction();
  const [scope, setScope] = useState('all');
  const [godown, setGodown, godownList] = useGodown();
  const [open, setOpen] = useState(null);
  const d = list.data;
  const start = () => act.run(async () => { const r = await api.send('POST', '/commerce/counts', { scope, godown_id: godown }); list.reload(); setOpen(r.count_id); });
  const STATUS = { open: ['Open', 'a-ap-pending'], pending: ['Waiting for approval', 'a-ap-pending'], posted: ['Posted', 'a-ap-approved'], rejected: ['Rejected', 'a-ap-rejected'], closed: ['No difference', 'a-ap-approved'] };
  return (
    <>
      {act.note}
      {canCreate && d && (
        <div className="a-toolbar">
          <GodownField value={godown} onChange={setGodown} list={godownList} />
          <label className="a-inline">Count <select value={scope} aria-label="Count scope" onChange={(e) => setScope(e.target.value)}><option value="all">All SKUs</option>{d.categories.map((c) => <option key={c.category_key} value={c.category_key}>{c.label}</option>)}</select></label>
          <button type="button" className="a-btn" disabled={act.busy} onClick={start}>Start a count</button>
        </div>
      )}
      <Loading state={list}>
        {d && (
          <Table label="Counts" rows={d.rows} rowKey={(c) => c.count_id} onRowClick={(c) => setOpen(c.count_id)} empty={{ icon: 'clipboard-check', title: 'No count yet.' }}
            columns={[
              { key: 'count_id', label: '#', sort: true, render: (c) => `#${c.count_id}` },
              { key: 'godown_code', label: 'Godown', sort: true },
              { key: 'scope_label', label: 'What' },
              { key: 'status', label: 'Status', render: (c) => <><span className={`a-status ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>{c.approval_note && <small className="a-muted a-person-sub">&quot;{c.approval_note}&quot; ({c.decided_by})</small>}</> },
              { key: 'counted', label: 'Counted', num: true, render: (c) => `${c.counted} / ${c.line_count}` },
              { key: 'differences', label: 'Differences', num: true, render: (c) => (c.status === 'open' ? '' : c.differences) },
              { key: 'started', label: 'Started', render: (c) => <>{c.started_by}<small className="a-muted a-person-sub">{fmtDate(c.started_at)}</small></> },
              { key: 'submitted', label: 'Submitted', render: (c) => <>{c.submitted_by || ''}<small className="a-muted a-person-sub">{fmtDate(c.submitted_at)}</small></> },
            ]} />
        )}
      </Loading>
      {open && <CountDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function CountDrawer({ id, onClose, onChanged }) {
  const c = useLoad(`/commerce/counts/${id}`);
  const canEdit = useCan('inventory', 'edit');
  const act = useAction();
  const confirm = useConfirm();
  const [typed, setTyped] = useState({}); // line_id -> text
  const [scanMsg, setScanMsg] = useState(null);
  const d = c.data;
  const editable = Boolean(d && d.status === 'open' && canEdit);
  const val = (l) => (l.line_id in typed ? typed[l.line_id] : l.counted === null ? '' : String(l.counted));
  const dirty = Object.keys(typed).length > 0;
  const scan = (code) => {
    const ls = d.lines.filter((l) => l.sku_code === code);
    if (!ls.length) { setScanMsg({ kind: 'error', text: `${code} is not in this count` }); return; }
    if (ls.length > 1) { setScanMsg({ kind: 'error', text: `${code} is counted per batch: type the packs in its batch rows` }); return; }
    const l = ls[0];
    setTyped((t) => ({ ...t, [l.line_id]: String((Number(val(l)) || 0) + 1) }));
    setScanMsg({ kind: 'ok', text: `${code}: ${(Number(val(l)) || 0) + 1}` });
  };
  const save = () => act.run(async () => {
    await api.send('PUT', `/commerce/counts/${id}`, { lines: Object.entries(typed).map(([lineId, v]) => ({ line_id: Number(lineId), counted: v })) });
    setTyped({}); c.reload(); onChanged();
  }, 'Count saved');
  const submit = async () => {
    const diffs = d.lines.filter((l) => val(l) !== '' && Number(val(l)) !== l.system_qty);
    if (!(await confirm({ title: `Submit count #${id}?`, message: diffs.length ? `${diffs.length} difference(s) go to approval; when approved they post as count movements.` : 'No difference: the count is closed.', action: 'Submit' }))) return;
    act.run(async () => {
      if (dirty) await api.send('PUT', `/commerce/counts/${id}`, { lines: Object.entries(typed).map(([lineId, v]) => ({ line_id: Number(lineId), counted: v })) });
      const r = await api.send('POST', `/commerce/counts/${id}/submit`);
      setTyped({}); c.reload(); onChanged();
      act.setMsg({ kind: r.status === 'pending' ? 'info' : 'ok', text: r.status === 'pending' ? `Submitted: ${r.differences} difference(s) wait for approval (#${r.approval_id}).` : 'Submitted: no difference, the count is closed.' });
    });
  };
  const counted = d ? d.lines.filter((l) => val(l) !== '').length : 0;
  return (
    <Drawer title={`Count #${id}`} onClose={onClose} wide dirty={dirty}
      footer={editable ? <>
        <button type="button" className="a-btn a-btn-ghost" disabled={act.busy || !dirty} onClick={save}>Save</button>
        <button type="button" className="a-btn" disabled={act.busy || !counted} onClick={submit}>Submit</button>
      </> : null}>
      <Loading state={c}>
        {d && (
          <>
            {act.note}
            <p className="a-muted">{d.scope === 'all' ? 'All SKUs' : `Category ${d.scope}`} · started by {d.started_by} {fmtDate(d.started_at)}{d.submitted_at ? ` · submitted by ${d.submitted_by} ${fmtDate(d.submitted_at)}` : ''}</p>
            {d.status === 'pending' && <Notice kind="warn">Waiting for approval #{d.approval_id}: the differences post as count movements when approved.</Notice>}
            {d.status === 'posted' && <Notice kind="ok">Approved and posted: the differences are in the movement log (type Count difference).</Notice>}
            {d.status === 'rejected' && <Notice kind="error">Rejected: nothing was posted.</Notice>}
            {editable && <ScanBox onCode={scan} label="Scan a pack (adds 1) or type a SKU and press Enter" />}
            {scanMsg && <small className={scanMsg.kind === 'error' ? 'a-bad' : 'a-muted'} role="status">{scanMsg.text}</small>}
            <p>{counted} of {d.lines.length} counted. Leave a row empty to leave that SKU out.</p>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>SKU</th><th>Product</th><th>Batch</th><th className="a-num">System</th><th className="a-num">Counted</th><th className="a-num">Difference</th></tr></thead>
                <tbody>{d.lines.map((l) => {
                  const v = val(l);
                  const diff = v === '' ? null : Number(v) - l.system_qty;
                  return (
                    <tr key={l.line_id} className={diff ? 'a-pending' : undefined}>
                      <td><code>{l.sku_code}</code></td><td>{l.name} <small className="a-muted">{l.size_label}</small></td><td>{l.batch_no ? `${l.batch_no} (exp. ${day(l.expiry_date)})` : ''}</td>
                      <td className="a-num">{l.system_qty}</td>
                      <td className="a-num">{editable ? <input type="number" min="0" step="1" className="a-qty" value={v} aria-label={`Counted ${l.sku_code}${l.batch_no ? ` ${l.batch_no}` : ''}`} onChange={(e) => setTyped((t) => ({ ...t, [l.line_id]: e.target.value }))} /> : (l.counted ?? '')}</td>
                      <td className={`a-num${diff ? ' a-bad' : ''}`}>{diff === null ? '' : diff > 0 ? `+${diff}` : diff}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </>
        )}
      </Loading>
    </Drawer>
  );
}

