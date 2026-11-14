// Returns and refunds (docs/COMMERCE-SPEC.md 4.8, 5.5, 6.2; migration 20261021_commerce_09_returns.sql). Shared by the
// admin routes, the delivery trips (pickup stops) and the demo seed. Every step writes return_history and the audit log.
// 1. Request (a delivered order, entered when the customer calls): lines of SKU and batch as delivered (partial is
//    fine, never more than delivered minus earlier returns), a reason from the list, photos optional. Outside the
//    return window (days after delivery, Commerce setting) it is refused or waits for approval (setting).
// 2. Collection: the customer brings it (Collecting at once), a pickup stop on a delivery trip (Collecting when on a
//    trip; the driver marks it picked up with a photo) or a courier reverse pickup (AWB = Collecting).
// 3. Receive and inspect at the godown: each pack scanned (SKU, SKU/BATCH, SKU#C: the pack check rules against the
//    return lines); per line OK -> Returned (R) shelf, Damaged -> Damaged shelf, Expired -> Returned shelf (its batch is expired: blocked), Not received;
//    stock movements keep the batch. Inspector, time and notes kept.
// 4. Decide per line: refund, replacement or no refund. A refund issues the credit note (the invoice's own tax) first,
//    then: to the wallet, to the original payment (mode and reference typed) or less to pay on an unpaid order. Above
//    the refund threshold it waits for approval; a "No refund" waits for approval (setting). A replacement is a Rs 0
//    order through the normal pick-pack-deliver flow. A rejected approval makes those packs undecided again.
// 5. Recheck: Returned (R) packs back to good stock, only when the setting allows resale, always through approval.
// Phase 23 (v23 retFromCancel): an order cancelled after dispatch opens a return "Collecting" with the packs that left
// (fromCancel); Receive and Inspect put them on the Returned / Damaged shelf, then it closes with no refund (the
// invoice was cancelled with a credit note already).
// Phase 22 (v23 section 12): inspection decides each pack: resell (it goes on the Returned shelf and the rule "Returned
// stock back to Good" moves it to Good once signed), repack or damaged (Damaged shelf), scrap (a write-off from the
// Returned shelf under the write-off rule), expired, not received. A return whose order had "buy X get Y" free packs
// credits less the free packs no longer due (invoices.offerKept), so the credit note and the refund agree.
const { audit } = require('./audit');
const approvals = require('./approvals');
const commerce = require('./commerce');
const commerceSettings = require('./commerce-settings');
const notifications = require('./notifications');
const { storable } = require('./photo-check');
const invoices = require('./invoices');
const numbering = require('./numbering');
const promotions = require('./promotions');
const stock = require('./stock');
const wallet = require('./wallet');

const STATUS_LABEL = { requested: 'Requested', collecting: 'Collecting', received: 'Received', inspected: 'Inspected', refunded: 'Refunded', replaced: 'Replaced', closed: 'Closed', rejected: 'Rejected' };
const COLLECTION = { bring: 'Customer brings it', trip: 'Pickup on a delivery trip', courier: 'Courier reverse pickup' };
const METHODS = { wallet: 'Refund to the wallet', original: 'Refund to the original payment', balance: 'Less to pay (unpaid order)' };
const round2 = (n) => Math.round(n * 100) / 100;
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const IST_TODAY = istDates.IST_TODAY_SQL;

class ReturnError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const wrap = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e instanceof commerce.CommerceError || e instanceof stock.StockError || e instanceof invoices.InvoiceError) throw new ReturnError(e.message, e.status);
    throw e;
  }
};

async function history(q, returnId, status, note, empId) {
  await q.query('INSERT INTO return_history (return_id, status, note, emp_id) VALUES (?, ?, ?, ?)', [returnId, status, note ? String(note).slice(0, 255) : null, empId]);
}
async function lockReturn(q, returnNo, allowed) {
  const [[r]] = await q.query('SELECT r.*, o.order_no, o.customer_id FROM returns r JOIN orders o ON o.order_id = r.order_id WHERE r.return_no = ? FOR UPDATE', [returnNo]);
  if (!r) throw new ReturnError(`No return ${returnNo}`, 404);
  if (allowed && !allowed.includes(r.status)) throw new ReturnError(`${returnNo} is ${STATUS_LABEL[r.status]}: not possible now`, 409);
  return r;
}
async function setStatus(q, r, to, empId, note = null, extra = {}) {
  const cols = Object.keys(extra);
  await q.query(`UPDATE returns SET status = ?, ${cols.map((c) => `${c} = ?, `).join('')}version = version + 1 WHERE return_id = ?`, [to, ...Object.values(extra), r.return_id]);
  await history(q, r.return_id, to, note, empId);
  await audit(q, { empId, action: 'status', entity: 'return', entityId: r.return_no, before: { status: r.status }, after: { status: to, note, ...extra } });
}
async function pendingOf(q, returnNo) {
  const [rows] = await q.query("SELECT approval_id, kind FROM approvals WHERE ref_type = 'return' AND ref_id = ? AND status = 'pending'", [returnNo]);
  return rows;
}

const CANCEL_REASON = 'Order cancelled after dispatch';
/**
 * an order cancelled after dispatch (commerce.doCancel): the packs that left the godown for it (SKU and batch, net of
 * any already back) come back as a return to collect -> { return_no, packs } or null when nothing left
 */
async function fromCancel(q, orderId, why, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, godown_id FROM orders WHERE order_id = ?', [orderId]);
  const [rows] = await q.query(`SELECT sku_code, batch_id, -SUM(delta) AS qty FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND move_type = 'out'
      GROUP BY sku_code, batch_id HAVING qty > 0 ORDER BY sku_code, batch_id`, [o.order_no]);
  if (!rows.length) return null;
  const [[reason]] = await q.query('SELECT reason_id FROM return_reasons WHERE label = ?', [CANCEL_REASON]);
  if (!reason) throw new ReturnError(`The return reason "${CANCEL_REASON}" is missing (migration 23_05)`, 500);
  const s = await commerceSettings.read(q);
  const yy = String(commerce.istYear()).padStart(2, '0');
  const returnNo = `${s.return_prefix}-${yy}${numbering.pad(await numbering.next(q, `${s.return_prefix}-${yy}`, 1))}`;
  const [ins] = await q.query(`INSERT INTO returns (return_no, order_id, godown_id, status, reason_id, reason_note, delivered_on, window_days, outside_window, collection, requested_by)
      VALUES (?, ?, ?, 'collecting', ?, ?, ${IST_TODAY}, 0, 0, 'bring', ?)`,
  [returnNo, o.order_id, o.godown_id, reason.reason_id, `${CANCEL_REASON}: ${why}`.slice(0, 255), empId]);
  for (const r of rows) await q.query('INSERT INTO return_items (return_id, sku_code, batch_id, qty) VALUES (?, ?, ?, ?)', [ins.insertId, r.sku_code, r.batch_id, Number(r.qty)]);
  const packs = rows.reduce((a, r) => a + Number(r.qty), 0);
  await history(q, ins.insertId, 'collecting', `${o.order_no} cancelled after dispatch: ${packs} packs come back with the vehicle or courier. Receive and inspect them; the invoice was cancelled with a credit note, so no refund here.`, empId);
  await audit(q, { empId, action: 'create', entity: 'return', entityId: returnNo, after: { order: o.order_no, reason: CANCEL_REASON, why, collection: 'bring', lines: rows.map((r) => `${Number(r.qty)} x ${r.sku_code}`) } });
  return { return_no: returnNo, packs };
}
const fromCancelled = async (q, r) => { const [[x]] = await q.query('SELECT label FROM return_reasons WHERE reason_id = ?', [r.reason_id]); return Boolean(x && x.label === CANCEL_REASON); };

/** what can still be returned from an order: per SKU and batch, delivered packs minus earlier returns */
async function returnable(q, orderId) {
  const [[o]] = await q.query('SELECT order_no FROM orders WHERE order_id = ?', [orderId]);
  const [out] = await q.query(
    `SELECT m.sku_code, m.batch_id, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, -SUM(m.delta) AS qty
       FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id
      WHERE m.ref_type = 'order' AND m.ref_id = ? AND m.move_type = 'out' GROUP BY m.sku_code, m.batch_id, b.batch_no, b.expiry_date HAVING qty > 0`, [o.order_no]);
  const [back] = await q.query(`SELECT ri.sku_code, ri.batch_id, SUM(ri.qty - COALESCE(ri.qty_missing, 0)) AS qty FROM return_items ri JOIN returns r ON r.return_id = ri.return_id
      WHERE r.order_id = ? AND r.status <> 'rejected' GROUP BY ri.sku_code, ri.batch_id`, [orderId]);
  const used = new Map(back.map((x) => [`${x.sku_code}|${x.batch_id || ''}`, Number(x.qty)]));
  const [names] = out.length ? await q.query(`SELECT s.sku_code, s.size_label, COALESCE(t.name, pt.name, s.product_id) AS name, (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image FROM skus s JOIN products p ON p.product_id = s.product_id
      LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en' LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
      WHERE s.sku_code IN (?)`, [out.map((x) => x.sku_code)]) : [[]];
  const nm = new Map(names.map((x) => [x.sku_code, x]));
  return out.map((x) => ({ ...x, ...nm.get(x.sku_code), delivered: Number(x.qty), qty: Number(x.qty) - (used.get(`${x.sku_code}|${x.batch_id || ''}`) || 0) }));
}

/**
 * data = { lines: [{ sku_code, batch_id, qty }], reason_id, reason_note, collection: bring | trip | courier }
 * -> { return_no, status, outside_window, approval_id }
 */
async function createReturn(q, orderNo, data, empId) {
  const [[o]] = await q.query(`SELECT order_id, order_no, customer_id, godown_id, status, DATE_FORMAT(CONVERT_TZ(delivered_at, '+00:00', '+05:30'), '%Y-%m-%d') AS delivered_on,
      DATEDIFF(${IST_TODAY}, DATE(CONVERT_TZ(delivered_at, '+00:00', '+05:30'))) AS days FROM orders WHERE order_no = ? FOR UPDATE`, [orderNo]);
  if (!o) throw new ReturnError(`No order ${orderNo}`, 404);
  if (o.status !== 'delivered') throw new ReturnError(`${orderNo} is ${commerce.STATUS_LABEL[o.status]}: only a delivered order can be returned`, 409);
  const [[reason]] = await q.query('SELECT reason_id, label FROM return_reasons WHERE reason_id = ? AND is_active = 1', [Number(data.reason_id)]);
  if (!reason) throw new ReturnError('Choose the reason');
  if (!COLLECTION[data.collection]) throw new ReturnError('How does it come back: the customer brings it, a pickup on a trip, or a courier');
  const can = await returnable(q, o.order_id);
  const lines = [];
  for (const l of Array.isArray(data.lines) ? data.lines : []) {
    const qty = Number(l.qty);
    if (!qty) continue;
    const sku = String(l.sku_code || '').toUpperCase();
    const batchId = l.batch_id ? Number(l.batch_id) : null;
    const c = can.find((x) => x.sku_code === sku && (x.batch_id || null) === batchId);
    if (!c) throw new ReturnError(`${sku}${batchId ? ' in that batch' : ''} was not delivered on ${orderNo}`);
    // phase 22: the same pack and batch twice counts together against what can still come back
    const same = lines.find((x) => x.sku_code === sku && x.batch_id === batchId);
    if (!Number.isInteger(qty) || qty < 0 || qty + (same ? same.qty : 0) > c.qty) throw new ReturnError(`${sku}${c.batch_no ? ` batch ${c.batch_no}` : ''}: at most ${c.qty} pack(s) can still be returned`);
    if (same) { same.qty += qty; continue; }
    lines.push({ sku_code: sku, batch_id: batchId, qty });
  }
  if (!lines.length) throw new ReturnError('Choose at least one pack to return');
  const s = await commerceSettings.read(q);
  const windowDays = Number(s.return_window_days) || 0;
  const outside = Number(o.days) > windowDays;
  if (outside && s.return_outside_window === 'refuse') throw new ReturnError(`${orderNo} was delivered ${o.days} days ago: returns are accepted within ${windowDays} days`, 409);
  const yy = String(commerce.istYear()).padStart(2, '0');
  const returnNo = `${s.return_prefix}-${yy}${numbering.pad(await numbering.next(q, `${s.return_prefix}-${yy}`, 1))}`;
  const status = !outside && data.collection === 'bring' ? 'collecting' : 'requested';
  const [ins] = await q.query(
    `INSERT INTO returns (return_no, order_id, godown_id, status, reason_id, reason_note, delivered_on, window_days, outside_window, collection, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [returnNo, o.order_id, o.godown_id, status, reason.reason_id, String(data.reason_note || '').trim().slice(0, 255) || null, o.delivered_on, windowDays, outside ? 1 : 0, data.collection, empId]);
  for (const l of lines) await q.query('INSERT INTO return_items (return_id, sku_code, batch_id, qty) VALUES (?, ?, ?, ?)', [ins.insertId, l.sku_code, l.batch_id, l.qty]);
  await history(q, ins.insertId, 'requested', `${reason.label}; ${COLLECTION[data.collection]}${outside ? `; ${o.days} days after delivery (window ${windowDays})` : ''}`, empId);
  let approvalId = null;
  if (outside) {
    const [[c]] = await q.query('SELECT name FROM customers c JOIN orders o ON o.customer_id = c.customer_id WHERE o.order_id = ?', [o.order_id]);
    approvalId = await approvals.request(q, { kind: 'return_window', godownId: o.godown_id, target: `cust:${o.customer_id}`, refType: 'return', refId: returnNo,
      summary: `${returnNo} on ${orderNo} (${c.name}): ${o.days} days after delivery, the window is ${windowDays} days - ${lines.map((l) => `${l.qty} x ${l.sku_code}`).join(', ')}`,
      payload: { return_no: returnNo } }, empId);
  }
  await audit(q, { empId, action: 'create', entity: 'return', entityId: returnNo, after: { order: orderNo, reason: reason.label, collection: data.collection, outside_window: outside, lines: lines.map((l) => `${l.qty} x ${l.sku_code}`) } });
  if (!outside) await notifications.returnAccepted(q, ins.insertId); // outside the window: when it is approved
  return { return_id: ins.insertId, return_no: returnNo, status, outside_window: outside, approval_id: approvalId };
}

async function addPhoto(q, returnNo, kind, file, empId) {
  const r = await lockReturn(q, returnNo);
  if (!['request', 'pickup', 'inspect'].includes(kind)) throw new ReturnError('Photo kind: request, pickup or inspect');
  const pic = await storable(file); // checked by its bytes and made small (photo-check.js)
  if (!pic) throw new ReturnError('Photo: a JPEG, PNG or WebP picture');
  const [ins] = await q.query('INSERT INTO return_photos (return_id, kind, photo, photo_type, emp_id) VALUES (?, ?, ?, ?, ?)', [r.return_id, kind, pic.buffer, pic.mimetype, empId]);
  await history(q, r.return_id, 'photo', `${kind} photo added`, empId);
  return { photo_id: ins.insertId };
}

/** courier reverse pickup: courier and AWB -> Collecting */
async function setCourier(q, returnNo, b, empId) {
  const r = await lockReturn(q, returnNo, ['requested', 'collecting']);
  if (r.collection !== 'courier') throw new ReturnError(`${returnNo} is not collected by courier`);
  if ((await pendingOf(q, returnNo)).some((p) => p.kind === 'return_window')) throw new ReturnError(`${returnNo} waits for approval (outside the return window)`, 409);
  const [[c]] = await q.query('SELECT courier_id, name FROM couriers WHERE courier_id = ? AND is_active = 1', [Number(b.courier_id)]);
  if (!c) throw new ReturnError('Choose the courier');
  const awb = String(b.awb_no || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(awb)) throw new ReturnError('AWB number: 6 to 40 letters or digits');
  await setStatus(q, r, 'collecting', empId, `${c.name} reverse pickup, AWB ${awb}`, { courier_id: c.courier_id, awb_no: awb });
  return { return_no: returnNo, status: 'collecting' };
}

/** a pickup stop was added to a trip (delivery.js) */
async function onTrip(q, returnNo, tripId, empId) {
  const r = await lockReturn(q, returnNo, ['requested', 'collecting']);
  if (r.collection !== 'trip') throw new ReturnError(`${returnNo} is not collected on a trip`);
  if ((await pendingOf(q, returnNo)).some((p) => p.kind === 'return_window')) throw new ReturnError(`${returnNo} waits for approval (outside the return window)`, 409);
  if (r.status === 'requested') await setStatus(q, r, 'collecting', empId, `Pickup on trip T-${tripId}`);
  else await history(q, r.return_id, 'collecting', `Pickup on trip T-${tripId}`, empId);
  return r;
}
/** the driver picked it up (photo kept with the return's photos) */
async function pickedUp(q, returnNo, tripId, empId, photo, from) {
  const r = await lockReturn(q, returnNo, ['collecting']);
  await q.query('UPDATE returns SET picked_up_at = UTC_TIMESTAMP(), picked_up_by = ? WHERE return_id = ?', [empId, r.return_id]);
  if (photo) await q.query("INSERT INTO return_photos (return_id, kind, photo, photo_type, emp_id) VALUES (?, 'pickup', ?, ?, ?)", [r.return_id, photo.buffer, photo.mimetype, empId]);
  await history(q, r.return_id, 'picked_up', `Picked up by the driver (trip T-${tripId})${from ? ` from ${from}` : ''}${photo ? ', photo' : ''}`, empId);
  await audit(q, { empId, action: 'picked_up', entity: 'return', entityId: returnNo, after: { trip: `T-${tripId}`, from, photo: Boolean(photo) } });
  await notifications.returnPicked(q, r.return_id);
  return r;
}
async function pickupFailed(q, returnNo, tripId, reason, empId) {
  const r = await lockReturn(q, returnNo);
  await history(q, r.return_id, 'pickup_failed', `Pickup failed (trip T-${tripId}): ${reason}; put it on another trip`, empId);
  await audit(q, { empId, action: 'pickup_failed', entity: 'return', entityId: returnNo, after: { trip: `T-${tripId}`, reason } });
}

/** the Operations cards: returns to collect (no window approval pending, not picked up) and to inspect */
async function opsCounts(q, scope = null) {
  const g = scope === null ? ['1 = 1', []] : [scope.length ? 'r.godown_id IN (?)' : '1 = 0', scope.length ? [scope] : []];
  const [[r]] = await q.query(
    `SELECT SUM(r.status IN ('requested', 'collecting') AND r.picked_up_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.ref_type = 'return' AND a.ref_id = r.return_no AND a.kind = 'return_window' AND a.status = 'pending')) AS to_collect,
            SUM(r.status = 'received' OR (r.status = 'collecting' AND r.picked_up_at IS NOT NULL)) AS to_inspect,
            SUM(r.status = 'inspected') AS to_decide
       FROM returns r WHERE r.status IN ('requested', 'collecting', 'received', 'inspected') AND ${g[0]}`, g[1]);
  return { returnsToCollect: Number(r.to_collect) || 0, returnsToInspect: Number(r.to_inspect) || 0, returnsToDecide: Number(r.to_decide) || 0 };
}

// ---------------------------------------------------------------- receive and inspect
async function receiveState(q, returnId) {
  const [lines] = await q.query(
    `SELECT ri.line_id, ri.sku_code, ri.batch_id, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, (b.expiry_date < ${IST_TODAY}) AS batch_expired,
            ri.qty, ri.qty_received, ri.qty_ok, ri.qty_damaged, ri.qty_expired, ri.qty_missing, ri.qty_repack, ri.qty_scrap, ri.resell_approval_id, ri.scrap_write_off_id, ri.refund_qty, ri.replace_qty, ri.none_qty,
            s.size_label, s.packs_per_carton, COALESCE(t.name, pt.name, s.product_id) AS name, p.track_batches, (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
       FROM return_items ri JOIN skus s ON s.sku_code = ri.sku_code JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en' LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN batches b ON b.batch_id = ri.batch_id WHERE ri.return_id = ? ORDER BY ri.line_id`, [returnId]);
  return lines.map((l) => ({ ...l, batch_expired: Number(l.batch_expired) === 1, track_batches: Number(l.track_batches) === 1 }));
}

/** a scan at the godown against the return lines (pack check rules); the first scan marks it Received */
async function receiveScan(q, returnNo, raw, empId) {
  const r = await lockReturn(q, returnNo, ['requested', 'collecting', 'received']);
  if ((await pendingOf(q, returnNo)).some((p) => p.kind === 'return_window')) throw new ReturnError(`${returnNo} waits for approval (outside the return window)`, 409);
  // phase 14: a supplier EAN or a stored carton code scans as its SKU (or SKU#C), like the SKU's own label
  const code = await require('./catalogue').scanCode(q, raw);
  if (!code) throw new ReturnError('Scan a pack or a carton');
  const m = /^([A-Z0-9-]+)(?:\/([A-Z0-9/-]+?))?(#C)?$/.exec(code);
  const lines = await receiveState(q, r.return_id);
  let result = 'ok'; let message; let lineId = null; let qty = 0;
  const sku = m ? m[1] : null;
  const mine = lines.filter((l) => l.sku_code === sku);
  if (!m || !mine.length) {
    result = mine.length || !m ? 'unknown' : 'wrong_sku';
    message = m ? `${sku} is not on ${returnNo}: keep it apart` : `${code}: not a dFresh pack or carton code`;
  } else {
    qty = m[3] ? Number(mine[0].packs_per_carton) || 1 : 1;
    let line = mine[0];
    if (mine[0].track_batches) {
      line = m[2] ? mine.find((l) => l.batch_no === m[2]) : null;
      if (!m[2]) { result = 'wrong_batch'; message = `${sku} is returned by batch: scan the batch label (${sku}/${mine[0].batch_no})`; }
      else if (!line) { result = 'wrong_batch'; message = `${sku} batch ${m[2]}: not the batch delivered on this order (${mine.map((l) => l.batch_no).join(', ')})`; }
    }
    if (result === 'ok' && line.qty_received + qty > line.qty) { result = 'too_many'; message = `${sku}${line.batch_no ? ` batch ${line.batch_no}` : ''}: too many - ${line.qty_received} of ${line.qty} received already`; }
    if (result === 'ok') { lineId = line.line_id; message = `${sku}${line.batch_no ? ` batch ${line.batch_no}` : ''}: ${line.qty_received + qty} of ${line.qty}`; } else qty = 0;
  }
  await q.query('INSERT INTO return_scans (return_id, code, sku_code, batch_id, qty, result, message, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [r.return_id, code, sku, lineId ? lines.find((l) => l.line_id === lineId).batch_id : null, qty, result, message.slice(0, 255), empId]);
  if (lineId) await q.query('UPDATE return_items SET qty_received = qty_received + ? WHERE line_id = ?', [qty, lineId]);
  if (lineId && r.status !== 'received') {
    await setStatus(q, r, 'received', empId, 'At the godown (first pack scanned)', { received_at: new Date(), received_by: empId });
    await notifications.returnPicked(q, r.return_id); // courier or brought in (a trip pickup was told when picked up)
  }
  return { result, message, lines: await receiveState(q, r.return_id) };
}

/** inspection: per line resell / repack / damaged / scrap / expired / missing (they add up to the line's packs); stock movements */
async function inspect(q, returnNo, b, empId) {
  const r = await lockReturn(q, returnNo, ['received']); // inspected = what was scanned in at the godown (security review L5)
  if ((await pendingOf(q, returnNo)).some((p) => p.kind === 'return_window')) throw new ReturnError(`${returnNo} waits for approval (outside the return window)`, 409);
  const lines = await receiveState(q, r.return_id);
  const given = new Map((Array.isArray(b.lines) ? b.lines : []).map((l) => [Number(l.line_id), l]));
  const plan = [];
  for (const l of lines) {
    const g = given.get(l.line_id) || {};
    // "ok" (before phase 22) is resell
    const v = [g.resell !== undefined ? g.resell : g.ok, g.damaged, g.expired, g.missing, g.repack, g.scrap].map((k) => Number(k || 0));
    if (v.some((x) => !Number.isInteger(x) || x < 0)) throw new ReturnError(`${l.sku_code}: whole numbers, 0 or more`);
    const tag = `${l.sku_code}${l.batch_no ? ` batch ${l.batch_no}` : ''}`;
    if (v.reduce((a, x) => a + x, 0) !== l.qty) throw new ReturnError(`${tag}: resell + repack + damaged + scrap + expired + not received must be ${l.qty} (adds up to ${v.reduce((a, x) => a + x, 0)})`);
    if (v[0] + v[1] + v[2] + v[4] + v[5] > Number(l.qty_received)) throw new ReturnError(`${tag}: only ${l.qty_received} scanned in at the godown; the rest is "not received"`);
    if (v[2] && !l.batch_id) throw new ReturnError(`${l.sku_code}: "Expired" is only for products tracked by batch`);
    if (v[0] && l.batch_expired) throw new ReturnError(`${tag} has expired: it cannot be sold again (choose Expired or Scrap)`);
    plan.push({ l, ok: v[0], damaged: v[1], expired: v[2], missing: v[3], repack: v[4], scrap: v[5] });
  }
  const sset = await commerceSettings.read(q);
  if (plan.some((x) => x.ok) && !sset.returned_resell) throw new ReturnError('Returned stock cannot be sold again (Commerce settings > Returns): choose repack, damaged or scrap', 409);
  const note = String(b.note || '').trim().slice(0, 255) || null;
  const waits = [];
  for (const x of plan) {
    await q.query('UPDATE return_items SET qty_ok = ?, qty_damaged = ?, qty_expired = ?, qty_missing = ?, qty_repack = ?, qty_scrap = ? WHERE line_id = ?', [x.ok, x.damaged, x.expired, x.missing, x.repack, x.scrap, x.l.line_id]);
    // shelves (phase 12a): resell -> Returned (ret) until "Returned stock back to Good" is signed, repack and damaged ->
    // Damaged (dmg), expired -> Returned (its batch has expired: blocked there until written off), scrap -> Returned, then
    // written off under the write-off rule
    for (const [shelf, n, label] of [['ret', x.ok, 'resell (Returned until it is signed back to Good)'], ['dmg', x.repack, 'to repack'], ['dmg', x.damaged, 'damaged'], ['ret', x.expired, 'expired (blocked)'], ['ret', x.scrap, 'scrap']]) {
      if (!n) continue;
      await stock.moveStock(q, { sku: x.l.sku_code, godown: r.godown_id, shelf, qty: n, batch: x.l.batch_id, what: 'return', doc: { type: 'return', id: returnNo }, note: `${returnNo} inspected: ${label}` }, empId);
    }
    if (x.ok) {
      const payload = { sku_code: x.l.sku_code, godown_id: r.godown_id, batch_id: x.l.batch_id, qty: x.ok, note: `Return ${returnNo} inspected: resell${note ? ` - ${note}` : ''}`, return_no: returnNo };
      if (await approvals.needed(q, 'restock', {})) {
        const id = await approvals.request(q, { kind: 'restock', godownId: r.godown_id, refType: 'return', refId: returnNo, summary: `${returnNo}: ${x.ok} packs of ${x.l.sku_code}${x.l.batch_no ? ` batch ${x.l.batch_no}` : ''} from Returned (R) back to Good (resell)`, payload }, empId);
        await q.query('UPDATE return_items SET resell_approval_id = ? WHERE line_id = ?', [id, x.l.line_id]);
        waits.push(`Returned stock back to Good (${x.ok} ${x.l.sku_code})`);
      } else await stock.moveShelf(q, { sku: x.l.sku_code, godown: r.godown_id, from: 'ret', to: 'good', qty: x.ok, batch: x.l.batch_id, what: 'recheck', doc: { type: 'return', id: returnNo }, note: payload.note }, empId);
    }
    if (x.scrap) {
      const w = await stock.requestWriteOff(q, { godown_id: r.godown_id, sku_code: x.l.sku_code, stock_kind: 'ret', batch_id: x.l.batch_id, qty: x.scrap, reason_type: 'custret', reason: `Return ${returnNo} inspected: scrap${note ? ` - ${note}` : ''}` }, empId)
        .catch((e) => { if (e instanceof stock.StockError) throw new ReturnError(e.message, e.status); throw e; });
      await q.query('UPDATE return_items SET scrap_write_off_id = ? WHERE line_id = ?', [w.write_off_id, x.l.line_id]);
      if (w.status !== 'posted') waits.push(`Stock write-off (${x.scrap} ${x.l.sku_code})`);
    }
  }
  await setStatus(q, r, 'inspected', empId, `${plan.map((x) => `${x.l.sku_code}${x.l.batch_no ? `/${x.l.batch_no}` : ''}: ${x.ok} resell, ${x.repack} repack, ${x.damaged} damaged, ${x.scrap} scrap, ${x.expired} expired, ${x.missing} not received`).join('; ')}${note ? ` - ${note}` : ''}`,
    { inspected_at: new Date(), inspected_by: empId, inspect_note: note, ...(r.received_at ? {} : { received_at: new Date(), received_by: empId }) });
  if (await fromCancelled(q, r)) {
    // phase 23: the order was cancelled after dispatch and its invoice cancelled with a credit note: nothing to refund
    for (const x of plan) await q.query('UPDATE return_items SET none_qty = ? WHERE line_id = ?', [x.ok + x.damaged + x.expired + x.repack + x.scrap, x.l.line_id]);
    await setStatus(q, { ...r, status: 'inspected' }, 'closed', empId, 'Order cancelled after dispatch: its invoice was cancelled with a credit note, so there is no refund to decide.', { closed_at: new Date() });
    return { return_no: returnNo, status: 'closed', waiting: waits, message: `Inspected and closed (the order was cancelled; no refund).${waits.length ? ` Waiting for approval: ${waits.join(', ')}.` : ''}` };
  }
  return { return_no: returnNo, status: 'inspected', waiting: waits, message: waits.length ? `Inspected. Waiting for approval: ${waits.join(', ')}. The stock stays on the Returned shelf until then.` : 'Inspected.' };
}

// ---------------------------------------------------------------- decide: refund / replacement / no refund
const leftOf = (l) => (Number(l.qty_ok || 0) + Number(l.qty_damaged || 0) + Number(l.qty_expired || 0) + Number(l.qty_repack || 0) + Number(l.qty_scrap || 0)) - Number(l.refund_qty || 0) - Number(l.replace_qty || 0) - Number(l.none_qty || 0);

/**
 * b = { lines: [{ line_id, refund, replace, none }] (for the packs still undecided), method: wallet | original | balance,
 *       mode, reference (original), no_refund_reason } -> { refund, replacement_no, pending: [kinds] }
 */
async function decide(q, returnNo, b, empId) {
  const r = await lockReturn(q, returnNo, ['inspected']);
  const lines = await receiveState(q, r.return_id);
  const given = new Map((Array.isArray(b.lines) ? b.lines : []).map((l) => [Number(l.line_id), l]));
  const dec = [];
  for (const l of lines) {
    const left = leftOf(l);
    if (!left) continue;
    const g = given.get(l.line_id) || {};
    const v = ['refund', 'replace', 'none'].map((k) => Number(g[k] || 0));
    if (v.some((x) => !Number.isInteger(x) || x < 0)) throw new ReturnError(`${l.sku_code}: whole numbers, 0 or more`);
    if (v[0] + v[1] + v[2] !== left) throw new ReturnError(`${l.sku_code}${l.batch_no ? ` batch ${l.batch_no}` : ''}: refund + replace + no refund must be ${left}`);
    dec.push({ l, refund: v[0], replace: v[1], none: v[2] });
  }
  if (!dec.length) throw new ReturnError('Every pack is decided already');
  const refundLines = dec.filter((d) => d.refund).map((d) => ({ line_id: d.l.line_id, sku_code: d.l.sku_code, qty: d.refund }));
  const replaceLines = dec.filter((d) => d.replace).map((d) => ({ line_id: d.l.line_id, sku_code: d.l.sku_code, qty: d.replace }));
  const noneLines = dec.filter((d) => d.none).map((d) => ({ line_id: d.l.line_id, sku_code: d.l.sku_code, qty: d.none }));
  const pending = [];
  let refund = null;
  let replacementNo = null;
  if (refundLines.length) {
    const method = METHODS[b.method] ? b.method : null;
    if (!method) throw new ReturnError('Refund how: to the wallet, to the original payment, or less to pay');
    const amount = await creditTotal(q, r.order_id, refundLines);
    const [[o]] = await q.query('SELECT payment_terms, amount_due, amount_paid FROM orders WHERE order_id = ?', [r.order_id]);
    let mode = null; let reference = null;
    if (method === 'original') {
      mode = String(b.mode || '');
      if (!commerce.MODES[mode]) throw new ReturnError(`Mode: ${Object.values(commerce.MODES).join(', ')}`);
      reference = String(b.reference || '').trim().slice(0, 60) || null;
      if (mode !== 'cash' && !reference) throw new ReturnError('Give the refund reference (UTR / cheque / transaction no.)');
      if (amount > Number(o.amount_paid) + 0.005) throw new ReturnError(`Only Rs ${Number(o.amount_paid).toFixed(2)} was paid on this order: refund to the wallet, or less to pay`);
    }
    if (method === 'balance' && amount > Number(o.amount_due) + 0.005) throw new ReturnError(`The customer owes only Rs ${Math.max(Number(o.amount_due), 0).toFixed(2)} on this order: refund to the wallet or the original payment`);
    for (const x of refundLines) await q.query('UPDATE return_items SET refund_qty = COALESCE(refund_qty, 0) + ? WHERE line_id = ?', [x.qty, x.line_id]);
    const [ins] = await q.query('INSERT INTO refunds (return_id, order_id, method, mode, reference, amount, status, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [r.return_id, r.order_id, method, mode, reference, amount, 'approval', empId]);
    refund = { refund_id: ins.insertId, amount, method };
    const target = `cust:${r.customer_id}`;
    if (await approvals.needed(q, 'refund', { amount, target })) {
      const id = await approvals.request(q, { kind: 'refund', godownId: r.godown_id, target, refType: 'return', refId: returnNo, summary: `${returnNo}: refund Rs ${amount.toFixed(2)} (${METHODS[method].toLowerCase()}) for ${refundLines.map((x) => `${x.qty} x ${x.sku_code}`).join(', ')}`,
        amount, payload: { return_no: returnNo, refund_id: ins.insertId, lines: refundLines } }, empId);
      await q.query('UPDATE refunds SET approval_id = ? WHERE refund_id = ?', [id, ins.insertId]);
      pending.push('refund');
    } else {
      await payRefund(q, ins.insertId, empId);
      await approvals.direct(q, 'refund', { amount, target }, empId);
    }
  }
  if (replaceLines.length) {
    for (const x of replaceLines) await q.query('UPDATE return_items SET replace_qty = COALESCE(replace_qty, 0) + ? WHERE line_id = ?', [x.qty, x.line_id]);
    const [[o]] = await q.query(`SELECT customer_id, delivery_method_id, delivery_area_id, order_no, bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone,
        ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone FROM orders WHERE order_id = ?`, [r.order_id]);
    const addr = (k) => ({ name: o[`${k}_name`], gstin: k === 'bill' ? o.bill_gstin : null, address: o[`${k}_address`], town: o[`${k}_town`], state_code: o[`${k}_state_code`], pincode: o[`${k}_pincode`], phone: o[`${k}_phone`] });
    const merged = new Map();
    replaceLines.forEach((x) => merged.set(x.sku_code, (merged.get(x.sku_code) || 0) + x.qty));
    const rep = await wrap(() => commerce.createOrder(q, { customer_id: o.customer_id, items: [...merged].map(([sku, qty]) => ({ sku_code: sku, qty, price: 0 })), payment_terms: 'advance',
      delivery_method_id: o.delivery_method_id, delivery_area_id: o.delivery_area_id === null ? '' : o.delivery_area_id, bill: addr('bill'), ship: addr('ship'), note: `Replacement for ${returnNo} (${o.order_no})` }, empId, { replacement: true }));
    await q.query('UPDATE returns SET replacement_order_id = ? WHERE return_id = ?', [rep.order_id, r.return_id]);
    await history(q, r.return_id, 'replacement', `Replacement order ${rep.order_no} (Rs 0): ${replaceLines.map((x) => `${x.qty} x ${x.sku_code}`).join(', ')}`, empId);
    replacementNo = rep.order_no;
  }
  if (noneLines.length) {
    const why = String(b.no_refund_reason || '').trim().slice(0, 255);
    if (!why) throw new ReturnError('Say why there is no refund');
    for (const x of noneLines) await q.query('UPDATE return_items SET none_qty = COALESCE(none_qty, 0) + ? WHERE line_id = ?', [x.qty, x.line_id]);
    await q.query('UPDATE returns SET no_refund_reason = ? WHERE return_id = ?', [why, r.return_id]);
    if (await approvals.needed(q, 'no_refund', {})) {
      await approvals.request(q, { kind: 'no_refund', godownId: r.godown_id, target: `cust:${r.customer_id}`, refType: 'return', refId: returnNo, summary: `${returnNo}: no refund for ${noneLines.map((x) => `${x.qty} x ${x.sku_code}`).join(', ')} - ${why}`, payload: { return_no: returnNo, lines: noneLines } }, empId);
      pending.push('no_refund');
    } else await history(q, r.return_id, 'no_refund', why, empId);
  }
  await q.query('UPDATE returns SET refund_method = COALESCE(?, refund_method) WHERE return_id = ?', [refund ? refund.method : null, r.return_id]);
  await history(q, r.return_id, 'decided', [refundLines.length ? `refund ${refundLines.map((x) => `${x.qty} x ${x.sku_code}`).join(', ')} (${METHODS[b.method]})` : null,
    replaceLines.length ? `replace ${replaceLines.map((x) => `${x.qty} x ${x.sku_code}`).join(', ')}` : null, noneLines.length ? `no refund ${noneLines.map((x) => `${x.qty} x ${x.sku_code}`).join(', ')}` : null].filter(Boolean).join('; '), empId);
  await audit(q, { empId, action: 'decide', entity: 'return', entityId: returnNo, after: { refund: refundLines, replace: replaceLines, none: noneLines, method: b.method || null, pending } });
  await finalize(q, returnNo, empId);
  return { refund, replacement_no: replacementNo, pending };
}

/** the credit note total (incl. GST, rounded as the invoice) for these packs: what the customer gets back */
async function creditTotal(q, orderId, lines) {
  // phase 22: exactly what invoices.creditNoteForReturn will credit (paid packs at their price, free ones at 0, free packs no longer due off)
  let t = 0;
  for (const k of await invoices.creditParts(q, orderId, lines)) t += k.taxable + k.cgst + k.sgst + k.igst;
  t = round2(t);
  const s = await commerceSettings.read(q);
  return s.invoice_round_off ? Math.round(t) : round2(t);
}

/** issue the credit note, then pay the refund (wallet / refund payment / less to pay) */
async function payRefund(q, refundId, empId) {
  const [[f]] = await q.query('SELECT f.*, r.return_no, r.return_id FROM refunds f JOIN returns r ON r.return_id = f.return_id WHERE f.refund_id = ? FOR UPDATE', [refundId]);
  if (!f || f.status !== 'approval') return;
  const [[ap]] = f.approval_id ? await q.query('SELECT payload FROM approvals WHERE approval_id = ?', [f.approval_id]) : [[null]];
  let lines;
  if (ap) lines = (typeof ap.payload === 'string' ? JSON.parse(ap.payload) : ap.payload).lines;
  else {
    const [ls] = await q.query('SELECT line_id, sku_code, refund_qty AS qty FROM return_items WHERE return_id = ? AND refund_qty > 0', [f.return_id]);
    const [paidLines] = await q.query("SELECT cl.sku_code, SUM(cl.qty) AS qty FROM credit_note_lines cl JOIN credit_notes cn ON cn.credit_note_id = cl.credit_note_id WHERE cn.return_id = ? GROUP BY cl.sku_code", [f.return_id]);
    const done = new Map(paidLines.map((x) => [x.sku_code, Number(x.qty)]));
    lines = ls.map((l) => { const d = Math.min(done.get(l.sku_code) || 0, l.qty); done.set(l.sku_code, (done.get(l.sku_code) || 0) - d); return { ...l, qty: l.qty - d }; }).filter((l) => l.qty > 0);
  }
  const merged = new Map();
  lines.forEach((x) => merged.set(x.sku_code, (merged.get(x.sku_code) || 0) + Number(x.qty)));
  const cn = await wrap(() => invoices.creditNoteForReturn(q, f.order_id, [...merged].map(([sku, qty]) => ({ sku_code: sku, qty })), `Return ${f.return_no}`, f.return_id, empId));
  let paymentId = null;
  if (f.method === 'wallet') {
    const [[o]] = await q.query('SELECT customer_id FROM orders WHERE order_id = ?', [f.order_id]);
    await wallet.credit(q, { customerId: o.customer_id, source: 'refund', amount: cn.total, reason: `Refund ${f.return_no} (credit note ${cn.credit_note_no})`, orderId: f.order_id, returnId: f.return_id }, empId);
  } else if (f.method === 'original') {
    const [[o]] = await q.query('SELECT order_no FROM orders WHERE order_id = ?', [f.order_id]);
    const pr = await wrap(() => commerce.recordPayment(q, o.order_no, { kind: 'refund', amount: cn.total.toFixed(2), mode: f.mode, reference: f.reference, note: `Refund ${f.return_no}, credit note ${cn.credit_note_no}` }, empId, { internal: true })); // decided (and approved) in Returns
    paymentId = pr.payment_id;
  }
  await q.query("UPDATE refunds SET status = 'paid', amount = ?, credit_note_id = ?, payment_id = ?, paid_at = UTC_TIMESTAMP() WHERE refund_id = ?", [cn.total, cn.credit_note_id, paymentId, refundId]);
  await commerce.refreshPayment(q, f.order_id);
  // cashback already credited on this order: the share of the refunded goods is taken back (phase 7)
  const back = await promotions.reverseCashback(q, f.order_id, cn.taxable, f.return_id, f.return_no, empId);
  if (back > 0) await history(q, f.return_id, 'cashback_back', `Cashback taken back: Rs ${back.toFixed(2)} from the wallet`, empId);
  await history(q, f.return_id, 'refund_paid', `Credit note ${cn.credit_note_no} (${cn.gst_type === 'intra' ? `CGST ${cn.cgst.toFixed(2)} + SGST ${cn.sgst.toFixed(2)}` : `IGST ${cn.igst.toFixed(2)}`}); Rs ${cn.total.toFixed(2)} ${METHODS[f.method].toLowerCase()}`, empId);
  await audit(q, { empId, action: 'refund', entity: 'return', entityId: f.return_no, after: { amount: cn.total, method: f.method, credit_note: cn.credit_note_no, mode: f.mode, reference: f.reference } });
  await notifications.returnRefunded(q, refundId); // with the credit note PDF
}

/** every pack decided and no approval pending: Refunded, Replaced or Closed */
async function finalize(q, returnNo, empId) {
  const r = await lockReturn(q, returnNo);
  if (r.status !== 'inspected') return;
  if ((await pendingOf(q, returnNo)).length) return;
  const lines = await receiveState(q, r.return_id);
  if (lines.some((l) => leftOf(l) > 0)) return;
  const [[paid]] = await q.query("SELECT COUNT(*) AS n FROM refunds WHERE return_id = ? AND status = 'paid'", [r.return_id]);
  const to = Number(paid.n) ? 'refunded' : r.replacement_order_id ? 'replaced' : 'closed';
  await setStatus(q, r, to, empId, to === 'refunded' && r.replacement_order_id ? 'Refund and replacement' : null, { closed_at: new Date() });
}

/** an approval that ends without approval: those packs are undecided again (decide once more) */
async function undo(q, returnNo, lines, col, note, empId) {
  const r = await lockReturn(q, returnNo);
  for (const x of lines || []) await q.query(`UPDATE return_items SET ${col} = GREATEST(COALESCE(${col}, 0) - ?, 0) WHERE line_id = ?`, [x.qty, x.line_id]);
  await history(q, r.return_id, 'undecided', note, empId);
}

approvals.onApproved('return_window', async (q, p, empId) => {
  const r = await lockReturn(q, p.return_no);
  if (r.status === 'requested' && r.collection === 'bring') await setStatus(q, r, 'collecting', empId, 'Approved outside the window: the customer brings it');
  else await history(q, r.return_id, 'approved', 'Approved outside the window', empId);
  await notifications.returnAccepted(q, r.return_id);
});
approvals.onClosed('return_window', async (q, p, status, empId) => {
  const r = await lockReturn(q, p.return_no);
  if (['requested', 'collecting'].includes(r.status)) await setStatus(q, r, 'rejected', empId, `Outside the return window: approval ${status}`, { closed_at: new Date() });
});
approvals.onApproved('refund', async (q, p, empId) => {
  if (!p || !p.refund_id || p.credit) return; // older demo requests carry no refund; phase 21: a credit-balance refund is money.js's
  await payRefund(q, p.refund_id, empId);
  await finalize(q, p.return_no, empId);
});
approvals.onClosed('refund', async (q, p, status, empId) => {
  if (!p || !p.refund_id || p.credit) return;
  await q.query("UPDATE refunds SET status = 'rejected' WHERE refund_id = ? AND status = 'approval'", [p.refund_id]);
  await undo(q, p.return_no, p.lines, 'refund_qty', `Refund approval ${status}: decide those packs again`, empId);
});
approvals.onApproved('no_refund', async (q, p, empId) => { await finalize(q, p.return_no, empId); });
approvals.onClosed('no_refund', async (q, p, status, empId) => { await undo(q, p.return_no, p.lines, 'none_qty', `No refund ${status}: decide those packs again`, empId); });

// ---------------------------------------------------------------- recheck: Returned (R) -> good stock
async function recheckRequest(q, b, empId) {
  const s = await commerceSettings.read(q);
  if (!s.returned_resell) throw new ReturnError('Returned stock cannot be sold again (Commerce settings > Returns): it stays in (R) until written off', 409);
  const sku = String(b.sku_code || '').trim().toUpperCase();
  const qty = Number(b.qty);
  const batchId = b.batch_id ? Number(b.batch_id) : null;
  const godown = Number(b.godown_id);
  if (!godown) throw new ReturnError('Choose the godown');
  if (!Number.isInteger(qty) || qty < 1) throw new ReturnError('Packs: a whole number from 1');
  const there = await retThere(q, sku, godown, batchId);
  if (there < qty) throw new ReturnError(`Only ${there} packs of ${sku} in Returned (R)${batchId ? ' for that batch' : ' without a batch'} at this godown`);
  const [[bn]] = batchId ? await q.query(`SELECT batch_no, (expiry_date < ${IST_TODAY}) AS expired FROM batches WHERE batch_id = ?`, [batchId]) : [[{}]];
  if (Number(bn.expired) === 1) throw new ReturnError(`${sku} batch ${bn.batch_no} has expired: it cannot go back to good stock`, 409);
  const note = String(b.note || '').trim().slice(0, 200);
  if (!note) throw new ReturnError('What did the recheck find? (e.g. sealed, clean, sellable)');
  const id = await approvals.request(q, { kind: 'restock', godownId: godown, refType: 'stock', refId: sku, summary: `Recheck: ${qty} packs of ${sku}${bn.batch_no ? ` batch ${bn.batch_no}` : ''} from Returned (R) back to good stock - ${note}`,
    payload: { sku_code: sku, godown_id: godown, batch_id: batchId, qty, note } }, empId);
  await audit(q, { empId, action: 'recheck_request', entity: 'stock', entityId: sku, after: { godown, qty, batch_id: batchId, note, approval: id } });
  return { approval_id: id };
}
/** packs of a SKU on the Returned shelf of a godown: of one batch, or (no batch) those without a batch */
async function retThere(q, sku, godown, batchId) {
  const [[st]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE location_id = ? AND sku_code = ? AND stock_kind = 'ret' AND ${batchId ? 'batch_id = ?' : 'batch_id IS NULL'}`,
    batchId ? [godown, sku, batchId] : [godown, sku]);
  return Number(st.n);
}
// requests raised before phase 12a carry no godown: they were all at Kanchipuram (godown 1)
// phase 18: a shelf move back to Good (Damaged or Returned) and a transfer short Found use this rule too: inventory.js
const inv = () => require('./inventory'); // eslint-disable-line global-require
approvals.onRecheck('restock', async (q, p) => {
  if (p.move_id) return inv().moveRecheck(q, p.move_id);
  const there = await retThere(q, p.sku_code, p.godown_id || 1, p.batch_id);
  return there < p.qty ? `only ${there} packs of ${p.sku_code} are left in Returned (R)` : '';
});
approvals.onApproved('restock', async (q, p, empId) => {
  if (p.move_id) { await inv().postMove(q, p.move_id, empId); return; }
  const godown = p.godown_id || 1;
  const there = await retThere(q, p.sku_code, godown, p.batch_id);
  if (there < p.qty) throw new ReturnError(`Only ${there} packs left in Returned (R): the recheck cannot post`, 409);
  await stock.moveShelf(q, { sku: p.sku_code, godown, from: 'ret', to: 'good', qty: p.qty, batch: p.batch_id, what: 'recheck', doc: { type: 'recheck', id: null }, note: `Recheck: ${p.note}` }, empId);
  await audit(q, { empId, action: 'recheck', entity: 'stock', entityId: p.sku_code, after: { godown, qty: p.qty, batch_id: p.batch_id } });
});
approvals.onClosed('restock', async (q, p, status, empId) => { if (p && p.move_id) await inv().moveClosed(q, p.move_id, status, empId); });
// phase 22 (v23 12.8): a resell that is not signed sends those packs back to be inspected again; they stay on the
// Returned shelf until then (reinspect below). The money side does not change: the packs are still counted as back.
approvals.onClosed('restock', async (q, p, status, empId) => {
  if (!p || !p.return_no) return;
  const [[r]] = await q.query('SELECT return_id FROM returns WHERE return_no = ?', [p.return_no]);
  if (!r) return;
  await history(q, r.return_id, 'sent_back', `Sent back. Returned stock back to Good: ${status} by ${await inv().nameOf(q, empId)}. ${p.qty} packs of ${p.sku_code} stay on the Returned shelf: inspect them again.`, empId);
});

/**
 * phase 22 (v23 12.8): inspect again the resell packs whose "back to Good" was not signed.
 * b = { lines: [{ line_id, resell, repack, damaged, scrap }] } (each adds up to the line's resell packs) -> { waiting, message }
 */
async function reinspect(q, returnNo, b, empId) {
  const r = await lockReturn(q, returnNo, ['inspected', 'refunded', 'replaced', 'closed']);
  const lines = await receiveState(q, r.return_id);
  const given = new Map((Array.isArray(b.lines) ? b.lines : []).map((l) => [Number(l.line_id), l]));
  const sset = await commerceSettings.read(q);
  const waits = []; let done = 0;
  for (const l of lines) {
    const g = given.get(l.line_id);
    if (!g || !l.resell_approval_id) continue;
    const [[a]] = await q.query('SELECT status FROM approvals WHERE approval_id = ?', [l.resell_approval_id]);
    if (!a || a.status === 'pending' || a.status === 'approved') throw new ReturnError(`${l.sku_code}: its resell is ${a ? a.status : 'gone'}, nothing to inspect again`, 409);
    const v = ['resell', 'repack', 'damaged', 'scrap'].map((k) => Number(g[k] || 0));
    if (v.some((x) => !Number.isInteger(x) || x < 0)) throw new ReturnError(`${l.sku_code}: whole numbers, 0 or more`);
    const n = Number(l.qty_ok);
    if (v.reduce((x, y) => x + y, 0) !== n) throw new ReturnError(`${l.sku_code}: resell + repack + damaged + scrap must be ${n}`);
    if (v[0] && !sset.returned_resell) throw new ReturnError('Returned stock cannot be sold again (Commerce settings > Returns): choose repack, damaged or scrap', 409);
    const note = `${returnNo} inspected again`;
    if (v[1] + v[2]) await stock.moveShelf(q, { sku: l.sku_code, godown: r.godown_id, from: 'ret', to: 'dmg', qty: v[1] + v[2], batch: l.batch_id, what: 'recheck', doc: { type: 'return', id: returnNo }, note: `${note}: ${v[1]} repack, ${v[2]} damaged` }, empId);
    let woId = l.scrap_write_off_id;
    if (v[3]) {
      const w = await stock.requestWriteOff(q, { godown_id: r.godown_id, sku_code: l.sku_code, stock_kind: 'ret', batch_id: l.batch_id, qty: v[3], reason_type: 'custret', reason: `${note}: scrap` }, empId)
        .catch((e) => { if (e instanceof stock.StockError) throw new ReturnError(e.message, e.status); throw e; });
      woId = w.write_off_id;
      if (w.status !== 'posted') waits.push(`Stock write-off (${v[3]} ${l.sku_code})`);
    }
    let resellId = null;
    if (v[0]) {
      const payload = { sku_code: l.sku_code, godown_id: r.godown_id, batch_id: l.batch_id, qty: v[0], note: `${note}: resell`, return_no: returnNo };
      if (await approvals.needed(q, 'restock', {})) {
        resellId = await approvals.request(q, { kind: 'restock', godownId: r.godown_id, refType: 'return', refId: returnNo, summary: `${returnNo}: ${v[0]} packs of ${l.sku_code} from Returned (R) back to Good (resell, inspected again)`, payload }, empId);
        waits.push(`Returned stock back to Good (${v[0]} ${l.sku_code})`);
      } else await stock.moveShelf(q, { sku: l.sku_code, godown: r.godown_id, from: 'ret', to: 'good', qty: v[0], batch: l.batch_id, what: 'recheck', doc: { type: 'return', id: returnNo }, note: payload.note }, empId);
    }
    await q.query('UPDATE return_items SET qty_ok = ?, qty_repack = COALESCE(qty_repack, 0) + ?, qty_damaged = COALESCE(qty_damaged, 0) + ?, qty_scrap = COALESCE(qty_scrap, 0) + ?, resell_approval_id = ?, scrap_write_off_id = ? WHERE line_id = ?',
      [v[0], v[1], v[2], v[3], resellId, woId, l.line_id]);
    await history(q, r.return_id, 'inspected', `${l.sku_code} inspected again: ${v[0]} resell, ${v[1]} repack, ${v[2]} damaged, ${v[3]} scrap`, empId);
    done += 1;
  }
  if (!done) throw new ReturnError('Nothing to inspect again');
  return { return_no: returnNo, waiting: waits, message: waits.length ? `Inspected again. Waiting for approval: ${waits.join(', ')}.` : 'Inspected again.' };
}
approvals.onAgain('restock', async (q, p) => {
  if (!p.move_id) return '';
  const [[w]] = await q.query('SELECT status FROM write_offs WHERE write_off_id = ? FOR UPDATE', [p.move_id]);
  if (!w || w.status !== 'rejected') return 'the move is no longer there';
  await q.query("UPDATE write_offs SET status = 'pending' WHERE write_off_id = ?", [p.move_id]);
  return inv().moveRecheck(q, p.move_id);
});

module.exports = { STATUS_LABEL, COLLECTION, METHODS, ReturnError, returnable, createReturn, fromCancel, CANCEL_REASON, addPhoto, setCourier, onTrip, pickedUp, pickupFailed, opsCounts, receiveState, receiveScan, inspect, reinspect, decide, leftOf, recheckRequest, finalize };
