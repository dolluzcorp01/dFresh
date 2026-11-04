// Masters > Prices > Special prices (phase 15, v23 viewSpecials; API /prices/specials in prices.js): one customer's
// own agreed price for a pack, without GST, dated. Tabs Active / Waiting for approval / Ended and rejected. The
// customer pays the lower of this and their normal price. More than the allowed % below their list price (Approval
// rules), raised by someone without Approve on Prices (Sales), or below cost plus the margin floor: it waits for an
// Admin or Sub-admin on Home > Approvals (nobody approves their own). Only packs on sale can be chosen (the server
// checks it too). An active one can be ended today (Cancel right).
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { ViewOnly, rs } from './Prices';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useConfirm, useLoad, useToast } from './ui';

const STATUS = { active: ['good', 'Active'], pending: ['warn', 'Waiting for approval'], ended: ['gray', 'Ended'], rejected: ['bad', 'Rejected'] };

export default function SpecialPrices() {
  const data = useLoad('/prices/specials');
  const { me } = useAdmin();
  const canCreate = useCan('prices', 'create');
  const canEdit = useCan('prices', 'edit');
  const [tab, setTab] = useState('active');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const inTab = (r) => (tab === 'active' ? r.status === 'active' : tab === 'pending' ? r.status === 'pending' : ['ended', 'rejected'].includes(r.status));
  const rows = d ? d.rows.filter(inTab) : [];
  const count = (t) => (d ? d.rows.filter((r) => (t === 'active' ? r.status === 'active' : t === 'pending' ? r.status === 'pending' : ['ended', 'rejected'].includes(r.status))).length : 0);
  const columns = [
    { key: 'customer', label: 'Customer', render: (r) => <><b>{r.customer}</b><small className="a-muted a-p15-sub">{r.customer_no} · {r.type_key}</small></> },
    { key: 'sku_code', label: 'Pack', render: (r) => <b>{r.sku_code}</b> },
    { key: 'price', label: 'Special price', num: true, render: (r) => <>{rs(r.price)}<small className="a-muted a-p15-sub">without GST</small></> },
    { key: 'list_price', label: 'Their list price', num: true, render: (r) => (r.list_price === null ? '-' : <>{rs(r.list_price)}<small className="a-muted a-p15-sub">{r.below_pct}% below</small></>) },
    { key: 'dates', label: 'Dates', render: (r) => `${r.valid_from} to ${r.valid_to || 'no end'}` },
    { key: 'status', label: 'Status', render: (r) => <Pill tone={STATUS[r.status][0]}>{r.shown || STATUS[r.status][1]}</Pill> },
  ];
  const empty = { active: 'No special price is running.', pending: 'Nothing is waiting for approval.', done: 'None has ended or been rejected.' }[tab];
  return (
    <section>
      <PageHead sub="One customer's own agreed price" actions={canCreate && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New special price</button>} />
      {!canEdit && !canCreate && <ViewOnly me={me} />}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Special prices" value={tab} onChange={setTab} tabs={[{ key: 'active', label: 'Active', count: count('active') }, { key: 'pending', label: 'Waiting for approval', count: count('pending') }, { key: 'done', label: 'Ended and rejected', count: count('done') }]} />
            <div className="a-listcard">
              <Table columns={columns} rows={rows} rowKey={(r) => r.sp_no} label="Special prices" onRowClick={(r) => setOpen(r)} empty={{ icon: 'inbox', title: empty }} />
            </div>
            {open === 'new' && <NewSpecial d={d} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
            {open && open !== 'new' && <ViewSpecial r={open} d={d} onClose={() => setOpen(null)} onDone={() => { setOpen(null); data.reload(); }} />}
          </>
        )}
      </Loading>
    </section>
  );
}

function NewSpecial({ d, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [f, setF] = useState({ customer_id: '', sku_code: '', price: '', valid_from: today, valid_to: '', reason: '' });
  const [err, setErr] = useState({});
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (!f.customer_id || !f.sku_code) { setNow(null); return; }
    api.get(`/prices/specials/now?customer=${f.customer_id}&sku=${encodeURIComponent(f.sku_code)}`).then(setNow, () => setNow(null));
  }, [f.customer_id, f.sku_code]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = Object.entries(f).some(([k, v]) => (k === 'valid_from' ? v !== today : v !== ''));
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('POST', '/prices/specials', f);
      toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Sent for approval' : 'Special price active', out.message);
      onSaved();
    } catch (e) { if (e.data && e.data.fields) setErr(e.data.fields); throw e; }
  });
  const cust = d.customers.find((c) => String(c.customer_id) === String(f.customer_id));
  const limit = d.limit === null ? null : now && now.list_price !== null ? rs(now.list_price * (1 - d.limit / 100)) : null;
  return (
    <Drawer title="New special price" onClose={onClose} dirty={dirty}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button></>}>
      <Alert tone="info" title="An agreed price for one customer.">The customer pays the lower of this and their normal price. {d.limit !== null ? `More than ${d.limit}% below their list price, or` : 'If'} raised by Sales, it waits for an Admin or Sub-admin to approve; nobody approves their own.</Alert>
      {act.note}
      <div className="a-grid2">
        <Field def={{ name: 'customer_id', label: 'Customer', type: 'select', required: true, wide: true, error: err.customer_id, options: d.customers.map((c) => ({ value: String(c.customer_id), label: `${c.name} (${c.customer_no})` })) }} value={f.customer_id} onChange={set('customer_id')} />
        <Field def={{ name: 'sku_code', label: 'Pack', type: 'select', required: true, wide: true, error: err.sku_code, help: 'Only packs on sale are listed.', options: d.skus.map((s) => ({ value: s.sku_code, label: `${s.sku_code} · ${s.name}` })) }} value={f.sku_code} onChange={set('sku_code')} />
      </div>
      {now && cust && (
        <p className="a-p15-info">{cust.name} pays now {rs(now.list_price)} without GST on {now.list}{now.min_price !== null ? ` · lowest allowed ${rs(now.min_price)}` : ''}{limit ? ` · more than ${d.limit}% below (${limit}) needs approval` : ''}</p>
      )}
      <div className="a-grid2">
        <Field def={{ name: 'price', label: 'Special price per pack (without GST)', type: 'number', min: 0, step: '0.01', required: true, wide: true, error: err.price }} value={f.price} onChange={set('price')} />
        <Field def={{ name: 'valid_from', label: 'Starts on', type: 'date', error: err.valid_from }} value={f.valid_from} onChange={set('valid_from')} />
        <Field def={{ name: 'valid_to', label: 'Ends on', type: 'date', error: err.valid_to, help: 'Leave empty for no end date.' }} value={f.valid_to} onChange={set('valid_to')} />
        <Field def={{ name: 'reason', label: 'Reason', type: 'textarea', required: true, wide: true, error: err.reason, help: 'e.g. yearly contract, 40 cartons a month' }} value={f.reason} onChange={(v) => set('reason')(String(v).slice(0, 200))} />
      </div>
    </Drawer>
  );
}

function ViewSpecial({ r, d, onClose, onDone }) {
  const confirm = useConfirm();
  const toast = useToast();
  const act = useAction();
  const end = async () => {
    if (!(await confirm({ title: `End ${r.sp_no} today?`, message: 'From tomorrow the customer pays their normal price. Quotes and orders already made keep this price.', action: 'End it', danger: true }))) return;
    act.run(async () => { const out = await api.send('POST', `/prices/specials/${encodeURIComponent(r.sp_no)}/end`); toast('good', 'Ended', out.message); onDone(); });
  };
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  return (
    <Drawer title={r.sp_no} sub={r.customer} pill={<Pill tone={STATUS[r.status][0]}>{r.shown || STATUS[r.status][1]}</Pill>} onClose={onClose}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        {r.status === 'active' && d.can.cancel && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={end}>End it today</button>}</>}>
      {act.note}
      {r.status === 'pending' && (r.raised_by === d.me
        ? <Alert tone="warn" title="Waiting for someone else.">You raised it, so another Admin or Sub-admin must approve it.</Alert>
        : <Alert tone="warn" title="Waiting for approval.">{d.can.approve ? 'Approve or reject it in Home > Approvals.' : 'An Admin or Sub-admin approves it.'}</Alert>)}
      <dl className="a-kv">
        <KV k="Customer">{r.customer} ({r.customer_no})</KV>
        <KV k="Pack">{r.sku_code}</KV>
        <KV k="Special price">{rs(r.price)} without GST</KV>
        <KV k="Their list price">{r.list_price === null ? '-' : `${rs(r.list_price)} on ${r.list} (${r.below_pct}% below)`}</KV>
        <KV k="Dates">{r.valid_from} to {r.valid_to || 'no end'}</KV>
        <KV k="Reason">{r.reason}</KV>
        <KV k="Raised by">{r.raised_by}</KV>
        {r.decided_by && <KV k={r.status === 'rejected' ? 'Rejected by' : 'Approved by'}>{r.decided_by}</KV>}
        {r.ended_by && <KV k="Ended by">{r.ended_by}</KV>}
      </dl>
    </Drawer>
  );
}
