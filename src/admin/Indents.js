// Purchase > Indents (phase 16, v23 viewIndents / DRAWERS.indent; API /buying/indents in buying-routes.js). Anyone on
// the floor with Create on Suppliers and buying asks for an item and quantity for their godown; someone else with Edit
// approves or rejects it (with a reason) and turns it into a purchase order. Reorder check makes the indents for what is
// below its reorder level, counting stock, QC hold, open orders and open indents (twice the level less what is there or
// coming, rounded up to the supplier's minimum order). Tabs Open / Approved / Turned into PO / Rejected.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, ViewOnlyB, addDays, at, fe, fieldsOf, today, useOpenParam } from './buyShared';
import { PoEditDrawer } from './PurchaseOrders';

const TONE = { open: 'warn', approved: 'info', po: 'good', rejected: 'gray' };
const TABS = [['open', 'Open'], ['approved', 'Approved'], ['po', 'Turned into PO'], ['rejected', 'Rejected']];

export default function Indents() {
  const [tab, setTab] = useState('open');
  const data = useLoad(`/buying/indents?tab=${tab}`);
  const opts = useLoad('/buying/options');
  const { me } = useAdmin();
  const canCreate = useCan('buying', 'create');
  const act = useAction();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [po, setPo] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const reorder = () => act.run(async () => { const out = await api.send('POST', '/buying/indents/reorder-check'); toast(out.made.length ? 'good' : 'info', out.made.length ? 'Reorder check done' : 'Nothing is low', out.message); setTab('open'); data.reload(); });
  const columns = [
    { key: 'indent_no', label: 'Indent', render: (x) => <><b className="a-mono">{x.indent_no}</b><small className="a-muted a-p15-sub">{at(x.requested_at)}{x.is_auto ? ' · from Reorder check' : ''}</small></> },
    { key: 'items', label: 'Items', render: (x) => <>{x.lines[0].name}{x.lines.length > 1 ? ` +${x.lines.length - 1} more` : ''}<small className="a-muted a-p15-sub">{x.lines.map((l) => l.qty_text).join(', ')}</small></> },
    { key: 'godown', label: 'Godown', hideSm: true },
    { key: 'need_by', label: 'Needed by', render: (x) => <>{x.need_by}{x.late && <> <Pill tone="bad">Late</Pill></>}</> },
    { key: 'by_name', label: 'Asked by', hideSm: true },
    { key: 'status', label: 'Status', render: (x) => <><Pill tone={TONE[x.status]}>{x.status_label}</Pill>{x.po_no && <small className="a-muted a-p15-sub">{x.po_no}</small>}</> },
  ];
  const empty = { open: 'No indent is open. Press Reorder check to find what is low.', approved: 'Nothing approved is waiting for a purchase order.', po: 'No indent became a purchase order yet.', rejected: 'None rejected.' }[tab];
  return (
    <section>
      <PageHead sub={'Staff ask "we need this"; it becomes a purchase order'} rules={['Anyone on the floor can ask', 'A second person approves', 'Reorder check fills it for you']}
        actions={canCreate && <><button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={reorder}><LIcon name="clipboard-list" size="sm" />Reorder check</button>
          <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New indent</button></>} />
      {!canCreate && <ViewOnlyB me={me} what="indents" />}
      {act.note}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Indents" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: d.counts[k] }))} />
            <div className="a-listcard"><Table columns={columns} rows={d.rows} rowKey={(x) => x.indent_id} label="Indents" onRowClick={(x) => setOpen(x.indent_id)} empty={{ icon: 'inbox', title: 'Nothing here', text: empty }} /></div>
          </>
        )}
      </Loading>
      {open === 'new' && opts.data && <NewIndent opts={opts.data} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); setTab('open'); data.reload(); }} />}
      {open && open !== 'new' && <IndentDrawer id={open} onClose={() => setOpen(null)} onChanged={(t) => { if (t) setTab(t); data.reload(); }}
        onMakePo={async () => { const pre = await api.get(`/buying/indents/${open}/po-draft`).catch((e) => { toast('bad', 'Not possible', e.message); return null; }); if (pre) { setOpen(null); setPo(pre); } }} />}
      {po && opts.data && <PoEditDrawer id="new" pre={po} opts={opts.data} onClose={() => setPo(null)} onSaved={(out) => { setPo(null); setTab('po'); data.reload(); if (out && out.po_no) toast(out.waiting ? 'warn' : 'good', out.po_no, out.message); }} />}
    </section>
  );
}

function NewIndent({ opts, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const start = { godown_id: String((opts.godowns[0] || {}).godown_id || ''), need_by: addDays(today(), 7), reason: '', lines: [{ sku_code: '', qty: '' }] };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const setL = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/buying/indents', f); toast('good', `${out.indent_no} sent`, out.message); onSaved(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="New indent" onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} thumb={<LIcon name="clipboard-list" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="send" size="sm" />Send indent</button></>}>
      <Alert tone="info" title="Ask for what the godown needs.">Someone with edit rights on Suppliers and buying approves it and turns it into a purchase order. Only things that are bought show here: raw materials, and packs set as Bought or Both in Products.</Alert>
      {act.note}
      <div className="a-grid2">
        <Field def={{ name: 'godown_id', label: 'Godown', type: 'select', allowEmpty: false, required: true, options: opts.godowns.map((g) => ({ value: String(g.godown_id), label: g.name })) }} value={f.godown_id} onChange={(v) => setF((x) => ({ ...x, godown_id: v }))} />
        <Field def={{ name: 'need_by', label: 'Needed by', type: 'date', required: true, error: err.need_by }} value={f.need_by} onChange={(v) => setF((x) => ({ ...x, need_by: v }))} />
        <Field def={{ name: 'reason', label: 'Why', required: true, wide: true, error: err.reason, help: 'e.g. Cartons for the Deepavali dispatch' }} value={f.reason} onChange={(v) => setF((x) => ({ ...x, reason: String(v).slice(0, 120) }))} />
      </div>
      {f.lines.map((l, i) => (
        <div key={i} className="a-p16-lrow a-p16-qrow">
          <In label="Item" wide error={fe(err, `lines.${i}.sku_code`)}><select value={l.sku_code} onChange={(e) => setL(i, 'sku_code', e.target.value)}><option value="">Choose...</option>
            {opts.items.map((it) => <option key={it.sku_code} value={it.sku_code}>{it.sku_code} · {it.name} ({it.unit})</option>)}</select></In>
          <In label="Quantity" type="number" min="1" step="1" value={l.qty} error={fe(err, `lines.${i}.qty`)} onChange={(e) => setL(i, 'qty', e.target.value)} />
          <button type="button" className="a-iconbtn a-p16-del" aria-label="Remove this row" onClick={() => setF((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [{ sku_code: '', qty: '' }] }))}><LIcon name="trash-2" size="sm" /></button>
        </div>
      ))}
      <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { sku_code: '', qty: '' }] }))}><LIcon name="plus" size="sm" />Add an item</button>
    </Drawer>
  );
}

function IndentDrawer({ id, onClose, onChanged, onMakePo }) {
  const one = useLoad(`/buying/indents/${id}`);
  const act = useAction();
  const toast = useToast();
  const [why, setWhy] = useState('');
  const [whyErr, setWhyErr] = useState(null);
  const d = one.data;
  if (!d) return <Drawer title="Indent" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const x = d.indent;
  const decide = (ok) => act.run(async () => {
    setWhyErr(null);
    try { const out = await api.send('POST', `/buying/indents/${x.indent_id}/${ok ? 'approve' : 'reject'}`, { reason: why }); toast(ok ? 'good' : 'warn', ok ? 'Approved' : 'Rejected', out.message); one.reload(); onChanged(ok ? 'approved' : 'rejected'); }
    catch (e) { const f = fieldsOf(e); if (f.reason) setWhyErr(f.reason); throw e; }
  });
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  return (
    <Drawer title={`Indent ${x.indent_no}`} onClose={onClose} thumb={<LIcon name="clipboard-list" />}
      status={<><Pill tone={TONE[x.status]}>{x.status_label}</Pill>{x.is_auto && <Pill>From Reorder check</Pill>}<span className="a-p15-sp" />
        {x.status === 'open' && d.can.decide && <><button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={() => decide(false)}><LIcon name="x" size="sm" />Reject</button>
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => decide(true)}><LIcon name="check" size="sm" />Approve</button></>}
        {x.status === 'approved' && d.can.edit && <button type="button" className="a-btn a-btn-sm" onClick={onMakePo}><LIcon name="shopping-cart" size="sm" />Make purchase order</button>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      {x.status === 'open' && d.can.mine && <Alert tone="info" title="Waiting for someone else.">You asked for it, so another person approves it.</Alert>}
      {x.status === 'open' && !d.can.mine && !d.can.decide && <Alert tone="info" title="Waiting for approval.">Someone with edit rights on Suppliers and buying approves it.</Alert>}
      <dl className="a-kv">
        <KV k="Godown">{x.godown}</KV><KV k="Needed by">{x.need_by}</KV><KV k="Why">{x.reason}</KV><KV k="Asked by">{x.by_name} on {at(x.requested_at)}</KV>
        {x.decided_by && <KV k={x.status === 'rejected' ? 'Rejected by' : 'Approved by'}>{x.decided_name}{x.reject_reason ? ` · ${x.reject_reason}` : ''}</KV>}
        {x.po_no && <KV k="Purchase order"><a href={`/admin/purchase-orders?open=${x.po_id}`}>{x.po_no}</a></KV>}
      </dl>
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Asked</th><th className="a-num">In stock</th><th className="a-num">Reorder level</th></tr></thead>
        <tbody>{x.lines.map((l) => <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} /></td><td className="a-num"><b>{l.qty_text}</b></td><td className="a-num">{l.in_stock}</td><td className="a-num">{l.reorder}</td></tr>)}</tbody></table></div>
      {x.status === 'open' && d.can.decide && <In label="Reason, if you reject" wide value={why} maxLength={120} error={whyErr} onChange={(e) => setWhy(e.target.value)} />}
    </Drawer>
  );
}
