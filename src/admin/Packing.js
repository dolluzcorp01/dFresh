// Fulfilment > Packing (phase 20, v23 viewToPick / viewPacking / viewPackedWait, DRAWERS.pick / DRAWERS.pack; API /fulfil/*
// in fulfil-routes.js, scans and Packed in /commerce/packing/* (delivery.js, fulfil.js)).
// To pick: confirmed orders with held packs; tick several (one godown) for a pick list (DFK no.): the batches are fixed
// then (oldest expiry first, never an expired one) and the orders are Packing (they cannot be changed in Orders any more).
// Packing: open an order, scan the pack or carton label (or type the code, with a count); a wrong item or too many is
// refused. A batch other than the oldest, or a short line (with its reason), needs a person with Approve on Packing.
// Packing done takes the scanned packs off the Good shelf (the exact batches); what is not packed goes to a balance
// order (part shipment, its own invoice and trip stop). Packed, waiting: by kind of delivery, with the packing slip and
// box labels. Every line shows the pack photo.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useLoad, useToast } from './ui';
import { In, ItemCell, at, fieldsOf, useOpenParam } from './buyShared';
import { esc, printPage } from './printKit';
import { printCartonLabels, printSlip } from './CommercePacking';
import { stateName } from '../shared/gstStates';

export const KIND = { own: 'Our vehicle', courier: 'Courier', pickup: 'Customer picks up' };
const kindName = (k) => KIND[k] || k;
const custCell = (r) => <><b>{r.customer}</b><small className="a-muted a-p15-sub">{r.customer_no}</small></>;
const orderCell = (r, sub) => <><b className="a-mono">{r.order_no}</b><small className="a-muted a-p15-sub">{r.godown}{r.parent_no ? ` · balance of ${r.parent_no}` : ''}{sub ? ` · ${sub}` : ''}</small></>;
const itemsCell = (r) => <ItemCell name={r.first_name} code={r.first_sku} image={r.first_image} sub={r.n_lines > 1 ? `+${r.n_lines - 1} more` : null} />;

// ---------------------------------------------------------------------------------------------------------------- To pick
export function ToPick() {
  const data = useLoad('/fulfil/to-pick');
  const act = useAction();
  const toast = useToast();
  const [tab, setTab] = useState('ready');
  const [sel, setSel] = useState([]);
  const [kind, setKind] = useState('');
  const [day, setDay] = useState('');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const ready = d ? d.ready.filter((o) => (!kind || o.delivery_kind === kind) && (!day || o.order_day <= day)) : [];
  const openLists = d ? d.lists.filter((l) => l.status === 'open') : [];
  const make = () => act.run(async () => {
    const ids = sel.filter((no) => d.ready.some((o) => o.order_no === no));
    if (!ids.length) { toast('bad', 'Tick the orders first', 'Choose one or more orders to pick together.'); return; }
    const gs = [...new Set(ids.map((no) => d.ready.find((o) => o.order_no === no).godown))];
    if (gs.length > 1) { toast('bad', 'One godown per pick list', `The ticked orders ship from ${gs.join(' and ')}. Make one list for each.`); return; }
    const out = await api.send('POST', '/fulfil/pick-lists', { order_nos: ids });
    toast('good', `${out.pick_no} made`, `${ids.length} order${ids.length === 1 ? '' : 's'} now in Packing; they cannot be changed in Orders any more.`);
    setSel([]); setTab('lists'); data.reload(); setOpen(out.pick_id);
  });
  const tick = (no) => setSel((s) => (s.includes(no) ? s.filter((x) => x !== no) : [...s, no]));
  const cols = [
    { key: 'pick', label: '', className: 'a-p20-tick', thClassName: 'a-p20-tick', render: (o) => <label className="a-chkrow"><input type="checkbox" aria-label={`Pick ${o.order_no}`} checked={sel.includes(o.order_no)} onChange={() => tick(o.order_no)} /></label> },
    { key: 'order_no', label: 'Order', render: (o) => orderCell(o) },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'items', label: 'Items', hideSm: true, render: itemsCell },
    { key: 'kind', label: 'Delivery', render: (o) => <>{kindName(o.delivery_kind)}<small className="a-muted a-p15-sub">ordered {o.order_day}</small></> },
    { key: 'held', label: 'Packs held', num: true, render: (o) => <b>{o.held}</b> },
  ];
  const lcols = [
    { key: 'pick_no', label: 'Pick list', render: (l) => <><b className="a-mono">{l.pick_no}</b><small className="a-muted a-p15-sub">{l.godown} · {at(l.created_at)}</small></> },
    { key: 'orders', label: 'Orders', render: (l) => l.orders || '-' },
    { key: 'packer', label: 'Packer', hideSm: true, render: (l) => l.packer_name || '-' },
    { key: 'packs', label: 'Packs', num: true, render: (l) => (l.status === 'done' ? '-' : l.packs) },
    { key: 'status', label: 'Status', render: (l) => (l.status === 'done' ? <Pill tone="good">Finished</Pill> : <Pill tone="gold">Packing</Pill>) },
  ];
  return (
    <section>
      <PageHead sub="What to take from the shelves" rules={['Only orders with held packs', 'Several orders, one walk', 'Oldest batch first']}
        actions={d && d.can.create && tab === 'ready' && <button type="button" className="a-btn" disabled={act.busy} onClick={make}><LIcon name="clipboard-list" size="sm" />Make pick list</button>} />
      {act.note}
      <Loading state={data}>{d && <>
        <Tabs label="To pick" value={tab} onChange={setTab} tabs={[{ key: 'ready', label: 'Ready to pick', count: d.ready.length }, { key: 'lists', label: 'Pick lists', count: openLists.length }]} />
        {tab === 'ready' ? (
          <div className="a-listcard">
            <div className="a-p18-filters">
              <label className="a-p20-fi"><LIcon name="truck" size="sm" /><select value={kind} aria-label="Delivery" onChange={(e) => setKind(e.target.value)}><option value="">Every delivery</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="a-p20-fi"><LIcon name="calendar" size="sm" /><input type="date" value={day} aria-label="Ordered on or before" onChange={(e) => setDay(e.target.value)} /></label>
              <span className="a-hint-s">Ordered on or before</span>
            </div>
            <Table columns={cols} rows={ready} rowKey={(o) => o.order_no} label="Ready to pick" empty={{ icon: 'clipboard-list', title: 'Nothing to pick', text: 'Confirmed orders appear here once their packs are held.' }} />
          </div>
        ) : (
          <div className="a-listcard"><Table columns={lcols} rows={d.lists} rowKey={(l) => l.pick_id} label="Pick lists" onRowClick={(l) => setOpen(l.pick_id)} empty={{ icon: 'clipboard-list', title: 'No pick list', text: 'Tick orders in Ready to pick and press Make pick list.' }} /></div>
        )}
      </>}</Loading>
      {open && <PickDrawer id={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
    </section>
  );
}

function printPick(x) {
  const rows = x.take.map((t) => `<tr><td><b>${esc(t.bin_location || '-')}</b></td><td><b>${esc(t.name)}</b><br><small>${esc(t.sku_code)}</small></td><td class="n"><b>${t.qty}</b></td>
    <td>${t.batch_no ? `${esc(t.batch_no)}${t.expiry_date ? ` <small>exp ${esc(t.expiry_date)}</small>` : ''}` : '-'}</td><td class="tick"><span class="box"></span></td></tr>`).join('');
  return printPage({
    title: `Pick list ${x.pick_no}`,
    body: `<div class="row"><div><h1>Pick list ${esc(x.pick_no)}</h1><div class="muted">${esc(x.godown)} · ${esc(at(x.created_at))} · packer ${esc(x.packer_name || '-')}</div></div></div>
      <table><thead><tr><th>Bin</th><th>Item</th><th class="n">Packs</th><th>Batch to take</th><th class="tick">Taken</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Orders: ${x.orders.map((o) => esc(o.order_no)).join(', ')}</p>`,
  });
}

function PickDrawer({ id, onClose, onChanged }) {
  const one = useLoad(`/fulfil/pick-lists/${id}`);
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const [packer, setPacker] = useState(null);
  const x = one.data;
  if (!x) return <Drawer title="Pick list" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const p = packer === null ? x.packer || '' : packer;
  const give = () => act.run(async () => {
    await api.send('PUT', `/fulfil/pick-lists/${id}/packer`, { packer: p });
    const who = (x.packers.find((y) => y.emp_id === p) || {}).name;
    toast('good', 'Saved', p ? `${x.pick_no} is with ${who}. It shows in their Packing list.` : `${x.pick_no} has no packer.`);
    one.reload(); onChanged();
  });
  const done = x.status === 'done';
  return (
    <Drawer title={`Pick list ${x.pick_no}`} onClose={onClose} thumb={<LIcon name="clipboard-list" />}
      status={<>{done ? <Pill tone="good">Finished</Pill> : <Pill tone="gold">Packing</Pill>}<span className="a-p15-sp" />
        <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { if (!printPick(x)) toast('bad', 'Allow pop-ups', 'Allow pop-ups to print the pick list.'); }}><LIcon name="printer" size="sm" />Print pick list</button></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      <dl className="a-kv"><dt>Godown</dt><dd>{x.godown}</dd><dt>Made</dt><dd>{at(x.created_at)} by {x.made_by}</dd><dt>Packer</dt><dd>{x.packer_name || '-'}</dd></dl>
      {!done && <>
        <h3 className="a-h3s">Take from the shelves</h3>
        <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Packs</th><th>Batch to take (oldest first)</th></tr></thead>
          <tbody>{x.take.map((t, i) => <tr key={i}><td><ItemCell name={t.name} code={t.sku_code} image={t.image} sub={t.bin_location ? `bin ${t.bin_location}` : null} /></td><td className="a-num"><b>{t.qty}</b></td>
            <td>{t.batch_no ? <><b>{t.batch_no}</b>{t.expiry_date && <span className="a-muted"> exp {t.expiry_date}</span>}</> : <span className="a-muted">no batches</span>}</td></tr>)}</tbody></table></div>
        {x.can.create && <div className="a-grid2 a-p20-give">
          <In label="Packer"><select value={p} onChange={(e) => setPacker(e.target.value)}><option value="">-</option>{x.packers.map((y) => <option key={y.emp_id} value={y.emp_id}>{y.name}</option>)}</select></In>
          <div className="a-field"><span>&nbsp;</span><button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={give}>Give to the packer</button></div>
        </div>}
      </>}
      <h3 className="a-h3s">Orders</h3>
      <div className="a-scroll"><table className="a-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th /></tr></thead>
        <tbody>{x.orders.map((o) => <tr key={o.order_no}><td><b className="a-mono">{o.order_no}</b></td><td>{o.customer}</td>
          <td>{o.status === 'packing' ? (o.scanned ? <Pill tone="gold">{o.scanned} of {o.need} packed</Pill> : <Pill>Not started</Pill>) : <Pill tone={o.status === 'cancelled' ? 'gray' : 'good'}>{o.status === 'cancelled' ? 'Cancelled' : 'Packed'}</Pill>}</td>
          <td className="a-act">{o.status === 'packing' && <button type="button" className="a-btn a-btn-sm" onClick={() => nav(`/admin/packing?open=${encodeURIComponent(o.order_no)}`)}>Pack</button>}</td></tr>)}</tbody></table></div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Packing
const progress = (r) => (r.status === 'packed' ? <Pill tone="good">Packed</Pill> : r.scanned ? <Pill tone="gold">{r.scanned} of {r.need} packed</Pill> : <Pill>Not started</Pill>);
export function PackingPage() {
  const data = useLoad('/fulfil/packing');
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (no) => setOpen(String(no)));
  const cols = [
    { key: 'order_no', label: 'Order', render: (o) => orderCell(o) },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'pick', label: 'Pick list', hideSm: true, render: (o) => <><span className="a-mono">{o.pick_no || '-'}</span>{o.packer_name && <small className="a-muted a-p15-sub">{o.packer_name}</small>}</> },
    { key: 'kind', label: 'Delivery', render: (o) => <>{kindName(o.delivery_kind)}<small className="a-muted a-p15-sub">ordered {o.order_day}</small></> },
    { key: 'progress', label: 'Progress', render: progress },
  ];
  return (
    <section>
      <PageHead sub="Scan packs into the box; stock goes down" rules={['Scan the pack or the carton', 'Wrong item or too many: refused', 'Stock goes down when packing is done']} />
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(o) => o.order_no} label="Packing" onRowClick={(o) => setOpen(o.order_no)} empty={{ icon: 'package', title: 'Nothing being packed', text: 'Make a pick list in To pick first.' }} /></div>}</Loading>
      {open && <PackDrawer no={open} onClose={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}

/** per item: to pack, packed, left, the batch to scan from, the reason when short */
function perSku(lines) {
  const m = new Map();
  lines.forEach((l) => { const v = m.get(l.sku_code) || { sku_code: l.sku_code, name: l.name, image: l.image, need: 0, scanned: 0, plan: [] }; v.need += l.need; v.scanned += l.scanned; if (l.need > 0 && l.batch_no) v.plan.push(l.batch_no); m.set(l.sku_code, v); });
  return [...m.values()];
}

export function PackDrawer({ no, onClose }) {
  const one = useLoad(`/fulfil/packing/${encodeURIComponent(no)}`);
  const act = useAction();
  const toast = useToast();
  const scanRef = useRef(null);
  const [code, setCode] = useState('');
  const [n, setN] = useState('1');
  const [batch, setBatch] = useState({});
  const [short, setShort] = useState({});
  const [f, setF] = useState({ cartons: '', weight_kg: '' });
  const [err, setErr] = useState({});
  const x = one.data;
  const packing = Boolean(x && x.status === 'packing');
  useEffect(() => { if (packing && scanRef.current) scanRef.current.focus(); }, [packing, x]);
  if (!x) return <Drawer title={`Pack ${no}`} onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const items = perSku(x.lines);
  const all = items.reduce((a, i) => a + i.need, 0); const done = items.reduce((a, i) => a + Math.min(i.scanned, i.need), 0);
  const shortList = items.filter((i) => i.scanned < i.need);
  const ed = x.can.edit;
  const rowBatch = (sku) => batch[sku] || ((x.lots[sku] || [])[0] || {}).batch_no || '';
  const scan = (e) => {
    if (e) e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    const sku = c.replace(/#C$/, '');
    const body = { code: c, n };
    if (!c.includes('/') && x.lots[sku]) body.batch = rowBatch(sku);
    act.run(async () => {
      const r = await api.send('POST', `/commerce/packing/${encodeURIComponent(no)}/scan`, body);
      setCode('');
      if (scanRef.current) scanRef.current.focus();
      if (r.result === 'ok') toast(r.off ? 'warn' : 'good', r.off ? 'Not the picked batch' : `+${r.message.split(':')[0]}`, r.message);
      else toast('bad', { unknown: 'Unknown code', wrong_sku: 'Not on this order', too_many: 'Too many', wrong_batch: 'Not in that batch', expired: 'Expired batch' }[r.result] || 'Not counted', r.message);
      one.reload();
    });
  };
  const undo = (s) => act.run(async () => { await api.send('POST', `/commerce/packing/${encodeURIComponent(no)}/undo`, { scan_id: s.scan_id }); toast('info', 'Removed', `${s.qty} ${s.sku_code} taken off this order.`); one.reload(); });
  const finish = () => act.run(async () => {
    setErr({});
    try {
      const r = await api.send('POST', `/commerce/packing/${encodeURIComponent(no)}/packed`, { cartons: f.cartons, weight_kg: f.weight_kg, short });
      toast(r.short ? 'warn' : 'good', `${no} packed`, `${r.packed} packs left the shelf at ${x.godown_name || 'the godown'}.${r.damaged ? ` ${r.damaged} damaged moved to the Damaged shelf.` : ''}${r.short ? ` ${r.short} short wait as a back-order on ${r.balance_no}.` : r.balance_no ? ` The rest waits on ${r.balance_no}.` : ' It waits in Packed, waiting.'}`);
      onClose();
    } catch (e2) { setErr(fieldsOf(e2)); throw e2; }
  });
  const slip = (kind) => act.run(async () => {
    const s = await api.get(`/commerce/packing/${encodeURIComponent(no)}/slip`);
    if (!(kind === 'slip' ? printSlip({ ...s, ship_state: s.ship_state || stateName(s.ship_state_code) }) : printCartonLabels(s))) toast('bad', 'Allow pop-ups', 'Allow pop-ups to print.');
  });
  const pill = x.status === 'packed' || x.status !== 'packing' ? <Pill tone="good">Packed</Pill> : done ? <Pill tone="gold">{done} of {all} packed</Pill> : <Pill>Not started</Pill>;
  return (
    <Drawer title={`Pack ${x.order_no}`} onClose={onClose} thumb={<LIcon name="package" />} wide
      status={<>{pill}<Pill>{kindName(x.delivery_kind)}</Pill><span className="a-p15-sp" /><span className="a-hint-s">{x.customer}</span></>}
      footer={<>{!packing && <><button type="button" className="a-btn a-btn-ghost" onClick={() => slip('slip')}><LIcon name="printer" size="sm" />Packing slip</button><button type="button" className="a-btn a-btn-ghost" onClick={() => slip('labels')}>Box labels</button></>}
        <span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        {ed && <button type="button" className="a-btn" disabled={act.busy} onClick={finish}><LIcon name="package-check" size="sm" />Packing done</button>}</>}>
      {act.note}
      {x.note && <Alert tone="info" title="Note from the order.">{x.note}</Alert>}
      {ed && <>
        <form className="a-p20-scan" onSubmit={scan}>
          <label className="a-p20-fi a-p20-grow"><LIcon name="scan-barcode" size="sm" /><input ref={scanRef} value={code} placeholder="Scan the barcode, or type the code" aria-label="Scan" autoComplete="off" onChange={(e) => setCode(e.target.value)} /></label>
          <input type="number" min="1" step="1" value={n} aria-label="How many" className="a-p20-n" onChange={(e) => setN(e.target.value)} />
          <button type="submit" className="a-btn" disabled={act.busy}>Add</button>
        </form>
        <p className="a-hint-s">A carton label counts a full carton. Each item packs from the batch chosen in its row below.</p>
      </>}
      {packing && <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">To pack</th><th className="a-num">Packed</th><th className="a-num">Left</th>{ed && <th>Batch</th>}</tr></thead>
        <tbody>{items.map((i) => { const left = i.need - i.scanned; const lots = x.lots[i.sku_code] || []; return (
          <tr key={i.sku_code}><td><ItemCell name={i.name} code={i.sku_code} image={i.image} />{short[i.sku_code] && <small className="a-p15-sub"><Pill tone="bad">{x.short_why[short[i.sku_code]]}</Pill></small>}</td>
            <td className="a-num">{i.need}</td><td className="a-num"><b>{i.scanned}</b></td><td className="a-num">{left > 0 ? <b className="a-tbad">{left}</b> : <Pill tone="good">Done</Pill>}</td>
            {ed && <td>{lots.length > 0 ? <select value={rowBatch(i.sku_code)} aria-label={`Batch for ${i.sku_code}`} onChange={(e) => setBatch((b) => ({ ...b, [i.sku_code]: e.target.value }))}>
              {lots.map((l, k) => <option key={l.batch_no} value={l.batch_no}>{l.batch_no} · {l.qty}{l.expiry_date ? ` · exp ${l.expiry_date}` : ''}{k === 0 ? ' (oldest)' : ''}</option>)}</select> : <span className="a-muted">no batches</span>}
              {left > 0 && <div className="a-p20-why"><select value={short[i.sku_code] || ''} aria-label="Why short" className={err.short && err.short.split(',').includes(i.sku_code) ? 'a-bad' : ''} onChange={(e) => setShort((s) => { const v = { ...s }; if (e.target.value) v[i.sku_code] = e.target.value; else delete v[i.sku_code]; return v; })}>
                <option value="">If short, why...</option>{Object.entries(x.short_why).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}</td>}
          </tr>); })}</tbody></table></div>}
      {x.scans.length > 0 && packing && <><h3 className="a-h3s">Packed so far</h3>
        <ul className="a-p20-mini">{x.scans.map((s) => <li key={s.scan_id}>{s.sku_code} · {s.qty}{s.batch_no ? <> from batch <b>{s.batch_no}</b></> : ''}{s.off_plan && <> <Pill tone="warn">not the picked batch</Pill></>}
          {ed && <> <button type="button" className="a-link" disabled={act.busy} onClick={() => undo(s)}>remove</button></>}</li>)}</ul></>}
      {!packing && x.packed.length > 0 && <><h3 className="a-h3s">Packed</h3><ul className="a-p20-mini">{x.packed.map((p, i) => <li key={i}>{p.sku_code} · {p.qty}{p.batch_no ? <> from batch <b>{p.batch_no}</b></> : ''}</li>)}</ul></>}
      {ed && <div className="a-grid2">
        <In label="Boxes *" type="number" min="1" step="1" value={f.cartons} error={err.cartons} onChange={(e) => setF({ ...f, cartons: e.target.value })} />
        <In label="Weight of all boxes (kg) *" type="number" min="0.1" step="0.1" value={f.weight_kg} error={err.weight_kg} hint="For the courier and the vehicle load." onChange={(e) => setF({ ...f, weight_kg: e.target.value })} />
      </div>}
      {ed && done > 0 && (shortList.length > 0 || x.off) && <Alert tone="warn" title={`${shortList.map((i) => `${i.sku_code} ${i.need - i.scanned} short`).join(', ')}${shortList.length ? '.' : ''}${x.off ? ' A batch other than the one picked for it was packed.' : ''}`}>
        {x.can.approve ? 'You can finish it: the short packs go to a balance order (part shipment) and wait as a back-order.' : 'Your supervisor (Approve on Packing) finishes this one.'}</Alert>}
      {!packing && <dl className="a-kv"><dt>Packed</dt><dd>{at(x.packed_at)}{x.packed_by_name ? ` by ${x.packed_by_name}` : ''}</dd><dt>Boxes</dt><dd>{x.cartons || '-'} · {x.weight_kg ? `${Number(x.weight_kg)} kg` : '-'}</dd>
        {x.pick_no && <><dt>Pick list</dt><dd>{x.pick_no}</dd></>}{x.balances.length > 0 && <><dt>The rest</dt><dd>{x.balances.join(', ')} (part shipment)</dd></>}</dl>}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------- Packed, waiting
const GROUPS = [['own', 'Our vehicle'], ['courier', 'Courier'], ['pickup', 'Customer picks up']];
export function PackedWaiting() {
  const data = useLoad('/fulfil/packed');
  const [tab, setTab] = useState('own');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const rows = d ? d.rows.filter((o) => o.delivery_kind === tab) : [];
  const old = d ? d.rows.filter((o) => o.hours > 24).length : 0;
  const cols = [
    { key: 'order_no', label: 'Order', render: (o) => orderCell(o, o.trip_id ? `on trip T-${o.trip_id}` : null) },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'to', label: 'Deliver to', hideSm: true, render: (o) => <>{[o.ship_address, o.ship_town].filter(Boolean).join(', ')}<small className="a-muted a-p15-sub">{o.ship_pincode}</small></> },
    { key: 'day', label: 'Ordered', render: (o) => <span className="a-p18-nowrap">{o.order_day}</span> },
    { key: 'cartons', label: 'Boxes', num: true, render: (o) => o.cartons },
    { key: 'kg', label: 'Weight', num: true, render: (o) => `${Number(o.weight_kg)} kg` },
    { key: 'wait', label: 'Waiting', render: (o) => (o.hours > 24 ? <Pill tone="bad">{Math.floor(o.hours / 24)} day{o.hours >= 48 ? 's' : ''}</Pill> : `${o.hours} h`) },
  ];
  return (
    <section>
      <PageHead sub="Boxes ready for a vehicle" rules={['Ready for a vehicle, courier or pickup', 'Packing slip goes with the goods', 'Delivery takes it from here']} />
      <Loading state={data}>{d && <>
        {old > 0 && <Alert tone="warn" title={`${old} packed order${old === 1 ? ' has' : 's have'} waited more than a day.`}>Plan a trip, book the courier, or call the customer to collect.</Alert>}
        <Tabs label="Packed, waiting" value={tab} onChange={setTab} tabs={GROUPS.map(([k, l]) => ({ key: k, label: l, count: d.rows.filter((o) => o.delivery_kind === k).length }))} />
        <div className="a-listcard"><Table columns={cols} rows={rows} rowKey={(o) => o.order_no} label="Packed, waiting" onRowClick={(o) => setOpen(o.order_no)} empty={{ icon: 'package-check', title: 'Nothing waiting', text: 'No packed order for this kind of delivery.' }} /></div>
      </>}</Loading>
      {open && <PackDrawer no={open} onClose={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}

