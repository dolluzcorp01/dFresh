// Inventory > Write-offs (phase 18, v23 viewWriteoffs / DRAWERS.woNew / DRAWERS.wo; API /inventory/write-offs and
// /inventory/moves in inventory-routes.js). Write off (stock leaves for good, a reason that decides what happens next;
// above the rule's value, or packs in a day, it waits for approval) and Move between shelves (not a loss; Damaged or
// Returned back to Good waits for a second person). "Damaged and returned, waiting for a decision" lists what sits on
// those shelves. Then every write-off and move with its status; a row opens it.
import { useState } from 'react';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, useAdmin, useCan, useLoad } from './ui';
import { ItemCell, ViewOnlyB, at, bm, useOpenParam } from './buyShared';
import { WoDrawer } from './invShared';
import { mediaUrl } from '../utils/api';

const TONE = { pending: 'warn', posted: 'good', rejected: 'gray' };

export default function InvWriteOffs() {
  const data = useLoad('/inventory/write-offs');
  const { me } = useAdmin();
  const canCreate = useCan('inventory', 'create');
  const [neu, setNeu] = useState(null);
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const cols = [
    { key: 'ref', label: 'Record', render: (w) => <><b className="a-mono">{w.ref}</b><small className="a-muted a-p15-sub">{w.godown} · {at(w.at)}</small></> },
    { key: 'item', label: 'Item', render: (w) => <ItemCell name={w.name} code={w.sku_code} image={w.image} /> },
    { key: 'qty', label: 'Qty', num: true },
    { key: 'from', label: 'From', render: (w) => `${w.from}${w.to ? ` to ${w.to}` : ''}` },
    { key: 'reason', label: 'Reason', hideSm: true },
    { key: 'value', label: 'Value', num: true, hideSm: true, render: (w) => bm(w.value) },
    { key: 'status', label: 'Status', render: (w) => <Pill tone={TONE[w.status]}>{w.status_label}</Pill> },
  ];
  const wcols = [
    { key: 'item', label: 'Item', render: (r) => <ItemCell name={r.name} code={r.sku_code} image={r.image} /> },
    { key: 'godown', label: 'Godown' },
    { key: 'shelf', label: 'Shelf' },
    { key: 'qty', label: 'Qty', num: true, render: (r) => <b>{r.qty}</b> },
  ];
  const rule = d && d.rule.on ? `Above Rs ${d.rule.above.toLocaleString('en-IN')}${d.rule.packs !== null ? ` or ${d.rule.packs} packs` : ''} needs approval` : 'Write-offs need no approval (rule off)';
  return (
    <section>
      <PageHead sub="Stock that leaves, and moves between shelves" rules={['A shelf move is not a loss', 'The reason decides what happens next', rule]}
        actions={canCreate && <><button type="button" className="a-btn a-btn-ghost" onClick={() => setNeu('move')}><LIcon name="arrow-up-down" size="sm" />Move between shelves</button>
          <button type="button" className="a-btn" onClick={() => setNeu('wo')}><LIcon name="plus" size="sm" />Write off</button></>} />
      {!canCreate && <ViewOnlyB me={me} what="write-offs" />}
      <Loading state={data}>
        {d && (
          <>
            <div className="a-card a-p16-qcard">
              <div className="a-p15-cardhead"><h2 className="a-p16-h2">Damaged and returned, waiting for a decision</h2><Pill>{d.waiting.length}</Pill></div>
              <Table columns={wcols} rows={d.waiting} rowKey={(r) => `${r.sku_code}-${r.godown}-${r.shelf}`} label="Damaged and returned" empty={{ icon: 'check', title: 'Nothing waiting', text: 'Nothing on the damaged or returned shelves.' }} />
            </div>
            <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(w) => w.id} label="Write-offs and shelf moves" onRowClick={(w) => setOpen(w.id)}
              empty={{ icon: 'inbox', title: 'No write-off yet', text: 'Damaged or lost stock is written off here, with a reason.' }} /></div>
          </>
        )}
      </Loading>
      {neu && <WoDrawer mode={neu} onClose={() => setNeu(null)} onSaved={() => { setNeu(null); data.reload(); }} />}
      {open && <WoView id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function WoView({ id, onClose }) {
  const one = useLoad(`/inventory/write-offs/${id}`);
  const w = one.data;
  if (!w) return <Drawer title="Write-off" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  return (
    <Drawer title={w.ref} onClose={onClose} thumb={w.image ? mediaUrl(`/media/products/400/${w.image}`) : <LIcon name="trash-2" />}
      status={<><Pill tone={TONE[w.status]}>{w.status_label}</Pill><span className="a-p15-sp" /></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {w.status === 'pending' && <Alert tone="warn" title="Waiting for approval.">{w.wait_line} The stock stays on the shelf until then.</Alert>}
      <dl className="a-kv">
        <KV k="Item">{w.sku_code} · {w.name}</KV><KV k="Godown">{w.godown}</KV>
        <KV k="How many">{w.qty} from {w.from}{w.to ? ` to ${w.to}` : ''}{w.batch_no ? ` (batch ${w.batch_no})` : ''}</KV>
        <KV k="Reason">{w.reason}{w.next && <small className="a-muted a-p15-sub">{w.next}</small>}</KV>
        <KV k="What happened">{w.note || '-'}</KV>
        <KV k="Value">{bm(w.value)}</KV>
        <KV k="Raised by">{w.by} at {at(w.at)}</KV>
        {w.decided_by && <KV k={w.status === 'rejected' ? 'Rejected by' : 'Approved by'}>{w.decided_by}</KV>}
        {w.transfer_no && <KV k="Transfer"><a href={`/admin/transfers`}>{w.transfer_no}</a></KV>}
        {w.run_no && <KV k="Production run">{w.run_no}</KV>}
      </dl>
    </Drawer>
  );
}
