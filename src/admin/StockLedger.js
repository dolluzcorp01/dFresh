// Inventory > Stock ledger (phase 18, v23 viewLedger; API /inventory/ledger in inventory-routes.js). Every move of
// stock, newest first: when, item, godown and shelf, batch, quantity, what moved it and its document, who. Search
// (item, document, batch, person), shelf and a from date; the newest 200 are shown. Export CSV for people with Export
// on Inventory (cost per unit only with See cost). ?sku= opens it on one item (from Stock status).
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { LIcon, Loading, PageHead, Table, useAction, useLoad } from './ui';
import { ItemPic, at } from './buyShared';

export default function StockLedger() {
  const loc = useLocation();
  const [q, setQ] = useState(new URLSearchParams(loc.search).get('sku') || '');
  const [shelf, setShelf] = useState('');
  const [from, setFrom] = useState('');
  const qs = `q=${encodeURIComponent(q)}&shelf=${shelf}&from=${from}`;
  const data = useLoad(`/inventory/ledger?${qs}`);
  const act = useAction();
  const d = data.data;
  const exp = () => act.run(async () => { await api.download(`/inventory/ledger.csv?${qs}`, 'dfresh-stock-ledger.csv'); });
  const cols = [
    { key: 'at', label: 'When', render: (m) => <span className="a-p18-nowrap">{at(m.at)}</span> },
    { key: 'item', label: 'Item', render: (m) => <span className="a-p16-item"><ItemPic code={m.sku_code} size={30} /><b>{m.sku_code}</b></span> },
    { key: 'where', label: 'Godown, shelf', hideSm: true, render: (m) => `${m.godown} · ${m.shelf_label}` },
    { key: 'batch', label: 'Batch', hideSm: true, render: (m) => <span className="a-mono">{m.batch_no}</span> },
    { key: 'qty', label: 'Qty', num: true, render: (m) => <b className={m.qty < 0 ? 'a-bad' : undefined}>{m.qty > 0 ? '+' : ''}{m.qty}</b> },
    { key: 'what', label: 'What and document', render: (m) => <>{m.what}<small className="a-muted a-p15-sub">{m.doc}</small></> },
    { key: 'who', label: 'Who', hideSm: true },
  ];
  return (
    <section>
      <PageHead sub="Every move of stock, in and out" rules={['Every move, in and out', 'Who, when, which shelf, which batch, which document', 'Nothing can change stock without a line here']}
        actions={d && d.can.export && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={exp}><LIcon name="download" size="sm" />Export CSV</button>} />
      {act.note}
      <div className="a-listcard">
        <div className="a-p18-filters">
          <label className="a-p18-search"><LIcon name="search" size="sm" /><input value={q} placeholder="Search item, document, batch or person" aria-label="Search the ledger" onChange={(e) => setQ(e.target.value)} /></label>
          <select value={shelf} aria-label="Shelf" onChange={(e) => setShelf(e.target.value)}><option value="">All shelves</option>{d && d.shelves.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <input type="date" value={from} aria-label="From date" onChange={(e) => setFrom(e.target.value)} />
        </div>
        <Loading state={data}>
          {d && (
            <>
              <div className="a-p18-count"><b>{d.total}</b> moves{d.total > 200 ? ' · newest 200 shown' : ''}</div>
              <Table columns={cols} rows={d.rows} rowKey={(m) => m.move_id} label="Stock ledger" empty={{ icon: 'inbox', title: 'No move', text: 'Nothing matches.' }} />
            </>
          )}
        </Loading>
      </div>
    </section>
  );
}
