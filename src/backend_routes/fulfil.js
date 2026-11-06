// Phase 20: sections 8 and 9 Packing and delivery, to the v23 working file. The rules; delivery.js keeps scanning, trips,
// courier and pickup and calls these; fulfil-routes.js has the screens' API.
// - Pick lists (DFK/26-27/0001 per godown): ready orders (confirmed, something held) picked together, one godown per list,
//   given to a packer.
// - Packed (D1): the packs scanned leave Good at once, batch by batch as scanned (dispatch moves no stock any more). Every
//   scanned batch is checked again first: an expired batch ("That batch has expired") or a batch another packer has used
//   since ("Another packer used that batch") is refused. Packs a packer has scanned stay theirs until then (stock.js).
// - Short at packing (Approve on Packing finishes it, with a reason per pack: not on the shelf, found damaged, batch
//   expired; found damaged moves them to the Damaged shelf) and anything still owed as a back-order: with part shipments
//   on (switch), the order is packed and sent with what is there, and the rest moves to a balance order (DFO-260031-2,
//   orders.parent_id) at the same prices, which waits as a back-order; each shipment has its own invoice and trip stop.
// - Delivery: a stop may be delivered short (the customer keeps part) or refused (keeps nothing): the packs not kept come
//   back to the Returned shelf in the batches they left in, through a closed return with its credit note, so the cash
//   due at the stop and the customer's balance drop by what was not kept. Back to Good is a shelf move with approval.
const { audit } = require('./audit');
const commerce = require('./commerce');
const commerceSettings = require('./commerce-settings');
const invoices = require('./invoices');
const numbering = require('./numbering');
const stock = require('./stock');
const wallet = require('./wallet');

class FulfilError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; if (fields) { this.code = 'fields'; this.fields = fields; } }
}
const round2 = (n) => Math.round(n * 100) / 100;
const SHORT_WHY = { notfound: 'Not on the shelf', damaged: 'Found damaged', expired: 'Batch expired' };

// ---------------------------------------------------------------- pick lists
/** packs held for an order now (what packing takes) */
async function heldOf(q, orderId) {
  const [[r]] = await q.query("SELECT COALESCE(SUM(qty), 0) AS n FROM stock_reservations WHERE order_id = ? AND status = 'active'", [orderId]);
  return Number(r.n);
}
/** a pick list for these orders: one godown, each confirmed with packs held -> { pick_id, pick_no } (they become Packing) */
async function makePickList(q, orderNos, empId, admin = null) {
  const nos = [...new Set((orderNos || []).map(String))];
  if (!nos.length) throw new FulfilError('Tick the orders first: choose one or more orders to pick together.');
  const [os] = await q.query('SELECT order_id, order_no, godown_id, status FROM orders WHERE order_no IN (?) FOR UPDATE', [nos]);
  const gs = [...new Set(os.map((o) => o.godown_id))];
  if (gs.length > 1) {
    const [names] = await q.query('SELECT name FROM locations WHERE location_id IN (?) ORDER BY location_id', [gs]);
    throw new FulfilError(`One godown per pick list: the ticked orders ship from ${names.map((n) => n.name).join(' and ')}. Make one list for each.`);
  }
  for (const o of os) {
    if (o.status !== 'new') throw new FulfilError(`${o.order_no} is ${commerce.STATUS_LABEL[o.status]}: only a confirmed order is picked`, 409);
    if (!(await heldOf(q, o.order_id))) throw new FulfilError(`${o.order_no} has nothing held: it waits as a back-order`, 409);
  }
  if (admin && !require('./godowns').covers(admin, gs[0])) throw new FulfilError('You do not work at that godown', 403); // eslint-disable-line global-require
  const pickNo = await numbering.issue(q, 'pick', gs[0]);
  const [ins] = await q.query('INSERT INTO pick_lists (pick_no, godown_id, emp_id) VALUES (?, ?, ?)', [pickNo, gs[0], empId]);
  await q.query('UPDATE orders SET pick_id = ? WHERE order_no IN (?)', [ins.insertId, nos]);
  await audit(q, { empId, action: 'create', entity: 'pick_list', entityId: pickNo, after: { orders: nos } });
  return { pick_id: ins.insertId, pick_no: pickNo, orders: nos };
}
async function givePacker(q, pickId, packer, empId) {
  const [[p]] = await q.query('SELECT pick_id, pick_no, godown_id, packer FROM pick_lists WHERE pick_id = ? FOR UPDATE', [Number(pickId)]);
  if (!p) throw new FulfilError('Pick list not found', 404);
  const who = String(packer || '') || null;
  if (who) {
    const people = await require('./approvals').people(q); // eslint-disable-line global-require
    const x = people.find((y) => y.emp_id === who && y.active);
    if (!x) throw new FulfilError('Choose a packer', 400, { packer: 'Choose a packer.' });
  }
  await q.query('UPDATE pick_lists SET packer = ? WHERE pick_id = ?', [who, p.pick_id]);
  await audit(q, { empId, action: 'update', entity: 'pick_list', entityId: p.pick_no, before: { packer: p.packer }, after: { packer: who } });
  return { pick_no: p.pick_no, packer: who };
}
async function pickDoneCheck(q, pickId) {
  if (!pickId) return;
  const [[r]] = await q.query("SELECT COUNT(*) AS n FROM orders WHERE pick_id = ? AND status = 'packing'", [pickId]);
  if (!Number(r.n)) await q.query("UPDATE pick_lists SET status = 'done', done_at = COALESCE(done_at, UTC_TIMESTAMP()) WHERE pick_id = ?", [pickId]);
}

// ---------------------------------------------------------------- Packed: stock leaves Good (D1), short, part shipment
/**
 * Packing -> Packed. b = { cartons, weight_kg, short: { sku: notfound | damaged | expired }, override_reason (old form:
 * every short line "not on the shelf") }; canApprove: Approve on Packing (finishes a short packing).
 * -> { order_no, status, packed, short, damaged, balance_no }
 */
async function packDone(q, row, b, empId, canApprove) {
  const [[g0]] = await q.query('SELECT godown_id FROM orders WHERE order_id = ?', [row.order_id]);
  const o = { ...row, godown_id: g0.godown_id };
  const cartons = Number(b.cartons);
  const weight = String(b.weight_kg ?? '').trim();
  const fields = {};
  if (!Number.isInteger(cartons) || cartons < 1 || cartons > 999) fields.cartons = 'How many boxes, at least 1.';
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(weight) || Number(weight) <= 0) fields.weight_kg = 'The weight in kg, e.g. 12.5.';
  if (Object.keys(fields).length) throw new FulfilError(Object.values(fields)[0], 400, fields);
  const [picks] = await q.query('SELECT sku_code, batch_id, SUM(qty) AS qty FROM order_picks WHERE order_id = ? GROUP BY sku_code, batch_id', [o.order_id]);
  let [scans] = await q.query("SELECT sku_code, batch_id, SUM(qty) AS qty FROM pack_scans WHERE order_id = ? AND result = 'ok' GROUP BY sku_code, batch_id", [o.order_id]);
  // packed without the scanner (the old override, Approve on Packing with a reason): exactly the picked batches leave
  const noScanner = !scans.some((x) => Number(x.qty) > 0) && String(b.override_reason || '').trim().length > 0;
  if (noScanner) {
    if (!canApprove) throw new FulfilError('Your supervisor (Approve on Packing) packs without the scanner.', 403);
    scans = picks.map((x) => ({ ...x }));
  }
  const need = new Map(); picks.forEach((p) => need.set(p.sku_code, (need.get(p.sku_code) || 0) + Number(p.qty)));
  const got = new Map(); scans.forEach((s) => got.set(s.sku_code, (got.get(s.sku_code) || 0) + Number(s.qty)));
  const packedAll = [...got.values()].reduce((a, n) => a + n, 0);
  if (!packedAll) throw new FulfilError('Nothing packed yet: scan the packs first', 409);
  const short = [...need.entries()].filter(([k, n]) => (got.get(k) || 0) < n).map(([k, n]) => ({ sku: k, n: n - (got.get(k) || 0) }));
  // v23: a batch other than the oldest was packed: a person with Approve on Packing finishes it
  const [[offs]] = await q.query("SELECT COUNT(*) AS n FROM pack_scans WHERE order_id = ? AND result = 'ok' AND off_plan = 1", [o.order_id]);
  if (Number(offs.n) && !canApprove) throw new FulfilError('A batch other than the one picked for it (oldest first) was packed: your supervisor (Approve on Packing) finishes this packing.', 403);
  const why = {};
  if (short.length) {
    const missing = short.filter((x) => !(b.short && SHORT_WHY[b.short[x.sku]]) && !String(b.override_reason || '').trim());
    if (missing.length) throw new FulfilError(`Say why it is short: ${missing.map((x) => `${x.sku} ${x.n}`).join(', ')}: choose a reason in its row.`, 400, { short: missing.map((x) => x.sku).join(',') });
    if (!canApprove) throw new FulfilError('Your supervisor (Approve on Packing) finishes a short packing.', 403);
    const sw = await commerce.orderSwitches(q);
    if (!sw.split) throw new FulfilError('Part shipments are switched off: pack everything, or ask an Admin to switch part shipments on (Switches).', 409);
    short.forEach((x) => { why[x.sku] = (b.short && SHORT_WHY[b.short[x.sku]]) ? b.short[x.sku] : 'notfound'; });
  }
  // every scanned batch again: still there, not expired, not used by another packer since (v23 PK1)
  const gone = [];
  let expired = false; let used = false;
  for (const s of scans.filter((x) => Number(x.qty) > 0)) {
    const lots = await stock.batchStock(q, s.sku_code, 'good', { lock: true, godown: o.godown_id });
    const lot = s.batch_id ? lots.find((l) => l.batch_id === s.batch_id) : { qty: lots.filter((l) => !l.expired).reduce((a, l) => a + l.qty, 0) }; // a pack without batches: the whole shelf
    const others = await stock.scannedLots(q, o.godown_id, s.sku_code, o.order_no);
    const have = lot ? lot.qty - (others.get(Number(s.batch_id) || 0) || 0) : 0;
    if (lot && lot.expired) { expired = true; gone.push(`${s.sku_code} batch ${lot.batch_no}: expired`); } else if (have < Number(s.qty)) { used = true; gone.push(`${s.sku_code}${lot && lot.batch_no ? ` batch ${lot.batch_no}` : ''}: ${s.qty} scanned, ${Math.max(0, have)} left`); }
  }
  if (gone.length) throw new FulfilError(`Scan again: ${gone.join('; ')}. ${expired ? 'That batch has expired: put those packs aside for QC and scan a good batch. ' : ''}${used ? 'Another packer used that batch. ' : ''}Reset the scans and scan the packs you are holding again.`, 409);
  // the packs leave the shelf, exactly the batches scanned
  const doc = { type: 'order', id: o.order_no };
  const [[cu]] = await q.query('SELECT c.name FROM customers c JOIN orders x ON x.customer_id = c.customer_id WHERE x.order_id = ?', [o.order_id]);
  const out = [];
  for (const s of scans.filter((x) => Number(x.qty) > 0)) {
    const lots = await stock.moveStock(q, { sku: s.sku_code, godown: o.godown_id, shelf: 'good', qty: -Number(s.qty), batch: s.batch_id, strict: Boolean(s.batch_id), what: 'out', unitCost: await stock.costNow(q, s.sku_code), doc, note: `Packed for ${cu.name}` }, empId);
    lots.forEach((l) => out.push({ sku_code: s.sku_code, ...l }));
  }
  // found damaged: the short packs move to the Damaged shelf, from the batch picked for them
  let damaged = 0;
  for (const x of short.filter((y) => why[y.sku] === 'damaged')) {
    const pk = picks.find((p) => p.sku_code === x.sku);
    await stock.moveShelf(q, { sku: x.sku, godown: o.godown_id, from: 'good', to: 'dmg', qty: x.n, batch: pk ? pk.batch_id : null, doc, what: 'damaged', note: `Found damaged at packing ${o.order_no}` }, empId);
    damaged += x.n;
  }
  await q.query("UPDATE stock_reservations SET status = 'consumed', closed_at = UTC_TIMESTAMP() WHERE order_id = ? AND status = 'active'", [o.order_id]);
  for (const x of short) await q.query("UPDATE order_items SET short_why = ? WHERE order_id = ? AND sku_code = ?", [why[x.sku], o.order_id, x.sku]);
  // what is not packed (short now, or still owed) goes to a balance order
  const balance = await splitBalance(q, o, got, empId);
  await q.query('UPDATE orders SET stock_out_at = UTC_TIMESTAMP() WHERE order_id = ?', [o.order_id]);
  const shortN = short.reduce((a, x) => a + x.n, 0);
  await commerce.setStatus(q, o, 'packed', empId, `${packedAll} packs left the shelf, ${cartons} carton(s), ${weight} kg${shortN ? `; short ${short.map((x) => `${x.sku} ${x.n} (${SHORT_WHY[why[x.sku]]})`).join(', ')}` : ''}${balance ? `; the rest on ${balance.order_no}` : ''}`,
    { cartons, weight_kg: Number(weight), packed_by: empId, pack_override: noScanner ? `Packed without the scanner: ${String(b.override_reason).trim()}`.slice(0, 255) : shortN ? short.map((x) => `${x.sku} ${x.n} ${SHORT_WHY[why[x.sku]]}`).join('; ').slice(0, 255) : null });
  if (noScanner) await audit(q, { empId, action: 'pack_override', entity: 'order', entityId: o.order_no, after: { reason: String(b.override_reason).trim() } });
  if (shortN) await audit(q, { empId, action: 'pack_short', entity: 'order', entityId: o.order_no, after: { short: short.map((x) => `${x.sku} ${x.n} ${SHORT_WHY[why[x.sku]]}`), balance: balance ? balance.order_no : null } });
  const [[pk]] = await q.query('SELECT pick_id FROM orders WHERE order_id = ?', [o.order_id]);
  await pickDoneCheck(q, pk.pick_id);
  return { order_no: o.order_no, status: 'packed', packed: packedAll, short: shortN, damaged, balance_no: balance ? balance.order_no : null, owed: balance ? balance.owed : 0, batches: out };
}

/** the money of an order again from its lines at their prices: coupon and manual discount as given, delivery charge kept */
async function recalc(q, orderId, { coupon, manual }) {
  const [[o]] = await q.query('SELECT order_id, gst_type, delivery_charge, wallet_used, customer_id, order_no, total FROM orders WHERE order_id = ?', [orderId]);
  const [left] = await q.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY line_id', [orderId]);
  const settings = await commerceSettings.read(q);
  const t = commerce.taxTotals(left.map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price), gst_rate: Number(l.gst_rate), offer_discount: Number(l.offer_discount), is_free: Number(l.is_free) === 1 })), o.gst_type,
    settings.invoice_round_off, { charge: Number(o.delivery_charge), rate: Number(settings.delivery_charge_gst_rate) || 0 }, { coupon, manual });
  for (const l of t.lines) await q.query('UPDATE order_items SET coupon_discount = ?, taxable = ?, cgst = ?, sgst = ?, igst = ?, line_total = ? WHERE line_id = ?', [l.coupon_discount, l.taxable, l.cgst, l.sgst, l.igst, l.line_total, l.line_id]);
  await q.query('UPDATE orders SET subtotal = ?, discount = ?, offer_discount = ?, manual_discount = ?, taxable = ?, cgst = ?, sgst = ?, igst = ?, gst = ?, round_off = ?, total = ?, delivery_gst = ? WHERE order_id = ?',
    [t.subtotal, t.discount, t.offer_discount, t.manual_discount, t.taxable, t.cgst, t.sgst, t.igst, t.gst, t.round_off, t.total, t.delivery_gst, orderId]);
  return t;
}

/** part shipment: what was not packed (per SKU: ordered less packed) moves to a balance order -> { order_no, owed } | null */
async function splitBalance(q, o, packedBySku, empId) {
  const [lines] = await q.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY is_free, kit_key, line_id', [o.order_id]);
  const pool = new Map(packedBySku);
  const owe = [];
  for (const l of lines) {
    const p = Math.min(Number(l.qty), pool.get(l.sku_code) || 0);
    pool.set(l.sku_code, (pool.get(l.sku_code) || 0) - p);
    if (p < Number(l.qty)) owe.push({ l, packed: p, owed: Number(l.qty) - p });
  }
  if (!owe.length) { await q.query('UPDATE order_items SET back_qty = 0 WHERE order_id = ?', [o.order_id]); return null; }
  const [[par]] = await q.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [o.order_id]);
  // DFO-260031 -> DFO-260031-2, then -3 (a balance of a balance keeps counting on the first order's number)
  const root = par.parent_id ? String(par.order_no).replace(/-\d+$/, '') : par.order_no;
  const [[kids]] = await q.query('SELECT COUNT(*) AS n FROM orders WHERE order_no LIKE ?', [`${root}-%`]);
  const no = `${root}-${Number(kids.n) + 2}`;
  const goods = (ls) => ls.reduce((a, x) => a + (Number(x.is_free) ? 0 : Number(x.price) * x.q), 0);
  const parentGoods = goods(lines.map((l) => ({ ...l, q: Number(l.qty) - (owe.find((x) => x.l.line_id === l.line_id) || { owed: 0 }).owed })));
  const balGoods = goods(owe.map((x) => ({ ...x.l, q: x.owed })));
  const share = parentGoods + balGoods > 0 ? balGoods / (parentGoods + balGoods) : 0;
  const coupon = Number(par.discount); const manual = Number(par.manual_discount);
  const cols = ['customer_id', 'godown_id', 'price_list', 'payment_terms', 'credit_days', 'delivery_method_id', 'delivery_kind', 'delivery_area_id', 'bill_name', 'bill_gstin', 'bill_address', 'bill_town', 'bill_state_code', 'bill_pincode',
    'bill_phone', 'bill_address_id', 'ship_name', 'ship_address', 'ship_town', 'ship_state_code', 'ship_pincode', 'ship_phone', 'ship_address_id', 'contact_id', 'place_of_supply', 'gst_type', 'quote_id', 'standing_id'];
  const [ins] = await q.query(`INSERT INTO orders (order_no, status, parent_id, confirmed_at, emp_id, note, manual_discount_reason, subtotal, taxable, gst, total, amount_due, ${cols.join(', ')})
      SELECT ?, 'new', ?, confirmed_at, ?, ?, manual_discount_reason, 0, 0, 0, 0, 0, ${cols.join(', ')} FROM orders WHERE order_id = ?`, [no, o.order_id, empId, `Balance of ${par.order_no}`.slice(0, 255), o.order_id]);
  const bid = ins.insertId;
  for (const x of owe) {
    const l = x.l;
    await q.query(`INSERT INTO order_items (order_id, sku_code, is_free, kit_key, kit_qty, free_why, short_why, qty, back_qty, price, list_price, offer_id, offer_discount, hsn, gst_rate, taxable, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [bid, l.sku_code, l.is_free, l.kit_key, l.kit_qty, l.free_why, l.short_why, x.owed, x.owed, l.price, l.list_price, l.offer_id, round2((Number(l.offer_discount) * x.owed) / Number(l.qty)), l.hsn, l.gst_rate]);
    if (x.packed > 0) await q.query('UPDATE order_items SET qty = ?, back_qty = 0, offer_discount = ? WHERE line_id = ?', [x.packed, round2((Number(l.offer_discount) * x.packed) / Number(l.qty)), l.line_id]);
    else await q.query('DELETE FROM order_items WHERE line_id = ?', [l.line_id]);
  }
  await q.query('UPDATE order_items SET back_qty = 0 WHERE order_id = ?', [o.order_id]);
  await q.query('UPDATE orders SET delivery_charge = 0, delivery_gst = 0 WHERE order_id = ?', [bid]); // the delivery charge stays on the first shipment
  const tp = await recalc(q, o.order_id, { coupon: round2(coupon * (1 - share)), manual: round2(manual * (1 - share)) });
  await recalc(q, bid, { coupon: round2(coupon * share), manual: round2(manual * share) });
  // the wallet stays on the first shipment, never more than it now costs
  if (Number(par.wallet_used) > tp.total + 0.004) { await wallet.giveBack(q, o.order_id, `Given back: ${par.order_no} part shipment`, empId); await wallet.use(q, par.customer_id, tp.total, o.order_id, `${par.order_no} (part shipment)`, empId); await q.query('UPDATE orders SET wallet_used = ? WHERE order_id = ?', [tp.total, o.order_id]); }
  await commerce.refreshPayment(q, o.order_id);
  await commerce.refreshPayment(q, bid);
  // the balance holds what is free now (older back-orders first) and waits as a back-order for the rest
  const h = await commerce.reserve(q, bid);
  await commerce.history(q, bid, null, 'new', `Balance of ${par.order_no}: ${owe.map((x) => `${x.l.sku_code} ${x.owed}`).join(', ')}${h.held ? `; ${h.held} held now` : ''}`, empId);
  await commerce.history(q, o.order_id, 'packing', 'packing', `Part shipment: ${owe.map((x) => `${x.l.sku_code} ${x.owed}`).join(', ')} moved to ${no}`, empId);
  await audit(q, { empId, action: 'part_shipment', entity: 'order', entityId: par.order_no, after: { balance: no, owed: owe.map((x) => `${x.owed} x ${x.l.sku_code}`), total_now: tp.total } });
  return { order_no: no, order_id: bid, owed: owe.reduce((a, x) => a + x.owed, 0) };
}

// ---------------------------------------------------------------- delivered short, refused
/**
 * the packs a customer did not keep come back: to the Returned shelf in the batches they left in, a closed return
 * ("Not taken at delivery") and its credit note on the order's invoice -> { return_no, credit_note_no, total, packs }
 */
async function notKept(q, orderId, back, why, empId) {
  const lines = Object.entries(back).filter(([, n]) => Number(n) > 0).map(([sku, n]) => ({ sku_code: sku, qty: Number(n) }));
  if (!lines.length) return null;
  const [[o]] = await q.query('SELECT order_id, order_no, godown_id FROM orders WHERE order_id = ?', [orderId]);
  const s = await commerceSettings.read(q);
  const [[reason]] = await q.query("SELECT reason_id FROM return_reasons WHERE label = 'Not taken at delivery'");
  const yy = String(commerce.istYear()).padStart(2, '0');
  const returnNo = `${s.return_prefix}-${yy}${numbering.pad(await numbering.next(q, `${s.return_prefix}-${yy}`, 1))}`;
  const [ins] = await q.query(`INSERT INTO returns (return_no, order_id, godown_id, status, reason_id, reason_note, delivered_on, window_days, outside_window, collection, requested_by, received_at, received_by, inspected_at, inspected_by, closed_at)
      VALUES (?, ?, ?, 'closed', ?, ?, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), 0, 0, 'delivery', ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())`,
  [returnNo, o.order_id, o.godown_id, reason ? reason.reason_id : 1, String(why).slice(0, 255), empId, empId, empId]);
  const doc = { type: 'order', id: o.order_no };
  for (const l of lines) {
    // the batches the packs left in, the latest first
    const [outs] = await q.query("SELECT batch_id, -SUM(delta) AS n FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND move_type = 'out' AND sku_code = ? GROUP BY batch_id HAVING n > 0 ORDER BY batch_id DESC", [o.order_no, l.sku_code]);
    let left = l.qty;
    for (const b of outs) {
      if (left <= 0) break;
      const t = Math.min(left, Number(b.n));
      await stock.moveStock(q, { sku: l.sku_code, godown: o.godown_id, shelf: 'ret', qty: t, batch: b.batch_id, what: 'return', doc, note: `Not taken at delivery: ${why}` }, empId);
      await q.query('INSERT INTO return_items (return_id, sku_code, batch_id, qty, qty_received, qty_ok, refund_qty) VALUES (?, ?, ?, ?, ?, ?, ?)', [ins.insertId, l.sku_code, b.batch_id, t, t, t, t]);
      left -= t;
    }
    if (left > 0) throw new FulfilError(`${l.sku_code}: ${l.qty} not kept is more than left on this order`, 409);
  }
  await q.query("INSERT INTO return_history (return_id, status, note, emp_id) VALUES (?, 'closed', ?, ?)", [ins.insertId, `Not taken at delivery: ${why}. On the Returned shelf; credited.`.slice(0, 255), empId]);
  const cn = await invoices.creditNoteForReturn(q, o.order_id, lines, `Not taken at delivery: ${why}`, ins.insertId, empId);
  await commerce.refreshPayment(q, o.order_id);
  await audit(q, { empId, action: 'not_kept', entity: 'order', entityId: o.order_no, after: { return: returnNo, credit_note: cn.credit_note_no, total: cn.total, lines: lines.map((l) => `${l.qty} x ${l.sku_code}`), why } });
  return { return_no: returnNo, credit_note_no: cn.credit_note_no, total: cn.total, packs: lines.reduce((a, l) => a + l.qty, 0) };
}

/** what an order carried (packed and left), per SKU */
async function carried(q, orderId) {
  const [rows] = await q.query('SELECT sku_code, SUM(qty) AS n FROM order_items WHERE order_id = ? GROUP BY sku_code', [orderId]);
  return Object.fromEntries(rows.map((r) => [r.sku_code, Number(r.n)]));
}

/** the stop's "kept" form -> { back: { sku: n }, keptAll } (kept may not pass what was carried) */
async function keptToBack(q, orderId, kept) {
  const had = await carried(q, orderId);
  const back = {}; const fields = {};
  for (const [sku, n] of Object.entries(had)) {
    const k = kept && kept[sku] !== undefined && kept[sku] !== '' ? Number(kept[sku]) : n;
    if (!Number.isInteger(k) || k < 0 || k > n) fields[`kept.${sku}`] = `0 to ${n}.`;
    else if (k < n) back[sku] = n - k;
  }
  if (Object.keys(fields).length) throw new FulfilError(Object.values(fields)[0], 400, fields);
  return { back, had, short: Object.keys(back).length > 0 };
}

module.exports = { FulfilError, SHORT_WHY, heldOf, makePickList, givePacker, pickDoneCheck, packDone, splitBalance, recalc, notKept, carried, keptToBack };
