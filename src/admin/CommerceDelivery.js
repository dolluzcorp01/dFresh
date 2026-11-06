// Fulfilment > Delivery (phase 20, v23 viewTrips / viewCourierPickup / viewPod / viewFails / viewCod, DRAWERS.trip / stop /
// tripNew / crBook / puDone) and My trips (drivers, phone first). API /commerce/delivery, /commerce/trips, /commerce/stops,
// /commerce/orders/:no/*, /fulfil/pod|failed|cod; logic in src/backend_routes/delivery.js and fulfil.js.
// Trips: a trip leaves from one godown with one vehicle and driver and carries many packed orders (up to the vehicle's
// kg and boxes). Start trip = the goods leave (the tax invoices are made; the stock already went down at Packed). Each
// stop ends Delivered, Delivered short (some packs kept), Refused or Not delivered: packs not kept come back to the
// Returned shelf with a credit note; a not-delivered order goes back to Packed, waiting. Cash due per stop = that
// stop's invoice less what is paid. Close the trip with the cash handed in: a difference is flagged (Cash short).
// Courier and pickup, Proof of delivery, Failed / short / refused and Cash on delivery are lists over the same records.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useLoad, useToast, useUpload, UploadProgress } from './ui';
import { In, ItemCell, at, fieldsOf, today, useOpenParam } from './buyShared';
import { barcodeSvg, esc, printPage, rs } from './printKit';

const placeLine = (x) => [x.ship_address, [x.ship_town, x.ship_pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const shortTrip = (t) => t.status === 'ended' && Number(t.cash_handed) < Number(t.cash_collected) - 0.005;
const TRIP_TONE = { planned: ['Planned', 'gray'], out: ['On the road', 'info'], cashshort: ['Cash short', 'warn'], ended: ['Closed', 'good'] };
const tripKey = (t) => (shortTrip(t) ? 'cashshort' : t.status);
const tripPill = (t) => { const [l, tone] = TRIP_TONE[tripKey(t)]; return <Pill tone={tone}>{l}</Pill>; };
const stopKind = (s) => (s.status === 'delivered' && s.not_kept ? 'short' : s.status);
const STOP_TONE = { pending: ['On the way', 'info'], delivered: ['Delivered', 'good'], short: ['Delivered short', 'warn'], refused: ['Refused', 'bad'], failed: ['Not delivered', 'bad'], picked_up: ['Picked up', 'good'] };
const stopPill = (s, planned) => { if (planned && s.status === 'pending') return <Pill>Loaded</Pill>; const [l, tone] = STOP_TONE[stopKind(s)] || [s.status, 'gray']; return <Pill tone={tone}>{s.kind === 'pickup' && s.status === 'pending' ? 'To pick up' : l}</Pill>; };
const stopKey = (s) => (s.kind === 'pickup' ? s.return_no : s.order_no);
const meterTone = (p) => (p > 100 ? 'bad' : p > 85 ? 'warn' : '');

export function printTripSheet(t) {
  const rows = t.stops.map((s) => `<tr><td class="n"><b>${s.seq}</b></td><td>${barcodeSvg(stopKey(s), { height: 26, width: 1.1, fontSize: 10 })}</td>
    <td>${s.kind === 'pickup' ? `<b>PICK UP (return)</b> ${esc(s.pickup_items || '')}<br>` : ''}<b>${esc(s.customer)}</b><br>${esc(placeLine(s))}<br>${esc(s.ship_phone || '')}</td>
    <td class="n">${s.kind === 'pickup' ? '-' : s.cartons || '-'}</td><td class="n">${s.to_collect > 0 ? `<b>${rs(s.to_collect)}</b>` : '<span class="muted">-</span>'}</td>
    ${t.otpOn ? `<td>${esc(s.otp || '')}</td>` : ''}<td style="width:30mm"></td></tr>`).join('');
  return printPage({
    title: `Trip sheet T-${t.trip_id}`,
    body: `<div class="row"><div><h1>Trip sheet T-${t.trip_id}</h1>${esc(t.godown || '')} · ${esc(t.trip_date)}</div>
      <div>Vehicle <b>${esc(t.vehicle)}</b> ${esc(t.vehicle_type || '')}<br>Driver <b>${esc(t.driver)}</b> ${esc(t.driver_phone || '')}</div></div>
      <table><thead><tr><th class="n">#</th><th>Order</th><th>Customer and address</th><th class="n">Boxes</th><th class="n">Collect</th>${t.otpOn ? '<th>OTP</th>' : ''}<th>Received by / sign</th></tr></thead><tbody>${rows}</tbody></table>
      <p><b>Total cash to collect: ${rs(t.stops.reduce((a, s) => a + s.to_collect, 0))}</b> · Cash handed in: ______________ · Counted by: ______________</p>`,
  });
}

// ---------------------------------------------------------------------------------------------------------------- Trips
export default function Trips() {
  const data = useLoad('/commerce/delivery');
  const [tab, setTab] = useState('out');
  const [open, setOpen] = useState(null);
  const [mk, setMk] = useState(false);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const rows = d ? d.trips.filter((t) => tripKey(t) === tab) : [];
  const ready = d ? d.orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'own' && !o.trip_id).length : 0;
  const cols = [
    { key: 'trip_id', label: 'Trip', render: (t) => <><b className="a-mono">T-{t.trip_id}</b><small className="a-muted a-p15-sub">{t.godown} · {t.trip_date}</small></> },
    { key: 'vehicle', label: 'Vehicle and driver', render: (t) => <>{t.vehicle}<small className="a-muted a-p15-sub">{t.driver}</small></> },
    { key: 'stops', label: 'Stops', num: true, render: (t) => (t.status === 'planned' ? t.stops : `${t.done} of ${t.stops}`) },
    { key: 'load', label: 'Load', num: true, hideSm: true, render: (t) => <>{r2(t.load_kg)} kg · {t.load_boxes} boxes{t.max_kg !== null && <small className="a-muted a-p15-sub">of {t.max_kg} kg · {t.max_boxes}</small>}</> },
    { key: 'cash', label: 'Cash due', num: true, render: (t) => { const due = t.status === 'planned' ? t.due_now : Number(t.cash_expected || 0); return due ? money(due) : <span className="a-muted">-</span>; } },
    { key: 'status', label: 'Status', render: tripPill },
  ];
  return (
    <section>
      <PageHead sub="Which vehicle and driver takes which orders" rules={["Load packed orders up to the vehicle's limit", 'Each stop: delivered, short, refused or not delivered', 'Cash counted at trip close']}
        actions={d && <button type="button" className="a-btn" onClick={() => setMk(true)}><LIcon name="plus" size="sm" />New trip</button>} />
      <Loading state={data}>{d && <>
        {ready > 0 && <Alert tone="info" title={`${ready} packed order${ready === 1 ? ' waits' : 's wait'} for our vehicle.`}>Make a trip and load them.</Alert>}
        <Tabs label="Trips" value={tab} onChange={setTab} tabs={Object.keys(TRIP_TONE).map((k) => ({ key: k, label: TRIP_TONE[k][0], count: d.trips.filter((t) => tripKey(t) === k).length }))} />
        <div className="a-listcard"><Table columns={cols} rows={rows} rowKey={(t) => t.trip_id} label="Trips" onRowClick={(t) => setOpen(t.trip_id)} empty={{ icon: 'truck', title: 'Nothing here', text: 'No trip in this list.' }} /></div>
      </>}</Loading>
      {mk && d && <NewTrip d={d} onClose={() => setMk(false)} onMade={(id) => { setMk(false); data.reload(); setOpen(id); }} />}
      {open && <Drawer title={`Trip T-${open}`} onClose={() => { setOpen(null); data.reload(); }} thumb={<LIcon name="truck" />} wide
        footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={() => { setOpen(null); data.reload(); }}>Close</button></>}>
        <TripBody id={open} office packed={d ? d.orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'own' && !o.trip_id) : []} onChanged={data.reload} onDeleted={() => { setOpen(null); data.reload(); }} />
      </Drawer>}
    </section>
  );
}

const vehProblem = (v, day) => [v.insurance_until && v.insurance_until < day ? `insurance ended ${v.insurance_until}` : null, v.fitness_until && v.fitness_until < day ? `fitness certificate ended ${v.fitness_until}` : null].filter(Boolean);
const drvProblem = (x, day) => (!x.licence_no ? 'no licence on record' : x.licence_until && x.licence_until < day ? `licence ended ${x.licence_until}` : '');
function NewTrip({ d, onClose, onMade }) {
  const act = useAction();
  const toast = useToast();
  const gs = [...new Map(d.orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'own' && !o.trip_id).map((o) => [o.godown_id, o.godown_code])).entries()];
  const [f, setF] = useState({ godown_id: gs.length ? String(gs[0][0]) : '', trip_date: today(), vehicle_id: '', driver_id: '' });
  const [sel, setSel] = useState([]);
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const day = today();
  const cand = d.orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'own' && !o.trip_id && String(o.godown_id) === f.godown_id);
  const vs = d.vehicles.filter((v) => !v.godown_id || String(v.godown_id) === f.godown_id);
  const save = () => act.run(async () => {
    setErr({});
    if (!sel.length) { toast('bad', 'Nothing loaded', 'Load at least one order.'); return; }
    try { const r = await api.send('POST', '/commerce/trips', { ...f, order_nos: sel }); toast('good', `Trip T-${r.trip_id} made`, `${sel.length} order${sel.length === 1 ? '' : 's'} loaded. Start the trip when it leaves.`); onMade(r.trip_id); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="New trip" onClose={onClose} thumb={<LIcon name="truck" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Make trip</button></>}>
      {act.note}
      <div className="a-grid2">
        <In label="Godown *"><select value={f.godown_id} onChange={(e) => { set('godown_id')(e); setSel([]); }}>{gs.length ? gs.map(([id, code]) => <option key={id} value={String(id)}>{code}</option>) : <option value="">No packed order waits</option>}</select></In>
        <In label="Date *" type="date" min={day} value={f.trip_date} error={err.trip_date} onChange={set('trip_date')} />
        <In label="Vehicle *" error={err.vehicle_id} hint="Vehicles of this godown. Insurance and fitness are checked when the trip starts."><select value={f.vehicle_id} onChange={set('vehicle_id')}><option value="">Choose...</option>
          {vs.map((v) => { const pr = vehProblem(v, day); return <option key={v.vehicle_id} value={v.vehicle_id}>{v.number} · {v.type}{v.max_kg !== null ? ` · ${Number(v.max_kg)} kg, ${v.max_boxes} boxes` : ''}{pr.length ? ` (${pr.join(', ')})` : ''}</option>; })}</select></In>
        <In label="Driver *" error={err.driver_id}><select value={f.driver_id} onChange={set('driver_id')}><option value="">Choose...</option>{d.drivers.map((x) => { const pr = drvProblem(x, day); return <option key={x.driver_id} value={x.driver_id}>{x.name}{pr ? ` (${pr})` : ''}</option>; })}</select></In>
      </div>
      <h3 className="a-h3s">Load packed orders</h3>
      {cand.length ? <div className="a-scroll"><table className="a-table"><tbody>{cand.map((o) => (
        <tr key={o.order_no}><td><label className="a-chkrow"><input type="checkbox" aria-label={`Load ${o.order_no}`} checked={sel.includes(o.order_no)} onChange={() => setSel((s) => (s.includes(o.order_no) ? s.filter((x) => x !== o.order_no) : [...s, o.order_no]))} /></label></td>
          <td><b className="a-mono">{o.order_no}</b><small className="a-muted a-p15-sub">{o.customer}</small></td><td className="a-hide-sm">{placeLine(o)}{o.area && <small className="a-muted a-p15-sub">{o.area}</small>}</td>
          <td className="a-num">{o.cartons} boxes<small className="a-muted a-p15-sub">{Number(o.weight_kg)} kg</small></td></tr>))}</tbody></table></div>
        : <p className="a-hint-s">No packed order for our vehicle at this godown.</p>}
    </Drawer>
  );
}

/** one trip: the office (route order, load, start, close) or its driver (record each stop) */
export function TripBody({ id, office = false, packed = [], onChanged, onDeleted }) {
  const t = useLoad(`/commerce/trips/${id}`);
  const act = useAction();
  const toast = useToast();
  const [stop, setStop] = useState(null);
  const [add, setAdd] = useState('');
  const [end, setEnd] = useState({ cash_handed: '', note: '' });
  const d = t.data;
  const reload = () => { t.reload(); if (onChanged) onChanged(); };
  if (!d) return <Loading state={t}>{null}</Loading>;
  const isOffice = office && d.office;
  const planned = d.status === 'planned';
  const keys = d.stops.map(stopKey);
  const reorder = (list) => act.run(async () => { await api.send('PUT', `/commerce/trips/${id}/stops`, { stops: list }); reload(); });
  const move = (i, by) => { const a = [...keys]; const [x] = a.splice(i, 1); a.splice(i + by, 0, x); reorder(a); };
  const start = () => act.run(async () => { const r = await api.send('POST', `/commerce/trips/${id}/start`); toast('good', `Trip T-${id} is on the road`, `The invoices are made${r.cash_expected ? `; ${rs(r.cash_expected)} to collect` : ''}.`); reload(); });
  const del = () => act.run(async () => { await api.send('DELETE', `/commerce/trips/${id}`); toast('info', `Trip T-${id} deleted`, 'Its orders wait in Packed, waiting again.'); if (onDeleted) onDeleted(); });
  const load = () => act.run(async () => { if (!add) return; await api.send('POST', `/commerce/trips/${id}/load`, { order_no: add }); setAdd(''); toast('good', `${add} loaded`, `On trip T-${id}.`); reload(); });
  const collected = d.stops.reduce((a, s) => a + s.cash_collected, 0);
  const openN = d.stops.filter((s) => s.status === 'pending').length;
  const close = () => act.run(async () => {
    const r = await api.send('POST', `/commerce/trips/${id}/end`, end);
    toast(r.difference < 0 ? 'warn' : 'good', `Trip T-${id} closed`, `Recorded ${rs(r.cash_collected)}, handed in ${rs(r.cash_handed)}${r.difference ? `; ${r.difference < 0 ? 'short' : 'over'} by ${rs(Math.abs(r.difference))} (flagged)` : ''}.`);
    reload();
  });
  const kgp = d.max_kg ? Math.round((d.load.kg / d.max_kg) * 100) : 0; const bxp = d.max_boxes ? Math.round((d.load.boxes / d.max_boxes) * 100) : 0;
  const photo = (s) => act.run(async () => { if (!(await api.open(`/commerce/stops/${s.stop_id}/photo`))) toast('bad', 'Allow pop-ups', 'Allow pop-ups to see the photo.'); });
  const pend = Math.round(d.stops.reduce((a, s) => a + (s.status === 'pending' ? s.to_collect : 0), 0) * 100) / 100;
  return (
    <div className="a-p20-trip">
      {act.note}
      <div className="a-statusbar">{tripPill(d)}<span className="a-p15-sp" />
        {isOffice && planned && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={del}><LIcon name="trash-2" size="sm" />Delete</button>}
        {planned && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={start}><LIcon name="truck" size="sm" />Start trip</button>}
        <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { if (!printTripSheet(d)) toast('bad', 'Allow pop-ups', 'Allow pop-ups to print.'); }}><LIcon name="printer" size="sm" />Trip sheet</button></div>
      <dl className="a-kv"><dt>Godown</dt><dd>{d.godown}</dd><dt>Vehicle</dt><dd>{d.vehicle} · {d.vehicle_type}</dd><dt>Driver</dt><dd>{d.driver}{d.driver_phone && <> · <a href={`tel:${d.driver_phone.replace(/\s/g, '')}`}>{d.driver_phone}</a></>}</dd>
        <dt>Date</dt><dd>{d.trip_date}{d.started_at ? ` · left ${at(d.started_at)}` : ''}{d.ended_at ? ` · closed ${at(d.ended_at)}` : ''}</dd>
        <dt>Load</dt><dd>{d.load.kg}{d.max_kg !== null ? ` of ${d.max_kg}` : ''} kg {d.max_kg ? <span className="a-meter a-p20-meter"><span style={{ width: `${Math.min(100, kgp)}%` }} className={meterTone(kgp)} /></span> : null} · {d.load.boxes}{d.max_boxes !== null ? ` of ${d.max_boxes}` : ''} boxes{bxp > 100 ? ' (over)' : ''}</dd></dl>
      {shortTrip(d) && <Alert tone="warn" title={`Cash short by ${rs(Number(d.cash_collected) - Number(d.cash_handed))}.`}>{d.end_note || 'Flagged to the office.'}</Alert>}
      <h3 className="a-h3s">Stops</h3>
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>#</th><th>Customer and order</th><th className="a-num">Boxes</th><th className="a-num">Cash due</th><th>Status</th><th /></tr></thead>
        <tbody>{d.stops.map((s, i) => (
          <tr key={s.stop_id}><td>{i + 1}</td>
            <td><b>{s.customer}</b><small className="a-muted a-p15-sub"><span className="a-mono">{stopKey(s)}</span>{s.kind === 'pickup' ? ` · return pickup (order ${s.order_no})` : ''}{s.ship_phone ? <> · <a href={`tel:${s.ship_phone.replace(/\s/g, '')}`}>{s.ship_phone}</a></> : ''}</small><small className="a-muted a-p15-sub">{placeLine(s)}</small></td>
            <td className="a-num">{s.kind === 'pickup' ? '-' : s.cartons || '-'}</td>
            <td className="a-num">{s.to_collect ? <>{money(s.to_collect)}{s.cash_collected > 0 && <small className="a-muted a-p15-sub">got {money(s.cash_collected)}</small>}</> : s.cash_collected > 0 ? <small className="a-muted">got {money(s.cash_collected)}</small> : '-'}</td>
            <td>{stopPill(s, planned)}{s.failed_reason && <small className="a-muted a-p15-sub">{s.failed_reason}</small>}{['delivered', 'picked_up'].includes(s.status) && <small className="a-muted a-p15-sub">{s.receiver_name}{s.signed ? ' · signed' : ''}{s.has_photo && <> · <button type="button" className="a-link" onClick={() => photo(s)}>photo</button></>}</small>}</td>
            <td className="a-act a-p18-nowrap">
              {isOffice && planned && <><button type="button" className="a-iconbtn" aria-label="Earlier" disabled={i === 0 || act.busy} onClick={() => move(i, -1)}><LIcon name="chevron-up" size="sm" /></button>
                <button type="button" className="a-iconbtn" aria-label="Later" disabled={i === keys.length - 1 || act.busy} onClick={() => move(i, 1)}><LIcon name="chevron-down" size="sm" /></button>
                <button type="button" className="a-iconbtn" aria-label="Take off" disabled={keys.length === 1 || act.busy} onClick={() => reorder(keys.filter((k) => k !== stopKey(s)))}><LIcon name="x" size="sm" /></button></>}
              {d.status === 'out' && s.status === 'pending' && <button type="button" className="a-btn a-btn-sm" onClick={() => setStop(s)}>Record</button>}
              {d.status === 'out' && s.status !== 'pending' && s.kind === 'delivery' && s.to_collect > 0 && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setStop({ ...s, cashOnly: true })}>Cash</button>}
            </td></tr>))}</tbody></table></div>
      {isOffice && planned && <div className="a-p16-endbox a-p20-solid"><b>Load an order</b>
        {packed.length ? <div className="a-p20-load"><select value={add} aria-label="Packed order for our vehicle" onChange={(e) => setAdd(e.target.value)}><option value="">Choose...</option>
          {packed.filter((o) => o.godown_id === d.godown_id).map((o) => <option key={o.order_no} value={o.order_no}>{o.order_no} · {o.customer} · {o.ship_town} · {o.cartons} boxes, {Number(o.weight_kg)} kg</option>)}</select>
          <button type="button" className="a-btn a-btn-sm" disabled={!add || act.busy} onClick={load}><LIcon name="plus" size="sm" />Load</button></div> : <p className="a-hint-s">No packed order for our vehicle at this godown.</p>}
        {pend > 0 && <p className="a-hint-s">Cash to collect on this trip: <b>{rs(pend)}</b>.</p>}</div>}
      {d.status === 'out' && isOffice && d.driver_emp !== d.me && <div className="a-p16-endbox a-p20-solid"><b>Close the trip</b>
        {openN ? <p className="a-hint-s">{openN} stop{openN === 1 ? ' is' : 's are'} not recorded yet.</p> : <>
          <p className="a-hint-s">Count the cash the driver hands in. Recorded at the stops: <b>{rs(collected)}</b>.</p>
          <div className="a-grid2"><In label="Cash handed in (Rs) *" type="number" min="0" step="1" value={end.cash_handed} onChange={(e) => setEnd({ ...end, cash_handed: e.target.value })} />
            {end.cash_handed !== '' && Math.abs(Number(end.cash_handed) - collected) > 0.005 && <In label={`Difference ${rs(Number(end.cash_handed) - collected)}: note *`} value={end.note} maxLength={255} onChange={(e) => setEnd({ ...end, note: e.target.value })} />}</div>
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy || end.cash_handed === ''} onClick={close}>Close trip</button></>}</div>}
      {d.status === 'ended' && <dl className="a-kv"><dt>Cash</dt><dd>recorded {rs(d.cash_collected)} · handed in {rs(d.cash_handed)}{Math.abs(Number(d.cash_handed) - Number(d.cash_collected)) > 0.005 && <b className="a-tbad"> · {Number(d.cash_handed) < Number(d.cash_collected) ? 'short' : 'over'} {rs(Math.abs(Number(d.cash_handed) - Number(d.cash_collected)))}</b>}</dd>{d.end_note && <><dt>Note</dt><dd>{d.end_note}</dd></>}</dl>}
      {stop && <StopDrawer trip={d} s={stop} onClose={() => setStop(null)} onSaved={() => { setStop(null); reload(); }} />}
    </div>
  );
}

const STOP_OUT = [['delivered', 'Delivered'], ['short', 'Delivered short'], ['refused', 'Refused'], ['failed', 'Not delivered']];
function StopDrawer({ trip, s, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const up = useUpload();
  const pickup = s.kind === 'pickup';
  const [f, setF] = useState({ st: s.cashOnly ? 'cash' : pickup ? 'picked_up' : 'delivered', by: '', signed: false, photo: null, otp: '', cash: s.to_collect ? String(r2(s.to_collect)) : '', cashWhy: '', why: '', note: '', kept: Object.fromEntries((s.on_board || []).map((l) => [l.sku_code, String(l.qty)])) });
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const path = (p) => `/commerce/stops/${s.stop_id}/${p}`;
  const cashIn = async (due) => {
    const want = Number(f.cash || 0);
    if (!(want > 0)) return 0;
    const amt = due === undefined ? want : Math.min(want, due);
    if (amt > 0) await api.send('POST', path('cash'), { amount: String(r2(amt)), why: f.cashWhy });
    if (due !== undefined && want > due + 0.005) toast('warn', `${rs(amt)} recorded`, `That is all that is due after what they did not keep (${rs(due)}).`);
    return amt;
  };
  const save = () => act.run(async () => {
    setErr({});
    try {
      if (f.st === 'cash') { await cashIn(); toast('good', 'Cash recorded', `${rs(f.cash)} for ${s.order_no}.`); onSaved(); return; }
      if (f.st === 'picked_up') {
        if (!f.photo) { setErr({ photo: 'A photo of the packs.' }); return; }
        await up.send('photo', path('picked-up'), f.photo, { receiver_name: f.by });
        toast('good', `${s.return_no} picked up`, 'Bring it to the godown.'); onSaved(); return;
      }
      if (f.st === 'delivered' || f.st === 'short') {
        const v = {};
        if (!f.by.trim()) v.receiver_name = 'Who took the goods?';
        if (!f.signed && !f.photo) v.proof = 'A signed slip or a photo is the proof.';
        if (s.to_collect && f.st === 'delivered' && Number(f.cash || 0) < s.to_collect - 0.005 && !f.cashWhy) v.cashWhy = `Cash is ${rs(s.to_collect - Number(f.cash || 0))} less than due. Choose why.`;
        if (Object.keys(v).length) { setErr(v); toast('bad', 'Check the stop', Object.values(v).join(' ')); return; }
        const fields = { receiver_name: f.by, otp: f.otp, signed: f.signed ? '1' : '0' };
        if (f.st === 'short') { fields.kept = JSON.stringify(Object.fromEntries(Object.entries(f.kept).map(([k, v]) => [k, Number(v)]))); fields.short_reason = f.why; }
        const r = f.photo ? await up.send('photo', path('delivered'), f.photo, fields) : await api.send('POST', path('delivered'), fields);
        const got = s.to_collect ? await cashIn(r.cash_due) : 0;
        toast(r.status === 'short' ? 'warn' : 'good', r.status === 'short' ? `${s.order_no} delivered short` : `${s.order_no} delivered`,
          `Received by ${f.by}.${r.back ? ` ${r.back.packs} pack${r.back.packs === 1 ? '' : 's'} back on the Returned shelf; credit note ${r.back.credit_note_no} (${rs(r.back.total)}).` : ''}${got ? ` Cash ${rs(got)}.` : ''}`);
        onSaved(); return;
      }
      if (f.st === 'refused') { const r = await api.send('POST', path('refused'), { reason: f.why }); toast('warn', `${s.order_no} refused`, r.back ? `${r.back.packs} packs back on the Returned shelf; credit note ${r.back.credit_note_no}.` : ''); onSaved(); return; }
      await api.send('POST', path('failed'), { reason: f.why, note: f.note });
      toast('info', `${stopKey(s)} not ${pickup ? 'collected' : 'delivered'}`, pickup ? f.why : `${f.why}. It goes back to Packed, waiting, still packed.`); onSaved();
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const whyList = f.st === 'failed' ? trip.failReasons : trip.refuseReasons;
  const opts = pickup ? [['picked_up', 'Picked up'], ['failed', 'Not collected']] : STOP_OUT;
  return (
    <Drawer title={`Stop ${s.seq}: ${s.customer}`} onClose={onClose} thumb={<LIcon name="map-pin" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy} onClick={save}>{up.is('photo') ? <UploadProgress state={up.state} /> : <><LIcon name="check" size="sm" />Save</>}</button></>}>
      {act.note}
      <dl className="a-kv"><dt>{pickup ? 'Return' : 'Order'}</dt><dd>{stopKey(s)} · {s.customer}</dd><dt>Address</dt><dd>{placeLine(s)}</dd>
        {pickup ? <><dt>Pick up</dt><dd>{s.pickup_items}</dd></> : <><dt>On board</dt><dd>{(s.on_board || []).map((l) => `${l.sku_code} ${l.qty}`).join(', ')}{s.cartons ? ` · ${s.cartons} boxes` : ''}</dd></>}
        {s.to_collect > 0 && <><dt>Collect</dt><dd><b>{money(s.to_collect)}</b> cash (pays on delivery)</dd></>}</dl>
      {f.st === 'cash' ? <div className="a-grid2"><In label="Cash collected (Rs) *" type="number" min="0" step="1" value={f.cash} onChange={set('cash')} />
        <In label="Why less than due" error={err.why}><select value={f.cashWhy} onChange={set('cashWhy')}><option value="">-</option>{trip.cashWhy.map((w) => <option key={w}>{w}</option>)}</select></In></div> : <>
        <In label="What happened *" wide><select value={f.st} onChange={set('st')}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></In>
        {['delivered', 'short', 'picked_up'].includes(f.st) && <div className="a-grid2">
          <In label={pickup ? 'Handed over by' : 'Received by *'} value={f.by} error={err.receiver_name} maxLength={60} placeholder={pickup ? '' : 'Name of the person who took the goods'} onChange={set('by')} />
          {!pickup && <div className="a-field"><span>Proof *</span><label className="a-chkrow a-p20-ctl"><input type="checkbox" checked={f.signed} onChange={set('signed')} /><span>Signed the packing slip</span></label>{err.proof && <small className="a-err">{err.proof}</small>}</div>}
          <In label={pickup ? 'Photo of the packs *' : 'Photo of the goods at the door'} error={err.photo} hint={pickup ? null : 'Optional when signed.'}><input type="file" accept="image/*" capture="environment" onChange={(e) => setF((v) => ({ ...v, photo: e.target.files[0] || null }))} /></In>
          {!pickup && trip.otpOn && <In label="OTP from the customer *" inputMode="numeric" maxLength={4} value={f.otp} onChange={set('otp')} />}
          {!pickup && s.to_collect > 0 && <In label="Cash collected (Rs) *" type="number" min="0" step="1" value={f.cash} hint={f.st === 'short' ? 'Delivered short: the due is worked out again from what they kept.' : null} onChange={set('cash')} />}
          {!pickup && s.to_collect > 0 && <In label="Why less than due" error={err.cashWhy || err.why} hint="Needed when the cash is less than due. The supervisor sees it at trip close."><select value={f.cashWhy} onChange={set('cashWhy')}><option value="">-</option>{trip.cashWhy.map((w) => <option key={w}>{w}</option>)}</select></In>}
        </div>}
        {f.st === 'short' && <><p className="a-hint-s">How many of each did they take? The rest comes back to the Returned shelf.</p>
          <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">On board</th><th className="a-num">Taken</th></tr></thead>
            <tbody>{(s.on_board || []).map((l) => <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} image={l.image} /></td><td className="a-num">{l.qty}</td>
              <td className="a-num"><input type="number" min="0" max={l.qty} step="1" className="a-p20-n" aria-label={`${l.sku_code} taken`} value={f.kept[l.sku_code]} onChange={(e) => setF((v) => ({ ...v, kept: { ...v.kept, [l.sku_code]: e.target.value } }))} /></td></tr>)}</tbody></table></div></>}
        {['short', 'refused', 'failed'].includes(f.st) && <In label="Why *" error={err.short_reason || err.reason}><select value={f.why} onChange={set('why')}><option value="">Choose...</option>{whyList.map((w) => <option key={w}>{w}</option>)}</select></In>}
        {f.st === 'failed' && <In label="Note" value={f.note} maxLength={50} onChange={set('note')} />}
      </>}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------- Courier and pickup
export function CourierPickup() {
  const data = useLoad('/commerce/delivery');
  const pod = useLoad('/fulfil/pod');
  const [tab, setTab] = useState('book');
  const [form, setForm] = useState(null);
  const d = data.data;
  const lists = d ? {
    book: d.orders.filter((o) => o.delivery_kind === 'courier' && o.status === 'packed'), with: d.orders.filter((o) => o.status === 'with_courier'),
    pickup: d.orders.filter((o) => o.delivery_kind === 'pickup' && o.status === 'packed'), done: pod.data ? pod.data.rows.filter((r) => r.how !== 'trip') : [],
  } : {};
  const TABS = [['book', 'Courier to book'], ['with', 'With the courier'], ['pickup', 'Pickup ready'], ['done', 'Done']];
  const cols = [
    { key: 'order_no', label: 'Order', render: (o) => <><b className="a-mono">{o.order_no}</b><small className="a-muted a-p15-sub">{o.godown_code}</small></> },
    { key: 'customer', label: 'Customer', render: (o) => o.customer },
    { key: 'addr', label: 'Address', hideSm: true, render: (o) => placeLine(o) },
    { key: 'cartons', label: 'Boxes', num: true, render: (o) => (o.cartons ? <>{o.cartons}<small className="a-muted a-p15-sub">{Number(o.weight_kg)} kg</small></> : '-') },
    { key: 'c', label: tab === 'with' ? 'Courier' : 'Ordered', render: (o) => (tab === 'with' ? <>{o.courier}<small className="a-muted a-p15-sub">{o.tracking_link ? <a href={o.tracking_link} target="_blank" rel="noreferrer">AWB {o.awb_no}</a> : `AWB ${o.awb_no}`}</small></> : String(o.created_at || '').slice(0, 10)) },
    { key: 'act', label: '', render: (o) => (tab === 'book' ? <button type="button" className="a-btn a-btn-sm" onClick={() => setForm({ o, kind: 'courier' })}>Book courier</button>
      : tab === 'with' ? <span className="a-p18-nowrap"><button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setForm({ o, kind: 'courier_done' })}>Delivered</button> <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setForm({ o, kind: 'courier_back' })}>Came back</button></span>
        : <button type="button" className="a-btn a-btn-sm" onClick={() => setForm({ o, kind: 'pickup' })}>Collected</button>) },
  ];
  const dcols = [
    { key: 'order_no', label: 'Order', render: (r) => <b className="a-mono">{r.order_no}</b> }, { key: 'customer', label: 'Customer', render: (r) => r.customer },
    { key: 'how', label: 'How', render: (r) => (r.how === 'courier' ? `Courier${r.driver ? ` · ${r.driver}` : ''}` : 'Pickup') }, { key: 'by', label: 'Received by', render: (r) => r.receiver_name || '-' },
    { key: 'at', label: 'When', render: (r) => at(r.done_at) }, { key: 'st', label: 'Status', render: () => <Pill tone="good">Delivered</Pill> },
  ];
  return (
    <section>
      <PageHead sub="By courier, or the customer collects" rules={['Book the courier with the AWB number', 'Track and mark delivered', 'The customer collects with a name and phone']} />
      <Loading state={data}>{d && <>
        <Tabs label="Courier and pickup" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: (lists[k] || []).length }))} />
        <div className="a-listcard">{tab === 'done' ? <Table columns={dcols} rows={lists.done} rowKey={(r, i) => `${r.order_no}${i}`} label="Done" empty={{ icon: 'send', title: 'Nothing here', text: 'No order in this list.' }} />
          : <Table columns={cols} rows={lists[tab]} rowKey={(o) => o.order_no} label={TABS.find((x) => x[0] === tab)[1]} empty={{ icon: 'send', title: 'Nothing here', text: 'No order in this list.' }} />}</div>
      </>}</Loading>
      {form && <CourierForm d={d} form={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); data.reload(); pod.reload(); }} />}
    </section>
  );
}
function CourierForm({ d, form, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const o = form.o;
  const [f, setF] = useState({ courier_id: d.couriers[0] ? String(d.couriers[0].courier_id) : '', awb_no: '', eway_bill_no: '', receiver_name: '', phone: '', cash: o.payment_terms === 'cod' && o.amount_due > 0 ? String(o.amount_due) : '', signed: false });
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const c = d.couriers.find((x) => String(x.courier_id) === f.courier_id);
  const est = c && c.per_kg !== null && c.per_kg !== undefined ? Math.max(Number(c.min_charge || 0), Math.round(Number(c.per_kg) * Number(o.weight_kg || 0))) : null;
  const due = o.payment_terms === 'cod' && o.amount_due > 0 ? o.amount_due : 0;
  const save = () => act.run(async () => {
    setErr({});
    try {
      if (form.kind === 'courier') { await api.send('POST', `/commerce/orders/${o.order_no}/courier`, f); toast('good', `${o.order_no} booked`, `${c ? c.name : 'Courier'}, AWB ${f.awb_no.toUpperCase()}.`); }
      else if (form.kind === 'courier_done') { await api.send('POST', `/commerce/orders/${o.order_no}/courier-delivered`, { receiver_name: f.receiver_name }); toast('good', `${o.order_no} delivered`, ''); }
      else if (form.kind === 'courier_back') { const r = await api.send('POST', `/commerce/orders/${o.order_no}/courier-back`, { reason: f.receiver_name }); toast('warn', `${o.order_no} came back`, `${r.back.packs} packs are on the Returned shelf; credit note ${r.back.credit_note_no}. The order is Refused at delivery.`); }
      else {
        if (!/^\+?[\d\s-]{10,16}$/.test(f.phone.trim())) { setErr({ phone: '10 digits.' }); return; }
        const r = await api.send('POST', `/commerce/orders/${o.order_no}/picked-up`, { receiver_name: f.receiver_name, phone: f.phone, signed: f.signed ? '1' : '0', cash: due ? f.cash : '' });
        toast('good', `${o.order_no} collected`, `By ${f.receiver_name}${due && Number(f.cash) ? `; cash ${rs(f.cash)}` : ''}.${r.stranger_phone ? ` The phone is not one of ${o.customer}'s contacts; it is noted.` : ''}`);
      }
      onSaved();
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const title = { courier: `Book courier for ${o.order_no}`, courier_done: `Delivered: ${o.order_no}`, courier_back: `Came back: ${o.order_no}`, pickup: `Collected: ${o.order_no}` }[form.kind];
  return (
    <Drawer title={title} onClose={onClose} thumb={<LIcon name={form.kind === 'pickup' ? 'user-check' : 'send'} />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />{form.kind === 'courier' ? 'Booked' : form.kind === 'pickup' ? 'Collected' : form.kind === 'courier_back' ? 'Came back' : 'Delivered'}</button></>}>
      {act.note}
      <dl className="a-kv"><dt>Order</dt><dd>{o.order_no} · {o.customer}</dd><dt>To</dt><dd>{placeLine(o)}</dd><dt>Boxes</dt><dd>{o.cartons ? `${o.cartons} · ${Number(o.weight_kg)} kg` : '-'}</dd>
        {form.kind === 'pickup' && due > 0 && <><dt>Collect</dt><dd><b>{money(due)}</b> cash</dd></>}</dl>
      {form.kind === 'courier' && <div className="a-grid2">
        <In label="Courier *"><select value={f.courier_id} onChange={set('courier_id')}>{d.couriers.map((x) => <option key={x.courier_id} value={x.courier_id}>{x.name}{x.per_kg !== null && x.per_kg !== undefined ? ` · Rs ${Number(x.per_kg)}/kg, min Rs ${Number(x.min_charge || 0)}` : ''}</option>)}</select></In>
        <In label="AWB / docket number *" value={f.awb_no} maxLength={40} onChange={set('awb_no')} />
        <In label={`E-way bill no.${d.eway.required && o.total > d.eway.above ? ' *' : ' (if any)'}`} inputMode="numeric" maxLength={12} value={f.eway_bill_no} onChange={set('eway_bill_no')} />
        <div className="a-field"><span>Courier charge to us</span><p className="a-p20-ro">{est !== null ? `About ${rs(est)}` : '-'}<small className="a-muted a-p15-sub">From the weight and the courier&apos;s rate (Masters &gt; Couriers); not saved.</small></p></div>
      </div>}
      {form.kind === 'courier_done' && <In label="Received by (optional)" value={f.receiver_name} onChange={set('receiver_name')} />}
      {form.kind === 'courier_back' && <><Alert tone="warn" title="Every pack comes back.">They go to the Returned shelf (Returns judges them) with a credit note; the order is Refused at delivery.</Alert>
        <In label="Why (optional)" value={f.receiver_name} maxLength={120} placeholder="e.g. Customer refused the parcel" onChange={set('receiver_name')} /></>}
      {form.kind === 'pickup' && <div className="a-grid2">
        <In label="Collected by *" value={f.receiver_name} maxLength={60} onChange={set('receiver_name')} />
        <In label="Their phone *" inputMode="tel" value={f.phone} error={err.phone} hint="Checked against the customer's contacts." onChange={set('phone')} />
        {due > 0 && <In label="Cash received (Rs)" type="number" min="0" step="1" value={f.cash} error={err.cash} onChange={set('cash')} />}
        <div className="a-field"><span>Proof</span><label className="a-chkrow a-p20-ctl"><input type="checkbox" checked={f.signed} onChange={set('signed')} /><span>Signed the packing slip</span></label></div>
      </div>}
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------------------------ Proof of delivery
export function ProofOfDelivery() {
  const data = useLoad('/fulfil/pod');
  const act = useAction();
  const toast = useToast();
  const d = data.data;
  const rows = d ? d.rows.filter((r) => r.status === 'delivered') : [];
  const miss = rows.filter((r) => (r.how === 'trip' ? !r.signed && !r.has_photo : !r.receiver_name)).length;
  const photo = (r) => act.run(async () => { if (!(await api.open(`/commerce/stops/${r.stop_id}/photo`))) toast('bad', 'Allow pop-ups', 'Allow pop-ups to see the photo.'); });
  const cols = [
    { key: 'order_no', label: 'Order', render: (r) => <><b className="a-mono">{r.order_no}</b>{r.kept && <small className="a-p15-sub"><Pill tone="warn">Short</Pill></small>}</> },
    { key: 'customer', label: 'Customer', render: (r) => r.customer },
    { key: 'how', label: 'How', render: (r) => (r.how === 'trip' ? `Trip T-${r.trip_id}` : r.how === 'courier' ? 'Courier' : 'Pickup') },
    { key: 'by', label: 'Received by', render: (r) => r.receiver_name || '-' },
    { key: 'at', label: 'When', render: (r) => at(r.done_at) },
    { key: 'proof', label: 'Proof', render: (r) => { if (r.how !== 'trip') return r.receiver_name ? <Pill>Name</Pill> : <Pill tone="bad">None</Pill>; const p = [r.signed && 'Signed', r.has_photo && 'Photo'].filter(Boolean); return p.length ? <>{r.has_photo ? <button type="button" className="a-link" onClick={() => photo(r)}><Pill tone="good">{p.join(' + ')}</Pill></button> : <Pill tone="good">{p.join(' + ')}</Pill>}</> : <Pill tone="bad">None</Pill>; } },
  ];
  return (
    <section>
      <PageHead sub="Signature or photo when delivered" rules={['Who received it, when', 'Signed slip or a photo', 'Kept for disputes']} />
      {act.note}
      <Loading state={data}>{d && <>
        {miss > 0 && <Alert tone="warn" title={`${miss} deliver${miss === 1 ? 'y has' : 'ies have'} no signature or photo.`}>Ask the driver for the signed slip.</Alert>}
        <div className="a-listcard"><Table columns={cols} rows={rows} rowKey={(r, i) => `${r.order_no}${r.stop_id || ''}${i}`} label="Proof of delivery" empty={{ icon: 'file-check', title: 'No delivery yet', text: 'Proof shows here once a stop is recorded.' }} /></div>
      </>}</Loading>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ Failed / short / refused
export function FailedShort() {
  const data = useLoad('/fulfil/failed');
  const act = useAction();
  const toast = useToast();
  const [ret, setRet] = useState(null);
  const d = data.data;
  const again = (no) => act.run(async () => { await api.send('POST', `/commerce/orders/${no}/reattempt`); toast('good', `${no} is ready for the next trip`, 'It is in Packed, waiting.'); data.reload(); });
  const cols = [
    { key: 'order_no', label: 'Order', render: (r) => <><b className="a-mono">{r.order_no}</b><small className="a-muted a-p15-sub">Trip T-{r.trip_id} · {at(r.done_at)}</small></> },
    { key: 'customer', label: 'Customer', render: (r) => r.customer },
    { key: 'kind', label: 'What happened', render: (r) => stopPill({ status: r.kind === 'short' ? 'delivered' : r.kind, not_kept: r.kind === 'short' }) },
    { key: 'why', label: 'Why', render: (r) => String(r.failed_reason || '-').replace(/^(Short|Refused): /, '') },
    { key: 'goods', label: 'The goods', render: (r) => (r.kind === 'failed' ? (r.order_status === 'failed' ? <>Still packed<small className="a-p15-sub">
      <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => again(r.order_no)}>Re-attempt</button> <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setRet(r)}>Return to godown</button></small></> : r.order_status === 'packed' ? 'Still packed, in Packed, waiting: plan it again' : r.order_status)
      : <>{Object.values(r.back || {}).reduce((a, n) => a + Number(n), 0)} packs on the Returned shelf at {r.godown}{r.credit_note_no && <small className="a-muted a-p15-sub">{r.return_no} · credit note {r.credit_note_no} ({money(r.credit)})</small>}</>) },
  ];
  return (
    <section>
      <PageHead sub="Deliveries that went wrong" rules={['Not delivered: back to Packed, waiting, still packed', 'Refused or short: goods on the Returned shelf', 'Returns judges them']} />
      {act.note}
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.stop_id} label="Failed, short and refused" empty={{ icon: 'circle-check', title: 'Nothing went wrong', text: 'Failed, short and refused deliveries show here.' }} /></div>}</Loading>
      {ret && <ReturnToGodown r={ret} onClose={() => setRet(null)} onSaved={() => { setRet(null); data.reload(); }} />}
    </section>
  );
}
function ReturnToGodown({ r, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const [why, setWhy] = useState('');
  const save = () => act.run(async () => { await api.send('POST', `/commerce/orders/${r.order_no}/return-to-godown`, { reason: why }); toast('good', `${r.order_no} returned to the godown`, 'Goods back in stock, invoice cancelled with a credit note.'); onSaved(); });
  return (
    <Drawer title={`Return ${r.order_no} to the godown`} onClose={onClose} thumb={<LIcon name="undo-2" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={save}>Return to godown</button></>}>
      {act.note}
      <Alert tone="warn" title="The order is cancelled.">The goods come back into stock (same batches) and the invoice is cancelled with a credit note.</Alert>
      <In label="Why *" value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} />
    </Drawer>
  );
}

// --------------------------------------------------------------------------------------------------- Cash on delivery
export function CashOnDelivery() {
  const data = useLoad('/fulfil/cod');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const cols = [
    { key: 'trip', label: 'Trip', render: (t) => <><b className="a-mono">T-{t.trip_id}</b><small className="a-muted a-p15-sub">{t.trip_date}</small></> },
    { key: 'driver', label: 'Driver', render: (t) => t.driver },
    { key: 'due', label: 'To collect', num: true, render: (t) => money(t.cash_expected || 0) },
    { key: 'got', label: 'Collected', num: true, render: (t) => (t.cash_collected === null ? '-' : <>{money(t.cash_collected)}{Number(t.cash_collected) < Number(t.cash_expected || 0) - 0.005 && <small className="a-p15-sub a-tbad">{money(Number(t.cash_expected) - Number(t.cash_collected))} left on account</small>}</>) },
    { key: 'in', label: 'Handed in', num: true, render: (t) => (t.cash_handed === null ? '-' : money(t.cash_handed)) },
    { key: 'short', label: 'Short', num: true, render: (t) => (t.difference && t.difference < 0 ? <b className="a-tbad">{money(-t.difference)}</b> : '-') },
    { key: 'st', label: 'Status', render: tripPill },
  ];
  return (
    <section>
      <PageHead sub="Cash from drivers, handed in and checked" rules={['Cash customers pay on delivery', 'The driver hands it in at trip close', 'Short cash is flagged']} />
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.trips} rowKey={(t) => t.trip_id} label="Cash on delivery" onRowClick={(t) => setOpen(t.trip_id)} empty={{ icon: 'banknote', title: 'No cash on delivery', text: "Cash customers' orders show here once on a trip." }} /></div>}</Loading>
      {open && <Drawer title={`Trip T-${open}`} onClose={() => { setOpen(null); data.reload(); }} thumb={<LIcon name="truck" />} wide footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={() => setOpen(null)}>Close</button></>}>
        <TripBody id={open} office onChanged={data.reload} /></Drawer>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------------------- My trips
/** My trips: the trips of the driver linked to this admin user (Masters > Vehicles and drivers) */
export function MyTrips() {
  const data = useLoad('/commerce/my-trips');
  const [open, setOpen] = useState(null);
  const d = data.data;
  return (
    <section className="a-mytrips">
      <PageHead title="My trips" sub="Your trips: record each stop and the cash collected." />
      <Loading state={data}>{d && (
        !d.driver ? <Alert tone="warn" title="Not linked yet.">Your user is not linked to a driver yet: an Admin links it in Masters &gt; Vehicles and drivers.</Alert> : open ? (
          <><button type="button" className="a-btn a-btn-ghost" onClick={() => { setOpen(null); data.reload(); }}><LIcon name="chevron-left" size="sm" />Back to my trips</button><TripBody id={open} onChanged={data.reload} /></>
        ) : (
          <><p className="a-muted">{d.driver}</p>
            {d.trips.map((t) => <button key={t.trip_id} type="button" className="a-tripcard" onClick={() => setOpen(t.trip_id)}><b>Trip T-{t.trip_id}</b> {tripPill(t)}<span className="a-muted">{t.trip_date} · {t.vehicle} · {t.done} of {t.stops} stops done</span></button>)}
            {!d.trips.length && <p className="a-muted">No trip for you today.</p>}</>
        ))}</Loading>
    </section>
  );
}
