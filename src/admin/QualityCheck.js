// Purchase > Quality check (phase 16, v23 viewQc / DRAWERS.qc; API /buying/qc and /buying/goods-in/:id/qc in
// buying-routes.js). Goods in waiting in QC hold, oldest first, and the last five checked. Every unit is accepted or
// rejected (accepted + rejected = received); a reason for what is rejected; a paper spec on the supplier's item list
// asks for the GSM measured, and accepting outside spec +/- 1 needs a reason. Accepted goes to Good at landed cost and
// moves the average; rejected goes to the Rejected shelf and starts a claim. Check needs Edit on Suppliers and buying.
// Phase 17: production runs in QC hold and runs to "Check again" are listed too (rights: Production); they open the
// run drawer (ProductionRuns.js), where the check is saved. Each part shows to the people with rights on it.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, SupCell, ViewOnlyB, at, fe, fieldsOf, useOpenParam } from './buyShared';
import { RunDrawer } from './ProductionRuns';

export default function QualityCheck() {
  const canBuy = useCan('buying', 'view');
  const canProd = useCan('production', 'view');
  const data = useLoad(canBuy ? '/buying/qc' : null);
  const prod = useLoad(canProd ? '/production/qc' : null);
  const { me } = useAdmin();
  const canEdit = useCan('buying', 'edit');
  const [open, setOpen] = useState(null);
  const [run, setRun] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const waiting = [
    { key: 'grn_no', label: 'Goods in', render: (g) => <><b className="a-mono">{g.grn_no}</b><small className="a-muted a-p15-sub">{g.godown}</small></> },
    { key: 'supplier', label: 'Supplier', render: (g) => <SupCell s={g.supplier} /> },
    { key: 'items', label: 'Items', render: (g) => <>{g.items_text}<small className="a-muted a-p15-sub">{g.qty_text}</small></> },
    { key: 'created_at', label: 'Waiting since', hideSm: true, render: (g) => at(g.created_at) },
    { key: 'act', label: '', render: (g) => (canEdit ? <button type="button" className="a-btn a-btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(g.grn_id); }}>Check</button> : null) },
  ];
  const done = [
    { key: 'grn_no', label: 'Goods in', render: (g) => <b className="a-mono">{g.grn_no}</b> },
    { key: 'supplier', label: 'Supplier', render: (g) => <SupCell s={g.supplier} /> },
    { key: 'acc', label: 'Accepted', num: true, render: (g) => g.acc.toLocaleString('en-IN') },
    { key: 'rej', label: 'Rejected', num: true, render: (g) => (g.rej ? <b className="a-bad">{g.rej.toLocaleString('en-IN')}</b> : '0') },
    { key: 'qc_by', label: 'Checked by', hideSm: true, render: (g) => `${g.qc_by} · ${at(g.qc_at)}` },
  ];
  const p = prod.data;
  const runCols = [
    { key: 'run_no', label: 'Run', render: (r) => <><b className="a-mono">{r.run_no}</b><small className="a-muted a-p15-sub">{r.godown}{r.batch_no ? ` · batch ${r.batch_no}` : ''}</small></> },
    { key: 'pack', label: 'Pack', render: (r) => <ItemCell name={r.name} code={r.sku_code} /> },
    { key: 'out', label: 'Packs', num: true, render: (r) => Number(r.recheck || r.out).toLocaleString('en-IN') },
    { key: 'ended_at', label: 'Finished', hideSm: true, render: (r) => at(r.ended_at) },
    { key: 'act', label: '', render: (r) => (p && p.can.edit ? <button type="button" className="a-btn a-btn-sm" onClick={(e) => { e.stopPropagation(); setRun(r.run_id); }}>{r.recheck ? 'Check again' : 'Check'}</button> : null) },
  ];
  const runDone = [
    { key: 'run_no', label: 'Run', render: (r) => <b className="a-mono">{r.run_no}</b> },
    { key: 'pack', label: 'Pack', render: (r) => <ItemCell name={r.name} code={r.sku_code} /> },
    { key: 'acc', label: 'Passed', num: true, render: (r) => Number(r.acc).toLocaleString('en-IN') },
    { key: 'rej', label: 'Rejected', num: true, render: (r) => (r.rej ? <b className="a-bad">{Number(r.rej).toLocaleString('en-IN')}</b> : '0') },
    { key: 'qc_by', label: 'Checked by', hideSm: true, render: (r) => `${r.qc_by} · ${at(r.qc_at)}` },
  ];
  return (
    <section>
      <PageHead sub="Accept or reject what arrived" rules={['Accepted goes to stock at landed cost', 'Rejected starts a claim', "Reels: GSM checked against the supplier's spec"]} />
      {canBuy && !canEdit && <ViewOnlyB me={me} what="quality check" />}
      {canProd && (
        <Loading state={prod}>
          {p && (
            <>
              <div className="a-card a-p16-qcard">
                <div className="a-p15-cardhead"><h2 className="a-p16-h2">Production runs waiting for a check</h2><Pill tone={p.waiting.length ? 'warn' : 'gray'}>{p.waiting.length}</Pill></div>
                <Table columns={runCols} rows={p.waiting} rowKey={(r) => r.run_id} label="Production runs waiting for a check" onRowClick={(r) => setRun(r.run_id)} empty={{ icon: 'inbox', title: 'Nothing waiting', text: 'Finished runs land here until somebody checks them.' }} />
              </div>
              {p.again.length > 0 && (
                <div className="a-card a-p16-qcard">
                  <div className="a-p15-cardhead"><h2 className="a-p16-h2">Check again</h2><Pill tone="warn">{p.again.length}</Pill><span className="a-p15-sp" /><small className="a-muted">A loss that was not approved: the packs are back on QC hold at their made cost.</small></div>
                  <Table columns={runCols} rows={p.again} rowKey={(r) => r.run_id} label="Check again" onRowClick={(r) => setRun(r.run_id)} />
                </div>
              )}
              {p.done.length > 0 && (
                <div className="a-card a-p16-qcard">
                  <div className="a-p15-cardhead"><h2 className="a-p16-h2">Runs checked lately</h2></div>
                  <Table columns={runDone} rows={p.done} rowKey={(r) => r.run_id} label="Runs checked lately" onRowClick={(r) => setRun(r.run_id)} />
                </div>
              )}
            </>
          )}
        </Loading>
      )}
      {canBuy && <Loading state={data}>
        {d && (
          <>
            {!d.quarantine && <Alert tone="info" title="QC hold is switched off.">New goods in are passed the moment they are counted (Admin &gt; Settings &gt; Switches).</Alert>}
            <div className="a-card a-p16-qcard">
              <div className="a-p15-cardhead"><h2 className="a-p16-h2">Waiting for a check</h2><Pill tone={d.waiting.length ? 'warn' : 'gray'}>{d.waiting.length}</Pill></div>
              <Table columns={waiting} rows={d.waiting} rowKey={(g) => g.grn_id} label="Waiting for a check" onRowClick={canEdit ? (g) => setOpen(g.grn_id) : undefined} empty={{ icon: 'inbox', title: 'Nothing waiting', text: 'Goods in land here until somebody checks them.' }} />
            </div>
            {d.done.length > 0 && (
              <div className="a-card a-p16-qcard">
                <div className="a-p15-cardhead"><h2 className="a-p16-h2">Checked lately</h2></div>
                <Table columns={done} rows={d.done} rowKey={(g) => g.grn_id} label="Checked lately" />
              </div>
            )}
          </>
        )}
      </Loading>}
      {open && <QcDrawer id={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
      {run && <RunDrawer id={run} onClose={() => setRun(null)} onChanged={() => prod.reload()} />}
    </section>
  );
}

function QcDrawer({ id, onClose, onSaved }) {
  const one = useLoad(`/buying/goods-in/${id}/qc`);
  const g = one.data;
  if (!g) return <Drawer title="Quality check" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return <QcForm g={g} onClose={onClose} onSaved={onSaved} />;
}

function QcForm({ g, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const start = g.lines.map((l) => ({ acc: String(l.recv), rej: '0', reason: '', gsm: '', deviation: '' }));
  const [rows, setRows] = useState(start);
  const [note, setNote] = useState('');
  const [err, setErr] = useState({});
  const set = (i, k, v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/buying/goods-in/${g.grn_id}/qc`, { lines: rows, note }); toast(out.claim ? 'warn' : 'good', `${g.grn_no} checked`, out.message); onSaved(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={`Quality check ${g.grn_no}`} pill={<Pill>{g.supplier.name}</Pill>} onClose={onClose} dirty={JSON.stringify(rows) !== JSON.stringify(start) || note !== ''} thumb={<LIcon name="clipboard-check" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save the check</button></>}>
      <Alert tone="info" title="Every unit is either accepted or rejected.">Accepted goes into stock at {g.godown} and moves the average cost. Rejected stays aside, waiting to go back, and a claim is started.</Alert>
      {act.note}
      {g.lines.map((l, i) => (
        <div key={l.sku_code} className="a-p16-qcl">
          <div className="a-p16-qch"><ItemCell name={l.name} code={l.sku_code} sub={l.batch_no ? `batch ${l.batch_no}` : null} /><span className="a-p15-sp" /><b>Received {l.recv_text}</b></div>
          <div className="a-p16-f4">
            <In label="Accepted *" type="number" min="0" step="1" value={rows[i].acc} error={fe(err, `lines.${i}.acc`)} onChange={(e) => set(i, 'acc', e.target.value)} />
            <In label="Rejected *" type="number" min="0" step="1" value={rows[i].rej} error={fe(err, `lines.${i}.rej`)} onChange={(e) => set(i, 'rej', e.target.value)} />
            <In label="Why rejected" error={fe(err, `lines.${i}.reason`)}><select value={rows[i].reason} onChange={(e) => set(i, 'reason', e.target.value)}><option value="">-</option>{g.reasons.map((x) => <option key={x}>{x}</option>)}</select></In>
            {l.spec ? <In label="GSM measured *" type="number" min="0" step="0.1" value={rows[i].gsm} error={fe(err, `lines.${i}.gsm`)} hint={`Spec ${l.spec.gsm} +/- 1${l.spec.ply ? `, ${l.spec.ply}-ply` : ''}${l.spec.width ? `, ${l.spec.width} mm wide` : ''}.`} onChange={(e) => set(i, 'gsm', e.target.value)} /> : <span />}
            {l.spec && <In label="Accepted outside the spec because" wide value={rows[i].deviation} maxLength={120} error={fe(err, `lines.${i}.deviation`)} hint="Needed only when the GSM is outside the spec and some is accepted." onChange={(e) => set(i, 'deviation', e.target.value)} />}
          </div>
        </div>
      ))}
      <Field def={{ name: 'note', label: 'Note', wide: true }} value={note} onChange={(v) => setNote(String(v).slice(0, 160))} />
    </Drawer>
  );
}
