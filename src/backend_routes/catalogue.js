// Masters > Catalogue and Masters > Tax and units > Units of measure (phase 14, v23 section 1 "Products and
// catalogue"; migration 20261104_stage2_14_01_catalogue.sql). Rights: the Products row of the role grid (view, create,
// edit, cancel = discontinue / archive, export); Standard cost needs See cost.
// - A product has five statuses (v23): draft (being set up: never sold, never on the site), active (on the site and
//   sold; needs a picture, a ready pack, an active category and its English words), hidden (sold, not on the site),
//   discontinued (off the site, the stock left is sold, never back-ordered; at zero the nightly check archives it) and
//   archived (history only; an Admin brings it back as a Draft). Bringing a discontinued product back waits for a second
//   Admin ("Bring back a discontinued product"). products.is_active (what the website reads) = status active.
// - A pack (SKU) is active, discontinued or archived; skus.is_active = can be ordered (see syncSellable). A pack is ready
//   to sell when its weight and HSN are set (trips are planned by weight, invoices need the HSN).
// - SKU code: from the product code and the pack ("Pack of 200" -> DF001-M200, "4 rolls" -> R4, "Box" -> BOX); unique,
//   never reused, never changed. Barcodes: the SKU code (own label), SKU#C (one carton) and the stored supplier EANs and
//   carton codes all find the same SKU (resolve()); one barcode finds one SKU; an EAN-13 with a wrong check digit is a
//   misread. An unknown code scanned by someone who cannot link it is noted for the office.
// - Money: MRP (with GST) is the most any price list may charge; a lower standard cost (or a first one below the average
//   cost) waits for a second Admin, because a lower cost lets lower prices pass the margin floor.
// - Raw materials: SKUs of type raw (RM-...), counted in a unit, never sold, never on a price list or the site.
// - Kits: parts (SKU x quantity), one price, sold / not sold, "Show on dfresh.us" (kits.is_active, what the site reads);
//   kit_products (the site's list of a kit's products) follows the parts.
const { audit } = require('./audit');
const secondAdmin = require('./second-admin');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const tax = require('./tax');
const company = require('./company');
const godownsLib = require('./godowns');
const permissions = require('../shared/permissions');
const { DADMIN } = require('./auth');
const { LABEL_GROUP } = require('./text-groups');

const STATUS = { draft: 'Draft', active: 'Active', hidden: 'Hidden from website', discontinued: 'Discontinued', archived: 'Archived' };
const SKU_STATUS = { active: 'Active', discontinued: 'Discontinued', archived: 'Archived' };
const SOURCE = { made: 'Made by dFresh', bought: 'Bought in', both: 'Made and bought' };
const SELL = { pack: 'Packs only', carton: 'Full cartons only', both: 'Packs or cartons' };
const BKIND = { own: 'Own label', supplier: 'Supplier EAN', carton: 'Carton' };
const LANG_FIELDS = ['name', 'one_liner', 'keywords', 'description', 'best_for', 'colour_name', 'alt_text', 'whatsapp_message', 'specification', 'pack'];
const FIELD_MAX = { name: 150, one_liner: 200, keywords: 255, description: 1200, best_for: 255, colour_name: 50, alt_text: 255, whatsapp_message: 500, specification: 255, pack: 120 };
const FIELD_LABEL = { name: 'name', one_liner: 'short line', keywords: 'keywords', description: 'full description', best_for: 'best for', colour_name: 'colour name',
  alt_text: 'photo alt text', whatsapp_message: 'WhatsApp message', specification: 'specification', pack: 'pack text' };
const HSN_RE = /^\d{4}(\d{2}){0,2}$/;
const SELLABLE_PRODUCT = "('active','hidden','discontinued')";
// the English name of a SKU: a raw material's own name, else its product's (a colour version without a name: its main product's)
const SKU_NAME = 'COALESCE(s.raw_name, t.name, pt.name, s.product_id)';
const SKU_JOIN = `LEFT JOIN products p ON p.product_id = s.product_id
  LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
  LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const money = (n) => `Rs ${r2(n).toFixed(2)}`;
const whole = (v, min) => v !== '' && v !== null && v !== undefined && Number.isInteger(Number(v)) && Number(v) >= min && /^\d+$/.test(String(v).trim());
const ready = (s) => Number(s.weight_kg) > 0 && HSN_RE.test(String(s.hsn_code || ''));
/** EAN-13: 12 digits weighted 1,3,1,3... then the check digit */
function eanOk(c) {
  if (!/^\d{13}$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(c[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(c[12]);
}
/** the SKU code of a product's pack (v23 skuCodeFor) */
function skuCodeFor(productId, pack) {
  const base = String(productId).replace(/^DZIND-/, '').replace(/-/g, '');
  const p = String(pack || '').trim();
  let m;
  if (/^Packet/i.test(p)) return `${base}-PKT`;
  if (/^Box$/i.test(p)) return `${base}-BOX`;
  if ((m = p.match(/(\d+)\s*rolls?/i))) return `${base}-R${m[1]}`;
  if ((m = p.match(/(\d+)/))) return `${base}-M${m[1]}`;
  return `${base}-PK`;
}

/** a field error the panel shows under the field (and on its section tab) */
function fieldsError(InputError, fields) {
  const keys = Object.keys(fields);
  const e = new InputError(keys.length === 1 ? fields[keys[0]] : `Fix the ${keys.length} fields marked in red: ${fields[keys[0]]}`);
  e.code = 'fields';
  e.fields = fields;
  return e;
}

// ---------------------------------------------------------------- shared reads
/** good stock per SKU and godown -> Map sku -> { [godownId]: n, all: n } */
async function stockMap(q, skuCodes = null) {
  const [rows] = await q.query(`SELECT sku_code, location_id, COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE stock_kind = 'good'${skuCodes ? ' AND sku_code IN (?)' : ''}
    GROUP BY sku_code, location_id`, skuCodes ? [skuCodes.length ? skuCodes : ['']] : []);
  const out = new Map();
  for (const r of rows) {
    const x = out.get(r.sku_code) || { all: 0 };
    x[r.location_id] = Number(r.n);
    x.all += Number(r.n);
    out.set(r.sku_code, x);
  }
  return out;
}
/** packs on every shelf of every godown (archive needs none left anywhere) */
async function stockAnywhere(q, skuCodes) {
  if (!skuCodes.length) return 0;
  const [[r]] = await q.query('SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code IN (?)', [skuCodes]);
  return Number(r.n);
}
async function godownList(q) {
  return (await godownsLib.list(q)).filter((g) => g.is_active).map((g) => ({ godown_id: g.godown_id, code: g.code, name: g.name }));
}
/** reorder level per SKU and godown (stock_levels, else the Switches default) */
async function reorderMap(q, skuCodes) {
  const cs = await commerceSettings.read(q);
  const def = Number(cs.low_level_default) || 20;
  const [rows] = skuCodes.length ? await q.query('SELECT sku_code, location_id, reorder_level FROM stock_levels WHERE sku_code IN (?)', [skuCodes]) : [[]];
  const m = new Map();
  for (const r of rows) m.set(`${r.sku_code}|${r.location_id}`, Number(r.reorder_level));
  return { get: (sku, g) => (m.has(`${sku}|${g}`) ? m.get(`${sku}|${g}`) : def), def };
}

/** skus.is_active (can be ordered) and products.is_active (on the site) follow the statuses */
async function syncSellable(q, productId) {
  await q.query("UPDATE products SET is_active = (status = 'active') WHERE product_id = ?", [productId]);
  await q.query(`UPDATE skus s JOIN products p ON p.product_id = s.product_id
      SET s.is_active = (s.status IN ('active','discontinued') AND p.status IN ${SELLABLE_PRODUCT}) WHERE s.product_id = ?`, [productId]);
}

/**
 * every finished SKU's price with GST per list, today and on each later dated price or GST rate change, at the GST rate
 * of each day (phase 15: dated HSN rates; hsn = another code to try, for an HSN change) -> [{ list, label, from, inc }]
 */
async function pricesWithGst(q, skuCode, hsn = null) {
  const [[s]] = await q.query('SELECT s.sku_code, p.hsn_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [skuCode]);
  if (!s) return [];
  const code = hsn || s.hsn_code;
  const today = pricing.istToday();
  const lists = await pricing.lists(q);
  const [rows] = await q.query("SELECT list_key, DATE_FORMAT(effective_from, '%Y-%m-%d') AS d, price, basis FROM sku_prices WHERE sku_code = ? ORDER BY effective_from", [skuCode]);
  const [rates] = await q.query("SELECT DATE_FORMAT(effective_from, '%Y-%m-%d') AS d FROM hsn_rates WHERE hsn_code = ? AND status = 'active' AND effective_from > ?", [code, today]);
  const out = [];
  for (const l of lists) {
    const mine = rows.filter((r) => r.list_key === l.key);
    const days = [...new Set([today, ...mine.filter((r) => r.d > today).map((r) => r.d), ...rates.map((r) => r.d)])].sort();
    for (const d of days) {
      const on = mine.filter((r) => r.d <= d).pop();
      if (!on || on.price === null) continue;
      const rate = await tax.rateOn(q, code, d);
      if (rate === null) continue;
      out.push({ list: l.key, label: l.label, from: d > today ? d : null, inc: r2(pricing.toEx(Number(on.price), on.basis, rate) * (1 + rate / 100)) });
    }
  }
  return out;
}
/** the prices an MRP would be below -> ["Default: Rs 62.00 with GST", ...] */
async function mrpProblems(q, skuCode, mrp, hsn = null) {
  if (mrp === null || mrp === undefined) return [];
  return (await pricesWithGst(q, skuCode, hsn)).filter((x) => x.inc > Number(mrp) + 0.004)
    .map((x) => `${x.label}${x.from ? ` from ${x.from}` : ''} charges ${money(x.inc)} with GST`);
}

/** why a product cannot be made active ([] = it can) */
async function activeProblems(q, productId) {
  const [[p]] = await q.query(`SELECT p.product_id, p.category_key, p.variant_of, p.specification, p.hsn_code, c.is_active AS cat_on, m.status AS main_status
      FROM products p LEFT JOIN categories c ON c.category_key = p.category_key LEFT JOIN products m ON m.product_id = p.variant_of WHERE p.product_id = ?`, [productId]);
  if (!p) return ['it does not exist'];
  const out = [];
  const [[img]] = await q.query('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [productId]);
  if (!Number(img.n)) out.push('it has no picture');
  if (!Number(p.cat_on)) out.push('its category is hidden');
  const [skus] = await q.query("SELECT sku_code, weight_kg FROM skus WHERE product_id = ? AND status = 'active'", [productId]);
  if (!skus.length) out.push('it has no active SKU');
  for (const s of skus) if (!ready({ ...s, hsn_code: p.hsn_code })) out.push(`${s.sku_code} needs its weight${HSN_RE.test(p.hsn_code || '') ? '' : ' and HSN'}`);
  const [[en]] = await q.query("SELECT one_liner, keywords, description, best_for FROM product_translations WHERE product_id = ? AND lang_code = 'en'", [productId]);
  const e = en || {};
  if (!e.one_liner) out.push('it has no English short line');
  if (!e.description) out.push('it has no English full description');
  if (!e.keywords) out.push('it has no English keywords');
  if (!e.best_for) out.push('it has no English "best for"');
  if (!p.specification) out.push('it has no specification');
  if (p.variant_of && p.main_status !== 'active') out.push('its main product is not active');
  return out;
}

/** "TA", "HI": active non-default languages whose name or short line is empty */
async function langGapsAll(q) {
  const [langs] = await q.query("SELECT lang_code FROM languages WHERE is_active = 1 AND is_default = 0 ORDER BY sort_order, lang_code");
  const [rows] = await q.query('SELECT product_id, lang_code, name, one_liner FROM product_translations');
  const have = new Map(rows.map((r) => [`${r.product_id}|${r.lang_code}`, r]));
  return { langs: langs.map((l) => l.lang_code), gaps: (pid) => langs.map((l) => l.lang_code).filter((c) => { const r = have.get(`${pid}|${c}`); return !r || !r.name || !r.one_liner; }).map((c) => c.toUpperCase()) };
}

/** resolve any scanned code -> { sku, kind: own | carton | supplier, packs } | { bad } | null */
async function resolve(q, raw) {
  const code = String(raw || '').trim().toUpperCase().slice(0, 40);
  if (!code) return null;
  const [[b]] = await q.query('SELECT sku_code, kind FROM sku_barcodes WHERE barcode = ?', [code]);
  let sku = null;
  let kind = null;
  if (b) { sku = b.sku_code; kind = b.kind; }
  else {
    const m = /^(.+)#C$/.exec(code);
    const [[s]] = await q.query('SELECT sku_code FROM skus WHERE sku_code = ?', [m ? m[1] : code]);
    if (s) { sku = s.sku_code; kind = m ? 'carton' : 'own'; }
  }
  if (!sku) return /^\d{13}$/.test(code) && !eanOk(code) ? { code, bad: true } : { code, unknown: true };
  const [[s]] = await q.query(`SELECT s.sku_code, s.packs_per_carton, s.status, s.sku_type, ${SKU_NAME} AS name FROM skus s ${SKU_JOIN} WHERE s.sku_code = ?`, [sku]);
  return { code, sku: s.sku_code, name: s.name, kind, kind_label: BKIND[kind], packs: kind === 'carton' ? Number(s.packs_per_carton) : 1, status: s.status, type: s.sku_type };
}
/** a scanned code in the packing / receiving form: SKU, SKU#C or SKU/BATCH; a supplier EAN or a stored carton code becomes its SKU (or SKU#C) */
async function scanCode(q, raw) {
  const code = String(raw || '').trim().toUpperCase().slice(0, 60);
  if (!code || code.includes('/')) return code;
  const [[b]] = await q.query('SELECT sku_code, kind FROM sku_barcodes WHERE barcode = ?', [code]);
  return b ? `${b.sku_code}${b.kind === 'carton' ? '#C' : ''}` : code;
}
/** "why this barcode cannot be added" ('' = it can) */
async function barcodeProblem(q, code, kind) {
  if (!code) return 'Scan or type the barcode.';
  if (!['supplier', 'carton'].includes(kind)) return 'Choose Supplier EAN or Carton.';
  if (kind === 'supplier' && !eanOk(code)) return /^\d{13}$/.test(code) ? `${code} fails the EAN-13 check digit: it was misread. Scan it again.` : 'A supplier EAN is 13 digits.';
  if (!/^[A-Z0-9#/-]{4,40}$/.test(code)) return 'Letters, digits, - / # only, 4 to 40 characters.';
  const hit = await resolve(q, code);
  if (hit && hit.sku) return `${code} already belongs to ${hit.sku} (${hit.name}). One barcode finds one SKU.`;
  return '';
}

/** one kit's parts with what can be sold per godown -> { parts, avail: { [godownId]: { n, why } } } */
async function kitAvailability(q, kitKeys, gList) {
  if (!kitKeys.length) return new Map();
  const [parts] = await q.query(`SELECT kp.kit_key, kp.sku_code, kp.qty, kp.sort_order, s.status, s.weight_kg, p.status AS product_status, p.hsn_code, p.product_id,
        ${SKU_NAME} AS name, s.size_label,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
      FROM kit_parts kp JOIN skus s ON s.sku_code = kp.sku_code ${SKU_JOIN} WHERE kp.kit_key IN (?) ORDER BY kp.kit_key, kp.sort_order, kp.sku_code`, [kitKeys]);
  const stock = await stockMap(q, [...new Set(parts.map((p) => p.sku_code))]);
  const out = new Map();
  for (const k of kitKeys) {
    const mine = parts.filter((p) => p.kit_key === k);
    const avail = {};
    for (const g of gList) {
      let n = Infinity;
      const why = [];
      for (const pt of mine) {
        if (pt.status !== 'active' || ['draft', 'archived'].includes(pt.product_status)) { why.push(`${pt.name} is not sold`); n = 0; continue; }
        if (!ready(pt)) { why.push(`${pt.name} is not ready to sell`); n = 0; continue; }
        const free = (stock.get(pt.sku_code) || {})[g.godown_id] || 0;
        const c = Math.floor(free / pt.qty);
        if (c <= 0) why.push(`${pt.name} is out (${free} free, needs ${pt.qty})`);
        n = Math.min(n, Math.max(c, 0));
      }
      avail[g.godown_id] = { n: n === Infinity ? 0 : n, why };
    }
    out.set(k, { parts: mine.map((p) => ({ sku_code: p.sku_code, qty: Number(p.qty), name: p.name, size_label: p.size_label, image: p.image, product_id: p.product_id })), avail });
  }
  return out;
}

// ---------------------------------------------------------------- the routes
function register({ route, tx, db, by, InputError, canDo }) {
  const seesCost = (req) => Boolean(req.admin && req.admin.seesCost);
  const isAdmin = (req) => Boolean(req.admin && permissions.isAdminRole(req.admin.role_id));
  const bad = (fields) => { throw fieldsError(InputError, fields); };

  // ---------------- Products list (both tabs)
  route('get', '/catalogue/products', 'products:view', async (req) => {
    const [rows] = await db.query(`SELECT p.product_id, p.category_key, p.variant_of, p.sort_order, p.swatch_hex, p.status, p.is_featured, p.featured_order, p.show_for_home,
        COALESCE(t.name, p.product_id) AS name, COALESCE(m.sort_order, p.sort_order) AS main_order,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.position LIMIT 1) AS image,
        (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.product_id) AS images
      FROM products p LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = 'en' LEFT JOIN products m ON m.product_id = p.variant_of`);
    const [skus] = await db.query(`SELECT s.sku_code, s.product_id, s.sku_type, s.size_label, s.status, s.source, s.sell_unit, s.min_order_qty, s.packs_per_carton, s.weight_kg, s.mrp,
        p.hsn_code, p.gst_rate, p.shelf_life_months, p.status AS product_status, ${SKU_NAME} AS name,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
      FROM skus s ${SKU_JOIN} WHERE s.sku_type = 'finished' ORDER BY s.sku_code`);
    const [cats] = await db.query("SELECT c.category_key, c.sort_order, c.is_active, COALESCE(ct.name, c.category_key) AS name FROM categories c LEFT JOIN category_translations ct ON ct.category_key = c.category_key AND ct.lang_code = 'en' ORDER BY c.sort_order");
    const gList = await godownList(db);
    const stock = await stockMap(db);
    const ro = await reorderMap(db, skus.map((s) => s.sku_code));
    const lg = await langGapsAll(db);
    const catOrder = new Map(cats.map((c) => [c.category_key, c.sort_order]));
    const per = (code) => Object.fromEntries([['all', (stock.get(code) || {}).all || 0], ...gList.map((g) => [g.godown_id, (stock.get(code) || {})[g.godown_id] || 0])]);
    const products = rows.map((p) => {
      const mine = skus.filter((s) => s.product_id === p.product_id);
      const st = { all: 0 };
      let low = false;
      for (const s of mine) {
        const x = per(s.sku_code);
        for (const [k, v] of Object.entries(x)) st[k] = (st[k] || 0) + v;
        // v23: with every godown, the total against the sum of the reorder levels; one godown: its own level (low_at)
        if (p.status === 'active' && (x.all || 0) < gList.reduce((n, g) => n + ro.get(s.sku_code, g.godown_id), 0)) low = true;
      }
      const lowAt = Object.fromEntries(gList.map((g) => [g.godown_id, p.status === 'active' && mine.some((s) => (per(s.sku_code)[g.godown_id] || 0) < ro.get(s.sku_code, g.godown_id))]));
      const order = p.variant_of ? `${p.main_order}.${p.sort_order}` : String(p.sort_order);
      return {
        product_id: p.product_id, name: p.name, category_key: p.category_key, variant_of: p.variant_of, swatch_hex: p.swatch_hex, status: p.status, status_label: STATUS[p.status],
        featured: Number(p.is_featured) ? Number(p.featured_order) || null : null, order, cat_order: catOrder.get(p.category_key) || 0, image: p.image, images: Number(p.images),
        skus: mine.map((s) => ({ sku_code: s.sku_code, size_label: s.size_label })), stock: st, low, low_at: lowAt, lang_gaps: lg.gaps(p.product_id),
      };
    }).sort((a, b) => a.cat_order - b.cat_order || Number(a.order.split('.')[0]) - Number(b.order.split('.')[0]) || Number(a.order.split('.')[1] || 0) - Number(b.order.split('.')[1] || 0));
    return {
      products,
      skus: skus.map((s) => ({ sku_code: s.sku_code, product_id: s.product_id, name: s.name, size_label: s.size_label, image: s.image, source: s.source, source_label: SOURCE[s.source],
        packs_per_carton: Number(s.packs_per_carton), sell_unit: s.sell_unit, sell_label: SELL[s.sell_unit], min_order_qty: Number(s.min_order_qty),
        shelf_life_months: Number(s.shelf_life_months), hsn_code: s.hsn_code, gst_rate: Number(s.gst_rate), stock: per(s.sku_code), status: s.status, status_label: SKU_STATUS[s.status],
        ready: ready(s), product_status: s.product_status, mrp: s.mrp === null ? null : Number(s.mrp) })),
      categories: cats.map((c) => ({ ...c, is_active: Number(c.is_active) === 1 })), godowns: gList, statuses: STATUS, languages: lg.langs,
      counts: Object.fromEntries(Object.keys(STATUS).map((k) => [k, rows.filter((r) => r.status === k).length])),
    };
  });

  // ---------------- one product (the side panel)
  async function productOut(q, req, id) {
    const [[p]] = await q.query(`SELECT product_id, category_key, variant_of, sort_order, is_featured, featured_order, show_for_home, swatch_hex, specification, pack, brand, packed_by, origin,
        hsn_code, gst_rate, track_batches, shelf_life_months, near_expiry_days, spec_status, status FROM products WHERE product_id = ?`, [id]);
    if (!p) throw new InputError('No such product', 404);
    const [trs] = await q.query(`SELECT lang_code, ${LANG_FIELDS.join(', ')} FROM product_translations WHERE product_id = ?`, [id]);
    const [langs] = await q.query('SELECT lang_code, name_en, is_default FROM languages WHERE is_active = 1 ORDER BY is_default DESC, sort_order, lang_code');
    const tr = {};
    for (const l of langs) {
      const r = trs.find((x) => x.lang_code === l.lang_code) || {};
      tr[l.lang_code] = Object.fromEntries(LANG_FIELDS.map((f) => [f, r[f] || '']));
    }
    const [images] = await q.query('SELECT position, file_name FROM product_images WHERE product_id = ? ORDER BY position', [id]);
    const [skus] = await q.query('SELECT sku_code, size_label, status, packs_per_carton, weight_kg, mrp FROM skus WHERE product_id = ? ORDER BY created_at, sku_code', [id]);
    const stock = await stockMap(q, skus.map((s) => s.sku_code));
    const [main] = p.variant_of ? await q.query('SELECT sort_order FROM products WHERE product_id = ?', [p.variant_of]) : [[]];
    const [hist] = await q.query(`SELECT audit_id, created_at, emp_id, action, entity_type, entity_id, before_json, after_json FROM audit_log
        WHERE (entity_type IN ('product','product_image','featured','product_tax') AND (entity_id = ? OR entity_id LIKE ?)) OR (entity_type IN ('sku','barcode') AND entity_id IN (?))
        ORDER BY audit_id DESC LIMIT 60`, [id, `${id} %`, skus.length ? skus.map((s) => s.sku_code) : ['']]);
    const auditLib = require('./audit');
    const whoIds = [...new Set(hist.map((h) => h.emp_id))];
    const [names] = whoIds.length ? await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${DADMIN}\`.employee WHERE emp_id IN (?)`, [whoIds]) : [[]];
    const nameOf = new Map(names.map((n) => [n.emp_id, n.name]));
    const featured = (await q.query('SELECT product_id, featured_order FROM products WHERE is_featured = 1 AND product_id <> ?', [id]))[0];
    const [[waitBack]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'rule_change' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`prodback:${id}`]);
    const f = await company.facts(q);
    const gaps = (await langGapsAll(q)).gaps(id);
    return {
      ...p, track_batches: Number(p.track_batches) === 1, show_for_home: Number(p.show_for_home) === 1, gst_rate: Number(p.gst_rate),
      featured: Number(p.is_featured) ? Number(p.featured_order) || null : null, featured_places: Math.max(5, featured.length + (Number(p.is_featured) ? 1 : 0)), featured_taken: Object.fromEntries(featured.filter((x) => x.featured_order).map((x) => [x.featured_order, x.product_id])),
      order: p.variant_of ? `${main[0] ? main[0].sort_order : 0}.${p.sort_order}` : String(p.sort_order), status_label: STATUS[p.status],
      tr, languages: langs.map((l) => ({ code: l.lang_code, name: l.name_en, is_default: Number(l.is_default) === 1 })), lang_gaps: gaps, images,
      skus: skus.map((s) => ({ sku_code: s.sku_code, size_label: s.size_label, status: s.status, status_label: SKU_STATUS[s.status], packs_per_carton: Number(s.packs_per_carton),
        stock: (stock.get(s.sku_code) || {}).all || 0, stock_by: stock.get(s.sku_code) || { all: 0 }, mrp: s.mrp === null ? null : Number(s.mrp), ready: ready({ ...s, hsn_code: p.hsn_code }) })),
      active_problems: ['draft', 'hidden'].includes(p.status) ? await activeProblems(q, id) : [],
      waiting_back: waitBack ? waitBack.approval_id : null,
      label_defaults: { packed_by: `${f.name}, ${f.address}`, phone: f.phone, email: f.email },
      history: hist.map((h) => ({ at: h.created_at, who: h.emp_id, who_name: nameOf.get(h.emp_id) || h.emp_id, action: h.action, what: h.entity_type, on: h.entity_id, changes: auditLib.changesOf(h) })),
    };
  }
  route('get', '/catalogue/products/:id', 'products:view', async (req) => productOut(db, req, req.params.id));

  // ---------------- create a product as a Draft, with its first pack
  route('post', '/catalogue/products', 'products:create', async (req) => tx(async (q) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 150);
    const code = String(b.product_id || '').trim().toUpperCase();
    const cat = String(b.category_key || '').trim();
    const pack = String(b.first_pack || '').trim().slice(0, 120);
    const src = String(b.source || 'made');
    const spec = String(b.specification || '').trim().slice(0, 255);
    const desc = String(b.one_liner || '').trim().slice(0, 200);
    const err = {};
    if (!name) err.name = 'Type the name, exactly as supplied.';
    else {
      const [[dup]] = await q.query("SELECT product_id FROM product_translations WHERE lang_code = 'en' AND LOWER(name) = LOWER(?)", [name]);
      if (dup) err.name = `A product is already called this (${dup.product_id}).`;
    }
    if (!/^DZIND-DF\d{3}$/.test(code)) err.product_id = 'Use DZIND-DF and three digits, like DZIND-DF050.';
    else {
      const [[dup]] = await q.query('SELECT product_id FROM products WHERE product_id = ?', [code]);
      if (dup) err.product_id = `${code} already exists.`;
    }
    const [[c]] = cat ? await q.query('SELECT category_key, is_active FROM categories WHERE category_key = ?', [cat]) : [[]];
    if (!c) err.category_key = 'Choose a category.';
    const sc = pack ? skuCodeFor(code, pack) : '';
    if (!pack) err.first_pack = 'Say what the first pack is.';
    else {
      const [[dup]] = await q.query('SELECT sku_code FROM skus WHERE sku_code = ?', [sc]);
      if (dup) err.first_pack = `${sc} already exists.`;
    }
    if (!SOURCE[src]) err.source = 'Made, bought or both.';
    if (!spec) err.specification = 'The specification is shown on every product card.';
    if (Object.keys(err).length) bad(err);
    const [[mx]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM products WHERE category_key = ? AND variant_of IS NULL', [cat]);
    await q.query(`INSERT INTO products (product_id, category_key, sort_order, specification, pack, status, is_active, updated_by)
      VALUES (?, ?, ?, ?, ?, 'draft', 0, ?)`, [code, cat, mx.n, spec, pack, by(req)]);
    await q.query("INSERT INTO product_translations (product_id, lang_code, name, one_liner, updated_by) VALUES (?, 'en', ?, ?, ?)", [code, name, desc || null, by(req)]);
    await q.query(`INSERT INTO skus (sku_code, product_id, size_label, source, status, is_active, created_by) VALUES (?, ?, ?, ?, 'active', 0, ?)`, [sc, code, pack, src, by(req)]);
    await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, 1, ?)', [sc, pricing.istToday(), by(req)]);
    await audit(q, { empId: by(req), action: 'create', entity: 'product', entityId: code, after: { name, status: 'Draft', category: cat, first_sku: sc } });
    await audit(q, { empId: by(req), action: 'create', entity: 'sku', entityId: sc, after: { product: code, pack } });
    return { product_id: code, sku_code: sc, message: `Created as a Draft: ${name} with SKU ${sc}. Add a picture and the website words, then open the SKU to set its weight.` };
  }), { content: true });

  // ---------------- save a product (Basics, Website words, Label)
  route('put', '/catalogue/products/:id', 'products:edit', async (req) => tx(async (q) => {
    const [[p]] = await q.query('SELECT * FROM products WHERE product_id = ? FOR UPDATE', [req.params.id]);
    if (!p) throw new InputError('No such product', 404);
    const b = req.body || {};
    const err = {};
    const s = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
    const [langs] = await q.query('SELECT lang_code, is_default FROM languages WHERE is_active = 1');
    const [trRows] = await q.query(`SELECT lang_code, ${LANG_FIELDS.join(', ')} FROM product_translations WHERE product_id = ?`, [p.product_id]);
    const trOld = Object.fromEntries(trRows.map((r) => [r.lang_code, r]));
    const name = 'name' in b ? s(b.name, 150) : ((trOld.en || {}).name || '');
    const cat = 'category_key' in b ? s(b.category_key, 30) : p.category_key;
    const vr = 'variant_of' in b ? (s(b.variant_of, 30) || null) : p.variant_of;
    const feat = 'featured' in b ? Number(b.featured) || 0 : (Number(p.is_featured) ? Number(p.featured_order) || 0 : 0);
    const brand = 'brand' in b ? s(b.brand, 40) : p.brand;
    const home = 'show_for_home' in b ? (b.show_for_home ? 1 : 0) : Number(p.show_for_home);
    const ordIn = 'order' in b ? s(b.order, 12) : null;
    const spec = 'specification' in b ? s(b.specification, 255) : p.specification;
    const specSt = 'spec_status' in b ? s(b.spec_status, 255) : (p.spec_status || '');
    const packer = 'packed_by' in b ? s(b.packed_by, 200) : (p.packed_by || '');
    const origin = 'origin' in b ? s(b.origin, 40) : p.origin;
    const swatch = 'swatch_hex' in b ? (s(b.swatch_hex, 7).toUpperCase() || null) : p.swatch_hex;
    // the words per language: what was sent, else what is stored
    const tr = {};
    for (const l of langs) {
      const old = trOld[l.lang_code] || {};
      const sent = (b.tr || {})[l.lang_code] || {};
      tr[l.lang_code] = Object.fromEntries(LANG_FIELDS.map((f) => [f, f in sent ? s(sent[f], FIELD_MAX[f]) : (old[f] || '')]));
    }
    tr.en = tr.en || {};
    tr.en.name = name;
    if (!name) err.name = 'Type the name.';
    else {
      const [[dup]] = await q.query("SELECT product_id FROM product_translations WHERE lang_code = 'en' AND LOWER(name) = LOWER(?) AND product_id <> ?", [name, p.product_id]);
      if (dup) err.name = `Another product already has this name (${dup.product_id}).`;
    }
    if (!tr.en.one_liner) err['tr.en.one_liner'] = 'The English short line is the fallback for every language.';
    const [[c]] = await q.query('SELECT category_key, is_active FROM categories WHERE category_key = ?', [cat]);
    if (!c) err.category_key = 'Choose a category.';
    const [[kids]] = await q.query('SELECT COUNT(*) AS n FROM products WHERE variant_of = ?', [p.product_id]);
    let mainOrder = null;
    if (vr) {
      const [[m]] = await q.query('SELECT product_id, category_key, variant_of, sort_order FROM products WHERE product_id = ?', [vr]);
      if (!m || m.variant_of || vr === p.product_id) err.variant_of = 'Choose a main product (not a colour version, not itself).';
      else if (m.category_key !== cat) err.variant_of = 'A colour version sits in the same category as its main product.';
      else if (Number(kids.n)) err.variant_of = 'It has colour versions of its own.';
      else mainOrder = Number(m.sort_order);
    }
    if (cat !== p.category_key && Number(kids.n)) err.category_key = 'Its colour versions are in this category; move them first.';
    const [[fx]] = await q.query('SELECT GREATEST(5, COUNT(*)) AS n FROM products WHERE is_featured = 1');
    if (feat && !(Number.isInteger(feat) && feat >= 1 && feat <= Number(fx.n))) err.featured = `Position 1 to ${fx.n}.`;
    else if (feat && p.status !== 'active') err.featured = 'Only an active product can be in Most loved.';
    if (!brand) err.brand = "Give the brand: dFresh, or the maker's brand.";
    let newOrder = null;
    if (ordIn !== null) {
      if (!/^\d+(\.\d+)?$/.test(ordIn)) err.order = 'A number, 0 or more, like 5 or 5.1.';
      else if (vr && Math.floor(Number(ordIn)) !== mainOrder) err.order = `A colour version sits next to its main product: use ${mainOrder}.1, ${mainOrder}.2 and so on.`;
      else if (!vr && ordIn.includes('.')) err.order = 'A main product has a whole number, like 5.';
      else newOrder = vr ? Number(ordIn.split('.')[1]) : Number(ordIn);
      if (newOrder !== null && newOrder < 1 && !err.order) err.order = vr ? `Use ${mainOrder}.1 or more.` : 'Use 1 or more.';
    }
    if (!spec) err.specification = 'The specification is shown on every product card.';
    if (!origin) err.origin = 'Required on every retail pack, like India.';
    if (swatch && !/^#[0-9A-F]{6}$/.test(swatch)) err.swatch_hex = 'Use the form #RRGGBB, e.g. #7A1F2B.';
    for (const l of langs) {
      const kw = tr[l.lang_code].keywords;
      if (kw) {
        const parts = kw.split(',').map((x) => x.trim());
        if (parts.length > 6) err[`tr.${l.lang_code}.keywords`] = `Up to 6 keywords; this has ${parts.length}.`;
        else if (parts.some((x) => !x || x.length > 30)) err[`tr.${l.lang_code}.keywords`] = 'Each keyword 1 to 30 characters, separated by commas.';
      }
    }
    if (p.status === 'active') {
      for (const [f, label] of [['description', 'full description'], ['keywords', 'keywords'], ['best_for', '"best for"']]) {
        if (!tr.en[f] && !err[`tr.en.${f}`]) err[`tr.en.${f}`] = `An active product needs its English ${label}. Hide it from the website first to empty this.`;
      }
    }
    if (Object.keys(err).length) bad(err);

    // save: base row, then each language (an all-empty other language has no row: the site falls back to English)
    let moved = '';
    const changes = {};
    const chg = (k, a, v) => { if (String(a ?? '') !== String(v ?? '')) changes[k] = [a ?? '', v ?? '']; };
    chg('category', p.category_key, cat); chg('colour version of', p.variant_of, vr); chg('brand', p.brand, brand); chg('For Home', Number(p.show_for_home) ? 'yes' : 'no', home ? 'yes' : 'no');
    chg('specification', p.specification, spec); chg('spec status', p.spec_status, specSt || null); chg('packed by', p.packed_by || 'company', packer || 'company'); chg('origin', p.origin, origin);
    chg('swatch', p.swatch_hex, swatch);
    const oldFeat = Number(p.is_featured) ? Number(p.featured_order) || 0 : 0;
    if (feat !== oldFeat) {
      if (feat) {
        const [[other]] = await q.query('SELECT product_id FROM products WHERE is_featured = 1 AND featured_order = ? AND product_id <> ? FOR UPDATE', [feat, p.product_id]);
        if (other) {
          await q.query('UPDATE products SET is_featured = ?, featured_order = ? WHERE product_id = ?', [oldFeat ? 1 : 0, oldFeat || null, other.product_id]);
          await audit(q, { empId: by(req), action: 'update', entity: 'featured', entityId: other.product_id, before: { most_loved: feat }, after: { most_loved: oldFeat || 'no' } });
          const [[on]] = await q.query("SELECT COALESCE(name, product_id) AS n FROM product_translations WHERE product_id = ? AND lang_code = 'en'", [other.product_id]);
          moved = ` ${on ? on.n : other.product_id}${oldFeat ? ` moved to position ${oldFeat}.` : ' left Most loved.'}`;
        }
      }
      chg('Most loved', oldFeat || 'no', feat || 'no');
    }
    let sortOrder = Number(p.sort_order);
    if (newOrder !== null && (newOrder !== sortOrder || vr !== p.variant_of)) {
      const oldText = p.variant_of ? `${(await q.query('SELECT sort_order FROM products WHERE product_id = ?', [p.variant_of]))[0][0].sort_order}.${p.sort_order}` : String(p.sort_order);
      chg('website order', oldText, ordIn);
      // the one taking that place moves to this one's old place (positions stay unique in their list)
      const [[taken]] = await q.query(`SELECT product_id FROM products WHERE ${vr ? 'variant_of = ?' : 'variant_of IS NULL AND category_key = ?'} AND sort_order = ? AND product_id <> ? FOR UPDATE`,
        [vr || cat, newOrder, p.product_id]);
      if (taken) await q.query('UPDATE products SET sort_order = ? WHERE product_id = ?', [sortOrder, taken.product_id]);
      sortOrder = newOrder;
    }
    await q.query(`UPDATE products SET category_key = ?, variant_of = ?, sort_order = ?, is_featured = ?, featured_order = ?, show_for_home = ?, swatch_hex = ?, specification = ?, brand = ?,
        packed_by = ?, origin = ?, spec_status = ?, updated_by = ? WHERE product_id = ?`,
      [cat, vr, sortOrder, feat ? 1 : 0, feat || null, home, swatch, spec, brand, packer || null, origin, specSt || null, by(req), p.product_id]);
    for (const l of langs) {
      const v = tr[l.lang_code];
      const old = trOld[l.lang_code] || {};
      for (const f of LANG_FIELDS) if (String(old[f] || '') !== String(v[f] || '')) changes[`${FIELD_LABEL[f]} (${l.lang_code.toUpperCase()})`] = [old[f] || '', v[f] || ''];
      const empty = LANG_FIELDS.every((f) => !v[f]);
      if (l.lang_code !== 'en' && empty) { await q.query('DELETE FROM product_translations WHERE product_id = ? AND lang_code = ?', [p.product_id, l.lang_code]); continue; }
      const vals = LANG_FIELDS.map((f) => v[f] || null);
      await q.query(`INSERT INTO product_translations (product_id, lang_code, ${LANG_FIELDS.join(', ')}, updated_by) VALUES (?, ?, ${LANG_FIELDS.map(() => '?').join(', ')}, ?)
        ON DUPLICATE KEY UPDATE ${LANG_FIELDS.map((f) => `${f} = VALUES(${f})`).join(', ')}, updated_by = VALUES(updated_by)`, [p.product_id, l.lang_code, ...vals, by(req)]);
    }
    const n = Object.keys(changes).length;
    if (n) await audit(q, { empId: by(req), action: 'update', entity: 'product', entityId: p.product_id, before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])), after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])) });
    return { message: `${n} change${n === 1 ? '' : 's'} in the audit log.${moved}`, product: await productOut(q, req, p.product_id) };
  }), { content: true });

  // ---------------- status: make active, hide, discontinue, archive, bring back
  async function setStatus(q, req, id, to) {
    const [[p]] = await q.query('SELECT product_id, status, is_featured, featured_order FROM products WHERE product_id = ? FOR UPDATE', [id]);
    if (!p) throw new InputError('No such product', 404);
    if (!STATUS[to]) throw new InputError('Unknown status');
    const needCancel = to === 'discontinued' || to === 'archived';
    if (!canDo(req, 'products', needCancel ? 'cancel' : 'edit')) throw new InputError('Your role cannot do that.', 403);
    const [[nm]] = await q.query("SELECT COALESCE(name, product_id) AS n FROM product_translations WHERE product_id = ? AND lang_code = 'en'", [id]);
    const name = nm ? nm.n : id;
    if (p.status === to) return { message: `${name} is already ${STATUS[to]}.` };
    const allowed = { draft: ['active', 'archived'], active: ['hidden', 'discontinued'], hidden: ['active', 'discontinued'], discontinued: ['active', 'hidden', 'archived'], archived: ['draft'] };
    if (!allowed[p.status].includes(to)) throw new InputError(`A ${STATUS[p.status]} product cannot go to ${STATUS[to]}.`, 409);
    const skuCodes = (await q.query('SELECT sku_code FROM skus WHERE product_id = ?', [id]))[0].map((r) => r.sku_code);
    if (p.status === 'discontinued' && (to === 'active' || to === 'hidden')) {
      // v22 P1: bringing a discontinued product back waits for a second Admin
      const probs = to === 'active' ? (await activeProblems(q, id)).filter((x) => x !== 'it has no active SKU') : [];
      if (!skuCodes.length) probs.push('it has no pack to bring back');
      if (probs.length) throw new InputError(`Not active yet. ${name}: ${probs.join('; ')}.`, 409);
      const r = await secondAdmin.ask(q, { t: 'prodback', dk: `prodback:${id}`, summary: `Bring discontinued ${name} (${id}) back to ${STATUS[to]}: it can be sold and back-ordered again`,
        payload: { product_id: id, to, label: 'Bring back a discontinued product' } }, by(req));
      await audit(q, { empId: by(req), action: 'ask', entity: 'product', entityId: id, before: { status: 'Discontinued' }, after: { asked: STATUS[to] } });
      return { waiting: true, message: r.message };
    }
    if (to === 'active') {
      const probs = await activeProblems(q, id);
      if (probs.length) throw new InputError(`Not active yet. ${name}: ${probs.join('; ')}.`, 409);
    }
    if (to === 'archived') {
      const left = await stockAnywhere(q, skuCodes);
      if (left) throw new InputError(`Cannot archive ${name}: it still has ${left} packs. Discontinue it: it is sold until empty, then the nightly check archives it.`, 409);
    }
    if (to === 'draft' && !isAdmin(req)) throw new InputError('Only an Admin brings an archived product back.', 403);
    await applyStatus(q, id, to, by(req), p);
    const [kits] = await q.query('SELECT DISTINCT kt.name FROM kit_parts kp JOIN skus s ON s.sku_code = kp.sku_code JOIN kit_translations kt ON kt.kit_key = kp.kit_key AND kt.lang_code = \'en\' WHERE s.product_id = ?', [id]);
    let msg = { active: 'It shows on the website and can be sold.', hidden: 'Off the website; staff can still sell it.', discontinued: 'Off the website; the stock left is still sold (never back-ordered), then the nightly check archives it.',
      archived: 'Kept for history, never sold.', draft: 'Back as a Draft: finish it, then make it active.' }[to];
    if (kits.length && (to === 'discontinued' || to === 'archived')) msg += ` Kits using it: ${kits.map((k) => k.name).join(', ')}.`;
    return { message: `${name}: ${STATUS[to]}. ${msg}` };
  }
  async function applyStatus(q, id, to, empId, p) {
    if (to !== 'active' && Number(p.is_featured)) {
      await q.query('UPDATE products SET is_featured = 0, featured_order = NULL WHERE product_id = ?', [id]);
      await audit(q, { empId, action: 'update', entity: 'featured', entityId: id, before: { most_loved: p.featured_order }, after: { most_loved: 'no' } });
    }
    await q.query('UPDATE products SET status = ?, updated_by = ? WHERE product_id = ?', [to, empId, id]);
    const [skus] = await q.query('SELECT sku_code, status FROM skus WHERE product_id = ?', [id]);
    for (const s of skus) {
      const nt = to === 'discontinued' ? (s.status === 'active' ? 'discontinued' : s.status) : to === 'archived' ? 'archived' : to === 'draft' ? 'active'
        : (to === 'active' || to === 'hidden') && p.status === 'discontinued' && s.status === 'discontinued' ? 'active' : s.status;
      if (nt !== s.status) {
        await q.query('UPDATE skus SET status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE sku_code = ?', [nt, empId, s.sku_code]);
        await audit(q, { empId, action: 'update', entity: 'sku', entityId: s.sku_code, before: { status: SKU_STATUS[s.status] }, after: { status: SKU_STATUS[nt] } });
      }
    }
    await syncSellable(q, id);
    await audit(q, { empId, action: 'update', entity: 'product', entityId: id, before: { status: STATUS[p.status] }, after: { status: STATUS[to] } });
  }
  secondAdmin.on('prodback', {
    async apply(q, payload, empId) {
      const [[p]] = await q.query('SELECT product_id, status, is_featured, featured_order FROM products WHERE product_id = ? FOR UPDATE', [payload.product_id]);
      if (!p || p.status !== 'discontinued') return;
      await applyStatus(q, p.product_id, payload.to, empId, p);
    },
  });
  route('post', '/catalogue/products/:id/status', 'products:view', async (req) => tx(async (q) => setStatus(q, req, req.params.id, String((req.body || {}).to || ''))), { content: true });

  // bulk Hide from website / Show on website (v23 bulk bar): skips the ones in the wrong status or not ready
  route('post', '/catalogue/products-bulk/web', 'products:edit', async (req) => tx(async (q) => {
    const to = (req.body || {}).to === 'hidden' ? 'hidden' : 'active';
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String).slice(0, 500) : [];
    const done = [];
    const skipped = [];
    for (const id of ids) {
      const [[p]] = await q.query('SELECT product_id, status, is_featured, featured_order FROM products WHERE product_id = ? FOR UPDATE', [id]);
      if (!p || p.status !== (to === 'hidden' ? 'active' : 'hidden') || (to === 'active' && (await activeProblems(q, id)).length)) { skipped.push(id); continue; }
      await applyStatus(q, id, to, by(req), p);
      done.push(id);
    }
    return { done, skipped, message: `${done.length} product${done.length === 1 ? '' : 's'} ${to === 'hidden' ? 'hidden from' : 'shown on'} the website${skipped.length ? `; ${skipped.length} skipped (wrong status or not ready)` : ''}.` };
  }), { content: true });

  // nightly check: a discontinued product whose stock reached zero is archived (also run by the server once a night)
  async function nightly(q, empId) {
    const [rows] = await q.query("SELECT product_id, status, is_featured, featured_order FROM products WHERE status = 'discontinued' FOR UPDATE");
    const done = [];
    for (const p of rows) {
      const codes = (await q.query('SELECT sku_code FROM skus WHERE product_id = ?', [p.product_id]))[0].map((r) => r.sku_code);
      if (await stockAnywhere(q, codes)) continue;
      await applyStatus(q, p.product_id, 'archived', empId, p);
      done.push(p.product_id);
    }
    return done;
  }
  route('post', '/catalogue/nightly', 'products:edit', async (req) => tx(async (q) => {
    const done = await nightly(q, by(req));
    return { archived: done, message: done.length ? `Nightly check archived ${done.length}: ${done.join(', ')} (their stock reached zero).` : 'Nightly check done: no discontinued product has reached zero stock.' };
  }), { content: true });

  // ---------------- add a pack (SKU) to a product
  route('post', '/catalogue/products/:id/skus', 'products:create', async (req) => tx(async (q) => {
    const [[p]] = await q.query('SELECT product_id, status FROM products WHERE product_id = ? FOR UPDATE', [req.params.id]);
    if (!p) throw new InputError('No such product', 404);
    if (p.status === 'archived') throw new InputError('An archived product gets no new pack.', 409);
    const pack = String((req.body || {}).pack || '').trim().slice(0, 120);
    if (!pack) throw new InputError('Type the pack, like "Pack of 200".');
    const sc = skuCodeFor(p.product_id, pack);
    const [[dup]] = await q.query('SELECT sku_code FROM skus WHERE sku_code = ?', [sc]);
    if (dup) throw new InputError(`${sc} already exists. Each pack size has one SKU, and a SKU code is never reused.`, 409);
    const [[base]] = await q.query('SELECT source FROM skus WHERE product_id = ? ORDER BY created_at, sku_code LIMIT 1', [p.product_id]);
    await q.query("INSERT INTO skus (sku_code, product_id, size_label, source, status, is_active, created_by) VALUES (?, ?, ?, ?, 'active', 0, ?)", [sc, p.product_id, pack, base ? base.source : 'made', by(req)]);
    await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, 1, ?)', [sc, pricing.istToday(), by(req)]);
    await syncSellable(q, p.product_id);
    await audit(q, { empId: by(req), action: 'create', entity: 'sku', entityId: sc, after: { product: p.product_id, pack } });
    return { sku_code: sc, message: `${sc} added. Open it to set packs per carton and weight: it is Not ready until its weight is set.` };
  }), { content: true });

  // ---------------- SKUs: one (the side panel) and save
  async function skuOut(q, req, code) {
    const [[s]] = await q.query(`SELECT s.sku_code, s.product_id, s.sku_type, s.raw_name, s.unit_code, s.size_label, s.packs_per_carton, s.min_order_qty, s.step_qty, s.sell_unit, s.status,
        s.source, s.net_qty, s.mrp, s.std_cost, s.avg_cost, s.weight_kg, s.dims, s.per_pallet, s.bin_location, COALESCE(p.hsn_code, s.raw_hsn) AS hsn_code, p.gst_rate, p.track_batches, p.shelf_life_months, p.near_expiry_days,
        p.status AS product_status, ${SKU_NAME} AS name,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
      FROM skus s ${SKU_JOIN} WHERE s.sku_code = ?`, [code]);
    if (!s) throw new InputError('No such SKU', 404);
    const raw = s.sku_type === 'raw';
    const gList = await godownList(q);
    const stock = (await stockMap(q, [s.sku_code])).get(s.sku_code) || {};
    const ro = await reorderMap(q, [s.sku_code]);
    const [cartons] = await q.query("SELECT DATE_FORMAT(from_date, '%Y-%m-%d') AS from_date, packs FROM sku_cartons WHERE sku_code = ? ORDER BY from_date", [s.sku_code]);
    const [codes] = await q.query('SELECT barcode, kind FROM sku_barcodes WHERE sku_code = ? ORDER BY kind DESC, barcode', [s.sku_code]);
    const [subs] = await q.query('SELECT sub_sku_code FROM sku_substitutes WHERE sku_code = ? ORDER BY sort_order, sub_sku_code', [s.sku_code]);
    const [units] = await q.query('SELECT u.unit_code, u.name, su.base_qty FROM sku_units su JOIN units u ON u.unit_code = su.unit_code WHERE su.sku_code = ? ORDER BY u.sort_order', [s.sku_code]);
    const cs = await commerceSettings.read(q);
    const prices = raw ? [] : await pricesWithGst(q, s.sku_code);
    const top = prices.reduce((m, x) => (x.inc > m.inc ? x : m), { inc: 0 });
    const [[waitCost]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'rule_change' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`stdcost:${s.sku_code}`]);
    return {
      sku_code: s.sku_code, product_id: s.product_id, type: s.sku_type, name: s.name, raw_name: s.raw_name, unit_code: s.unit_code, size_label: s.size_label, image: s.image,
      status: s.status, status_label: SKU_STATUS[s.status], product_status: s.product_status, ready: raw ? Number(s.weight_kg) > 0 : ready(s),
      source: s.source, net_qty: s.net_qty || '', mrp: s.mrp === null ? null : Number(s.mrp),
      ...(seesCost(req) ? { std_cost: s.std_cost === null ? null : Number(s.std_cost), avg_cost: s.avg_cost === null ? null : Number(s.avg_cost), cost_waiting: waitCost ? waitCost.approval_id : null } : {}),
      sees_cost: seesCost(req), sell_unit: s.sell_unit, min_order_qty: Number(s.min_order_qty), step_qty: Number(s.step_qty), packs_per_carton: Number(s.packs_per_carton),
      per_pallet: s.per_pallet === null ? null : Number(s.per_pallet), weight_kg: s.weight_kg === null ? null : Number(s.weight_kg), dims: s.dims || '',
      shelf_life_months: Number(s.shelf_life_months || 0), track_batches: Number(s.track_batches) === 1, near_expiry_days: s.near_expiry_days === null ? null : Number(s.near_expiry_days),
      near_default: Number(cs.expiry_warn_days) || 60, hsn_code: s.hsn_code || '', gst_rate: raw ? (s.hsn_code ? await tax.rateOn(q, s.hsn_code, pricing.istToday()) : null) : s.gst_rate === null ? null : Number(s.gst_rate),
      cartons, barcodes: [{ barcode: s.sku_code, kind: 'own', kind_label: BKIND.own }, ...(raw ? [] : [{ barcode: `${s.sku_code}#C`, kind: 'carton', kind_label: BKIND.carton, builtin: true }]),
        ...codes.map((c) => ({ ...c, kind_label: BKIND[c.kind] }))],
      substitutes: subs.map((x) => x.sub_sku_code), units: units.map((u) => ({ unit_code: u.unit_code, name: u.name, base_qty: Number(u.base_qty) })),
      godowns: gList.map((g) => ({ ...g, stock: stock[g.godown_id] || 0, reorder: ro.get(s.sku_code, g.godown_id) })), stock_all: stock.all || 0,
      max_price: top.inc ? { inc: top.inc, list: `${top.label}${top.from ? ` from ${top.from}` : ''}` } : null,
    };
  }
  route('get', '/catalogue/skus/:code', 'products:view', async (req) => skuOut(db, req, String(req.params.code).toUpperCase()));

  route('put', '/catalogue/skus/:code', 'products:edit', async (req) => tx(async (q) => {
    const code = String(req.params.code).toUpperCase();
    const [[s]] = await q.query(`SELECT s.*, p.hsn_code, p.gst_rate, p.track_batches, p.shelf_life_months, p.near_expiry_days, p.status AS product_status
        FROM skus s LEFT JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ? FOR UPDATE`, [code]);
    if (!s) throw new InputError('No such SKU', 404);
    const raw = s.sku_type === 'raw';
    const b = req.body || {};
    const err = {};
    const has = (k) => k in b;
    const str = (k, max, old) => (has(k) ? String(b[k] ?? '').trim().slice(0, max) : old);
    const pack = raw ? s.size_label : str('size_label', 120, s.size_label);
    const name = raw ? str('raw_name', 60, s.raw_name) : null;
    const unit = raw ? str('unit_code', 12, s.unit_code) : s.unit_code;
    const src = str('source', 8, s.source);
    const st = str('status', 12, s.status);
    const net = raw ? s.net_qty : str('net_qty', 40, s.net_qty || '');
    const mrpIn = raw || !has('mrp') ? undefined : String(b.mrp ?? '').trim();
    const costIn = has('std_cost') && seesCost(req) ? String(b.std_cost ?? '').trim() : undefined;
    const sell = raw ? s.sell_unit : str('sell_unit', 10, s.sell_unit);
    const moq = raw ? String(s.min_order_qty) : str('min_order_qty', 9, String(s.min_order_qty));
    const step = raw ? String(s.step_qty) : str('step_qty', 9, String(s.step_qty));
    const cart = str('packs_per_carton', 9, String(s.packs_per_carton));
    const pal = str('per_pallet', 9, s.per_pallet === null ? '' : String(s.per_pallet));
    const wt = str('weight_kg', 12, s.weight_kg === null ? '' : String(Number(s.weight_kg)));
    const dims = str('dims', 30, s.dims || '');
    const life = raw ? '0' : str('shelf_life_months', 4, String(s.shelf_life_months || 0));
    const batch = raw ? Number(s.track_batches) === 1 : has('track_batches') ? Boolean(b.track_batches) : Number(s.track_batches) === 1;
    const near = raw ? '' : str('near_expiry_days', 4, s.near_expiry_days === null ? '' : String(s.near_expiry_days));
    const hsn = raw ? null : str('hsn_code', 8, s.hsn_code || '');
    // phase 16: a raw material's own HSN code (v23), for the GST on its purchase; empty = not set yet
    const rawHsn = raw ? str('hsn_code', 8, s.raw_hsn || '') : null;
    // phase 15: the GST rate comes from the HSN code (Masters > Tax and units > HSN and GST rates); it is not typed
    const gst = raw || !hsn ? (s.gst_rate === null ? null : Number(s.gst_rate)) : await tax.rateOn(q, hsn, pricing.istToday());
    const subs = raw ? [] : has('substitutes') && Array.isArray(b.substitutes) ? [...new Set(b.substitutes.map((x) => String(x).toUpperCase()))].slice(0, 10) : null;
    const reorder = has('reorder') && b.reorder && typeof b.reorder === 'object' ? b.reorder : null;
    const units = has('units') && Array.isArray(b.units) ? b.units : null;
    if (raw && !name) err.raw_name = 'Give it a name.';
    if (raw && rawHsn && rawHsn !== (s.raw_hsn || '')) { if (!HSN_RE.test(rawHsn)) err.hsn_code = '4, 6 or 8 digits.'; else { const why = await tax.hsnProblem(q, rawHsn); if (why) err.hsn_code = why; } }
    if (raw) { const [[u]] = await q.query('SELECT unit_code FROM units WHERE unit_code = ?', [unit]); if (!u) err.unit_code = 'Choose a unit.'; }
    if (!raw && !pack) err.size_label = 'The pack label cannot be empty.';
    if (!SOURCE[src]) err.source = 'Made, bought or both.';
    if (!whole(cart, 1)) err.packs_per_carton = 'A whole number, 1 or more.';
    if (pal !== '' && !whole(pal, 1)) err.per_pallet = 'A whole number, or leave it empty.';
    if (!raw) {
      if (!SELL[sell]) err.sell_unit = 'Packs only, full cartons only, or both.';
      if (!whole(moq, 1)) err.min_order_qty = 'A whole number, 1 or more.';
      if (!whole(step, 1)) err.step_qty = 'A whole number, 1 or more.';
      if (whole(cart, 1) && whole(moq, 1) && whole(step, 1)) {
        if (sell === 'carton' && (Number(moq) % Number(cart) || Number(step) % Number(cart))) {
          if (Number(moq) % Number(cart)) err.min_order_qty = `Sold in full cartons of ${cart}: use a multiple of ${cart}.`;
          if (Number(step) % Number(cart)) err.step_qty = `Use a multiple of ${cart}.`;
        } else if (Number(moq) % Number(step)) err.min_order_qty = `Must be a whole number of steps of ${step}.`;
      }
    }
    if (!(Number(wt) > 0)) err.weight_kg = 'More than 0 kg: trips are planned by weight.';
    if (dims && !/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/i.test(dims)) err.dims = 'Length x width x height in cm, like 30x20x12.';
    if (!raw) {
      if (!whole(life, 0)) err.shelf_life_months = '0, or a whole number of months.';
      else if (Number(life) > 0 && !batch) err.track_batches = `It expires after ${life} months, so batch tracking must be on.`;
      if (near !== '' && !whole(near, 0)) err.near_expiry_days = '0, or a whole number of days, or empty for the default.';
      else if (near !== '' && whole(life, 0) && Number(life) > 0 && Number(near) >= Number(life) * 30) err.near_expiry_days = `Longer than the ${life}-month shelf life.`;
      if (!HSN_RE.test(hsn)) err.hsn_code = '4, 6 or 8 digits.';
      else if (hsn !== s.hsn_code) {
        const why = await tax.hsnProblem(q, hsn);
        if (why) err.hsn_code = why;
        else {
          // every pack of the product takes the new code: each keeps under its MRP at the new code's rates
          const [sibs] = await q.query('SELECT sku_code, mrp FROM skus WHERE product_id = ?', [s.product_id]);
          const probs = [];
          for (const x of sibs) {
            const m = x.sku_code === code && mrpIn !== undefined && mrpIn !== '' && Number(mrpIn) > 0 ? Number(mrpIn) : x.mrp;
            probs.push(...(await mrpProblems(q, x.sku_code, m, hsn)).map((t) => `${x.sku_code} ${t}`));
          }
          if (probs.length) err.hsn_code = `At HSN ${hsn} the price goes above MRP: ${probs.slice(0, 2).join('; ')}. Lower the price or raise the MRP first.`;
        }
      }
    }
    if (st !== s.status) {
      if (!SKU_STATUS[st]) err.status = 'Active, discontinued or archived.';
      else if (!canDo(req, 'products', 'cancel') && st !== 'active') err.status = 'Your role cannot discontinue or archive.';
      else if (s.status === 'discontinued' && st === 'active') err.status = 'Discontinued packs come back only from the product (Make active again), with approval.';
      else if (st === 'archived') { const left = await stockAnywhere(q, [code]); if (left) err.status = `It still has ${left} packs. Discontinue it; archive when empty.`; }
      if (!err.status && st === 'active' && s.status === 'archived') {
        if (!isAdmin(req)) err.status = 'Only an Admin brings an archived SKU back.';
        else if (!raw && s.product_status === 'archived') err.status = 'Its product is archived.';
      }
    }
    let mrp = s.mrp === null ? null : Number(s.mrp);
    if (mrpIn !== undefined) {
      if (mrpIn === '') mrp = null;
      else if (!(Number(mrpIn) > 0) || !/^\d+(\.\d{1,2})?$/.test(mrpIn)) err.mrp = 'More than 0, at most 2 decimals, or leave it empty.';
      else {
        mrp = Number(mrpIn);
        const probs = await mrpProblems(q, code, mrp);
        if (probs.length) err.mrp = `Above this MRP: ${probs.slice(0, 2).join('; ')}. Nobody may be charged more than MRP: lower that price first, or set a higher MRP.`;
      }
    }
    let cost;
    if (costIn !== undefined) {
      if (costIn === '') cost = null;
      else if (!(Number(costIn) >= 0) || !/^\d+(\.\d{1,2})?$/.test(costIn)) err.std_cost = '0 or more, at most 2 decimals, or leave it empty.';
      else cost = Number(costIn);
    }
    if (subs) {
      for (const c of subs) {
        if (c === code) { err.substitutes = 'A pack is never its own substitute.'; break; }
        const [[x]] = await q.query('SELECT s.sku_code, s.status, s.sku_type, s.weight_kg, p.status AS ps, p.hsn_code FROM skus s LEFT JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [c]);
        if (!x || x.sku_type !== 'finished' || x.status !== 'active' || ['draft', 'archived', 'discontinued'].includes(x.ps)) { err.substitutes = `${c} is not sold, so it cannot be offered.`; break; }
        if (!ready(x)) { err.substitutes = `${c} is not ready to sell yet.`; break; }
      }
    }
    const gList = await godownList(q);
    const ro = {};
    if (reorder) for (const g of gList) {
      const v = reorder[g.godown_id];
      if (v === undefined) continue;
      if (!whole(v, 0)) err[`reorder.${g.godown_id}`] = '0, or a whole number.';
      else ro[g.godown_id] = Number(v);
    }
    const unitRows = [];
    if (units) {
      for (const [i, u] of units.entries()) {
        const uc = String(u.unit_code || '').trim();
        if (!uc) continue;
        const [[known]] = await q.query('SELECT unit_code FROM units WHERE unit_code = ?', [uc]);
        if (!known) { err[`units.${i}`] = `No unit ${uc}.`; continue; }
        if (uc === (raw ? unit : 'pack') || uc === 'carton') { err[`units.${i}`] = uc === 'carton' ? 'Cartons come from Packs per carton.' : 'That is the base unit already.'; continue; }
        if (!(Number(u.base_qty) > 0)) { err[`units.${i}`] = 'How many base units: more than 0.'; continue; }
        if (unitRows.some((x) => x.unit_code === uc)) { err[`units.${i}`] = 'That unit is there twice.'; continue; }
        unitRows.push({ unit_code: uc, base_qty: Math.round(Number(u.base_qty) * 1000) / 1000 });
      }
    }
    if (Object.keys(err).length) bad(err);

    // save
    const changes = {};
    const chg = (k, a, v) => { if (String(a ?? '') !== String(v ?? '')) changes[k] = [a ?? '', v ?? '']; };
    let costMsg = '';
    if (cost !== undefined) {
      const old = s.std_cost === null ? null : Number(s.std_cost);
      const av = s.avg_cost === null ? null : Number(s.avg_cost);
      const lower = (old !== null && (cost === null || cost < old - 0.004)) || (old === null && cost !== null && av !== null && cost < av - 0.004);
      if (lower) {
        // v23 Y4 / N9: a lower standard cost (or a first one below the average cost) waits for a second Admin
        const r = await secondAdmin.ask(q, { t: 'stdcost', dk: `stdcost:${code}`, summary: `${code}: standard cost ${old !== null ? money(old) : `not set (average ${av !== null ? money(av) : 'none'})`} to ${cost !== null ? money(cost) : 'not set'} (a lower cost lets lower prices pass the margin floor)`,
          payload: { sku: code, value: cost, label: 'Lower a standard cost' } }, by(req));
        costMsg = ` The lower standard cost waits for a second Admin: ${r.message}`;
      } else if (String(old) !== String(cost)) {
        chg('standard cost', old === null ? 'not set' : money(old), cost === null ? 'not set' : money(cost));
        await q.query('UPDATE skus SET std_cost = ? WHERE sku_code = ?', [cost, code]);
      }
    }
    chg(raw ? 'name' : 'pack label', raw ? s.raw_name : s.size_label, raw ? name : pack); chg('unit', s.unit_code, unit); chg('made or bought', SOURCE[s.source], SOURCE[src]);
    chg('net quantity', s.net_qty, net); chg('MRP', s.mrp === null ? 'not set' : money(s.mrp), mrp === null ? 'not set' : money(mrp));
    chg('customers buy in', SELL[s.sell_unit], SELL[sell]); chg('minimum order', s.min_order_qty, moq); chg('in steps of', s.step_qty, step);
    chg('cartons per pallet', s.per_pallet, pal); chg('weight kg', s.weight_kg === null ? '' : Number(s.weight_kg), wt === '' ? '' : Number(wt)); chg('size', s.dims, dims);
    const today = pricing.istToday();
    let cartMsg = '';
    if (Number(cart) !== Number(s.packs_per_carton)) {
      chg('packs per carton', s.packs_per_carton, `${cart} from ${today}`);
      await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE packs = VALUES(packs), created_by = VALUES(created_by)', [code, today, Number(cart), by(req)]);
      cartMsg = ` New cartons hold ${cart}; cartons in stock keep ${s.packs_per_carton}.`;
    }
    if (st !== s.status) chg('status', SKU_STATUS[s.status], SKU_STATUS[st]);
    if (raw && (rawHsn || '') !== (s.raw_hsn || '')) { chg('HSN', s.raw_hsn || 'not set', rawHsn || 'not set'); await q.query('UPDATE skus SET raw_hsn = ? WHERE sku_code = ?', [rawHsn || null, code]); }
    await q.query(`UPDATE skus SET size_label = ?, raw_name = ?, unit_code = ?, source = ?, status = ?, net_qty = ?, mrp = ?, sell_unit = ?, min_order_qty = ?, step_qty = ?, packs_per_carton = ?,
        per_pallet = ?, weight_kg = ?, dims = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE sku_code = ?`,
    [pack, name, unit, src, st, net || null, mrp, sell, Number(moq), Number(step), Number(cart), pal === '' ? null : Number(pal), Number(wt), dims || null, by(req), code]);
    if (!raw) {
      // shelf life, batch tracking, near expiry, HSN and GST are the product's: every pack of it shares them
      const pc = {};
      if (Number(life) !== Number(s.shelf_life_months)) pc.shelf_life_months = Number(life);
      if (batch !== (Number(s.track_batches) === 1)) pc.track_batches = batch ? 1 : 0;
      if (String(near) !== String(s.near_expiry_days === null ? '' : s.near_expiry_days)) pc.near_expiry_days = near === '' ? null : Number(near);
      if (hsn !== s.hsn_code) pc.hsn_code = hsn;
      if (Number(gst) !== Number(s.gst_rate)) pc.gst_rate = gst;
      if (Object.keys(pc).length) {
        await q.query(`UPDATE products SET ${Object.keys(pc).map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE product_id = ?`, [...Object.values(pc), by(req), s.product_id]);
        const lbl = { shelf_life_months: 'shelf life months', track_batches: 'batch tracking', near_expiry_days: 'warn days before expiry', hsn_code: 'HSN', gst_rate: 'GST %' };
        for (const k of Object.keys(pc)) chg(`${lbl[k]} (product)`, k === 'track_batches' ? (Number(s.track_batches) ? 'on' : 'off') : s[k], k === 'track_batches' ? (pc[k] ? 'on' : 'off') : pc[k] ?? 'default');
      }
      await syncSellable(q, s.product_id);
    }
    if (subs) {
      const [old] = await q.query('SELECT sub_sku_code FROM sku_substitutes WHERE sku_code = ? ORDER BY sort_order', [code]);
      const was = old.map((x) => x.sub_sku_code).join(', ');
      if (was !== subs.join(', ')) {
        chg('substitutes', was || 'none', subs.join(', ') || 'none');
        await q.query('DELETE FROM sku_substitutes WHERE sku_code = ?', [code]);
        for (const [i, c] of subs.entries()) await q.query('INSERT INTO sku_substitutes (sku_code, sub_sku_code, sort_order) VALUES (?, ?, ?)', [code, c, i + 1]);
      }
    }
    if (reorder) {
      const now = await reorderMap(q, [code]);
      for (const [g, v] of Object.entries(ro)) {
        if (now.get(code, Number(g)) === v) continue;
        const gn = (gList.find((x) => x.godown_id === Number(g)) || {}).name || g;
        chg(`reorder level, ${gn}`, now.get(code, Number(g)), v);
        await q.query(`INSERT INTO stock_levels (sku_code, location_id, reorder_level, updated_by, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE reorder_level = VALUES(reorder_level), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`, [code, Number(g), v, by(req)]);
      }
    }
    if (units) {
      const [old] = await q.query('SELECT unit_code, base_qty FROM sku_units WHERE sku_code = ? ORDER BY unit_code', [code]);
      const was = old.map((u) => `1 ${u.unit_code} = ${Number(u.base_qty)}`).join(', ');
      const nowU = [...unitRows].sort((a, c) => (a.unit_code < c.unit_code ? -1 : 1)).map((u) => `1 ${u.unit_code} = ${u.base_qty}`).join(', ');
      if (was !== nowU) {
        chg('unit conversions', was || 'none', nowU || 'none');
        await q.query('DELETE FROM sku_units WHERE sku_code = ?', [code]);
        for (const u of unitRows) await q.query('INSERT INTO sku_units (sku_code, unit_code, base_qty) VALUES (?, ?, ?)', [code, u.unit_code, u.base_qty]);
      }
    }
    const n = Object.keys(changes).length;
    if (n) await audit(q, { empId: by(req), action: 'update', entity: 'sku', entityId: code, before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])), after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])) });
    return { message: `${code} saved: ${n} change${n === 1 ? '' : 's'} in the audit log.${cartMsg}${costMsg}`, waiting: Boolean(costMsg), sku: await skuOut(q, req, code) };
  }), { content: true });
  secondAdmin.on('stdcost', {
    async apply(q, p, empId) {
      const [[s]] = await q.query('SELECT std_cost FROM skus WHERE sku_code = ? FOR UPDATE', [p.sku]);
      if (!s) return;
      await q.query('UPDATE skus SET std_cost = ? WHERE sku_code = ?', [p.value, p.sku]);
      await audit(q, { empId, action: 'update', entity: 'sku', entityId: p.sku, before: { 'standard cost': s.std_cost === null ? 'not set' : money(s.std_cost) }, after: { 'standard cost': p.value === null ? 'not set' : money(p.value), approved: true } });
    },
  });

  // ---------------- barcodes: add / remove on a SKU, scan anywhere, link an unknown one
  route('post', '/catalogue/skus/:code/barcodes', 'products:edit', async (req) => tx(async (q) => {
    const code = String(req.params.code).toUpperCase();
    const [[s]] = await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [code]);
    if (!s) throw new InputError('No such SKU', 404);
    const bc = String((req.body || {}).barcode || '').trim().toUpperCase();
    const kind = String((req.body || {}).kind || 'supplier');
    const why = await barcodeProblem(q, bc, kind);
    if (why) throw new InputError(why, 409);
    await q.query('INSERT INTO sku_barcodes (barcode, sku_code, kind, created_by) VALUES (?, ?, ?, ?)', [bc, code, kind, by(req)]);
    await q.query('DELETE FROM unknown_barcodes WHERE barcode = ?', [bc]);
    await audit(q, { empId: by(req), action: 'create', entity: 'barcode', entityId: code, after: { barcode: `${bc} (${BKIND[kind]})` } });
    return { message: `${bc} now finds ${code}.` };
  }));
  route('delete', '/catalogue/skus/:code/barcodes/:barcode', 'products:edit', async (req) => tx(async (q) => {
    const code = String(req.params.code).toUpperCase();
    const bc = String(req.params.barcode).toUpperCase();
    const [[r]] = await q.query('SELECT barcode, kind FROM sku_barcodes WHERE barcode = ? AND sku_code = ? FOR UPDATE', [bc, code]);
    if (!r) throw new InputError('That barcode is not on this SKU (its own code and SKU#C cannot be removed).', 404);
    await q.query('DELETE FROM sku_barcodes WHERE barcode = ?', [bc]);
    await audit(q, { empId: by(req), action: 'delete', entity: 'barcode', entityId: code, before: { barcode: `${bc} (${BKIND[r.kind]})` } });
    return { message: `${bc} removed: scanning it no longer finds ${code}.` };
  }));
  // any barcode -> the SKU (Barcodes and labels, Scan tab). Someone who cannot link it notes it for the office.
  route('post', '/catalogue/scan', 'any', async (req) => tx(async (q) => {
    if (!['products', 'inventory', 'packing'].some((sec) => canDo(req, sec, 'view'))) throw new InputError('Not allowed', 403);
    const hit = await resolve(q, (req.body || {}).code);
    if (!hit) throw new InputError('Scan or type a barcode.');
    if (hit.sku) {
      const st = (await stockMap(q, [hit.sku])).get(hit.sku) || {};
      return { ...hit, stock: st };
    }
    const canLink = canDo(req, 'products', 'edit');
    if (hit.unknown && !canLink) {
      await q.query(`INSERT INTO unknown_barcodes (barcode, scanned_by) VALUES (?, ?) ON DUPLICATE KEY UPDATE times = times + 1, scanned_at = UTC_TIMESTAMP(), scanned_by = VALUES(scanned_by)`, [hit.code, by(req)]);
      await audit(q, { empId: by(req), action: 'create', entity: 'barcode', entityId: hit.code, after: { reported: 'unknown barcode, for the office' } });
    }
    return { ...hit, can_link: canLink, noted: hit.unknown && !canLink };
  }));
  route('get', '/catalogue/barcodes', 'products:view', async () => {
    const [rows] = await db.query(`SELECT b.barcode, b.kind, b.sku_code, ${SKU_NAME} AS name, (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
      FROM sku_barcodes b JOIN skus s ON s.sku_code = b.sku_code ${SKU_JOIN} ORDER BY FIELD(b.kind, 'supplier', 'carton'), b.sku_code`);
    const [skus] = await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.sku_type, (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
      FROM skus s ${SKU_JOIN} WHERE s.status <> 'archived' ORDER BY s.sku_type, s.sku_code`);
    const [unknown] = await db.query(`SELECT u.barcode, u.scanned_by, u.scanned_at, u.times, TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS who
      FROM unknown_barcodes u LEFT JOIN \`${DADMIN}\`.employee e ON e.emp_id = u.scanned_by ORDER BY u.scanned_at DESC`);
    const own = skus.map((s) => ({ barcode: s.sku_code, kind: 'own', sku_code: s.sku_code, name: s.name, image: s.image }));
    return { rows: [...rows, ...own].map((r) => ({ ...r, kind_label: BKIND[r.kind] })), unknown, skus: skus.map((s) => ({ sku_code: s.sku_code, name: s.name, type: s.sku_type })) };
  });
  route('post', '/catalogue/barcodes/link', 'products:edit', async (req) => tx(async (q) => {
    const b = req.body || {};
    const bc = String(b.barcode || '').trim().toUpperCase();
    const code = String(b.sku_code || '').trim().toUpperCase();
    const kind = String(b.kind || 'supplier');
    const [[s]] = await q.query("SELECT sku_code FROM skus WHERE sku_code = ? AND status <> 'archived'", [code]);
    if (!s) throw new InputError('Choose the SKU.');
    const why = await barcodeProblem(q, bc, kind);
    if (why) throw new InputError(why, 409);
    await q.query('INSERT INTO sku_barcodes (barcode, sku_code, kind, created_by) VALUES (?, ?, ?, ?)', [bc, code, kind, by(req)]);
    await q.query('DELETE FROM unknown_barcodes WHERE barcode = ?', [bc]);
    await audit(q, { empId: by(req), action: 'create', entity: 'barcode', entityId: code, after: { barcode: `${bc} (${BKIND[kind]})`, linked: 'scanned, not yet linked' } });
    return { message: `Linked: ${bc} now finds ${code}.` };
  }));

  // ---------------- raw materials
  route('get', '/catalogue/raw', 'products:view', async () => {
    const [rows] = await db.query(`SELECT s.sku_code, s.raw_name AS name, s.unit_code, u.name AS unit, s.status, s.source, s.weight_kg FROM skus s LEFT JOIN units u ON u.unit_code = s.unit_code
      WHERE s.sku_type = 'raw' ORDER BY s.sku_code`);
    const stock = await stockMap(db, rows.map((r) => r.sku_code));
    const [units] = await db.query('SELECT unit_code, name FROM units ORDER BY sort_order, name');
    return { rows: rows.map((r) => ({ ...r, status_label: SKU_STATUS[r.status], ready: Number(r.weight_kg) > 0, stock: stock.get(r.sku_code) || { all: 0 } })), units, godowns: await godownList(db) };
  });
  route('post', '/catalogue/raw', 'products:create', async (req) => tx(async (q) => {
    const b = req.body || {};
    const code = String(b.sku_code || '').trim().toUpperCase();
    const name = String(b.name || '').trim().slice(0, 60);
    const unit = String(b.unit_code || '').trim();
    const err = {};
    if (!/^RM-[A-Z0-9]{2,10}$/.test(code)) err.sku_code = 'RM- and 2 to 10 letters or digits, like RM-GLUE.';
    else if ((await resolve(q, code)).sku) err.sku_code = `${code} is already used.`;
    if (!name) err.name = 'Give it a name.';
    const [[u]] = await q.query('SELECT unit_code FROM units WHERE unit_code = ?', [unit]);
    if (!u) err.unit_code = 'Choose what it is counted in.';
    if (Object.keys(err).length) bad(err);
    await q.query(`INSERT INTO skus (sku_code, product_id, sku_type, raw_name, unit_code, size_label, sell_unit, source, status, is_active, created_by)
      VALUES (?, NULL, 'raw', ?, ?, ?, 'pack', 'bought', 'active', 0, ?)`, [code, name, unit, unit, by(req)]);
    await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, 1, ?)', [code, pricing.istToday(), by(req)]);
    await audit(q, { empId: by(req), action: 'create', entity: 'sku', entityId: code, after: { raw_material: name, unit } });
    return { sku_code: code, message: `${code} added. Set its weight.` };
  }));

  // ---------------- units of measure
  route('get', '/catalogue/units', 'products:view', async () => {
    const [rows] = await db.query(`SELECT u.unit_code, u.name,
        (SELECT COUNT(*) FROM skus s WHERE s.sku_type = 'raw' AND s.unit_code = u.unit_code) + (SELECT COUNT(DISTINCT su.sku_code) FROM sku_units su WHERE su.unit_code = u.unit_code)
        + IF(u.unit_code IN ('pack','carton'), (SELECT COUNT(*) FROM skus s WHERE s.sku_type = 'finished'), 0) AS used
      FROM units u ORDER BY u.sort_order, u.name`);
    return rows.map((r) => ({ ...r, used: Number(r.used) }));
  });
  route('post', '/catalogue/units', 'products:create', async (req) => tx(async (q) => {
    const name = String((req.body || {}).name || '').trim().slice(0, 40);
    const code = String((req.body || {}).unit_code || '').trim().toLowerCase();
    if (!name || !/^[a-z]{2,12}$/.test(code)) throw new InputError('Give a name and a code of 2 to 12 small letters.');
    const [[dup]] = await q.query('SELECT unit_code FROM units WHERE unit_code = ? OR LOWER(name) = LOWER(?)', [code, name]);
    if (dup) throw new InputError('That unit already exists.', 409);
    const [[mx]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM units');
    await q.query('INSERT INTO units (unit_code, name, sort_order, created_by) VALUES (?, ?, ?, ?)', [code, name, mx.n, by(req)]);
    await audit(q, { empId: by(req), action: 'create', entity: 'unit', entityId: code, after: { name } });
    return { message: `Unit added: ${name}.` };
  }));
  route('delete', '/catalogue/units/:code', 'products:edit', async (req) => tx(async (q) => {
    const [[u]] = await q.query('SELECT unit_code, name FROM units WHERE unit_code = ? FOR UPDATE', [req.params.code]);
    if (!u) throw new InputError('No such unit', 404);
    const [[a]] = await q.query("SELECT COUNT(*) AS n FROM skus WHERE sku_type = 'raw' AND unit_code = ?", [u.unit_code]);
    const [[c]] = await q.query('SELECT COUNT(DISTINCT sku_code) AS n FROM sku_units WHERE unit_code = ?', [u.unit_code]);
    const [[f]] = ['pack', 'carton'].includes(u.unit_code) ? await q.query("SELECT COUNT(*) AS n FROM skus WHERE sku_type = 'finished'") : [[{ n: 0 }]];
    const n = Number(a.n) + Number(c.n) + Number(f.n);
    if (n) throw new InputError(`Cannot remove ${u.name}: it is used by ${n} SKU${n === 1 ? '' : 's'}${Number(a.n) ? ' (raw materials are counted in it)' : ''}.`, 409);
    await q.query('DELETE FROM units WHERE unit_code = ?', [u.unit_code]);
    await audit(q, { empId: by(req), action: 'delete', entity: 'unit', entityId: u.unit_code, before: { name: u.name } });
    return { message: `Unit removed: ${u.name}.` };
  }));

  // ---------------- kits
  async function kitsOut(q, keys = null) {
    const [rows] = await q.query(`SELECT k.kit_key, k.kit_code, k.sort_order, k.business_type, k.rep_product_id, k.is_active, k.status, k.price,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = k.rep_product_id ORDER BY pi.position LIMIT 1) AS image
      FROM kits k ${keys ? 'WHERE k.kit_key IN (?)' : ''} ORDER BY k.sort_order, k.kit_key`, keys ? [keys] : []);
    const [trs] = await q.query('SELECT kit_key, lang_code, name, tagline FROM kit_translations');
    const gList = await godownList(q);
    const av = await kitAvailability(q, rows.map((r) => r.kit_key), gList);
    return rows.map((k) => ({
      kit_key: k.kit_key, kit_code: k.kit_code, business_type: k.business_type, rep_product_id: k.rep_product_id, image: k.image, on_site: Number(k.is_active) === 1, status: k.status,
      price: k.price === null ? null : Number(k.price), sort_order: Number(k.sort_order),
      name: Object.fromEntries(trs.filter((t) => t.kit_key === k.kit_key).map((t) => [t.lang_code, t.name])),
      tagline: Object.fromEntries(trs.filter((t) => t.kit_key === k.kit_key).map((t) => [t.lang_code, t.tagline])),
      ...(av.get(k.kit_key) || { parts: [], avail: {} }),
    }));
  }
  route('get', '/catalogue/kits', 'products:view', async () => {
    const [biz] = await db.query(`SELECT o.option_value AS value, COALESCE(t.label, o.option_value) AS label FROM form_options o
      LEFT JOIN form_option_translations t ON t.list_key = o.list_key AND t.option_value = o.option_value AND t.lang_code = 'en' WHERE o.list_key = 'business_type' ORDER BY o.sort_order`);
    const [opts] = await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.status, p.status AS product_status FROM skus s ${SKU_JOIN} WHERE s.sku_type = 'finished' ORDER BY s.sku_code`);
    const [prods] = await db.query("SELECT p.product_id, COALESCE(t.name, p.product_id) AS name, (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.product_id) AS images FROM products p LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = 'en' ORDER BY p.product_id");
    const [langs] = await db.query('SELECT lang_code, name_en FROM languages WHERE is_active = 1 ORDER BY is_default DESC, sort_order');
    return { kits: await kitsOut(db), godowns: await godownList(db), business_types: biz, skus: opts, products: prods.map((p) => ({ ...p, images: Number(p.images) })), languages: langs, basis: (await pricing.basis(db)).short };
  });
  async function saveKit(q, req, key) {
    const b = req.body || {};
    const isNew = !key;
    const [[k]] = isNew ? [[null]] : await q.query('SELECT * FROM kits WHERE kit_key = ? FOR UPDATE', [key]);
    if (!isNew && !k) throw new InputError('No such kit', 404);
    const err = {};
    const parts = [];
    for (const [i, pt] of (Array.isArray(b.parts) ? b.parts : []).entries()) {
      const c = String(pt.sku_code || '').trim().toUpperCase();
      if (!c) continue;
      if (!whole(String(pt.qty ?? ''), 1)) { err[`parts.${i}`] = 'Quantity must be a whole number, 1 or more.'; continue; }
      if (parts.some((x) => x.sku_code === c)) { err[`parts.${i}`] = `${c} is already in the kit. Use one line with a bigger quantity.`; continue; }
      const [[s]] = await q.query('SELECT s.sku_code, s.status, s.sku_type, s.weight_kg, p.status AS ps, p.hsn_code FROM skus s LEFT JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [c]);
      if (!s || s.sku_type !== 'finished' || s.status !== 'active' || ['draft', 'archived'].includes(s.ps)) { err[`parts.${i}`] = `${c} is not sold, so it cannot go into a kit.`; continue; }
      if (!ready(s)) { err[`parts.${i}`] = `${c} is not ready to sell (weight or HSN missing).`; continue; }
      parts.push({ sku_code: c, qty: Number(pt.qty) });
    }
    if (!Object.keys(err).length && parts.length < 2) err['parts.0'] = 'A kit needs at least two different packs.';
    const [langs] = await q.query('SELECT lang_code FROM languages WHERE is_active = 1');
    const nm = {};
    const tg = {};
    for (const l of langs) { nm[l.lang_code] = String((b.name || {})[l.lang_code] || '').trim().slice(0, 100); tg[l.lang_code] = String((b.tagline || {})[l.lang_code] || '').trim().slice(0, 255); }
    const web = Boolean(b.on_site);
    const rep = String(b.rep_product_id || '').trim() || null;
    const type = String(b.business_type || '').trim().slice(0, 40);
    const st = b.status === 'hidden' ? 'hidden' : 'active';
    const priceIn = String(b.price ?? '').trim();
    if (!nm.en) err['name.en'] = 'Type the English name.';
    else {
      const [[dup]] = await q.query("SELECT kit_key FROM kit_translations WHERE lang_code = 'en' AND LOWER(name) = LOWER(?) AND kit_key <> ?", [nm.en, key || '']);
      if (dup) err['name.en'] = 'Another kit has this name.';
    }
    if (web && !tg.en) err['tagline.en'] = 'A kit on the website needs its English tagline.';
    if (!tg.en && !web) tg.en = ''; // a staff-only kit may have no tagline
    if (!rep) err.rep_product_id = 'Choose the photo.';
    else {
      const [[img]] = await q.query('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [rep]);
      if (!Number(img.n)) err.rep_product_id = 'That product has no picture.';
    }
    if (!type) err.business_type = 'Choose the business type.';
    if (web && st !== 'active') err.status = 'A kit on the website must be sold.';
    let price = null;
    if (priceIn !== '') {
      if (!(Number(priceIn) > 0) || !/^\d+(\.\d{1,2})?$/.test(priceIn)) err.price = 'More than 0, at most 2 decimals, or leave it empty.';
      else price = Number(priceIn);
    }
    if (Object.keys(err).length) bad(err);
    let kk = key;
    if (isNew) {
      const [[mx]] = await q.query("SELECT COALESCE(MAX(CAST(SUBSTRING(kit_code, 5) AS UNSIGNED)), 0) + 1 AS n FROM kits WHERE kit_code LIKE 'KIT-%'");
      kk = `kit${mx.n}`;
      const [[so]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM kits');
      await q.query('INSERT INTO kits (kit_key, kit_code, sort_order, business_type, rep_product_id, is_active, status, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [kk, `KIT-${String(mx.n).padStart(2, '0')}`, so.n, type, rep, web ? 1 : 0, st, price]);
    } else {
      await q.query('UPDATE kits SET business_type = ?, rep_product_id = ?, is_active = ?, status = ?, price = ? WHERE kit_key = ?', [type, rep, web ? 1 : 0, st, price, kk]);
    }
    const [oldParts] = await q.query('SELECT sku_code, qty FROM kit_parts WHERE kit_key = ? ORDER BY sort_order', [kk]);
    const [oldTr] = await q.query('SELECT lang_code, name, tagline FROM kit_translations WHERE kit_key = ?', [kk]);
    await q.query('DELETE FROM kit_parts WHERE kit_key = ?', [kk]);
    for (const [i, pt] of parts.entries()) await q.query('INSERT INTO kit_parts (kit_key, sku_code, qty, sort_order) VALUES (?, ?, ?, ?)', [kk, pt.sku_code, pt.qty, i + 1]);
    // the website's list of the kit's products follows the parts (one row per product, in part order)
    await q.query('DELETE FROM kit_products WHERE kit_key = ?', [kk]);
    const [pp] = await q.query('SELECT s.product_id, MIN(kp.sort_order) AS o FROM kit_parts kp JOIN skus s ON s.sku_code = kp.sku_code WHERE kp.kit_key = ? GROUP BY s.product_id ORDER BY o', [kk]);
    for (const [i, x] of pp.entries()) await q.query('INSERT INTO kit_products (kit_key, product_id, sort_order) VALUES (?, ?, ?)', [kk, x.product_id, i + 1]);
    for (const l of langs) {
      if (!nm[l.lang_code] && l.lang_code !== 'en') { await q.query('DELETE FROM kit_translations WHERE kit_key = ? AND lang_code = ?', [kk, l.lang_code]); continue; }
      await q.query('INSERT INTO kit_translations (kit_key, lang_code, name, tagline) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), tagline = VALUES(tagline)',
        [kk, l.lang_code, nm[l.lang_code] || nm.en, tg[l.lang_code] || (l.lang_code === 'en' ? '' : tg.en)]);
    }
    const desc = (ps) => ps.map((x) => `${x.qty} x ${x.sku_code}`).join(', ');
    const before = isNew ? null : { parts: desc(oldParts), on_site: Number(k.is_active) ? 'on' : 'off', status: k.status, price: k.price === null ? 'none' : money(k.price), business_type: k.business_type, photo: k.rep_product_id,
      ...Object.fromEntries(oldTr.flatMap((t) => [[`name (${t.lang_code.toUpperCase()})`, t.name], [`tagline (${t.lang_code.toUpperCase()})`, t.tagline]])) };
    const after = { parts: desc(parts), on_site: web ? 'on' : 'off', status: st, price: price === null ? 'none' : money(price), business_type: type, photo: rep,
      ...Object.fromEntries(langs.filter((l) => nm[l.lang_code] || l.lang_code === 'en').flatMap((l) => [[`name (${l.lang_code.toUpperCase()})`, nm[l.lang_code] || nm.en], [`tagline (${l.lang_code.toUpperCase()})`, tg[l.lang_code] || tg.en]])) };
    await audit(q, { empId: by(req), action: isNew ? 'create' : 'update', entity: 'kit', entityId: kk, before, after });
    return { kit_key: kk, message: isNew ? `Kit created: ${nm.en}${web ? ', shown on the website' : ''}.` : 'Kit saved.', kit: (await kitsOut(q, [kk]))[0] };
  }
  route('post', '/catalogue/kits', 'products:create', async (req) => tx((q) => saveKit(q, req, null)), { content: true });
  route('put', '/catalogue/kits/:key', 'products:edit', async (req) => tx((q) => saveKit(q, req, req.params.key)), { content: true });

  // ---------------- categories (v23: order waits for Save; a used category stays shown; an empty one cannot be shown)
  route('get', '/catalogue/categories', 'products:view', async () => {
    const [rows] = await db.query(`SELECT c.category_key, c.sort_order, c.is_active, c.rep_product_id,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = c.rep_product_id ORDER BY pi.position LIMIT 1) AS image,
        (SELECT COUNT(*) FROM products p WHERE p.category_key = c.category_key) AS products,
        (SELECT COUNT(*) FROM products p WHERE p.category_key = c.category_key AND p.status = 'active') AS active
      FROM categories c ORDER BY c.sort_order, c.category_key`);
    const [trs] = await db.query('SELECT category_key, lang_code, name FROM category_translations');
    const [langs] = await db.query('SELECT lang_code, name_en FROM languages WHERE is_active = 1 ORDER BY is_default DESC, sort_order');
    const [prods] = await db.query("SELECT p.product_id, p.category_key, COALESCE(t.name, p.product_id) AS name FROM products p LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = 'en' ORDER BY p.sort_order");
    return { rows: rows.map((c) => ({ ...c, is_active: Number(c.is_active) === 1, products: Number(c.products), active: Number(c.active),
      name: Object.fromEntries(trs.filter((t) => t.category_key === c.category_key).map((t) => [t.lang_code, t.name])) })), languages: langs, products: prods };
  });
  route('post', '/catalogue/categories/order', 'products:edit', async (req) => tx(async (q) => {
    const order = Array.isArray((req.body || {}).order) ? req.body.order.map(String) : [];
    const [rows] = await q.query('SELECT c.category_key, COALESCE(t.name, c.category_key) AS name FROM categories c LEFT JOIN category_translations t ON t.category_key = c.category_key AND t.lang_code = \'en\' ORDER BY c.sort_order FOR UPDATE');
    if (order.length !== rows.length || rows.some((r) => !order.includes(r.category_key))) throw new InputError('Send every category once.');
    const before = rows.map((r) => r.name).join(', ');
    for (const [i, k] of order.entries()) await q.query('UPDATE categories SET sort_order = ? WHERE category_key = ?', [i + 1, k]);
    const after = order.map((k) => rows.find((r) => r.category_key === k).name).join(', ');
    if (before !== after) await audit(q, { empId: by(req), action: 'reorder', entity: 'category', entityId: 'all', before: { order: before }, after: { order: after } });
    return { message: 'Order saved: the website shows the categories in this order.' };
  }), { content: true });
  route('post', '/catalogue/categories/:key/active', 'products:edit', async (req) => tx(async (q) => {
    const [[c]] = await q.query('SELECT category_key, is_active FROM categories WHERE category_key = ? FOR UPDATE', [req.params.key]);
    if (!c) throw new InputError('No such category', 404);
    const on = Boolean((req.body || {}).on);
    const [[nm]] = await q.query("SELECT name FROM category_translations WHERE category_key = ? AND lang_code = 'en'", [c.category_key]);
    const name = nm ? nm.name : c.category_key;
    const [[act]] = await q.query("SELECT COUNT(*) AS n FROM products WHERE category_key = ? AND status = 'active'", [c.category_key]);
    if (!on && Number(act.n)) throw new InputError(`Cannot hide ${name}: it has ${act.n} active product${Number(act.n) === 1 ? '' : 's'}. Move or hide them first: a visible product cannot sit in a hidden category.`, 409);
    if (on && !Number(act.n)) throw new InputError(`Cannot show ${name}: it has no active product yet; an empty category is not shown.`, 409);
    if (Number(c.is_active) === (on ? 1 : 0)) return { message: `${name} is already ${on ? 'shown' : 'hidden'}.` };
    await q.query('UPDATE categories SET is_active = ? WHERE category_key = ?', [on ? 1 : 0, c.category_key]);
    await audit(q, { empId: by(req), action: 'update', entity: 'category', entityId: c.category_key, before: { website: on ? 'hidden' : 'shown' }, after: { website: on ? 'shown' : 'hidden' } });
    return { message: `${name} is ${on ? 'on the website' : 'hidden'}.` };
  }), { content: true });
  async function saveCategory(q, req, key) {
    const b = req.body || {};
    const [langs] = await q.query('SELECT lang_code FROM languages WHERE is_active = 1');
    const nm = Object.fromEntries(langs.map((l) => [l.lang_code, String((b.name || {})[l.lang_code] || '').trim().slice(0, 40)]));
    const rep = String(b.rep_product_id || '').trim() || null;
    const err = {};
    if (!nm.en) err['name.en'] = 'Type the English name.';
    else {
      const [[dup]] = await q.query("SELECT category_key FROM category_translations WHERE lang_code = 'en' AND LOWER(name) = LOWER(?) AND category_key <> ?", [nm.en, key || '']);
      if (dup) err['name.en'] = 'There is already a category called this.';
    }
    if (key && !rep) err.rep_product_id = 'Choose the product whose picture the tile shows.';
    if (rep) { const [[p]] = await q.query('SELECT product_id FROM products WHERE product_id = ? AND category_key = ?', [rep, key || '']); if (!p) err.rep_product_id = 'Choose one of its own products.'; }
    if (Object.keys(err).length) bad(err);
    let k = key;
    let before = null;
    if (!k) {
      k = nm.en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'cat';
      while ((await q.query('SELECT category_key FROM categories WHERE category_key = ?', [k]))[0].length) k = `${k.slice(0, 28)}x`;
      const [[mx]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories');
      await q.query('INSERT INTO categories (category_key, sort_order, rep_product_id, is_active) VALUES (?, ?, NULL, 0)', [k, mx.n]);
    } else {
      const [[c]] = await q.query('SELECT rep_product_id FROM categories WHERE category_key = ? FOR UPDATE', [k]);
      if (!c) throw new InputError('No such category', 404);
      const [old] = await q.query('SELECT lang_code, name FROM category_translations WHERE category_key = ?', [k]);
      before = { picture: c.rep_product_id, ...Object.fromEntries(old.map((t) => [`name (${t.lang_code.toUpperCase()})`, t.name])) };
      await q.query('UPDATE categories SET rep_product_id = ? WHERE category_key = ?', [rep, k]);
    }
    for (const l of langs) {
      if (!nm[l.lang_code]) { if (l.lang_code !== 'en') await q.query('DELETE FROM category_translations WHERE category_key = ? AND lang_code = ?', [k, l.lang_code]); continue; }
      await q.query('INSERT INTO category_translations (category_key, lang_code, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [k, l.lang_code, nm[l.lang_code]]);
    }
    const after = { picture: key ? rep : null, ...Object.fromEntries(langs.filter((l) => nm[l.lang_code]).map((l) => [`name (${l.lang_code.toUpperCase()})`, nm[l.lang_code]])) };
    await audit(q, { empId: by(req), action: key ? 'update' : 'create', entity: 'category', entityId: k, before, after });
    const missing = langs.filter((l) => !nm[l.lang_code]).map((l) => l.lang_code.toUpperCase());
    return { category_key: k, message: key ? 'Saved.' : `Category added: ${nm.en} is hidden and last.${missing.length ? ` Its ${missing.join(' and ')} name is missing.` : ''}` };
  }
  route('post', '/catalogue/categories', 'products:create', async (req) => tx((q) => saveCategory(q, req, null)), { content: true });
  route('put', '/catalogue/categories/:key', 'products:edit', async (req) => tx((q) => saveCategory(q, req, req.params.key)), { content: true });

  // ---------------- label data (Barcodes and labels, Print labels): what a pack label must carry
  route('get', '/catalogue/labels', 'products:view', async () => {
    const [rows] = await db.query(`SELECT s.sku_code, s.sku_type, s.size_label, s.net_qty, s.mrp, s.packs_per_carton, s.status, p.category_key, p.brand, p.packed_by, p.origin, ${SKU_NAME} AS name,
        (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image,
        (SELECT GROUP_CONCAT(b.barcode) FROM sku_barcodes b WHERE b.sku_code = s.sku_code AND b.kind = 'carton') AS carton_codes
      FROM skus s ${SKU_JOIN} WHERE s.status <> 'archived' ORDER BY s.sku_type, s.sku_code`);
    const [cats] = await db.query('SELECT category_key, lang_code, name FROM category_translations');
    const ro = await reorderMap(db, rows.map((r) => r.sku_code));
    const gList = await godownList(db);
    const f = await company.facts(db);
    const [words] = await db.query('SELECT t.text_key, t.lang_code, t.value FROM ui_text t JOIN ui_text_keys k ON k.text_key = t.text_key WHERE k.group_name = ?', [LABEL_GROUP]);
    const [langs] = await db.query('SELECT lang_code, name_en FROM languages WHERE is_active = 1 ORDER BY is_default DESC, sort_order');
    const en = Object.fromEntries(words.filter((w) => w.lang_code === 'en').map((w) => [w.text_key, w.value]));
    return {
      languages: langs, words: Object.fromEntries(langs.map((l) => [l.lang_code, { ...en, ...Object.fromEntries(words.filter((w) => w.lang_code === l.lang_code).map((w) => [w.text_key, w.value])) }])),
      rows: rows.map((r) => ({ ...r, mrp: r.mrp === null ? null : Number(r.mrp), packs_per_carton: Number(r.packs_per_carton), carton_code: r.carton_codes ? r.carton_codes.split(',')[0] : `${r.sku_code}#C`,
        reorder: gList.length ? ro.get(r.sku_code, gList[0].godown_id) : ro.def,
        category: r.category_key ? Object.fromEntries(cats.filter((c) => c.category_key === r.category_key).map((c) => [c.lang_code, c.name])) : null })),
      company: { name: f.name, address: f.address, phone: f.phone, email: f.email },
    };
  });

  // phase 15: also today's GST rate on each product, so a rate that starts today (tax.js) shows as "GST today"
  nightlyRun = () => tx(async (q) => { await tax.syncProductGst(q); return nightly(q, 'SYSTEM'); });
  return { nightly };
}

// the nightly check, once per India day after 02:00 (a discontinued product whose stock reached zero is archived)
let nightlyRun = null;
let timer = null;
let lastDay = '';
function startNightly() {
  if (timer) return;
  timer = setInterval(() => {
    const now = new Date(Date.now() + 330 * 60000);
    const day = now.toISOString().slice(0, 10);
    if (!nightlyRun || day === lastDay || now.getUTCHours() < 2) return;
    lastDay = day;
    nightlyRun().then((done) => { if (done.length) console.log(`nightly check archived ${done.join(', ')}`); }).catch((e) => console.error('nightly check failed:', e.code || e.message));
  }, 15 * 60 * 1000);
  timer.unref();
}

module.exports = { register, startNightly, resolve, scanCode, eanOk, skuCodeFor, mrpProblems, pricesWithGst, syncSellable, activeProblems, STATUS, SKU_STATUS, SOURCE, SELL, BKIND, SKU_NAME, SKU_JOIN, ready };
