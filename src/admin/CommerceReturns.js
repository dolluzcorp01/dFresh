// Commerce > Returns (docs/COMMERCE-SPEC.md 4.8, 5.5, 6.2; API /commerce/returns, logic in src/backend_routes/returns.js).
// List: status chips (Requested > Collecting > Received > Inspected > Refunded / Replaced / Closed, and Rejected),
// filters (reason, outcome, dates, search). A return is entered on a delivered order (Orders > open > New return:
// NewReturn below) when the customer calls: SKU and batch as delivered, packs (partial is fine), reason, how it comes
// back, photos (optional). Outside the return window it waits for approval (or is refused: Commerce setting).
// The return drawer, step by step:
// - Collection: the customer brings it; a pickup on a trip (Delivery > Ready; the driver marks it Picked up with a
//   photo); a courier reverse pickup (courier and AWB).
// - Receive at the godown: scan each pack (SKU, SKU/BATCH for batch-tracked products, SKU#C = one carton), the pack
//   check rules. Inspect: per line OK (to Returned (R) stock), Damaged, Expired (blocked), Not received; inspector,
//   time and notes kept. Needs "edit" on Inventory (Warehouse), not on Returns.
// - Decide (Returns edit): per line refund, replacement or no refund. A refund issues the credit note first (the
//   invoice's own CGST + SGST or IGST), then: to the wallet, to the original payment (mode and reference typed), or
//   less to pay on an unpaid order. Above the threshold a refund waits for approval; "No refund" waits for approval.
//   A replacement is a Rs 0 order through the normal pick-pack-deliver flow.
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLoad, useUpload, UploadButton } from './ui';
import { printCreditNote, signed } from './invoicePrint';

export const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const FLOW = ['requested', 'collecting', 'received', 'inspected'];
const END = { refunded: 'Refunded', replaced: 'Replaced', closed: 'Closed', rejected: 'Rejected' };
const STAMP = { requested: 'created_at', received: 'received_at', inspected: 'inspected_at' };
const OUTCOME_SHORT = { refund: 'Refund', replace: 'Replacement', none: 'No refund' };
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function RStatus({ status, label }) {
  return <span className={`a-rstatus a-rstatus-${status}`}>{label}</span>;
}

export default function CommerceReturns() {
  const location = useLocation();
  const urlStatus = new URLSearchParams(location.search).get('status') || '';
  const [f, setF] = useState({ status: urlStatus, reason: '', outcome: '', from: '', to: '', q: '' });
  useEffect(() => { setF((x) => ({ ...x, status: urlStatus })); }, [urlStatus]);
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 350); return () => clearTimeout(t); }, [search]);
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const list = useLoad(`/commerce/returns${qs ? `?${qs}` : ''}`);
  const [open, setOpen] = useState(null);
  const d = list.data;
  // the filter lists stay while the list reloads
  const [meta, setMeta] = useState(null);
  useEffect(() => { if (d) setMeta({ statuses: d.statuses, reasons: d.reasons, outcomes: d.outcomes, counts: d.counts }); }, [d]);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const counts = (meta && meta.counts) || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <section>
      <h1>Returns</h1>
      <InfoCard title="Returns and refunds">
        <ul>
          <li>Enter a return on a delivered order when the customer calls: Orders, open the order, New return. Outside the return window it needs approval.</li>
          <li>It comes back with the customer, as a pickup on a delivery trip (Delivery &gt; Ready) or by courier (AWB). At the godown every pack is scanned and inspected: OK to Returned (R) stock, Damaged, Expired (blocked).</li>
          <li>Then refund (credit note first: to the wallet, to the original payment, or less to pay), a Rs 0 replacement order, or no refund (needs approval).</li>
        </ul>
      </InfoCard>
      <div className="a-toolbar">
        <div className="a-chips" role="group" aria-label="Status">
          <button type="button" className={`a-chip${!f.status ? ' on' : ''}`} onClick={() => set({ status: '' })}>All {all}</button>
          {meta && Object.entries(meta.statuses).filter(([k]) => k !== 'rejected' || counts[k]).map(([k, v]) => (
            <button key={k} type="button" className={`a-chip${f.status === k ? ' on' : ''}`} onClick={() => set({ status: k })}>{v} {counts[k] || 0}</button>
          ))}
        </div>
      </div>
      <div className="a-filters">
        <input type="search" placeholder="DFR, DFO or customer" aria-label="Search returns" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>Reason <select value={f.reason} onChange={(e) => set({ reason: e.target.value })}><option value="">All</option>{meta && meta.reasons.map((r) => <option key={r.reason_id} value={r.reason_id}>{r.label}</option>)}</select></label>
        <label>Outcome <select value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">All</option>{meta && Object.entries(meta.outcomes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
      </div>
      <Loading state={list}>
        {d && <ReturnsTable rows={d.rows} onOpen={setOpen} />}
      </Loading>
      {open && <ReturnDrawer no={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </section>
  );
}

export function ReturnsTable({ rows, compact = false, onOpen }) {
  if (!rows.length) return <p className="a-muted">No return matches.</p>;
  return (
    <div className="a-scroll">
      <table className="a-table">
        <thead><tr><th>Return</th>{!compact && <th>Order / customer</th>}<th>Packs</th><th>Reason</th><th>Status</th><th>Outcome</th>{!compact && <th>Entered</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.return_no} className="a-rowlink" tabIndex={0} onClick={() => onOpen(r.return_no)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.return_no)}>
              <td><code>{r.return_no}</code><small className="a-muted a-person-sub">{r.collection_label}{r.awb_no ? `, AWB ${r.awb_no}` : ''}</small></td>
              {!compact && <td><code>{r.order_no}</code><small className="a-muted a-person-sub">{r.customer}</small></td>}
              <td>{r.items}</td>
              <td>{r.reason}{r.outside_window ? <small className="a-bad a-person-sub">outside the window</small> : null}</td>
              <td><RStatus status={r.status} label={r.status_label} />{r.waiting.length > 0 && <small className="a-muted a-person-sub">waits: {r.waiting.join(', ')}</small>}</td>
              <td>{r.outcomes.map((o) => OUTCOME_SHORT[o]).join(' + ')}{r.refunded > 0 ? ` ${rs(r.refunded)}` : ''}{r.replacement_no ? <small className="a-muted a-person-sub">{r.replacement_no} ({r.replacement_status.replace(/_/g, ' ')})</small> : null}</td>
              {!compact && <td>{fmtDate(r.created_at)}<small className="a-muted a-person-sub">{r.requested_by}</small></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- New return (in the order drawer)
export function NewReturn({ orderNo, onDone, onCancel }) {
  const src = useLoad(`/commerce/orders/${orderNo}/returnable`);
  const act = useAction();
  const confirm = useConfirm();
  const up = useUpload();
  const [qty, setQty] = useState({});
  const [f, setF] = useState({ reason_id: '', reason_note: '', collection: 'bring' });
  const [photos, setPhotos] = useState([]);
  const d = src.data;
  const keyOf = (l) => `${l.sku_code}|${l.batch_id || ''}`;
  const picked = d ? d.lines.filter((l) => Number(qty[keyOf(l)]) > 0) : [];
  const outside = d && d.days > d.window_days;
  const reason = d && d.reasons.find((r) => String(r.reason_id) === f.reason_id);
  const save = async () => {
    const what = picked.map((l) => `${qty[keyOf(l)]} x ${l.sku_code}${l.batch_no ? ` batch ${l.batch_no}` : ''}`).join(', ');
    if (!(await confirm({ title: `New return on ${orderNo}?`, message: `${what}. ${reason.label}. ${d.collections[f.collection]}.${outside ? ' Outside the return window: it waits for approval.' : ''}`, action: 'Save return' }))) return;
    act.run(async () => {
      const r = await api.send('POST', `/commerce/orders/${orderNo}/returns`, { ...f, lines: picked.map((l) => ({ sku_code: l.sku_code, batch_id: l.batch_id, qty: Number(qty[keyOf(l)]) })) });
      for (const p of photos) await up.send('photo', `/commerce/returns/${r.return_no}/photos`, p, { kind: 'request' });
      onDone(r);
    });
  };
  return (
    <div className="a-card a-returnform">
      <h3>New return on {orderNo}</h3>
      <Loading state={src}>
        {d && (
          <>
            {act.note}
            <p className="a-muted">Delivered on {day(d.delivered_on)} ({d.days} day{d.days === 1 ? '' : 's'} ago). Return window: {d.window_days} days.</p>
            {outside && <Notice kind={d.outside_rule === 'refuse' ? 'error' : 'warn'}>Outside the return window: {d.outside_rule === 'refuse' ? 'returns are refused (Commerce settings).' : 'the return waits for approval before it is collected.'}</Notice>}
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>SKU</th><th>Batch</th><th className="a-num">Delivered</th><th className="a-num">Can return</th><th className="a-num">Return</th></tr></thead>
                <tbody>{d.lines.map((l) => (
                  <tr key={keyOf(l)}>
                    <td><code>{l.sku_code}</code><small className="a-muted a-person-sub">{l.name} - {l.size_label}</small></td>
                    <td>{l.batch_no ? <>{l.batch_no}<small className="a-muted a-person-sub">exp. {day(l.expiry_date)}</small></> : '-'}</td>
                    <td className="a-num">{l.delivered}</td><td className="a-num">{l.qty}</td>
                    <td className="a-num"><input type="number" min="0" max={l.qty} step="1" className="a-qty" disabled={!l.qty} aria-label={`Return ${l.sku_code}${l.batch_no ? ` ${l.batch_no}` : ''}`}
                      value={qty[keyOf(l)] ?? ''} onChange={(e) => setQty({ ...qty, [keyOf(l)]: e.target.value })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="a-grid2">
              <label className="a-field"><span>Reason</span>
                <select value={f.reason_id} aria-label="Reason" onChange={(e) => setF({ ...f, reason_id: e.target.value })}><option value="">Choose...</option>{d.reasons.map((r) => <option key={r.reason_id} value={r.reason_id}>{r.label}</option>)}</select></label>
              <label className="a-field"><span>How does it come back?</span>
                <select value={f.collection} aria-label="Collection" onChange={(e) => setF({ ...f, collection: e.target.value })}>{Object.entries(d.collections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
            <label className="a-field"><span>What the customer said (optional)</span><input value={f.reason_note} maxLength={255} onChange={(e) => setF({ ...f, reason_note: e.target.value })} /></label>
            <div className="a-row">
              <UploadButton label="Add a photo (optional)" accept="image/jpeg,image/png,image/webp" upload={up} uploadKey="photo" onFile={(file) => setPhotos((p) => [...p, file])} />
              {photos.map((p, i) => <small key={`${p.name}${i}`} className="a-muted">{p.name} <button type="button" className="a-link" onClick={() => setPhotos(photos.filter((_, n) => n !== i))}>remove</button></small>)}
            </div>
            {reason && Number(reason.needs_photo) === 1 && !photos.length && <p className="a-muted">A photo helps for "{reason.label}" (WhatsApp it to the office if the customer has one).</p>}
            <span className="a-row">
              <button type="button" className="a-btn" disabled={act.busy || up.busy || !picked.length || !f.reason_id || (outside && d.outside_rule === 'refuse')} onClick={save}>Save return</button>
              <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={onCancel}>Cancel</button>
            </span>
          </>
        )}
      </Loading>
    </div>
  );
}

// ---------------------------------------------------------------- the return drawer
export function ReturnDrawer({ no, onClose }) {
  const r = useLoad(`/commerce/returns/${no}`);
  const d = r.data;
  const act = useAction();
  const up = useUpload();
  const waitingWindow = d && d.waiting.includes('return_window');
  const closed = d && END[d.status];
  const addPhoto = (kind) => (file) => act.run(async () => { await up.send(`p-${kind}`, `/commerce/returns/${no}/photos`, file, { kind }); r.reload(); }, 'Photo added');
  const openPhoto = (id) => act.run(async () => { if (!(await api.open(`/commerce/return-photos/${id}`))) act.setMsg({ kind: 'error', text: 'Allow pop-ups to see the photo.' }); });
  const printCn = (id) => act.run(async () => { if (!(await printCreditNote(id))) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print.' }); });
  const done = (msg) => { r.reload(); act.setMsg(msg); }; // a step panel closes when its step is done: the message stays here
  const stepDone = (s) => d && (closed ? d.status !== 'rejected' || s === 'requested' : FLOW.indexOf(s) <= FLOW.indexOf(d.status));
  return (
    <Drawer title={`Return ${no}`} onClose={onClose}>
      <Loading state={r}>
        {d && (
          <>
            {act.note}
            <ol className="a-steps">
              {FLOW.map((s) => <li key={s} className={stepDone(s) ? 'done' : ''}>{{ requested: 'Requested', collecting: 'Collecting', received: 'Received', inspected: 'Inspected' }[s]}<small>{fmtDate(d[STAMP[s]])}</small></li>)}
              <li className={closed && d.status !== 'rejected' ? 'done' : ''}>{closed ? END[d.status] : 'Refund / replace'}<small>{fmtDate(d.closed_at)}</small></li>
            </ol>
            {waitingWindow && <Notice kind="warn">Outside the return window ({d.window_days} days from {day(d.delivered_on)}): it waits for approval (Setup &gt; Approvals) before it is collected.</Notice>}
            {d.status === 'rejected' && <Notice kind="error">Rejected: the return outside the window was not approved.</Notice>}
            {d.waiting.includes('refund') && <Notice kind="warn">The refund waits for approval (above {rs(d.refundRule.above)}). The credit note is issued when it is approved.</Notice>}
            {d.waiting.includes('no_refund') && <Notice kind="warn">"No refund" waits for approval.</Notice>}
            <dl className="a-dl">
              <div><dt>Order</dt><dd><code>{d.order_no}</code> · {d.customer} {d.phone && <a href={`tel:${d.phone.replace(/\s/g, '')}`}>{d.phone}</a>}</dd></div>
              <div><dt>Reason</dt><dd>{d.reason}{d.reason_note ? ` - "${d.reason_note}"` : ''}</dd></div>
              <div><dt>Delivered</dt><dd>{day(d.delivered_on)} · window {d.window_days} days{d.outside_window ? ' · entered outside the window' : ''}</dd></div>
              <div><dt>Comes back</dt><dd>{d.collection_label}{d.awb_no && <> · {d.courier} AWB <b>{d.awb_no}</b>{d.tracking_link && <> · <a href={d.tracking_link} target="_blank" rel="noreferrer">Track</a></>}</>}
                {d.trips.map((t) => <small key={t.stop_id} className="a-person-sub">Trip T-{t.trip_id} ({t.vehicle}, {t.driver}): {t.status.replace('_', ' ')}{t.failed_reason ? ` - ${t.failed_reason}` : ''}{t.done_at ? ` · ${fmtDate(t.done_at)}` : ''}</small>)}
                {d.picked_up_at && <small className="a-person-sub">Picked up {fmtDate(d.picked_up_at)} by {d.picked_up_by}</small>}</dd></div>
              <div><dt>Entered</dt><dd>{fmtDate(d.created_at)} by {d.requested_by}</dd></div>
              {d.inspected_at && <div><dt>Inspected</dt><dd>{fmtDate(d.inspected_at)} by {d.inspected_by}{d.inspect_note ? ` - ${d.inspect_note}` : ''}</dd></div>}
              {d.replacement_no && <div><dt>Replacement</dt><dd><code>{d.replacement_no}</code> (Rs 0) · {d.replacement_status.replace(/_/g, ' ')}</dd></div>}
              {d.no_refund_reason && <div><dt>No refund</dt><dd>{d.no_refund_reason}</dd></div>}
              {Number(d.cashback_reversed) > 0 && <div><dt>Cashback</dt><dd className="a-bad">{rs(d.cashback_reversed)} taken back from the wallet (cashback already credited on {d.order_no})</dd></div>}
            </dl>
            <Lines d={d} />
            {!waitingWindow && <Collection d={d} onChanged={r.reload} />}
            {!waitingWindow && d.can.receive && ['requested', 'collecting', 'received'].includes(d.status) && <Receive d={d} onChanged={r.reload} onDone={done} />}
            {d.can.decide && d.status === 'inspected' && d.lines.some((l) => l.left > 0) && <Decide d={d} onDone={done} />}
            {(d.refunds.length > 0 || d.credit_notes.length > 0) && (
              <>
                <h3>Refunds and credit notes</h3>
                <table className="a-table"><tbody>
                  {d.refunds.map((f) => (
                    <tr key={f.refund_id}><td>{d.methods[f.method]}{f.mode ? ` (${d.modeLabels[f.mode] || f.mode}${f.reference ? `, ${f.reference}` : ''})` : ''}<small className="a-muted a-person-sub">{fmtDate(f.paid_at || f.created_at)} · {f.emp_id}</small></td>
                      <td className="a-num">{rs(f.amount)}</td><td>{f.status === 'paid' ? <span className="a-status a-ap-approved">Paid</span> : f.status === 'approval' ? <span className="a-status a-ap-pending">Waits for approval</span> : <span className="a-status a-ap-rejected">Not approved</span>}</td>
                      <td>{f.credit_note_no || ''}</td></tr>
                  ))}
                  {d.credit_notes.map((c) => (
                    <tr key={c.credit_note_id}><td>Credit note <b>{c.credit_note_no}</b><small className="a-muted a-person-sub">against {c.invoice_no} · {fmtDate(c.issued_at)}</small></td>
                      <td className="a-num">{rs(c.total)}</td><td>Taxable {rs(c.taxable)} + {d.gst_type === 'intra' ? `CGST ${rs(c.cgst)} + SGST ${rs(c.sgst)}` : `IGST ${rs(c.igst)}`}{c.round_off ? ` · round off ${signed(c.round_off)}` : ''}</td>
                      <td><button type="button" className="a-link" onClick={() => printCn(c.credit_note_id)}>Print / PDF</button></td></tr>
                  ))}
                </tbody></table>
              </>
            )}
            <h3>Photos</h3>
            <div className="a-row">
              {d.photos.map((p) => <button key={p.photo_id} type="button" className="a-link" onClick={() => openPhoto(p.photo_id)}>{p.kind} photo #{p.photo_id}</button>)}
              {!d.photos.length && <span className="a-muted">None.</span>}
              {d.can.photo && !closed && <UploadButton label="Add a photo" accept="image/jpeg,image/png,image/webp" upload={up} uploadKey="p-photo" onFile={addPhoto(d.can.receive && ['received', 'inspected'].includes(d.status) ? 'inspect' : 'request')} />}
            </div>
            {d.approvals.length > 0 && (
              <>
                <h3>Approvals</h3>
                <ul className="a-hist">{d.approvals.map((a) => <li key={a.approval_id}>#{a.approval_id} {a.kind_label}: <b>{a.status}</b>{a.decided_by ? ` by ${a.decided_by}` : ''}{a.note ? ` - "${a.note}"` : ''}</li>)}</ul>
              </>
            )}
            <h3>History</h3>
            <ul className="a-hist">{d.history.map((h, n) => <li key={n}>{fmtDate(h.created_at)} · <b>{h.status.replace(/_/g, ' ')}</b>{h.note ? ` - ${h.note}` : ''} <small className="a-muted">({h.emp_id})</small></li>)}</ul>
          </>
        )}
      </Loading>
    </Drawer>
  );
}

function Lines({ d }) {
  const inspected = d.lines.some((l) => l.qty_ok !== null);
  const decided = d.lines.some((l) => l.refund_qty !== null || l.replace_qty !== null || l.none_qty !== null);
  return (
    <div className="a-scroll">
      <table className="a-table">
        <thead><tr><th>SKU</th><th>Batch</th><th className="a-num">Packs</th><th className="a-num">Received</th>
          {inspected && <><th className="a-num">OK (R)</th><th className="a-num">Damaged</th><th className="a-num">Expired</th><th className="a-num">Not recd.</th></>}
          {decided && <><th className="a-num">Refund</th><th className="a-num">Replace</th><th className="a-num">No refund</th></>}</tr></thead>
        <tbody>{d.lines.map((l) => (
          <tr key={l.line_id}>
            <td><code>{l.sku_code}</code><small className="a-muted a-person-sub">{l.name} - {l.size_label}</small></td>
            <td>{l.batch_no ? <>{l.batch_no}<small className={`a-person-sub${l.batch_expired ? ' a-bad' : ' a-muted'}`}>exp. {day(l.expiry_date)}{l.batch_expired ? ' (expired)' : ''}</small></> : '-'}</td>
            <td className="a-num">{l.qty}</td><td className="a-num">{l.qty_received}</td>
            {inspected && <><td className="a-num">{l.qty_ok ?? ''}</td><td className="a-num">{l.qty_damaged ?? ''}</td><td className="a-num">{l.qty_expired ?? ''}</td><td className="a-num">{l.qty_missing ?? ''}</td></>}
            {decided && <><td className="a-num">{l.refund_qty ?? ''}</td><td className="a-num">{l.replace_qty ?? ''}</td><td className="a-num">{l.none_qty ?? ''}</td></>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** courier reverse pickup: courier and AWB (Returns edit); a trip pickup is planned in Delivery > Ready */
function Collection({ d, onChanged }) {
  const act = useAction();
  const canEdit = useCan('returns', 'edit');
  const [f, setF] = useState({ courier_id: d.couriers[0] ? String(d.couriers[0].courier_id) : '', awb_no: '' });
  if (!['requested', 'collecting'].includes(d.status)) return null;
  if (d.collection === 'trip') {
    const onTrip = d.trips.find((t) => t.status === 'pending');
    return <Notice kind="info">{d.picked_up_at ? 'Picked up by the driver: scan it in when the trip is back.' : onTrip ? `On trip T-${onTrip.trip_id}: the driver marks it Picked up with a photo.` : 'Put it on a trip: Delivery > Ready for a trip > Returns to pick up.'}</Notice>;
  }
  if (d.collection === 'bring') return <Notice kind="info">The customer brings it to the godown: scan it in when it arrives.</Notice>;
  if (d.awb_no || !canEdit) return d.awb_no ? null : <Notice kind="info">Waits for the courier reverse pickup (AWB).</Notice>;
  const save = () => act.run(async () => { await api.send('POST', `/commerce/returns/${d.return_no}/courier`, f); onChanged(); }, `Courier reverse pickup booked: AWB ${f.awb_no.toUpperCase()}`);
  return (
    <div className="a-card">
      <h3>Courier reverse pickup</h3>
      {act.note}
      <div className="a-grid2">
        <label className="a-field"><span>Courier</span><select value={f.courier_id} aria-label="Courier" onChange={(e) => setF({ ...f, courier_id: e.target.value })}>{d.couriers.map((c) => <option key={c.courier_id} value={c.courier_id}>{c.name}</option>)}</select></label>
        <label className="a-field"><span>AWB number</span><input value={f.awb_no} aria-label="AWB number" onChange={(e) => setF({ ...f, awb_no: e.target.value })} /></label>
      </div>
      <button type="button" className="a-btn" disabled={act.busy || !f.awb_no.trim()} onClick={save}>Save AWB</button>
    </div>
  );
}

/** receive (scan each pack) and inspect at the godown (Inventory edit) */
function Receive({ d, onChanged, onDone }) {
  const act = useAction();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [last, setLast] = useState(null);
  const [lines, setLines] = useState(d.lines);
  const [insp, setInsp] = useState(null); // { [line_id]: { ok, damaged, expired, missing } }
  const [note, setNote] = useState('');
  useEffect(() => { setLines(d.lines); }, [d]);
  useEffect(() => { if (inputRef.current && !insp) inputRef.current.focus(); }, [insp]);
  const scan = (e) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setCode('');
    act.run(async () => { const res = await api.send('POST', `/commerce/returns/${d.return_no}/scan`, { code: c }); setLast(res); setLines(res.lines); if (d.status !== 'received' && res.result === 'ok') onChanged(); });
  };
  const got = lines.reduce((a, l) => a + l.qty_received, 0);
  const need = lines.reduce((a, l) => a + l.qty, 0);
  const startInspect = () => setInsp(Object.fromEntries(lines.map((l) => [l.line_id, { ok: String(l.qty_received), damaged: '0', expired: '0', missing: String(l.qty - l.qty_received) }])));
  const setI = (id, k, v) => setInsp((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const sumOf = (v) => ['ok', 'damaged', 'expired', 'missing'].reduce((a, k) => a + (Number(v[k]) || 0), 0);
  const bad = insp && lines.some((l) => sumOf(insp[l.line_id]) !== l.qty);
  const save = async () => {
    const what = lines.map((l) => { const v = insp[l.line_id]; return `${l.sku_code}${l.batch_no ? `/${l.batch_no}` : ''}: ${v.ok} OK, ${v.damaged} damaged, ${v.expired} expired, ${v.missing} not received`; }).join('; ');
    if (!(await confirm({ title: `Inspection of ${d.return_no}?`, message: `${what}. OK packs go to Returned (R) stock, damaged to Damaged, expired to Expired (blocked).`, action: 'Save inspection' }))) return;
    act.run(async () => { await api.send('POST', `/commerce/returns/${d.return_no}/inspect`, { lines: lines.map((l) => ({ line_id: l.line_id, ...insp[l.line_id] })), note }); onDone({ kind: 'ok', text: `${d.return_no} inspected: ${what}.` }); });
  };
  return (
    <div className="a-card">
      <h3>Receive and inspect at the godown</h3>
      {act.note}
      {!insp && (
        <>
          <form onSubmit={scan} className="a-packscan">
            <label className="a-field"><span>Scan each pack or carton (or type the code and press Enter)</span>
              <input ref={inputRef} value={code} aria-label="Return scan" autoComplete="off" placeholder="DF001-M100, DF044-M100/WW2509, DF001-M100#C" onChange={(e) => setCode(e.target.value)} /></label>
          </form>
          {last && <div className={`a-scanmsg ${last.result === 'ok' ? 'ok' : 'bad'}`} role="alert">{last.result === 'ok' ? 'OK ' : 'NOT COUNTED: '}{last.message}</div>}
          <p className="a-packprogress"><b>{got} of {need} packs received</b></p>
          <button type="button" className="a-btn" disabled={act.busy || !got} onClick={startInspect}>Inspect{got < need ? ` (${need - got} not received)` : ''}</button>
        </>
      )}
      {insp && (
        <>
          <div className="a-scroll">
            <table className="a-table a-insp">
              <thead><tr><th>SKU / batch</th><th className="a-num">Packs</th><th className="a-num">OK</th><th className="a-num">Damaged</th><th className="a-num">Expired</th><th className="a-num">Not recd.</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.line_id} className={sumOf(insp[l.line_id]) !== l.qty ? 'a-lowrow' : undefined}>
                  <td><code>{l.sku_code}</code>{l.batch_no && <small className="a-muted a-person-sub">batch {l.batch_no}{l.batch_expired ? ' (expired)' : ''}</small>}</td>
                  <td className="a-num">{l.qty}<small className="a-muted a-person-sub">{l.qty_received} recd.</small></td>
                  {['ok', 'damaged', 'expired', 'missing'].map((k) => (
                    <td key={k} className="a-num"><input type="number" min="0" step="1" inputMode="numeric" value={insp[l.line_id][k]} disabled={k === 'expired' && !l.batch_id}
                      aria-label={`${k} ${l.sku_code}`} onChange={(e) => setI(l.line_id, k, e.target.value)} /></td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {bad && <p className="a-bad">Each line must add up to its packs.</p>}
          <label className="a-field"><span>Inspection notes (optional)</span><input value={note} maxLength={255} aria-label="Inspection notes" onChange={(e) => setNote(e.target.value)} /></label>
          <span className="a-row">
            <button type="button" className="a-btn" disabled={act.busy || bad} onClick={save}>Save inspection</button>
            <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setInsp(null)}>Back to scanning</button>
          </span>
        </>
      )}
    </div>
  );
}

/** refund / replacement / no refund per line (Returns edit); the server issues the credit note before a refund */
function Decide({ d, onDone }) {
  const act = useAction();
  const confirm = useConfirm();
  const open = d.lines.filter((l) => l.left > 0);
  const [v, setV] = useState(() => Object.fromEntries(open.map((l) => [l.line_id, { refund: String(l.left), replace: '0', none: '0' }])));
  const unpaid = d.amount_paid <= 0.005;
  const [f, setF] = useState({ method: unpaid && d.amount_due > 0 ? 'balance' : 'wallet', mode: Object.keys(d.modes)[0] || 'cash', reference: '', received_on: today(), no_refund_reason: '' });
  const tot = (k) => open.reduce((a, l) => a + (Number(v[l.line_id][k]) || 0), 0);
  const bad = open.some((l) => ['refund', 'replace', 'none'].reduce((a, k) => a + (Number(v[l.line_id][k]) || 0), 0) !== l.left);
  const save = async () => {
    const parts = [tot('refund') ? `refund ${tot('refund')} pack(s): credit note first, then ${d.methods[f.method].toLowerCase()}` : null,
      tot('replace') ? `replace ${tot('replace')} pack(s): a Rs 0 order` : null, tot('none') ? `no refund for ${tot('none')} pack(s)${d.noRefundApproval ? ' (waits for approval)' : ''}` : null].filter(Boolean);
    if (!(await confirm({ title: `Decide ${d.return_no}?`, message: `${parts.join('; ')}.${tot('refund') && d.refundRule.on ? ` A refund above ${rs(d.refundRule.above)} waits for approval.` : ''}`, action: 'Save decision' }))) return;
    act.run(async () => {
      const res = await api.send('POST', `/commerce/returns/${d.return_no}/decide`, { ...f, lines: open.map((l) => ({ line_id: l.line_id, ...v[l.line_id] })) });
      onDone({ kind: res.pending.length ? 'info' : 'ok', text: [res.refund ? `Refund ${rs(res.refund.amount)}${res.pending.includes('refund') ? ' waits for approval' : ' paid with its credit note'}` : null,
        res.replacement_no ? `replacement order ${res.replacement_no}` : null, res.pending.includes('no_refund') ? '"No refund" waits for approval' : null].filter(Boolean).join('; ') });
    });
  };
  return (
    <div className="a-card">
      <h3>Refund, replace or no refund</h3>
      {act.note}
      <div className="a-scroll">
        <table className="a-table a-insp">
          <thead><tr><th>SKU / batch</th><th className="a-num">To decide</th><th className="a-num">Refund</th><th className="a-num">Replace</th><th className="a-num">No refund</th></tr></thead>
          <tbody>{open.map((l) => (
            <tr key={l.line_id}>
              <td><code>{l.sku_code}</code><small className="a-muted a-person-sub">{l.batch_no ? `batch ${l.batch_no} · ` : ''}{l.qty_ok || 0} OK, {l.qty_damaged || 0} damaged, {l.qty_expired || 0} expired</small></td>
              <td className="a-num">{l.left}</td>
              {['refund', 'replace', 'none'].map((k) => <td key={k} className="a-num"><input type="number" min="0" step="1" inputMode="numeric" value={v[l.line_id][k]} aria-label={`${k} ${l.sku_code}`} onChange={(e) => setV({ ...v, [l.line_id]: { ...v[l.line_id], [k]: e.target.value } })} /></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {bad && <p className="a-bad">Each line must add up to the packs to decide.</p>}
      {tot('refund') > 0 && (
        <>
          <p className="a-muted">The credit note is issued at the invoice&apos;s own tax ({d.gst_type === 'intra' ? 'CGST + SGST' : 'IGST'}) for the refunded packs; the refund is its total. Paid on the order: {rs(d.amount_paid)}, due: {rs(Math.max(d.amount_due, 0))}.</p>
          <div className="a-grid2">
            <label className="a-field"><span>Refund to</span><select value={f.method} aria-label="Refund to" onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(d.methods).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            {f.method === 'original' && <label className="a-field"><span>Mode</span><select value={f.mode} aria-label="Refund mode" onChange={(e) => setF({ ...f, mode: e.target.value })}>{Object.entries(d.modes).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>}
          </div>
          {f.method === 'original' && <label className="a-field"><span>Reference (UTR / cheque / transaction no.{f.mode === 'cash' ? ', optional' : ''})</span><input value={f.reference} maxLength={60} aria-label="Refund reference" onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>}
        </>
      )}
      {tot('none') > 0 && <label className="a-field"><span>Why no refund? (required{d.noRefundApproval ? ', goes to approval' : ''})</span><input value={f.no_refund_reason} maxLength={255} aria-label="No refund reason" onChange={(e) => setF({ ...f, no_refund_reason: e.target.value })} /></label>}
      <button type="button" className="a-btn" disabled={act.busy || bad || (tot('none') > 0 && !f.no_refund_reason.trim())} onClick={save}>Save decision</button>
    </div>
  );
}
