// Production > Wastage (phase 17, v23 viewWastage; API /production/wastage in production-routes.js). Every finished
// run: the reel (the main material) its recipe allows for what was made against what it used, the wastage % against
// the recipe's, the reason and the approval. Above the recipe by more than the "Production wastage above the recipe"
// rule waits for approval. Totals: reel lost, reusable trim kept, and reel lost per machine. Rows open the run.
import { useState } from 'react';
import { Loading, PageHead, Pill, Stat, Table, useLoad } from './ui';
import { ItemCell } from './buyShared';
import { RunDrawer } from './ProductionRuns';

const TONE = { ok: 'good', waiting: 'warn', approved: 'good', rejected: 'bad' };
const kg = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg`;

export default function Wastage() {
  const data = useLoad('/production/wastage');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const cols = [
    { key: 'run_no', label: 'Run', render: (r) => <><b className="a-mono">{r.run_no}</b><small className="a-muted a-p15-sub a-p18-nowrap">{r.machine} · {r.run_date}</small></> },
    { key: 'pack', label: 'Pack', render: (r) => <ItemCell name={r.name} code={r.sku_code} /> },
    { key: 'std', label: 'Reel standard', num: true, render: (r) => kg(r.reel_std) },
    { key: 'used', label: 'Reel used', num: true, render: (r) => kg(r.reel_used) },
    { key: 'wpct', label: 'Wastage', num: true, render: (r) => <><b className={r.over ? 'a-bad' : undefined}>{r.wpct}%</b><small className="a-muted a-p15-sub">allowed {r.allowed}%</small></> },
    { key: 'reason', label: 'Reason', hideSm: true, render: (r) => r.reason || '-' },
    { key: 'wst', label: 'Approval', render: (r) => <Pill tone={TONE[r.wst]}>{r.wst_label}</Pill> },
  ];
  return (
    <section>
      <PageHead sub="What each run lost against its recipe" rules={['Measured on the reel against the recipe', d ? `Above the recipe by more than ${d.rule.pct}% waits for approval` : 'Above the recipe waits for approval', 'Reusable trim kept as scrap']} />
      <Loading state={data}>
        {d && (
          <>
            <div className="a-stats">
              <Stat label="Reel lost in runs" value={kg(d.stats.lost)} sub={`${d.stats.runs} finished run${d.stats.runs === 1 ? '' : 's'}`} icon="factory" tone="warn" />
              <Stat label="Reusable trim in stock" value={kg(d.stats.scrap)} sub="can be sold as scrap" icon="package" tone="good" />
              {d.stats.machines.map((m) => <Stat key={m.name} label={m.name} value={kg(m.kg)} sub="reel lost" icon="factory" tone="bad" />)}
            </div>
            <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.run_id} label="Wastage per run" onRowClick={(r) => setOpen(r.run_id)}
              empty={{ icon: 'inbox', title: 'No finished runs yet', text: 'Wastage shows here when a run is finished.' }} /></div>
          </>
        )}
      </Loading>
      {open && <RunDrawer id={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
    </section>
  );
}
