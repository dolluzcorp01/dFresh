// Production > Production runs (phase 17, v23 viewRuns / viewMachines / DRAWERS.runNew / DRAWERS.run / DRAWERS.machine;
// API /production/... in production-routes.js). Tabs Planned / Running / Finished and cancelled / Machines.
// - Plan a run (Create): a made pack with a recipe, the godown, packs, a working machine there that makes the pack's
//   category, the day (today or later), shift and operator; the box below shows what it needs against usable stock.
//   Plan from low stock plans tomorrow's runs for made packs below their reorder level.
// - The run drawer: Start (issues the materials from Good), Finish (packs made, material really used, wastage reason),
//   production QC (passed / rejected: normal and abnormal loss), Check again, Cancel (planned only), Print labels.
// - Machines (Edit): name, godown, what it makes, packs per hour, working or stopped (with why).
// Costs show only to See cost (the API sends null: "hidden").
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, ViewOnlyB, at, bm, fe, fieldsOf, useOpenParam } from './buyShared';

const RUN_TONE = { planned: 'info', started: 'warn', done: 'good', cancelled: 'gray' };
const TABS = [['planned', 'Planned'], ['started', 'Running'], ['done', 'Finished and cancelled'], ['machines', 'Machines']];

/** the status of a run and what waits on it */
export function RunPills({ r }) {
  return (
    <>
      <Pill tone={RUN_TONE[r.status]}>{r.status_label}</Pill>
      {r.status === 'done' && r.qc === 'hold' && <> <Pill tone="warn">In QC hold</Pill></>}
      {r.fin_waiting && <> <Pill tone="warn">Finish waiting</Pill></>}
      {r.wst === 'waiting' ? <> <Pill tone="warn">Wastage waiting</Pill></> : r.wst === 'rejected' ? <> <Pill tone="bad">Wastage rejected</Pill></> : null}
      {r.recheck > 0 && <> <Pill tone="warn">Check again</Pill></>}
      {r.late && <> <Pill tone="bad">Late</Pill></>}
    </>
  );
}

export default function ProductionRuns() {
  const [tab, setTab] = useState('planned');
  const data = useLoad(`/production/runs?tab=${tab === 'machines' ? 'planned' : tab}`);
  const mach = useLoad('/production/machines');
  const { me } = useAdmin();
  const canCreate = useCan('production', 'create');
  const canEdit = useCan('production', 'edit');
  const act = useAction();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [plan, setPlan] = useState(false);
  const [mOpen, setMOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const reload = () => { data.reload(); mach.reload(); };
  const planLow = () => act.run(async () => { const out = await api.send('POST', '/production/runs/plan-low'); toast(out.tone, out.title, out.message); setTab('planned'); reload(); });
  const columns = [
    { key: 'run_no', label: 'Run', render: (r) => <><b className="a-mono">{r.run_no}</b><small className="a-muted a-p15-sub">{r.godown}{r.batch_no ? ` · batch ${r.batch_no}` : ''}</small></> },
    { key: 'pack', label: 'Pack', render: (r) => <ItemCell name={r.name} code={r.sku_code} /> },
    { key: 'qty', label: 'Packs', num: true, render: (r) => <><b>{r.out !== null && r.out !== undefined ? `${r.out} of ${r.qty}` : r.qty}</b><small className="a-muted a-p15-sub">{r.cartons} cartons</small></> },
    { key: 'machine', label: 'Machine', hideSm: true },
    { key: 'day', label: 'Day', hideSm: true, render: (r) => `${r.run_date} · ${r.shift}` },
    { key: 'status', label: 'Status', render: (r) => <RunPills r={r} /> },
  ];
  const mcols = [
    { key: 'name', label: 'Machine', render: (m) => <><b>{m.name}</b><small className="a-muted a-p15-sub">M{m.machine_id}</small></> },
    { key: 'godown', label: 'Godown' },
    { key: 'makes', label: 'Makes', render: (m) => <span className="a-p17-pills">{m.makes.map((c) => <Pill key={c}>{((mach.data && mach.data.categories.find((x) => x.key === c)) || { name: c }).name}</Pill>)}</span> },
    { key: 'per_hour', label: 'Packs per hour', num: true, render: (m) => m.per_hour.toLocaleString('en-IN') },
    { key: 'status', label: 'State', render: (m) => (m.status === 'active' ? <><Pill tone="good">Working</Pill>{m.busy && <small className="a-muted a-p15-sub">running {m.busy}</small>}</> : <><Pill tone="bad">Stopped</Pill><small className="a-muted a-p15-sub">{m.stop_reason}</small></>) },
  ];
  const empty = { planned: 'No run is planned. Plan a run, or Plan from low stock.', started: 'Nothing is running.', done: 'Nothing finished yet.' }[tab];
  const counts = d ? { ...d.counts } : {};
  return (
    <section>
      <PageHead sub="Plan, start and finish runs on the machines" rules={['Materials leave stock when a run starts', `Finished packs land in QC hold${d && !d.quarantine ? ' (switched off)' : ''}`, 'Wastage above the recipe waits for approval']}
        actions={tab !== 'machines' ? canCreate && <><button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={planLow}><LIcon name="clipboard-list" size="sm" />Plan from low stock</button>
          <button type="button" className="a-btn" onClick={() => setPlan(true)}><LIcon name="plus" size="sm" />Plan a run</button></>
          : canEdit && <button type="button" className="a-btn" onClick={() => setMOpen('new')}><LIcon name="plus" size="sm" />New machine</button>} />
      {!canCreate && <ViewOnlyB me={me} what="production runs" />}
      {act.note}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Production runs" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: k === 'machines' ? counts.machines : counts[k] }))} />
            {tab === 'machines'
              ? <Loading state={mach}>{mach.data && <div className="a-listcard"><Table columns={mcols} rows={mach.data.rows} rowKey={(m) => m.machine_id} label="Machines" onRowClick={(m) => setMOpen(m.machine_id)} empty={{ icon: 'inbox', title: 'No machine yet', text: 'Add the machines of each godown: a run is planned on one.' }} /></div>}</Loading>
              : <div className="a-listcard"><Table columns={columns} rows={d.rows} rowKey={(r) => r.run_id} label="Production runs" onRowClick={(r) => setOpen(r.run_id)} empty={{ icon: 'inbox', title: 'Nothing here', text: empty }} /></div>}
          </>
        )}
      </Loading>
      {plan && <PlanDrawer onClose={() => setPlan(false)} onSaved={() => { setPlan(false); setTab('planned'); reload(); }} />}
      {open && <RunDrawer id={open} onClose={() => setOpen(null)} onChanged={(t) => { if (t) setTab(t); reload(); }} />}
      {mOpen && mach.data && <MachineDrawer id={mOpen} data={mach.data} onClose={() => setMOpen(null)} onSaved={() => { setMOpen(null); reload(); }} />}
    </section>
  );
}

function MachineDrawer({ id, data, onClose, onSaved }) {
  const isNew = id === 'new';
  const m = isNew ? null : data.rows.find((x) => x.machine_id === id);
  const ed = data.can.edit;
  const act = useAction();
  const toast = useToast();
  const start = m ? { name: m.name, godown_id: String(m.godown_id), makes: m.makes, per_hour: String(m.per_hour), status: m.status, stop_reason: m.stop_reason || '' }
    : { name: '', godown_id: String((data.godowns[0] || {}).godown_id || ''), makes: [], per_hour: '', status: 'active', stop_reason: '' };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send(isNew ? 'POST' : 'PUT', isNew ? '/production/machines' : `/production/machines/${id}`, f); toast('good', `${f.name} saved`, out.message); onSaved(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={isNew ? 'New machine' : m.name} onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} thumb={<LIcon name="factory" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{ed ? 'Cancel' : 'Close'}</button>{ed && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button>}</>}>
      {act.note}
      <div className="a-grid2">
        <Field def={{ name: 'name', label: 'Name', required: true, error: err.name }} value={f.name} onChange={(v) => set('name')(String(v).slice(0, 40))} disabled={!ed} />
        <Field def={{ name: 'godown_id', label: 'Godown', type: 'select', allowEmpty: false, required: true, error: err.godown_id, options: (isNew ? data.godowns : [{ godown_id: m.godown_id, name: m.godown }]).map((g) => ({ value: String(g.godown_id), label: g.name })) }}
          value={f.godown_id} onChange={set('godown_id')} disabled={!ed || !isNew} />
      </div>
      <h3>Makes *</h3>
      <div className="a-chkgrid">{data.categories.filter((c) => c.key !== 'wipes').map((c) => (
        <label key={c.key} className="a-check"><input type="checkbox" disabled={!ed} checked={f.makes.includes(c.key)} onChange={(e) => set('makes')(e.target.checked ? [...f.makes, c.key] : f.makes.filter((x) => x !== c.key))} /> {c.name}</label>
      ))}</div>
      {err.makes && <p className="a-emsg" role="alert">{err.makes}</p>}
      <div className="a-grid2">
        <In label="Packs per hour *" type="number" min="1" step="1" value={f.per_hour} disabled={!ed} error={err.per_hour} hint="Used to show how long a run takes." onChange={(e) => set('per_hour')(e.target.value)} />
        <In label="State *" error={err.status}><select value={f.status} disabled={!ed} onChange={(e) => set('status')(e.target.value)}><option value="active">Working</option><option value="stopped">Stopped</option></select></In>
        {f.status === 'stopped' && <In label="Why stopped *" wide value={f.stop_reason} maxLength={80} disabled={!ed} error={err.stop_reason} hint="A stopped machine cannot be given a run." onChange={(e) => set('stop_reason')(e.target.value)} />}
      </div>
    </Drawer>
  );
}

function NeedTable({ lines, godown, issued }) {
  return (
    <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Material</th><th className="a-num">{issued ? 'Issued' : 'Needed'}</th><th className="a-num">Usable at {godown}</th></tr></thead>
      <tbody>{lines.map((l) => (
        <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} /></td><td className="a-num">{issued ? l.issued_text : l.need_text}</td>
          <td className="a-num">{l.short && !issued ? <b className="a-bad">{l.have_text}</b> : l.have_text}{l.hold_text && <small className="a-muted a-p15-sub">+{l.hold_text} in QC hold</small>}</td></tr>
      ))}</tbody></table></div>
  );
}

function PlanDrawer({ onClose, onSaved }) {
  const opts = useLoad('/production/options');
  const o = opts.data;
  if (!o) return <Drawer title="Plan a run" onClose={onClose}><Loading state={opts}>{null}</Loading></Drawer>;
  return <PlanForm o={o} onClose={onClose} onSaved={onSaved} />;
}
function PlanForm({ o, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const start = { sku_code: '', godown_id: String((o.godowns[0] || {}).godown_id || ''), qty: '', machine_id: '', run_date: o.today, shift: o.shifts[0], operator: '' };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const [calc, setCalc] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    let live = true;
    if (!f.sku_code || !(Number(f.qty) > 0)) { setCalc(null); return undefined; }
    api.get(`/production/run-calc?sku=${encodeURIComponent(f.sku_code)}&qty=${Number(f.qty)}&godown=${f.godown_id}&machine=${f.machine_id}&date=${f.run_date}`).then((x) => { if (live) setCalc(x); }).catch(() => {});
    return () => { live = false; };
  }, [f.sku_code, f.qty, f.godown_id, f.machine_id, f.run_date]);
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/production/runs', f); toast(out.tone, out.title, out.message); onSaved(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const g = o.godowns.find((x) => String(x.godown_id) === f.godown_id);
  return (
    <Drawer title="Plan a run" onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} thumb={<LIcon name="factory" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Plan the run</button></>}>
      <Alert tone="info" title="Plan a run.">Only made packs with a recipe show here. The run gets its number now; materials leave stock only when it starts.</Alert>
      {act.note}
      <div className="a-grid2">
        <In label="Pack *" wide error={err.sku_code}><select value={f.sku_code} onChange={(e) => set('sku_code')(e.target.value)}><option value="">Choose...</option>{o.packs.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.name}</option>)}</select></In>
        <In label="Godown *" error={err.godown_id}><select value={f.godown_id} onChange={(e) => set('godown_id')(e.target.value)}>{o.godowns.map((x) => <option key={x.godown_id} value={String(x.godown_id)}>{x.name}</option>)}</select></In>
        <In label="Packs to make *" type="number" min="1" step="1" value={f.qty} error={err.qty} hint="Whole cartons are easiest to pack." onChange={(e) => set('qty')(e.target.value)} />
        <In label="Machine *" error={err.machine_id}><select value={f.machine_id} onChange={(e) => set('machine_id')(e.target.value)}><option value="">Choose...</option>
          {o.machines.map((m) => <option key={m.machine_id} value={String(m.machine_id)}>{m.name} · {m.godown}{m.status !== 'active' ? ' - stopped' : ''}</option>)}</select></In>
        <In label="Day *" type="date" min={o.today} value={f.run_date} error={err.run_date} onChange={(e) => set('run_date')(e.target.value)} />
        <In label="Shift *" error={err.shift}><select value={f.shift} onChange={(e) => set('shift')(e.target.value)}>{o.shifts.map((x) => <option key={x}>{x}</option>)}</select></In>
        <In label="Operator *" wide error={err.operator}><select value={f.operator} onChange={(e) => set('operator')(e.target.value)}><option value="">Choose...</option>
          {o.operators.map((x) => <option key={x.emp_id} value={x.emp_id}>{x.name}{x.role ? ` (${x.role})` : ''}</option>)}</select></In>
      </div>
      {!calc || !calc.ready ? <p className="a-hint-s">Choose the pack and how many to see what it needs.</p> : (
        <div className="a-p17-calc">
          <p className="a-hint-s a-p16-mt0">Recipe v{calc.ver}: {calc.out} packs per batch, {calc.waste}% wastage allowed. {calc.not_whole && <b className="a-bad">{f.qty} is not whole cartons of {calc.not_whole}. </b>}
            {calc.hours !== null && `About ${calc.hours} hours on ${calc.machine}. `}{calc.made_total !== null && `Made cost about Rs ${Number(calc.made_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`}</p>
          <NeedTable lines={calc.lines} godown={g ? g.name : ''} />
          {calc.short.length > 0 && <Alert tone="warn" title="Not enough material today.">{calc.short.join('; ')}. You can plan it; it cannot start until the material is in.</Alert>}
        </div>
      )}
    </Drawer>
  );
}

/** a run: its facts and what can be done next (also opened from Purchase > Quality check) */
export function RunDrawer({ id, onClose, onChanged }) {
  const one = useLoad(`/production/runs/${id}`);
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const [fin, setFin] = useState(null);
  const [qc, setQc] = useState(null);
  const [re, setRe] = useState('');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState({});
  const r = one.data;
  if (!r) return <Drawer title="Run" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const f = fin || { out: String(r.qty), scrap: '', reason: '', used: (r.issued || []).map((l) => String(l.issued)) };
  const qv = qc || { acc: String(r.out ?? ''), rej: '0' };
  const post = (path, body, tab) => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/production/runs/${r.run_id}/${path}`, body); toast(out.tone || 'good', out.title, out.message); setFin(null); setQc(null); setRe(''); one.reload(); onChanged(tab); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  const L = r.losses;
  return (
    <Drawer title={`Run ${r.run_no}`} onClose={onClose} thumb={<LIcon name="factory" />} dirty={Boolean(fin || qc || re || why)}
      status={<><RunPills r={r} /><span className="a-p15-sp" />
        {r.can.start && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => post('start', {}, 'started')}><LIcon name="factory" size="sm" />Start: issue materials</button>}
        {r.labels && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => nav(`/admin/commerce/skus?tab=labels&sku=${encodeURIComponent(r.labels.sku)}&type=carton&copies=${r.labels.copies}`)}><LIcon name="tag" size="sm" />Print labels</button>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        {r.can.finish && <button type="button" className="a-btn" disabled={act.busy} onClick={() => post('finish', f, 'done')}><LIcon name="check" size="sm" />Finish the run</button>}</>}>
      {act.note}
      {r.fin ? <Alert tone="warn" title="Finish waits for approval.">{r.fin.out} packs with less material than the recipe. Nothing has moved yet. {r.fin.line}</Alert>
        : r.fin_note ? <Alert tone="bad" title="Finish not signed.">{r.fin_note}</Alert> : null}
      {r.uncosted && <Alert tone="warn" title={`${r.uncosted.qty} packs had no cost.`}>They were given {bm(r.uncosted.unit)} from this run. If that is wrong, set the standard cost in Products.</Alert>}
      <dl className="a-kv">
        <KV k="Pack">{r.sku_code} · {r.name}</KV>
        <KV k="Packs">{r.out !== null && r.out !== undefined ? `${r.out} made of ${r.qty} planned` : `${r.qty} planned`} ({r.cartons} cartons)</KV>
        <KV k="Machine">{r.machine} · {r.godown}</KV>
        <KV k="Day">{r.run_date} · {r.shift} shift · {r.operator}</KV>
        <KV k="Recipe">{r.recipe ? `v${r.recipe.ver} · ${r.recipe.waste}% wastage allowed` : 'none'}</KV>
        {r.batch_no && <KV k="Batch"><span className="a-mono">{r.batch_no}</span></KV>}
        <KV k="Planned by">{r.planned_by} on {at(r.planned_at)}{r.is_auto ? ' (Plan from low stock)' : ''}</KV>
        {r.started_at && <KV k="Started">{at(r.started_at)}</KV>}
        {r.ended_at && <KV k="Finished">{at(r.ended_at)}</KV>}
        {L && <KV k="Rejected at QC">{L.rej} packs: {L.normal} normal loss (within {L.allow} allowed, cost in the passed packs, {bm(L.normal_value)}, {L.wo_normal || '-'})
          {L.abnormal ? <> · {L.abnormal} abnormal loss {bm(L.abnormal_value)} at cost ({L.wo_abnormal}, {L.wo_abnormal_status === 'posted' ? 'approved, written off' : L.wo_abnormal_status === 'pending' ? 'waiting for approval' : 'not approved: back to QC hold'})</> : null}</KV>}
        {r.made_cost !== undefined && r.made_cost !== null && <KV k="Made cost">{bm(r.made_cost)} per pack{r.run_cost !== null ? <> · run {bm(r.run_cost)}</> : null}</KV>}
        {r.qc_done && r.qc_done.unit_passed !== null && r.qc_done.rej > 0 && <KV k="Passed packs carry">{bm(r.qc_done.unit_passed)} each</KV>}
      </dl>
      {r.need && <><h3>What it needs</h3><NeedTable lines={r.need} godown={r.godown} /></>}
      {r.status === 'started' && r.issued && <><h3>Issued at start</h3><NeedTable lines={r.issued} godown={r.godown} issued /></>}
      {r.can.finish && (
        <>
          <h3>Finish the run</h3>
          <div className="a-grid2">
            <In label="Packs made *" type="number" min="0" step="1" value={f.out} error={err.out} hint="Part output is fine: the rest is not made." onChange={(e) => setFin({ ...f, out: e.target.value })} />
            <In label="Reusable trim kept (kg)" type="number" min="0" step="0.1" value={f.scrap} error={err.scrap} hint="Kept as scrap, not counted as lost." onChange={(e) => setFin({ ...f, scrap: e.target.value })} />
          </div>
          <p className="a-hint-s">Material really used. More than issued is taken from stock; less goes back.</p>
          <div className="a-p17-used">{r.issued.map((l, i) => (
            <In key={l.sku_code} label={`${l.name} (${l.unit}) *`} type="number" min="0" step="0.01" value={f.used[i]} error={fe(err, `used.${i}`)} hint={`Issued ${l.issued_text}`}
              onChange={(e) => setFin({ ...f, used: f.used.map((u, j) => (j === i ? e.target.value : u)) })} />
          ))}</div>
          <In label="Wastage reason" error={err.reason} hint="Needed when more, or less, than the recipe is used."><select value={f.reason} onChange={(e) => setFin({ ...f, reason: e.target.value })}><option value="">-</option>{r.reasons.map((x) => <option key={x}>{x}</option>)}</select></In>
        </>
      )}
      {r.waste && (
        <>
          <h3>Used</h3>
          <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Material</th><th className="a-num">Standard for {r.out} packs</th><th className="a-num">Used</th></tr></thead>
            <tbody>{r.waste.lines.map((l) => <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} /></td><td className="a-num">{l.std_text}</td><td className="a-num">{l.used_text}</td></tr>)}</tbody></table></div>
          <Alert tone={r.wst === 'waiting' || r.wst === 'rejected' ? 'warn' : 'info'} title={`Wastage ${r.waste.wpct}% on ${r.waste.on} (recipe allows ${r.waste.allowed}%).`}>
            {r.wst_line}{r.reason ? ` Reason: ${r.reason}.` : ''}{r.scrap_kg ? ` Reusable trim kept: ${r.scrap_kg} kg.` : ''}</Alert>
        </>
      )}
      {r.can.qc && (
        <div className="a-p16-endbox">
          <b>Quality check of the packs made</b>
          <p className="a-hint-s a-p16-mt0">{r.out} packs are in QC hold. Passed packs go to stock at the made cost; rejects within the recipe&apos;s {r.recipe ? r.recipe.waste : 0}% are a normal loss, the rest an abnormal loss written off at cost with approval.</p>
          <div className="a-grid2">
            <In label="Passed *" type="number" min="0" step="1" value={qv.acc} error={err.acc} onChange={(e) => setQc({ ...qv, acc: e.target.value })} />
            <In label="Rejected *" type="number" min="0" step="1" value={qv.rej} onChange={(e) => setQc({ ...qv, rej: e.target.value })} />
          </div>
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => post('qc', qv)}><LIcon name="check" size="sm" />Save the check</button>
        </div>
      )}
      {r.recheck && r.can.recheck && (
        <div className="a-p16-endbox">
          <b>Check again: {r.recheck.qty} packs on QC hold</b>
          <p className="a-hint-s a-p16-mt0">{r.recheck.note} Pass the good ones to stock at their made cost{r.recheck.unit !== null ? <> ({bm(r.recheck.unit)} each)</> : null}; the rest go as a write-off for approval.</p>
          <In label="Passed *" type="number" min="0" step="1" value={re === '' ? String(r.recheck.qty) : re} error={err.acc} onChange={(e) => setRe(e.target.value)} />
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => post('recheck', { acc: re === '' ? r.recheck.qty : re })}><LIcon name="check" size="sm" />Save the check</button>
        </div>
      )}
      {r.recheck && !r.can.recheck && <Alert tone="warn" title={`Check again: ${r.recheck.qty} packs on QC hold.`}>{r.recheck.note}</Alert>}
      {r.recheck_done && <p className="a-hint-s">{r.recheck_done.note}{r.recheck_done.wo_status === 'pending' ? ' The write-off waits for approval.' : r.recheck_done.wo_status === 'posted' ? ' The write-off is approved.' : ''}</p>}
      {r.qc_done && <p className="a-hint-s">Quality check: {r.qc_done.acc} passed{r.qc_done.rej ? `, ${r.qc_done.rej} rejected` : ''} · {r.qc_done.by}{r.qc_done.at ? ` · ${at(r.qc_done.at)}` : ''}.</p>}
      {r.can.cancel && (
        <div className="a-p16-endbox">
          <b>Cancel this run</b>
          <p className="a-hint-s a-p16-mt0">Only before it starts. The number stays used, marked cancelled.</p>
          <In label="Reason *" wide value={why} maxLength={120} error={err.reason} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="a-btn a-btn-danger a-btn-sm" disabled={act.busy} onClick={() => post('cancel', { reason: why }, 'done')}>Cancel run</button>
        </div>
      )}
      {r.cancelled && <Alert tone="info" title={`Cancelled by ${r.cancelled.by}.`}>{r.cancelled.reason}</Alert>}
    </Drawer>
  );
}


