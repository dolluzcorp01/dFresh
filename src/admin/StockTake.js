// Inventory > Stock take (phase 18, v23 viewTakes / DRAWERS.takeNew / DRAWERS.take; API /inventory/takes in
// inventory-routes.js). A count sheet per godown and scope (the whole godown, a category, raw materials), one line per
// batch on the Good shelf. Starting it (Edit) freezes that shelf: nothing comes in or goes out until it is submitted
// or cancelled (the server refuses every move with the count's name). Counting (Create) is done without the book
// figure; packs scanned or packed for orders not yet dispatched are listed so nobody misses them. Every batch must be
// counted. Differences post only after somebody else approves, at the average cost; a shortage that repeats an
// earlier count's is marked "Short again: theft signal".
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, useAction, useConfirm, useLoad, useToast } from './ui';
import { In, ItemCell, at, bm, fe, fieldsOf, useOpenParam } from './buyShared';

const TONE = { open: 'warn', pending: 'warn', posted: 'good', closed: 'good', rejected: 'bad', cancelled: 'gray' };

export default function StockTake() {
  const data = useLoad('/inventory/takes');
  const [open, setOpen] = useState(null);
  const [neu, setNeu] = useState(false);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const cols = [
    { key: 'ref', label: 'Stock take', render: (t) => <><b className="a-mono">{t.ref}</b><small className="a-muted a-p15-sub">{at(t.started_at)}</small></> },
    { key: 'godown', label: 'Godown' },
    { key: 'scope', label: 'What' },
    { key: 'diffs', label: 'Differences', num: true, render: (t) => (t.diffs === null ? '-' : t.diffs) },
    { key: 'status', label: 'Status', render: (t) => <Pill tone={TONE[t.status]}>{t.status_label}</Pill> },
  ];
  return (
    <section>
      <PageHead sub="Count what is on the shelves" rules={['The counted shelf is frozen while counting', 'Counted batch by batch, without seeing the book figure', 'Posted only after somebody else approves']}
        actions={d && d.can.start && <button type="button" className="a-btn" onClick={() => setNeu(true)}><LIcon name="plus" size="sm" />Start a stock take</button>} />
      <Loading state={data}>
        {d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(t) => t.count_id} label="Stock takes" onRowClick={(t) => setOpen(t.count_id)}
          empty={{ icon: 'clipboard-check', title: 'No stock take yet', text: 'Start one to count a godown or one category.' }} /></div>}
      </Loading>
      {neu && d && <StartTake d={d} onClose={() => setNeu(false)} onSaved={(id) => { setNeu(false); data.reload(); setOpen(id); }} />}
      {open && <TakeDrawer id={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
    </section>
  );
}

function StartTake({ d, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const [f, setF] = useState({ godown_id: String((d.mine[0] || {}).godown_id || ''), scope: 'all' });
  const save = () => act.run(async () => { const out = await api.send('POST', '/inventory/takes', f); toast('warn', out.title, out.message); onSaved(out.count_id); });
  return (
    <Drawer title="Start a stock take" onClose={onClose} thumb={<LIcon name="clipboard-check" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="lock" size="sm" />Freeze and start counting</button></>}>
      <Alert tone="warn" title="The shelf is frozen while it is counted.">Nothing can be dispatched, written off, issued to production, moved or passed into stock on it until the count is submitted or cancelled. Goods in still land in QC hold.</Alert>
      {act.note}
      <div className="a-grid2">
        <In label="Godown *"><select value={f.godown_id} onChange={(e) => setF((x) => ({ ...x, godown_id: e.target.value }))}>{d.mine.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="What to count *"><select value={f.scope} onChange={(e) => setF((x) => ({ ...x, scope: e.target.value }))}>{d.scopes.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></In>
      </div>
    </Drawer>
  );
}

function TakeDrawer({ id, onClose, onChanged }) {
  const one = useLoad(`/inventory/takes/${id}`);
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const [c, setC] = useState({});
  const [err, setErr] = useState({});
  const t = one.data;
  if (!t) return <Drawer title="Stock take" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const val = (l) => (c[l.line_id] !== undefined ? c[l.line_id] : l.counted === null ? '' : String(l.counted));
  const submit = () => act.run(async () => {
    setErr({});
    const lines = t.lines.map((l) => ({ line_id: l.line_id, counted: val(l) === '' ? null : val(l) }));
    const empty = lines.filter((l) => l.counted === null).length;
    if (empty) { setErr(Object.fromEntries(t.lines.filter((l) => val(l) === '').map((l) => [`c.${l.line_id}`, 'Count it.']))); throw new Error(`Count every batch: ${empty} left empty.`); }
    try { const out = await api.send('POST', `/inventory/takes/${t.count_id}/submit`, { lines }); toast(out.tone, out.title, out.message); setC({}); one.reload(); onChanged(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel ${t.ref}?`, message: 'The count is thrown away and the shelf is unfrozen. Nothing changes in stock.', action: 'Cancel the count', cancel: 'Keep counting', danger: true }))) return;
    act.run(async () => { const out = await api.send('POST', `/inventory/takes/${t.count_id}/cancel`); toast('good', out.title, out.message); one.reload(); onChanged(); });
  };
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  const packing = t.scanned.filter((s) => !s.packed); const packed = t.scanned.filter((s) => s.packed);
  return (
    <Drawer title={`Stock take ${t.ref}`} onClose={onClose} thumb={<LIcon name="clipboard-check" />} dirty={Object.keys(c).length > 0}
      status={<><Pill tone={TONE[t.status]}>{t.status_label}</Pill><span className="a-p15-sp" />{t.can.cancel && <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={cancel}>Cancel the count</button>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        {t.can.count && <button type="button" className="a-btn" disabled={act.busy} onClick={submit}><LIcon name="send" size="sm" />Submit the count</button>}</>}>
      {act.note}
      <dl className="a-kv">
        <KV k="Godown">{t.godown}</KV><KV k="What">{t.scope}</KV><KV k="Started by">{t.started_by} at {at(t.started_at)}</KV>
        {t.submitted_by && <KV k="Counted by">{t.submitted_by}</KV>}
        {t.decided_by && <KV k={t.status === 'rejected' ? 'Rejected by' : 'Approved by'}>{t.decided_by}</KV>}
        {!t.counting && t.diffs > 0 && <KV k="Value of the differences">{bm(t.value)}</KV>}
      </dl>
      {packing.length > 0 && <Alert tone="warn" title="Count these with the shelf.">They are scanned for orders still being packed, so they are in the book figure but may be on the packing table: {packing.map((s) => `${s.order_no} ${s.sku_code} ${s.qty}`).join(', ')}.</Alert>}
      {packed.length > 0 && <Alert tone="info" title="Count the packed boxes too.">They are packed for orders not yet dispatched and are still in the book figure: {packed.map((s) => `${s.order_no} ${s.sku_code} ${s.qty}`).join(', ')}.</Alert>}
      {t.status === 'pending' && <Alert tone="warn" title="Waiting for approval.">{t.wait_line} Nothing is changed until then. The person who counted cannot approve it.</Alert>}
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th>Batch</th>{!t.counting && <th className="a-num">Book</th>}<th className="a-num">Counted</th>{!t.counting && <th className="a-num">Difference</th>}</tr></thead>
        <tbody>{t.lines.map((l) => (
          <tr key={l.line_id}><td><ItemCell name={l.name} code={l.sku_code} image={l.image} /></td><td className="a-mono">{l.batch_no}</td>
            {!t.counting && <td className="a-num">{l.book === null ? '-' : l.book}</td>}
            <td className="a-num a-p18-cnt">{t.can.count ? <In label={`Counted ${l.sku_code} ${l.batch_no}`} type="number" min="0" step={l.unit === 'kg' ? '0.01' : '1'} value={val(l)} error={fe(err, `c.${l.line_id}`)} onChange={(e) => setC((x) => ({ ...x, [l.line_id]: e.target.value }))} /> : l.counted}</td>
            {!t.counting && <td className="a-num">{l.diff ? <b className={l.diff < 0 ? 'a-bad' : undefined}>{l.diff > 0 ? '+' : ''}{l.diff}</b> : '0'}{l.again && <small className="a-p15-sub"><Pill tone="bad">Short again: theft signal</Pill></small>}</td>}</tr>
        ))}</tbody></table></div>
    </Drawer>
  );
}
