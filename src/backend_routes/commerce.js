// dFresh Commerce (DEMO, database dfresh_commerce): order logic shared by the admin routes (Admin_server.js) and the
// demo seed (scripts/commerce-seed.js), so seeded orders behave exactly like entered ones.
// Money: prices per pack before GST; discount (coupon) on the subtotal; GST on (subtotal - discount) at each SKU's
// rate; the wallet pays last. Status: new -> packed -> dispatched (stock out, stock_movements) -> delivered.
const ORDER_FLOW = ['new', 'packed', 'dispatched', 'delivered'];
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
 * New order. data = { customer_id, items: [{ sku_code, qty, price }], coupon_code?, wallet_use?, payment, note? }.
 * q = a connection inside a transaction. -> { order_id, order_no, ...totals }
 */
async function createOrder(q, data, empId) {
  const customerId = Number(data.customer_id);
  const [[cust]] = await q.query('SELECT customer_id FROM customers WHERE customer_id = ?', [customerId]);
  if (!cust) throw new CommerceError('Choose a customer');
  if (!PAYMENTS[data.payment]) throw new CommerceError('Choose the payment: COD, Razorpay (demo) or bank transfer');
  const raw = Array.isArray(data.items) ? data.items : [];
  const merged = new Map();
  for (const it of raw) {
    const sku = String(it.sku_code || '').trim().toUpperCase();
    const qty = Number(it.qty);
    const price = Number(it.price);
    if (!sku) continue;
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) throw new CommerceError(`${sku}: quantity must be a whole number from 1`);
    if (!(price >= 0) || price > 1000000) throw new CommerceError(`${sku}: price must be 0 or more`);
    merged.set(sku, { sku_code: sku, qty: (merged.get(sku)?.qty || 0) + qty, price: round2(price) });
  }
  if (!merged.size) throw new CommerceError('Add at least one SKU');
  const [known] = await q.query('SELECT s.sku_code, COALESCE(p.gst_rate, 18) AS gst_rate FROM skus s LEFT JOIN sku_prices p ON p.sku_code = s.sku_code WHERE s.sku_code IN (?)', [[...merged.keys()]]);
  const rate = new Map(known.map((k) => [k.sku_code, Number(k.gst_rate)]));
  const missing = [...merged.keys()].filter((k) => !rate.has(k));
  if (missing.length) throw new CommerceError(`Unknown SKU: ${missing.join(', ')}`);
  const items = [...merged.values()].map((i) => ({ ...i, gst_rate: rate.get(i.sku_code) }));

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
  const [ins] = await q.query(
    `INSERT INTO orders (order_no, customer_id, status, payment, coupon_code, subtotal, discount, gst, wallet_used, total, note, emp_id)
     VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderNo, customerId, data.payment, coupon, t.subtotal, t.discount, t.gst, t.walletUsed, t.total, data.note ? String(data.note).slice(0, 255) : null, empId]
  );
  for (const i of items) {
    await q.query('INSERT INTO order_items (order_id, sku_code, qty, price, gst_rate) VALUES (?, ?, ?, ?, ?)', [ins.insertId, i.sku_code, i.qty, i.price, i.gst_rate]);
  }
  if (coupon) await q.query('UPDATE coupons SET used = used + 1 WHERE code = ?', [coupon]);
  if (t.walletUsed > 0) {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
      [customerId, -t.walletUsed, `Used on ${orderNo}`, ins.insertId, empId]);
  }
  return { order_id: ins.insertId, order_no: orderNo, ...t };
}

/** One step on: new -> packed -> dispatched (stock out) -> delivered. -> the new status */
async function advanceOrder(q, orderNo, to, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, status FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
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
  return next;
}

module.exports = { ORDER_FLOW, PAYMENTS, CommerceError, createOrder, advanceOrder, couponDiscount, walletBalance, totals, istYear };
