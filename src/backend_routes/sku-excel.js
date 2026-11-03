// The "SKUs" sheet of the products Excel (phase 14, v23 import / export, tests 1.16 and 1.30): one row per pack we sell,
// exported with the Products sheet and imported with it (dry run first: every row checked, nothing saved until the
// whole file is clean; Apply re-checks inside its transaction). A new SKU code must be the one its pack makes
// (DF001-M200 for "Pack of 200") and its product must exist; a SKU never moves to another product. The same rules as
// the SKU panel: carton multiples, batch tracking for anything that expires, EAN-13 check digit, one barcode one SKU,
// MRP never below a price with GST, a discontinued pack never made active by an import, an archived one never brought
// back, nothing with stock archived. The mrp column is optional (old files without it still import). Shelf life,
// batch, HSN and GST belong to the product: its packs must agree. The standard cost is not in the file: it is See cost
// only, and lowering it waits for a second Admin (the SKU panel).
const { audit } = require('./audit');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const catalogue = require('./catalogue');

const COLS = ['sku', 'product', 'category', 'name', 'pack', 'made_or_bought', 'packs_per_carton', 'sold_as', 'min_order', 'in_steps_of', 'weight_kg',
  'shelf_life_months', 'batch', 'hsn', 'gst', 'supplier_ean', 'status'];
const ALL = [...COLS, 'mrp'];
const WIDTHS = { sku: 16, product: 16, category: 12, name: 30, pack: 22, made_or_bought: 14 };
const whole = (v, min) => /^\d+$/.test(String(v)) && Number(v) >= min;
const num = (v) => (v === null || v === undefined ? '' : String(Number(v)));

/** every finished SKU as a sheet row (strings, as they are compared) */
async function currentRows(q) {
  const [rows] = await q.query(`SELECT s.sku_code, s.product_id, p.category_key, t.name, s.size_label, s.source, s.packs_per_carton, s.sell_unit, s.min_order_qty, s.step_qty,
      s.weight_kg, p.shelf_life_months, p.track_batches, p.hsn_code, p.gst_rate, s.status, s.mrp,
      (SELECT MIN(b.barcode) FROM sku_barcodes b WHERE b.sku_code = s.sku_code AND b.kind = 'supplier') AS ean
    FROM skus s JOIN products p ON p.product_id = s.product_id LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
    WHERE s.sku_type = 'finished' ORDER BY s.sku_code`);
  return rows.map((r) => ({
    sku: r.sku_code, product: r.product_id, category: r.category_key, name: r.name || '', pack: r.size_label, made_or_bought: r.source, packs_per_carton: String(r.packs_per_carton),
    sold_as: r.sell_unit, min_order: String(r.min_order_qty), in_steps_of: String(r.step_qty), weight_kg: num(r.weight_kg), shelf_life_months: String(r.shelf_life_months),
    batch: Number(r.track_batches) ? 'yes' : 'no', hsn: r.hsn_code || '', gst: num(r.gst_rate), supplier_ean: r.ean || '', status: r.status, mrp: num(r.mrp),
  }));
}

/** add the SKUs sheet to the products workbook (theme = excel-theme.js) */
async function addSheet(q, wb, theme, meta) {
  const rows = await currentRows(q);
  theme.tableSheet(wb, 'SKUs', { ...meta, title: 'dFresh SKUs (packs)', columns: ALL.map((c) => ({ header: c, width: WIDTHS[c] || 12 })), rows: rows.map((r) => ALL.map((c) => r[c])) });
}

/** dry run of the SKUs sheet -> { errors, changes: [{ sku, kind: new|change, diff }], plan } */
async function diffSheet(q, header, rows) {
  const errors = [];
  const changes = [];
  const plan = [];
  const hd = header.map((h) => String(h || '').trim().toLowerCase());
  const miss = COLS.filter((c) => !hd.includes(c));
  if (miss.length) return { errors: [`SKUs sheet: missing columns ${miss.join(', ')}. Start from Export.`], changes, plan };
  const hasMrp = hd.includes('mrp');
  const cur = new Map((await currentRows(q)).map((r) => [r.sku, r]));
  const [prods] = await q.query("SELECT p.product_id, p.category_key, t.name FROM products p LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = 'en'");
  const prodBy = new Map(prods.map((p) => [p.product_id, p]));
  const [catRows] = await q.query('SELECT category_key FROM categories');
  const cats = new Set(catRows.map((c) => c.category_key));
  const rates = pricing.gstRates(await commerceSettings.read(q));
  const seen = new Set();
  const seenEan = new Set();
  const perProduct = new Map();
  for (const r of rows) {
    const o = Object.fromEntries(ALL.map((c) => [c, String(r[c] ?? '').trim()]));
    o.sku = o.sku.toUpperCase();
    o.supplier_ean = o.supplier_ean.toUpperCase();
    const e = (m) => errors.push(`SKUs row ${r._row} (${o.sku || 'no SKU'}): ${m}`);
    const before = errors.length;
    if (!o.sku) { e('SKU is empty.'); continue; }
    if (seen.has(o.sku)) { e('SKU appears twice in the file.'); continue; }
    seen.add(o.sku);
    const s = cur.get(o.sku);
    const p = prodBy.get(o.product);
    if (!s) {
      const [[raw]] = await q.query('SELECT sku_code FROM skus WHERE sku_code = ?', [o.sku]);
      if (raw) e('is not a pack we sell (a raw material).');
      else if (!p) e(`product ${o.product} does not exist; create it first.`);
      else if (o.sku !== catalogue.skuCodeFor(o.product, o.pack)) e(`a new SKU code must be ${catalogue.skuCodeFor(o.product, o.pack)} for this pack.`);
    } else if (s.product !== o.product) e(`belongs to ${s.product}. A SKU cannot move to another product.`);
    if (!cats.has(o.category)) e(`category "${o.category}" does not exist.`);
    else if (p && p.category_key !== o.category) e('change the category on the product, not here.');
    if (p && o.name !== (p.name || '')) e('the name is changed on the product, not here.');
    if (!o.pack) e('pack is empty.');
    if (!catalogue.SOURCE[o.made_or_bought]) e('made_or_bought must be made, bought or both.');
    const n = o.packs_per_carton;
    if (!whole(n, 1)) e('packs_per_carton must be a whole number, 1 or more.');
    if (!catalogue.SELL[o.sold_as]) e('sold_as must be pack, carton or both.');
    if (!whole(o.min_order, 1)) e('min_order must be a whole number, 1 or more.');
    if (!whole(o.in_steps_of, 1)) e('in_steps_of must be a whole number, 1 or more.');
    if (o.sold_as === 'carton' && whole(n, 1) && whole(o.min_order, 1) && whole(o.in_steps_of, 1) && (Number(o.min_order) % Number(n) || Number(o.in_steps_of) % Number(n))) e(`sold in full cartons, so min_order and in_steps_of must be multiples of ${n}.`);
    else if (whole(o.min_order, 1) && whole(o.in_steps_of, 1) && Number(o.min_order) % Number(o.in_steps_of)) e(`min_order must be a whole number of steps of ${o.in_steps_of}.`);
    if (o.weight_kg !== '' && !(Number(o.weight_kg) > 0)) e('weight_kg must be more than 0 (or empty: the pack is not ready to sell).');
    if (!whole(o.shelf_life_months, 0)) e('shelf_life_months must be 0 or a whole number.');
    if (o.batch !== 'yes' && o.batch !== 'no') e('batch must be yes or no.');
    if (Number(o.shelf_life_months) > 0 && o.batch !== 'yes') e('it expires, so batch must be yes.');
    if (!/^\d{4}(\d{2}){0,2}$/.test(o.hsn)) e('HSN must be 4, 6 or 8 digits.');
    if (o.gst === '' || !rates.includes(Number(o.gst))) e(`GST must be one of ${rates.join(', ')}.`);
    if (hasMrp && o.mrp !== '') {
      if (!(Number(o.mrp) > 0) || !/^\d+(\.\d{1,2})?$/.test(o.mrp)) e('mrp must be more than 0 with at most 2 decimals, or empty.');
      else if (s) {
        const probs = await catalogue.mrpProblems(q, o.sku, Number(o.mrp));
        if (probs.length) e(`mrp ${o.mrp} is below a price with GST: ${probs[0]}.`);
      }
    }
    if (o.supplier_ean) {
      if (!catalogue.eanOk(o.supplier_ean)) e(`supplier_ean ${o.supplier_ean} fails the EAN-13 check digit.`);
      else {
        const hit = await catalogue.resolve(q, o.supplier_ean);
        if (hit && hit.sku && hit.sku !== o.sku) e(`supplier_ean already belongs to ${hit.sku}.`);
        if (seenEan.has(o.supplier_ean)) e('supplier_ean used twice in the file.');
        seenEan.add(o.supplier_ean);
      }
    }
    if (!catalogue.SKU_STATUS[o.status]) e('status must be active, discontinued or archived.');
    if (s && s.status === 'discontinued' && o.status === 'active') e('it is discontinued. An import never makes it Active again: do it on the product, with approval.');
    if (s && s.status === 'archived' && o.status !== 'archived') e('it is archived. An import never brings a pack back: an Admin does it on the product (Bring back).');
    if (s && o.status === 'archived' && s.status !== 'archived') {
      const [[st]] = await q.query('SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ?', [o.sku]);
      if (Number(st.n)) e('it still has stock, so it cannot be archived.');
    }
    // the product's own fields: its packs must agree
    const pf = `${o.shelf_life_months}|${o.batch}|${o.hsn}|${o.gst}`;
    const had = perProduct.get(o.product);
    if (had && had.pf !== pf) e(`shelf_life_months, batch, hsn and gst belong to the product: they must match ${had.sku} (row ${had.row}).`);
    else if (!had) perProduct.set(o.product, { pf, sku: o.sku, row: r._row });
    if (errors.length !== before) continue;
    const keys = hasMrp ? ALL : COLS;
    if (s) {
      const diff = keys.filter((k) => !['sku', 'product', 'category', 'name'].includes(k) && String(o[k]) !== String(s[k])).map((k) => `${k}: ${s[k] || 'empty'} -> ${o[k] || 'empty'}`);
      if (diff.length) { changes.push({ sku: o.sku, kind: 'change', diff }); plan.push({ o, hasMrp, s }); }
    } else { changes.push({ sku: o.sku, kind: 'new', diff: [`new SKU of ${o.product}`] }); plan.push({ o, hasMrp, s: null }); }
  }
  return { errors, changes, plan };
}

/** apply the checked plan inside the caller's transaction -> number of SKUs changed */
async function applySheet(q, plan, empId) {
  const today = pricing.istToday();
  const touched = new Set();
  for (const { o, hasMrp, s } of plan) {
    if (!s) {
      await q.query(`INSERT INTO skus (sku_code, product_id, size_label, source, status, is_active, created_by) VALUES (?, ?, ?, ?, ?, 0, ?)`, [o.sku, o.product, o.pack, o.made_or_bought, o.status, empId]);
      await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, ?, ?)', [o.sku, today, Number(o.packs_per_carton), empId]);
    } else if (Number(o.packs_per_carton) !== Number(s.packs_per_carton)) {
      await q.query('INSERT INTO sku_cartons (sku_code, from_date, packs, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE packs = VALUES(packs), created_by = VALUES(created_by)', [o.sku, today, Number(o.packs_per_carton), empId]);
    }
    await q.query(`UPDATE skus SET size_label = ?, source = ?, packs_per_carton = ?, sell_unit = ?, min_order_qty = ?, step_qty = ?, weight_kg = ?, status = ?${hasMrp ? ', mrp = ?' : ''},
        updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE sku_code = ?`,
    [o.pack, o.made_or_bought, Number(o.packs_per_carton), o.sold_as, Number(o.min_order), Number(o.in_steps_of), o.weight_kg === '' ? null : Number(o.weight_kg), o.status,
      ...(hasMrp ? [o.mrp === '' ? null : Number(o.mrp)] : []), empId, o.sku]);
    await q.query('UPDATE products SET shelf_life_months = ?, track_batches = ?, hsn_code = ?, gst_rate = ?, updated_by = ? WHERE product_id = ?',
      [Number(o.shelf_life_months), o.batch === 'yes' ? 1 : 0, o.hsn, Number(o.gst), empId, o.product]);
    if (!s || o.supplier_ean !== s.supplier_ean) {
      await q.query("DELETE FROM sku_barcodes WHERE sku_code = ? AND kind = 'supplier'", [o.sku]);
      if (o.supplier_ean) {
        await q.query("INSERT INTO sku_barcodes (barcode, sku_code, kind, created_by) VALUES (?, ?, 'supplier', ?)", [o.supplier_ean, o.sku, empId]);
        await q.query('DELETE FROM unknown_barcodes WHERE barcode = ?', [o.supplier_ean]);
      }
    }
    const keys = hasMrp ? ALL : COLS;
    const diffKeys = s ? keys.filter((k) => String(o[k]) !== String(s[k])) : keys;
    await audit(q, { empId, action: s ? 'import' : 'create', entity: 'sku', entityId: o.sku,
      before: s ? Object.fromEntries(diffKeys.map((k) => [k, s[k]])) : null, after: { ...Object.fromEntries(diffKeys.map((k) => [k, o[k]])), source: 'Excel import' } });
    touched.add(o.product);
  }
  for (const pid of touched) await catalogue.syncSellable(q, pid);
  return plan.length;
}

module.exports = { COLS, ALL, addSheet, diffSheet, applySheet };
