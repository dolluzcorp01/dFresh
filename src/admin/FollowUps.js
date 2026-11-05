// Sales > Leads > Follow-ups (phase 19, v23 viewFollowups / DRAWERS.call; API /sales/follow-ups and /sales/calls in
// sales-routes.js). Calls on enquiries and on customers: Today and overdue first, Coming up, Samples (to send, sent,
// ordered or not), Call log. Log a call: who (an open enquiry or a customer), how, what was said, the next call (empty only
// when nothing more is needed), a sample to send. The first call on an enquiry is its first reply (it clears the 24-hour
// flag) and makes a new one Contacted. A role with "Own customers only" sees its own and new enquiries nobody has.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useLoad, useToast } from './ui';
import { In, ItemCell, addDays, at, fieldsOf, today } from './buyShared';
import { useSalesOptions } from './salesShared';

const SMP = { to_send: ['To send', 'warn'], sent: ['Sent, waiting for feedback', 'info'], ordered: ['Ordered', 'good'], no: ['No order', 'gray'] };

export default function FollowUps() {
  const data = useLoad('/sales/follow-ups');
  const [tab, setTab] = useState('due');
  const [call, setCall] = useState(null);
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const d = data.data;
  const openWho = (r) => (r.lead_id && !r.customer_id ? nav(`/admin/leads?open=${r.lead_id}`) : r.customer_id ? nav(`/admin/commerce/customers?open=${r.customer_id}`) : null);
  const step = (s, to) => act.run(async () => { await api.send('POST', `/sales/samples/${s.sample_id}/${to}`); toast('good', to === 'sent' ? 'Marked sent' : 'Saved', to === 'sent' ? 'Ask for feedback in a few days.' : `${s.sample_no}: ${to === 'ordered' ? 'ordered' : 'no order'}.`); data.reload(); });
  const dueCols = [
    { key: 'name', label: 'Who', render: (r) => <><b>{r.name}</b><small className="a-muted a-p15-sub">{r.ref}{r.lead_id && !r.customer_id ? ' · enquiry' : ''}</small></> },
    { key: 'due_on', label: 'Next call', render: (r) => <span className="a-p18-nowrap">{r.due_on} {r.due_on < d.today ? <Pill tone="bad">Overdue</Pill> : r.due_on === d.today ? <Pill tone="warn">Today</Pill> : null}</span> },
    { key: 'assignee_name', label: 'Given to', hideSm: true },
    { key: 'last_said', label: 'Last said', render: (r) => r.last_said || <span className="a-muted">-</span> },
  ];
  const smpCols = [
    { key: 'sample_no', label: 'Sample', render: (r) => <b className="a-mono">{r.sample_no}</b> },
    { key: 'name', label: 'For', render: (r) => <><b>{r.name}</b><small className="a-muted a-p15-sub">{r.ref}</small></> },
    { key: 'sku', label: 'Pack', render: (r) => <ItemCell name={r.sku_name} code={r.sku_code} image={r.image} /> },
    { key: 'sent_on', label: 'Sent', render: (r) => r.sent_on || '-' },
    { key: 'status', label: 'Status', render: (r) => <><Pill tone={SMP[r.status][1]}>{SMP[r.status][0]}</Pill>{r.feedback && <small className="a-muted a-p15-sub">{r.feedback}</small>}</> },
    { key: 'act', label: '', render: (r) => (d.can.edit ? <span className="a-p17-pills">{r.status === 'to_send' && <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={() => step(r, 'sent')}>Mark sent</button>}
      {r.status === 'sent' && <><button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={() => step(r, 'ordered')}>Ordered</button><button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={() => step(r, 'no')}>No order</button></>}</span> : null) },
  ];
  const logCols = [
    { key: 'happened_at', label: 'When', render: (r) => <span className="a-p18-nowrap">{at(r.happened_at)}</span> },
    { key: 'name', label: 'Who' }, { key: 'note', label: 'What was said' }, { key: 'by_name', label: 'By', hideSm: true },
  ];
  const openSamples = d ? d.samples.filter((s) => ['to_send', 'sent'].includes(s.status)).length : 0;
  return (
    <section>
      <PageHead sub="Calls on enquiries and customers, and samples" rules={['Today and overdue first', 'Every call logged with what was said', 'Samples tracked until they order']}
        actions={d && d.can.edit && <button type="button" className="a-btn" onClick={() => setCall({})}><LIcon name="phone" size="sm" />Log a call</button>} />
      {d && d.own && <Alert tone="info" title="Your own.">You see the enquiries and customers given to you, and new enquiries nobody has picked up yet.</Alert>}
      {act.note}
      <Loading state={data}>
        {d && <>
          <Tabs label="Follow-ups" value={tab} onChange={setTab} tabs={[{ key: 'due', label: 'Today and overdue', count: d.due.length }, { key: 'later', label: 'Coming up', count: d.later.length }, { key: 'samples', label: 'Samples', count: openSamples }, { key: 'log', label: 'Call log' }]} />
          <div className="a-listcard">
            {tab === 'due' && <Table columns={dueCols} rows={d.due} rowKey={(r) => r.follow_up_id} label="Due" onRowClick={openWho} empty={{ icon: 'check', title: 'Nothing here', text: 'No call is due today.' }} />}
            {tab === 'later' && <Table columns={dueCols} rows={d.later} rowKey={(r) => r.follow_up_id} label="Coming up" onRowClick={openWho} empty={{ icon: 'calendar', title: 'Nothing here', text: 'Nothing planned.' }} />}
            {tab === 'samples' && <Table columns={smpCols} rows={d.samples} rowKey={(r) => r.sample_id} label="Samples" empty={{ icon: 'package', title: 'No sample', text: 'A sample is added when a call is logged.' }} />}
            {tab === 'log' && <Table columns={logCols} rows={d.calls} rowKey={(r) => r.activity_id} label="Call log" onRowClick={openWho} empty={{ icon: 'phone', title: 'No call yet', text: 'Calls show here once logged.' }} />}
          </div>
        </>}
      </Loading>
      {call && <CallDrawer pre={call} onClose={() => setCall(null)} onSaved={() => { setCall(null); data.reload(); }} />}
    </section>
  );
}

/** Log a call on an enquiry or a customer (pre = { lead_id } | { customer_id }) */
export function CallDrawer({ pre = {}, onClose, onSaved }) {
  const opts = useSalesOptions();
  const act = useAction();
  const toast = useToast();
  const start = { who: pre.lead_id ? `L:${pre.lead_id}` : pre.customer_id ? `C:${pre.customer_id}` : '', how: 'call', next_on: addDays(today(), 3), note: '', sample_sku: '' };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const o = opts.data;
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('POST', '/sales/calls', { ...(f.who.startsWith('L:') ? { lead_id: f.who.slice(2) } : { customer_id: f.who.slice(2) }), how: f.how, note: f.note, next_on: f.next_on, sample_sku: f.sample_sku || null });
      toast('good', 'Saved', `${out.how} logged.${out.sample ? ` Sample ${out.sample} is on the list to send.` : ''}${out.next_on ? ` Next call on ${out.next_on}.` : ''}`); onSaved(out);
    } catch (e) { const x = fieldsOf(e); setErr({ ...x, who: x.who || x.lead_id || x.customer_id }); throw e; }
  });
  return (
    <Drawer title="Log a call" onClose={onClose} thumb={<LIcon name="phone" />} dirty={JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy || !o} onClick={save}><LIcon name="check" size="sm" />Save</button></>}>
      <Loading state={opts}>{o && <>
        {act.note}
        <div className="a-grid2">
          <In label="Who *" error={err.who} wide><select value={f.who} onChange={set('who')}><option value="">Choose...</option>
            <optgroup label="Enquiries">{o.leads.map((l) => <option key={l.lead_id} value={`L:${l.lead_id}`}>{l.lead_ref} · {l.name}</option>)}</optgroup>
            <optgroup label="Customers">{o.customers.map((c) => <option key={c.customer_id} value={`C:${c.customer_id}`}>{c.customer_no} · {c.name}</option>)}</optgroup></select></In>
          <In label="How *" error={err.how}><select value={f.how} onChange={set('how')}>{Object.entries(o.call_how).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></In>
          <In label="Next call" type="date" min={today()} value={f.next_on} error={err.next_on} hint="Leave empty only when nothing more is needed." onChange={set('next_on')} />
          <In label="What was said *" wide error={err.note}><textarea rows={3} maxLength={300} value={f.note} onChange={set('note')} /></In>
          <In label="Sample to send (optional)" wide error={err.sample_sku}><select value={f.sample_sku} onChange={set('sample_sku')}><option value="">No sample</option>{o.packs.map((p) => <option key={p.sku_code} value={p.sku_code}>{p.sku_code} · {p.name}</option>)}</select></In>
        </div>
      </>}</Loading>
    </Drawer>
  );
}
