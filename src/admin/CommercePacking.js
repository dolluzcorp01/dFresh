// Fulfilment > Packing (docs/COMMERCE-SPEC.md 5.3; API /commerce/packing, logic in src/backend_routes/delivery.js).
// To pick: New orders; tick one or many for the pick list (grouped by SKU and batch, earliest expiry first, with each
// SKU's bin; print or save as PDF) and Start packing (the batches are fixed then). Packing: open an order and scan
// every pack (SKU, SKU/BATCH for batch-tracked products) or full carton (SKU#C); a wrong SKU, wrong batch or too many
// shows a red message and is not counted. Mark packed needs every line matched plus cartons and weight; a role with
// "approve" on Packing can pack anyway with a reason (audited). Packed: packing slip and carton labels (carton x of y,
// barcode of the order number).
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLoad } from './ui';
import { barcodeSvg, esc, printPage, rs } from './printKit';
import { stateName } from '../shared/gstStates';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const KIND = { own: 'Own vehicle', courier: 'Courier', pickup: 'Customer pickup' };

export function printPickList(data) {
  const rows = data.rows.map((r) => `<tr><td><b>${esc(r.bin_location || '-')}</b></td><td><b>${esc(r.sku_code)}</b><br><small>${esc(r.name)} - ${esc(r.size_label)}</small></td>
    <td>${r.batch_no ? `${esc(r.batch_no)}<br><small>exp. ${day(r.expiry_date)}</small>` : '<span class="muted">-</span>'}</td>
    <td class="n"><b>${r.qty}</b>${r.packs_per_carton > 1 && r.qty >= r.packs_per_carton ? `<br><small>${Math.floor(r.qty / r.packs_per_carton)} carton(s) + ${r.qty % r.packs_per_carton}</small>` : ''}</td>
    <td><small>${r.orders.map(esc).join('<br>')}</small></td><td class="tick"><span class="box"></span></td></tr>`).join('');
  return printPage({
    title: `Pick list ${data.orders.map((o) => o.order_no).join(', ')}`,
    body: `<div class="row"><div><h1>Pick list</h1><div class="muted">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} · Kanchipuram godown</div></div>
      <div>${data.orders.map((o) => `<div><b>${esc(o.order_no)}</b> ${esc(o.customer)}</div>`).join('')}</div></div>
      <p class="muted">Walk by bin. Batch-tracked products: take the batch shown (earliest expiry first).</p>
      <table><thead><tr><th>Bin</th><th>SKU</th><th>Batch</th><th class="n">Packs</th><th>For orders</th><th class="tick">OK</th></tr></thead><tbody>${rows}</tbody></table>`,
  });
}

function slipAddress(s) {
  return [esc(s.ship_name), esc(s.ship_address), esc([s.ship_town, s.ship_pincode].filter(Boolean).join(' ')), esc(s.ship_state), s.ship_phone ? `Phone ${esc(s.ship_phone)}` : ''].filter(Boolean).join('<br>');
}
export function printSlip(s) {
  const lines = s.lines.map((l) => `<tr><td>${esc(l.sku_code)}</td><td>${esc(l.name)} - ${esc(l.size_label)}</td><td>${esc(l.batch_no || '')}${l.expiry_date ? ` <small>exp. ${day(l.expiry_date)}</small>` : ''}</td><td class="n">${l.need}</td></tr>`).join('');
  return printPage({
    title: `Packing slip ${s.order_no}`,
    body: `<div class="row"><div><h1>Packing slip</h1><b>dFresh</b> - Kanchipuram<br>${esc(s.phone)}</div><div>${barcodeSvg(s.order_no)}</div></div>
      <div class="row"><div><h2>Deliver to</h2>${slipAddress(s)}</div>
      <div><h2>Order ${esc(s.order_no)}</h2>${esc(s.customer)}<br>Ordered ${day(s.created_at)}<br>${esc(s.method || KIND[s.delivery_kind])}${s.courier ? `: ${esc(s.courier)}` : ''}${s.awb_no ? ` AWB ${esc(s.awb_no)}` : ''}<br>
      Cartons: <b>${s.cartons || '-'}</b> · Weight: ${s.weight_kg ? `${Number(s.weight_kg)} kg` : '-'}${s.payment_terms === 'cod' && s.amount_due > 0 ? `<br><b>Collect on delivery: ${rs(s.amount_due)}</b>` : ''}</div></div>
      <table><thead><tr><th>SKU</th><th>Item</th><th>Batch</th><th class="n">Packs</th></tr></thead><tbody>${lines}</tbody></table>
      ${s.note ? `<p>Note: ${esc(s.note)}</p>` : ''}<p class="muted">Received in good condition: ______________________ (name, signature)</p>`,
  });
}
export function printCartonLabels(s) {
  const n = Math.max(Number(s.cartons) || 1, 1);
  const labels = Array.from({ length: n }, (_, i) => `<div class="label"><div class="row"><b class="brand">dFresh</b><b class="cx">Carton ${i + 1} of ${n}</b></div>
    <div class="to">${slipAddress(s)}</div>${barcodeSvg(s.order_no, { height: 56, width: 2 })}
    <div class="row"><span>${esc(s.method || KIND[s.delivery_kind])}${s.awb_no ? ` · AWB ${esc(s.awb_no)}` : ''}</span><span>${s.payment_terms === 'cod' && s.amount_due > 0 ? `COD ${rs(s.amount_due)}` : 'Prepaid / credit'}</span></div></div>`).join('');
  return printPage({
    title: `Carton labels ${s.order_no}`, size: '100mm 150mm', margin: '4mm',
    css: '.label { height: 138mm; border: 1px dashed #999; padding: 4mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; } .label:last-child { page-break-after: auto; } .brand { font-size: 20px; } .cx { font-size: 16px; } .to { font-size: 15px; line-height: 1.35; }',
    body: labels,
  });
}

export default function CommercePacking() {
  const data = useLoad('/commerce/packing');
  const canEdit = useCan('packing', 'edit');
  const act = useAction();
  const [tab, setTab] = useState('pick');
  const [picked, setPicked] = useState([]);
  const [open, setOpen] = useState(null);
  const d = data.data;
  const rows = d ? d.rows : [];
  const by = (st) => rows.filter((r) => r.status === st);
  const list = tab === 'pick' ? by('new') : tab === 'packing' ? by('packing') : by('packed');
  const toggle = (no) => setPicked((p) => (p.includes(no) ? p.filter((x) => x !== no) : [...p, no]));
  const pickList = () => act.run(async () => { if (!printPickList(await api.send('POST', '/commerce/packing/picklist', { order_nos: picked }))) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print the pick list.' }); });
  const start = () => act.run(async () => {
    const r = await api.send('POST', '/commerce/packing/start', { order_nos: picked });
    setPicked([]); data.reload();
    act.setMsg({ kind: 'ok', text: `Packing started: ${r.started.join(', ')}. Open each in Packing to scan.` });
  });
  useEffect(() => setPicked([]), [tab]);
  return (
    <section>
      <h1>Packing</h1>
      <InfoCard title="Pick, scan, pack">
        <ul>
          <li>Tick New orders for a pick list (by bin, SKU and batch, earliest expiry first) and Start packing: the batches are fixed then.</li>
          <li>Scan every pack (batch-tracked products: the batch label SKU/BATCH) or a full carton (SKU#C). Wrong SKU, wrong batch or too many: a red message, not counted.</li>
          <li>Mark packed needs everything matched, the number of cartons and the weight. Then print the packing slip and the carton labels.</li>
        </ul>
      </InfoCard>
      {act.note}
      <div className="a-chips a-tabs" role="tablist" aria-label="Packing">
        {[['pick', 'To pick', by('new').length], ['packing', 'Packing', by('packing').length], ['packed', 'Packed (3 days)', by('packed').length]].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l} {n}</button>
        ))}
      </div>
      {tab !== 'packed' && (
        <div className="a-toolbar">
          <button type="button" className="a-btn a-btn-ghost" disabled={!picked.length || act.busy} onClick={pickList}>Pick list ({picked.length})</button>
          {tab === 'pick' && canEdit && <button type="button" className="a-btn" disabled={!picked.length || act.busy} onClick={start}>Start packing ({picked.length})</button>}
        </div>
      )}
      <Loading state={data}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr>{tab !== 'packed' && <th />}<th>Order</th><th>Customer</th><th>Delivery</th><th className="a-num">Packs</th><th>{tab === 'packed' ? 'Cartons / weight' : 'Since'}</th><th /></tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.order_no}>
                {tab !== 'packed' && <td><input type="checkbox" aria-label={`Pick ${o.order_no}`} disabled={o.waiting} checked={picked.includes(o.order_no)} onChange={() => toggle(o.order_no)} /></td>}
                <td><code>{o.order_no}</code>{o.waiting && <span className="a-status a-ap-pending a-builtin">waits for approval</span>}</td>
                <td>{o.customer}<small className="a-muted a-person-sub">{o.ship_town}</small></td>
                <td>{o.method}{o.area ? <small className="a-muted a-person-sub">{o.area}</small> : null}</td>
                <td className="a-num">{o.units}</td>
                <td>{tab === 'packed' ? `${o.cartons} x, ${Number(o.weight_kg)} kg` : fmtDate(tab === 'packing' ? o.packing_at : o.created_at)}</td>
                <td>{tab !== 'pick' && <button type="button" className="a-btn a-btn-sm" onClick={() => setOpen(o.order_no)}>{tab === 'packing' ? 'Scan and pack' : 'Slip / labels'}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {!list.length && <p className="a-muted">Nothing here.</p>}
        </div>
      </Loading>
      {open && <PackDrawer no={open} onClose={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}

function PackDrawer({ no, onClose }) {
  const st = useLoad(`/commerce/packing/${no}`);
  const canEdit = useCan('packing', 'edit');
  const act = useAction();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [last, setLast] = useState(null); // { result, message }
  const [f, setF] = useState({ cartons: '', weight_kg: '', override: false, override_reason: '' });
  const d = st.data;
  const packing = d && d.order.status === 'packing';
  useEffect(() => { if (packing && inputRef.current) inputRef.current.focus(); }, [packing, d]);
  const scan = (e) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setCode('');
    act.run(async () => { const r = await api.send('POST', `/commerce/packing/${no}/scan`, { code: c }); setLast(r); st.setData({ ...d, lines: r.state.lines, complete: r.state.complete }); st.reload(); });
  };
  const need = d ? d.lines.reduce((a, l) => a + l.need, 0) : 0;
  const got = d ? d.lines.reduce((a, l) => a + l.scanned, 0) : 0;
  const packed = () => act.run(async () => {
    await api.send('POST', `/commerce/packing/${no}/packed`, { cartons: f.cartons, weight_kg: f.weight_kg, override_reason: f.override ? f.override_reason : '' });
    st.reload();
    act.setMsg({ kind: 'ok', text: `${no} packed: ${f.cartons} carton(s), ${f.weight_kg} kg. Print the packing slip and the labels.` });
  });
  const reset = async () => {
    if (!(await confirm({ title: 'Reset the scans?', message: `Every scan of ${no} is cleared; scan again from the start.`, action: 'Reset', danger: true }))) return;
    act.run(async () => { await api.send('POST', `/commerce/packing/${no}/reset`); setLast(null); st.reload(); });
  };
  const slip = (kind) => act.run(async () => {
    const s = await api.get(`/commerce/packing/${no}/slip`);
    if (!(kind === 'slip' ? printSlip({ ...s, ship_state: s.ship_state || stateName(s.ship_state_code) }) : printCartonLabels(s))) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print.' });
  });
  return (
    <Drawer title={`Pack ${no}`} onClose={onClose}
      footer={d ? (
        <>
          {packing && canEdit && <button type="button" className="a-btn" disabled={act.busy || (!d.complete && !(f.override && f.override_reason.trim())) || !f.cartons || !f.weight_kg} onClick={packed}>Mark packed</button>}
          {packing && canEdit && got > 0 && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={reset}>Reset scans</button>}
          {!packing && <><button type="button" className="a-btn" onClick={() => slip('slip')}>Packing slip</button><button type="button" className="a-btn a-btn-ghost" onClick={() => slip('labels')}>Carton labels</button></>}
        </>
      ) : null}>
      <Loading state={st}>
        {d && (
          <>
            {act.note}
            <p><b>{d.order.customer}</b> · {d.order.ship_town} · {d.order.method}{d.order.area ? ` (${d.order.area})` : ''} · <span className={`a-ostatus a-ostatus-${d.order.status}`}>{d.order.status}</span></p>
            {packing && canEdit && (
              <form onSubmit={scan} className="a-packscan">
                <label className="a-field"><span>Scan a pack or carton (or type the code and press Enter)</span>
                  <input ref={inputRef} value={code} aria-label="Pack scan" autoComplete="off" placeholder="DF001-M100, DF044-M100/WW2509, DF001-M100#C" onChange={(e) => setCode(e.target.value)} /></label>
              </form>
            )}
            {last && <div className={`a-scanmsg ${last.result === 'ok' ? 'ok' : 'bad'}`} role="alert">{last.result === 'ok' ? 'OK ' : 'NOT COUNTED: '}{last.message}</div>}
            <p className="a-packprogress"><b>{got} of {need} packs</b>{d.complete ? <span className="a-status a-ap-approved a-builtin">All matched</span> : null}</p>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>Bin</th><th>SKU</th><th>Batch</th><th className="a-num">Packs</th><th className="a-num">Scanned</th></tr></thead>
                <tbody>{d.lines.map((l) => (
                  <tr key={`${l.sku_code}${l.batch_id}`} className={l.scanned === l.need ? 'a-donerow' : undefined}>
                    <td>{l.bin_location || '-'}</td><td><code>{l.sku_code}</code><small className="a-muted a-person-sub">{l.name} - {l.size_label}{l.packs_per_carton > 1 ? ` · carton ${l.packs_per_carton}` : ''}</small></td>
                    <td>{l.batch_no ? <>{l.batch_no}<small className="a-muted a-person-sub">exp. {day(l.expiry_date)}</small></> : ''}</td>
                    <td className="a-num">{l.need}</td><td className={`a-num${l.scanned === l.need ? ' a-ok' : ''}`}><b>{l.scanned}</b>{l.scanned === l.need ? ' ✓' : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {packing && canEdit && (
              <div className="a-grid2">
                <label className="a-field"><span>Cartons</span><input type="number" min="1" step="1" value={f.cartons} aria-label="Cartons" onChange={(e) => setF({ ...f, cartons: e.target.value })} /></label>
                <label className="a-field"><span>Weight (kg)</span><input inputMode="decimal" value={f.weight_kg} aria-label="Weight" onChange={(e) => setF({ ...f, weight_kg: e.target.value })} /></label>
              </div>
            )}
            {packing && canEdit && !d.complete && d.canOverride && (
              <div className="a-card">
                <label className="a-inline"><input type="checkbox" checked={f.override} onChange={(e) => setF({ ...f, override: e.target.checked })} /> Pack without a full match (override, audited)</label>
                {f.override && <label className="a-field"><span>Why? (required)</span><input value={f.override_reason} maxLength={255} aria-label="Override reason" onChange={(e) => setF({ ...f, override_reason: e.target.value })} /></label>}
              </div>
            )}
            {!packing && d.order.status !== 'new' && <Notice kind="ok">Packed: {d.order.cartons} carton(s), {Number(d.order.weight_kg)} kg.</Notice>}
            {d.scans.length > 0 && (
              <>
                <h3>Scans</h3>
                <ul className="a-hist">{d.scans.slice(0, 12).map((x) => <li key={x.scan_id} className={x.result === 'ok' ? '' : 'a-bad'}>{fmtDate(x.created_at)} · <code>{x.code}</code> · {x.result === 'ok' ? `+${x.qty}` : x.result.replace('_', ' ')} - {x.message}</li>)}</ul>
              </>
            )}
          </>
        )}
      </Loading>
    </Drawer>
  );
}
