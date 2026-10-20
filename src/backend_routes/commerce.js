// dFresh Commerce (DEMO, database dfresh_commerce): order logic shared by the admin routes (Admin_server.js) and the
// demo seed (scripts/commerce-demo-seed.js), so seeded orders behave exactly like entered ones.
// Money: order_items.price is per pack before GST; discount (coupon) on the subtotal; GST on (subtotal - discount) at
// each product's rate; the wallet pays last. Status: new -> packed -> dispatched (stock out) -> delivered.
// Prices (phase 2, pricing.js): an empty line price takes the customer type's list price on the order day (Default
// when the type has none); when the lists include GST (Commerce setting) the price is split into price + GST. A price
// below the list by more than the setting puts the order in status "approval" with an approval request; approved ->
// new, rejected / withdrawn / expired -> cancelled (coupon and wallet given back). Quantities respect each SKU's
// minimum order and, when it is sold in cartons only, its carton size.
const pricing = require('./pricing');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');

const ORDER_FLOW = ['new', 'packed', 'dispatched', 'delivered'];
const HELD = { approval: 'is waiting for approval (price below the list)', cancelled: 'is cancelled' };
const PAYMENTS = { cod: 'Cash on delivery', razorpay: 'Razorpay (demo)', bank: 'Bank transfer' };
const round2 = (n) => Math.round(n * 100) / 100;

class CommerceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** India 2-digit year (DFO-26xxxx) */
const istYear = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit' }).format(new Date()));

async function walletBalance(q, customerId) {
  const [[r]] = await q.query('SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_entries WHERE customer_id = ?', [customerId]);
  return Number(r.bal);
}

async function goodStock(q, sku) {
  const [[r]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS good FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [sku]);
  return Number(r.good);
}

/** The coupon's discount for this subtotal, or a CommerceError saying why it does not apply. */
async function couponDiscount(q, code, subtotal, { lock = false } = {}) {
  const [[c]] = await q.query(`SELECT code, kind, value, min_order, expires_on, usage_limit, used, is_active,
      expires_on IS NOT NULL AND expires_on < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) AS expired
      FROM coupons WHERE code = ?${lock ? ' FOR UPDATE' : ''}`, [code]);
  if (!c) throw new CommerceError(`No coupon ${code}`);
  if (!Number(c.is_active)) throw new CommerceError(`Coupon ${code} is switched off`);
  if (Number(c.expired)) throw new CommerceError(`Coupon ${code} has expired`);
  if (c.usage_limit !== null && c.used >= c.usage_limit) throw new CommerceError(`Coupon ${code} is used up (${c.used} of ${c.usage_limit})`);
  if (subtotal < Number(c.min_order)) throw new CommerceError(`Coupon ${code} needs an order of at least Rs ${Number(c.min_order)}`);
  const d = c.kind === 'percent' ? subtotal * (Number(c.value) / 100) : Number(c.value);
  return round2(Math.min(d, subtotal));
}

/** Totals for items [{ sku_code, qty, price, gst_rate }] with an optional discount and wallet amount. */
function totals(items, discount = 0, walletUsed = 0) {
  const subtotal = round2(items.reduce((a, i) => a + i.qty * i.price, 0));
  const share = subtotal ? (subtotal - discount) / subtotal : 0; // the discount spread over the items for GST
  const gst = round2(items.reduce((a, i) => a + i.qty * i.price * share * (i.gst_rate / 100), 0));
  const beforeWallet = round2(subtotal - discount + gst);
  return { subtotal, discount: round2(discount), gst, beforeWallet, walletUsed: round2(Math.min(walletUsed, beforeWallet)), total: round2(beforeWallet - Math.min(walletUsed, beforeWallet)) };
}

/**
 * New order. data = { customer_id, items: [{ sku_code, qty (packs), price (empty = the list price) }], coupon_code?,
 * wallet_use?, payment, note? }. opts.replacement: a free replacement (no quantity rules, no price approval);
 * opts.priceDate (demo seed only, for back-dated orders): the day whose list prices apply (default today).
 * q = a connection inside a transaction. -> { order_id, order_no, status, held, approval_id, price_list, ...totals }
 */
async function createOrder(q, data, empId, opts = {}) {
  const customerId = Number(data.customer_id);
  const [[cust]] = await q.query('SELECT customer_id, name FROM customers WHERE customer_id = ?', [customerId]);
  if (!cust) throw new CommerceError('Choose a customer');
  if (!PAYMENTS[data.payment]) throw new CommerceError('Choose the payment: COD, Razorpay (demo) or bank transfer');
  const raw = Array.isArray(data.items) ? data.items : [];
  const merged = new Map();
  for (const it of raw) {
    const sku = String(it.sku_code || '').trim().toUpperCase();
    const qty = Number(it.qty);
    if (!sku) continue;
    const p = pricing.parsePrice(it.price);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new CommerceError(`${sku}: quantity must be a whole number from 1`);
    if (p.error) throw new CommerceError(`${sku}: ${p.error}`);
    const had = merged.get(sku);
    merged.set(sku, { sku_code: sku, qty: (had ? had.qty : 0) + qty, entered: had && had.entered !== null ? had.entered : p.value });
  }
  if (!merged.size) throw new CommerceError('Add at least one SKU');
  const [known] = await q.query(
    `SELECT s.sku_code, s.is_active, s.packs_per_carton, s.min_order_qty, s.sell_unit, p.gst_rate, p.hsn_code
       FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code IN (?)`, [[...merged.keys()]]
  );
  const info = new Map(known.map((k) => [k.sku_code, k]));
  const missing = [...merged.keys()].filter((k) => !info.has(k));
  if (missing.length) throw new CommerceError(`Unknown SKU: ${missing.join(', ')}`);
  const off = [...merged.keys()].filter((k) => !Number(info.get(k).is_active));
  if (off.length && !opts.replacement) throw new CommerceError(`Switched off, cannot be ordered: ${off.join(', ')}`);
  const list = await pricing.listOfCustomer(q, customerId);
  const own = await pricing.ownPricesOn(q, opts.priceDate || pricing.istToday(), [...merged.keys()]);
  const settings = await commerceSettings.read(q);
  const inclusive = settings.prices_include_gst === 'inclusive';
  const problems = [];
  const items = [...merged.values()].map((i) => {
    const s = info.get(i.sku_code);
    if (!opts.replacement) { const bad = pricing.qtyProblem(s, i.qty); if (bad) problems.push(bad); }
    const listPrice = pricing.resolve(own.get(i.sku_code), list.key).price;
    let entered = i.entered;
    if (entered === null) {
      if (listPrice === null) problems.push(`${i.sku_code} has no price on the ${list.label} or Default list: set it in Products and prices`);
      entered = listPrice || 0;
    }
    const rate = Number(s.gst_rate);
    const below = listPrice && entered < listPrice ? round2(((listPrice - entered) / listPrice) * 100) : 0;
    return { sku_code: i.sku_code, qty: i.qty, entered, list_price: listPrice, below, gst_rate: rate, hsn: s.hsn_code,
      price: inclusive ? round2(entered / (1 + rate / 100)) : entered };
  });
  if (problems.length) throw new CommerceError(problems.join('. '));
  const maxBelow = Math.max(0, ...items.map((i) => i.below));
  const held = !opts.replacement && maxBelow > 0 && await approvals.needed(q, 'price_below_list', { pct: maxBelow });

  const sub = totals(items).subtotal;
  const coupon = data.coupon_code ? String(data.coupon_code).trim().toUpperCase() : null;
  const discount = coupon ? await couponDiscount(q, coupon, sub, { lock: true }) : 0;
  const wantWallet = Math.max(0, Number(data.wallet_use) || 0);
  if (wantWallet > 0) {
    const bal = await walletBalance(q, customerId);
    if (wantWallet > bal + 0.001) throw new CommerceError(`The wallet has only Rs ${bal.toFixed(2)}`);
  }
  const t = totals(items, discount, wantWallet);

  const yr = istYear();
  await q.query('INSERT INTO order_counters (yr, last_no) VALUES (?, 1) ON DUPLICATE KEY UPDATE last_no = last_no + 1', [yr]);
  const [[ctr]] = await q.query('SELECT last_no FROM order_counters WHERE yr = ?', [yr]);
  const orderNo = `DFO-${String(yr).padStart(2, '0')}${String(ctr.last_no).padStart(4, '0')}`;
  const status = held ? 'approval' : 'new';
  const [ins] = await q.query(
    `INSERT INTO orders (order_no, customer_id, status, price_list, payment, coupon_code, subtotal, discount, gst, wallet_used, total, note, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderNo, customerId, status, list.key, data.payment, coupon, t.subtotal, t.discount, t.gst, t.walletUsed, t.total, data.note ? String(data.note).slice(0, 255) : null, empId]
  );
  for (const i of items) {
    await q.query('INSERT INTO order_items (order_id, sku_code, qty, price, gst_rate, hsn, list_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ins.insertId, i.sku_code, i.qty, i.price, i.gst_rate, i.hsn, i.list_price]);
  }
  if (coupon) await q.query('UPDATE coupons SET used = used + 1 WHERE code = ?', [coupon]);
  if (t.walletUsed > 0) {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
      [customerId, -t.walletUsed, `Used on ${orderNo}`, ins.insertId, empId]);
  }
  let approvalId = null;
  if (held) {
    const limit = settings.approve_price_below_pct;
    const lines = items.filter((i) => i.below > limit);
    approvalId = await approvals.request(q, {
      kind: 'price_below_list', refType: 'order', refId: orderNo,
      summary: `${orderNo} for ${cust.name}: ${lines.map((i) => `${i.sku_code} at Rs ${i.entered} (${list.label} list Rs ${i.list_price}, ${i.below}% below)`).join('; ')}`,
      amount: round2(lines.reduce((a, i) => a + (i.list_price - i.entered) * i.qty, 0)),
      payload: { order_no: orderNo, list: list.key, lines: lines.map((i) => ({ sku_code: i.sku_code, qty: i.qty, price: i.entered, list_price: i.list_price, below: i.below })) },
    }, empId);
  }
  return { order_id: ins.insertId, order_no: orderNo, status, held, approval_id: approvalId, price_list: list.label, ...t };
}

/** A held order whose approval was rejected / withdrawn / expired: cancelled, its coupon use and wallet use given back. */
async function cancelHeld(q, orderNo, reason, empId) {
  const [[o]] = await q.query('SELECT order_id, customer_id, status, coupon_code, wallet_used FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o || o.status !== 'approval') return false;
  await q.query("UPDATE orders SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), cancel_reason = ? WHERE order_id = ?", [String(reason).slice(0, 255), o.order_id]);
  if (o.coupon_code) await q.query('UPDATE coupons SET used = GREATEST(used - 1, 0) WHERE code = ?', [o.coupon_code]);
  if (Number(o.wallet_used) > 0) {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
      [o.customer_id, Number(o.wallet_used), `Given back: ${orderNo} cancelled`, o.order_id, empId]);
  }
  return true;
}

approvals.onApproved('price_below_list', async (q, p) => {
  await q.query("UPDATE orders SET status = 'new' WHERE order_no = ? AND status = 'approval'", [p.order_no]);
});
approvals.onClosed('price_below_list', async (q, p, status, empId) => {
  await cancelHeld(q, p.order_no, `Price below the list: approval ${status}`, empId);
});

/** Delivered: the cashback rule (database/demo/commerce-demo-schema.sql) credits pct % of (subtotal - discount) to the wallet. */
async function cashback(q, orderId, empId) {
  const [[rule]] = await q.query('SELECT pct, min_order, is_active FROM cashback_rule WHERE rule_id = 1').catch(() => [[null]]);
  if (!rule || !Number(rule.is_active)) return 0;
  const [[o]] = await q.query('SELECT order_no, customer_id, subtotal, discount FROM orders WHERE order_id = ?', [orderId]);
  const base = Number(o.subtotal) - Number(o.discount);
  if (base <= 0 || base < Number(rule.min_order)) return 0;
  const amount = round2(base * (Number(rule.pct) / 100));
  await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
    [o.customer_id, amount, `Cashback ${Number(rule.pct)}% on ${o.order_no}`, orderId, empId]);
  return amount;
}

/** One step on: new -> packed -> dispatched (stock out) -> delivered. -> the new status */
async function advanceOrder(q, orderNo, to, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, status FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  if (HELD[o.status]) throw new CommerceError(`${orderNo} ${HELD[o.status]}`, 409);
  const next = ORDER_FLOW[ORDER_FLOW.indexOf(o.status) + 1];
  if (!next || to !== next) throw new CommerceError(`${orderNo} is ${o.status}: the next step is ${next || 'none (delivered)'}`, 409);
  if (next === 'dispatched') {
    const [items] = await q.query('SELECT sku_code, qty FROM order_items WHERE order_id = ? ORDER BY sku_code', [o.order_id]);
    for (const i of items) {
      await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [i.sku_code]);
      const have = await goodStock(q, i.sku_code);
      if (have < i.qty) throw new CommerceError(`Not enough ${i.sku_code} in the godown: ${have} good, ${i.qty} needed`, 409);
    }
    for (const i of items) {
      await q.query("INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id) VALUES (?, 'out', 'good', ?, ?, ?)",
        [i.sku_code, -i.qty, `Dispatched ${orderNo}`, empId]);
    }
  }
  await q.query(`UPDATE orders SET status = ?, ${next}_at = UTC_TIMESTAMP() WHERE order_id = ?`, [next, o.order_id]);
  if (next === 'delivered') await cashback(q, o.order_id, empId);
  return next;
}

const OUTCOMES = { wallet: 'Refund to wallet', refund: 'Refund to payment (demo)', replacement: 'Replacement' };

/**
 * Return on a DELIVERED order. data = { items: [{ sku_code, qty, item_check: 'ok' | 'damaged' }], reason, outcome }.
 * Stock: ok -> Returned (R), damaged -> Damaged. Amount = the paid value of those packs (after discount, with GST).
 */
async function createReturn(q, orderNo, data, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, customer_id, status, subtotal, discount FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  if (o.status !== 'delivered') throw new CommerceError(`${orderNo} is ${o.status}: only a delivered order can be returned`, 409);
  if (!OUTCOMES[data.outcome]) throw new CommerceError('Choose the outcome: refund to wallet, refund (demo) or replacement');
  const reason = String(data.reason || '').trim().slice(0, 255);
  if (!reason) throw new CommerceError('Give the reason for the return');
  const [ordered] = await q.query('SELECT sku_code, qty, price, gst_rate FROM order_items WHERE order_id = ?', [o.order_id]);
  const [already] = await q.query('SELECT ri.sku_code, SUM(ri.qty) AS qty FROM return_items ri JOIN returns r ON r.return_id = ri.return_id WHERE r.order_id = ? GROUP BY ri.sku_code', [o.order_id]);
  const back = new Map(already.map((a) => [a.sku_code, Number(a.qty)]));
  const lines = (Array.isArray(data.items) ? data.items : [])
    .map((i) => ({ sku_code: String(i.sku_code || ''), qty: Number(i.qty), item_check: i.item_check === 'damaged' ? 'damaged' : 'ok' }))
    .filter((i) => i.qty > 0);
  if (!lines.length) throw new CommerceError('Choose at least one pack to return');
  const share = Number(o.subtotal) ? (Number(o.subtotal) - Number(o.discount)) / Number(o.subtotal) : 0;
  let amount = 0;
  const per = new Map();
  for (const l of lines) {
    const it = ordered.find((x) => x.sku_code === l.sku_code);
    if (!it || !Number.isInteger(l.qty)) throw new CommerceError(`${l.sku_code} is not in ${orderNo}`);
    per.set(l.sku_code, (per.get(l.sku_code) || 0) + l.qty);
    if (per.get(l.sku_code) + (back.get(l.sku_code) || 0) > it.qty) {
      throw new CommerceError(`${l.sku_code}: ${it.qty} ordered, ${back.get(l.sku_code) || 0} already returned`);
    }
    amount += l.qty * Number(it.price) * share * (1 + Number(it.gst_rate) / 100);
  }
  amount = round2(amount);
  const yr = istYear();
  await q.query('INSERT INTO return_counters (yr, last_no) VALUES (?, 1) ON DUPLICATE KEY UPDATE last_no = last_no + 1', [yr]);
  const [[ctr]] = await q.query('SELECT last_no FROM return_counters WHERE yr = ?', [yr]);
  const returnNo = `DFR-${String(yr).padStart(2, '0')}${String(ctr.last_no).padStart(4, '0')}`;
  const [ins] = await q.query('INSERT INTO returns (return_no, order_id, reason, outcome, amount, emp_id) VALUES (?, ?, ?, ?, ?, ?)',
    [returnNo, o.order_id, reason, data.outcome, amount, empId]);
  for (const l of lines) {
    await q.query('INSERT INTO return_items (return_id, sku_code, qty, item_check) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)',
      [ins.insertId, l.sku_code, l.qty, l.item_check]);
    await q.query("INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id) VALUES (?, 'return', ?, ?, ?, ?)",
      [l.sku_code, l.item_check === 'ok' ? 'returned' : 'damaged', l.qty, `${returnNo} on ${orderNo}: ${reason}`.slice(0, 255), empId]);
  }
  let replacement = null;
  if (data.outcome === 'wallet') {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
      [o.customer_id, amount, `Refund ${returnNo} (${orderNo})`, o.order_id, empId]);
  } else if (data.outcome === 'replacement') {
    const items = [...per.entries()].map(([sku, qty]) => ({ sku_code: sku, qty, price: 0 }));
    replacement = await createOrder(q, { customer_id: o.customer_id, items, payment: 'cod', note: `Replacement for ${returnNo} (${orderNo})` }, empId, { replacement: true });
    await q.query('UPDATE returns SET replacement_order_id = ? WHERE return_id = ?', [replacement.order_id, ins.insertId]);
  }
  return { return_no: returnNo, amount, outcome: data.outcome, replacement_no: replacement ? replacement.order_no : null };
}

module.exports = { ORDER_FLOW, HELD, PAYMENTS, OUTCOMES, CommerceError, createOrder, advanceOrder, createReturn, couponDiscount, walletBalance, totals, istYear };
