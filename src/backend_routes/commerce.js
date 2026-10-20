// dFresh Commerce: order logic shared by the admin routes (Admin_server.js) and the demo seed
// (scripts/commerce-demo-seed.js), so seeded orders behave exactly like entered ones. Tables: migration
// 20261020_commerce_sales.sql (orders, lines, history, reservations, payments, invoices); customers, coupons, wallet,
// stock movements and returns are still the demo tables (database/demo) until their phases.
//
// Status: approval (waiting for one or more approvals) -> new (confirmed) -> packed -> dispatched -> delivered;
// cancelled from any status before delivered (after dispatch only through an approval, Commerce setting).
// Edit: approval / new = everything except the customer; packed = with a reason; dispatched and later = never.
// Every edit sends the version it read: another change in between answers "This order changed, reload".
//
// Money (per line): taxable = qty x price less its share of the coupon; CGST + SGST (half the rate each) when the
// shipping state is the seller's state, else IGST; total = taxable + GST + round-off (Commerce setting). Prices typed
// or taken from the price list (pricing.js; split out of the price when the lists include GST). Wallet credit used
// counts as paid; payments and refunds are recorded rows; amount_due = total - wallet - payments + refunds.
//
// Stock: Available = good stock - active reservations of other orders. An order cannot ask for more than available,
// except with the override (a role with "approve" on Orders), which waits for approval. Reservations are made when the
// order is confirmed (or when it is packed: Commerce setting stock_reserve_at), re-made on every edit, consumed at
// dispatch (stock out) and released on cancel.
//
// Approvals that hold an order (status "approval" until every one is approved; any rejected / withdrawn / expired
// cancels it): a price below the list (phase 2), more than the available stock (override), a customer over the
// credit limit or with overdue invoices (new orders only).
//
// Invoice: issued at dispatch (or at confirm: setting), numbered DFI/26-27/0001 (invoices.js).
const pricing = require('./pricing');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const invoices = require('./invoices');
const numbering = require('./numbering');
const { audit } = require('./audit');
const { checkSetting } = require('../shared/settingRules');
const { isStateCode, stateName } = require('../shared/gstStates');

const ORDER_FLOW = ['new', 'packed', 'dispatched', 'delivered'];
const STATUS_LABEL = { approval: 'Waiting for approval', new: 'New', packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const HELD = { approval: 'is waiting for approval', cancelled: 'is cancelled' };
const TERMS = { cod: 'Pay on delivery', advance: 'Paid in advance', credit: 'On credit' };
const MODES = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque', razorpay: 'Razorpay (manual)' };
const PAYMENT_STATUS = { unpaid: 'Unpaid', partly_paid: 'Part paid', paid: 'Paid', refunded: 'Refunded' };
const HOLD_KINDS = ['price_below_list', 'over_available', 'credit_order'];
const EDITABLE = { approval: 'free', new: 'free', packed: 'reason' };
const round2 = (n) => Math.round(n * 100) / 100;
// An invoice is overdue when its order still owes money after the due date (issue day + the credit days); a pay-on-
// delivery order only once it is delivered. SQL with i = invoices, o = orders.
const OVERDUE_SQL = `(i.status = 'issued' AND o.status <> 'cancelled' AND o.amount_due > 0.005
  AND i.due_on < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) AND (o.payment_terms <> 'cod' OR o.status = 'delivered'))`;

class CommerceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** India 2-digit year (DFO-26xxxx, DFR-26xxxx) */
const istYear = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit' }).format(new Date()));
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function walletBalance(q, customerId) {
  const [[r]] = await q.query('SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_entries WHERE customer_id = ?', [customerId]);
  return Number(r.bal);
}

async function goodStock(q, sku) {
  const [[r]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS good FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [sku]);
  return Number(r.good);
}

/** good stock, active reservations (of other orders than exceptOrderId) and available per SKU -> Map */
async function availability(q, skuCodes, exceptOrderId = null) {
  const out = new Map();
  if (!skuCodes.length) return out;
  const [good] = await q.query("SELECT sku_code, COALESCE(SUM(delta), 0) AS good FROM stock_movements WHERE stock_kind = 'good' AND sku_code IN (?) GROUP BY sku_code", [skuCodes]);
  const [res] = await q.query("SELECT sku_code, COALESCE(SUM(qty), 0) AS qty FROM stock_reservations WHERE status = 'active' AND sku_code IN (?) AND order_id <> ? GROUP BY sku_code", [skuCodes, exceptOrderId || 0]);
  const g = new Map(good.map((r) => [r.sku_code, Number(r.good)]));
  const r = new Map(res.map((x) => [x.sku_code, Number(x.qty)]));
  for (const s of skuCodes) out.set(s, { good: g.get(s) || 0, reserved: r.get(s) || 0, available: (g.get(s) || 0) - (r.get(s) || 0) });
  return out;
}

/** The coupon's discount for this subtotal, or a CommerceError saying why it does not apply. */
async function couponDiscount(q, code, subtotal, { lock = false, ownUse = false } = {}) {
  const [[c]] = await q.query(`SELECT code, kind, value, min_order, expires_on, usage_limit, used, is_active,
      expires_on IS NOT NULL AND expires_on < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) AS expired
      FROM coupons WHERE code = ?${lock ? ' FOR UPDATE' : ''}`, [code]);
  if (!c) throw new CommerceError(`No coupon ${code}`);
  if (!Number(c.is_active)) throw new CommerceError(`Coupon ${code} is switched off`);
  if (Number(c.expired) && !ownUse) throw new CommerceError(`Coupon ${code} has expired`);
  if (!ownUse && c.usage_limit !== null && c.used >= c.usage_limit) throw new CommerceError(`Coupon ${code} is used up (${c.used} of ${c.usage_limit})`);
  if (subtotal < Number(c.min_order)) throw new CommerceError(`Coupon ${code} needs an order of at least Rs ${Number(c.min_order)}`);
  const d = c.kind === 'percent' ? subtotal * (Number(c.value) / 100) : Number(c.value);
  return round2(Math.min(d, subtotal));
}

/**
 * Line tax and order totals. lines: [{ qty, price, gst_rate }] (price before GST). gstType 'intra' | 'inter'.
 * -> { lines (with taxable, cgst, sgst, igst, line_total), subtotal, discount, taxable, cgst, sgst, igst, gst, round_off, total }
 */
function taxTotals(lines, discount, gstType, roundOff) {
  const subtotal = round2(lines.reduce((a, i) => a + i.qty * i.price, 0));
  const disc = round2(Math.min(discount || 0, subtotal));
  const share = subtotal ? (subtotal - disc) / subtotal : 0;
  const out = lines.map((i) => {
    const taxable = round2(i.qty * i.price * share);
    const half = gstType === 'intra' ? round2((taxable * i.gst_rate) / 200) : 0;
    const igst = gstType === 'inter' ? round2((taxable * i.gst_rate) / 100) : 0;
    return { ...i, taxable, cgst: half, sgst: half, igst, line_total: round2(taxable + 2 * half + igst) };
  });
  const sum = (k) => round2(out.reduce((a, i) => a + i[k], 0));
  const taxable = sum('taxable');
  const [cgst, sgst, igst] = [sum('cgst'), sum('sgst'), sum('igst')];
  const gst = round2(cgst + sgst + igst);
  const before = round2(taxable + gst);
  const ro = roundOff ? round2(Math.round(before) - before) : 0;
  return { lines: out, subtotal, discount: disc, taxable, cgst, sgst, igst, gst, round_off: ro, total: round2(before + ro) };
}

/** an address from the admin (or the customer) -> { values, error } */
function checkAddress(raw, which) {
  const t = (k) => String((raw || {})[k] ?? '').trim();
  const v = { name: t('name'), gstin: t('gstin') || null, address: t('address') || null, town: t('town') || null, state_code: t('state_code'), pincode: t('pincode') || null, phone: t('phone') || null };
  const label = which === 'bill' ? 'Billing' : 'Shipping';
  if (!v.name) return { error: `${label} address: the name is required` };
  if (v.name.length > 150 || (v.address || '').length > 255 || (v.town || '').length > 80) return { error: `${label} address: a value is too long` };
  if (!isStateCode(v.state_code)) return { error: `${label} address: choose the state` };
  if (v.pincode && !/^[1-9]\d{5}$/.test(v.pincode)) return { error: `${label} address: PIN code is 6 digits` };
  if (which === 'bill' && v.gstin) {
    const g = checkSetting('gstin', v.gstin);
    if (g.error) return { error: `Billing GSTIN: ${g.error}` };
    v.gstin = g.value;
    if (v.gstin.slice(0, 2) !== v.state_code) return { error: `Billing GSTIN ${v.gstin} is registered in ${stateName(v.gstin.slice(0, 2))}, not ${stateName(v.state_code)}` };
  }
  if (which === 'ship') delete v.gstin;
  return { values: v };
}

/** the customer's address as the default billing / shipping address */
const customerAddress = (c) => ({ name: c.business_name || c.name, gstin: c.gstin || null, address: c.address, town: c.town, state_code: c.state_code || '33', pincode: c.pincode || null, phone: c.phone });

/** overdue invoices of a customer -> { n, amount } */
async function overdueOf(q, customerId) {
  const [[r]] = await q.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(o.amount_due), 0) AS amount FROM invoices i JOIN orders o ON o.order_id = i.order_id
      WHERE o.customer_id = ? AND ${OVERDUE_SQL}`, [customerId]
  );
  return { n: Number(r.n), amount: Number(r.amount) };
}

/** what the customer owes on all open orders (except one) */
async function outstandingOf(q, customerId, exceptOrderId = 0) {
  const [[r]] = await q.query("SELECT COALESCE(SUM(amount_due), 0) AS due FROM orders WHERE customer_id = ? AND status <> 'cancelled' AND order_id <> ? AND amount_due > 0", [customerId, exceptOrderId]);
  return Number(r.due);
}

/**
 * Everything an order needs, checked: shared by create and edit (nothing is written).
 * data = { customer_id, items: [{ sku_code, qty (packs), price ('' = list) }], coupon_code, wallet_use, payment_terms, note,
 *          bill, ship, override_stock }
 * opts = { replacement, priceDate, order (the row being edited), canOverride, isNew }
 */
async function prepare(q, data, opts = {}) {
  const editing = opts.order || null;
  const customerId = editing ? editing.customer_id : Number(data.customer_id);
  const [[cust]] = await q.query('SELECT customer_id, name, business_name, phone, gstin, address, town, state_code, pincode, credit_days, credit_limit FROM customers WHERE customer_id = ?', [customerId]);
  if (!cust) throw new CommerceError('Choose a customer');
  const terms = String(data.payment_terms || (editing ? editing.payment_terms : 'cod'));
  if (!TERMS[terms]) throw new CommerceError('Choose the payment terms: pay on delivery, paid in advance or on credit');

  // lines
  const merged = new Map();
  for (const it of Array.isArray(data.items) ? data.items : []) {
    const sku = String(it.sku_code || '').trim().toUpperCase();
    if (!sku) continue;
    const qty = Number(it.qty);
    const p = pricing.parsePrice(it.price);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new CommerceError(`${sku}: quantity must be a whole number from 1`);
    if (p.error) throw new CommerceError(`${sku}: ${p.error}`);
    const had = merged.get(sku);
    merged.set(sku, { sku_code: sku, qty: (had ? had.qty : 0) + qty, entered: had && had.entered !== null ? had.entered : p.value });
  }
  if (!merged.size) throw new CommerceError('Add at least one SKU');
  const keys = [...merged.keys()];
  const [known] = await q.query(
    `SELECT s.sku_code, s.is_active, s.packs_per_carton, s.min_order_qty, s.sell_unit, p.gst_rate, p.hsn_code
       FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code IN (?)`, [keys]
  );
  const info = new Map(known.map((k) => [k.sku_code, k]));
  const missing = keys.filter((k) => !info.has(k));
  if (missing.length) throw new CommerceError(`Unknown SKU: ${missing.join(', ')}`);
  const off = keys.filter((k) => !Number(info.get(k).is_active));
  if (off.length && !opts.replacement) throw new CommerceError(`Switched off, cannot be ordered: ${off.join(', ')}`);

  const list = await pricing.listOfCustomer(q, customerId);
  const own = await pricing.ownPricesOn(q, opts.priceDate || pricing.istToday(), keys);
  const settings = await commerceSettings.read(q);
  const inclusive = settings.prices_include_gst === 'inclusive';
  const stock = await availability(q, keys, editing ? editing.order_id : 0);
  const problems = [];
  const short = [];
  const lines = [...merged.values()].map((i) => {
    const s = info.get(i.sku_code);
    if (!opts.replacement) { const bad = pricing.qtyProblem(s, i.qty); if (bad) problems.push(bad); }
    const listPrice = pricing.resolve(own.get(i.sku_code), list.key).price;
    let entered = i.entered;
    if (entered === null) {
      if (listPrice === null) problems.push(`${i.sku_code} has no price on the ${list.label} or Default list: set it in Products and prices`);
      entered = listPrice || 0;
    }
    const st = stock.get(i.sku_code);
    if (!opts.replacement && i.qty > st.available) short.push({ sku_code: i.sku_code, qty: i.qty, ...st });
    const rate = Number(s.gst_rate);
    const below = listPrice && entered < listPrice ? round2(((listPrice - entered) / listPrice) * 100) : 0;
    return { sku_code: i.sku_code, qty: i.qty, entered, list_price: listPrice, below, gst_rate: rate, hsn: s.hsn_code,
      price: inclusive ? round2(entered / (1 + rate / 100)) : entered };
  });
  if (short.length && !data.override_stock) {
    short.forEach((x) => problems.push(`${x.sku_code}: only ${Math.max(x.available, 0)} available (${x.good} in stock, ${x.reserved} reserved for other orders); ${x.qty} asked`));
  }
  if (short.length && data.override_stock && !opts.canOverride) problems.push('Ordering more than the available stock needs a role with "approve" on Orders');
  if (problems.length) throw new CommerceError(problems.join('. '));

  // addresses and GST type
  const base = customerAddress(cust);
  const prevBill = editing ? { name: editing.bill_name, gstin: editing.bill_gstin, address: editing.bill_address, town: editing.bill_town, state_code: editing.bill_state_code, pincode: editing.bill_pincode, phone: editing.bill_phone } : base;
  const prevShip = editing ? { name: editing.ship_name, address: editing.ship_address, town: editing.ship_town, state_code: editing.ship_state_code, pincode: editing.ship_pincode, phone: editing.ship_phone } : base;
  const bill = checkAddress(data.bill ? { ...prevBill, ...data.bill } : prevBill, 'bill');
  if (bill.error) throw new CommerceError(bill.error);
  const ship = checkAddress(data.ship ? { ...prevShip, ...data.ship } : prevShip, 'ship');
  if (ship.error) throw new CommerceError(ship.error);
  const pos = ship.values.state_code;
  const gstType = pos === String(settings.invoice_seller_state_code || '33') ? 'intra' : 'inter';

  // coupon and wallet
  const coupon = data.coupon_code ? String(data.coupon_code).trim().toUpperCase() : null;
  const sub = round2(lines.reduce((a, i) => a + i.qty * i.price, 0));
  const ownCoupon = Boolean(editing && coupon && editing.coupon_code === coupon);
  const discount = coupon ? await couponDiscount(q, coupon, sub, { lock: true, ownUse: ownCoupon }) : 0;
  const t = taxTotals(lines, discount, gstType, settings.invoice_round_off);
  const wantWallet = round2(Math.max(0, Number(data.wallet_use) || 0));
  if (wantWallet > 0) {
    const bal = (await walletBalance(q, customerId)) + (editing ? Number(editing.wallet_used) : 0);
    if (wantWallet > bal + 0.001) throw new CommerceError(`The wallet has only ${rs(bal)}`);
  }
  const walletUsed = round2(Math.min(wantWallet, t.total));

  // what holds the order
  const holds = [];
  if (!opts.replacement) {
    const maxBelow = Math.max(0, ...lines.map((i) => i.below));
    if (maxBelow > 0 && await approvals.needed(q, 'price_below_list', { pct: maxBelow })) {
      const bl = lines.filter((i) => i.below > settings.approve_price_below_pct);
      holds.push({ kind: 'price_below_list', amount: round2(bl.reduce((a, i) => a + (i.list_price - i.entered) * i.qty, 0)),
        what: bl.map((i) => `${i.sku_code} at Rs ${i.entered} (${list.label} list Rs ${i.list_price}, ${i.below}% below)`).join('; '),
        lines: bl.map((i) => ({ sku_code: i.sku_code, qty: i.qty, price: i.entered, list_price: i.list_price, below: i.below })) });
    }
    if (short.length && await approvals.needed(q, 'over_available')) {
      holds.push({ kind: 'over_available', amount: null, what: short.map((x) => `${x.sku_code} ${x.qty} asked, ${Math.max(x.available, 0)} available`).join('; '), lines: short });
    }
    if (opts.isNew) {
      const over = await overdueOf(q, customerId);
      const outstanding = await outstandingOf(q, customerId);
      const thisDue = round2(t.total - walletUsed);
      const reasons = [];
      if (over.n) reasons.push(`${over.n} overdue invoice${over.n === 1 ? '' : 's'} (${rs(over.amount)})`);
      if (terms === 'credit' && outstanding + thisDue > Number(cust.credit_limit) + 0.005) {
        reasons.push(`credit limit ${rs(cust.credit_limit)}: ${rs(outstanding)} open + this order ${rs(thisDue)}`);
      }
      if (reasons.length && await approvals.needed(q, 'credit_order')) holds.push({ kind: 'credit_order', amount: round2(outstanding + thisDue), what: reasons.join('; ') });
    }
  }
  return { cust, list, terms, creditDays: Number(cust.credit_days) || 0, lines: t.lines, totals: t, coupon, walletUsed, bill: bill.values, ship: ship.values, pos, gstType, holds, settings };
}

async function history(q, orderId, from, to, note, empId) {
  await q.query('INSERT INTO order_status_history (order_id, from_status, to_status, note, emp_id) VALUES (?, ?, ?, ?, ?)', [orderId, from, to, note ? String(note).slice(0, 255) : null, empId]);
}

// ---------------------------------------------------------------- stock reservations
async function release(q, orderId) {
  await q.query("UPDATE stock_reservations SET status = 'released', closed_at = UTC_TIMESTAMP() WHERE order_id = ? AND status = 'active'", [orderId]);
}
async function reserve(q, orderId) {
  await release(q, orderId);
  const [items] = await q.query('SELECT sku_code, qty FROM order_items WHERE order_id = ? ORDER BY sku_code', [orderId]);
  for (const i of items) await q.query('INSERT INTO stock_reservations (order_id, sku_code, qty) VALUES (?, ?, ?)', [orderId, i.sku_code, i.qty]);
}
const reservesNow = (status, settings) => (status === 'new' && settings.stock_reserve_at !== 'packing') || status === 'packed';

/** recompute amount_paid, amount_due and payment_status of an order */
async function refreshPayment(q, orderId) {
  const [[o]] = await q.query('SELECT status, total, wallet_used FROM orders WHERE order_id = ?', [orderId]);
  const [[p]] = await q.query("SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount END), 0) AS refunded FROM payments WHERE order_id = ?", [orderId]);
  const paid = round2(Number(p.paid) - Number(p.refunded));
  const cancelled = o.status === 'cancelled';
  const owed = cancelled ? 0 : round2(Number(o.total) - Number(o.wallet_used));
  const due = round2(owed - paid);
  let status = 'unpaid';
  if (Number(p.refunded) > 0 && paid <= 0.005) status = 'refunded';
  else if (!cancelled && due <= 0.005 && (paid > 0 || Number(o.wallet_used) > 0 || owed <= 0.005)) status = 'paid';
  else if (paid > 0.005) status = cancelled ? 'paid' : 'partly_paid';
  await q.query('UPDATE orders SET amount_paid = ?, amount_due = ?, payment_status = ? WHERE order_id = ?', [paid, due, status, orderId]);
  return { paid, due, status };
}

/** pending approvals that hold this order */
async function pendingHolds(q, orderNo) {
  const [rows] = await q.query("SELECT approval_id, kind FROM approvals WHERE ref_type = 'order' AND ref_id = ? AND status = 'pending' AND kind IN (?)", [orderNo, HOLD_KINDS]);
  return rows;
}
async function withdrawHolds(q, orderNo, why) {
  const rows = await pendingHolds(q, orderNo);
  for (const r of rows) {
    await q.query("UPDATE approvals SET status = 'withdrawn', decided_by = 'system', decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ? AND status = 'pending'", [why, r.approval_id]);
    await audit(q, { empId: 'system', action: 'withdraw', entity: 'approval', entityId: String(r.approval_id), after: { status: 'withdrawn', note: why } });
  }
}
async function requestHolds(q, orderNo, custName, holds, empId) {
  const ids = [];
  for (const h of holds) {
    ids.push(await approvals.request(q, { kind: h.kind, refType: 'order', refId: orderNo, summary: `${orderNo} for ${custName}: ${h.what}`, amount: h.amount, payload: { order_no: orderNo, lines: h.lines || null } }, empId));
  }
  return ids;
}

/** an order became confirmed: time stamp, reservation (setting), invoice (setting) */
async function confirmed(q, orderId, empId, settings) {
  await q.query('UPDATE orders SET confirmed_at = COALESCE(confirmed_at, UTC_TIMESTAMP()) WHERE order_id = ?', [orderId]);
  if (reservesNow('new', settings)) await reserve(q, orderId);
  if (settings.invoice_issue_at === 'confirm') await invoices.issue(q, orderId, empId);
}

async function insertLines(q, orderId, lines) {
  for (const i of lines) {
    await q.query(
      `INSERT INTO order_items (order_id, sku_code, qty, price, list_price, hsn, gst_rate, taxable, cgst, sgst, igst, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, i.sku_code, i.qty, i.price, i.list_price, i.hsn, i.gst_rate, i.taxable, i.cgst, i.sgst, i.igst, i.line_total]
    );
  }
}
const addrCols = (p) => [p.bill.name, p.bill.gstin, p.bill.address, p.bill.town, p.bill.state_code, p.bill.pincode, p.bill.phone,
  p.ship.name, p.ship.address, p.ship.town, p.ship.state_code, p.ship.pincode, p.ship.phone];

/**
 * New order (q inside a transaction). opts.replacement: a free replacement (no quantity / stock / approval rules);
 * opts.priceDate: the seed's back-dated orders; opts.canOverride: may ask to order above the available stock.
 * -> { order_id, order_no, status, held, approvals, price_list, gst_type, total, ... }
 */
async function createOrder(q, data, empId, opts = {}) {
  const p = await prepare(q, data, { ...opts, isNew: true });
  const t = p.totals;
  const yy = String(istYear()).padStart(2, '0');
  const orderNo = `${p.settings.order_prefix}-${yy}${numbering.pad(await numbering.next(q, `${p.settings.order_prefix}-${yy}`, 1))}`;
  const status = p.holds.length ? 'approval' : 'new';
  const [ins] = await q.query(
    `INSERT INTO orders (order_no, customer_id, price_list, status, payment_terms, credit_days,
       bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone,
       ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone, place_of_supply, gst_type,
       coupon_code, subtotal, discount, taxable, cgst, sgst, igst, gst, round_off, total, wallet_used, amount_due, note, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderNo, p.cust.customer_id, p.list.key, status, p.terms, p.creditDays, ...addrCols(p), p.pos, p.gstType,
      p.coupon, t.subtotal, t.discount, t.taxable, t.cgst, t.sgst, t.igst, t.gst, t.round_off, t.total, p.walletUsed, round2(t.total - p.walletUsed),
      data.note ? String(data.note).slice(0, 255) : null, empId]
  );
  const orderId = ins.insertId;
  await insertLines(q, orderId, p.lines);
  if (p.coupon) await q.query('UPDATE coupons SET used = used + 1 WHERE code = ?', [p.coupon]);
  if (p.walletUsed > 0) {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)', [p.cust.customer_id, -p.walletUsed, `Used on ${orderNo}`, orderId, empId]);
  }
  await history(q, orderId, null, status, p.holds.length ? `Waits for: ${p.holds.map((h) => approvals.KINDS[h.kind].label).join(', ')}` : null, empId);
  const ids = await requestHolds(q, orderNo, p.cust.name, p.holds, empId);
  if (status === 'new') await confirmed(q, orderId, empId, p.settings);
  await refreshPayment(q, orderId);
  await audit(q, { empId, action: 'create', entity: 'order', entityId: orderNo,
    after: { customer: p.cust.name, status, total: t.total, price_list: p.list.key, gst_type: p.gstType, terms: p.terms, lines: p.lines.map((i) => `${i.qty} x ${i.sku_code} @ ${i.price}`), holds: p.holds.map((h) => h.kind) } });
  return { order_id: orderId, order_no: orderNo, status, held: status === 'approval', approvals: ids, price_list: p.list.label, gst_type: p.gstType, ...t, walletUsed: p.walletUsed };
}

const ORDER_COLS = `order_id, order_no, customer_id, status, payment_terms, credit_days, coupon_code, wallet_used, version, total,
  bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone,
  ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone`;

/**
 * Edit an order (q inside a transaction). data as createOrder + { version, reason }. Packed needs a reason; the stock is
 * re-reserved; an edit that now needs approval puts a New order back to "approval" (a Packed one cannot be dispatched
 * until approved). -> { order_no, status, version, holds }
 */
async function updateOrder(q, orderNo, data, empId, opts = {}) {
  const [[o]] = await q.query(`SELECT ${ORDER_COLS} FROM orders WHERE order_no = ? FOR UPDATE`, [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  const mode = EDITABLE[o.status];
  if (!mode) throw new CommerceError(`${orderNo} is ${STATUS_LABEL[o.status]}: it can no longer be edited${o.status === 'delivered' ? ' (use Returns)' : ''}`, 409);
  if (Number(data.version) !== Number(o.version)) throw new CommerceError(`${orderNo} changed since you opened it: reload it and make your change again`, 409);
  const reason = String(data.reason || '').trim().slice(0, 255);
  if (mode === 'reason' && !reason) throw new CommerceError(`${orderNo} is packed: say why it is changed (the packer re-packs it)`);
  const [beforeItems] = await q.query('SELECT sku_code, qty, price FROM order_items WHERE order_id = ? ORDER BY sku_code', [o.order_id]);
  const p = await prepare(q, data, { ...opts, order: o, isNew: false });
  const t = p.totals;
  await q.query('DELETE FROM order_items WHERE order_id = ?', [o.order_id]);
  await insertLines(q, o.order_id, p.lines);
  // coupon and wallet follow the edit
  if (o.coupon_code !== p.coupon) {
    if (o.coupon_code) await q.query('UPDATE coupons SET used = GREATEST(used - 1, 0) WHERE code = ?', [o.coupon_code]);
    if (p.coupon) await q.query('UPDATE coupons SET used = used + 1 WHERE code = ?', [p.coupon]);
  }
  const walletDelta = round2(Number(o.wallet_used) - p.walletUsed);
  if (Math.abs(walletDelta) > 0.005) {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
      [o.customer_id, walletDelta, walletDelta > 0 ? `Given back: ${orderNo} edited` : `Used on ${orderNo} (edited)`, o.order_id, empId]);
  }
  // approvals: the old requests are withdrawn, the edit asks again for what it still needs
  await withdrawHolds(q, orderNo, 'Order edited: asked again if still needed');
  let status = o.status;
  if (o.status !== 'packed') status = p.holds.length ? 'approval' : 'new';
  await q.query(
    `UPDATE orders SET status = ?, payment_terms = ?,
       bill_name = ?, bill_gstin = ?, bill_address = ?, bill_town = ?, bill_state_code = ?, bill_pincode = ?, bill_phone = ?,
       ship_name = ?, ship_address = ?, ship_town = ?, ship_state_code = ?, ship_pincode = ?, ship_phone = ?, place_of_supply = ?, gst_type = ?,
       coupon_code = ?, subtotal = ?, discount = ?, taxable = ?, cgst = ?, sgst = ?, igst = ?, gst = ?, round_off = ?, total = ?, wallet_used = ?,
       note = ?, version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE order_id = ?`,
    [status, p.terms, ...addrCols(p), p.pos, p.gstType, p.coupon, t.subtotal, t.discount, t.taxable, t.cgst, t.sgst, t.igst, t.gst, t.round_off, t.total, p.walletUsed,
      String(data.note || '').trim().slice(0, 255) || null, empId, o.order_id]
  );
  await requestHolds(q, orderNo, p.cust.name, p.holds, empId);
  if (status === 'approval') await release(q, o.order_id);
  else if (o.status === 'approval' && status === 'new') await confirmed(q, o.order_id, empId, p.settings);
  else if (reservesNow(status, p.settings)) await reserve(q, o.order_id);
  // an invoice issued at confirm follows the edit: cancelled with a credit note, issued again
  const [[live]] = await q.query('SELECT invoice_no FROM invoices WHERE live_order_id = ?', [o.order_id]);
  if (live) { await invoices.cancelForOrder(q, o.order_id, `Order ${orderNo} edited`, empId); if (status !== 'approval') await invoices.issue(q, o.order_id, empId); }
  await history(q, o.order_id, o.status, 'edited', reason || null, empId);
  if (status !== o.status) await history(q, o.order_id, o.status, status, 'after the edit', empId);
  await refreshPayment(q, o.order_id);
  await audit(q, { empId, action: 'update', entity: 'order', entityId: orderNo,
    before: { status: o.status, total: Number(o.total), lines: beforeItems.map((i) => `${i.qty} x ${i.sku_code} @ ${Number(i.price)}`) },
    after: { status, total: t.total, lines: p.lines.map((i) => `${i.qty} x ${i.sku_code} @ ${i.price}`), reason: reason || null, gst_type: p.gstType, holds: p.holds.map((h) => h.kind) } });
  return { order_no: orderNo, status, version: Number(o.version) + 1, holds: p.holds.map((h) => h.kind), total: t.total };
}

/** cancel for good: reservations released, goods back after dispatch, invoice cancelled + credit note, coupon / wallet back */
async function doCancel(q, orderId, reason, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, customer_id, status, coupon_code, wallet_used FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
  if (!o || o.status === 'cancelled' || o.status === 'delivered') return false;
  await q.query("UPDATE orders SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), cancel_reason = ?, version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE order_id = ?",
    [String(reason).slice(0, 255), empId, orderId]);
  await release(q, orderId);
  if (o.status === 'dispatched') {
    const [items] = await q.query('SELECT sku_code, qty FROM order_items WHERE order_id = ?', [orderId]);
    for (const i of items) {
      await q.query("INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id) VALUES (?, 'return', 'good', ?, ?, ?)",
        [i.sku_code, i.qty, `Cancelled after dispatch, goods back: ${o.order_no}`, empId]);
    }
  }
  const inv = await invoices.cancelForOrder(q, orderId, `Order ${o.order_no} cancelled: ${reason}`, empId);
  if (o.coupon_code) await q.query('UPDATE coupons SET used = GREATEST(used - 1, 0) WHERE code = ?', [o.coupon_code]);
  if (Number(o.wallet_used) > 0) {
    await q.query('INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id) VALUES (?, ?, ?, ?, ?)',
      [o.customer_id, Number(o.wallet_used), `Given back: ${o.order_no} cancelled`, orderId, empId]);
  }
  await withdrawHolds(q, o.order_no, 'Order cancelled');
  await history(q, orderId, o.status, 'cancelled', reason, empId);
  await refreshPayment(q, orderId);
  await audit(q, { empId, action: 'cancel', entity: 'order', entityId: o.order_no, before: { status: o.status }, after: { status: 'cancelled', reason, invoice: inv ? inv.invoice_no : null, credit_note: inv ? inv.credit_note_no : null } });
  return true;
}

/** Cancel (reason required). After dispatch: an approval request (Commerce setting) -> { pending, approval_id } */
async function cancelOrder(q, orderNo, reason, empId) {
  const why = String(reason || '').trim().slice(0, 255);
  if (!why) throw new CommerceError('Say why the order is cancelled');
  const [[o]] = await q.query('SELECT order_id, order_no, status, total, customer_id FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  if (o.status === 'cancelled') throw new CommerceError(`${orderNo} is already cancelled`, 409);
  if (o.status === 'delivered') throw new CommerceError(`${orderNo} is delivered: use Returns`, 409);
  if (o.status === 'dispatched' && await approvals.needed(q, 'cancel_after_dispatch')) {
    const [[had]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'cancel_after_dispatch' AND ref_type = 'order' AND ref_id = ? AND status = 'pending'", [orderNo]);
    if (had) throw new CommerceError(`Cancelling ${orderNo} already waits for approval (request #${had.approval_id})`, 409);
    const [[c]] = await q.query('SELECT name FROM customers WHERE customer_id = ?', [o.customer_id]);
    const id = await approvals.request(q, { kind: 'cancel_after_dispatch', refType: 'order', refId: orderNo, summary: `Cancel ${orderNo} for ${c.name} after dispatch: ${why}`, amount: Number(o.total), payload: { order_no: orderNo, reason: why } }, empId);
    await history(q, o.order_id, o.status, o.status, `Cancel asked (approval #${id}): ${why}`, empId);
    return { order_no: orderNo, pending: true, approval_id: id };
  }
  await doCancel(q, o.order_id, why, empId);
  return { order_no: orderNo, pending: false, status: 'cancelled' };
}

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

/** One step on: new -> packed -> dispatched (stock out, invoice) -> delivered. -> { status, invoice_no } */
async function advanceOrder(q, orderNo, to, empId, { at = null } = {}) {
  const [[o]] = await q.query('SELECT order_id, order_no, status, version FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  if (HELD[o.status]) throw new CommerceError(`${orderNo} ${HELD[o.status]}`, 409);
  const next = ORDER_FLOW[ORDER_FLOW.indexOf(o.status) + 1];
  if (!next || to !== next) throw new CommerceError(`${orderNo} is ${o.status}: the next step is ${next || 'none (delivered)'}`, 409);
  const waiting = await pendingHolds(q, orderNo);
  if (waiting.length) throw new CommerceError(`${orderNo} waits for approval (${waiting.map((w) => approvals.KINDS[w.kind].label).join(', ')})`, 409);
  const settings = await commerceSettings.read(q);
  let invoiceNo = null;
  if (next === 'packed' && settings.stock_reserve_at === 'packing') await reserve(q, o.order_id);
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
    await q.query("UPDATE stock_reservations SET status = 'consumed', closed_at = UTC_TIMESTAMP() WHERE order_id = ? AND status = 'active'", [o.order_id]);
    invoiceNo = (await invoices.issue(q, o.order_id, empId, { at })).invoice_no;
  }
  await q.query(`UPDATE orders SET status = ?, ${next}_at = UTC_TIMESTAMP(), version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE order_id = ?`, [next, empId, o.order_id]);
  await history(q, o.order_id, o.status, next, invoiceNo ? `Invoice ${invoiceNo}` : null, empId);
  if (next === 'delivered') await cashback(q, o.order_id, empId);
  await audit(q, { empId, action: 'status', entity: 'order', entityId: orderNo, before: { status: o.status }, after: { status: next, invoice: invoiceNo } });
  return { status: next, invoice_no: invoiceNo };
}

/** payment modes offered (Commerce setting payment_methods, names from MODES) -> { key: label } */
function modesOffered(settings) {
  const names = String(settings.payment_methods || '').split(',').map((x) => x.trim().toLowerCase());
  const out = Object.fromEntries(Object.entries(MODES).filter(([, label]) => names.includes(label.toLowerCase())));
  return Object.keys(out).length ? out : MODES;
}

/** record a payment or a refund. b = { kind, amount, mode, received_on, reference, note } */
async function recordPayment(q, orderNo, b, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, status, amount_due, amount_paid FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  const kind = b.kind === 'refund' ? 'refund' : 'payment';
  const s = String(b.amount ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || Number(s) <= 0) throw new CommerceError('Amount: above 0, like 1500 or 1500.50');
  const amount = Number(s);
  const settings = await commerceSettings.read(q);
  const modes = modesOffered(settings);
  if (!modes[b.mode]) throw new CommerceError(`Mode: ${Object.values(modes).join(', ')}`);
  const day = String(b.received_on || pricing.istToday());
  if (!pricing.isDate(day) || day > pricing.istToday()) throw new CommerceError('Date: today or earlier');
  const reference = String(b.reference || '').trim().slice(0, 60) || null;
  if (['upi', 'bank', 'cheque', 'razorpay'].includes(b.mode) && !reference) throw new CommerceError(`${modes[b.mode]}: give the reference (UTR, cheque or transaction number)`);
  if (kind === 'payment') {
    if (o.status === 'cancelled') throw new CommerceError(`${orderNo} is cancelled: no payment can be recorded`, 409);
    if (amount > Number(o.amount_due) + 0.005) throw new CommerceError(`More than the balance due (${rs(Math.max(Number(o.amount_due), 0))})`);
  } else if (amount > Number(o.amount_paid) + 0.005) throw new CommerceError(`More than what was paid (${rs(o.amount_paid)})`);
  const [ins] = await q.query('INSERT INTO payments (order_id, kind, mode, amount, received_on, reference, note, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [o.order_id, kind, b.mode, amount, day, reference, String(b.note || '').trim().slice(0, 255) || null, empId]);
  const st = await refreshPayment(q, o.order_id);
  await audit(q, { empId, action: kind === 'refund' ? 'refund' : 'record', entity: 'payment', entityId: `${orderNo}/${ins.insertId}`, after: { amount, mode: b.mode, received_on: day, reference, payment_status: st.status, due: st.due } });
  return { payment_id: ins.insertId, ...st };
}

// ---------------------------------------------------------------- approvals that hold an order
async function holdApproved(q, p, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, status FROM orders WHERE order_no = ? FOR UPDATE', [p.order_no]);
  if (!o || o.status !== 'approval') return;
  if ((await pendingHolds(q, o.order_no)).length) return; // another approval still pending
  await q.query("UPDATE orders SET status = 'new', version = version + 1 WHERE order_id = ?", [o.order_id]);
  await history(q, o.order_id, 'approval', 'new', 'Approved', empId);
  await confirmed(q, o.order_id, empId, await commerceSettings.read(q));
}
async function holdClosed(q, p, status, empId) {
  const [[o]] = await q.query('SELECT order_id, status FROM orders WHERE order_no = ?', [p.order_no]);
  if (!o || ['cancelled', 'dispatched', 'delivered'].includes(o.status)) return;
  await doCancel(q, o.order_id, `Approval ${status}`, empId);
}
for (const k of HOLD_KINDS) { approvals.onApproved(k, holdApproved); approvals.onClosed(k, holdClosed); }
approvals.onApproved('cancel_after_dispatch', async (q, p, empId) => {
  const [[o]] = await q.query('SELECT order_id FROM orders WHERE order_no = ?', [p.order_no]);
  if (o) await doCancel(q, o.order_id, `${p.reason} (approved after dispatch)`, empId);
});

// ---------------------------------------------------------------- returns (demo, phase 6 rebuilds them)
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
    replacement = await createOrder(q, { customer_id: o.customer_id, items, payment_terms: 'advance', note: `Replacement for ${returnNo} (${orderNo})` }, empId, { replacement: true });
    await q.query('UPDATE returns SET replacement_order_id = ? WHERE return_id = ?', [replacement.order_id, ins.insertId]);
  }
  return { return_no: returnNo, amount, outcome: data.outcome, replacement_no: replacement ? replacement.order_no : null };
}

module.exports = {
  ORDER_FLOW, STATUS_LABEL, HELD, TERMS, MODES, PAYMENT_STATUS, EDITABLE, OUTCOMES, CommerceError,
  createOrder, updateOrder, cancelOrder, advanceOrder, recordPayment, createReturn, couponDiscount, walletBalance, availability,
  overdueOf, outstandingOf, modesOffered, OVERDUE_SQL, taxTotals, istYear, refreshPayment,
};
