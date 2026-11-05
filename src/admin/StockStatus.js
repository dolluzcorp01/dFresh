// Inventory > Stock status (phase 18, v23 viewStock / DRAWERS.stk / viewFloor; API /inventory/stock in
// inventory-routes.js). Tabs Packs we sell / Raw materials, summed over the godowns in view: Good, Held for orders,
// Free to sell (Good less held less expired), QC hold, Damaged, Returned (and Rejected), Disputed, On the road, In
// production, value (See cost only, "hidden" otherwise), flags (expired, near expiry, low). Search, category, "Low or
// expired only", "Show in cartons". A row opens the item: per godown its batches on every shelf and the last moves.
// The godown floor: four big buttons for the warehouse phone (take stock in, send to another godown, count a shelf,
// report damage).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, Alert, useAdmin, useLoad, useToast, money } from './ui';
import { ItemCell, at, bm, useOpenParam } from './buyShared';
import { WoDrawer, qn, useInvOptions } from './invShared';
import { NewTransfer } from './Transfers';
import { mediaUrl } from '../utils/api';

export default function StockStatus() {
  const [floor, setFloor] = useState(false);
  return floor ? <Floor onBack={() => setFloor(false)} /> : <Office onFloor={() => setFloor(true)} />;
}

function Office({ onFloor }) {
  const [tab, setTab] = useState('pack');
  const data = useLoad(`/inventory/stock?kind=${tab}`);
  const opts = useInvOptions();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [low, setLow] = useState(false);
  const [ctn, setCtn] = useState(false);
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(String(id)));
  const rows = useMemo(() => (d ? d.rows.filter((r) => (!q || `${r.sku_code} ${r.name}`.toLowerCase().includes(q.toLowerCase())) && (!cat || r.category === cat) && (!low || r.low || r.expired)) : []), [d, q, cat, low]);
  const road = rows.some((r) => r.road);
  const cols = [
    { key: 'item', label: 'Item', render: (r) => <ItemCell name={r.name} code={r.sku_code} image={r.image} /> },
    { key: 'good', label: 'Good', num: true, render: (r) => qn(r.good, r, ctn) },
    { key: 'held', label: 'Held', num: true, render: (r) => qn(r.held, r, ctn) },
    { key: 'free', label: 'Free to sell', num: true, render: (r) => <><b className={r.low ? 'a-bad' : undefined}>{qn(r.free, r, ctn)}</b>{r.raw && <small className="a-muted a-p15-sub">{r.unit}</small>}</> },
    { key: 'hold', label: 'QC hold', num: true, hideSm: true, render: (r) => qn(r.hold, r, ctn) },
    { key: 'dmg', label: 'Damaged', num: true, hideSm: true, render: (r) => qn(r.dmg, r, ctn) },
    { key: 'ret', label: 'Returned', num: true, hideSm: true, render: (r) => qn(r.ret + r.rej, r, ctn) },
    ...(road ? [{ key: 'road', label: 'In a lorry', num: true, hideSm: true, render: (r) => qn(r.road, r, ctn) }] : []),
    ...(tab === 'raw' ? [{ key: 'in_production', label: 'In production', num: true, hideSm: true, render: (r) => qn(r.in_production, r) }] : []),
    ...(d && d.see_cost ? [{ key: 'value', label: 'Value', num: true, hideSm: true, render: (r) => bm(r.value) }] : []),
    { key: 'flags', label: 'Flags', render: (r) => <span className="a-p17-pills">{r.expired > 0 && <Pill tone="bad">{r.expired} expired</Pill>}{r.near > 0 && <Pill tone="warn">{r.near} near expiry</Pill>}
      {r.disp > 0 && <Pill tone="warn">{r.disp} disputed</Pill>}{r.low && <Pill tone="warn">Low</Pill>}</span> },
  ];
  return (
    <section>
      <PageHead sub="What we have, where, and what can be sold" rules={['Free to sell = good less held for orders less expired', 'Stock never goes below zero', 'Click a row for its batches and moves']}
        actions={<><a className="a-btn a-btn-ghost" href="/admin/commerce/stock?tab=in">Stock-ins of before</a><button type="button" className="a-btn a-btn-ghost" onClick={onFloor}><LIcon name="warehouse" size="sm" />Godown floor</button></>} />
      <Tabs label="Stock" value={tab} onChange={setTab} tabs={[{ key: 'pack', label: 'Packs we sell' }, { key: 'raw', label: 'Raw materials' }]} />
      <Loading state={data}>
        {d && (
          <div className="a-listcard">
            <div className="a-p18-filters">
              <label className="a-p18-search"><LIcon name="search" size="sm" /><input value={q} placeholder="Search code or name" aria-label="Search stock" onChange={(e) => setQ(e.target.value)} /></label>
              {tab === 'pack' && opts.data && <select value={cat} aria-label="Category" onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{opts.data.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>}
              <label className="a-check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low or expired only</label>
              {tab === 'pack' && <label className="a-check"><input type="checkbox" checked={ctn} onChange={(e) => setCtn(e.target.checked)} /> Show in cartons</label>}
            </div>
            <div className="a-p18-count"><b>{rows.length}</b> {tab === 'pack' ? 'packs' : 'raw materials'} · {d.all_godowns ? 'All godowns' : d.godowns.join(', ')}{d.see_cost && d.total_value !== null ? ` · value ${money(d.total_value)}` : ''}</div>
            <Table columns={cols} rows={rows} rowKey={(r) => r.sku_code} label="Stock status" onRowClick={(r) => setOpen(r.sku_code)} empty={{ icon: 'package', title: 'Nothing here', text: 'No item matches.' }} />
          </div>
        )}
      </Loading>
      {open && <ItemDrawer sku={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ItemDrawer({ sku, onClose }) {
  const one = useLoad(`/inventory/stock/${encodeURIComponent(sku)}`);
  const nav = useNavigate();
  const x = one.data;
  if (!x) return <Drawer title="Stock" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return (
    <Drawer title={x.name} onClose={onClose} thumb={x.image ? mediaUrl(`/media/products/400/${x.image}`) : <LIcon name="package" />}
      status={<><Pill>{x.sku_code}</Pill>{x.per_carton && <Pill>{x.per_carton} per carton</Pill>}<span className="a-p15-sp" />{x.avg_cost !== null && <small className="a-muted">Average cost {money(x.avg_cost)}</small>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {x.godowns.map((g) => (
        <div key={g.godown_id}>
          <h3 className="a-h3s">{g.godown} · free to sell {g.free} (good {g.good}, held {g.held}{g.expired ? `, expired ${g.expired}` : ''})</h3>
          {!g.lots.length ? <p className="a-hint-s">Nothing here.</p> : (
            <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Shelf</th><th>Batch</th><th className="a-hide-sm">Made</th><th>Expires</th><th className="a-num">Qty</th></tr></thead>
              <tbody>{g.lots.map((l, i) => (
                <tr key={i}><td>{l.shelf_label}</td><td className="a-mono">{l.batch_no}</td><td className="a-hide-sm">{l.mfg || '-'}</td>
                  <td>{l.exp ? <>{l.exp} {l.state === 'expired' ? <Pill tone="bad">Expired, blocked</Pill> : l.state === 'near' ? <Pill tone="warn">{l.days} days</Pill> : null}</> : '-'}</td><td className="a-num"><b>{l.qty}</b></td></tr>
              ))}</tbody></table></div>
          )}
        </div>
      ))}
      <h3 className="a-h3s">Last moves</h3>
      <ul className="a-p17-vers">{x.moves.map((m) => <li key={m.move_id}>{at(m.at)} · {m.godown} · {m.shelf_label} · {m.qty > 0 ? '+' : ''}{m.qty} · {m.what} ({m.doc}) · {m.who}</li>)}</ul>
      <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => nav(`/admin/stock-ledger?sku=${encodeURIComponent(x.sku_code)}`)}><LIcon name="list-todo" size="sm" />Every move in the stock ledger</button>
    </Drawer>
  );
}

/** the godown floor: big buttons for the warehouse phone; your name and godown are filled in */
function Floor({ onBack }) {
  const { me } = useAdmin();
  const opts = useInvOptions();
  const nav = useNavigate();
  const toast = useToast();
  const [send, setSend] = useState(false);
  const [dmg, setDmg] = useState(false);
  const o = opts.data;
  const one = o && o.mine.length === 1 ? o.mine[0].godown_id : null;
  const count = async () => {
    const t = await api.get('/inventory/takes');
    const open = t.rows.find((x) => x.status === 'open');
    if (!open) { toast('info', 'No stock take is running', 'Your supervisor starts one; then you count here.'); return; }
    nav(`/admin/stock-take?open=${open.count_id}`);
  };
  const BTNS = [['in', 'truck', 'Take stock in', 'Scan the carton, type the count', () => (o && o.can.goods_in ? nav('/admin/goods-in') : toast('bad', 'Not allowed', 'Goods in needs Create on Suppliers and buying.'))],
    ['send', 'send', 'Send to another godown', 'A transfer note on the lorry', () => setSend(true)],
    ['count', 'clipboard-check', 'Count a shelf', 'The open stock take at your godown', count],
    ['dmg', 'triangle-alert', 'Report damage', 'Move packs to the damaged shelf', () => setDmg(true)]];
  return (
    <section>
      <PageHead sub="What we have, where, and what can be sold" actions={<button type="button" className="a-btn a-btn-ghost" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back to the office view</button>} />
      <Loading state={opts}>
        {o && (
          <>
            <Alert tone="info" title="The godown floor.">{me ? me.name : ''} at {o.mine.map((g) => g.name).join(', ') || 'no godown'}. Your name and godown are filled in for you.</Alert>
            <div className="a-p18-floor">{BTNS.map(([k, ic, t, s, fn]) => (
              <button key={k} type="button" className="a-p18-floorbtn" onClick={fn}><LIcon name={ic} size="lg" /><b>{t}</b><span>{s}</span></button>
            ))}</div>
          </>
        )}
      </Loading>
      {send && <NewTransfer fixedFrom={one} onClose={() => setSend(false)} onSaved={() => setSend(false)} />}
      {dmg && <WoDrawer mode="move" pre={{ godown_id: one, shelf: 'good', to: 'dmg' }} onClose={() => setDmg(false)} onSaved={() => setDmg(false)} />}
    </section>
  );
}
