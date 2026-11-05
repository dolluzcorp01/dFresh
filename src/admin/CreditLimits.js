// Sales > Customers > Credit limits (phase 19, v23 viewCredit / DRAWERS.credit; API /sales/credit in sales-routes.js, the
// change through PUT /commerce/customers/:id/credit). Each customer seen: limit (or cash), days to pay, owes, used %,
// overdue, a raise waiting, and what an order today would do ("Go through" or "Wait: on hold, overdue, over the limit").
// Raising a limit waits for a second person (rule credit_raise); lowering it is done at once.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, money, useAction, useLoad, useToast } from './ui';
import { In, fieldsOf, useOpenParam } from './buyShared';

export default function CreditLimits() {
  const data = useLoad('/sales/credit');
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(String(id)));
  const cols = [
    { key: 'name', label: 'Customer', render: (r) => <><b>{r.name}</b><small className="a-muted a-p15-sub">{r.customer_no} · {r.ctype}</small></> },
    { key: 'credit_limit', label: 'Limit', num: true, render: (r) => <>{r.credit_limit ? money(r.credit_limit) : 'cash'}{r.waiting && <small className="a-p15-sub"><Pill tone="warn">{money(r.waiting.limit)} waiting</Pill></small>}</> },
    { key: 'credit_days', label: 'Days', num: true },
    { key: 'owes', label: 'Owes', num: true, render: (r) => money(r.owes) },
    { key: 'used', label: 'Used', num: true, hideSm: true, render: (r) => (r.used_pct === null ? '-' : <><span className="a-meter"><span className={r.used_pct > 100 ? 'bad' : r.used_pct > 80 ? 'warn' : ''} style={{ width: `${Math.min(100, r.used_pct)}%` }} /></span><small className="a-muted a-p15-sub">{r.used_pct}%</small></>) },
    { key: 'overdue', label: 'Overdue', num: true, render: (r) => (r.overdue ? <b className="a-bad">{money(r.overdue)}</b> : '-') },
    { key: 'would', label: 'Orders today would', render: (r) => (r.would.length ? <Pill tone="warn">Wait: {r.would.join(', ')}</Pill> : <Pill tone="good">Go through</Pill>) },
  ];
  return (
    <section>
      <PageHead sub="How much each customer may owe, and what an order today would do" rules={['Raising a limit needs a second person', 'An order over the limit, overdue or on hold waits', 'Lowering a limit is done at once']} />
      <Loading state={data}>
        {d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.customer_id} label="Credit limits" onRowClick={(r) => setOpen(String(r.customer_id))} empty={{ icon: 'wallet', title: 'No customer', text: 'No customer in your godowns.' }} /></div>}
      </Loading>
      {open && d && <CreditDrawer r={d.rows.find((x) => String(x.customer_id) === open)} canEdit={d.can.edit} onClose={() => setOpen(null)} onSaved={() => data.reload()} />}
    </section>
  );
}

function CreditDrawer({ r, canEdit, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const start = { credit_limit: r ? String(r.credit_limit) : '0', credit_days: r ? String(r.credit_days) : '0', why: '' };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  if (!r) return null;
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const edit = canEdit && !r.waiting;
  const save = () => act.run(async () => {
    const e0 = {};
    if (!/^\d+$/.test(f.credit_limit)) e0.credit_limit = 'A whole number of rupees, 0 or more.'; else if (Number(f.credit_limit) > 5000000) e0.credit_limit = 'Above Rs 50 lakh: check the zeros.';
    if (!/^\d+$/.test(f.credit_days) || Number(f.credit_days) > 120) e0.credit_days = 'A whole number, 0 to 120.';
    if (f.why.trim().length < 5) e0.why = 'Say why. The approver reads it.';
    setErr(e0); if (Object.keys(e0).length) throw new Error('Fix the field marked in red.');
    if (Number(f.credit_limit) === r.credit_limit && Number(f.credit_days) === r.credit_days) { toast('info', 'Nothing changed', 'The limit and days are as they were.'); return; }
    try {
      const out = await api.send('PUT', `/commerce/customers/${r.customer_id}/credit`, { credit_limit: f.credit_limit, credit_days: f.credit_days, reason: f.why });
      toast(out.pending ? 'warn' : 'good', out.pending ? 'Waiting for approval' : 'Saved', out.pending ? `Raising credit needs a second person (request #${out.approval_id}).` : `${r.name}: ${Number(f.credit_limit) ? money(Number(f.credit_limit)) : 'cash'}, ${f.credit_days} days.`);
      onSaved(); onClose();
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={`Credit: ${r.name}`} onClose={onClose} thumb={<LIcon name="wallet" />} dirty={JSON.stringify(f) !== JSON.stringify(start)}
      status={<>{r.status === 'active' ? <Pill tone="good">Active</Pill> : <Pill tone={r.status === 'hold' ? 'warn' : 'bad'}>{r.status === 'hold' ? 'On hold' : 'Blocked'}</Pill>}<span className="a-p15-sp" /><small className="a-muted">Owes {money(r.owes)}{r.overdue ? `, ${money(r.overdue)} overdue` : ''}</small></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{edit ? 'Cancel' : 'Close'}</button>{edit && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button>}</>}>
      {r.waiting && <Alert tone="warn" title={`Raise to ${money(r.waiting.limit)} waiting.`}>Request #{r.waiting.approval_id} in Home &gt; Approvals. It cannot be changed again until it is decided.</Alert>}
      {act.note}
      <dl className="a-kv"><dt>Limit now</dt><dd>{r.credit_limit ? money(r.credit_limit) : 'cash'} · {r.credit_days} days</dd><dt>Credit left</dt><dd>{money(r.free)}</dd><dt>Orders today would</dt><dd>{r.would.length ? `wait: ${r.would.join(', ')}` : 'go through'}</dd></dl>
      {edit && <div className="a-grid2">
        <In label="New limit (Rs) *" type="number" min="0" step="1000" value={f.credit_limit} error={err.credit_limit} hint="0 = cash only. Raising it needs a second person; lowering is done at once." onChange={set('credit_limit')} />
        <In label="Days to pay *" type="number" min="0" max="120" step="1" value={f.credit_days} error={err.credit_days} onChange={set('credit_days')} />
        <In label="Why *" wide value={f.why} error={err.why} maxLength={140} placeholder="e.g. Orders doubled since September, pays on time" onChange={set('why')} />
      </div>}
    </Drawer>
  );
}
