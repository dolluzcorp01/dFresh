// Promotions (docs/COMMERCE-SPEC.md 3, 4.8; migration 20261021_commerce_10_promotions_wallet.sql): coupons, automatic
// offers, cashback and manual wallet credit / debit. Shared by the order logic (commerce.js prepare), returns.js, the
// admin routes and the demo seed. Every change is audited.
// - Coupons: one per order. Checked: on, dates, who (customer types or specific customers), uses in all and per
//   customer, minimum order, which lines (include / exclude SKUs or categories), the cap; percent / fixed take from
//   the lines it covers, free delivery waives the delivery charge. Offers and a coupon combine only when the setting
//   says so.
// - Offers (automatic, shown on the line): quantity slab = from N packs or cartons, n % off that line (the best slab
//   wins); buy X get Y = a free line at Rs 0 (the same or another SKU) that is reserved, picked and dispatched like any.
// - Cashback: the rule of the order's customer type (or "all types"), valid on the delivery day, on the goods value
//   before GST after discounts and returns; capped per order. Credited on delivery or once the return window has passed
//   (setting); a refund after it takes the matching share back (wallet debit, shown on the return).
// - Manual wallet credit / debit: reason required; through approval when the setting says so.
// - Jobs (hourly, and the Run now button on Promotions): wallet expiry, cashback whose window has passed.
// - Phase 22 (v23 sections 13, 14): offers, coupons and cashback rules have a status (draft, waiting, live, rejected,
//   ended); only a live one applies. Sending one (or changing a live one so that it gives more) asks the rule "New offer
//   or coupon goes live" (cashback: "New cashback rule goes live"), and an offer or coupon that would sell a pack below
//   its cost also asks "Promotion that sells below cost"; every signature in, it goes live; one rejection sends it back
//   to a draft with the reason. Stop ends it (orders already made keep it). An offer can be for named customers as well
//   as customer types, may say whether a coupon stacks on it (empty: the Commerce setting) and has a budget (stops
//   applying once the value given reaches it). W2: a return or credit note that takes the invoice under the cashback
//   rule's minimum takes all of that order's cashback back.
const { audit } = require('./audit');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const wallet = require('./wallet');

const KINDS = { percent: 'Percent off', fixed: 'Fixed amount off', free_delivery: 'Free delivery' };
const OFFER_KINDS = { slab: 'Quantity slab', bxgy: 'Buy X get Y free' };
const round2 = (n) => Math.round(n * 100) / 100;
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

class PromoError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---------------------------------------------------------------- offers
/** the offers on for this customer type on `day` */
/** what an offer has given on orders not cancelled: the % taken off plus the free packs at their list price (no GST) */
const GIVEN_SQL = `(SELECT COALESCE(SUM(IF(i.is_free = 1, i.qty * i.list_price, i.offer_discount)), 0) FROM order_items i JOIN orders x ON x.order_id = i.order_id
    WHERE i.offer_id = o.offer_id AND x.status NOT IN ('cancelled', 'draft'))`;
async function offersOn(q, typeKey, day, customerId = null, exceptOrderId = 0) {
  const [rows] = await q.query(
    `SELECT o.offer_id, o.name, o.kind, o.sku_code, o.category_key, o.min_qty, o.min_unit, o.pct, o.buy_qty, o.get_qty, o.get_sku_code, o.with_coupon, o.budget,
            ${GIVEN_SQL.replace("x.status NOT IN ('cancelled', 'draft')", "x.status NOT IN ('cancelled', 'draft') AND x.order_id <> ?")} AS given
       FROM offers o WHERE o.is_active = 1 AND o.status = 'live' AND (o.valid_from IS NULL OR o.valid_from <= ?) AND (o.valid_to IS NULL OR o.valid_to >= ?)
        AND ((NOT EXISTS (SELECT 1 FROM offer_customer_types t WHERE t.offer_id = o.offer_id) AND NOT EXISTS (SELECT 1 FROM offer_customers u WHERE u.offer_id = o.offer_id))
          OR EXISTS (SELECT 1 FROM offer_customer_types t WHERE t.offer_id = o.offer_id AND t.type_key = ?)
          OR EXISTS (SELECT 1 FROM offer_customers u WHERE u.offer_id = o.offer_id AND u.customer_id = ?))
      ORDER BY o.offer_id`, [Number(exceptOrderId) || 0, day, day, typeKey, Number(customerId) || 0]);
  // a budget used up: the offer stops applying (v23)
  return rows.filter((r) => r.budget === null || Number(r.given) < Number(r.budget) - 0.004).map((r) => ({ ...r, pct: Number(r.pct), with_coupon: r.with_coupon === null ? null : Number(r.with_coupon) === 1 }));
}
const offerHits = (o, l) => (o.sku_code ? o.sku_code === l.sku_code : o.category_key === l.category_key);
const slabText = (o) => `${Number(o.pct)}% off from ${o.min_qty} ${o.min_unit === 'carton' ? 'carton' : 'pack'}${o.min_qty === 1 ? '' : 's'}`;
const bxgyText = (o) => `buy ${o.buy_qty} get ${o.get_qty}${o.get_sku_code ? ` ${o.get_sku_code}` : ''} free`;

/**
 * lines: paid lines [{ sku_code, category_key, qty (packs), price, packs_per_carton }] -> the same lines with offer_id,
 * offer_label, offer_discount; free: [{ sku_code, qty, offer_id, offer_label }]; applied: [{ offer_id, name, kind, amount, free_qty }]
 */
async function applyOffers(q, typeKey, day, lines, customerId = null, exceptOrderId = 0) {
  const offers = await offersOn(q, typeKey, day, customerId, exceptOrderId);
  const applied = new Map();
  const note = (o, amount, freeQty) => {
    const a = applied.get(o.offer_id) || { offer_id: o.offer_id, name: o.name, kind: o.kind, amount: 0, free_qty: 0, with_coupon: o.with_coupon };
    a.amount = round2(a.amount + amount); a.free_qty += freeQty; applied.set(o.offer_id, a);
  };
  const out = lines.map((l) => {
    const units = (o) => (o.min_unit === 'carton' ? Math.floor(l.qty / (Number(l.packs_per_carton) || 1)) : l.qty);
    const slab = offers.filter((o) => o.kind === 'slab' && offerHits(o, l) && units(o) >= o.min_qty).sort((a, b) => b.pct - a.pct)[0];
    if (!slab) return { ...l, offer_id: null, offer_label: null, offer_discount: 0 };
    const d = round2(l.qty * l.price * (slab.pct / 100));
    note(slab, d, 0);
    return { ...l, offer_id: slab.offer_id, offer_label: `${slab.name}: ${slabText(slab)}`, offer_discount: d };
  });
  const free = new Map();
  for (const o of offers.filter((x) => x.kind === 'bxgy' && x.buy_qty > 0 && x.get_qty > 0)) {
    for (const l of lines.filter((x) => offerHits(o, x))) {
      const n = Math.floor(l.qty / o.buy_qty) * o.get_qty;
      if (!n) continue;
      const sku = o.get_sku_code || l.sku_code;
      const f = free.get(sku) || { sku_code: sku, qty: 0, offer_id: o.offer_id, offer_label: `${o.name}: ${bxgyText(o)}` };
      f.qty += n; free.set(sku, f);
      note(o, 0, n);
      const line = out.find((x) => x.sku_code === l.sku_code);
      if (!line.offer_label) line.offer_label = `${o.name}: ${bxgyText(o)} (${n} free)`;
    }
  }
  return { lines: out, free: [...free.values()], applied: [...applied.values()] };
}

// ---------------------------------------------------------------- coupons
async function couponRow(q, code, lock) {
  const [[c]] = await q.query(`SELECT code, description, kind, value, min_order, max_discount, DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from, DATE_FORMAT(valid_to, '%Y-%m-%d') AS valid_to,
      total_limit, per_customer_limit, is_active, status FROM coupons WHERE code = ?${lock ? ' FOR UPDATE' : ''}`, [code]);
  if (!c) return null;
  const [scope] = await q.query('SELECT scope, type_key, customer_id, sku_code, category_key FROM coupon_scope WHERE code = ? ORDER BY id', [code]);
  return { ...c, value: Number(c.value), min_order: Number(c.min_order), max_discount: c.max_discount === null ? null : Number(c.max_discount), scope };
}

/**
 * Does the coupon apply, and how much? ctx = { customerId, typeKey, lines: paid lines [{ sku_code, category_key, net }],
 * goods (paid lines after offers), deliveryCharge, orderId (editing: its own use does not count), hasOffers, settings, lock }
 * -> { code, kind, discount, delivery_waived, eligible: Set of sku_code, excluded: [sku_code], capped }
 */
async function evalCoupon(q, rawCode, ctx) {
  const code = String(rawCode || '').trim().toUpperCase();
  const c = await couponRow(q, code, ctx.lock);
  if (!c) throw new PromoError(`No coupon ${code}`);
  const [[own]] = ctx.orderId ? await q.query("SELECT COUNT(*) AS n FROM coupon_redemptions WHERE code = ? AND order_id = ? AND status = 'active'", [code, ctx.orderId]) : [[{ n: 0 }]];
  const mine = Number(own.n) > 0; // already on this order: dates and limits were checked when it was used
  if (!Number(c.is_active) && !mine) throw new PromoError(`Coupon ${code} is switched off`);
  if (c.status !== 'live' && !mine) throw new PromoError(`Coupon ${code} is ${STATUS_LABEL[c.status] ? STATUS_LABEL[c.status].toLowerCase() : c.status}: not usable yet`);
  const today = istToday();
  if (!mine && c.valid_from && today < c.valid_from) throw new PromoError(`Coupon ${code} starts on ${c.valid_from}`);
  if (!mine && c.valid_to && today > c.valid_to) throw new PromoError(`Coupon ${code} ended on ${c.valid_to}`);
  // phase 22: each offer may say whether a coupon stacks on it (empty: the Commerce setting)
  if (ctx.hasOffers && (ctx.stack === undefined ? !ctx.settings.offers_with_coupon : !ctx.stack)) throw new PromoError(`Coupon ${code}: this order already has an automatic offer that does not combine with a coupon`);
  const types = c.scope.filter((s) => s.scope === 'type').map((s) => s.type_key);
  const custs = c.scope.filter((s) => s.scope === 'customer').map((s) => Number(s.customer_id));
  if ((types.length || custs.length) && !types.includes(ctx.typeKey) && !custs.includes(Number(ctx.customerId))) {
    throw new PromoError(`Coupon ${code} is not for this customer (only ${[types.length ? `types: ${types.join(', ')}` : null, custs.length ? `${custs.length} named customer(s)` : null].filter(Boolean).join('; ')})`);
  }
  if (!mine && c.total_limit !== null) {
    const [[u]] = await q.query(`SELECT COUNT(*) AS n FROM coupon_redemptions WHERE code = ? AND status = 'active'${ctx.lock ? ' FOR SHARE' : ''}`, [code]); // after the coupon lock: the latest uses
    if (Number(u.n) >= c.total_limit) throw new PromoError(`Coupon ${code} is used up (${u.n} of ${c.total_limit} uses)`);
  }
  if (!mine && c.per_customer_limit !== null) {
    const [[u]] = await q.query(`SELECT COUNT(*) AS n FROM coupon_redemptions WHERE code = ? AND customer_id = ? AND status = 'active'${ctx.lock ? ' FOR SHARE' : ''}`, [code, ctx.customerId]);
    if (Number(u.n) >= c.per_customer_limit) throw new PromoError(`Coupon ${code}: this customer has used it ${u.n} time${Number(u.n) === 1 ? '' : 's'} already (limit ${c.per_customer_limit} per customer)`);
  }
  if (ctx.goods < c.min_order) throw new PromoError(`Coupon ${code} needs goods of at least ${rs(c.min_order)} (this order: ${rs(ctx.goods)})`);
  const inc = c.scope.filter((s) => s.scope === 'include');
  const exc = c.scope.filter((s) => s.scope === 'exclude');
  const hit = (rows, l) => rows.some((s) => (s.sku_code ? s.sku_code === l.sku_code : s.category_key === l.category_key));
  const eligible = ctx.lines.filter((l) => (!inc.length || hit(inc, l)) && !hit(exc, l));
  const excluded = ctx.lines.filter((l) => !eligible.includes(l)).map((l) => l.sku_code);
  const base = round2(eligible.reduce((a, l) => a + l.net, 0));
  if (c.kind === 'free_delivery') {
    if (!(ctx.deliveryCharge > 0)) throw new PromoError(`Coupon ${code} waives the delivery charge, and this order has none`);
    return { code, kind: c.kind, discount: 0, delivery_waived: round2(ctx.deliveryCharge), eligible: new Set(), excluded: [], capped: false, description: c.description };
  }
  if (base <= 0) throw new PromoError(`Coupon ${code} does not cover any SKU on this order${excluded.length ? ` (${excluded.join(', ')} excluded)` : ''}`);
  let d = c.kind === 'percent' ? round2(base * (c.value / 100)) : Math.min(c.value, base);
  let capped = false;
  if (c.max_discount !== null && d > c.max_discount) { d = c.max_discount; capped = true; }
  return { code, kind: c.kind, discount: round2(d), delivery_waived: 0, eligible: new Set(eligible.map((l) => l.sku_code)), excluded, capped, cap: c.max_discount, description: c.description, value: c.value };
}

/** the order's coupon use: the old one released, the new one recorded */
async function redeem(q, orderId, customerId, code, amount) {
  await q.query("UPDATE coupon_redemptions SET status = 'released', released_at = UTC_TIMESTAMP() WHERE order_id = ? AND status = 'active'", [orderId]);
  if (code) await q.query('INSERT INTO coupon_redemptions (code, order_id, customer_id, amount) VALUES (?, ?, ?, ?)', [code, orderId, customerId, amount]);
}

// ---------------------------------------------------------------- cashback
/** the rule for this customer type on `day` (a type's own rule before "all types"; the higher percent) */
async function cashbackRule(q, typeKey, day) {
  const [rows] = await q.query(
    `SELECT rule_id, name, type_key, pct, min_order, max_per_order FROM cashback_rules
      WHERE is_active = 1 AND status = 'live' AND (type_key IS NULL OR type_key = ?) AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)
      ORDER BY type_key IS NULL, pct DESC LIMIT 1`, [typeKey, day, day]);
  return rows[0] || null;
}

/** goods value before GST after discounts, less what return credit notes took back */
async function goodsValue(q, orderId) {
  const [[g]] = await q.query('SELECT COALESCE(SUM(taxable), 0) AS v FROM order_items WHERE order_id = ? AND is_free = 0', [orderId]);
  // phase 22: every credit note made on it that is not the cancel of the whole invoice (returns and price corrections)
  const [[r]] = await q.query(`SELECT COALESCE(SUM(cn.taxable), 0) AS v FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id
      WHERE i.order_id = ? AND cn.status = 'done' AND cn.kind <> 'cancel'`, [orderId]);
  return round2(Number(g.v) - Number(r.v));
}

/** work out and credit the cashback of a delivered order (once) -> amount */
async function creditCashback(q, orderId, empId) {
  const [[o]] = await q.query(`SELECT o.order_id, o.order_no, o.customer_id, c.type_key, o.status, o.cashback_amount, DATE_FORMAT(CONVERT_TZ(o.delivered_at, '+00:00', '+05:30'), '%Y-%m-%d') AS delivered_on
      FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_id = ? FOR UPDATE`, [orderId]);
  if (!o || o.status !== 'delivered' || o.cashback_amount !== null) return 0;
  const base = await goodsValue(q, orderId);
  const rule = await cashbackRule(q, o.type_key, o.delivered_on); // the customer type's rule (not its price list)
  let amount = 0;
  if (rule && base > 0 && base >= Number(rule.min_order)) {
    amount = round2(base * (Number(rule.pct) / 100));
    if (rule.max_per_order !== null) amount = Math.min(amount, Number(rule.max_per_order));
  }
  await q.query('UPDATE orders SET cashback_base = ?, cashback_amount = ?, cashback_min = ?, cashback_at = UTC_TIMESTAMP() WHERE order_id = ?', [base, amount, rule ? Number(rule.min_order) : null, orderId]);
  if (amount > 0) {
    await wallet.credit(q, { customerId: o.customer_id, source: 'cashback', amount, reason: `Cashback ${Number(rule.pct)}% on ${o.order_no} (${rule.name})`, orderId }, empId);
  }
  await audit(q, { empId, action: 'cashback', entity: 'order', entityId: o.order_no, after: { base, rule: rule ? rule.name : null, amount } });
  return amount;
}

/** delivered orders whose cashback is due now (setting: on delivery, or once the return window has passed) */
async function cashbackDue(q, empId) {
  const s = await commerceSettings.read(q);
  if (s.wallet_enabled === false) return []; // phase 23: no cashback is earned while the wallet is switched off
  const days = s.cashback_credit_at === 'delivery' ? 0 : Number(s.return_window_days) || 0;
  const [rows] = await q.query(`SELECT order_id, order_no FROM orders WHERE status = 'delivered' AND cashback_amount IS NULL
      AND DATE(CONVERT_TZ(delivered_at, '+00:00', '+05:30')) + INTERVAL ? DAY ${days ? '<' : '<='} ${IST_TODAY} ORDER BY order_id`, [days]);
  const out = [];
  for (const r of rows) out.push({ order_no: r.order_no, amount: await creditCashback(q, r.order_id, empId) });
  return out;
}

/** a return refunded after the cashback was credited: the matching share is taken back -> amount */
async function reverseCashback(q, orderId, taxableBack, returnId, returnNo, empId) {
  const [[o]] = await q.query('SELECT order_no, customer_id, cashback_base, cashback_amount, cashback_min FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
  if (!o || !(Number(o.cashback_amount) > 0) || !(Number(o.cashback_base) > 0)) return 0;
  const [[done]] = await q.query("SELECT COALESCE(-SUM(amount), 0) AS n FROM wallet_entries WHERE order_id = ? AND source = 'reversed' FOR SHARE", [orderId]);
  const left = round2(Number(o.cashback_amount) - Number(done.n));
  let amt = round2(Math.min(Number(o.cashback_amount) * (taxableBack / Number(o.cashback_base)), left));
  // W2 (v23 Low4 d): under the rule's minimum after this credit, none of the cashback was earned
  let under = false;
  if (o.cashback_min !== null && Number(o.cashback_min) > 0 && (await goodsValue(q, orderId)) < Number(o.cashback_min) - 0.004) { amt = left; under = true; }
  if (amt <= 0.005) return 0;
  await wallet.debit(q, { customerId: o.customer_id, source: 'reversed', amount: amt, reason: `Cashback on ${o.order_no} taken back: ${returnId ? `return ${returnNo}` : `credit note ${returnNo}`}${under ? ` (now under the rule's minimum Rs ${Number(o.cashback_min).toFixed(2)}: all of it)` : ''}`, orderId, returnId }, empId);
  if (returnId) await q.query('UPDATE returns SET cashback_reversed = cashback_reversed + ? WHERE return_id = ?', [amt, returnId]);
  return amt;
}

// ---------------------------------------------------------------- going live (phase 22, v23 promoSend / promoDecided)
const STATUS_LABEL = { draft: 'Draft', waiting: 'Waiting for approval', live: 'Live', scheduled: 'Starts later', rejected: 'Sent back', ended: 'Ended' };
const ENT = {
  offer: { table: 'offers', key: 'offer_id', kind: 'promo_new', label: (r) => `Offer ${r.offer_id} ${r.name}: ${r.kind === 'slab' ? slabText(r) : bxgyText(r)}` },
  coupon: { table: 'coupons', key: 'code', kind: 'promo_new', label: (r) => `Coupon ${r.code}: ${r.kind === 'percent' ? `${Number(r.value)}% off${r.max_discount !== null ? ` (up to ${rs(r.max_discount)})` : ''}` : r.kind === 'fixed' ? `${rs(r.value)} off` : 'free delivery'}${Number(r.min_order) ? ` above ${rs(r.min_order)}` : ''}` },
  rule: { table: 'cashback_rules', key: 'rule_id', kind: 'cashback_rule', label: (r) => `Cashback rule ${r.rule_id} ${r.name}: ${Number(r.pct)}% back${Number(r.min_order) ? ` above ${rs(r.min_order)}` : ''}` },
};
/** the status a list shows: live before its start = starts later; past its end = ended */
function shownStatus(r, today = istToday()) {
  if (r.status !== 'live') return r.status;
  if (!Number(r.is_active)) return 'ended';
  const from = r.valid_from ? String(r.valid_from).slice(0, 10) : null; const to = r.valid_to ? String(r.valid_to).slice(0, 10) : null;
  if (from && from > today) return 'scheduled';
  if (to && to < today) return 'ended';
  return 'live';
}
/** the packs an offer (or a % coupon) would sell below their cost -> ['DF044-M100 at Rs 52.50 against cost Rs 57.20'] */
async function belowCost(q, ent, r) {
  const pricing = require('./pricing'); // eslint-disable-line global-require
  const out = [];
  const costOf = async (sku) => { const [[s]] = await q.query('SELECT COALESCE(avg_cost, std_cost) AS c FROM skus WHERE sku_code = ?', [sku]); return s && s.c !== null ? Number(s.c) : null; };
  const listOf = async (sku) => { try { const x = await pricing.quote(q, { sku, qty: 1 }); return x && x.ex !== undefined ? Number(x.ex) : null; } catch (e) { return null; } };
  const check = async (sku, price) => { const c = await costOf(sku); if (c !== null && price !== null && price < c - 0.004) out.push(`${sku} at ${rs(price)} against cost ${rs(c)}`); };
  const skusOf = async (sku, cat) => (sku ? [sku] : (await q.query("SELECT s.sku_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE p.category_key = ? AND s.is_active = 1 AND s.sku_type <> 'raw'", [cat]))[0].map((x) => x.sku_code));
  if (ent === 'offer' && r.kind === 'slab') for (const s of await skusOf(r.sku_code, r.category_key)) { const l = await listOf(s); if (l !== null) await check(s, round2(l * (1 - Number(r.pct) / 100))); }
  if (ent === 'offer' && r.kind === 'bxgy') {
    for (const s of await skusOf(r.sku_code, r.category_key)) {
      const l = await listOf(s); const cg = await costOf(r.get_sku_code || s);
      if (l !== null && cg !== null) await check(s, round2((l * r.buy_qty - cg * r.get_qty) / r.buy_qty));
    }
  }
  if (ent === 'coupon' && r.kind === 'percent') {
    const [skus] = await q.query("SELECT s.sku_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.is_active = 1 AND s.sku_type <> 'raw' AND s.status = 'active'");
    for (const s of skus) { const l = await listOf(s.sku_code); if (l !== null) await check(s.sku_code, round2(l * (1 - Number(r.value) / 100))); }
  }
  return out;
}
async function rowOf(q, ent, key, lock = false) {
  const e = ENT[ent];
  const [[r]] = await q.query(`SELECT * FROM ${e.table} WHERE ${e.key} = ?${lock ? ' FOR UPDATE' : ''}`, [key]);
  return r || null;
}
/** send an offer, coupon or rule for approval (or live at once when no rule asks) -> { status, approvals, message } */
async function sendLive(q, ent, key, empId, godownId = 1) {
  const e = ENT[ent];
  const r = await rowOf(q, ent, key, true);
  if (!r) throw new PromoError('Not found', 404);
  if (['waiting'].includes(r.status)) throw new PromoError(`${e.label(r)} already waits for approval`, 409);
  const name = e.label(r);
  const asks = [];
  if (await approvals.needed(q, e.kind, {})) asks.push([e.kind, `${name}, ${r.valid_from ? String(r.valid_from).slice(0, 10) : 'now'} to ${r.valid_to ? String(r.valid_to).slice(0, 10) : 'open'}`]);
  if (ent !== 'rule') {
    const bc = await belowCost(q, ent, r);
    if (bc.length && await approvals.needed(q, 'promo_below_cost', {})) asks.push(['promo_below_cost', `${name}. Below cost: ${bc.slice(0, 6).join(', ')}${bc.length > 6 ? ' ...' : ''}`]);
  }
  const ids = [];
  for (const [kind, summary] of asks) {
    ids.push(await approvals.request(q, { kind, godownId, refType: ent, refId: String(key), summary, payload: { ent, key: String(key) } }, empId));
  }
  await q.query(`UPDATE ${e.table} SET status = ?, is_active = 1, rej_note = NULL, stopped_at = NULL, stopped_by = NULL WHERE ${e.key} = ?`, [ids.length ? 'waiting' : 'live', key]);
  await audit(q, { empId, action: 'send', entity: ent === 'rule' ? 'cashback_rule' : ent, entityId: String(key), after: { status: ids.length ? 'waiting' : 'live', approvals: ids } });
  return { status: ids.length ? 'waiting' : 'live', approvals: ids, message: ids.length ? `Waiting for approval: ${asks.map(([k]) => approvals.KINDS[k] ? approvals.KINDS[k].label : k).join(', ')}.` : 'Live.' };
}
/** stop (end) a live or waiting one: orders already made keep it */
async function stop(q, ent, key, empId) {
  const e = ENT[ent];
  const r = await rowOf(q, ent, key, true);
  if (!r) throw new PromoError('Not found', 404);
  if (r.status === 'waiting') {
    const [ps] = await q.query("SELECT approval_id FROM approvals WHERE ref_type = ? AND ref_id = ? AND status = 'pending'", [ent, String(key)]);
    for (const p of ps) await q.query("UPDATE approvals SET status = 'withdrawn', decided_by = ?, decided_at = UTC_TIMESTAMP(), note = 'Stopped' WHERE approval_id = ?", [empId, p.approval_id]);
  }
  await q.query(`UPDATE ${e.table} SET status = 'ended', is_active = 0, stopped_at = UTC_TIMESTAMP(), stopped_by = ? WHERE ${e.key} = ?`, [empId, key]);
  await audit(q, { empId, action: 'stop', entity: ent === 'rule' ? 'cashback_rule' : ent, entityId: String(key), before: { status: r.status }, after: { status: 'ended' } });
  return { status: 'ended', message: 'Ended. Orders already made keep it.' };
}
/** does a change of a live one give more (so it must be signed again)? */
function givesMore(ent, before, after) {
  const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const later = (a, b) => (b === null ? a !== null : a !== null && String(a).slice(0, 10) < String(b).slice(0, 10)); // the new end is later (or open)
  const earlier = (a, b) => (b === null ? false : a === null || String(b).slice(0, 10) < String(a).slice(0, 10));
  const wider = later(before.valid_to, after.valid_to) || earlier(before.valid_from, after.valid_from);
  if (ent === 'offer') return wider || after.kind !== before.kind || after.sku_code !== before.sku_code || after.category_key !== before.category_key || n(after.pct) > n(before.pct) || n(after.min_qty) < n(before.min_qty)
    || n(after.get_qty) > n(before.get_qty) || n(after.buy_qty) < n(before.buy_qty) || (n(before.budget) !== null && (n(after.budget) === null || n(after.budget) > n(before.budget))) || Boolean(after.wider_who);
  if (ent === 'coupon') return wider || after.kind !== before.kind || n(after.value) > n(before.value) || n(after.min_order) < n(before.min_order)
    || (n(before.max_discount) !== null && (n(after.max_discount) === null || n(after.max_discount) > n(before.max_discount)))
    || (n(before.total_limit) !== null && (n(after.total_limit) === null || n(after.total_limit) > n(before.total_limit)))
    || (n(before.per_customer_limit) !== null && (n(after.per_customer_limit) === null || n(after.per_customer_limit) > n(before.per_customer_limit))) || Boolean(after.wider_who);
  return wider || n(after.pct) > n(before.pct) || n(after.min_order) < n(before.min_order) || (n(before.max_per_order) !== null && (n(after.max_per_order) === null || n(after.max_per_order) > n(before.max_per_order)))
    || (before.type_key !== null && after.type_key !== before.type_key);
}
async function decidedLive(q, p, empId) {
  if (!p || !p.ent) return;
  const e = ENT[p.ent];
  const [pend] = await q.query("SELECT COUNT(*) AS n FROM approvals WHERE ref_type = ? AND ref_id = ? AND status = 'pending'", [p.ent, p.key]);
  if (Number(pend[0].n)) return; // the other signature still waits
  await q.query(`UPDATE ${e.table} SET status = 'live', rej_note = NULL WHERE ${e.key} = ? AND status = 'waiting'`, [p.key]);
  await audit(q, { empId, action: 'live', entity: p.ent === 'rule' ? 'cashback_rule' : p.ent, entityId: String(p.key), after: { status: 'live' } });
}
async function closedLive(q, p, status, empId) {
  if (!p || !p.ent) return;
  const e = ENT[p.ent];
  const [others] = await q.query("SELECT approval_id FROM approvals WHERE ref_type = ? AND ref_id = ? AND status = 'pending'", [p.ent, p.key]);
  for (const o of others) await q.query("UPDATE approvals SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), note = 'Closed with the other check' WHERE approval_id = ?", [status === 'rejected' ? 'rejected' : 'withdrawn', empId, o.approval_id]);
  const [[a]] = await q.query("SELECT kind, decided_by FROM approvals WHERE ref_type = ? AND ref_id = ? AND status = ? ORDER BY approval_id DESC LIMIT 1", [p.ent, p.key, status]);
  const who = await require('./inventory').nameOf(q, a && a.decided_by ? a.decided_by : empId); // eslint-disable-line global-require
  const note = `${a && approvals.KINDS[a.kind] ? approvals.KINDS[a.kind].label : 'Approval'}: ${status} by ${who}`;
  await q.query(`UPDATE ${e.table} SET status = ?, rej_note = ? WHERE ${e.key} = ? AND status = 'waiting'`, [status === 'rejected' ? 'rejected' : 'draft', note.slice(0, 255), p.key]);
}
for (const k of ['promo_new', 'promo_below_cost', 'cashback_rule']) { approvals.onApproved(k, decidedLive); approvals.onClosed(k, closedLive); }

// ---------------------------------------------------------------- manual wallet credit / debit
/** b = { direction: credit | debit, amount, reason } -> { posted, approval_id } */
async function manualWallet(q, customerId, b, empId) {
  const [[c]] = await q.query('SELECT customer_id, name, godown_id FROM customers WHERE customer_id = ?', [customerId]);
  if (!c) throw new PromoError('No such customer', 404);
  const dir = b.direction === 'debit' ? 'debit' : 'credit';
  const s = String(b.amount ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s) || Number(s) <= 0) throw new PromoError('Amount: above 0, like 250 or 250.50');
  const reason = String(b.reason || '').trim().slice(0, 160);
  if (!reason) throw new PromoError('Say why (it is on the customer\'s statement)');
  const amount = Number(s);
  if (dir === 'debit' && amount > await wallet.balance(q, customerId) + 0.005) throw new PromoError(`The wallet has only ${rs(await wallet.balance(q, customerId))}`);
  const payload = { customer_id: c.customer_id, direction: dir, amount, reason };
  const kind = dir === 'credit' ? 'goodwill_credit' : 'wallet_debit';
  if (await approvals.needed(q, kind, { amount, target: `cust:${c.customer_id}` })) {
    const id = await approvals.request(q, { kind, godownId: c.godown_id, target: `cust:${c.customer_id}`, refType: 'customer', refId: String(c.customer_id), summary: `${dir === 'credit' ? 'Wallet credit' : 'Wallet debit'} ${rs(amount)} for ${c.name}: ${reason}`, amount, payload }, empId);
    return { posted: false, approval_id: id };
  }
  await postManual(q, payload, null, empId);
  return { posted: true, approval_id: null };
}
async function postManual(q, p, approvalId, empId) {
  if (!p || !p.customer_id) return; // older demo requests carry no wallet change
  if (p.direction === 'debit') await wallet.debit(q, { customerId: p.customer_id, source: 'manual', amount: p.amount, reason: `Manual debit: ${p.reason}`, approvalId }, empId);
  else await wallet.credit(q, { customerId: p.customer_id, source: 'manual', amount: p.amount, reason: `Manual credit: ${p.reason}`, approvalId }, empId);
}
approvals.onApproved('goodwill_credit', async (q, p, empId) => postManual(q, p, null, empId));
approvals.onApproved('wallet_debit', async (q, p, empId) => postManual(q, p, null, empId));

// ---------------------------------------------------------------- jobs
async function runJobs(q, empId = 'system') {
  const expired = await wallet.expireDue(q, empId);
  const cashback = await cashbackDue(q, empId);
  return { expired, cashback };
}
let timer = null;
/** hourly: wallet expiry and due cashback (own transaction; quiet when commerce tables are missing) */
function startJobs() {
  if (timer) return;
  const { getDBConnection } = require('../../config/db');
  const pool = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
  const tick = async () => {
    const conn = await pool.getConnection().catch(() => null);
    if (!conn) return;
    try {
      const [[has]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'wallet_allocations'");
      if (!Number(has.n)) return;
      if (!(await commerceSettings.read(conn)).commerce_enabled) return; // nothing runs while Commerce is switched off
      await conn.beginTransaction();
      const r = await runJobs(conn, 'system');
      await conn.commit();
      if (r.expired.length || r.cashback.length) console.log(`promotions job: ${r.expired.length} wallet credit(s) expired, cashback worked out on ${r.cashback.length} order(s)`);
    } catch (e) {
      await conn.rollback().catch(() => {});
      console.error('promotions job failed:', e.message);
    } finally { conn.release(); }
  };
  timer = setInterval(tick, 3600e3);
  setTimeout(tick, 15e3);
}

module.exports = { KINDS, OFFER_KINDS, PromoError, applyOffers, offersOn, slabText, bxgyText, couponRow, evalCoupon, redeem, cashbackRule, goodsValue, creditCashback,
  cashbackDue, reverseCashback, manualWallet, runJobs, startJobs, STATUS_LABEL, ENT, shownStatus, belowCost, sendLive, stop, givesMore, GIVEN_SQL };
