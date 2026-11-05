// Sales > Orders > Standing orders (phase 19, v23 viewStanding / DRAWERS.sto; API /sales/standing in sales-routes.js).
// A customer's repeat order: every week or every 2 weeks on a weekday, or every month on a date, from a start to an end
// (or none). Each cycle makes an order with today's prices and stock: a draft that Sales check and confirm, or confirmed
// at once (switch "Standing orders are made confirmed", the same checks as any order). Due ones are flagged; "Make
// today's orders" makes them now (the server also makes them by itself). Every line shows the pack photo.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, useAction, useLoad, useToast } from './ui';
import { In, fieldsOf, today, useOpenParam } from './buyShared';
import { LinesEditor, WhoSelect, itemsOf, rowsOf, useSalesOptions } from './salesShared';

const EVERY = [['week', 'Every week'], ['2week', 'Every 2 weeks'], ['month', 'Every month']];

export default function StandingOrders() {
  const data = useLoad('/sales/standing');
  const opts = useSalesOptions();
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(String(id)));
  const due = d ? d.rows.filter((r) => r.due) : [];
  const run = () => act.run(async () => {
    const out = await api.send('POST', '/sales/standing/run');
    const st = opts.data && opts.data.switches.standing_confirm ? 'confirmed' : 'draft';
    toast(out.made.length ? 'good' : 'info', `${out.made.length} ${st} order${out.made.length === 1 ? '' : 's'} made`, `${out.made.map((m) => m.order_no).join(', ') || 'Nothing due.'}${out.skipped.length ? ` Not made: ${out.skipped.join('; ')}.` : ''}${out.made.length && st === 'draft' ? ' Check each in Orders > Draft and confirm it.' : ''}`);
    data.reload();
    if (out.made.length === 1) nav(`/admin/commerce/orders?open=${encodeURIComponent(out.made[0].order_no)}`);
  });
  const cols = [
    { key: 'sto', label: 'Standing order', render: (r) => <><b className="a-mono">{r.sto_no}</b><small className="a-muted a-p15-sub">{r.godown}{r.made ? ` · ${r.made} made` : ''}</small></> },
    { key: 'customer', label: 'Customer', render: (r) => <><b>{r.customer}</b><small className="a-muted a-p15-sub">{r.customer_no}</small></> },
    { key: 'items', label: 'Items', hideSm: true, render: (r) => `${r.lines.map((l) => `${l.sku_code || l.kit_key} ${l.qty}`).join(', ')}` },
    { key: 'when', label: 'When', render: (r) => <>{r.when}<small className="a-muted a-p15-sub">{r.starts_on}{r.ends_on ? ` to ${r.ends_on}` : ', no end'}</small></> },
    { key: 'next', label: 'Next', render: (r) => <span className="a-p18-nowrap">{r.next_on} {r.due && <Pill tone="warn">Due</Pill>}</span> },
    { key: 'status', label: 'State', render: (r) => (r.status === 'active' ? <Pill tone="good">Active</Pill> : <Pill>Paused</Pill>) },
  ];
  return (
    <section>
      <PageHead sub="Repeat orders on a schedule" rules={[opts.data && opts.data.switches.standing_confirm ? 'Each cycle makes a confirmed order' : 'Each cycle makes a draft order', 'Sales check it and confirm', "Today's prices and stock"]}
        actions={d && <>{d.can.create && due.length > 0 && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={run}><LIcon name="repeat" size="sm" />Make today's orders ({due.length})</button>}
          {d.can.create && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New standing order</button>}</>} />
      {act.note}
      {due.length > 0 && <Alert tone="warn" title={`${due.length} standing order${due.length === 1 ? ' is' : 's are'} due.`}>{due.map((r) => `${r.sto_no} ${r.customer}`).join(', ')}. Make today's orders puts them in Orders.</Alert>}
      <Loading state={data}>
        {d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.standing_id} label="Standing orders" onRowClick={(r) => setOpen(String(r.standing_id))} empty={{ icon: 'repeat', title: 'No standing order', text: 'New standing order sets one up.' }} /></div>}
      </Loading>
      {open && opts.data && <StoDrawer o={opts.data} id={open === 'new' ? null : open} canEdit={d && (open === 'new' ? d.can.create : d.can.edit)} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}

function StoDrawer({ o, id, canEdit, onClose, onSaved }) {
  const one = useLoad(id ? `/sales/standing/${id}` : null);
  if (id && !one.data) return <Drawer title="Standing order" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return <StoForm o={o} s={one.data} canEdit={canEdit} onClose={onClose} onSaved={onSaved} />;
}
function StoForm({ o, s, canEdit, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const start = { who: s ? `C:${s.customer_id}` : '', godown_id: String(s ? s.godown_id : (o.godowns[0] || {}).godown_id || ''), every: s ? s.every : 'week', run_day: String(s ? s.run_day : 1),
    starts_on: s ? s.starts_on : today(), ends_on: s ? s.ends_on || '' : '', status: s ? s.status : 'active' };
  const [f, setF] = useState(start);
  const [rows, setRows] = useState(() => rowsOf(s ? s.lines.map((l) => ({ ...l, price: 0, list_price: 0 })) : []));
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target ? e.target.value : e }));
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send(s ? 'PUT' : 'POST', s ? `/sales/standing/${s.standing_id}` : '/sales/standing', { customer_id: f.who.slice(2), godown_id: f.godown_id, every: f.every, run_day: f.run_day, starts_on: f.starts_on, ends_on: f.ends_on, status: f.status,
        items: itemsOf(rows).map((x) => ({ sku_code: x.sku_code, kit_key: x.kit_key, qty: x.qty })) });
      toast('good', 'Saved', `${out.sto_no}: ${out.when}. Next order on ${out.next_on}.`); onSaved();
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={s ? `Standing order ${s.sto_no}` : 'New standing order'} onClose={onClose} wide thumb={<LIcon name="repeat" />} dirty={JSON.stringify(f) !== JSON.stringify(start)}
      status={s && <>{s.status === 'active' ? <Pill tone="good">Active</Pill> : <Pill>Paused</Pill>}<span className="a-p15-sp" /><small className="a-muted">Next {s.next_on}</small></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button>}</>}>
      {act.note}
      {s && s.made.length > 0 && <p className="a-hint-s">Orders made: {s.made.map((m) => m.order_no).join(', ')}</p>}
      <div className="a-grid2">
        <WhoSelect o={o} value={f.who} onChange={set('who')} leads={false} error={err.customer_id} />
        <In label="Ships from *" error={err.godown_id}><select value={f.godown_id} onChange={set('godown_id')}>{o.godowns.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="How often *" error={err.every}><select value={f.every} onChange={set('every')}>{EVERY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></In>
        <In label="On *" type="number" min="1" max={f.every === 'month' ? 28 : 7} step="1" value={f.run_day} error={err.run_day} hint="Week: 1 Monday to 7 Sunday. Month: the date, 1 to 28." onChange={set('run_day')} />
        <In label="Starts *" type="date" value={f.starts_on} error={err.starts_on} onChange={set('starts_on')} />
        <In label="Ends" type="date" value={f.ends_on} error={err.ends_on} hint="Empty = no end." onChange={set('ends_on')} />
        {s && <In label="State *"><select value={f.status} onChange={set('status')}><option value="active">Active</option><option value="paused">Paused</option></select></In>}
      </div>
      <LinesEditor o={o} rows={rows} setRows={setRows} preview={null} errors={err} noPrice />
    </Drawer>
  );
}
