// Inventory > Batches and expiry (phase 18, v23 viewBatches; API /inventory/batches in inventory-routes.js). Every
// batch with an expiry on the Good or QC hold shelves of the godowns in view, earliest expiry first. Tabs Expired
// (blocked from sale and transfer, with Write off: the panel opens filled) / Near expiry (the product's warn days) /
// Good / All with expiry. Expiry is the made date plus the shelf life; packing and transfers take the oldest first.
import { useState } from 'react';
import { Loading, PageHead, Table, Tabs, useLoad } from './ui';
import { ItemCell } from './buyShared';
import { WoDrawer } from './invShared';

const TABS = [['expired', 'Expired'], ['near', 'Near expiry'], ['ok', 'Good'], ['all', 'All with expiry']];

export default function BatchesExpiry() {
  const [tab, setTab] = useState('expired');
  const data = useLoad(`/inventory/batches?tab=${tab}`);
  const [wo, setWo] = useState(null);
  const d = data.data;
  const cols = [
    { key: 'batch', label: 'Batch', render: (b) => <b className="a-mono">{b.batch_no}</b> },
    { key: 'pack', label: 'Pack', render: (b) => <ItemCell name={b.name} code={b.sku_code} image={b.image} /> },
    { key: 'where', label: 'Godown, shelf', hideSm: true, render: (b) => `${b.godown} · ${b.shelf_label}` },
    { key: 'qty', label: 'Qty', num: true, render: (b) => b.qty.toLocaleString('en-IN') },
    { key: 'mfg', label: 'Made', render: (b) => <span className="a-p18-nowrap">{b.mfg || '-'}</span> },
    { key: 'exp', label: 'Expires', render: (b) => <><span className="a-p18-nowrap">{b.exp}</span><small className="a-muted a-p15-sub">{b.state === 'expired' ? <b className="a-bad">expired {-b.days} days ago, blocked</b> : `${b.days} days left`}</small></> },
    { key: 'act', label: '', render: (b) => (b.state === 'expired' && b.shelf === 'good' && d.can.create
      ? <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={(e) => { e.stopPropagation(); setWo(b); }}>Write off</button> : null) },
  ];
  return (
    <section>
      <PageHead sub="Every batch with its expiry" rules={['Expiry worked out from the shelf life', 'An expired batch is blocked from sale', 'Packing takes the oldest expiry first']} />
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Batches" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: d.counts[k] }))} />
            <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(b) => `${b.godown_id}-${b.shelf}-${b.batch_id}`} label="Batches and expiry"
              empty={{ icon: 'inbox', title: 'Nothing here', text: { expired: 'No expired batch on the shelves.', near: 'Nothing is near its expiry.', ok: 'No batch with an expiry.', all: 'No batch with an expiry.' }[tab] }} /></div>
          </>
        )}
      </Loading>
      {wo && <WoDrawer pre={{ godown_id: wo.godown_id, sku_code: wo.sku_code, shelf: 'good', reason: 'expired', qty: wo.qty, batch_id: wo.batch_id, batch_no: wo.batch_no }}
        onClose={() => setWo(null)} onSaved={() => { setWo(null); data.reload(); }} />}
    </section>
  );
}
