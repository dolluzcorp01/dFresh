// Fulfilment > Delivery (office, "create" on Delivery) and My trips (drivers, phone first). API /commerce/delivery,
// /commerce/trips, /commerce/stops, /commerce/my-trips; logic in src/backend_routes/delivery.js.
// Office tabs: Ready (packed own-vehicle orders by area: tick them, choose vehicle and driver = a trip), Trips (route
// order, trip sheet with the cash to collect, Start trip = Out for delivery, then the stops as the driver sees them),
// Courier (AWB and e-way bill no. = Handed to courier; tracking link; Delivered), Pickup (collected), Failed (re-attempt
// on a next trip, or return to the godown).
// The trip view (both): per stop Delivered (receiver name, photo, OTP when the setting is on), Failed (reason) and Cash
// collected (a cash payment on the order); End trip compares the cash collected with the cash handed over.
// Return pickups (phase 6): returns collected on a trip wait in Ready next to the packed orders; on the trip they are
// stops of their own (DFR no.), marked Picked up with a photo (required) or Failed.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useLoad, useUpload, UploadProgress } from './ui';
import { barcodeSvg, esc, printPage, rs } from './printKit';

/** street, town PIN without a dangling comma when a part is empty (a customer made from a lead has no street yet) */
const placeLine = (x) => [x.ship_address, [x.ship_town, x.ship_pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : '');
const TRIP = { planned: ['Planned', 'a-ap-pending'], out: ['Out for delivery', 'a-ostatus-dispatched'], ended: ['Ended', 'a-ap-approved'] };
const STOP = { pending: ['To deliver', 'a-ap-pending'], delivered: ['Delivered', 'a-ap-approved'], failed: ['Failed', 'a-ap-rejected'], picked_up: ['Picked up', 'a-ap-approved'] };
const stopKey = (s) => (s.kind === 'pickup' ? s.return_no : s.order_no);

function printTripSheet(t) {
  const rows = t.stops.map((s) => `<tr><td class="n"><b>${s.seq}</b></td><td>${barcodeSvg(stopKey(s), { height: 26, width: 1.1, fontSize: 10 })}</td>
    <td>${s.kind === 'pickup' ? `<b>PICK UP (return)</b> ${esc(s.pickup_items || '')}<br>` : ''}<b>${esc(s.customer)}</b><br>${esc(s.ship_name)}<br>${esc(placeLine(s))}<br>${esc(s.ship_phone || '')}</td>
    <td class="n">${s.kind === 'pickup' ? '-' : s.cartons || '-'}</td><td class="n">${s.to_collect > 0 ? `<b>${rs(s.to_collect)}</b>` : '<span class="muted">-</span>'}</td>
    ${t.otpOn ? `<td>${esc(s.otp || '')}</td>` : ''}<td style="width:30mm"></td></tr>`).join('');
  return printPage({
    title: `Trip sheet T-${t.trip_id}`,
    body: `<div class="row"><div><h1>Trip sheet T-${t.trip_id}</h1>${day(t.trip_date)} · ${esc(t.area || 'mixed areas')}</div>
      <div>Vehicle <b>${esc(t.vehicle)}</b> ${esc(t.vehicle_type || '')}<br>Driver <b>${esc(t.driver)}</b> ${esc(t.driver_phone || '')}</div></div>
      <table><thead><tr><th class="n">#</th><th>Order</th><th>Deliver to</th><th class="n">Cartons</th><th class="n">Collect (COD)</th>${t.otpOn ? '<th>OTP</th>' : ''}<th>Received by / sign</th></tr></thead><tbody>${rows}</tbody></table>
      <p><b>Cash to collect: ${rs(t.stops.reduce((a, s) => a + s.to_collect, 0))}</b> · Cash handed over: ______________ · Checked by: ______________</p>`,
  });
}

/** one trip as its driver sees it (cards, phone first); the office also gets route order, Start, trip sheet */
export function TripView({ id, onChanged }) {
  const t = useLoad(`/commerce/trips/${id}`);
  const canEdit = useCan('delivery', 'edit');
  const act = useAction();
  const up = useUpload();
  const [form, setForm] = useState(null); // { stop, kind: delivered | failed | cash, ... }
  const [order, setOrder] = useState(null); // planned: route order
  const [end, setEnd] = useState({ cash_handed: '', note: '' });
  const d = t.data;
  const reload = () => { t.reload(); if (onChanged) onChanged(); };
  const seq = order || (d ? d.stops.map(stopKey) : []);
  const move = (i, by) => setOrder(() => { const a = [...seq]; const [x] = a.splice(i, 1); a.splice(i + by, 0, x); return a; });
  const saveOrder = () => act.run(async () => { await api.send('PUT', `/commerce/trips/${id}/stops`, { stops: seq }); setOrder(null); reload(); }, 'Route order saved');
  const start = () => act.run(async () => { const r = await api.send('POST', `/commerce/trips/${id}/start`); reload(); act.setMsg({ kind: 'ok', text: `Trip T-${id} started: out for delivery, ${rs(r.cash_expected)} to collect.` }); });
  const submit = () => act.run(async () => {
    const s = form.stop;
    if (form.kind === 'delivered') {
      const fields = { receiver_name: form.receiver_name || '', otp: form.otp || '' };
      if (form.photo) await up.send('photo', `/commerce/stops/${s.stop_id}/delivered`, form.photo, fields);
      else await api.send('POST', `/commerce/stops/${s.stop_id}/delivered`, fields);
    } else if (form.kind === 'picked_up') {
      await up.send('photo', `/commerce/stops/${s.stop_id}/picked-up`, form.photo, { receiver_name: form.receiver_name || '' });
    } else if (form.kind === 'failed') await api.send('POST', `/commerce/stops/${s.stop_id}/failed`, { reason: form.reason, note: form.note });
    else await api.send('POST', `/commerce/stops/${s.stop_id}/cash`, { amount: form.amount });
    setForm(null); reload();
    act.setMsg({ kind: 'ok', text: form.kind === 'delivered' ? `${s.order_no} delivered to ${form.receiver_name}${form.photo ? ' (photo saved)' : ''}.` : form.kind === 'picked_up' ? `${s.return_no} picked up (photo saved): bring it to the godown.`
      : form.kind === 'failed' ? `${stopKey(s)}: ${s.kind === 'pickup' ? 'pickup' : 'delivery'} failed (${form.reason}).` : `Cash ${rs(form.amount)} collected for ${s.order_no}.` });
  });
  const endTrip = () => act.run(async () => { const r = await api.send('POST', `/commerce/trips/${id}/end`, end); reload(); act.setMsg({ kind: 'ok', text: `Trip T-${id} ended: collected ${rs(r.cash_collected)}, handed over ${rs(r.cash_handed)}${r.difference ? `, difference ${rs(r.difference)}` : ''}.` }); });
  const photo = (s) => act.run(async () => { if (!(await api.open(`/commerce/stops/${s.stop_id}/photo`))) act.setMsg({ kind: 'error', text: 'Allow pop-ups to see the photo.' }); });
  const collected = d ? d.stops.reduce((a, s) => a + s.cash_collected, 0) : 0;
  const open = d ? d.stops.filter((s) => s.status === 'pending').length : 0;
  return (
    <Loading state={t}>
      {d && (
        <div className="a-trip">
          {act.note}
          <div className="a-trip-head">
            <div><b>Trip T-{d.trip_id}</b> · {day(d.trip_date)} <span className={`a-status ${TRIP[d.status][1]}`}>{TRIP[d.status][0]}</span></div>
            <div className="a-muted">{d.vehicle} · {d.driver} {d.driver_phone && <a href={`tel:${d.driver_phone.replace(/\s/g, '')}`}>{d.driver_phone}</a>}{d.area ? ` · ${d.area}` : ''}</div>
            <div className="a-trip-cash">To collect <b>{rs(d.cash_expected ?? d.stops.reduce((a, s) => a + s.to_collect, 0))}</b> · collected <b>{rs(collected)}</b>{d.status === 'ended' ? <> · handed over <b>{rs(d.cash_handed)}</b></> : null}</div>
          </div>
          {d.office && (
            <div className="a-toolbar">
              <button type="button" className="a-btn a-btn-ghost" onClick={() => { if (!printTripSheet(d)) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print.' }); }}>Trip sheet</button>
              {d.status === 'planned' && order && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={saveOrder}>Save route order</button>}
              {d.status === 'planned' && canEdit && <button type="button" className="a-btn" disabled={act.busy || Boolean(order)} onClick={start}>Start trip</button>}
            </div>
          )}
          {!d.office && d.status === 'planned' && canEdit && <button type="button" className="a-btn a-btn-block" disabled={act.busy} onClick={start}>Start trip</button>}
          <ol className="a-stops">
            {(d.status === 'planned' && order ? order.map((no) => d.stops.find((s) => stopKey(s) === no)) : d.stops).map((s, i) => (
              <li key={s.stop_id} className={`a-stop a-stop-${s.status}${s.kind === 'pickup' ? ' a-stop-pickup' : ''}`}>
                <div className="a-stop-head"><b>{i + 1}. {s.customer}</b><span className={`a-status ${STOP[s.status][1]}`}>{s.kind === 'pickup' && s.status === 'pending' ? 'To pick up' : STOP[s.status][0]}</span></div>
                {s.kind === 'pickup' && <div className="a-pickup-what"><b>Return pickup</b> {s.pickup_items}</div>}
                <div>{s.ship_name !== s.customer ? `${s.ship_name}, ` : ''}{placeLine(s)}</div>
                <div className="a-stop-meta">
                  {s.kind === 'pickup' ? <><code>{s.return_no}</code> (order {s.order_no})</> : <><code>{s.order_no}</code> · {s.cartons || '-'} carton(s)</>}
                  {s.ship_phone && <> · <a href={`tel:${s.ship_phone.replace(/\s/g, '')}`}>{s.ship_phone}</a></>}
                  {s.to_collect > 0 && <> · <b className="a-collect">Collect {rs(s.to_collect)}</b></>}{s.cash_collected > 0 && <> · collected {rs(s.cash_collected)}</>}
                  {d.office && s.otp && <> · OTP {s.otp}</>}
                </div>
                {s.status === 'delivered' && <div className="a-muted">Received by {s.receiver_name} · {fmtDate(s.done_at)}{s.has_photo && <> · <button type="button" className="a-link" onClick={() => photo(s)}>photo</button></>}</div>}
                {s.status === 'picked_up' && <div className="a-muted">Picked up{s.receiver_name ? ` from ${s.receiver_name}` : ''} · {fmtDate(s.done_at)}{s.has_photo && <> · <button type="button" className="a-link" onClick={() => photo(s)}>photo</button></>}</div>}
                {s.status === 'failed' && <div className="a-bad">Failed: {s.failed_reason} · {fmtDate(s.done_at)}</div>}
                {d.status === 'planned' && d.office && (
                  <span className="a-row">
                    <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={i === 0} aria-label={`Move ${stopKey(s)} up`} onClick={() => move(i, -1)}>Up</button>
                    <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={i === seq.length - 1} aria-label={`Move ${stopKey(s)} down`} onClick={() => move(i, 1)}>Down</button>
                  </span>
                )}
                {d.status === 'out' && canEdit && s.status === 'pending' && (!form || form.stop.stop_id !== s.stop_id) && (
                  <div className="a-stop-actions">
                    {s.kind === 'pickup' ? <button type="button" className="a-btn" onClick={() => setForm({ stop: s, kind: 'picked_up', receiver_name: '', photo: null })}>Picked up</button>
                      : <button type="button" className="a-btn" onClick={() => setForm({ stop: s, kind: 'delivered', receiver_name: '', otp: '', photo: null })}>Delivered</button>}
                    <button type="button" className="a-btn a-btn-ghost" onClick={() => setForm({ stop: s, kind: 'failed', reason: d.failReasons[0], note: '' })}>Failed</button>
                    {s.to_collect > 0 && <button type="button" className="a-btn a-btn-ghost" onClick={() => setForm({ stop: s, kind: 'cash', amount: String(Math.max(s.to_collect, 0).toFixed(2)) })}>Cash collected</button>}
                  </div>
                )}
                {d.status === 'out' && canEdit && s.status !== 'pending' && s.to_collect > 0 && (!form || form.stop.stop_id !== s.stop_id) && (
                  <div className="a-stop-actions"><button type="button" className="a-btn a-btn-ghost" onClick={() => setForm({ stop: s, kind: 'cash', amount: String(s.to_collect.toFixed(2)) })}>Cash collected</button></div>
                )}
                {form && form.stop.stop_id === s.stop_id && (
                  <div className="a-stop-form">
                    {form.kind === 'delivered' && (
                      <>
                        <label className="a-field"><span>Received by (name)</span><input value={form.receiver_name} aria-label="Received by" onChange={(e) => setForm({ ...form, receiver_name: e.target.value })} /></label>
                        <label className="a-field"><span>Photo (optional)</span><input type="file" accept="image/*" capture="environment" aria-label="Delivery photo" onChange={(e) => setForm({ ...form, photo: e.target.files[0] || null })} /></label>
                        {d.otpOn && <label className="a-field"><span>OTP from the customer</span><input inputMode="numeric" maxLength={4} value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value })} /></label>}
                      </>
                    )}
                    {form.kind === 'picked_up' && (
                      <>
                        <label className="a-field"><span>Photo of the packs (required)</span><input type="file" accept="image/*" capture="environment" aria-label="Pickup photo" onChange={(e) => setForm({ ...form, photo: e.target.files[0] || null })} /></label>
                        <label className="a-field"><span>Handed over by (name, optional)</span><input value={form.receiver_name} aria-label="Handed over by" onChange={(e) => setForm({ ...form, receiver_name: e.target.value })} /></label>
                      </>
                    )}
                    {form.kind === 'failed' && (
                      <>
                        <label className="a-field"><span>Why</span><select value={form.reason} aria-label="Failed reason" onChange={(e) => setForm({ ...form, reason: e.target.value })}>{d.failReasons.map((r) => <option key={r}>{r}</option>)}</select></label>
                        <label className="a-field"><span>Note (optional)</span><input value={form.note} maxLength={50} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                      </>
                    )}
                    {form.kind === 'cash' && <label className="a-field"><span>Cash received (Rs)</span><input inputMode="decimal" value={form.amount} aria-label="Cash received" onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>}
                    <span className="a-row">
                      <button type="button" className={`a-btn${form.kind === 'failed' ? ' a-btn-danger' : ''}`} disabled={act.busy || (form.kind === 'picked_up' && !form.photo)} onClick={submit}>{up.is('photo') ? <UploadProgress state={up.state} /> : form.kind === 'delivered' ? 'Save delivered' : form.kind === 'picked_up' ? 'Save picked up' : form.kind === 'failed' ? 'Save failed' : 'Save cash'}</button>
                      <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setForm(null)}>Cancel</button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {d.status === 'out' && canEdit && (
            <div className="a-card a-endtrip">
              <h3>End trip</h3>
              {open > 0 ? <p className="a-muted">{open} stop(s) still to mark delivered, picked up or failed.</p> : (
                <>
                  <p>Cash collected on this trip: <b>{rs(collected)}</b></p>
                  <label className="a-field"><span>Cash handed over (Rs)</span><input inputMode="decimal" value={end.cash_handed} aria-label="Cash handed over" onChange={(e) => setEnd({ ...end, cash_handed: e.target.value })} /></label>
                  {end.cash_handed !== '' && Math.abs(Number(end.cash_handed) - collected) > 0.005 && (
                    <label className="a-field"><span>Difference {rs(Number(end.cash_handed) - collected)}: note (required)</span><input value={end.note} maxLength={255} onChange={(e) => setEnd({ ...end, note: e.target.value })} /></label>
                  )}
                  <button type="button" className="a-btn a-btn-block" disabled={act.busy || end.cash_handed === ''} onClick={endTrip}>End trip</button>
                </>
              )}
            </div>
          )}
          {d.status === 'ended' && d.end_note && <Notice kind="info">Note at the end: {d.end_note}</Notice>}
        </div>
      )}
    </Loading>
  );
}

export default function CommerceDelivery() {
  const data = useLoad('/commerce/delivery');
  const act = useAction();
  const [tab, setTab] = useState('ready');
  const [sel, setSel] = useState([]);
  const [selRet, setSelRet] = useState([]);
  const [trip, setTrip] = useState({ vehicle_id: '', driver_id: '' });
  const [openTrip, setOpenTrip] = useState(null);
  const [form, setForm] = useState(null); // { order, kind: courier | courier_done | pickup | reattempt | return }
  const d = data.data;
  const orders = d ? d.orders : [];
  const ready = orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'own');
  const pickups = d ? d.pickups : [];
  const lists = {
    ready: [...ready, ...pickups], trips: d ? d.trips : [], courier: orders.filter((o) => (o.status === 'packed' && o.delivery_kind === 'courier') || o.status === 'with_courier'),
    pickup: orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'pickup'), failed: orders.filter((o) => o.status === 'failed'),
  };
  lists.other = [...lists.courier, ...lists.pickup]; // one tab: courier and customer pickup (the orders that do not go on a trip)
  const areas = [...new Set(ready.map((o) => o.area || 'No area'))];
  const create = () => act.run(async () => {
    const chosen = ready.filter((o) => sel.includes(o.order_no));
    const areaIds = [...new Set(chosen.map((o) => o.delivery_area_id))];
    const r = await api.send('POST', '/commerce/trips', { ...trip, order_nos: sel, return_nos: selRet, area_id: areaIds.length === 1 ? areaIds[0] : null });
    setSel([]); setSelRet([]); data.reload(); setOpenTrip(r.trip_id);
  });
  const act2 = (path, body, text) => act.run(async () => { await api.send('POST', path, body); setForm(null); data.reload(); }, text);
  return (
    <section>
      <h1>Delivery</h1>
      <InfoCard title="Trips, couriers and pickups">
        <ul>
          <li>Ready: packed orders for our own vehicle, by area, and returns to pick up. Tick them, choose the vehicle and the driver: a trip. Start trip = the goods leave the godown (stock out, tax invoice).</li>
          <li>The driver marks each stop on the phone (My trips): delivered with the receiver&apos;s name and a photo, or failed with the reason, and the cash collected.</li>
          <li>Courier: the AWB number (and the e-way bill number above the setting amount) hands it over. Failed: re-attempt on a next trip, or return to the godown.</li>
        </ul>
      </InfoCard>
      {act.note}
      <div className="a-chips a-tabs" role="tablist" aria-label="Delivery">
        {[['ready', 'Ready for a trip'], ['trips', 'Trips'], ['other', 'Courier and pickup'], ['failed', 'Failed']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l} {lists[k].length}</button>
        ))}
      </div>
      <Loading state={data}>
        {d && tab === 'ready' && (
          <>
            {areas.map((a) => (
              <div key={a} className="a-card">
                <h3>{a}</h3>
                <table className="a-table"><tbody>{ready.filter((o) => (o.area || 'No area') === a).map((o) => (
                  <tr key={o.order_no}>
                    <td><input type="checkbox" aria-label={`Trip ${o.order_no}`} disabled={Boolean(o.trip_id)} checked={sel.includes(o.order_no)} onChange={() => setSel((s) => (s.includes(o.order_no) ? s.filter((x) => x !== o.order_no) : [...s, o.order_no]))} /></td>
                    <td><code>{o.order_no}</code>{o.trip_id && <small className="a-muted a-person-sub">on trip T-{o.trip_id} (planned)</small>}</td>
                    <td>{o.customer}<small className="a-muted a-person-sub">{placeLine(o)}</small></td>
                    <td className="a-num">{o.cartons} carton(s)</td><td className="a-num">{o.payment_terms === 'cod' && o.amount_due > 0 ? `COD ${rs(o.amount_due)}` : ''}</td>
                  </tr>
                ))}</tbody></table>
              </div>
            ))}
            {!ready.length && <p className="a-muted">No packed order waits for a trip.</p>}
            {pickups.length > 0 && (
              <div className="a-card">
                <h3>Returns to pick up</h3>
                <table className="a-table"><tbody>{pickups.map((r) => (
                  <tr key={r.return_no}>
                    <td><input type="checkbox" aria-label={`Trip ${r.return_no}`} disabled={Boolean(r.trip_id)} checked={selRet.includes(r.return_no)} onChange={() => setSelRet((s) => (s.includes(r.return_no) ? s.filter((x) => x !== r.return_no) : [...s, r.return_no]))} /></td>
                    <td><code>{r.return_no}</code>{r.trip_id && <small className="a-muted a-person-sub">on trip T-{r.trip_id}</small>}<small className="a-muted a-person-sub">order {r.order_no}</small></td>
                    <td>{r.customer}<small className="a-muted a-person-sub">{placeLine(r)}{r.area ? ` · ${r.area}` : ''}</small></td>
                    <td>Pick up {r.items}</td>
                  </tr>
                ))}</tbody></table>
              </div>
            )}
            {(ready.length > 0 || pickups.length > 0) && (
              <div className="a-toolbar">
                <label className="a-inline">Vehicle <select value={trip.vehicle_id} aria-label="Vehicle" onChange={(e) => setTrip({ ...trip, vehicle_id: e.target.value })}><option value="">Choose...</option>{d.vehicles.map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.number} ({v.type})</option>)}</select></label>
                <label className="a-inline">Driver <select value={trip.driver_id} aria-label="Driver" onChange={(e) => setTrip({ ...trip, driver_id: e.target.value })}><option value="">Choose...</option>{d.drivers.map((v) => <option key={v.driver_id} value={v.driver_id}>{v.name}</option>)}</select></label>
                <button type="button" className="a-btn" disabled={act.busy || !(sel.length + selRet.length) || !trip.vehicle_id || !trip.driver_id} onClick={create}>New trip with {sel.length + selRet.length} stop(s)</button>
              </div>
            )}
          </>
        )}
        {d && tab === 'trips' && (
          <div className="a-scroll">
            <table className="a-table">
              <thead><tr><th>Trip</th><th>Date</th><th>Vehicle / driver</th><th>Status</th><th className="a-num">Stops</th><th className="a-num">Cash collected / handed</th></tr></thead>
              <tbody>{d.trips.map((t) => (
                <tr key={t.trip_id} className="a-rowlink" tabIndex={0} onClick={() => setOpenTrip(t.trip_id)} onKeyDown={(e) => e.key === 'Enter' && setOpenTrip(t.trip_id)}>
                  <td>T-{t.trip_id}{t.area && <small className="a-muted a-person-sub">{t.area}</small>}</td><td>{day(t.trip_date)}</td><td>{t.vehicle}<small className="a-muted a-person-sub">{t.driver}</small></td>
                  <td><span className={`a-status ${TRIP[t.status][1]}`}>{TRIP[t.status][0]}</span></td><td className="a-num">{t.delivered}/{t.stops}{t.failed ? ` (${t.failed} failed)` : ''}</td>
                  <td className="a-num">{t.cash_collected == null ? (t.cash_expected != null ? `to collect ${rs(t.cash_expected)}` : '') : `${rs(t.cash_collected)} / ${rs(t.cash_handed)}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {d && tab === 'other' && lists.courier.length > 0 && <h3>Courier</h3>}
        {d && tab === 'other' && lists.courier.length > 0 && (
          <table className="a-table"><tbody>{lists.courier.map((o) => (
            <tr key={o.order_no}>
              <td><code>{o.order_no}</code><small className="a-muted a-person-sub">{o.customer}, {o.ship_town}</small></td>
              <td>{o.status === 'packed' ? `${o.cartons} carton(s), ${Number(o.weight_kg)} kg` : <>{o.courier} AWB <b>{o.awb_no}</b>{o.tracking_link && <> · <a href={o.tracking_link} target="_blank" rel="noreferrer">Track</a></>}<small className="a-muted a-person-sub">handed {fmtDate(o.courier_at)}</small></>}</td>
              <td className="a-num">{rs(o.total)}</td>
              <td>{o.status === 'packed' ? <button type="button" className="a-btn a-btn-sm" onClick={() => setForm({ order: o, kind: 'courier', courier_id: d.couriers[0] ? String(d.couriers[0].courier_id) : '', awb_no: '', eway_bill_no: '' })}>Hand to courier</button>
                : <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setForm({ order: o, kind: 'courier_done', receiver_name: '' })}>Mark delivered</button>}</td>
            </tr>
          ))}</tbody></table>
        )}
        {d && tab === 'other' && lists.pickup.length > 0 && <h3>Customer pickup at the godown</h3>}
        {d && tab === 'other' && lists.pickup.length > 0 && (
          <table className="a-table"><tbody>{lists.pickup.map((o) => (
            <tr key={o.order_no}><td><code>{o.order_no}</code><small className="a-muted a-person-sub">{o.customer}</small></td><td>{o.cartons} carton(s)</td><td className="a-num">{o.payment_terms === 'cod' && o.amount_due > 0 ? `Collect ${rs(o.amount_due)}` : ''}</td>
              <td><button type="button" className="a-btn a-btn-sm" onClick={() => setForm({ order: o, kind: 'pickup', receiver_name: '' })}>Collected</button></td></tr>
          ))}</tbody></table>
        )}
        {d && tab === 'failed' && (
          <table className="a-table"><tbody>{lists.failed.map((o) => (
            <tr key={o.order_no}><td><code>{o.order_no}</code><small className="a-muted a-person-sub">{o.customer}, {o.ship_town}</small></td><td className="a-bad">{o.failed_reason}<small className="a-muted a-person-sub">{fmtDate(o.failed_at)}</small></td>
              <td><span className="a-row"><button type="button" className="a-btn a-btn-sm" onClick={() => act2(`/commerce/orders/${o.order_no}/reattempt`, {}, `${o.order_no} is ready for the next trip`)}>Re-attempt</button>
                <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={() => setForm({ order: o, kind: 'return', reason: '' })}>Return to godown</button></span></td></tr>
          ))}</tbody></table>
        )}
        {d && tab !== 'ready' && tab !== 'trips' && !lists[tab].length && <p className="a-muted">Nothing here.</p>}
      </Loading>
      {form && (
        <Drawer title={`${form.order.order_no}: ${{ courier: 'hand to courier', courier_done: 'delivered by the courier', pickup: 'collected by the customer', return: 'return to the godown' }[form.kind]}`} onClose={() => setForm(null)}
          footer={<button type="button" className={`a-btn${form.kind === 'return' ? ' a-btn-danger' : ''}`} disabled={act.busy} onClick={() => {
            const o = form.order.order_no;
            if (form.kind === 'courier') act2(`/commerce/orders/${o}/courier`, form, `${o} handed to the courier, AWB ${form.awb_no.toUpperCase()}`);
            else if (form.kind === 'courier_done') act2(`/commerce/orders/${o}/courier-delivered`, form, `${o} delivered`);
            else if (form.kind === 'pickup') act2(`/commerce/orders/${o}/picked-up`, form, `${o} collected by ${form.receiver_name}`);
            else act2(`/commerce/orders/${o}/return-to-godown`, form, `${o} returned to the godown: goods back in stock, invoice cancelled with a credit note`);
          }}>Save</button>}>
          {act.note}
          <p>{form.order.customer} · {form.order.ship_town} · {rs(form.order.total)}</p>
          {form.kind === 'courier' && (
            <div className="a-grid2">
              <label className="a-field"><span>Courier</span><select value={form.courier_id} aria-label="Courier" onChange={(e) => setForm({ ...form, courier_id: e.target.value })}>{d.couriers.map((c) => <option key={c.courier_id} value={c.courier_id}>{c.name}</option>)}</select></label>
              <label className="a-field"><span>AWB number</span><input value={form.awb_no} aria-label="AWB number" onChange={(e) => setForm({ ...form, awb_no: e.target.value })} /></label>
              <label className="a-field"><span>E-way bill no.{d.eway.required && form.order.total > d.eway.above ? ' (required)' : ' (if any)'}</span><input inputMode="numeric" maxLength={12} value={form.eway_bill_no} aria-label="E-way bill" onChange={(e) => setForm({ ...form, eway_bill_no: e.target.value })} /></label>
            </div>
          )}
          {['courier_done', 'pickup'].includes(form.kind) && <label className="a-field"><span>Received by (name){form.kind === 'pickup' ? '' : ', optional'}</span><input value={form.receiver_name} aria-label="Received by" onChange={(e) => setForm({ ...form, receiver_name: e.target.value })} /></label>}
          {form.kind === 'return' && (
            <>
              <Notice kind="warn">The goods come back into stock (same batches), the invoice is cancelled with a credit note and the order is cancelled.</Notice>
              <label className="a-field"><span>Why? (required)</span><input value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            </>
          )}
        </Drawer>
      )}
      {openTrip && <Drawer title={`Trip T-${openTrip}`} onClose={() => { setOpenTrip(null); data.reload(); }}><TripView id={openTrip} onChanged={data.reload} /></Drawer>}
    </section>
  );
}

/** My trips: the trips of the driver linked to this admin user (Commerce settings > Drivers) */
export function MyTrips() {
  const data = useLoad('/commerce/my-trips');
  const [open, setOpen] = useState(null);
  const d = data.data;
  return (
    <section className="a-mytrips">
      <h1>My trips</h1>
      <Loading state={data}>
        {d && (
          !d.driver ? <Notice kind="warn">Your user is not linked to a driver yet: an Admin links it in Commerce settings &gt; Drivers.</Notice> : open ? (
            <>
              <button type="button" className="a-btn a-btn-ghost" onClick={() => { setOpen(null); data.reload(); }}>Back to my trips</button>
              <TripView id={open} onChanged={data.reload} />
            </>
          ) : (
            <>
              <p className="a-muted">{d.driver}</p>
              {d.trips.map((t) => (
                <button key={t.trip_id} type="button" className="a-tripcard" onClick={() => setOpen(t.trip_id)}>
                  <b>Trip T-{t.trip_id}</b> <span className={`a-status ${TRIP[t.status][1]}`}>{TRIP[t.status][0]}</span>
                  <span className="a-muted">{day(t.trip_date)} · {t.vehicle} · {t.done} of {t.stops} stops done</span>
                </button>
              ))}
              {!d.trips.length && <p className="a-muted">No trip for you today.</p>}
            </>
          )
        )}
      </Loading>
    </section>
  );
}
