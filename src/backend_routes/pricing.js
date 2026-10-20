// Prices (docs/COMMERCE-SPEC.md 4.3; migration 20261020_commerce_pricing.sql), shared by the admin routes, the
// order logic (commerce.js), the price Excel (price-excel.js) and the demo seed, so every change is the same change.
// - Price lists: 'default' plus one per customer type (Commerce settings > Customer types).
// - sku_prices holds one row per SKU, list and "effective from" date (India date). The price on a day is the row with
//   the latest effective_from on or before it. A customer type's list without its own price (no row, or a row with
//   price NULL = removed) uses the Default list's price. The Default list never loses its price.
// - Every change writes price_changes (old -> new, who, when, effective from, how) and an audit_log row.
// - Whether the prices include GST is the Commerce setting prices_include_gst (shown on every price screen).
const { audit } = require('./audit');
const commerceSettings = require('./commerce-settings');

const DEFAULT_LIST = 'default';
const SELL_UNITS = { pack: 'Packs', carton: 'Cartons', both: 'Packs or cartons' };
const SOURCES = ['grid', 'bulk', 'import', 'seed'];
const MAX_PRICE = 1000000;
const round2 = (n) => Math.round(n * 100) / 100;

class PricingError extends Error {
  /** errors: { "SKU/list": message } for the grid, or null */
  constructor(message, status = 400, errors = null) { super(message); this.status = status; this.errors = errors; }
}

/** today in India, YYYY-MM-DD */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** a price typed by someone -> number with at most 2 decimals, null for empty, or a PricingError message */
function parsePrice(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { value: null };
  const s = String(raw).trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return { error: 'A price like 120 or 120.50 (2 decimals at most)' };
  const n = Number(s);
  if (n > MAX_PRICE) return { error: `At most Rs ${MAX_PRICE}` };
  return { value: round2(n) };
}

/** the price lists: Default first, then the customer types in their order (inactive ones too: their prices stay) */
async function lists(q) {
  const [types] = await q.query('SELECT type_key, label, is_active FROM customer_types ORDER BY sort_order, label');
  return [{ key: DEFAULT_LIST, label: 'Default', is_active: true }, ...types.filter((t) => t.type_key !== DEFAULT_LIST).map((t) => ({ key: t.type_key, label: t.label, is_active: Number(t.is_active) === 1 }))];
}

/** GST rates offered (Commerce setting gst_rates) */
function gstRates(settings) {
  return String(settings.gst_rates || '0, 5, 12, 18').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0 && x <= 40);
}

/** own prices valid on `date` -> Map sku -> { list_key: price | null } (only lists with a row) */
async function ownPricesOn(q, date, skuCodes = null) {
  const params = [date];
  let only = '';
  if (skuCodes) {
    if (!skuCodes.length) return new Map();
    only = 'AND sku_code IN (?)';
    params.push(skuCodes);
  }
  const [rows] = await q.query(
    `SELECT p.sku_code, p.list_key, p.price FROM sku_prices p
       JOIN (SELECT sku_code, list_key, MAX(effective_from) AS ef FROM sku_prices WHERE effective_from <= ? ${only} GROUP BY sku_code, list_key) m
         ON m.sku_code = p.sku_code AND m.list_key = p.list_key AND m.ef = p.effective_from`, params
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.sku_code)) out.set(r.sku_code, {});
    out.get(r.sku_code)[r.list_key] = r.price === null ? null : Number(r.price);
  }
  return out;
}

/** changes dated after `date` (scheduled) -> Map sku -> [{ list_key, effective_from, price }] */
async function upcoming(q, date) {
  const [rows] = await q.query('SELECT sku_code, list_key, effective_from, price FROM sku_prices WHERE effective_from > ? ORDER BY effective_from', [date]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.sku_code)) out.set(r.sku_code, []);
    out.get(r.sku_code).push({ list_key: r.list_key, effective_from: ymd(r.effective_from), price: r.price === null ? null : Number(r.price) });
  }
  return out;
}

/** the price for one list from a SKU's own prices -> { price, from: list key it came from | null } */
function resolve(own, listKey) {
  const o = own || {};
  if (listKey !== DEFAULT_LIST && o[listKey] !== undefined && o[listKey] !== null) return { price: o[listKey], from: listKey };
  if (o[DEFAULT_LIST] !== undefined && o[DEFAULT_LIST] !== null) return { price: o[DEFAULT_LIST], from: DEFAULT_LIST };
  return { price: null, from: null };
}

/** the price list of a customer: their customer type (key or name), else Default */
async function listOfCustomer(q, customerId) {
  const [[r]] = await q.query(
    `SELECT ct.type_key, ct.label FROM customers c
       LEFT JOIN customer_types ct ON ct.type_key = LOWER(c.ctype) OR ct.label = c.ctype
      WHERE c.customer_id = ? LIMIT 1`, [customerId]
  );
  return r && r.type_key ? { key: r.type_key, label: r.label } : { key: DEFAULT_LIST, label: 'Default' };
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
  return null;
}

/**
 * Save price changes. changes = [{ sku_code, list_key, price (number | null = remove own price) }].
 * opts = { effective (YYYY-MM-DD, default today), source, empId, allowPast (seed only) }.
 * Checks everything first and throws one PricingError with every problem; unchanged prices are skipped.
 * -> { changed: [{ sku_code, list_key, old_price, new_price, effective_from }], skipped }
 */
async function setPrices(q, changes, { effective = null, source, empId, allowPast = false }) {
  if (!SOURCES.includes(source)) throw new Error(`unknown price source ${source}`);
  const today = istToday();
  const eff = effective || today;
  if (!isDate(eff)) throw new PricingError('Effective from: a date like 2026-11-01');
  if (!allowPast && eff < today) throw new PricingError(`Effective from cannot be before today (${today}): orders already taken keep their prices anyway`);
  if (!Array.isArray(changes) || !changes.length) throw new PricingError('Nothing to save');
  if (changes.length > 5000) throw new PricingError('At most 5000 prices at once');
  const listKeys = new Set((await lists(q)).map((l) => l.key));
  const skuCodes = [...new Set(changes.map((c) => String(c.sku_code || '').trim().toUpperCase()))];
  const [known] = await q.query('SELECT sku_code FROM skus WHERE sku_code IN (?) FOR UPDATE', [skuCodes.length ? skuCodes : ['']]);
  const knownSet = new Set(known.map((k) => k.sku_code));
  const own = await ownPricesOn(q, eff, skuCodes);
  const errors = {};
  const clean = new Map();
  for (const c of changes) {
    const sku = String(c.sku_code || '').trim().toUpperCase();
    const list = String(c.list_key || '').trim();
    const id = `${sku}/${list}`;
    if (!knownSet.has(sku)) { errors[id] = `No SKU ${sku}`; continue; }
    if (!listKeys.has(list)) { errors[id] = `No price list ${list}`; continue; }
    const p = parsePrice(c.price);
    if (p.error) { errors[id] = p.error; continue; }
    if (p.value === null && list === DEFAULT_LIST) { errors[id] = 'The Default price cannot be empty: every other list falls back to it'; continue; }
    clean.set(id, { sku_code: sku, list_key: list, price: p.value });
  }
  // a customer type's list with no own price and no Default price either would leave the SKU unpriced
  for (const c of clean.values()) {
    if (c.list_key === DEFAULT_LIST || c.price !== null) continue;
    const def = clean.get(`${c.sku_code}/${DEFAULT_LIST}`);
    const defPrice = def ? def.price : resolve(own.get(c.sku_code), DEFAULT_LIST).price;
    if (defPrice === null) errors[`${c.sku_code}/${c.list_key}`] = 'Give the Default list a price first: an empty price uses the Default one';
  }
  const n = Object.keys(errors).length;
  if (n) throw new PricingError(`${n} price${n === 1 ? '' : 's'} could not be saved: ${Object.entries(errors).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' | ')}`, 400, errors);

  const changed = [];
  let skipped = 0;
  for (const c of clean.values()) {
    const before = (own.get(c.sku_code) || {})[c.list_key];
    const old = before === undefined ? null : before;
    if (old === c.price) { skipped += 1; continue; }
    await q.query(
      `INSERT INTO sku_prices (sku_code, list_key, effective_from, price, created_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price = VALUES(price), created_by = VALUES(created_by), created_at = UTC_TIMESTAMP()`,
      [c.sku_code, c.list_key, eff, c.price, empId]
    );
    await q.query('INSERT INTO price_changes (sku_code, list_key, old_price, new_price, effective_from, source, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [c.sku_code, c.list_key, old, c.price, eff, source, empId]);
    await audit(q, { empId, action: 'update', entity: 'sku_price', entityId: `${c.sku_code}/${c.list_key}`, before: { price: old, effective_from: eff }, after: { price: c.price, effective_from: eff, source } });
    changed.push({ sku_code: c.sku_code, list_key: c.list_key, old_price: old, new_price: c.price, effective_from: eff });
  }
  return { changed, skipped };
}

const ROUNDINGS = { '1': 1, '0.5': 0.5, '0.01': 0.01 };
/**
 * Bulk change plan: every own price on the chosen list(s) and category, moved by a percent or an amount.
 * b = { list_key ('all' | key), category_key ('' = all), mode ('pct' | 'amount'), value, rounding ('1' | '0.5' | '0.01'), effective }
 * -> { rows: [{ sku_code, name, size_label, list_key, old_price, new_price }], effective }
 */
async function bulkPlan(q, b) {
  const listsAll = await lists(q);
  const listKey = String(b.list_key || '');
  if (listKey !== 'all' && !listsAll.some((l) => l.key === listKey)) throw new PricingError('Choose a price list (or all lists)');
  const mode = b.mode === 'amount' ? 'amount' : b.mode === 'pct' ? 'pct' : null;
  if (!mode) throw new PricingError('Choose percent or rupees');
  const value = Number(String(b.value ?? '').trim());
  if (!String(b.value ?? '').trim() || !Number.isFinite(value) || value === 0) throw new PricingError(mode === 'pct' ? 'Percent: e.g. 5 or -3' : 'Rupees: e.g. 2 or -1.50');
  if (mode === 'pct' && (value < -90 || value > 500)) throw new PricingError('Percent: from -90 to 500');
  const step = ROUNDINGS[String(b.rounding || '1')];
  if (!step) throw new PricingError('Rounding: 1, 0.50 or 0.01');
  const eff = b.effective || istToday();
  if (!isDate(eff) || eff < istToday()) throw new PricingError(`Effective from: today (${istToday()}) or later`);
  const cat = String(b.category_key || '');
  const [skus] = await q.query(
    `SELECT s.sku_code, s.size_label, COALESCE(t.name, pt.name, s.product_id) AS name, p.category_key
       FROM skus s JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
      WHERE s.is_active = 1 ${cat ? 'AND p.category_key = ?' : ''} ORDER BY s.sku_code`, cat ? [cat] : []
  );
  const own = await ownPricesOn(q, eff, skus.map((s) => s.sku_code));
  const keys = listKey === 'all' ? listsAll.map((l) => l.key) : [listKey];
  const rows = [];
  for (const s of skus) {
    for (const k of keys) {
      const old = (own.get(s.sku_code) || {})[k];
      if (old === undefined || old === null) continue; // only own prices move; a list using Default follows it
      const raw = mode === 'pct' ? old * (1 + value / 100) : old + value;
      const next = round2(Math.round(raw / step) * step);
      if (next === old) continue;
      if (next < 0) throw new PricingError(`${s.sku_code} on ${k}: Rs ${old} would go below 0`);
      rows.push({ sku_code: s.sku_code, name: s.name, size_label: s.size_label, category_key: s.category_key, list_key: k, old_price: old, new_price: next });
    }
  }
  return { rows, effective: eff };
}

/** product HSN / GST rate check -> { values, errors } */
function checkTax(raw, rates) {
  const values = {};
  const errors = {};
  if ('hsn_code' in raw) {
    const h = String(raw.hsn_code ?? '').trim();
    if (!/^(\d{4}|\d{6}|\d{8})$/.test(h)) errors.hsn_code = 'HSN: 4, 6 or 8 digits (e.g. 4818 or 48182000)';
    else values.hsn_code = h;
  }
  if ('gst_rate' in raw) {
    const g = Number(String(raw.gst_rate ?? '').trim());
    if (String(raw.gst_rate ?? '').trim() === '' || !rates.includes(g)) errors.gst_rate = `GST rate: one of ${rates.join(', ')} %`;
    else values.gst_rate = g;
  }
  return { values, errors };
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

/** every SKU with its product's name, category, HSN and GST rate (grid, Excel, bulk) */
async function skuRows(q) {
  const [rows] = await q.query(
    `SELECT s.sku_code, s.product_id, s.size_label, s.packs_per_carton, s.min_order_qty, s.sell_unit, s.is_active,
            p.category_key, p.hsn_code, p.gst_rate, COALESCE(t.name, pt.name, s.product_id) AS name,
            COALESCE(ct.name, p.category_key) AS category
       FROM skus s JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN categories c ON c.category_key = p.category_key
       LEFT JOIN category_translations ct ON ct.category_key = p.category_key AND ct.lang_code = 'en'
      ORDER BY c.sort_order, p.sort_order, s.sku_code`
  );
  return rows.map((r) => ({ ...r, gst_rate: Number(r.gst_rate), packs_per_carton: Number(r.packs_per_carton), min_order_qty: Number(r.min_order_qty), is_active: Number(r.is_active) === 1 }));
}

/** save a SKU's selling fields (checked values from checkSkuFields), audited -> true when something changed */
async function updateSku(q, skuCode, values, empId, source = 'grid') {
  const [[before]] = await q.query('SELECT sku_code, packs_per_carton, min_order_qty, sell_unit FROM skus WHERE sku_code = ? FOR UPDATE', [skuCode]);
  if (!before) throw new PricingError(`No SKU ${skuCode}`, 404);
  const set = Object.fromEntries(Object.entries(values).filter(([k, v]) => String(before[k]) !== String(v)));
  if (!Object.keys(set).length) return false;
  await q.query(`UPDATE skus SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE sku_code = ?`,
    [...Object.values(set), empId, skuCode]);
  await audit(q, { empId, action: 'update', entity: 'sku', entityId: skuCode, before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k]])), after: { ...set, source } });
  return true;
}

/** save a product's HSN / GST rate (checked values from checkTax), audited -> true when something changed */
async function updateProductTax(q, productId, values, empId, source = 'grid') {
  const [[before]] = await q.query('SELECT product_id, hsn_code, gst_rate FROM products WHERE product_id = ? FOR UPDATE', [productId]);
  if (!before) throw new PricingError(`No product ${productId}`, 404);
  const set = Object.fromEntries(Object.entries(values).filter(([k, v]) => (k === 'gst_rate' ? Number(before[k]) !== Number(v) : String(before[k]) !== String(v))));
  if (!Object.keys(set).length) return false;
  await q.query(`UPDATE products SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE product_id = ?`, [...Object.values(set), productId]);
  await audit(q, { empId, action: 'update', entity: 'product_tax', entityId: productId, before: Object.fromEntries(Object.keys(set).map((k) => [k, k === 'gst_rate' ? Number(before[k]) : before[k]])), after: { ...set, source } });
  return true;
}

/** the price basis line every price screen shows */
async function basis(q) {
  const s = await commerceSettings.read(q);
  const inclusive = s.prices_include_gst === 'inclusive';
  return { inclusive, label: inclusive ? 'Prices include GST' : 'Prices exclude GST (GST is added on the invoice)', short: inclusive ? 'incl. GST' : 'excl. GST' };
}

module.exports = {
  DEFAULT_LIST, SELL_UNITS, ROUNDINGS, PricingError, istToday, isDate, parsePrice, lists, gstRates, ownPricesOn, upcoming, resolve,
  listOfCustomer, qtyProblem, setPrices, bulkPlan, checkTax, checkSkuFields, basis, round2, ymd, skuRows, updateSku, updateProductTax,
};
