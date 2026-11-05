// Section 5 Inventory (phase 18): what the Inventory pages share: the options (godowns, items, shelves, reasons), the
// write-off / shelf-move panel (v23 DRAWERS.woNew: Write off from any shelf but QC hold; Move between shelves inside a
// godown, Damaged or Returned back to Good waits for a second person), and the quantity text (packs or cartons).
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, useAction, useLoad, useToast } from './ui';
import { In, fieldsOf } from './buyShared';

/** "1,240" / "51 ctn + 16" (cartons on) / "49.92 kg" */
export function qn(n, row, cartons = false) {
  const x = Number(n) || 0;
  if (!x) return <span className="a-muted">0</span>;
  if (cartons && row && !row.raw && row.per_carton) {
    const c = Math.floor(x / row.per_carton); const r = Math.round((x - c * row.per_carton) * 1000) / 1000;
    return `${c} ctn${r ? ` + ${r}` : ''}`;
  }
  return x.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function useInvOptions() { return useLoad('/inventory/options'); }

const MOVE_SHELVES = ['good', 'dmg', 'ret'];
/** pre = { godown_id, sku_code, shelf, reason, qty, batch_id, batch_no, to } */
export function WoDrawer({ mode = 'wo', pre = {}, onClose, onSaved }) {
  const opts = useInvOptions();
  const o = opts.data;
  if (!o) return <Drawer title={mode === 'move' ? 'Move between shelves' : 'Write off'} onClose={onClose}><Loading state={opts}>{null}</Loading></Drawer>;
  return <WoForm o={o} mode={mode} pre={pre} onClose={onClose} onSaved={onSaved} />;
}
function WoForm({ o, mode, pre, onClose, onSaved }) {
  const move = mode === 'move';
  const act = useAction();
  const toast = useToast();
  const start = { godown_id: String(pre.godown_id || (o.mine[0] || {}).godown_id || ''), sku_code: pre.sku_code || '', stock_kind: pre.shelf || 'good', to: pre.to || 'dmg',
    reason_type: pre.reason || 'damaged', qty: pre.qty ? String(pre.qty) : '', batch_id: pre.batch_id ? String(pre.batch_id) : '', reason: '' };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const batches = useLoad(f.sku_code && f.godown_id ? `/commerce/batches?sku=${encodeURIComponent(f.sku_code)}&kind=${f.stock_kind}&godown_id=${f.godown_id}` : null);
  const lots = (batches.data && (batches.data.rows || batches.data)) || [];
  const save = () => act.run(async () => {
    setErr({});
    try {
      const body = move ? { godown_id: f.godown_id, sku_code: f.sku_code, from: f.stock_kind, to: f.to, qty: f.qty, batch_id: f.batch_id || null, note: f.reason }
        : { godown_id: f.godown_id, sku_code: f.sku_code, stock_kind: f.stock_kind, reason_type: f.reason_type, qty: f.qty, batch_id: f.batch_id || null, reason: f.reason };
      const out = await api.send('POST', move ? '/inventory/moves' : '/inventory/write-offs', body);
      toast(out.tone || 'good', out.title, out.message); onSaved(out);
    } catch (e) {
      const x = fieldsOf(e);
      setErr(move ? { ...x, stock_kind: x.from, reason: x.note } : x); throw e;
    }
  });
  const shelves = o.shelves.filter((s) => (move ? MOVE_SHELVES.includes(s.key) : !['hold', 'disp', 'road'].includes(s.key)));
  const why = o.wo_types.find((x) => x.key === f.reason_type);
  return (
    <Drawer title={move ? 'Move between shelves' : 'Write off'} onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} thumb={<LIcon name={move ? 'arrow-up-down' : 'trash-2'} />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />{move ? 'Move' : 'Write off'}</button></>}>
      {move ? <Alert tone="info" title="Moving packs between shelves inside a godown.">Nothing leaves the building, so it is not a loss, but what you can sell changes. Returned or damaged stock back to Good needs a second person (Approval rules: Returned stock back to Good).</Alert>
        : <Alert tone="info" title="The stock leaves for good.">Above the write-off rule (value, or packs in a day) it waits for a second person. QC hold is cleared only by Quality check.</Alert>}
      {act.note}
      <div className="a-grid2">
        <In label="Godown *" error={err.godown_id}><select value={f.godown_id} onChange={set('godown_id')}>{o.mine.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="Pack or material *" error={err.sku_code}><select value={f.sku_code} onChange={set('sku_code')}><option value="">Choose...</option>
          {o.items.map((x) => <option key={x.sku_code} value={x.sku_code}>{x.sku_code} · {x.name}</option>)}</select></In>
        <In label="From shelf *" error={err.stock_kind}><select value={f.stock_kind} onChange={set('stock_kind')}>{shelves.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></In>
        {move ? <In label="To shelf *" error={err.to}><select value={f.to} onChange={set('to')}>{shelves.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></In>
          : <In label="Why *" error={err.reason_type} hint={why ? why.next : ''}><select value={f.reason_type} onChange={set('reason_type')}>{o.wo_types.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></In>}
        <In label="How many *" type="number" min="1" step="1" value={f.qty} error={err.qty} onChange={set('qty')} />
        <In label="Batch" error={err.batch_id} hint="Oldest first if empty. A named batch is the only batch taken."><select value={f.batch_id} onChange={set('batch_id')}><option value="">-</option>
          {lots.filter((l) => l.batch_id).map((l) => <option key={l.batch_id} value={String(l.batch_id)}>{l.batch_no} ({l.qty})</option>)}
          {pre.batch_id && !lots.some((l) => String(l.batch_id) === String(pre.batch_id)) && <option value={String(pre.batch_id)}>{pre.batch_no || pre.batch_id}</option>}</select></In>
        <In label="What happened *" wide value={f.reason} maxLength={140} error={err.reason} placeholder="e.g. Roof leak, outer wrap wet" onChange={set('reason')} />
      </div>
    </Drawer>
  );
}
