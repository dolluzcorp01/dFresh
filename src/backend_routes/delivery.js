// Packing and delivery (docs/COMMERCE-SPEC.md 5.3, 5.4; migration 20261020_commerce_ship.sql). Shared by the admin
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
const { audit } = require('./audit');
const commerce = require('./commerce');
const commerceSettings = require('./commerce-settings');
const stock = require('./stock');

const FAIL_REASONS = ['Customer not available', 'Shop / office closed', 'Address not found', 'Refused the goods', 'No cash ready (pay on delivery)', 'Vehicle problem', 'Other'];
const round2 = (n) => Math.round(n * 100) / 100;

class DeliveryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const wrap = async (fn) => {
  try { return await fn(); } catch (e) { if (e instanceof commerce.CommerceError || e instanceof stock.StockError) throw new DeliveryError(e.message, e.status); throw e; }
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
  const [orders] = await q.query(`SELECT o.order_id, o.order_no, o.status, c.name AS customer FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_no IN (?) ORDER BY o.order_id`, [orderNos]);
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
  for (const o of orders) {
    const [picks] = await q.query('SELECT sku_code, batch_id, qty FROM order_picks WHERE order_id = ?', [o.order_id]);
    if (o.status === 'packing' && picks.length) { picks.forEach((p) => add(p.sku_code, p.batch_id, p.qty, o.order_no)); continue; }
    const [items] = await q.query('SELECT sku_code, qty FROM order_items WHERE order_id = ? ORDER BY sku_code', [o.order_id]);
    const tr = await stock.tracked(q, items.map((i) => i.sku_code));
    for (const i of items) {
      if (!tr.has(i.sku_code)) { add(i.sku_code, null, i.qty, o.order_no); continue; }
      const [taken] = await q.query(`SELECT pk.batch_id, SUM(pk.qty) AS qty FROM order_picks pk JOIN orders x ON x.order_id = pk.order_id
          WHERE pk.sku_code = ? AND x.status IN ('packing', 'packed') AND x.dispatched_at IS NULL GROUP BY pk.batch_id`, [i.sku_code]);
      const used = new Map(taken.map((t) => [t.batch_id, Number(t.qty)]));
      let left = i.qty;
      for (const b of (await stock.batchStock(q, i.sku_code)).filter((x) => x.qty > 0 && !x.expired)) {
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
  const [scans] = await q.query("SELECT sku_code, batch_id, SUM(qty) AS n FROM pack_scans WHERE order_id = ? AND result = 'ok' GROUP BY sku_code, batch_id", [orderId]);
  const got = new Map(scans.map((x) => [`${x.sku_code}|${x.batch_id || ''}`, Number(x.n)]));
  const lines = picks.map((p) => ({ ...p, need: Number(p.need), scanned: got.get(`${p.sku_code}|${p.batch_id || ''}`) || 0 }));
  return { lines, complete: lines.length > 0 && lines.every((l) => l.scanned === l.need) };
}

/** one scan at the packing table -> { result, message, state } (refused scans are kept too) */
async function packScan(q, orderNo, raw, empId) {
  const o = await lockOrder(q, orderNo, ['packing']);
  const code = String(raw || '').trim().toUpperCase().slice(0, 60);
  if (!code) throw new DeliveryError('Scan a pack or a carton');
  const m = /^([A-Z0-9-]+)(?:\/([A-Z0-9/-]+?))?(#C)?$/.exec(code);
  const state = await packState(q, o.order_id);
  let result = 'ok';
  let message = '';
  let sku = m ? m[1] : null;
  let batchId = null;
  let qty = 0;
  const [[s]] = sku ? await q.query('SELECT s.sku_code, s.packs_per_carton, p.track_batches FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [sku]) : [[null]];
  if (!m || !s) { result = 'unknown'; message = `${code}: not a dFresh pack or carton code`; sku = null; } else {
    qty = m[3] ? Number(s.packs_per_carton) || 1 : 1;
    const mine = state.lines.filter((l) => l.sku_code === sku);
    if (!mine.length) { result = 'wrong_sku'; message = `${sku} is not in ${orderNo}: put it back`; qty = 0; } else if (Number(s.track_batches)) {
      const want = mine.filter((l) => l.scanned < l.need).map((l) => l.batch_no);
      const line = m[2] ? mine.find((l) => l.batch_no === m[2]) : null;
      if (!m[2]) { result = 'wrong_batch'; message = `${sku} is packed by batch: scan the batch label (${sku}/${(want[0] || mine[0].batch_no)})`; qty = 0; } else if (!line) {
        result = 'wrong_batch'; message = `${sku} batch ${m[2]}: wrong batch - ${orderNo} takes batch ${want.join(', ') || mine.map((l) => l.batch_no).join(', ')} (earliest expiry first)`; qty = 0;
      } else if (line.scanned + qty > line.need) {
        result = 'too_many'; message = `${sku} batch ${m[2]}: too many - ${line.scanned} of ${line.need} packed already${m[3] ? `, a carton is ${qty}` : ''}`; qty = 0;
      } else { batchId = line.batch_id; message = `${sku} batch ${m[2]}: ${line.scanned + qty} of ${line.need}`; }
    } else {
      const line = mine[0];
      if (line.scanned + qty > line.need) { result = 'too_many'; message = `${sku}: too many - ${line.scanned} of ${line.need} packed already${m[3] ? `, a carton is ${qty}` : ''}`; qty = 0; } else message = `${sku}: ${line.scanned + qty} of ${line.need}`;
    }
  }
  await q.query('INSERT INTO pack_scans (order_id, code, sku_code, batch_id, qty, result, message, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [o.order_id, code, sku, batchId, qty, result, message.slice(0, 255), empId]);
  return { result, message, state: await packState(q, o.order_id) };
}

async function resetScans(q, orderNo, empId) {
  const o = await lockOrder(q, orderNo, ['packing']);
  await q.query('DELETE FROM pack_scans WHERE order_id = ?', [o.order_id]);
  await audit(q, { empId, action: 'pack_reset', entity: 'order', entityId: orderNo });
  return { state: await packState(q, o.order_id) };
}

/** Packing -> Packed. b = { cartons, weight_kg, override_reason }; the override needs canOverride */
async function markPacked(q, orderNo, b, empId, canOverride) {
  const o = await lockOrder(q, orderNo, ['packing']);
  const waiting = await commerce.pendingHolds(q, orderNo);
  if (waiting.length) throw new DeliveryError(`${orderNo} waits for approval: it cannot be packed yet`, 409);
  const cartons = Number(b.cartons);
  const weight = String(b.weight_kg ?? '').trim();
  if (!Number.isInteger(cartons) || cartons < 1 || cartons > 999) throw new DeliveryError('Cartons: a whole number from 1');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(weight) || Number(weight) <= 0) throw new DeliveryError('Weight in kg, e.g. 12.5');
  const state = await packState(q, o.order_id);
  const reason = String(b.override_reason || '').trim().slice(0, 255);
  if (!state.complete) {
    if (!reason) {
      const open = state.lines.filter((l) => l.scanned !== l.need).map((l) => `${l.sku_code}${l.batch_no ? ` ${l.batch_no}` : ''} ${l.scanned} of ${l.need}`);
      throw new DeliveryError(`Not everything is scanned: ${open.join(', ')}`, 409);
    }
    if (!canOverride) throw new DeliveryError('Packing without a full scan needs "approve" on Packing', 403);
  }
  await commerce.setStatus(q, o, 'packed', empId, state.complete ? `${cartons} carton(s), ${weight} kg` : `OVERRIDE: ${reason} (${cartons} carton(s), ${weight} kg)`,
    { cartons, weight_kg: Number(weight), packed_by: empId, pack_override: state.complete ? null : reason });
  if (!state.complete) await audit(q, { empId, action: 'pack_override', entity: 'order', entityId: orderNo, after: { reason, lines: state.lines.map((l) => `${l.sku_code} ${l.scanned}/${l.need}`) } });
  return { order_no: orderNo, status: 'packed', override: !state.complete };
}

// ---------------------------------------------------------------- trips
async function tripRow(q, tripId, lock = false) {
  const [[t]] = await q.query(`SELECT t.trip_id, t.trip_date, t.status, t.driver_id, d.emp_id AS driver_emp FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id WHERE t.trip_id = ?${lock ? ' FOR UPDATE' : ''}`, [tripId]);
  if (!t) throw new DeliveryError('No such trip', 404);
  return t;
}
const canDrive = (t, empId, office) => office || (t.driver_emp && t.driver_emp === empId);

/** b = { order_nos (route order), vehicle_id, driver_id, area_id, trip_date } */
async function createTrip(q, b, empId) {
  const nos = Array.isArray(b.order_nos) ? b.order_nos.map(String) : [];
  if (!nos.length) throw new DeliveryError('Choose the packed orders for the trip');
  const [[v]] = await q.query('SELECT vehicle_id FROM vehicles WHERE vehicle_id = ? AND is_active = 1', [Number(b.vehicle_id)]);
  if (!v) throw new DeliveryError('Choose the vehicle');
  const [[d]] = await q.query('SELECT driver_id FROM drivers WHERE driver_id = ? AND is_active = 1', [Number(b.driver_id)]);
  if (!d) throw new DeliveryError('Choose the driver');
  const day = String(b.trip_date || new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10));
  const [ins] = await q.query('INSERT INTO delivery_trips (trip_date, area_id, vehicle_id, driver_id, created_by) VALUES (?, ?, ?, ?, ?)', [day, b.area_id ? Number(b.area_id) : null, v.vehicle_id, d.driver_id, empId]);
  let seq = 0;
  for (const no of nos) {
    const o = await lockOrder(q, no, ['packed']);
    if (o.delivery_kind !== 'own') throw new DeliveryError(`${no} goes by ${o.delivery_kind === 'courier' ? 'courier' : 'customer pickup'}, not on a trip`);
    const [[open]] = await q.query("SELECT t.trip_id FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.order_id = ? AND t.status IN ('planned', 'out') AND s.status = 'pending'", [o.order_id]);
    if (open) throw new DeliveryError(`${no} is on trip T-${open.trip_id} already`, 409);
    seq += 1;
    await q.query('INSERT INTO trip_stops (trip_id, order_id, seq) VALUES (?, ?, ?)', [ins.insertId, o.order_id, seq]);
  }
  await audit(q, { empId, action: 'create', entity: 'trip', entityId: `T-${ins.insertId}`, after: { trip_date: day, vehicle_id: v.vehicle_id, driver_id: d.driver_id, stops: nos } });
  return { trip_id: ins.insertId };
}

/** planned trips: new route order (order_nos in the new order); removing a stop = leaving it out */
async function setStops(q, tripId, orderNos, empId) {
  const t = await tripRow(q, tripId, true);
  if (t.status !== 'planned') throw new DeliveryError(`Trip T-${tripId} has started: the stops cannot change`, 409);
  const [stops] = await q.query('SELECT s.stop_id, o.order_no FROM trip_stops s JOIN orders o ON o.order_id = s.order_id WHERE s.trip_id = ?', [tripId]);
  const keep = orderNos.map(String);
  if (!keep.length) throw new DeliveryError('A trip needs at least one stop');
  for (const st of stops) if (!keep.includes(st.order_no)) await q.query('DELETE FROM trip_stops WHERE stop_id = ?', [st.stop_id]);
  for (let i = 0; i < keep.length; i += 1) {
    const st = stops.find((x) => x.order_no === keep[i]);
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
  const [stops] = await q.query('SELECT s.stop_id, o.order_no FROM trip_stops s JOIN orders o ON o.order_id = s.order_id WHERE s.trip_id = ? ORDER BY s.seq', [tripId]);
  if (!stops.length) throw new DeliveryError('The trip has no stop');
  let cash = 0;
  for (const st of stops) {
    const o = await lockOrder(q, st.order_no, ['packed']);
    const out = await wrap(() => commerce.leaveGodown(q, o.order_id, empId));
    await commerce.setStatus(q, o, 'out_for_delivery', empId, [`Trip T-${tripId}`, out.invoice_no ? `invoice ${out.invoice_no}` : null, out.batches.length ? `from ${out.batches.map((x) => `${x.qty} x ${x.sku_code} batch ${x.batch_no}`).join(', ')}` : null].filter(Boolean).join('; '));
    const [[fresh]] = await q.query('SELECT amount_due, payment_terms FROM orders WHERE order_id = ?', [o.order_id]);
    if (fresh.payment_terms === 'cod') cash += Math.max(Number(fresh.amount_due), 0);
    const otp = s.delivery_otp ? String(Math.floor(1000 + Math.random() * 9000)) : null;
    await q.query('UPDATE trip_stops SET otp = ? WHERE stop_id = ?', [otp, st.stop_id]);
  }
  await q.query("UPDATE delivery_trips SET status = 'out', started_by = ?, started_at = UTC_TIMESTAMP(), cash_expected = ? WHERE trip_id = ?", [empId, round2(cash), tripId]);
  await audit(q, { empId, action: 'start', entity: 'trip', entityId: `T-${tripId}`, after: { stops: stops.length, cash_expected: round2(cash) } });
  return { trip_id: tripId, status: 'out', cash_expected: round2(cash) };
}

async function stopRow(q, stopId) {
  const [[st]] = await q.query(`SELECT s.stop_id, s.trip_id, s.status, s.otp, s.order_id, o.order_no FROM trip_stops s JOIN orders o ON o.order_id = s.order_id WHERE s.stop_id = ? FOR UPDATE`, [stopId]);
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
  const name = String(b.receiver_name || '').trim().slice(0, 120);
  if (!name) throw new DeliveryError('Who received it? (name)');
  if (st.otp && String(b.otp || '').trim() !== st.otp) throw new DeliveryError('The OTP does not match: ask the customer for the 4-digit code');
  if (photo && !/^image\/(jpeg|png|webp)$/.test(photo.mimetype)) throw new DeliveryError('Photo: a JPEG, PNG or WebP picture');
  await q.query("UPDATE trip_stops SET status = 'delivered', receiver_name = ?, photo = ?, photo_type = ?, done_by = ?, done_at = UTC_TIMESTAMP() WHERE stop_id = ?",
    [name, photo ? photo.buffer : null, photo ? photo.mimetype : null, empId, stopId]);
  const o = await lockOrder(q, st.order_no, ['out_for_delivery']);
  await commerce.setStatus(q, o, 'delivered', empId, `Received by ${name} (trip T-${t.trip_id})${photo ? ', photo' : ''}`, { received_by: name, delivery_attempts: (await attempts(q, o.order_id)) + 1 });
  return { stop_id: stopId, status: 'delivered' };
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
  const o = await lockOrder(q, st.order_no, ['out_for_delivery']);
  await commerce.setStatus(q, o, 'failed', empId, `${full} (trip T-${t.trip_id})`, { failed_reason: full, delivery_attempts: (await attempts(q, o.order_id)) + 1 });
  return { stop_id: stopId, status: 'failed' };
}

/** cash collected at a stop: a cash payment on the order (phase 3) */
async function stopCash(q, stopId, b, empId, office) {
  const st = await stopRow(q, stopId);
  const t = await tripRow(q, st.trip_id);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can record its cash', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${t.trip_id} is ${t.status}`, 409);
  const amount = String(b.amount ?? '').trim();
  const r = await wrap(() => commerce.recordPayment(q, st.order_no, { amount, mode: 'cash', received_on: b.received_on, note: `Collected on trip T-${t.trip_id}` }, empId));
  await q.query('UPDATE trip_stops SET cash_collected = cash_collected + ? WHERE stop_id = ?', [Number(amount), stopId]);
  return { stop_id: stopId, ...r };
}

/** End trip: no stop left pending; cash collected vs handed over */
async function endTrip(q, tripId, b, empId, office) {
  const t = await tripRow(q, tripId, true);
  if (!canDrive(t, empId, office)) throw new DeliveryError('Only the driver of this trip (or the office) can end it', 403);
  if (t.status !== 'out') throw new DeliveryError(`Trip T-${tripId} is ${t.status}`, 409);
  const [[p]] = await q.query("SELECT SUM(status = 'pending') AS open, COALESCE(SUM(cash_collected), 0) AS cash FROM trip_stops WHERE trip_id = ?", [tripId]);
  if (Number(p.open)) throw new DeliveryError(`${p.open} stop(s) still open: mark them delivered or failed first`, 409);
  const handed = String(b.cash_handed ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(handed)) throw new DeliveryError('Cash handed over: the amount, 0 if none');
  const note = String(b.note || '').trim().slice(0, 255) || null;
  const diff = round2(Number(handed) - Number(p.cash));
  if (Math.abs(diff) > 0.005 && !note) throw new DeliveryError(`The cash handed over differs from the cash collected (Rs ${Number(p.cash).toFixed(2)}) by Rs ${diff.toFixed(2)}: add a note`);
  await q.query("UPDATE delivery_trips SET status = 'ended', ended_by = ?, ended_at = UTC_TIMESTAMP(), cash_collected = ?, cash_handed = ?, end_note = ? WHERE trip_id = ?", [empId, Number(p.cash), Number(handed), note, tripId]);
  await audit(q, { empId, action: 'end', entity: 'trip', entityId: `T-${tripId}`, after: { cash_collected: Number(p.cash), cash_handed: Number(handed), difference: diff, note } });
  return { trip_id: tripId, status: 'ended', cash_collected: Number(p.cash), cash_handed: Number(handed), difference: diff };
}

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
  await commerce.doCancel(q, o.order_id, `Delivery failed, returned to the godown: ${why}`, empId);
  return { order_no: orderNo, status: 'cancelled' };
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
  const out = await wrap(() => commerce.leaveGodown(q, o.order_id, empId));
  await commerce.setStatus(q, o, 'delivered', empId, `Collected at the godown by ${name}${out.invoice_no ? `; invoice ${out.invoice_no}` : ''}`, { received_by: name, delivery_attempts: 1 });
  return { order_no: orderNo, status: 'delivered', invoice_no: out.invoice_no };
}

/** the Operations counts */
async function opsCounts(q) {
  const [[r]] = await q.query(
    `SELECT SUM(o.status = 'new') AS to_pick, SUM(o.status = 'packing') AS to_pack,
            SUM(o.status = 'packed' AND o.delivery_kind = 'own' AND NOT EXISTS (SELECT 1 FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.order_id = o.order_id AND s.status = 'pending' AND t.status = 'planned')) AS waiting_trip,
            SUM(o.status = 'packed' AND o.delivery_kind <> 'own') AS waiting_other,
            SUM(o.status = 'out_for_delivery') AS out_now, SUM(o.status = 'with_courier') AS with_courier, SUM(o.status = 'failed') AS failed,
            COALESCE(SUM(CASE WHEN o.payment_terms = 'cod' AND o.status IN ('out_for_delivery', 'with_courier', 'failed') AND o.amount_due > 0 THEN o.amount_due END), 0) AS cod_due
       FROM orders o`);
  const [[c]] = await q.query("SELECT COALESCE(SUM(s.cash_collected), 0) AS held FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE t.status = 'out'");
  return { toPick: Number(r.to_pick) || 0, toPack: Number(r.to_pack) || 0, waitingTrip: Number(r.waiting_trip) || 0, waitingOther: Number(r.waiting_other) || 0,
    outNow: Number(r.out_now) || 0, withCourier: Number(r.with_courier) || 0, failed: Number(r.failed) || 0, codDue: round2(Number(r.cod_due)), cashOnTrips: round2(Number(c.held)) };
}

module.exports = {
  FAIL_REASONS, DeliveryError, pickList, startPacking, packState, packScan, resetScans, markPacked, createTrip, setStops, startTrip,
  stopDelivered, stopFailed, stopCash, endTrip, reattempt, returnToGodown, handToCourier, courierDelivered, pickedUp, opsCounts,
};
