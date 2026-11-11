// Sales > Returns (phase 22, v23 viewReturnReqs / viewInspection, DRAWERS.retNew / retInsp; API /sales/returns*,
// returns-routes.js; the steps keep /commerce/returns/* in returns.js).
// Return requests: tabs Waiting for approval (outside the return window), To collect, To inspect, Decision waiting,
// Closed; New return = a delivered order, then its lines (what earlier returns took is already off: v23 X9). A row
// opens the return drawer (collect, receive, inspect, decide) shared with the old Returns page.
// Inspection: the packs on the Returned shelf, the returns to inspect (oldest first) and those whose money decision
// waits; per pack resell (back to Good once signed), repack, damaged or scrap (write-off under its rule).
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, fmtDate, useLoad } from './ui';
import { ItemCell } from './buyShared';
import { NewReturn, ReturnDrawer } from './CommerceReturns';

const TONE = { requested: 'warn', collecting: 'info', received: 'info', inspected: 'gold', refunded: 'good', replaced: 'good', closed: 'gray', rejected: 'bad' };

const TAB_KEYS = ['waiting', 'to_collect', 'to_inspect', 'deciding', 'closed'];

function returnCols() {
  return [
    { key: 'return_no', label: 'Return', sort: true, render: (r) => <><b className="a-mono">{r.return_no}</b><small className="a-muted a-p15-sub">{fmtDate(r.created_at)} · {r.godown}</small></> },
    { key: 'customer', label: 'Customer', sort: true, render: (r) => <><b>{r.customer}</b><small className="a-muted a-p15-sub">{r.customer_no} · {r.order_no}</small></> },
    { key: 'items', label: 'Packs', hideSm: true, render: (r) => <ItemCell name={r.first_name} code={r.first_sku} image={r.first_image} sub={`${r.packs} pack${r.packs === 1 ? '' : 's'}${r.items && r.items.includes(',') ? `: ${r.items}` : ''}`} /> },
    { key: 'reason', label: 'Why', hideSm: true, render: (r) => <>{r.reason}{r.outside_window && <small className="a-p15-sub"><Pill tone="warn">Outside the window</Pill></small>}</> },
    { key: 'collection_label', label: 'Comes back', hideSm: true },
    { key: 'status', label: 'Status', render: (r) => <><Pill tone={TONE[r.status]}>{r.status_label}</Pill>{r.waiting.length > 0 && <small className="a-muted a-p15-sub">waits: {r.waiting.join(', ')}</small>}</> },
  ];
}

// ---------------------------------------------------------------------------------------------------- Return requests
export function ReturnRequests() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = new URLSearchParams(location.search).get('tab');
  const tab = TAB_KEYS.includes(t) ? t : 'to_collect';
  const data = useLoad(`/sales/returns?tab=${tab}`);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const d = data.data;
  return (
    <section>
      <PageHead sub="Customers who send goods back"
        rules={['Against a delivered order', `Return window ${d ? d.window_days : ''} days (Commerce settings)`, 'Credit note after inspection, for what came back']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setAdding(true)}><LIcon name="plus" size="sm" />New return</button>} />
      <Loading state={data}>{d && <>
        <Tabs label="Returns" value={tab} onChange={(k) => navigate(`${location.pathname}?tab=${k}`)} tabs={TAB_KEYS.map((k) => ({ key: k, label: d.tabs[k], count: d.counts[k] }))} />
        <div className="a-listcard">
          <Table columns={returnCols()} rows={d.rows} rowKey={(r) => r.return_no} label="Returns" onRowClick={(r) => setOpen(r.return_no)}
            empty={{ icon: 'undo-2', title: 'Nothing here', text: 'No return in this list.' }} />
        </div>
      </>}</Loading>
      {open && <ReturnDrawer no={open} onClose={() => { setOpen(null); data.reload(); }} />}
      {adding && <NewReturnDrawer onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); data.reload(); setOpen(r.return_no); }} />}
    </section>
  );
}

/** v23 DRAWERS.retNew: choose the delivered order, then its lines (NewReturn, as in the order drawer) */
function NewReturnDrawer({ onClose, onDone }) {
  const orders = useLoad('/sales/returns/orders');
  const [no, setNo] = useState('');
  return (
    <Drawer title="New return" onClose={onClose} wide dirty={Boolean(no)}>
      <Loading state={orders}>{orders.data && <>
        <label className="a-field"><span>Delivered order</span>
          <select value={no} aria-label="Delivered order" onChange={(e) => setNo(e.target.value)}><option value="">Choose...</option>
            {orders.data.map((o) => <option key={o.order_no} value={o.order_no}>{o.order_no} · {o.customer} · delivered {o.delivered_on} ({o.days} day{o.days === 1 ? '' : 's'} ago)</option>)}</select></label>
        {!orders.data.length && <p className="a-hint-s">No delivered order yet.</p>}
        <p className="a-hint-s">Only what was delivered and not already taken by an earlier return can come back.</p>
        {no && <NewReturn key={no} orderNo={no} onDone={onDone} onCancel={() => setNo('')} />}
      </>}</Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------- Inspection
export function Inspection() {
  const data = useLoad('/sales/returns/inspection');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const shelfCols = [
    { key: 'item', label: 'Item', render: (s) => <ItemCell name={s.name} code={s.sku_code} image={s.image} sub={s.size_label} /> },
    { key: 'godown', label: 'Godown', sort: true },
    { key: 'packs', label: 'On the Returned shelf', num: true, sort: true, render: (s) => <b>{s.packs}</b> },
  ];
  const list = d ? [...d.to_inspect].reverse() : []; // oldest first
  return (
    <section>
      <PageHead sub="Returned goods waiting to be checked" rules={['Each pack: resell, repack, damaged or scrap', 'Resell and scrap follow the stock rules', 'Then the money: credit, replace or no refund']} />
      <Loading state={data}>{d && <>
        <Alert tone="info" title={`${d.on_shelf} pack${d.on_shelf === 1 ? '' : 's'} on the Returned shelf.`}>They cannot be sold until inspected and signed back to Good.</Alert>
        {d.resell_waiting.length > 0 && <Alert tone="warn" title="Back to Good waits for approval.">{d.resell_waiting.map((w) => `#${w.approval_id} ${w.summary}`).join('; ')}</Alert>}
        <div className="a-listcard">
          <Table columns={returnCols()} rows={list} rowKey={(r) => r.return_no} label="To inspect" onRowClick={(r) => setOpen(r.return_no)}
            empty={{ icon: 'package', title: 'Nothing to inspect', text: 'Returns that have come back show here, oldest first.' }} />
        </div>
        {d.deciding.length > 0 && <>
          <h3 className="a-h3s">Inspected: the money decision waits</h3>
          <div className="a-listcard"><Table columns={returnCols()} rows={d.deciding} rowKey={(r) => r.return_no} label="Decision waiting" onRowClick={(r) => setOpen(r.return_no)} /></div>
        </>}
        <h3 className="a-h3s">Returned shelf</h3>
        <div className="a-listcard">
          <Table columns={shelfCols} rows={d.shelf} rowKey={(s) => `${s.sku_code}|${s.location_id}`} label="Returned shelf"
            empty={{ icon: 'package', title: 'The Returned shelf is empty', text: 'Packs that came back wait here until inspected.' }} />
        </div>
      </>}</Loading>
      {open && <ReturnDrawer no={open} onClose={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}
