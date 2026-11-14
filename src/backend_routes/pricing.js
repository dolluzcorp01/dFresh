// Prices (docs/COMMERCE-SPEC.md 4.3; phase 15 = v23 section 2), shared by the admin routes (prices.js), the order
// logic (commerce.js), the price Excel (price-excel.js) and the demo seed, so every change is the same change.
// - Price lists (price_lists): a name, who it is for, how its prices are typed (with or without GST), rounding, one
//   default list, active or archived. Each customer type uses one list (customer_types.list_key; NULL = the default
//   list); a customer may have its own (customers.price_list, through approval).
// - sku_prices holds one row per SKU, list and "effective from" date (India date), with the basis it was typed in
//   (switching a list keeps old rows as typed, v22). The price on a day is the row with the latest effective_from on
//   or before it. A pack a list does not price takes the default list's price (as before phase 15).
// - Quantity: a pack's own bands on a list (sku_bands) replace the list's slabs (list_slabs); the highest band or slab
//   reached prices the whole line. A customer's special price (special_prices) wins when it is lower.
// - guard(): the one price check (v23 "one price guard"): never above the MRP; never below the lowest allowed price
//   (skus.min_price, without GST); below the standard cost plus the margin floor (approval rule margin_floor) needs
//   approval. Lists, slabs, bands, bulk changes, the import, specials and order lines all use it.
// - Every change writes price_changes (old -> new, who, when, effective from, how) and an audit_log row.
const { audit } = require('./audit');
const tax = require('./tax');

const DEFAULT_LIST = 'default'; // the key of the list made default by the migration (the default flag may move)
const SELL_UNITS = { pack: 'Packs', carton: 'Cartons', both: 'Packs or cartons' };
const SOURCES = ['grid', 'bulk', 'import', 'seed', 'approval', 'basis', 'copy'];
const MAX_PRICE = 1000000;
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `Rs ${Number(n).toFixed(2)}`;

class PricingError extends Error {
  /** errors: { "SKU/list": message } for the grid, or null */
  constructor(message, status = 400, errors = null) { super(message); this.status = status; this.errors = errors; }
}

/** today in India, YYYY-MM-DD */
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const istToday = () => istDates.istToday();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const { ymd } = istDates;

/** a price typed by someone -> number with at most 2 decimals, null for empty, or a PricingError message */
function parsePrice(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { value: null };
  const s = String(raw).trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return { error: 'A price like 120 or 120.50 (2 decimals at most)' };
  const n = Number(s);
  if (n > MAX_PRICE) return { error: `At most Rs ${MAX_PRICE}` };
  return { value: round2(n) };
}

/** a price in `basis` -> without GST at `rate` (and back) */
const toEx = (price, basis, rate) => (basis === 'inc' ? price / (1 + rate / 100) : price);
const fromEx = (ex, basis, rate) => (basis === 'inc' ? round2(ex * (1 + rate / 100)) : round2(ex));
/** round a worked-out price to the list's rounding (1, 0.5 or 0 = paise) */
const roundTo = (n, step) => (Number(step) > 0 ? round2(Math.round(n / Number(step)) * Number(step)) : round2(n));

/**
 * the price lists, default first: { key, label, name, about, typed ('ex' | 'inc'), round_to, is_default, status,
 * is_active, types: [type_key] }
 */
async function lists(q) {
  const [rows] = await q.query('SELECT list_key, name, about, typed, round_to, is_default, status, sort_order FROM price_lists ORDER BY is_default DESC, sort_order, name');
  const [types] = await q.query('SELECT type_key, label, list_key FROM customer_types ORDER BY sort_order, label');
  return rows.map((r) => ({ key: r.list_key, label: r.name, name: r.name, about: r.about || '', typed: r.typed, round_to: Number(r.round_to), is_default: Number(r.is_default) === 1,
    status: r.status, is_active: r.status === 'active', types: types.filter((t) => t.list_key === r.list_key).map((t) => t.type_key) }));
}
async function defaultKey(q) {
  const [[r]] = await q.query('SELECT list_key FROM price_lists WHERE is_default = 1 LIMIT 1');
  return r ? r.list_key : DEFAULT_LIST;
}

/** price rows valid on `date` -> Map sku -> { list_key: { price, basis, from } } (price NULL = removed) */
async function rowsOn(q, date, skuCodes = null) {
  const params = [date];
  let only = '';
  if (skuCodes) {
    if (!skuCodes.length) return new Map();
    only = 'AND sku_code IN (?)';
    params.push(skuCodes);
  }
  const [rows] = await q.query(
    `SELECT p.sku_code, p.list_key, p.price, p.basis, p.effective_from FROM sku_prices p
       JOIN (SELECT sku_code, list_key, MAX(effective_from) AS ef FROM sku_prices WHERE effective_from <= ? ${only} GROUP BY sku_code, list_key) m
         ON m.sku_code = p.sku_code AND m.list_key = p.list_key AND m.ef = p.effective_from`, params);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.sku_code)) out.set(r.sku_code, {});
    out.get(r.sku_code)[r.list_key] = { price: r.price === null ? null : Number(r.price), basis: r.basis, from: ymd(r.effective_from) };
  }
  return out;
}

/** GST % of each SKU on `date` (from its product's HSN code) -> Map sku -> { hsn, rate (null = HSN not in the list) } */
async function skuTax(q, date, skuCodes = null) {
  const [rows] = await q.query(`SELECT s.sku_code, p.hsn_code FROM skus s JOIN products p ON p.product_id = s.product_id ${skuCodes ? 'WHERE s.sku_code IN (?)' : ''}`, skuCodes ? [skuCodes.length ? skuCodes : ['']] : []);
  const rates = await tax.ratesOn(q, date);
  return new Map(rows.map((r) => [r.sku_code, { hsn: r.hsn_code, rate: rates.has(r.hsn_code) ? rates.get(r.hsn_code) : null }]));
}

/**
 * own prices valid on `date`, each in its LIST's basis (a row typed in the other basis is converted at the GST rate
 * of that day) -> Map sku -> { list_key: price | null }
 */
async function ownPricesOn(q, date, skuCodes = null) {
  const rows = await rowsOn(q, date, skuCodes);
  const ls = new Map((await lists(q)).map((l) => [l.key, l]));
  const tx = await skuTax(q, date, skuCodes);
  const out = new Map();
  for (const [sku, per] of rows) {
    const o = {};
    for (const [k, r] of Object.entries(per)) {
      const l = ls.get(k);
      const rate = (tx.get(sku) || {}).rate || 0;
      o[k] = r.price === null ? null : !l || r.basis === l.typed ? r.price : fromEx(toEx(r.price, r.basis, rate), l.typed, rate);
    }
    out.set(sku, o);
  }
  return out;
}

/** changes dated after `date` (scheduled) -> Map sku -> [{ list_key, effective_from, price, basis }] */
async function upcoming(q, date) {
  const [rows] = await q.query('SELECT sku_code, list_key, effective_from, price, basis FROM sku_prices WHERE effective_from > ? ORDER BY effective_from', [date]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.sku_code)) out.set(r.sku_code, []);
    out.get(r.sku_code).push({ list_key: r.list_key, effective_from: ymd(r.effective_from), price: r.price === null ? null : Number(r.price), basis: r.basis });
  }
  return out;
}

/** the price for one list from a SKU's own prices -> { price, from: list key it came from | null } */
function resolve(own, listKey, defKey = DEFAULT_LIST) {
  const o = own || {};
  const v = (x) => (x && typeof x === 'object' ? x.price : x);
  if (listKey !== defKey && o[listKey] !== undefined && v(o[listKey]) !== null) return { price: v(o[listKey]), from: listKey };
  if (o[defKey] !== undefined && v(o[defKey]) !== null) return { price: v(o[defKey]), from: defKey };
  return { price: null, from: null };
}

/** the list of a customer type: its own list, else the default ({ key, label, why }) */
async function listForType(q, typeKey) {
  const ls = await lists(q);
  const def = ls.find((l) => l.is_default) || ls[0];
  const [[t]] = await q.query('SELECT label, list_key FROM customer_types WHERE type_key = ?', [typeKey || '']);
  const own = t && t.list_key ? ls.find((l) => l.key === t.list_key && l.is_active) : null;
  const typeLabel = t ? t.label : typeKey;
  if (own) return { key: own.key, label: own.name, list: own, def, why: `${own.name} (for ${typeLabel})` };
  return { key: def.key, label: def.name, list: def, def, why: `${def.name} (default: ${typeLabel || 'this type'} has no list of its own)` };
}

/** the price list of a customer: its own one (through approval), else its customer type's, else the default */
async function listOfCustomer(q, customerId) {
  const [[c]] = await q.query('SELECT c.price_list, c.type_key FROM customers c WHERE c.customer_id = ? LIMIT 1', [customerId]);
  if (c && c.price_list) {
    const ls = await lists(q);
    const own = ls.find((l) => l.key === c.price_list);
    const def = ls.find((l) => l.is_default) || ls[0];
    if (own) return { key: own.key, label: own.name, own: true, list: own, def, why: `${own.name} (this customer's own list)` };
  }
  return { ...(await listForType(q, c ? c.type_key : null)), own: false };
}

/** quantity rules of a SKU for `qty` packs -> a message, or null when fine */
function qtyProblem(sku, qty) {
  const ppc = Number(sku.packs_per_carton) || 1;
  const min = Number(sku.min_order_qty) || 1;
  if (qty < min) return `${sku.sku_code}: the minimum order is ${min} pack${min === 1 ? '' : 's'} (${qty} entered)`;
  if (sku.sell_unit === 'carton' && ppc > 1 && qty % ppc !== 0) {
    const lo = Math.floor(qty / ppc) * ppc;
    const hi = lo + ppc;
    return `${sku.sku_code}: sold in full cartons of ${ppc} packs - ${qty} packs is not a whole number of cartons (${lo ? `${lo} or ` : ''}${hi})`;
  }
  const step = Number(sku.step_qty) || 1; // phase 14: "in steps of" on the SKU
  if (step > 1 && qty % step !== 0) return `${sku.sku_code}: ordered in steps of ${step} packs - ${qty} is not a multiple of ${step}`;
  return null;
}

// ---------------------------------------------------------------- slabs, bands, the margin floor
async function slabsOf(q, listKey) {
  const [rows] = await q.query('SELECT min_qty, pct FROM list_slabs WHERE list_key = ? ORDER BY min_qty', [listKey]);
  return rows.map((r) => ({ min: Number(r.min_qty), pct: Number(r.pct) }));
}
async function bandsOf(q, listKey, sku) {
  const [rows] = await q.query('SELECT min_qty, price FROM sku_bands WHERE list_key = ? AND sku_code = ? ORDER BY min_qty', [listKey, sku]);
  return rows.map((r) => ({ min: Number(r.min_qty), price: Number(r.price) }));
}
/** the margin floor rule -> { on, pct } (Admin > Approval rules "Price below cost plus the margin floor") */
async function marginRule(q) {
  const [[r]] = await q.query("SELECT is_on, limit_value FROM approval_rules WHERE kind = 'margin_floor'");
  return { on: Boolean(r && Number(r.is_on) === 1), pct: r && r.limit_value !== null ? Number(r.limit_value) : 10 };
}
/** cost plus the margin floor (without GST), or null when the rule is off or the pack has no standard cost */
const marginNeed = (cost, rule) => (rule.on && cost !== null && cost !== undefined && Number(cost) > 0 ? round2(Number(cost) * (1 + rule.pct / 100)) : null);

/** the facts of a pack the guard needs -> { sku_code, mrp, min_price, std_cost, hsn, sku_type, status, product_status } */
async function packFacts(q, sku) {
  const [[s]] = await q.query(
    `SELECT s.sku_code, s.mrp, s.min_price, s.std_cost, s.sku_type, s.status, s.is_active, p.hsn_code, p.status AS product_status
       FROM skus s LEFT JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?`, [sku]);
  if (!s) return null;
  return { ...s, mrp: s.mrp === null ? null : Number(s.mrp), min_price: s.min_price === null ? null : Number(s.min_price), std_cost: s.std_cost === null ? null : Number(s.std_cost) };
}

/**
 * The one price guard for a price per pack WITHOUT GST on `date`. facts from packFacts; rule from marginRule; floor
 * overrides the pack's lowest allowed price (a lowered floor is checked as the OLD one until signed, PR1).
 * -> { mrp: '' | message, floor: '' | message, margin: '' | message, need, inc, rate }
 */
async function guard(q, facts, ex, date, { rule = null, floor = undefined } = {}) {
  const rate = await tax.rateOn(q, facts.hsn_code, date);
  const r = rule || await marginRule(q);
  const fl = floor === undefined ? facts.min_price : floor;
  const out = { mrp: '', floor: '', margin: '', need: marginNeed(facts.std_cost, r), rate, inc: rate === null ? null : round2(ex * (1 + rate / 100)) };
  if (rate === null) { out.mrp = `HSN ${facts.hsn_code} is not in the HSN list, so GST is unknown.`; return out; }
  if (facts.mrp !== null && out.inc > facts.mrp + 0.004) out.mrp = `Above the MRP: ${money(out.inc)} with GST, MRP is ${money(facts.mrp)}. Nobody may be charged more than MRP.`;
  if (fl !== null && fl !== undefined && round2(ex) < fl - 0.004) out.floor = `Below the lowest allowed price (${money(fl)} without GST).`;
  if (out.need !== null && round2(ex) < out.need - 0.004) out.margin = `Below cost plus the margin floor (${money(out.need)} without GST).`;
  return out;
}

/**
 * The price for a customer (or a customer type) of `qty` packs of a SKU on `date`, step by step (v23 "Check a price").
 * who = { customerId } | { typeKey }; pos = place of supply state code (optional, for the tax split)
 * -> { list, typed, listPrice (typed), listEx, ex, inc, rate, hsn, steps: [{ t, d }], warn: [], special, band, slab }
 */
async function quote(q, { customerId = null, typeKey = null, sku, qty = 1, date = null, pos = null, sellerState = '33', seeCost = false }) {
  const day = date || istToday();
  const list = customerId ? await listOfCustomer(q, customerId) : await listForType(q, typeKey);
  const facts = await packFacts(q, sku);
  if (!facts) throw new PricingError(`No pack ${sku}`, 404);
  const steps = [{ t: 'Price list', d: list.why }];
  const out = { list: { key: list.key, name: list.label }, typed: list.list.typed, steps, warn: [], ex: null, inc: null, rate: null, hsn: facts.hsn_code };
  const rate = await tax.rateOn(q, facts.hsn_code, day);
  out.rate = rate;
  if (rate === null) { steps.push({ t: 'GST', d: `HSN ${facts.hsn_code} is not in the HSN list, so GST is unknown. Add it in HSN and GST rates.` }); return out; }
  const rows = (await rowsOn(q, day, [sku])).get(sku) || {};
  let row = rows[list.key] && rows[list.key].price !== null ? rows[list.key] : null;
  let from = list.key;
  if (!row && list.key !== list.def.key && rows[list.def.key] && rows[list.def.key].price !== null) { row = rows[list.def.key]; from = list.def.key; }
  if (!row) { steps.push({ t: `List price on ${day}`, d: `${sku} has no price in ${list.label} on ${day}. It cannot be sold to this customer.` }); return out; }
  const typed = list.list.typed;
  const listTyped = fromEx(toEx(row.price, row.basis, rate), typed, rate);
  const lab = (n) => `${money(n)} ${typed === 'inc' ? 'with' : 'without'} GST`;
  steps.push({ t: `List price on ${day}`, d: `${lab(listTyped)} (from ${row.from}${from !== list.key ? `, the ${list.def.name} list's price: ${list.label} has none for this pack` : ''})` });
  out.listPrice = listTyped;
  out.listEx = round2(toEx(listTyped, typed, rate));
  let unitTyped = listTyped;
  const bands = await bandsOf(q, list.key, sku);
  if (bands.length) {
    const b = [...bands].reverse().find((x) => qty >= x.min);
    if (b) { unitTyped = b.price; out.band = b; steps.push({ t: 'Quantity price for this pack', d: `${qty} packs reach the ${b.min}+ band: ${lab(b.price)}` }); } else steps.push({ t: 'Quantity price for this pack', d: 'Below the first band; list price stays' });
  } else {
    const slabs = await slabsOf(q, list.key);
    const s = [...slabs].reverse().find((x) => qty >= x.min);
    if (s) { unitTyped = roundTo(listTyped * (1 - s.pct / 100), list.list.round_to); out.slab = s; steps.push({ t: 'Quantity slab', d: `${qty} packs reach ${s.min}+: ${s.pct}% off${list.list.round_to ? `, rounded to ${list.list.round_to === 1 ? 'Rs 1' : '50 paise'}` : ''} = ${lab(unitTyped)}` }); } else if (slabs.length) steps.push({ t: 'Quantity slab', d: `Below ${slabs[0].min} packs: no slab` });
  }
  let ex = round2(toEx(unitTyped, typed, rate));
  if (customerId) {
    const [[sp]] = await q.query(
      `SELECT sp_no, price, c.name FROM special_prices sp JOIN customers c ON c.customer_id = sp.customer_id
        WHERE sp.customer_id = ? AND sp.sku_code = ? AND sp.status = 'active' AND sp.valid_from <= ? AND (sp.valid_to IS NULL OR sp.valid_to >= ?) ORDER BY sp.price LIMIT 1`, [customerId, sku, day, day]);
    if (sp) {
      const spp = Number(sp.price);
      if (spp < ex - 0.004) { ex = spp; out.special = sp.sp_no; steps.push({ t: 'Special price', d: `${sp.sp_no} for ${sp.name}: ${money(spp)} without GST (lower, so it wins)` }); } else steps.push({ t: 'Special price', d: `${sp.sp_no} is ${money(spp)}, not lower than ${money(ex)}; the lower price stays` });
    }
  }
  out.ex = ex;
  out.inc = round2(ex * (1 + rate / 100));
  steps.push({ t: 'GST', d: `HSN ${facts.hsn_code} is ${rate}% on ${day}: ${money(ex)} + ${money(out.inc - ex)} = ${money(out.inc)}` });
  if (pos) {
    const half = round2((out.inc - ex) / 2);
    steps.push({ t: 'Tax on the invoice, per pack', d: String(pos) === String(sellerState)
      ? `CGST ${rate / 2}% ${money(half)} + SGST ${rate / 2}% ${money(half)} (same state)`
      : `IGST ${rate}% ${money(out.inc - ex)} (another state)` });
  }
  const g = await guard(q, facts, ex, day);
  if (g.floor) out.warn.push({ kind: 'floor', t: 'Below the lowest allowed price.', d: 'This pack must not be sold at this price.' });
  if (g.mrp) out.warn.push({ kind: 'mrp', t: `Above the MRP (${money(facts.mrp)}).`, d: 'Nobody may be charged more than the MRP printed on the pack.' });
  if (seeCost && facts.std_cost !== null && ex < facts.std_cost - 0.004) out.warn.push({ kind: 'cost', t: 'Below the standard cost.', d: 'Each pack sells for less than it costs (seen by Super admin, Admin and Sub-admin only).' });
  return out;
}

/**
 * The top slab check (v22 PR1) of a base price typed on a list for a pack without its own bands
 * -> { hard: '' | message, soft: '' | message }
 */
async function topSlabCheck(q, facts, list, typedPrice, date, { rule = null, floor = undefined, slabs = null } = {}) {
  const sl = slabs || await slabsOf(q, list.key);
  if (!sl.length) return { hard: '', soft: '' };
  const top = sl[sl.length - 1];
  const rate = await tax.rateOn(q, facts.hsn_code, date);
  if (rate === null) return { hard: '', soft: '' };
  const sx = round2(toEx(roundTo(typedPrice * (1 - top.pct / 100), list.round_to), list.typed, rate));
  const g = await guard(q, facts, sx, date, { rule, floor });
  if (g.floor) return { hard: `At ${top.min}+ packs (${top.pct}% slab) this becomes ${money(sx)} without GST, below the lowest allowed ${money(floor === undefined ? facts.min_price : floor)}. Raise the price, or set quantity bands for this pack.`, soft: '' };
  if (g.margin) return { hard: '', soft: `At ${top.min}+ packs it is ${money(sx)}, below cost plus margin ${money(g.need)}.` };
  return { hard: '', soft: '' };
}

/**
 * Check list prices. changes = [{ sku_code, list_key, price (typed in the list's basis) }], eff = start date.
 * -> Map id -> { sku_code, list_key, price, basis, hard: '' | message, soft: '' | message }
 */
async function checkPrices(q, changes, eff, { floors = {} } = {}) {
  const ls = new Map((await lists(q)).map((l) => [l.key, l]));
  const rule = await marginRule(q);
  const out = new Map();
  for (const c of changes) {
    const sku = String(c.sku_code || '').trim().toUpperCase();
    const list = ls.get(String(c.list_key || '').trim());
    const id = `${sku}/${c.list_key}`;
    const res = { sku_code: sku, list_key: c.list_key, price: null, basis: list ? list.typed : 'ex', hard: '', soft: '' };
    out.set(id, res);
    if (!list) { res.hard = `No price list ${c.list_key}`; continue; }
    const facts = await packFacts(q, sku);
    if (!facts) { res.hard = 'no pack with this SKU.'; continue; }
    const p = parsePrice(c.price);
    if (p.error || p.value === null || p.value <= 0) { res.hard = 'A price more than 0, with at most 2 decimals.'; continue; }
    res.price = p.value;
    if (facts.sku_type === 'raw') { res.hard = 'A raw material is never on a price list'; continue; }
    if (facts.product_status === 'draft') { res.hard = 'A Draft product is not priced on a list: make it active first'; continue; }
    const rate = await tax.rateOn(q, facts.hsn_code, eff);
    if (rate === null) { res.hard = `HSN ${facts.hsn_code} is not in the HSN list, so GST is unknown.`; continue; }
    const floor = Object.prototype.hasOwnProperty.call(floors, sku) ? floors[sku] : undefined;
    const g = await guard(q, facts, toEx(p.value, list.typed, rate), eff, { rule, floor });
    if (g.mrp) { res.hard = g.mrp; continue; }
    if (g.floor) { res.hard = g.floor; continue; }
    if (!(await bandsOf(q, list.key, sku)).length) {
      const t = await topSlabCheck(q, facts, list, p.value, eff, { rule, floor });
      if (t.hard) { res.hard = t.hard; continue; }
      if (g.margin) res.soft = `${g.margin}${t.soft ? ` ${t.soft}` : ''}`;
      else if (t.soft) res.soft = t.soft;
    } else if (g.margin) res.soft = g.margin;
  }
  return out;
}

/**
 * Save price changes that passed checkPrices (no soft problem left, or approved). changes = [{ sku_code, list_key,
 * price, basis? }]. opts = { effective (YYYY-MM-DD, default today), source, empId, allowPast (seed only) }.
 * -> { changed: [{ sku_code, list_key, old_price, new_price, effective_from }], skipped }
 */
async function setPrices(q, changes, { effective = null, source, empId, allowPast = false, checked = false }) {
  if (!SOURCES.includes(source)) throw new Error(`unknown price source ${source}`);
  const today = istToday();
  const eff = effective || today;
  if (!isDate(eff)) throw new PricingError('Effective from: a date like 2026-11-01');
  if (!allowPast && eff < today) throw new PricingError('Cannot start in the past. Quotes and orders already made keep their price.');
  if (!Array.isArray(changes) || !changes.length) throw new PricingError('Nothing to save');
  if (changes.length > 5000) throw new PricingError('At most 5000 prices at once');
  const ls = new Map((await lists(q)).map((l) => [l.key, l]));
  if (!checked) {
    const res = await checkPrices(q, changes, eff);
    const errors = {};
    for (const [id, r] of res) if (r.hard || r.soft) errors[id] = r.hard || r.soft;
    const n = Object.keys(errors).length;
    if (n) throw new PricingError(`${n} price${n === 1 ? '' : 's'} could not be saved: ${Object.entries(errors).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' | ')}`, 400, errors);
  }
  const skuCodes = [...new Set(changes.map((c) => String(c.sku_code).toUpperCase()))];
  await q.query('SELECT sku_code FROM skus WHERE sku_code IN (?) FOR UPDATE', [skuCodes]);
  const rows = await rowsOn(q, eff, skuCodes);
  const changed = [];
  let skipped = 0;
  for (const c0 of changes) {
    const c = { ...c0, sku_code: String(c0.sku_code).toUpperCase() };
    const list = ls.get(c.list_key);
    const basis = c.basis || (list ? list.typed : 'ex');
    const before = (rows.get(c.sku_code) || {})[c.list_key];
    const old = before ? before.price : null;
    if (before && old === Number(c.price) && before.basis === basis) { skipped += 1; continue; }
    await q.query(
      `INSERT INTO sku_prices (sku_code, list_key, effective_from, price, basis, created_by) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price = VALUES(price), basis = VALUES(basis), created_by = VALUES(created_by), created_at = UTC_TIMESTAMP()`,
      [c.sku_code, c.list_key, eff, c.price, basis, empId]);
    await q.query('INSERT INTO price_changes (sku_code, list_key, old_price, new_price, basis, effective_from, source, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [c.sku_code, c.list_key, old, c.price, basis, eff, source, empId]);
    await audit(q, { empId, action: 'update', entity: 'sku_price', entityId: `${c.sku_code}/${c.list_key}`, before: { price: old, effective_from: eff }, after: { price: c.price, typed: basis === 'inc' ? 'with GST' : 'without GST', effective_from: eff, source } });
    changed.push({ sku_code: c.sku_code, list_key: c.list_key, old_price: old, new_price: Number(c.price), effective_from: eff });
  }
  return { changed, skipped };
}

/** SKU selling fields check -> { values, errors } */
function checkSkuFields(raw) {
  const values = {};
  const errors = {};
  const int = (k, label, lo, hi) => {
    if (!(k in raw)) return;
    const s = String(raw[k] ?? '').trim();
    if (!/^\d{1,6}$/.test(s) || Number(s) < lo || Number(s) > hi) errors[k] = `${label}: a whole number from ${lo} to ${hi}`;
    else values[k] = Number(s);
  };
  int('packs_per_carton', 'Packs per carton', 1, 10000);
  int('min_order_qty', 'Minimum order (packs)', 1, 100000);
  if ('sell_unit' in raw) {
    const u = String(raw.sell_unit ?? '').trim().toLowerCase();
    if (!SELL_UNITS[u]) errors.sell_unit = 'Sell in: pack, carton or both';
    else values.sell_unit = u;
  }
  return { values, errors };
}

/** every SKU with its product's name, category, HSN and today's GST rate (lists, Excel, bulk, order form) */
async function skuRows(q) {
  const [rows] = await q.query(
    `SELECT s.sku_code, s.product_id, s.size_label, s.packs_per_carton, s.min_order_qty, s.sell_unit, s.is_active, s.status, s.sku_type,
            s.mrp, s.min_price, s.std_cost, p.status AS product_status,
            p.category_key, p.hsn_code, p.gst_rate, p.track_batches, COALESCE(t.name, pt.name, s.product_id) AS name,
            COALESCE(ct.name, p.category_key) AS category
       FROM skus s JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN categories c ON c.category_key = p.category_key
       LEFT JOIN category_translations ct ON ct.category_key = p.category_key AND ct.lang_code = 'en'
      WHERE s.sku_type <> 'raw'
      ORDER BY c.sort_order, p.sort_order, s.sku_code`
  );
  return rows.map((r) => ({ ...r, gst_rate: Number(r.gst_rate), packs_per_carton: Number(r.packs_per_carton), min_order_qty: Number(r.min_order_qty), is_active: Number(r.is_active) === 1,
    track_batches: Number(r.track_batches) === 1, mrp: r.mrp === null ? null : Number(r.mrp), min_price: r.min_price === null ? null : Number(r.min_price), std_cost: r.std_cost === null ? null : Number(r.std_cost) }));
}

/** save a SKU's selling fields (checked values from checkSkuFields), audited -> true when something changed */
async function updateSku(q, skuCode, values, empId, source = 'grid') {
  const [[before]] = await q.query('SELECT sku_code, packs_per_carton, min_order_qty, sell_unit FROM skus WHERE sku_code = ? FOR UPDATE', [skuCode]);
  if (!before) throw new PricingError(`No SKU ${skuCode}`, 404);
  const set = Object.fromEntries(Object.entries(values).filter(([k, v]) => String(before[k]) !== String(v)));
  if (!Object.keys(set).length) return false;
  await q.query(`UPDATE skus SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE sku_code = ?`,
    [...Object.values(set), empId, skuCode]);
  // phase 14: a carton size change applies to cartons arriving from today (sku_cartons keeps the history)
  if ('packs_per_carton' in set) await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE packs = VALUES(packs), created_by = VALUES(created_by)', [skuCode, istToday(), set.packs_per_carton, empId]);
  await audit(q, { empId, action: 'update', entity: 'sku', entityId: skuCode, before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k]])), after: { ...set, source } });
  return true;
}

/** the basis line of a list ("Typed without GST (GST is added on the invoice)") */
const basisOf = (typed) => {
  const inclusive = typed === 'inc';
  return { inclusive, label: inclusive ? 'Prices are typed with GST (GST is inside the price)' : 'Prices are typed without GST (GST is added on the invoice)', short: inclusive ? 'incl. GST' : 'excl. GST' };
};
/** the basis of the default list (screens that show one line for every list) */
async function basis(q) {
  const ls = await lists(q);
  return basisOf((ls.find((l) => l.is_default) || ls[0] || { typed: 'ex' }).typed);
}

module.exports = {
  DEFAULT_LIST, SELL_UNITS, PricingError, istToday, isDate, parsePrice, lists, defaultKey, rowsOn, skuTax, ownPricesOn, upcoming, resolve,
  listForType, listOfCustomer, qtyProblem, slabsOf, bandsOf, marginRule, marginNeed, packFacts, guard, quote, topSlabCheck, checkPrices, setPrices,
  checkSkuFields, basis, basisOf, round2, roundTo, toEx, fromEx, money, ymd, skuRows, updateSku,
};
