// dFresh Commerce: order logic shared by the admin routes (Admin_server.js) and the demo seed
// (scripts/commerce-demo-seed.js), so seeded orders behave exactly like entered ones. Tables: migration
// 20261020_commerce_sales.sql (orders, lines, history, reservations, payments, invoices); customers, coupons, wallet,
// stock movements and returns are still the demo tables (database/demo) until their phases.
//
// Status: approval (waiting for one or more approvals) -> new (confirmed) -> packing -> packed, then by the delivery
// method: own vehicle -> out_for_delivery (trip) -> delivered | failed; courier -> with_courier -> delivered; customer
// pickup -> delivered (phase 5, delivery.js). The goods leave the godown once (leaveGodown: stock out by the picked
// batches, tax invoice, dispatched_at). Cancelled from any status before delivered (after the goods left only through
// an approval, Commerce setting). Edit: approval / new = everything except the customer; packing / packed = with a
// reason; once the goods left = never.
// Delivery charge: the delivery area of the shipping address (PIN code or town, Commerce settings > Delivery areas),
// free above the area's amount, nothing for customer pickup; taxed at the Commerce setting rate, on the invoice.
// Every edit sends the version it read: another change in between answers "This order changed, reload".
//
// Money (per line): taxable = qty x price - the offer slab - its share of the coupon (the lines the coupon covers) and of
// the manual discount - its share of the wallet discount; CGST + SGST (half the rate each) when the shipping state is
// the seller's state, else IGST; total = taxable + GST + round-off (Commerce setting). Prices typed or taken from the
// price list (pricing.js; split out of the price when the lists include GST). Promotions (phase 7, promotions.js):
// automatic offers (slab % on the line, buy X get Y = a free line at Rs 0), one coupon (percent / fixed on its lines,
// or free delivery), a manual discount with a reason; together above the setting % they wait for approval. Wallet
// (wallet.js): at most the setting % of the order, taken oldest first; under the GST setting "Discount" the cashback /
// manual part lowers the taxable value (GST-inclusive), a refund part and everything under "Payment method" counts as
// paid. amount_due = total - wallet paid part - payments + refunds.
//
// Stock (stock.js): Available = good stock - expired batches - active reservations of other orders. Dispatch takes
// batch-tracked SKUs earliest expiry first and never an expired batch. An order cannot ask for more than available,
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
const promotions = require('./promotions');
const stock = require('./stock');
const wallet = require('./wallet');
const numbering = require('./numbering');
const { audit } = require('./audit');
const notifications = require('./notifications');
const { checkSetting } = require('../shared/settingRules');
const { isStateCode, stateName, placeOfSupply } = require('../shared/gstStates');

const STATUS_LABEL = {
  approval: 'Waiting for approval', new: 'New', packing: 'Packing', packed: 'Packed', out_for_delivery: 'Out for delivery', with_courier: 'Handed to courier',
  failed: 'Delivery failed', delivered: 'Delivered', cancelled: 'Cancelled',
};
const GONE = ['out_for_delivery', 'with_courier', 'failed']; // the goods have left the godown
const HELD = { approval: 'is waiting for approval', cancelled: 'is cancelled' };
const TERMS = { cod: 'Pay on delivery', advance: 'Paid in advance', credit: 'On credit' };
const MODES = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque', razorpay: 'Razorpay (manual)' };
const PAYMENT_STATUS = { unpaid: 'Unpaid', partly_paid: 'Part paid', paid: 'Paid', part_refunded: 'Part refunded', refunded: 'Refunded' };
const HOLD_KINDS = ['price_below_list', 'over_available', 'credit_order', 'discount', 'customer_hold'];
const EDITABLE = { approval: 'free', new: 'free', packing: 'reason', packed: 'reason' };
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

const walletBalance = (q, customerId) => wallet.balance(q, customerId);

/** good stock, expired, reserved by other orders and available per SKU (stock.js) */
const availability = (q, skuCodes, exceptOrderId = 0) => stock.availability(q, skuCodes, exceptOrderId);

/** round2 parts of `total` in proportion to `weights`, adding up to `total` exactly (the last non-zero takes the cents) */
function spread(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!(total > 0) || !(sum > 0)) return weights.map(() => 0);
  const parts = weights.map((w) => round2((total * w) / sum));
  const last = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0).pop();
  parts[last] = round2(parts[last] + round2(total - parts.reduce((a, x) => a + x, 0)));
  return parts;
}

/**
 * Line tax and order totals. lines: [{ sku_code, qty, price (before GST), gst_rate, offer_discount, is_free }];
 * gstType 'intra' | 'inter'; disc = { coupon (Rs), couponSkus (Set, null = every paid line), manual (Rs), wallet (Rs incl. GST) }.
 * -> { lines (with coupon_discount, wallet_discount, taxable, cgst, sgst, igst, line_total), subtotal, offer_discount, discount,
 *      manual_discount, wallet_discount, delivery_charge, delivery_gst, taxable, cgst, sgst, igst, gst, round_off, total }
 */
function taxTotals(lines, gstType, roundOff, delivery = { charge: 0, rate: 18 }, disc = {}) {
  const net = lines.map((i) => (i.is_free ? 0 : round2(i.qty * i.price - (i.offer_discount || 0))));
  const coupon = round2(Math.min(disc.coupon || 0, net.reduce((a, x) => a + x, 0)));
  const cParts = spread(coupon, lines.map((i, n) => (!i.is_free && (!disc.couponSkus || disc.couponSkus.has(i.sku_code)) ? net[n] : 0)));
  const after = net.map((x, n) => round2(x - cParts[n]));
  const manual = round2(Math.min(disc.manual || 0, after.reduce((a, x) => a + x, 0)));
  const mParts = spread(manual, after);
  const t1 = after.map((x, n) => round2(x - mParts[n]));
  const incl = t1.map((x, n) => x * (1 + lines[n].gst_rate / 100));
  const walletD = round2(Math.min(disc.wallet || 0, incl.reduce((a, x) => a + x, 0)));
  const wParts = spread(walletD, incl);
  const out = lines.map((i, n) => {
    const wTax = round2(wParts[n] / (1 + i.gst_rate / 100));
    const taxable = round2(t1[n] - wTax);
    const half = gstType === 'intra' ? round2((taxable * i.gst_rate) / 200) : 0;
    const igst = gstType === 'inter' ? round2((taxable * i.gst_rate) / 100) : 0;
    return { ...i, offer_discount: i.offer_discount || 0, coupon_discount: round2(cParts[n] + mParts[n]), wallet_discount: wTax, taxable, cgst: half, sgst: half, igst, line_total: round2(taxable + 2 * half + igst) };
  });
  const sum = (k) => round2(out.reduce((a, i) => a + i[k], 0));
  const dc = round2(Number(delivery.charge) || 0);
  const dHalf = gstType === 'intra' ? round2((dc * delivery.rate) / 200) : 0;
  const dIgst = gstType === 'inter' ? round2((dc * delivery.rate) / 100) : 0;
  const taxable = round2(sum('taxable') + dc);
  const [cgst, sgst, igst] = [round2(sum('cgst') + dHalf), round2(sum('sgst') + dHalf), round2(sum('igst') + dIgst)];
  const gst = round2(cgst + sgst + igst);
  const before = round2(taxable + gst);
  const ro = roundOff ? round2(Math.round(before) - before) : 0;
  return { lines: out, subtotal: round2(lines.reduce((a, i) => a + (i.is_free ? 0 : i.qty * i.price), 0)), offer_discount: sum('offer_discount'), discount: coupon, manual_discount: manual,
    wallet_discount: walletD, delivery_charge: dc, delivery_gst: round2(2 * dHalf + dIgst), taxable, cgst, sgst, igst, gst, round_off: ro, total: round2(before + ro) };
}

/** an active delivery method (the first own-vehicle one when id is null) */
async function deliveryMethod(q, id) {
  const [rows] = await q.query('SELECT method_id, label, kind FROM delivery_methods WHERE is_active = 1 ORDER BY sort_order, method_id');
  if (id === null || id === undefined) return rows.find((m) => m.kind === 'own') || rows[0] || null;
  return rows.find((m) => m.method_id === Number(id)) || null;
}

/** the delivery area of an address (PIN code first, then town; or the one chosen) and its charge for this goods value */
async function deliveryCharge(q, ship, goodsValue, areaId = null) {
  const [areas] = await q.query('SELECT area_id, label, towns, charge, free_above FROM delivery_areas WHERE is_active = 1 ORDER BY sort_order, area_id');
  const words = (a) => String(a.towns || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  let area = null;
  if (areaId) area = areas.find((a) => a.area_id === areaId) || null;
  if (!area && ship.pincode) area = areas.find((a) => words(a).includes(String(ship.pincode))) || null;
  if (!area && ship.town) area = areas.find((a) => words(a).includes(String(ship.town).trim().toLowerCase())) || null;
  if (!area) return { area: null, charge: 0 };
  const free = area.free_above !== null && goodsValue >= Number(area.free_above);
  return { area: { area_id: area.area_id, label: area.label, charge: Number(area.charge), free_above: area.free_above === null ? null : Number(area.free_above), free }, charge: free ? 0 : Number(area.charge) };
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

/** a customer address (phase 8, customer_addresses) as an order address */
const fromAddress = (a) => (a ? { name: a.name, gstin: a.gstin || null, address: a.address, town: a.town, state_code: a.state_code, pincode: a.pincode, phone: a.phone } : null);

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
  const [[cust]] = await q.query(`SELECT customer_id, customer_no, name, business_name, phone, type_key, status, hold_reason, credit_days, credit_limit, merged_into
      FROM customers WHERE customer_id = ?`, [customerId]);
  if (!cust) throw new CommerceError('Choose a customer');
  if (cust.merged_into) throw new CommerceError(`${cust.customer_no} was merged into another customer: choose that one`);
  if (cust.status === 'inactive' && !editing && !opts.replacement) throw new CommerceError(`${cust.name} is inactive: no new orders (Customers: make it active first)`);
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
    `SELECT s.sku_code, s.is_active, s.packs_per_carton, s.min_order_qty, s.sell_unit, p.gst_rate, p.hsn_code, p.category_key
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
    const rate = Number(s.gst_rate);
    const below = listPrice && entered < listPrice ? round2(((listPrice - entered) / listPrice) * 100) : 0;
    return { sku_code: i.sku_code, qty: i.qty, entered, list_price: listPrice, below, gst_rate: rate, hsn: s.hsn_code, category_key: s.category_key,
      packs_per_carton: Number(s.packs_per_carton) || 1, is_free: 0, price: inclusive ? round2(entered / (1 + rate / 100)) : entered };
  });
  // automatic offers: slab % on the line, buy X get Y = free lines (their stock counts like any line)
  const offers = opts.replacement ? { lines: lines.map((l) => ({ ...l, offer_id: null, offer_label: null, offer_discount: 0 })), free: [], applied: [] }
    : await promotions.applyOffers(q, cust.type_key, opts.priceDate || pricing.istToday(), lines); // offers follow the customer type, not its price list
  const freeLines = [];
  if (offers.free.length) {
    const [fi] = await q.query(`SELECT s.sku_code, p.gst_rate, p.hsn_code, p.category_key FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code IN (?)`, [offers.free.map((f) => f.sku_code)]);
    const fown = await pricing.ownPricesOn(q, opts.priceDate || pricing.istToday(), offers.free.map((f) => f.sku_code));
    for (const f of offers.free) {
      const s = fi.find((x) => x.sku_code === f.sku_code);
      if (!s) continue;
      freeLines.push({ sku_code: f.sku_code, qty: f.qty, entered: 0, list_price: pricing.resolve(fown.get(f.sku_code), list.key).price, below: 0, gst_rate: Number(s.gst_rate), hsn: s.hsn_code,
        category_key: s.category_key, is_free: 1, price: 0, offer_id: f.offer_id, offer_label: f.offer_label, offer_discount: 0 });
    }
  }
  const allLines = [...offers.lines, ...freeLines];
  const allKeys = [...new Set(allLines.map((l) => l.sku_code))];
  const stockAll = allKeys.some((k) => !stock.has(k)) ? await availability(q, allKeys, editing ? editing.order_id : 0) : stock;
  for (const k of allKeys) {
    const want = allLines.filter((l) => l.sku_code === k).reduce((a, l) => a + l.qty, 0);
    const st = stockAll.get(k);
    if (!opts.replacement && want > st.available) short.push({ sku_code: k, qty: want, ...st, free: freeLines.some((l) => l.sku_code === k) });
  }
  if (short.length && !data.override_stock) {
    short.forEach((x) => problems.push(`${x.sku_code}: only ${Math.max(x.available, 0)} available (${x.good} in stock${x.expired ? `, ${x.expired} expired` : ''}, ${x.reserved} reserved for other orders); ${x.qty} asked${x.free ? ' (with the free packs of an offer)' : ''}`));
  }
  if (short.length && data.override_stock && !opts.canOverride) problems.push('Ordering more than the available stock needs a role with "approve" on Orders');
  if (problems.length) throw new CommerceError(problems.join('. '));

  // addresses and GST type
  // the customer's billing and shipping addresses (phase 8): the ones chosen, else the defaults; typed changes on top
  const [addrs] = await q.query(`SELECT address_id, kind, name, gstin, contact_person, phone, address, town, state_code, pincode, delivery_area_id, is_default
      FROM customer_addresses WHERE customer_id = ? AND is_active = 1 ORDER BY is_default DESC, address_id`, [customerId]);
  const pick = (kind, wanted, had) => {
    const id = wanted !== undefined && wanted !== '' && wanted !== null ? Number(wanted) : had || null;
    if (id) {
      const a = addrs.find((x) => x.address_id === id && x.kind === kind);
      if (!a) throw new CommerceError(`That ${kind} address is not one of ${cust.name}'s`);
      return a;
    }
    return addrs.find((x) => x.kind === kind) || null;
  };
  const billAddr = pick('billing', data.bill_address_id, editing ? editing.bill_address_id : null);
  const shipAddr = pick('shipping', data.ship_address_id, editing ? editing.ship_address_id : null);
  const chose = (k) => data[`${k}_address_id`] !== undefined && data[`${k}_address_id`] !== '' && (!editing || Number(data[`${k}_address_id`]) !== Number(editing[`${k}_address_id`]));
  const prevBill = editing && !chose('bill') ? { name: editing.bill_name, gstin: editing.bill_gstin, address: editing.bill_address, town: editing.bill_town, state_code: editing.bill_state_code, pincode: editing.bill_pincode, phone: editing.bill_phone }
    : fromAddress(billAddr) || { name: cust.business_name || cust.name, phone: cust.phone, state_code: '' };
  const prevShip = editing && !chose('ship') ? { name: editing.ship_name, address: editing.ship_address, town: editing.ship_town, state_code: editing.ship_state_code, pincode: editing.ship_pincode, phone: editing.ship_phone }
    : fromAddress(shipAddr) || prevBill;
  const bill = checkAddress(data.bill ? { ...prevBill, ...data.bill } : prevBill, 'bill');
  if (bill.error) throw new CommerceError(bill.error);
  const ship = checkAddress(data.ship ? { ...prevShip, ...data.ship } : prevShip, 'ship');
  if (ship.error) throw new CommerceError(ship.error);
  // place of supply: B2B = the billing GSTIN's state, B2C = the shipping state (setting place_of_supply_rule)
  const posInfo = placeOfSupply(bill.values.gstin, ship.values.state_code, settings.place_of_supply_rule);
  const pos = posInfo.code;
  const gstType = pos === String(settings.invoice_seller_state_code || '33') ? 'intra' : 'inter';

  // delivery method, area and charge (a free-delivery coupon waives the charge)
  const methodId = data.delivery_method_id !== undefined && data.delivery_method_id !== '' ? Number(data.delivery_method_id) : editing ? editing.delivery_method_id : null;
  const method = await deliveryMethod(q, methodId);
  if (!method) throw new CommerceError('Choose the delivery method');
  const areaWanted = data.delivery_area_id !== undefined && data.delivery_area_id !== '' ? data.delivery_area_id : editing && !chose('ship') ? editing.delivery_area_id : shipAddr && shipAddr.delivery_area_id ? shipAddr.delivery_area_id : '';
  const goodsAfterOffers = round2(offers.lines.reduce((a, l) => a + l.qty * l.price - l.offer_discount, 0));
  const delivery = method.kind === 'pickup' ? { area: null, charge: 0 } : await deliveryCharge(q, ship.values, goodsAfterOffers, areaWanted === '' || areaWanted === null ? null : Number(areaWanted));
  if (opts.replacement) delivery.charge = 0;

  // coupon (one per order)
  const couponCode = data.coupon_code ? String(data.coupon_code).trim().toUpperCase() : null;
  let coupon = null;
  if (couponCode && !opts.replacement) {
    try {
      coupon = await promotions.evalCoupon(q, couponCode, { customerId, typeKey: cust.type_key, lines: offers.lines.map((l) => ({ sku_code: l.sku_code, category_key: l.category_key, net: round2(l.qty * l.price - l.offer_discount) })),
        goods: goodsAfterOffers, deliveryCharge: delivery.charge, orderId: editing ? editing.order_id : 0, hasOffers: offers.applied.length > 0, settings, lock: !opts.preview });
    } catch (e) { if (e instanceof promotions.PromoError) throw new CommerceError(e.message, e.status); throw e; }
  }
  const waived = coupon ? coupon.delivery_waived : 0;
  const charge = round2(delivery.charge - waived);

  // manual discount (Rs, with a reason)
  const manualRaw = String(data.manual_discount ?? '').trim();
  let manual = 0;
  let manualReason = null;
  if (manualRaw && Number(manualRaw) !== 0 && !opts.replacement) {
    if (!settings.manual_discount_allowed) throw new CommerceError('Manual discounts are switched off (Commerce settings > Orders and pricing)');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(manualRaw)) throw new CommerceError('Manual discount: an amount like 200 or 200.50');
    manual = Number(manualRaw);
    manualReason = String(data.manual_discount_reason || '').trim().slice(0, 255);
    if (!manualReason) throw new CommerceError('Say why the manual discount is given');
  }
  const deliv = { charge, rate: Number(settings.delivery_charge_gst_rate) || 0 };
  const disc = { coupon: coupon ? coupon.discount : 0, couponSkus: coupon ? coupon.eligible : null, manual };
  const pre = taxTotals(allLines, gstType, settings.invoice_round_off, deliv, disc);

  // wallet: at most the setting % of the order, oldest credits first; the GST setting decides the discount part
  const wantWallet = round2(Math.max(0, Number(data.wallet_use) || 0));
  let walletUsed = 0;
  let walletDiscount = 0;
  let walletPlan = null;
  const walletGst = settings.cashback_gst_treatment === 'payment' ? 'payment' : 'discount';
  const walletCap = round2((pre.total * (Number(settings.wallet_max_use_pct ?? 100) || 0)) / 100);
  if (wantWallet > 0 && !opts.replacement) {
    walletPlan = await wallet.plan(q, customerId, wantWallet, editing ? editing.order_id : 0);
    if (walletPlan.total + 0.005 < wantWallet) throw new CommerceError(`The wallet has only ${rs(walletPlan.total)} that can be used`);
    if (wantWallet > walletCap + 0.005) throw new CommerceError(`At most ${Number(settings.wallet_max_use_pct)}% of the order can be paid from the wallet: ${rs(walletCap)} on this order (Commerce settings > Promotions)`);
    walletUsed = wantWallet;
    if (walletGst === 'discount') walletDiscount = round2((walletPlan.bySource.cashback || 0) + (walletPlan.bySource.manual || 0));
  }
  const t = walletDiscount ? taxTotals(allLines, gstType, settings.invoice_round_off, deliv, { ...disc, wallet: walletDiscount }) : pre;
  walletUsed = round2(Math.min(walletUsed, t.total + t.wallet_discount));
  const discountTotal = round2(t.offer_discount + t.discount + t.manual_discount);
  const discountPct = t.subtotal > 0 ? round2((discountTotal / t.subtotal) * 100) : 0;

  // what holds the order
  const holds = [];
  if (!opts.replacement && opts.isNew && cust.status === 'on_hold') {
    holds.push({ kind: 'customer_hold', amount: null, what: `${cust.customer_no} is on hold${cust.hold_reason ? ` (${cust.hold_reason})` : ''}` });
  }
  if (!opts.replacement && discountTotal > 0 && await approvals.needed(q, 'discount', { pct: discountPct })) {
    holds.push({ kind: 'discount', amount: discountTotal, what: `discounts ${rs(discountTotal)} = ${discountPct}% of the goods (${[t.offer_discount ? `offers ${rs(t.offer_discount)}` : null,
      t.discount ? `coupon ${coupon.code} ${rs(t.discount)}` : null, t.manual_discount ? `manual ${rs(t.manual_discount)}: ${manualReason}` : null].filter(Boolean).join(', ')}); limit ${Number(settings.approve_discount_pct_above)}%` });
  }
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
      const thisDue = round2(t.total - (walletUsed - t.wallet_discount));
      const reasons = [];
      if (over.n) reasons.push(`${over.n} overdue invoice${over.n === 1 ? '' : 's'} (${rs(over.amount)})`);
      if (terms === 'credit' && outstanding + thisDue > Number(cust.credit_limit) + 0.005) {
        reasons.push(`credit limit ${rs(cust.credit_limit)}: ${rs(outstanding)} open + this order ${rs(thisDue)}`);
      }
      if (reasons.length && await approvals.needed(q, 'credit_order')) holds.push({ kind: 'credit_order', amount: round2(outstanding + thisDue), what: reasons.join('; ') });
    }
  }
  // the contact who gets the delivery messages (phase 10): one of the customer's contacts; none = the order contact rule
  // of notifications.js (the contact with the shipping phone, else the first with an e-mail)
  let contactId = editing ? editing.contact_id || null : null;
  if (data.contact_id !== undefined) {
    contactId = data.contact_id === '' || data.contact_id === null ? null : Number(data.contact_id);
    if (contactId) {
      const [[ct]] = await q.query('SELECT contact_id FROM customer_contacts WHERE contact_id = ? AND customer_id = ? AND is_active = 1', [contactId, customerId]);
      if (!ct) throw new CommerceError(`That contact is not one of ${cust.name}'s`);
    }
  }
  return { cust, list, terms, creditDays: Number(cust.credit_days) || 0, lines: t.lines, contactId, totals: t, coupon: coupon ? coupon.code : null, couponInfo: coupon, offers: offers.applied,
    manualReason, walletUsed, walletGst: walletUsed > 0 ? walletGst : null, walletCap, walletPlan, discountTotal, discountPct, deliveryWaived: waived,
    billAddressId: chose('bill') || !editing ? (billAddr ? billAddr.address_id : null) : editing.bill_address_id, shipAddressId: chose('ship') || !editing ? (shipAddr ? shipAddr.address_id : null) : editing.ship_address_id,
    bill: bill.values, ship: ship.values, pos, posReason: posInfo.reason, gstType, holds, settings, method, area: delivery.area };
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
  const [items] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM order_items WHERE order_id = ? GROUP BY sku_code ORDER BY sku_code', [orderId]);
  for (const i of items) await q.query('INSERT INTO stock_reservations (order_id, sku_code, qty) VALUES (?, ?, ?)', [orderId, i.sku_code, Number(i.qty)]);
}
const reservesNow = (status, settings) => (status === 'new' && settings.stock_reserve_at !== 'packing') || status === 'packing' || status === 'packed';

/** pick an order's SKUs: batch-tracked ones by batch, earliest expiry first, leaving out what other open orders picked */
async function pickFor(q, orderId) {
  await q.query('DELETE FROM order_picks WHERE order_id = ?', [orderId]);
  const [sums] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM order_items WHERE order_id = ? GROUP BY sku_code ORDER BY sku_code', [orderId]);
  const items = sums.map((x) => ({ sku_code: x.sku_code, qty: Number(x.qty) }));
  const tr = await stock.tracked(q, items.map((i) => i.sku_code));
  const picks = [];
  for (const i of items) {
    if (!tr.has(i.sku_code)) { picks.push({ sku_code: i.sku_code, batch_id: null, qty: i.qty }); continue; }
    const [taken] = await q.query(
      `SELECT pk.batch_id, SUM(pk.qty) AS qty FROM order_picks pk JOIN orders o ON o.order_id = pk.order_id
        WHERE pk.sku_code = ? AND o.status IN ('packing', 'packed') AND o.dispatched_at IS NULL AND o.order_id <> ? GROUP BY pk.batch_id`, [i.sku_code, orderId]);
    const used = new Map(taken.map((t) => [t.batch_id, Number(t.qty)]));
    let left = i.qty;
    for (const b of (await stock.batchStock(q, i.sku_code)).filter((x) => x.qty > 0 && !x.expired)) {
      const free = b.qty - (used.get(b.batch_id) || 0);
      if (free <= 0 || !left) continue;
      const take = Math.min(free, left);
      picks.push({ sku_code: i.sku_code, batch_id: b.batch_id, qty: take });
      left -= take;
    }
    if (left) throw new CommerceError(`Not enough ${i.sku_code} in batches that have not expired to pick ${i.qty} (${left} short)`, 409);
  }
  for (const pk of picks) await q.query('INSERT INTO order_picks (order_id, sku_code, batch_id, qty) VALUES (?, ?, ?, ?)', [orderId, pk.sku_code, pk.batch_id, pk.qty]);
  return picks;
}

/** recompute amount_paid, amount_due and payment_status of an order */
// Returns (phase 6): credit notes of returns lower what the order is worth; refunds to the wallet give money back.
// due = total - returns credited - wallet paid part + wallet refunds - (payments - refund payments).
async function refreshPayment(q, orderId) {
  const [[o]] = await q.query('SELECT status, total, wallet_used - wallet_discount AS wallet_paid FROM orders WHERE order_id = ?', [orderId]);
  const [[p]] = await q.query("SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount END), 0) AS refunded FROM payments WHERE order_id = ?", [orderId]);
  const [[cr]] = await q.query(`SELECT COALESCE(SUM(cn.total), 0) AS credited FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id
      WHERE i.order_id = ? AND cn.return_id IS NOT NULL`, [orderId]).catch(() => [[{ credited: 0 }]]);
  const [[wr]] = await q.query("SELECT COALESCE(SUM(amount), 0) AS back FROM refunds WHERE order_id = ? AND method = 'wallet' AND status = 'paid'", [orderId]).catch(() => [[{ back: 0 }]]);
  const credited = Number(cr.credited);
  const paid = round2(Number(p.paid) - Number(p.refunded));
  const cancelled = o.status === 'cancelled';
  const owed = cancelled ? 0 : round2(Number(o.total) - credited - Number(o.wallet_paid) + Number(wr.back));
  const due = round2(owed - paid);
  let status = 'unpaid';
  if (credited > 0.005 && due <= 0.005) status = credited >= Number(o.total) - 0.005 ? 'refunded' : 'part_refunded';
  else if (Number(p.refunded) > 0 && paid <= 0.005) status = 'refunded';
  else if (!cancelled && due <= 0.005 && (paid > 0 || Number(o.wallet_paid) > 0 || owed <= 0.005)) status = 'paid';
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

/** an order became confirmed: time stamp, reservation (setting), invoice (setting), the customer told (the first time) */
async function confirmed(q, orderId, empId, settings) {
  const [[was]] = await q.query('SELECT confirmed_at FROM orders WHERE order_id = ?', [orderId]);
  await q.query('UPDATE orders SET confirmed_at = COALESCE(confirmed_at, UTC_TIMESTAMP()) WHERE order_id = ?', [orderId]);
  if (reservesNow('new', settings)) await reserve(q, orderId);
  if (!was.confirmed_at) await notifications.orderConfirmed(q, orderId);
  if (settings.invoice_issue_at === 'confirm') await invoices.issue(q, orderId, empId);
}

async function insertLines(q, orderId, lines) {
  for (const i of lines) {
    await q.query(
      `INSERT INTO order_items (order_id, sku_code, is_free, qty, price, list_price, offer_id, offer_discount, coupon_discount, wallet_discount, hsn, gst_rate, taxable, cgst, sgst, igst, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, i.sku_code, i.is_free ? 1 : 0, i.qty, i.price, i.list_price, i.offer_id || null, i.offer_discount || 0, i.coupon_discount || 0, i.wallet_discount || 0, i.hsn, i.gst_rate, i.taxable, i.cgst, i.sgst, i.igst, i.line_total]
    );
  }
}
const addrCols = (p) => [p.bill.name, p.bill.gstin, p.bill.address, p.bill.town, p.bill.state_code, p.bill.pincode, p.bill.phone, p.billAddressId,
  p.ship.name, p.ship.address, p.ship.town, p.ship.state_code, p.ship.pincode, p.ship.phone, p.shipAddressId, p.contactId];

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
    `INSERT INTO orders (order_no, customer_id, price_list, status, payment_terms, credit_days, delivery_method_id, delivery_kind, delivery_area_id,
       bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone, bill_address_id,
       ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone, ship_address_id, contact_id, place_of_supply, gst_type,
       coupon_code, subtotal, discount, offer_discount, manual_discount, manual_discount_reason, delivery_charge, delivery_gst, delivery_waived, taxable, cgst, sgst, igst, gst, round_off, total,
       wallet_used, wallet_discount, wallet_gst, amount_due, note, emp_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderNo, p.cust.customer_id, p.list.key, status, p.terms, p.creditDays, p.method.method_id, p.method.kind, p.area ? p.area.area_id : null, ...addrCols(p), p.pos, p.gstType,
      p.coupon, t.subtotal, t.discount, t.offer_discount, t.manual_discount, p.manualReason, t.delivery_charge, t.delivery_gst, p.deliveryWaived, t.taxable, t.cgst, t.sgst, t.igst, t.gst, t.round_off, t.total,
      p.walletUsed, t.wallet_discount, p.walletGst, round2(t.total - (p.walletUsed - t.wallet_discount)), data.note ? String(data.note).slice(0, 255) : null, empId]
  );
  const orderId = ins.insertId;
  await insertLines(q, orderId, p.lines);
  if (p.coupon) await promotions.redeem(q, orderId, p.cust.customer_id, p.coupon, p.couponInfo.discount || p.couponInfo.delivery_waived);
  if (p.walletUsed > 0) await wallet.use(q, p.cust.customer_id, p.walletUsed, orderId, orderNo, empId);
  await history(q, orderId, null, status, p.holds.length ? `Waits for: ${p.holds.map((h) => approvals.KINDS[h.kind].label).join(', ')}` : null, empId);
  const ids = await requestHolds(q, orderNo, p.cust.name, p.holds, empId);
  if (status === 'new') await confirmed(q, orderId, empId, p.settings);
  await refreshPayment(q, orderId);
  await audit(q, { empId, action: 'create', entity: 'order', entityId: orderNo,
    after: { customer: p.cust.name, status, total: t.total, price_list: p.list.key, gst_type: p.gstType, terms: p.terms, delivery: p.method.label, delivery_charge: t.delivery_charge,
      lines: p.lines.map((i) => `${i.qty} x ${i.sku_code} @ ${i.price}${i.is_free ? ' (free)' : ''}`), offers: p.offers.map((x) => x.name), coupon: p.coupon, manual_discount: t.manual_discount,
      wallet_used: p.walletUsed, wallet_discount: t.wallet_discount, holds: p.holds.map((h) => h.kind) } });
  return { order_id: orderId, order_no: orderNo, status, held: status === 'approval', approvals: ids, price_list: p.list.label, gst_type: p.gstType, ...t, walletUsed: p.walletUsed };
}

/** what an order would be (the New / Edit order form, as you type): totals, lines with offers and free lines, coupon, wallet, holds */
async function previewOrder(q, data, empId, opts = {}) {
  let order = null;
  if (opts.orderNo) {
    [[order]] = await q.query(`SELECT ${ORDER_COLS} FROM orders WHERE order_no = ?`, [opts.orderNo]);
    if (!order) throw new CommerceError(`No order ${opts.orderNo}`, 404);
  }
  // a coupon or wallet amount that cannot apply is said next to its field; the rest of the order is still shown
  let couponError = null;
  let walletError = null;
  const tryPrepare = (d) => prepare(q, d, { ...opts, order, isNew: !order, preview: true });
  let p;
  try { p = await tryPrepare(data); } catch (e) {
    if (!(e instanceof CommerceError)) throw e;
    if (data.coupon_code && /coupon/i.test(e.message)) {
      couponError = e.message;
      try { p = await tryPrepare({ ...data, coupon_code: null }); } catch (e2) {
        if (!(e2 instanceof CommerceError) || !data.wallet_use || !/wallet/i.test(e2.message)) throw e2;
        walletError = e2.message; p = await tryPrepare({ ...data, coupon_code: null, wallet_use: 0 });
      }
    } else if (data.wallet_use && /wallet/i.test(e.message)) { walletError = e.message; p = await tryPrepare({ ...data, wallet_use: 0 }); } else throw e;
  }
  const t = p.totals;
  return {
    lines: p.lines.map((l) => ({ sku_code: l.sku_code, qty: l.qty, price: l.price, entered: l.entered, list_price: l.list_price, is_free: l.is_free, offer_id: l.offer_id || null, offer_label: l.offer_label || null,
      offer_discount: l.offer_discount, coupon_discount: l.coupon_discount, wallet_discount: l.wallet_discount, taxable: l.taxable, line_total: l.line_total })),
    totals: { ...t, lines: undefined, wallet_used: p.walletUsed, wallet_paid: round2(p.walletUsed - t.wallet_discount), due: round2(t.total - (p.walletUsed - t.wallet_discount)) },
    gst_type: p.gstType, place_of_supply: p.pos, pos_reason: p.posReason, offers: p.offers, coupon: p.couponInfo ? { code: p.couponInfo.code, kind: p.couponInfo.kind, discount: p.couponInfo.discount, delivery_waived: p.couponInfo.delivery_waived,
      excluded: p.couponInfo.excluded, capped: p.couponInfo.capped, cap: p.couponInfo.cap, description: p.couponInfo.description } : null,
    wallet: { used: p.walletUsed, cap: p.walletCap, max_pct: Number(p.settings.wallet_max_use_pct), gst: p.settings.cashback_gst_treatment === 'payment' ? 'payment' : 'discount', by_source: p.walletPlan ? p.walletPlan.bySource : {},
      usable: (await wallet.plan(q, p.cust.customer_id, 1e9, order ? order.order_id : 0)).total },
    discount: { total: p.discountTotal, pct: p.discountPct, limit: p.settings.approve_discount_on ? Number(p.settings.approve_discount_pct_above) : null },
    holds: p.holds.map((h) => ({ kind: h.kind, label: approvals.KINDS[h.kind].label, what: h.what })), delivery_area: p.area, coupon_error: couponError, wallet_error: walletError,
  };
}

const ORDER_COLS = `order_id, order_no, customer_id, status, payment_terms, credit_days, delivery_method_id, delivery_area_id, coupon_code, wallet_used, version, total,
  bill_name, bill_gstin, bill_address, bill_town, bill_state_code, bill_pincode, bill_phone, bill_address_id,
  ship_name, ship_address, ship_town, ship_state_code, ship_pincode, ship_phone, ship_address_id, contact_id`;

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
  const [beforeItems] = await q.query('SELECT sku_code, qty, price, is_free FROM order_items WHERE order_id = ? ORDER BY sku_code, is_free', [o.order_id]);
  const p = await prepare(q, data, { ...opts, order: o, isNew: false });
  const t = p.totals;
  await q.query('DELETE FROM order_items WHERE order_id = ?', [o.order_id]);
  await insertLines(q, o.order_id, p.lines);
  // coupon and wallet follow the edit: the old use goes back, the new one is taken (oldest credits first)
  await promotions.redeem(q, o.order_id, o.customer_id, p.coupon, p.couponInfo ? p.couponInfo.discount || p.couponInfo.delivery_waived : 0);
  if (Number(o.wallet_used) > 0 || p.walletUsed > 0) {
    if (Math.abs(Number(o.wallet_used) - p.walletUsed) > 0.005 || Number(o.wallet_used) > 0) {
      await wallet.giveBack(q, o.order_id, `Given back: ${orderNo} edited`, empId);
      if (p.walletUsed > 0) await wallet.use(q, o.customer_id, p.walletUsed, o.order_id, `${orderNo} (edited)`, empId);
    }
  }
  // approvals: the old requests are withdrawn, the edit asks again for what it still needs
  await withdrawHolds(q, orderNo, 'Order edited: asked again if still needed');
  let status = o.status;
  if (!['packing', 'packed'].includes(o.status)) status = p.holds.length ? 'approval' : 'new';
  if (o.status === 'packed') status = 'packing'; // the packer checks it again
  await q.query(
    `UPDATE orders SET status = ?, payment_terms = ?, delivery_method_id = ?, delivery_kind = ?, delivery_area_id = ?,
       bill_name = ?, bill_gstin = ?, bill_address = ?, bill_town = ?, bill_state_code = ?, bill_pincode = ?, bill_phone = ?, bill_address_id = ?,
       ship_name = ?, ship_address = ?, ship_town = ?, ship_state_code = ?, ship_pincode = ?, ship_phone = ?, ship_address_id = ?, contact_id = ?, place_of_supply = ?, gst_type = ?,
       coupon_code = ?, subtotal = ?, discount = ?, offer_discount = ?, manual_discount = ?, manual_discount_reason = ?, delivery_charge = ?, delivery_gst = ?, delivery_waived = ?,
       taxable = ?, cgst = ?, sgst = ?, igst = ?, gst = ?, round_off = ?, total = ?, wallet_used = ?, wallet_discount = ?, wallet_gst = ?,
       note = ?, version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE order_id = ?`,
    [status, p.terms, p.method.method_id, p.method.kind, p.area ? p.area.area_id : null, ...addrCols(p), p.pos, p.gstType, p.coupon, t.subtotal, t.discount, t.offer_discount, t.manual_discount, p.manualReason,
      t.delivery_charge, t.delivery_gst, p.deliveryWaived, t.taxable, t.cgst, t.sgst, t.igst, t.gst, t.round_off, t.total, p.walletUsed, t.wallet_discount, p.walletGst,
      String(data.note || '').trim().slice(0, 255) || null, empId, o.order_id]
  );
  await requestHolds(q, orderNo, p.cust.name, p.holds, empId);
  if (status === 'approval') await release(q, o.order_id);
  else if (o.status === 'approval' && status === 'new') await confirmed(q, o.order_id, empId, p.settings);
  else if (reservesNow(status, p.settings)) await reserve(q, o.order_id);
  if (status === 'packing') { await q.query('DELETE FROM pack_scans WHERE order_id = ?', [o.order_id]); await pickFor(q, o.order_id); } // picked and checked again
  // an invoice issued at confirm follows the edit: cancelled with a credit note, issued again
  const [[live]] = await q.query('SELECT invoice_no FROM invoices WHERE live_order_id = ?', [o.order_id]);
  if (live) { await invoices.cancelForOrder(q, o.order_id, `Order ${orderNo} edited`, empId); if (status !== 'approval') await invoices.issue(q, o.order_id, empId); }
  await history(q, o.order_id, o.status, 'edited', reason || null, empId);
  if (status !== o.status) await history(q, o.order_id, o.status, status, 'after the edit', empId);
  await refreshPayment(q, o.order_id);
  await audit(q, { empId, action: 'update', entity: 'order', entityId: orderNo,
    before: { status: o.status, total: Number(o.total), lines: beforeItems.map((i) => `${i.qty} x ${i.sku_code} @ ${Number(i.price)}${Number(i.is_free) ? ' (free)' : ''}`) },
    after: { status, total: t.total, lines: p.lines.map((i) => `${i.qty} x ${i.sku_code} @ ${i.price}${i.is_free ? ' (free)' : ''}`), coupon: p.coupon, manual_discount: t.manual_discount, wallet_used: p.walletUsed,
      reason: reason || null, gst_type: p.gstType, holds: p.holds.map((h) => h.kind) } });
  return { order_no: orderNo, status, version: Number(o.version) + 1, holds: p.holds.map((h) => h.kind), total: t.total };
}

/** cancel for good: reservations released, goods back after dispatch, invoice cancelled + credit note, coupon / wallet back */
async function doCancel(q, orderId, reason, empId) {
  const [[o]] = await q.query('SELECT order_id, order_no, customer_id, status, coupon_code, wallet_used FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
  if (!o || o.status === 'cancelled' || o.status === 'delivered') return false;
  await q.query("UPDATE orders SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), cancel_reason = ?, version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE order_id = ?",
    [String(reason).slice(0, 255), empId, orderId]);
  await release(q, orderId);
  const [[gone]] = await q.query('SELECT dispatched_at FROM orders WHERE order_id = ?', [orderId]);
  if (gone.dispatched_at) await stock.goodsBack(q, o.order_no, empId);
  const inv = await invoices.cancelForOrder(q, orderId, `Order ${o.order_no} cancelled: ${reason}`, empId);
  if (o.coupon_code) await promotions.redeem(q, orderId, o.customer_id, null, 0);
  if (Number(o.wallet_used) > 0) await wallet.giveBack(q, orderId, `Given back: ${o.order_no} cancelled`, empId);
  await withdrawHolds(q, o.order_no, 'Order cancelled');
  await history(q, orderId, o.status, 'cancelled', reason, empId);
  await refreshPayment(q, orderId);
  await audit(q, { empId, action: 'cancel', entity: 'order', entityId: o.order_no, before: { status: o.status }, after: { status: 'cancelled', reason, invoice: inv ? inv.invoice_no : null, credit_note: inv ? inv.credit_note_no : null } });
  return true;
}

/** Cancel (reason required). Once the goods left the godown: an approval request (Commerce setting) -> { pending, approval_id } */
async function cancelOrder(q, orderNo, reason, empId) {
  const why = String(reason || '').trim().slice(0, 255);
  if (!why) throw new CommerceError('Say why the order is cancelled');
  const [[o]] = await q.query('SELECT order_id, order_no, status, total, customer_id FROM orders WHERE order_no = ? FOR UPDATE', [orderNo]);
  if (!o) throw new CommerceError(`No order ${orderNo}`, 404);
  if (o.status === 'cancelled') throw new CommerceError(`${orderNo} is already cancelled`, 409);
  if (o.status === 'delivered') throw new CommerceError(`${orderNo} is delivered: use Returns`, 409);
  if (GONE.includes(o.status) && await approvals.needed(q, 'cancel_after_dispatch')) {
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

/**
 * The goods leave the godown (trip started, courier hand-over, customer pickup): stock out by the picked batches,
 * reservations consumed, tax invoice issued, dispatched_at set. Only once per order. -> { invoice_no, batches }
 */
async function leaveGodown(q, orderId, empId, { at = null } = {}) {
  const [[o]] = await q.query('SELECT order_id, order_no, dispatched_at FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
  if (o.dispatched_at) return { invoice_no: null, batches: [], already: true };
  let batches;
  try { batches = await stock.dispatchOut(q, o.order_id, o.order_no, empId); } catch (e) { if (e instanceof stock.StockError) throw new CommerceError(e.message, e.status); throw e; }
  await q.query("UPDATE stock_reservations SET status = 'consumed', closed_at = UTC_TIMESTAMP() WHERE order_id = ? AND status = 'active'", [o.order_id]);
  const inv = await invoices.issue(q, o.order_id, empId, { at });
  await q.query('UPDATE orders SET dispatched_at = COALESCE(?, UTC_TIMESTAMP()) WHERE order_id = ?', [at, o.order_id]);
  return { invoice_no: inv.invoice_no, batches: batches.filter((x) => x.batch_no) };
}

/** move an order to a status (the delivery steps in delivery.js) with its time stamp, history and audit */
async function setStatus(q, o, to, empId, note = null, extra = {}) {
  const stamp = { packing: 'packing_at', packed: 'packed_at', out_for_delivery: 'out_at', with_courier: 'courier_at', failed: 'failed_at', delivered: 'delivered_at' }[to];
  const cols = Object.keys(extra);
  await q.query(`UPDATE orders SET status = ?, ${stamp ? `${stamp} = UTC_TIMESTAMP(), ` : ''}${cols.map((c) => `${c} = ?, `).join('')}version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE order_id = ?`,
    [to, ...Object.values(extra), empId, o.order_id]);
  await history(q, o.order_id, o.status, to, note, empId);
  await audit(q, { empId, action: 'status', entity: 'order', entityId: o.order_no, before: { status: o.status }, after: { status: to, note, ...extra } });
  await notifications.orderStatus(q, o.order_id, o.status, to, note);
  if (to === 'delivered' && (await commerceSettings.read(q)).cashback_credit_at === 'delivery') await promotions.creditCashback(q, o.order_id, empId);
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
  if (kind === 'payment') await notifications.paymentReceived(q, ins.insertId);
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
  if (!o || ['cancelled', 'delivered', ...GONE].includes(o.status)) return;
  await doCancel(q, o.order_id, `Approval ${status}`, empId);
}
for (const k of HOLD_KINDS) { approvals.onApproved(k, holdApproved); approvals.onClosed(k, holdClosed); }
approvals.onApproved('cancel_after_dispatch', async (q, p, empId) => {
  const [[o]] = await q.query('SELECT order_id FROM orders WHERE order_no = ?', [p.order_no]);
  if (o) await doCancel(q, o.order_id, `${p.reason} (approved after dispatch)`, empId);
});

module.exports = {
  STATUS_LABEL, GONE, HELD, TERMS, MODES, PAYMENT_STATUS, EDITABLE, CommerceError, deliveryCharge, deliveryMethod,
  createOrder, updateOrder, previewOrder, cancelOrder, doCancel, leaveGodown, setStatus, pickFor, reserve, pendingHolds, recordPayment, walletBalance, availability, spread,
  overdueOf, outstandingOf, modesOffered, OVERDUE_SQL, taxTotals, istYear, refreshPayment,
};
