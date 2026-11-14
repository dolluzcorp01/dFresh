// Packing and delivery (docs/COMMERCE-SPEC.md 5.3, 5.4; migration 20261021_commerce_08_delivery.sql). Shared by the admin
// routes and the demo seed. Every step writes the order history and the audit log (commerce.setStatus).
// Packing: New orders are picked (pick list: one or many orders grouped by SKU and batch, earliest expiry first, with
// the SKU's bin) and become Packing; every pack or carton is scanned against the order (SKU, SKU/BATCH for batch-
// tracked products, SKU#C = one full carton); a wrong SKU, wrong batch or too many is refused with a red message.
// Packed needs everything matched (or the override: "approve" on Packing, with a reason) plus cartons and weight.
// Delivery, by the order's delivery method kind:
// - own vehicle: packed orders go on a trip (vehicle, driver, stops in route order); Start trip = the goods leave
//   (stock out, invoice) and the orders are Out for delivery; per stop the driver marks Delivered (receiver, photo,
//   OTP when the Commerce setting is on) or Failed (reason) and records cash collected (a payment); End trip compares
//   the cash collected with the cash handed over. A failed order is re-attempted (Packed again, next trip) or returned
//   to the godown (cancelled: goods back, invoice cancelled with a credit note).
// - courier: AWB (and the e-way bill no. above the setting amount) = Handed to courier (the goods leave); then
//   Delivered. The courier's tracking link has {awb} replaced.
// - customer pickup: Collected = the goods leave and the order is Delivered.
// Return pickups (phase 6): a return collected on a trip is a stop of kind "pickup" (return_id); nothing leaves the
// godown for it at Start trip; the driver marks it Picked up with a photo (or Failed: the return waits for another trip).
// A stop is keyed by its order no. (delivery) or its return no. (pickup).
const { audit } = require('./audit');
const approvals = require('./approvals');
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const commerce = require('./commerce');
const commerceSettings = require('./commerce-settings');
const notifications = require('./notifications');
const { storable } = require('./photo-check');
const crypto = require('crypto');
const returns = require('./returns');
const fulfil = require('./fulfil');
const stock = require('./stock');
const godowns = require('./godowns');
const { inScope } = require('./scope-sql');

const CASH_WHY = ['Customer paid part, rest on account', 'Customer will pay by UPI or bank', 'Price dispute', 'Change not available']; // phase 20 (v23)
const REFUSE_REASONS = ['Damaged in transit', 'Wrong item', 'Not ordered', 'Price dispute', 'Other']; // phase 20 (v23)
const FAIL_REASONS = ['Customer not available', 'Shop / office closed', 'Address not found', 'Refused the goods', 'No cash ready (pay on delivery)', 'Vehicle problem', 'Other'];
const round2 = (n) => Math.round(n * 100) / 100;

class DeliveryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const wrap = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e instanceof fulfil.FulfilError) { const x = new DeliveryError(e.message, e.status); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } throw x; }
    if (e instanceof commerce.CommerceError || e instanceof stock.StockError || e instanceof returns.ReturnError) throw new DeliveryError(e.message, e.status); throw e;
  }
};

const ORDER_SELECT = 'SELECT order_id, order_no, status, delivery_kind, delivery_method_id, dispatched_at, total, amount_due, payment_terms, courier_id FROM orders';
async function lockOrder(q, orderNo, allowed) {
  const [[o]] = await q.query(`${ORDER_SELECT} WHERE order_no = ? FOR UPDATE`, [orderNo]);
  if (!o) throw new DeliveryError(`No order ${orderNo}`, 404);
  if (allowed && !allowed.includes(o.status)) throw new DeliveryError(`${orderNo} is ${commerce.STATUS_LABEL[o.status]}: not possible now`, 409);
  return o;
}

// ---------------------------------------------------------------- packing
/** the pick list of these orders: SKU and batch lines (earliest expiry first) with bin and which order takes how many */
async function pickList(q, orderNos) {
  if (!orderNos.length) throw new DeliveryError('Choose at least one order');
  const [orders] = await q.query(`SELECT o.order_id, o.order_no, o.godown_id, o.status, c.name AS customer FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_no IN (?) ORDER BY o.order_id`, [orderNos]);
  const bad = orders.filter((o) => !['new', 'packing'].includes(o.status));
  if (bad.length) throw new DeliveryError(`Only New or Packing orders: ${bad.map((o) => `${o.order_no} is ${commerce.STATUS_LABEL[o.status]}`).join(', ')}`);
  const lines = new Map();
  const add = (sku, batch, qty, orderNo) => {
    const k = `${sku}|${batch || ''}`;
    if (!lines.has(k)) lines.set(k, { sku_code: sku, batch_id: batch, qty: 0, orders: [] });
    const l = lines.get(k);
    l.qty += qty;
    l.orders.push(`${orderNo} x ${qty}`);
  };
  const tentative = new Map(); // batch_id -> qty taken by the New orders in this list
  if (new Set(orders.map((o) => o.godown_id)).size > 1) throw new DeliveryError('One pick list per godown: choose orders of one godown');
  for (const o of orders) {
    const [picks] = await q.query('SELECT sku_code, batch_id, qty FROM order_picks WHERE order_id = ?', [o.order_id]);
    if (o.status === 'packing' && picks.length) { picks.forEach((p) => add(p.sku_code, p.batch_id, p.qty, o.order_no)); continue; }
    const [sums] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM order_items WHERE order_id = ? GROUP BY sku_code ORDER BY sku_code', [o.order_id]); // a free line may repeat a SKU
    const items = sums.map((x) => ({ sku_code: x.sku_code, qty: Number(x.qty) }));
    const tr = await stock.tracked(q, items.map((i) => i.sku_code));
    for (const i of items) {
      if (!tr.has(i.sku_code)) { add(i.sku_code, null, i.qty, o.order_no); continue; }
      const [taken] = await q.query(`SELECT pk.batch_id, SUM(pk.qty) AS qty FROM order_picks pk JOIN orders x ON x.order_id = pk.order_id
          WHERE pk.sku_code = ? AND x.godown_id = ? AND x.status IN ('packing', 'packed') AND x.dispatched_at IS NULL GROUP BY pk.batch_id`, [i.sku_code, o.godown_id]);
      const used = new Map(taken.map((t) => [t.batch_id, Number(t.qty)]));
      let left = i.qty;
      for (const b of (await stock.batchStock(q, i.sku_code, 'good', { godown: o.godown_id })).filter((x) => x.qty > 0 && !x.expired)) {
        const free = b.qty - (used.get(b.batch_id) || 0) - (tentative.get(b.batch_id) || 0);
        if (free <= 0 || !left) continue;
        const take = Math.min(free, left);
        add(i.sku_code, b.batch_id, take, o.order_no);
        tentative.set(b.batch_id, (tentative.get(b.batch_id) || 0) + take);
        left -= take;
      }
      if (left) add(i.sku_code, null, left, `${o.order_no} (SHORT)`);
    }
  }
  const list = [...lines.values()];
  const [meta] = await q.query(
    `SELECT s.sku_code, s.size_label, s.bin_location, s.packs_per_carton, COALESCE(t.name, pt.name, s.product_id) AS name
       FROM skus s JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en' WHERE s.sku_code IN (?)`, [list.map((l) => l.sku_code)]);
  const m = new Map(meta.map((x) => [x.sku_code, x]));
  const ids = list.map((l) => l.batch_id).filter(Boolean);
  const [bs] = ids.length ? await q.query("SELECT batch_id, batch_no, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date FROM batches WHERE batch_id IN (?)", [ids]) : [[]];
  const bm = new Map(bs.map((b) => [b.batch_id, b]));
  const rows = list.map((l) => ({ ...l, ...m.get(l.sku_code), batch_no: l.batch_id ? bm.get(l.batch_id).batch_no : null, expiry_date: l.batch_id ? bm.get(l.batch_id).expiry_date : null }))
    .sort((a, b) => String(a.bin_location || 'zzz').localeCompare(String(b.bin_location || 'zzz')) || a.sku_code.localeCompare(b.sku_code) || String(a.expiry_date || '').localeCompare(String(b.expiry_date || '')));
  return { orders, rows };
}

/** New -> Packing for these orders: the picks are saved (batches fixed), reservation if the setting says "at packing" */
async function startPacking(q, orderNos, empId) {
  const done = [];
  for (const no of orderNos) {
    const o = await lockOrder(q, no, ['new']);
    const waiting = await commerce.pendingHolds(q, no);
    if (waiting.length) throw new DeliveryError(`${no} waits for approval`, 409);
    const s0 = await commerceSettings.read(q);
    if (s0.stock_reserve_at !== 'packing' && !(await fulfil.heldOf(q, o.order_id))) throw new DeliveryError(`${no} has nothing held: it waits as a back-order (Sales > Orders > Back-orders)`, 409); // phase 20
    await wrap(() => commerce.pickFor(q, o.order_id));
    const s = await commerceSettings.read(q);
    if (s.stock_reserve_at === 'packing') await commerce.reserve(q, o.order_id);
    await commerce.setStatus(q, o, 'packing', empId, 'Picked (pick list)');
    done.push(no);
  }
  return { started: done };
}

/** what the order needs and what was scanned -> { lines: [{ sku_code, batch_id, batch_no, need, scanned }], complete } */
async function packState(q, orderId) {
  const [picks] = await q.query(
    `SELECT pk.sku_code, pk.batch_id, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, SUM(pk.qty) AS need, s.bin_location, s.packs_per_carton, s.size_label,
            COALESCE(t.name, pt.name, s.product_id) AS name
       FROM order_picks pk JOIN skus s ON s.sku_code = pk.sku_code JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN batches b ON b.batch_id = pk.batch_id
      WHERE pk.order_id = ? GROUP BY pk.sku_code, pk.batch_id, b.batch_no, b.expiry_date, s.bin_location, s.packs_per_carton, s.size_label, t.name, pt.name, s.product_id
      ORDER BY pk.sku_code, b.expiry_date`, [orderId]);
  const [scans] = await q.query(`SELECT ps.sku_code, ps.batch_id, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, MAX(ps.off_plan) AS off_plan, SUM(ps.qty) AS n
      FROM pack_scans ps LEFT JOIN batches b ON b.batch_id = ps.batch_id WHERE ps.order_id = ? AND ps.result = 'ok' GROUP BY ps.sku_code, ps.batch_id, b.batch_no, b.expiry_date`, [orderId]);
  const got = new Map(scans.map((x) => [`${x.sku_code}|${x.batch_id || ''}`, x]));
  // phase 20 (v23): what was packed from the planned batch beyond its plan, or from another batch, is "not the oldest batch"
  const lines = picks.map((p) => { const g = got.get(`${p.sku_code}|${p.batch_id || ''}`); return { ...p, need: Number(p.need), scanned: g ? Number(g.n) : 0, off: g ? Number(g.off_plan) === 1 : false }; });
  for (const x of scans) {
    if (lines.some((l) => l.sku_code === x.sku_code && Number(l.batch_id || 0) === Number(x.batch_id || 0))) continue;
    const p = picks.find((y) => y.sku_code === x.sku_code) || {};
    lines.push({ ...p, batch_id: x.batch_id, batch_no: x.batch_no, expiry_date: x.expiry_date, need: 0, scanned: Number(x.n), off: true });
  }
  const per = new Map();
  lines.forEach((l) => { const v = per.get(l.sku_code) || { need: 0, scanned: 0 }; v.need += l.need; v.scanned += l.scanned; per.set(l.sku_code, v); });
  return { lines, complete: lines.length > 0 && [...per.values()].every((v) => v.scanned === v.need), off: lines.some((l) => l.off) };
}

/**
 * one scan at the packing table -> { result, message, state } (refused scans are kept too). opt (phase 20, v23):
 * n = how many of that label (default 1), batch = the batch chosen in the item's row when the label has none.
 */
async function packScan(q, orderNo, raw, empId, opt = {}) {
  const o0 = await lockOrder(q, orderNo, ['packing']);
  const [[g0]] = await q.query('SELECT godown_id FROM orders WHERE order_id = ?', [o0.order_id]);
  const o = { ...o0, godown_id: g0.godown_id };
  // phase 14: a supplier EAN or a stored carton code scans as its SKU (or SKU#C), like the SKU's own label
  let code = await require('./catalogue').scanCode(q, raw);
  const times = opt.n === undefined || opt.n === null || opt.n === '' ? 1 : Number(opt.n);
  if (!Number.isInteger(times) || times < 1 || times > 999) throw new DeliveryError('How many: a whole number from 1');
  const rowBatch = String(opt.batch || '').trim().toUpperCase();
  if (code && rowBatch && /^[A-Z0-9-]+(#C)?$/.test(code)) code = code.replace(/^([A-Z0-9-]+)(#C)?$/, `$1/${rowBatch}$2`);
  if (!code) throw new DeliveryError('Scan a pack or a carton');
  const m = /^([A-Z0-9-]+)(?:\/([A-Z0-9/-]+?))?(#C)?$/.exec(code);
  const state = await packState(q, o.order_id);
  let result = 'ok';
  let message = '';
  let sku = m ? m[1] : null;
  let batchId = null;
  let qty = 0;
  let off = 0;
  const [[s]] = sku ? await q.query('SELECT s.sku_code, s.packs_per_carton, p.track_batches FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [sku]) : [[null]];
  if (!m || !s) { result = 'unknown'; message = `${code}: not a dFresh pack or carton code`; sku = null; } else {
    const per = m[3] ? Number(s.packs_per_carton) || 1 : 1;
    qty = per * times;
    const mine = state.lines.filter((l) => l.sku_code === sku);
    const need = mine.reduce((a, l) => a + l.need, 0); const done = mine.reduce((a, l) => a + l.scanned, 0); const left = need - done;
    const tooMany = () => `${sku}: too many - only ${left} more needed${m[3] ? `; a carton is ${per} packs: open the carton and scan packs` : ''}`;
    if (!mine.length || !need) { result = 'wrong_sku'; message = `${sku} is not in ${orderNo}: put it back`; qty = 0; } else if (qty > left) { result = 'too_many'; message = tooMany(); qty = 0; } else if (Number(s.track_batches)) {
      const want = mine.filter((l) => l.scanned < l.need).map((l) => l.batch_no);
      if (!m[2]) { result = 'wrong_batch'; message = `${sku} is packed by batch: scan the batch label (${sku}/${(want[0] || mine[0].batch_no)}) or choose the batch in its row`; qty = 0; } else {
        const line = mine.find((l) => l.batch_no === m[2] && l.need > 0);
        if (line && line.scanned + qty <= line.need) { batchId = line.batch_id; message = `${sku} batch ${m[2]}: ${done + qty} of ${need}`; } else {
          // phase 20 (v23): another batch (or more than planned from this one) is allowed when it is there and not expired; the supervisor finishes it
          const lots = await stock.batchStock(q, sku, 'good', { godown: o.godown_id });
          const lot = lots.find((l) => l.batch_no === m[2]);
          const others = lot ? (await stock.scannedLots(q, o.godown_id, sku, orderNo)).get(Number(lot.batch_id)) || 0 : 0;
          const [[mineOn]] = lot ? await q.query("SELECT COALESCE(SUM(qty), 0) AS n FROM pack_scans WHERE order_id = ? AND batch_id = ? AND result = 'ok'", [o.order_id, lot.batch_id]) : [[{ n: 0 }]];
          const free = lot ? lot.qty - others - Number(mineOn.n) : 0;
          if (lot && lot.expired) { result = 'expired'; message = `${sku} batch ${m[2]} expired on ${lot.expiry_date}: it is never packed. Scan another batch.`; qty = 0; } else if (free < qty) {
            result = 'wrong_batch'; message = `${sku} batch ${m[2]}: not in that batch - ${Math.max(0, free)} left${others ? ` (${others} are scanned by another packer)` : ''}. ${orderNo} takes batch ${want.join(', ') || mine.map((l) => l.batch_no).join(', ')} (oldest first).`; qty = 0;
          } else { batchId = lot.batch_id; off = 1; message = `${sku} batch ${m[2]}: ${done + qty} of ${need} - not the batch picked for it (oldest first), your supervisor finishes this packing`; }
        }
      }
    } else message = `${sku}: ${done + qty} of ${need}`;
  }
  await q.query('INSERT INTO pack_scans (order_id, code, sku_code, batch_id, qty, result, message, emp_id, off_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [o.order_id, code, sku, batchId, qty, result.slice(0, 12), message.slice(0, 255), empId, off]);
  return { result, message, off: Boolean(off), state: await packState(q, o.order_id) };
}

/** phase 20 (v23): take one scan off the order (the packer put that pack back) */
async function undoScan(q, orderNo, scanId, empId) {
  const o = await lockOrder(q, orderNo, ['packing']);
  const [[s]] = await q.query("SELECT scan_id, sku_code, qty FROM pack_scans WHERE scan_id = ? AND order_id = ? AND result = 'ok' AND qty > 0", [Number(scanId), o.order_id]);
  if (!s) throw new DeliveryError('That scan is not on this order', 404);
  await q.query('DELETE FROM pack_scans WHERE scan_id = ?', [s.scan_id]);
  await audit(q, { empId, action: 'pack_undo', entity: 'order', entityId: orderNo, before: { sku: s.sku_code, qty: s.qty } });
  return { removed: { sku_code: s.sku_code, qty: Number(s.qty) }, state: await packState(q, o.order_id) };
}

async function resetScans(q, orderNo, empId) {
  const o = await lockOrder(q, orderNo, ['packing']);
  await q.query('DELETE FROM pack_scans WHERE order_id = ?', [o.order_id]);
  await audit(q, { empId, action: 'pack_reset', entity: 'order', entityId: orderNo });
  return { state: await packState(q, o.order_id) };
}

/**
 * Packing -> Packed. b = { cartons, weight_kg, short: { sku: why }, override_reason }; a short packing needs canOverride
 * (Approve on Packing). Phase 20: the scanned packs leave Good now and what is not packed goes to a balance order (fulfil.js).
 */
async function markPacked(q, orderNo, b, empId, canOverride) {
  const o = await lockOrder(q, orderNo, ['packing']);
  const waiting = await commerce.pendingHolds(q, orderNo);
  if (waiting.length) throw new DeliveryError(`${orderNo} waits for approval: it cannot be packed yet`, 409);
  return wrap(() => fulfil.packDone(q, o, b, empId, canOverride));
}
// ---------------------------------------------------------------- trips
async function tripRow(q, tripId, lock = false) {
  const [[t]] = await q.query(`SELECT t.trip_id, t.trip_date, t.status, t.driver_id, d.emp_id AS driver_emp FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id WHERE t.trip_id = ?${lock ? ' FOR UPDATE' : ''}`, [tripId]);
  if (!t) throw new DeliveryError('No such trip', 404);
  return t;
}
const canDrive = (t, empId, office) => office || (t.driver_emp && t.driver_emp === empId);

const STOP_KEY = "CASE WHEN s.kind = 'pickup' THEN r.return_no ELSE o.order_no END";
const STOP_FROM = 'trip_stops s JOIN orders o ON o.order_id = s.order_id LEFT JOIN returns r ON r.return_id = s.return_id';

/** a return pickup stop on a trip (the return must be collected on a trip and not on another open trip) */
async function addPickup(q, tripId, returnNo, seq, empId) {
  const r = await wrap(() => returns.onTrip(q, returnNo, tripId, empId));
  const [[open]] = await q.query("SELECT t.trip_id FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.return_id = ? AND t.status IN ('planned', 'out') AND s.status = 'pending' AND t.trip_id <> ?", [r.return_id, tripId]);
  if (open) throw new DeliveryError(`${returnNo} is on trip T-${open.trip_id} already`, 409);
  try {
    await q.query("INSERT INTO trip_stops (trip_id, order_id, kind, return_id, seq) VALUES (?, ?, 'pickup', ?, ?)", [tripId, r.order_id, r.return_id, seq]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new DeliveryError(`${returnNo}: another return of the same order is a pickup on this trip already`, 409);
    throw e;
  }
}

/** b = { order_nos (route order), return_nos (pickups, after the deliveries), vehicle_id, driver_id, area_id, trip_date } */
async function createTrip(q, b, empId) {
  const nos = Array.isArray(b.order_nos) ? b.order_nos.map(String) : [];
  const pickups = Array.isArray(b.return_nos) ? b.return_nos.map(String) : [];
  if (!nos.length && !pickups.length) throw new DeliveryError('Choose the packed orders (or return pickups) for the trip');
  const [[v]] = await q.query('SELECT vehicle_id FROM vehicles WHERE vehicle_id = ? AND is_active = 1', [Number(b.vehicle_id)]);
  if (!v) throw new DeliveryError('Choose the vehicle');
  const [[d]] = await q.query('SELECT driver_id FROM drivers WHERE driver_id = ? AND is_active = 1', [Number(b.driver_id)]);
  if (!d) throw new DeliveryError('Choose the driver');
  const today = istDates.istToday();
  const day = String(b.trip_date || today);
  const later = istDates.addDays(today, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || day < today || day > later) throw new DeliveryError('Trip date: today or a day in the next 30 days');
  if (b.area_id) {
    const [[a]] = await q.query('SELECT area_id, label, is_active FROM delivery_areas WHERE area_id = ?', [Number(b.area_id)]);
    if (!a) throw new DeliveryError('Unknown delivery area');
    // phase 24 follow-up: a town only on the website map (not active) gets no trips until an Admin turns it on
    if (!Number(a.is_active)) throw new DeliveryError(`${a.label} is not an active delivery area (Masters > Delivery areas)`);
  }
  // a trip leaves from one godown: every order and pickup on it belongs there (phase 12a, D8)
  const [og] = nos.length ? await q.query('SELECT DISTINCT godown_id FROM orders WHERE order_no IN (?)', [nos]) : [[]];
  const [rg] = pickups.length ? await q.query('SELECT DISTINCT godown_id FROM returns WHERE return_no IN (?)', [pickups]) : [[]];
  const gs = [...new Set([...og, ...rg].map((x) => Number(x.godown_id)))];
  if (gs.length > 1) throw new DeliveryError('A trip leaves from one godown: choose orders and pickups of one godown');
  if (!gs.length) throw new DeliveryError('Choose the packed orders (or return pickups) for the trip');
  if (b.admin && !godowns.covers(b.admin, gs[0])) throw new DeliveryError('You do not work at that godown', 403);
  const [ins] = await q.query('INSERT INTO delivery_trips (godown_id, trip_date, area_id, vehicle_id, driver_id, created_by) VALUES (?, ?, ?, ?, ?, ?)', [gs[0], day, b.area_id ? Number(b.area_id) : null, v.vehicle_id, d.driver_id, empId]);
  let seq = 0;
  for (const no of nos) {
    const o = await lockOrder(q, no, ['packed']);
    if (o.delivery_kind !== 'own') throw new DeliveryError(`${no} goes by ${o.delivery_kind === 'courier' ? 'courier' : 'customer pickup'}, not on a trip`);
    const [[open]] = await q.query("SELECT t.trip_id FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.order_id = ? AND t.status IN ('planned', 'out') AND s.status = 'pending'", [o.order_id]);
    if (open) throw new DeliveryError(`${no} is on trip T-${open.trip_id} already`, 409);
    seq += 1;
    await q.query('INSERT INTO trip_stops (trip_id, order_id, seq) VALUES (?, ?, ?)', [ins.insertId, o.order_id, seq]);
  }
  for (const no of pickups) { seq += 1; await addPickup(q, ins.insertId, no, seq, empId); }
  await checkLoad(q, ins.insertId);
  await audit(q, { empId, action: 'create', entity: 'trip', entityId: `T-${ins.insertId}`, after: { godown: gs[0], trip_date: day, vehicle_id: v.vehicle_id, driver_id: d.driver_id, stops: nos, pickups } });
  return { trip_id: ins.insertId };
}

/** phase 20 (v23): what is loaded must fit the vehicle (weight and boxes) */
async function checkLoad(q, tripId) {
  const [[l]] = await q.query(`SELECT v.number, v.max_kg, v.max_boxes, COALESCE(SUM(o.weight_kg), 0) AS kg, COALESCE(SUM(o.cartons), 0) AS boxes
      FROM delivery_trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id LEFT JOIN trip_stops s ON s.trip_id = t.trip_id AND s.kind = 'delivery' LEFT JOIN orders o ON o.order_id = s.order_id
      WHERE t.trip_id = ? GROUP BY v.number, v.max_kg, v.max_boxes`, [tripId]);
  if (!l) return;
  const kg = Number(l.kg); const boxes = Number(l.boxes);
  if ((l.max_kg !== null && kg > Number(l.max_kg) + 1e-9) || (l.max_boxes !== null && boxes > Number(l.max_boxes))) {
    throw new DeliveryError(`Too heavy for ${l.number}: the load would be ${Math.round(kg * 100) / 100} kg and ${boxes} boxes; it carries ${Number(l.max_kg)} kg and ${l.max_boxes} boxes. Use another trip or a bigger vehicle.`, 409);
  }
}
/** phase 20 (v23): a vehicle with lapsed insurance or fitness, or a driver with no (or a lapsed) licence, cannot go out -> '' | why */
async function papersProblem(q, tripId) {
  const [[t]] = await q.query(`SELECT v.number, v.is_active AS v_on, DATE_FORMAT(v.insurance_until, '%Y-%m-%d') AS ins, DATE_FORMAT(v.fitness_until, '%Y-%m-%d') AS fc, d.name AS driver,
      d.licence_no, DATE_FORMAT(d.licence_until, '%Y-%m-%d') AS lic FROM delivery_trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id JOIN drivers d ON d.driver_id = t.driver_id WHERE t.trip_id = ?`, [tripId]);
  const day = istDates.istToday();
  const vp = [];
  if (!Number(t.v_on)) vp.push('not in use');
  if (t.ins && t.ins < day) vp.push(`insurance ended ${t.ins}`);
  if (t.fc && t.fc < day) vp.push(`fitness certificate ended ${t.fc}`);
  if (vp.length) return `${t.number} cannot go out: ${vp.join(', ')}. Renew it in Vehicles and drivers, or choose another vehicle.`;
  if (t.licence_no && t.lic && t.lic < day) return `${t.driver} cannot drive: licence ended ${t.lic}.`;
  return '';
}
/** phase 20 (v23): load one more packed order (our vehicle, same godown) on a planned trip, within the vehicle's limits */
async function addStop(q, tripId, orderNo, empId, admin) {
  const t = await tripRow(q, tripId, true);
  if (t.status !== 'planned') throw new DeliveryError(`Trip T-${tripId} has started: nothing more is loaded`, 409);
  const o = await lockOrder(q, String(orderNo || ''), ['packed']);
  if (o.delivery_kind !== 'own') throw new DeliveryError(`${o.order_no} goes by ${o.delivery_kind === 'courier' ? 'courier' : 'customer pickup'}, not on a trip`);
  const [[g]] = await q.query('SELECT (SELECT godown_id FROM orders WHERE order_id = ?) AS og, (SELECT godown_id FROM delivery_trips WHERE trip_id = ?) AS tg', [o.order_id, tripId]);
  if (Number(g.og) !== Number(g.tg)) throw new DeliveryError('A trip leaves from one godown: that order ships from another', 409);
  if (admin && !godowns.covers(admin, g.tg)) throw new DeliveryError('You do not work at that godown', 403);
  const [[open]] = await q.query("SELECT t.trip_id FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.order_id = ? AND t.status IN ('planned', 'out') AND s.status = 'pending'", [o.order_id]);
  if (open) throw new DeliveryError(`${o.order_no} is on trip T-${open.trip_id} already`, 409);
  const [[m]] = await q.query('SELECT COALESCE(MAX(seq), 0) AS n FROM trip_stops WHERE trip_id = ?', [tripId]);
  await q.query('INSERT INTO trip_stops (trip_id, order_id, seq) VALUES (?, ?, ?)', [tripId, o.order_id, Number(m.n) + 1]);
  await checkLoad(q, tripId);
  await audit(q, { empId, action: 'load', entity: 'trip', entityId: `T-${tripId}`, after: { order: o.order_no } });
  return { trip_id: tripId, order_no: o.order_no };
}
/** phase 20 (v23): a planned trip that will not go is deleted; its orders wait in Packed, waiting again */
async function deleteTrip(q, tripId, empId) {
  const t = await tripRow(q, tripId, true);
  if (t.status !== 'planned') throw new DeliveryError(`Trip T-${tripId} has started: it cannot be deleted`, 409);
  const [stops] = await q.query(`SELECT ${STOP_KEY} AS stop_key FROM ${STOP_FROM} WHERE s.trip_id = ?`, [tripId]);
  await q.query('DELETE FROM trip_stops WHERE trip_id = ?', [tripId]);
  await q.query('DELETE FROM delivery_trips WHERE trip_id = ?', [tripId]);
  await audit(q, { empId, action: 'delete', entity: 'trip', entityId: `T-${tripId}`, before: { stops: stops.map((x) => x.stop_key) } });
  return { trip_id: tripId, deleted: true };
}
/** planned trips: new route order (order nos. and return nos. in the new order); removing a stop = leaving it out */
async function setStops(q, tripId, orderNos, empId) {
  const t = await tripRow(q, tripId, true);
  if (t.status !== 'planned') throw new DeliveryError(`Trip T-${tripId} has started: the stops cannot change`, 409);
  const [stops] = await q.query(`SELECT s.stop_id, ${STOP_KEY} AS stop_key FROM ${STOP_FROM} WHERE s.trip_id = ?`, [tripId]);
  const keep = orderNos.map(String);
  if (!keep.length) throw new DeliveryError('A trip needs at least one stop');
  for (const st of stops) if (!keep.includes(st.stop_key)) await q.query('DELETE FROM trip_stops WHERE stop_id = ?', [st.stop_id]);
  for (let i = 0; i < keep.length; i += 1) {
    const st = stops.find((x) => x.stop_key === keep[i]);
    if (!st) throw new DeliveryError(`${keep[i]} is not on this trip`);
    await q.query('UPDATE trip_stops SET seq = ? WHERE stop_id = ?', [i + 1, st.stop_id]);
  }
  await audit(q, { empId, action: 'update', entity: 'trip', entityId: `T-${tripId}`, after: { stops: keep } });
  return { trip_id: tripId };
}

/** Start trip: every stop's goods leave the godown (stock out, invoice), the orders are Out for delivery */
async function startTrip(q, tripId, empId) {
  const t = await tripRow(q, tripId, true);
  if (t.status !== 'planned') throw new DeliveryError(`Trip T-${tripId} is ${t.status}`, 409);
  const s = await commerceSettings.read(q);
  const [stops] = await q.query('SELECT s.stop_id, s.kind, o.order_no FROM trip_stops s JOIN orders o ON o.order_id = s.order_id WHERE s.trip_id = ? ORDER BY s.seq', [tripId]);
  if (!stops.length) throw new DeliveryError('The trip has no stop');
  const papers = await papersProblem(q, tripId);
  if (papers) throw new DeliveryError(papers, 409);
  let cash = 0;
  for (const st of stops) {
    if (st.kind === 'pickup') continue; // a return pickup: nothing leaves the godown
    const o = await lockOrder(q, st.order_no, ['packed']);
    const out = await wrap(() => commerce.leaveGodown(q, o.order_id, empId));
    await commerce.setStatus(q, o, 'out_for_delivery', empId, [`Trip T-${tripId}`, out.invoice_no ? `invoice ${out.invoice_no}` : null, out.batches.length ? `from ${out.batches.map((x) => `${x.qty} x ${x.sku_code} batch ${x.batch_no}`).join(', ')}` : null].filter(Boolean).join('; '));
    const [[fresh]] = await q.query('SELECT amount_due, payment_terms FROM orders WHERE order_id = ?', [o.order_id]);
    if (fresh.payment_terms === 'cod') cash += Math.max(Number(fresh.amount_due), 0);
    const otp = s.delivery_otp ? String(crypto.randomInt(1000, 10000)) : null;
    await q.query('UPDATE trip_stops SET otp = ?, otp_fails = 0 WHERE stop_id = ?', [otp, st.stop_id]);
  }
  await q.query("UPDATE delivery_trips SET status = 'out', started_by = ?, started_at = UTC_TIMESTAMP(), cash_expected = ? WHERE trip_id = ?", [empId, round2(cash), tripId]);
  await audit(q, { empId, action: 'start', entity: 'trip', entityId: `T-${tripId}`, after: { stops: stops.length, cash_expected: round2(cash) } });
  return { trip_id: tripId, status: 'out', cash_expected: round2(cash) };
}

async function stopRow(q, stopId) {
  const [[st]] = await q.query(`SELECT s.stop_id, s.trip_id, s.kind, s.status, s.otp, s.order_id, o.order_no, r.return_no FROM ${STOP_FROM} WHERE s.stop_id = ? FOR UPDATE`, [stopId]);
  if (!st) throw new DeliveryError('No such stop', 404);
  return st;
}

/** b = { receiver_name, otp }, photo = { buffer, mimetype } | null; office = may act on any trip */
async function stopDelivered(q, stopId, b, photo, empId, office) {
  const st = await stopRow(q, stopId);
  const t = await tripRow(q, st.trip_id);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can mark its stops', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${t.trip_id} is ${t.status}`, 409);
  if (st.status !== 'pending') throw new DeliveryError(`This stop is ${st.status} already`, 409);
  if (st.kind === 'pickup') throw new DeliveryError(`${st.return_no} is a return pickup: mark it Picked up`);
  const name = String(b.receiver_name || '').trim().slice(0, 120);
  if (!name) throw new DeliveryError('Who received it? (name)');
  if (st.otp && String(b.otp || '').trim() !== st.otp) throw Object.assign(new DeliveryError('The OTP does not match: ask the customer for the 4-digit code'), { otpWrong: true });
  const pic = photo ? await storable(photo) : null; // checked by its bytes and made small (photo-check.js)
  if (photo && !pic) throw new DeliveryError('Photo: a JPEG, PNG or WebP picture');
  // phase 20: delivered short: the customer keeps part (kept = { sku: packs }); the rest comes back with a credit note
  let kept = b.kept;
  if (typeof kept === 'string') { try { kept = JSON.parse(kept); } catch (e) { kept = null; } }
  const k = kept ? await wrap(() => fulfil.keptToBack(q, st.order_id, kept)) : { short: false, back: {} };
  const shortWhy = String(b.short_reason || '').trim().slice(0, 120);
  if (k.short && !shortWhy) throw Object.assign(new DeliveryError('Why did they not keep everything?'), { code: 'fields', fields: { short_reason: 'Choose why.' } });
  const signed = [true, 1, '1', 'true', 'on'].includes(b.signed) ? 1 : 0; // v23: signed the packing slip (proof of delivery)
  if (!signed && !pic) throw Object.assign(new DeliveryError('A signed slip or a photo is the proof.'), { code: 'fields', fields: { proof: 'Tick signed, or add a photo.' } });
  await q.query("UPDATE trip_stops SET status = 'delivered', receiver_name = ?, signed = ?, photo = ?, photo_type = ?, kept_json = ?, failed_reason = ?, done_by = ?, done_at = UTC_TIMESTAMP() WHERE stop_id = ?",
    [name, signed, pic ? pic.buffer : null, pic ? pic.mimetype : null, k.short ? JSON.stringify(k.back) : null, k.short ? `Short: ${shortWhy}` : null, empId, stopId]);
  const o = await lockOrder(q, st.order_no, ['out_for_delivery']);
  await commerce.setStatus(q, o, 'delivered', empId, `Received by ${name} (trip T-${t.trip_id})${photo ? ', photo' : ''}${k.short ? `; delivered short: ${Object.entries(k.back).map(([s0, n]) => `${n} ${s0}`).join(', ')} not kept (${shortWhy})` : ''}`, { received_by: name, delivery_attempts: (await attempts(q, o.order_id)) + 1 });
  const back = k.short ? await wrap(() => fulfil.notKept(q, o.order_id, k.back, shortWhy, empId)) : null;
  if (back) await q.query('UPDATE trip_stops SET return_back_id = (SELECT return_id FROM returns WHERE return_no = ?) WHERE stop_id = ?', [back.return_no, stopId]);
  const [[due]] = await q.query('SELECT amount_due FROM orders WHERE order_id = ?', [o.order_id]);
  return { stop_id: stopId, status: k.short ? 'short' : 'delivered', back, cash_due: Math.max(0, Number(due.amount_due)) };
}

/** phase 20: refused at the door: nothing kept; every pack comes back to the Returned shelf with its credit note */
async function stopRefused(q, stopId, b, empId, office) {
  const st = await stopRow(q, stopId);
  const t = await tripRow(q, st.trip_id);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can mark its stops', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${t.trip_id} is ${t.status}`, 409);
  if (st.status !== 'pending') throw new DeliveryError(`This stop is ${st.status} already`, 409);
  if (st.kind === 'pickup') throw new DeliveryError(`${st.return_no} is a return pickup`);
  const why = String(b.reason || '').trim().slice(0, 120);
  if (!why) throw Object.assign(new DeliveryError('Choose why it was refused.'), { code: 'fields', fields: { reason: 'Choose why.' } });
  const all = await fulfil.carried(q, st.order_id);
  await q.query("UPDATE trip_stops SET status = 'refused', failed_reason = ?, kept_json = ?, done_by = ?, done_at = UTC_TIMESTAMP() WHERE stop_id = ?", [`Refused: ${why}`, JSON.stringify(all), empId, stopId]);
  const o = await lockOrder(q, st.order_no, ['out_for_delivery']);
  await commerce.setStatus(q, o, 'refused', empId, `Refused at delivery: ${why} (trip T-${t.trip_id})`, { failed_reason: `Refused: ${why}`.slice(0, 255), delivery_attempts: (await attempts(q, o.order_id)) + 1 });
  const back = await wrap(() => fulfil.notKept(q, o.order_id, all, `Refused at delivery: ${why}`, empId));
  await q.query('UPDATE trip_stops SET return_back_id = (SELECT return_id FROM returns WHERE return_no = ?) WHERE stop_id = ?', [back.return_no, stopId]);
  return { stop_id: stopId, status: 'refused', back };
}
/**
 * a wrong delivery OTP, counted outside the rolled-back transaction (security review L1): after 5 wrong codes the stop
 * gets a new code (on the office's trip sheet), so the 4 digits cannot be guessed one by one. -> the error to answer
 */
async function otpFailed(q, stopId, err) {
  await q.query('UPDATE trip_stops SET otp_fails = otp_fails + 1 WHERE stop_id = ? AND otp IS NOT NULL', [stopId]);
  const [[st]] = await q.query('SELECT otp_fails FROM trip_stops WHERE stop_id = ?', [stopId]);
  if (!st || Number(st.otp_fails) < 5) return new DeliveryError(`${err.message} (${5 - Number(st ? st.otp_fails : 0)} tries left)`);
  await q.query('UPDATE trip_stops SET otp = ?, otp_fails = 0 WHERE stop_id = ?', [String(crypto.randomInt(1000, 10000)), stopId]);
  return new DeliveryError('5 wrong codes: this stop has a NEW code now. The office reads it from the trip and gives it to the customer.', 409);
}
async function attempts(q, orderId) { const [[r]] = await q.query('SELECT delivery_attempts FROM orders WHERE order_id = ?', [orderId]); return Number(r.delivery_attempts) || 0; }

async function stopFailed(q, stopId, b, empId, office) {
  const st = await stopRow(q, stopId);
  const t = await tripRow(q, st.trip_id);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can mark its stops', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${t.trip_id} is ${t.status}`, 409);
  if (st.status !== 'pending') throw new DeliveryError(`This stop is ${st.status} already`, 409);
  const reason = String(b.reason || '').trim().slice(0, 200);
  if (!reason) throw new DeliveryError('Why did the delivery fail?');
  const full = b.note ? `${reason}: ${String(b.note).trim().slice(0, 50)}` : reason;
  await q.query("UPDATE trip_stops SET status = 'failed', failed_reason = ?, done_by = ?, done_at = UTC_TIMESTAMP() WHERE stop_id = ?", [full, empId, stopId]);
  if (st.kind === 'pickup') {
    await wrap(() => returns.pickupFailed(q, st.return_no, t.trip_id, full, empId));
    return { stop_id: stopId, status: 'failed' };
  }
  const o = await lockOrder(q, st.order_no, ['out_for_delivery']);
  await commerce.setStatus(q, o, 'failed', empId, `${full} (trip T-${t.trip_id})`, { failed_reason: full, delivery_attempts: (await attempts(q, o.order_id)) + 1 });
  return { stop_id: stopId, status: 'failed' };
}

/** a return pickup done: photo required; the return is on its way to the godown (received there by scanning) */
async function stopPickedUp(q, stopId, b, photo, empId, office) {
  const st = await stopRow(q, stopId);
  const t = await tripRow(q, st.trip_id);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can mark its stops', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${t.trip_id} is ${t.status}`, 409);
  if (st.status !== 'pending') throw new DeliveryError(`This stop is ${st.status} already`, 409);
  if (st.kind !== 'pickup') throw new DeliveryError(`${st.order_no} is a delivery, not a return pickup`);
  if (!photo) throw new DeliveryError('Take a photo of the packs picked up');
  const pic = await storable(photo); // checked by its bytes and made small (photo-check.js)
  if (!pic) throw new DeliveryError('Photo: a JPEG, PNG or WebP picture');
  photo = pic; // eslint-disable-line no-param-reassign
  const name = String(b.receiver_name || '').trim().slice(0, 120) || null;
  await q.query("UPDATE trip_stops SET status = 'picked_up', receiver_name = ?, photo = ?, photo_type = ?, done_by = ?, done_at = UTC_TIMESTAMP() WHERE stop_id = ?",
    [name, photo.buffer, photo.mimetype, empId, stopId]);
  await wrap(() => returns.pickedUp(q, st.return_no, t.trip_id, empId, photo, name));
  return { stop_id: stopId, status: 'picked_up' };
}

/** cash collected at a stop: a cash payment on the order (phase 3) */
async function stopCash(q, stopId, b, empId, office) {
  const st = await stopRow(q, stopId);
  const t = await tripRow(q, st.trip_id);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can record its cash', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${t.trip_id} is ${t.status}`, 409);
  if (st.kind !== 'delivery') throw new DeliveryError(`${st.return_no || 'This stop'} is a return pickup: no cash is collected there`);
  const amount = String(b.amount ?? '').trim();
  // v23 (v21): less than due needs a reason; the supervisor sees it at trip close
  const [[od]] = await q.query("SELECT amount_due, payment_terms FROM orders WHERE order_id = ?", [st.order_id]);
  const why = String(b.why || '').trim().slice(0, 80);
  const less = round2(Number(od.amount_due) - Number(amount));
  if (od.payment_terms === 'cod' && /^\d{1,9}(\.\d{1,2})?$/.test(amount) && less > 0.005 && !why) throw Object.assign(new DeliveryError(`Cash is Rs ${less.toFixed(2)} less than due. Choose why.`), { code: 'fields', fields: { why: 'Choose why.' } });
  const r = await wrap(() => commerce.recordPayment(q, st.order_no, { amount, mode: 'cash', note: `Collected on trip T-${t.trip_id}${less > 0.005 && why ? `; Rs ${less.toFixed(2)} less than due: ${why}` : ''}` }, empId)); // today: cash is counted when it is collected
  // phase 23 (v23 9.7): what was due when the cash was taken (first time) and why it was less, for the trip close
  await q.query('UPDATE trip_stops SET cash_collected = cash_collected + ?, cash_due = COALESCE(cash_due, ?), cash_less_why = COALESCE(?, cash_less_why) WHERE stop_id = ?',
    [Number(amount), od.payment_terms === 'cod' ? Number(od.amount_due) : null, less > 0.005 && why ? why : null, stopId]);
  return { stop_id: stopId, ...r };
}

/** End trip: no stop left pending; cash collected vs handed over */
async function endTrip(q, tripId, b, empId, office) {
  const t = await tripRow(q, tripId, true);
  if (!office) throw new DeliveryError('The supervisor closes the trip and counts the cash the driver hands in', 403); // v23: plans trips and counts cash = Create on Delivery
  if (t.driver_emp && t.driver_emp === empId) throw new DeliveryError('Not your own trip: someone else counts the cash you hand in.', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${tripId} is ${t.status}`, 409);
  const [[p]] = await q.query(`SELECT SUM(status = 'pending') AS open, COALESCE(SUM(cash_collected), 0) AS cash,
      COALESCE(SUM(IF(cash_due IS NOT NULL AND cash_collected < cash_due, cash_due - cash_collected, 0)), 0) AS less FROM trip_stops WHERE trip_id = ?`, [tripId]);
  if (Number(p.open)) throw new DeliveryError(`${p.open} stop(s) still open: mark them delivered or failed first`, 409);
  const handed = String(b.cash_handed ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(handed)) throw new DeliveryError('Cash handed over: the amount, 0 if none');
  const note = String(b.note || '').trim().slice(0, 255) || null;
  const diff = round2(Number(handed) - Number(p.cash));
  if (Math.abs(diff) > 0.005 && !note) throw new DeliveryError(`The cash handed over differs from the cash collected (Rs ${Number(p.cash).toFixed(2)}) by Rs ${diff.toFixed(2)}: add a note`);
  // phase 23 (v23 9.7, rule "Cash short at trip close"): cash handed in below the cash recorded, plus stops that
  // collected less than due, go to a second person; the trip waits in "Cash short, waiting" until approved
  const short = round2(Math.max(0, Number(p.cash) - Number(handed)));
  const lessV = round2(Number(p.less));
  const sumShort = round2(short + lessV);
  if (sumShort > 0.005 && await approvals.needed(q, 'cash_short', { amount: sumShort })) {
    const [less] = await q.query(`SELECT o.order_no, s.cash_collected, s.cash_due, s.cash_less_why FROM trip_stops s JOIN orders o ON o.order_id = s.order_id
        WHERE s.trip_id = ? AND s.cash_due IS NOT NULL AND s.cash_collected < s.cash_due ORDER BY s.seq`, [tripId]);
    const lessTxt = less.map((x) => `${x.order_no} paid Rs ${Number(x.cash_collected).toFixed(2)} of Rs ${Number(x.cash_due).toFixed(2)}${x.cash_less_why ? ` (${x.cash_less_why})` : ''}`).join(', ');
    const [[g]] = await q.query('SELECT godown_id FROM delivery_trips WHERE trip_id = ?', [tripId]);
    await q.query("UPDATE delivery_trips SET status = 'cashwait', cash_collected = ?, cash_handed = ?, end_note = ? WHERE trip_id = ?", [Number(p.cash), Number(handed), note, tripId]);
    const approvalId = await approvals.request(q, { kind: 'cash_short', godownId: g.godown_id, refType: 'trip', refId: `T-${tripId}`, amount: sumShort,
      summary: `Trip T-${tripId}: ${short > 0.005 ? `recorded Rs ${Number(p.cash).toFixed(2)}, handed in Rs ${Number(handed).toFixed(2)}` : 'cash handed in matches'}${lessV > 0.005 ? `. Collected less than due: ${lessTxt}` : ''}${note ? `. Note: ${note}` : ''}`,
      payload: { trip_id: tripId } }, empId);
    await audit(q, { empId, action: 'cash_short', entity: 'trip', entityId: `T-${tripId}`, after: { cash_collected: Number(p.cash), cash_handed: Number(handed), short, less: lessV, approval_id: approvalId, note } });
    const message = `${short > 0.005 ? `Cash short by Rs ${short.toFixed(2)}.` : `Collected less than due by Rs ${lessV.toFixed(2)}.`}${short > 0.005 && lessV > 0.005 ? ` Plus Rs ${lessV.toFixed(2)} collected less than due.` : ''} Needs a second person: the trip waits in "Cash short, waiting".`;
    return { trip_id: tripId, status: 'cashwait', cash_collected: Number(p.cash), cash_handed: Number(handed), difference: diff, short, less: lessV, approval_id: approvalId, message };
  }
  await q.query("UPDATE delivery_trips SET status = 'ended', ended_by = ?, ended_at = UTC_TIMESTAMP(), cash_collected = ?, cash_handed = ?, end_note = ? WHERE trip_id = ?", [empId, Number(p.cash), Number(handed), note, tripId]);
  await audit(q, { empId, action: 'end', entity: 'trip', entityId: `T-${tripId}`, after: { cash_collected: Number(p.cash), cash_handed: Number(handed), difference: diff, note } });
  if (Math.abs(diff) > 0.005) await notifications.cashDifference(q, tripId);
  return { trip_id: tripId, status: 'ended', cash_collected: Number(p.cash), cash_handed: Number(handed), difference: diff };
}

// phase 23 (v23 delDecided): a cash shortfall approved closes the trip; rejected, it goes back on the road to count again
approvals.onApproved('cash_short', async (q, p, empId) => {
  const [[t]] = await q.query("SELECT trip_id, status, cash_collected, cash_handed FROM delivery_trips WHERE trip_id = ? FOR UPDATE", [Number(p.trip_id)]);
  if (!t || t.status !== 'cashwait') return;
  await q.query("UPDATE delivery_trips SET status = 'ended', ended_by = ?, ended_at = UTC_TIMESTAMP() WHERE trip_id = ?", [empId, t.trip_id]);
  await audit(q, { empId, action: 'end', entity: 'trip', entityId: `T-${t.trip_id}`, after: { cash_collected: Number(t.cash_collected), cash_handed: Number(t.cash_handed), short_approved: true } });
  if (Math.abs(Number(t.cash_handed) - Number(t.cash_collected)) > 0.005) await notifications.cashDifference(q, t.trip_id);
});
approvals.onClosed('cash_short', async (q, p, status, empId) => {
  const [[t]] = await q.query("SELECT trip_id, status FROM delivery_trips WHERE trip_id = ? FOR UPDATE", [Number(p.trip_id)]);
  if (!t || t.status !== 'cashwait') return;
  await q.query("UPDATE delivery_trips SET status = 'out', cash_handed = NULL, end_note = NULL WHERE trip_id = ?", [t.trip_id]);
  await audit(q, { empId, action: 'cash_short_back', entity: 'trip', entityId: `T-${t.trip_id}`, after: { status: 'out', why: `cash short ${status}: count the cash again` } });
});

// ---------------------------------------------------------------- after a failed delivery, courier, pickup
async function reattempt(q, orderNo, empId) {
  const o = await lockOrder(q, orderNo, ['failed']);
  await commerce.setStatus(q, o, 'packed', empId, 'Re-attempt: back in the godown, ready for the next trip');
  return { order_no: orderNo, status: 'packed' };
}
async function returnToGodown(q, orderNo, reason, empId) {
  const o = await lockOrder(q, orderNo, ['failed']);
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new DeliveryError('Why is it returned to the godown?');
  const r = await wrap(() => commerce.cancelOrder(q, o.order_no, `Delivery failed, returned to the godown: ${why}`, empId)); // cancel after dispatch: its approval when the setting asks for one
  return { order_no: orderNo, status: r.pending ? o.status : 'cancelled', pending: Boolean(r.pending), approval_id: r.approval_id || null };
}

/** b = { courier_id, awb_no, eway_bill_no } */
async function handToCourier(q, orderNo, b, empId) {
  const o = await lockOrder(q, orderNo, ['packed']);
  if (o.delivery_kind !== 'courier') throw new DeliveryError(`${orderNo} is not a courier order (change the delivery method on the order first)`);
  const [[c]] = await q.query('SELECT courier_id, name FROM couriers WHERE courier_id = ? AND is_active = 1', [Number(b.courier_id)]);
  if (!c) throw new DeliveryError('Choose the courier');
  const awb = String(b.awb_no || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(awb)) throw new DeliveryError('AWB number: 6 to 40 letters or digits');
  const s = await commerceSettings.read(q);
  const eway = String(b.eway_bill_no || '').trim();
  if (eway && !/^\d{12}$/.test(eway)) throw new DeliveryError('E-way bill number: 12 digits');
  if (s.eway_bill_required && Number(o.total) > Number(s.eway_bill_above) && !eway) throw new DeliveryError(`Above Rs ${Number(s.eway_bill_above).toLocaleString('en-IN')} the e-way bill number is required (make it on the portal first)`);
  const out = await wrap(() => commerce.leaveGodown(q, o.order_id, empId));
  await commerce.setStatus(q, o, 'with_courier', empId, [`${c.name} AWB ${awb}`, eway ? `e-way bill ${eway}` : null, out.invoice_no ? `invoice ${out.invoice_no}` : null].filter(Boolean).join('; '),
    { courier_id: c.courier_id, awb_no: awb, eway_bill_no: eway || null });
  return { order_no: orderNo, status: 'with_courier', invoice_no: out.invoice_no };
}
async function courierDelivered(q, orderNo, b, empId) {
  const o = await lockOrder(q, orderNo, ['with_courier']);
  const name = String(b.receiver_name || '').trim().slice(0, 120) || null;
  await commerce.setStatus(q, o, 'delivered', empId, `Delivered by the courier${name ? ` to ${name}` : ''}`, { received_by: name, delivery_attempts: 1 });
  return { order_no: orderNo, status: 'delivered' };
}
async function pickedUp(q, orderNo, b, empId) {
  const o = await lockOrder(q, orderNo, ['packed']);
  if (o.delivery_kind !== 'pickup') throw new DeliveryError(`${orderNo} is not a customer pickup`);
  const name = String(b.receiver_name || '').trim().slice(0, 120);
  if (!name) throw new DeliveryError('Who collected it? (name)');
  // phase 20 (v23): their phone, signed slip and the cash paid at the godown (all optional for the API; the screen asks for the phone)
  const phone = String(b.phone || '').trim();
  if (phone && !/^\+?[\d\s-]{10,16}$/.test(phone)) throw Object.assign(new DeliveryError('Their phone: 10 digits'), { code: 'fields', fields: { phone: '10 digits.' } });
  const cash = String(b.cash ?? '').trim();
  if (cash && !/^\d{1,9}(\.\d{1,2})?$/.test(cash)) throw Object.assign(new DeliveryError('Cash received: an amount'), { code: 'fields', fields: { cash: 'An amount.' } });
  let stranger = false;
  if (phone) {
    const pd = require('../shared/customerRules').phoneDigits(phone); // eslint-disable-line global-require
    const [[known]] = await q.query(`SELECT COUNT(*) AS n FROM customers c WHERE c.customer_id = (SELECT customer_id FROM orders WHERE order_id = ?) AND (c.phone_digits = ?
        OR EXISTS (SELECT 1 FROM customer_contacts k WHERE k.customer_id = c.customer_id AND k.is_active = 1 AND RIGHT(REGEXP_REPLACE(k.phone, '[^0-9]', ''), 10) = ?))`, [o.order_id, pd, pd]);
    stranger = !Number(known.n);
  }
  const out = await wrap(() => commerce.leaveGodown(q, o.order_id, empId));
  await commerce.setStatus(q, o, 'delivered', empId, `Collected at the godown by ${name}${phone ? ` (${phone}${stranger ? ', not one of the customer contacts' : ''})` : ''}${[true, 1, '1', 'true'].includes(b.signed) ? ', signed the slip' : ''}${out.invoice_no ? `; invoice ${out.invoice_no}` : ''}`, { received_by: name, delivery_attempts: 1 });
  if (cash && Number(cash) > 0) await wrap(() => commerce.recordPayment(q, orderNo, { amount: cash, mode: 'cash', note: 'Paid at the godown on pickup' }, empId));
  return { order_no: orderNo, status: 'delivered', invoice_no: out.invoice_no, stranger_phone: stranger };
}

/** phase 20 (v23 9.11): the courier brought it back: every pack comes back to the Returned shelf with its credit note; the order is Refused */
async function courierBack(q, orderNo, b, empId) {
  const o = await lockOrder(q, orderNo, ['with_courier']);
  const why = String(b.reason || '').trim().slice(0, 120) || 'Returned by the courier';
  const all = await fulfil.carried(q, o.order_id);
  await commerce.setStatus(q, o, 'refused', empId, `Came back from the courier: ${why}`, { failed_reason: `Refused: ${why}`.slice(0, 255), delivery_attempts: (await attempts(q, o.order_id)) + 1 });
  const back = await wrap(() => fulfil.notKept(q, o.order_id, all, why, empId));
  return { order_no: orderNo, status: 'refused', back };
}

/** the Operations counts */
/** the Operations figures for the godowns of scope (godowns.viewScope: null = every godown) */
async function opsCounts(q, scope = null) {
  const [[r]] = await q.query(
    `SELECT SUM(o.status = 'new') AS to_pick, SUM(o.status = 'packing') AS to_pack,
            SUM(o.status = 'packed' AND o.delivery_kind = 'own' AND NOT EXISTS (SELECT 1 FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.order_id = o.order_id AND s.status = 'pending' AND t.status = 'planned')) AS waiting_trip,
            SUM(o.status = 'packed' AND o.delivery_kind <> 'own') AS waiting_other,
            SUM(o.status = 'out_for_delivery') AS out_now, SUM(o.status = 'with_courier') AS with_courier, SUM(o.status = 'failed') AS failed,
            COALESCE(SUM(CASE WHEN o.payment_terms = 'cod' AND o.status IN ('out_for_delivery', 'with_courier', 'failed') AND o.amount_due > 0 THEN o.amount_due END), 0) AS cod_due
       FROM orders o WHERE ${inScope('o.godown_id', scope)}`);
  const [[c]] = await q.query(`SELECT COALESCE(SUM(s.cash_collected), 0) AS held FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE t.status = 'out' AND ${inScope('t.godown_id', scope)}`);
  const rt = await returns.opsCounts(q, scope);
  return { ...rt, toPick: Number(r.to_pick) || 0, toPack: Number(r.to_pack) || 0, waitingTrip: Number(r.waiting_trip) || 0, waitingOther: Number(r.waiting_other) || 0,
    outNow: Number(r.out_now) || 0, withCourier: Number(r.with_courier) || 0, failed: Number(r.failed) || 0, codDue: round2(Number(r.cod_due)), cashOnTrips: round2(Number(c.held)) };
}

module.exports = {
  undoScan, addStop, deleteTrip, courierBack, REFUSE_REASONS, CASH_WHY,
  otpFailed,
  FAIL_REASONS, DeliveryError, pickList, startPacking, packState, packScan, resetScans, markPacked, createTrip, setStops, startTrip,
  stopDelivered, stopRefused, stopFailed, stopPickedUp, stopCash, endTrip, reattempt, returnToGodown, handToCourier, courierDelivered, pickedUp, opsCounts,
};
