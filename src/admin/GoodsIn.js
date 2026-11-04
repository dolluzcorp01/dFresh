// Purchase > Goods in (phase 16, v23 viewGoodsIn / DRAWERS.grnNew / DRAWERS.grn; API /buying/goods-in in
// buying-routes.js). Against an open purchase order (its approved revision), or with no PO (waits for approval). Scan
// the carton barcode (each scan adds a carton) or type the count; batch, and for a dated product the date it was made
// (the expiry is worked out from the shelf life; expired is refused at the gate, near expiry is noted). Up to the
// tolerance in Approval rules over the open quantity is taken in; more waits. Everything lands in QC hold until Quality
// check passes it (with QC hold switched off it is passed at once). A checked goods in can still start a claim for goods
// found faulty within the days of the switch. Tabs Waiting for approval / In QC hold / Checked / Not taken in.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, SupCell, ViewOnlyB, at, bm, fe, fieldsOf, useOpenParam } from './buyShared';

const TONE = { waiting: 'warn', qc: 'info', done: 'good', rejected: 'gray' };
const TABS = [['waiting', 'Waiting for approval'], ['qc', 'In QC hold'], ['done', 'Checked'], ['rejected', 'Not taken in']];
const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

export default function GoodsIn() {
  const loc = useLocation();
  const nav = useNavigate();
  const [tab, setTab] = useState('qc');
  const data = useLoad(`/buying/goods-in?tab=${tab}`);
  const opts = useLoad('/buying/options');
  const { me } = useAdmin();
  const canCreate = useCan('buying', 'create');
  const [open, setOpen] = useState(null);
  const [neu, setNeu] = useState(null); // po id | 'none' | ''
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const poParam = new URLSearchParams(loc.search).get('po');
  useEffect(() => { if (poParam) { setNeu(poParam); nav(loc.pathname, { replace: true }); } }, [poParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = [
    { key: 'grn_no', label: 'Goods in', render: (g) => <><b className="a-mono">{g.grn_no}</b><small className="a-muted a-p15-sub">{g.godown} · {g.received_on}</small></> },
    { key: 'supplier', label: 'Supplier', render: (g) => <SupCell s={g.supplier} /> },
    { key: 'po_no', label: 'Purchase order', hideSm: true, render: (g) => g.po_no || <Pill tone="warn">No PO</Pill> },
    { key: 'items', label: 'Items', render: (g) => <>{g.items_text}<small className="a-muted a-p15-sub">{g.qty_text}</small></> },
    { key: 'challan_no', label: 'Challan or bill', hideSm: true },
    { key: 'status', label: 'Status', render: (g) => <Pill tone={TONE[g.status]}>{g.status_label}</Pill> },
  ];
  const empty = { waiting: 'Nothing is waiting for approval.', qc: 'Nothing is waiting for Quality check.', done: 'Nothing checked yet.', rejected: 'Nothing was refused.' }[tab];
  return (
    <section>
      <PageHead sub="Scan cartons as they arrive; stock goes up" rules={d ? ['Scan the carton, type the count', d.tolerance !== null ? `Up to ${d.tolerance}% over the order is fine` : 'Any amount over the order is taken in', `Lands in QC hold${d.quarantine ? '' : ' (switched off)'}`] : []}
        actions={canCreate && <button type="button" className="a-btn" onClick={() => setNeu('')}><LIcon name="plus" size="sm" />New goods in</button>} />
      {!canCreate && <ViewOnlyB me={me} what="goods in" />}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Goods in" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: d.counts[k] }))} />
            <div className="a-listcard"><Table columns={columns} rows={d.rows} rowKey={(g) => g.grn_id} label="Goods in" onRowClick={(g) => setOpen(g.grn_id)} empty={{ icon: 'inbox', title: 'Nothing here', text: empty }} /></div>
          </>
        )}
      </Loading>
      {neu !== null && opts.data && <NewGoodsIn po={neu} opts={opts.data} onClose={() => setNeu(null)} onSaved={(out) => { setNeu(null); setTab(out.waiting ? 'waiting' : opts.data.switches.quarantine ? 'qc' : 'done'); data.reload(); }} />}
      {open && <GrnDrawer id={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
    </section>
  );
}

function NewGoodsIn({ po, opts, onClose, onSaved }) {
  const [poId, setPoId] = useState(po || '');
  const form = useLoad(`/buying/goods-in-form${poId && poId !== 'none' ? `?po=${poId}` : ''}`);
  const act = useAction();
  const toast = useToast();
  const [f, setF] = useState({ challan_no: '', vehicle_no: '', supplier_id: '', godown_id: String((opts.godowns[0] || {}).godown_id || '') });
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState({});
  const [scanMsg, setScanMsg] = useState(null);
  const [add, setAdd] = useState('');
  const scanRef = useRef(null);
  const fd = form.data;
  useEffect(() => {
    if (!fd) return;
    setLines(poId && poId !== 'none' ? fd.lines.map((l) => ({ ...l, kg: l.reels, recv: '', cartons: '', reels: '', batch_no: '', mfg_date: '', expiry_date: '' })) : []);
  }, [fd, poId]);
  const setL = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const itemOf = (sku) => opts.items.find((x) => x.sku_code === sku);
  const scan = async (code) => {
    const r = await api.send('POST', '/buying/scan', { code }).catch(() => null);
    if (!r || !r.found) { setScanMsg({ bad: true, text: `${code} is not a known barcode.` }); return; }
    const i = lines.findIndex((l) => l.sku_code === r.sku_code);
    if (i < 0) { setScanMsg({ bad: true, text: `${r.sku_code} is not on ${poId && poId !== 'none' ? (fd.pos.find((p) => String(p.po_id) === String(poId)) || {}).po_no || 'this order' : 'this list'}.${poId === 'none' ? ' Add it with Add an item.' : ''}` }); return; }
    const l = lines[i];
    if (r.kind === 'carton' && l.per_carton) {
      const c = (Number(l.cartons) || 0) + 1;
      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cartons: String(c), recv: String(c * l.per_carton) } : x)));
      setScanMsg({ text: `Carton of ${r.sku_code}: ${c} carton${c > 1 ? 's' : ''} = ${c * l.per_carton} packs.` });
    } else setScanMsg({ text: `${r.sku_code} found. Type the count.` });
  };
  const addItem = () => {
    if (!add) return;
    if (lines.some((l) => l.sku_code === add)) { toast('warn', 'Already added', `${add} is on the list.`); return; }
    const it = itemOf(add);
    setLines((ls) => [...ls, { sku_code: add, name: it.name, unit: it.unit, per_carton: it.per_carton, track: it.track, life: it.life, needs_batch: it.track || it.type === 'raw', kg: it.unit === 'kg', reels: '', recv: '', cartons: '', batch_no: '', mfg_date: '', expiry_date: '', rate: '' }]);
    setAdd('');
  };
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('POST', '/buying/goods-in', { po_id: poId && poId !== 'none' ? Number(poId) : undefined, ...f, lines: lines.map((l) => ({ sku_code: l.sku_code, recv: l.recv, cartons: l.cartons, reels: l.reels, batch_no: l.batch_no, mfg_date: l.mfg_date, expiry_date: l.expiry_date, rate: l.rate })) });
      toast(out.waiting ? 'warn' : 'good', `${out.grn_no} taken in`, out.message);
      onSaved(out);
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const dirty = lines.some((l) => l.recv !== '' || l.batch_no) || f.challan_no !== '';
  return (
    <Drawer title="New goods in" onClose={onClose} dirty={dirty} thumb={<LIcon name="truck" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>{poId && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Take in</button>}</>}>
      <Alert tone="info" title="Scan the carton, type the count.">Each carton scan adds one carton. {fd && fd.tolerance !== null ? `Up to ${fd.tolerance}% more than the open quantity is taken in; more than that, or goods with no purchase order, wait for a second person.` : 'Goods with no purchase order wait for a second person.'} Everything lands in QC hold until Quality check passes it.</Alert>
      {act.note}
      <Loading state={form}>
        {fd && (
          <>
            <Field def={{ name: 'po', label: 'Purchase order', type: 'select', required: true, wide: true, options: [...fd.pos.map((p) => ({ value: String(p.po_id), label: `${p.po_no} · ${p.supplier} · ${p.godown}` })), { value: 'none', label: 'No purchase order (needs approval)' }] }}
              value={String(poId)} onChange={(v) => { setPoId(v || ''); setScanMsg(null); }} />
            {poId && (
              <>
                <div className="a-grid2">
                  {poId === 'none' && <>
                    <Field def={{ name: 'supplier_id', label: 'Supplier', type: 'select', required: true, error: err.supplier_id, options: opts.suppliers.filter((s) => s.status === 'active').map((s) => ({ value: String(s.supplier_id), label: s.name })) }} value={f.supplier_id} onChange={(v) => setF((x) => ({ ...x, supplier_id: v || '' }))} />
                    <Field def={{ name: 'godown_id', label: 'Godown', type: 'select', allowEmpty: false, required: true, error: err.godown_id, options: opts.godowns.map((g) => ({ value: String(g.godown_id), label: g.name })) }} value={f.godown_id} onChange={(v) => setF((x) => ({ ...x, godown_id: v }))} />
                  </>}
                  <Field def={{ name: 'challan_no', label: 'Supplier challan or bill no.', required: true, error: err.challan_no, help: 'As printed on their paper. The same number twice from one supplier is refused.' }} value={f.challan_no} onChange={(v) => setF((x) => ({ ...x, challan_no: String(v).slice(0, 30) }))} />
                  <Field def={{ name: 'vehicle_no', label: 'Vehicle no.', error: err.vehicle_no, help: 'Like TN 21 AX 4402.' }} value={f.vehicle_no} onChange={(v) => setF((x) => ({ ...x, vehicle_no: String(v).toUpperCase().slice(0, 14) }))} />
                </div>
                <div className="a-p16-scan">
                  <label className="a-field-i"><LIcon name="scan-barcode" size="sm" /><input ref={scanRef} placeholder="Scan a barcode here and press Enter" aria-label="Scan a barcode"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.currentTarget.value.trim(); e.currentTarget.value = ''; if (v) scan(v); } }} /></label>
                  {scanMsg && <small className={scanMsg.bad ? 'a-bad' : 'a-muted'} role="status">{scanMsg.text}</small>}
                </div>
                {lines.map((l, i) => (
                  <div key={l.sku_code} className="a-p16-lrow a-p16-girow">
                    <div className="a-p16-li"><ItemCell name={l.name} code={l.sku_code} />{l.ordered !== undefined && <small className="a-muted a-p15-sub">Ordered {l.ordered_text} · open <b>{l.open_text}</b></small>}</div>
                    {l.per_carton ? <In label="Cartons" type="number" min="0" step="1" value={l.cartons} hint={`${l.per_carton} per carton`} onChange={(e) => { const c = e.target.value; setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cartons: c, recv: c === '' ? '' : String(Number(c) * l.per_carton) } : x))); }} />
                      : l.kg ? <In label="Reels" type="number" min="0" step="1" value={l.reels} onChange={(e) => setL(i, 'reels', e.target.value)} /> : <span />}
                    <In label={`Received (${l.unit === 'kg' ? 'kg' : l.unit === 'pack' ? 'packs' : l.unit})`} type="number" min="0" step="1" value={l.recv} error={fe(err, `lines.${i}.recv`)} onChange={(e) => setL(i, 'recv', e.target.value)} />
                    <In label={`Batch${l.needs_batch ? ' *' : ''}`} value={l.batch_no} maxLength={20} error={fe(err, `lines.${i}.batch_no`)} onChange={(e) => setL(i, 'batch_no', e.target.value.toUpperCase())} />
                    {l.track && <>
                      <In label="Made on *" type="date" value={l.mfg_date} error={fe(err, `lines.${i}.mfg_date`)} onChange={(e) => setL(i, 'mfg_date', e.target.value)} />
                      {l.life > 0 ? <In label="Expires on" value={l.mfg_date ? addMonths(l.mfg_date, l.life) : ''} disabled readOnly hint={`Worked out: made on + ${l.life} months shelf life.`} />
                        : <In label="Expires on *" type="date" value={l.expiry_date} error={fe(err, `lines.${i}.expiry_date`)} onChange={(e) => setL(i, 'expiry_date', e.target.value)} />}
                    </>}
                    {poId === 'none' && <In label="Rate (Rs) *" type="number" min="0" step="0.01" value={l.rate} error={fe(err, `lines.${i}.rate`)} onChange={(e) => setL(i, 'rate', e.target.value)} />}
                    {poId === 'none' && <button type="button" className="a-iconbtn a-p16-del" aria-label="Remove this row" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><LIcon name="trash-2" size="sm" /></button>}
                  </div>
                ))}
                {poId !== 'none' && !lines.length && <p className="a-hint-s">Nothing is open on this order.</p>}
                {poId === 'none' && (
                  <div className="a-p16-addrow">
                    <In label="Add an item"><select value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Choose...</option>{opts.items.map((it) => <option key={it.sku_code} value={it.sku_code}>{it.sku_code} · {it.name}</option>)}</select></In>
                    <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={addItem}><LIcon name="plus" size="sm" />Add</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Loading>
    </Drawer>
  );
}

function GrnDrawer({ id, onClose, onChanged }) {
  const one = useLoad(`/buying/goods-in/${id}`);
  const nav = useNavigate();
  const act = useAction();
  const toast = useToast();
  const [lc, setLc] = useState({ sku_code: '', qty: '', reason: '' });
  const [err, setErr] = useState({});
  const g = one.data;
  if (!g) return <Drawer title="Goods in" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const late = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/buying/goods-in/${g.grn_id}/late-claim`, { ...lc, sku_code: lc.sku_code || (g.claim.lines[0] || {}).sku_code }); toast('good', `${out.claim.claim_no} started`, out.message); one.reload(); onChanged(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  return (
    <Drawer title={`Goods in ${g.grn_no}`} onClose={onClose} thumb={<LIcon name="truck" />}
      status={<><Pill tone={TONE[g.status]}>{g.status_label}</Pill>{!g.po_no && <Pill tone="warn">No PO</Pill>}<span className="a-p15-sp" />
        {g.can.qc && <button type="button" className="a-btn a-btn-sm" onClick={() => nav(`/admin/quality-check?open=${g.grn_id}`)}><LIcon name="clipboard-check" size="sm" />Quality check</button>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      {g.status === 'waiting' && <Alert tone="warn" title="Waiting for approval.">{g.why} {g.waiting} Nothing is in stock until then.</Alert>}
      <dl className="a-kv">
        <KV k="Supplier">{g.supplier.name}</KV>
        <KV k="Purchase order">{g.po_no ? <a href={`/admin/purchase-orders?open=${g.po_id}`}>{g.po_no}</a> : 'None'}</KV>
        <KV k="Godown">{g.godown}</KV><KV k="Date">{g.received_on}</KV><KV k="Challan or bill">{g.challan_no}</KV><KV k="Vehicle">{g.vehicle_no || '-'}</KV>
        <KV k="Taken in by">{g.taken_by} at {at(g.created_at)}</KV>
        {g.qc_by && <KV k="Checked by">{g.qc_by} at {at(g.qc_at)}</KV>}
      </dl>
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Received</th><th className="a-hide-sm">Batch</th><th className="a-num">Accepted</th><th className="a-num">Rejected</th><th className="a-num a-hide-sm">Landed cost</th></tr></thead>
        <tbody>{g.lines.map((l) => (
          <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} sub={l.expiry_date ? `made ${l.mfg_date} · expires ${l.expiry_date}` : null} /></td>
            <td className="a-num">{l.recv_text}{l.cartons ? <small className="a-muted a-p15-sub">{l.cartons} cartons</small> : null}{l.reels ? <small className="a-muted a-p15-sub">{l.reels} reels</small> : null}</td>
            <td className="a-hide-sm">{l.batch_no || '-'}</td>
            <td className="a-num">{g.status === 'done' ? l.acc_text : '-'}</td>
            <td className="a-num">{g.status === 'done' ? (l.rej ? <><b className="a-bad">{l.rej_text}</b><small className="a-muted a-p15-sub">{l.reason}</small></> : '0') : '-'}</td>
            <td className="a-num a-hide-sm">{g.status === 'done' && l.acc ? bm(l.unit_cost) : '-'}</td></tr>))}</tbody></table></div>
      {g.claim && (
        <div className="a-card a-p16-late">
          <h3 className="a-p14-fsec">Found faulty after QC</h3>
          <p className="a-hint-s">{g.claim.days_left} day{g.claim.days_left === 1 ? '' : 's'} left to claim ({g.claim.days} days after QC).</p>
          <div className="a-grid2">
            <In label="Item *" error={err.sku_code}><select value={lc.sku_code || (g.claim.lines[0] || {}).sku_code || ''} onChange={(e) => setLc((x) => ({ ...x, sku_code: e.target.value }))}>{g.claim.lines.map((l) => <option key={l.sku_code} value={l.sku_code}>{l.sku_code} · accepted {l.acc}</option>)}</select></In>
            <In label="How many *" type="number" min="1" step="1" value={lc.qty} error={err.qty} onChange={(e) => setLc((x) => ({ ...x, qty: e.target.value }))} />
            <In label="What is wrong *" wide value={lc.reason} maxLength={80} placeholder="e.g. Wet inside the roll" error={err.reason} onChange={(e) => setLc((x) => ({ ...x, reason: e.target.value }))} />
          </div>
          <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={late}><LIcon name="undo-2" size="sm" />Start a claim</button>
        </div>
      )}
    </Drawer>
  );
}
