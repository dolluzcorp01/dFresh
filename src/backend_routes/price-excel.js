// Price list Excel (Products and prices > Excel): export every SKU with its product's HSN / GST rate, carton size,
// minimum order, how it is sold and one Price_<list> column per price list; import = dry run first (every change and
// every error), Apply only for the exact file (fingerprint) that passed with 0 errors, checked again inside the
// transaction - the same rules as the product import (product-excel.js).
// An empty price on a customer type's list = no own price (the Default one applies); a Default price cannot be emptied
// (a SKU that never had one is only noted). SKUs are never added or removed by the import. HSN and GST rate belong to the product: every size of a
// product must carry the same values. Prices take effect from the date chosen in the admin (today or later).
const ExcelJS = require('exceljs');
const theme = require('./excel-theme');
const { sheetRows } = require('./product-excel');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const { InputError } = require('./admin-entities');

const SHEET = 'Prices';
const FIXED = ['SKU', 'Product', 'Size', 'Category', 'HSN', 'GST_rate', 'Packs_per_carton', 'Min_order_qty', 'Sell_in'];
const READ_ONLY = ['Product', 'Size', 'Category'];
const priceHeader = (key) => `Price_${key}`;
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const txt = (v) => (blank(v) ? '' : String(typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v).trim());

async function buildWorkbook(q, { who = 'dFresh admin' } = {}) {
  const today = pricing.istToday();
  const [rows, lists, own, basis] = [await pricing.skuRows(q), await pricing.lists(q), await pricing.ownPricesOn(q, today), await pricing.basis(q)];
  const rates = pricing.gstRates(await commerceSettings.read(q));
  const wb = theme.newWorkbook('dFresh Prices');
  const meta = { exportedBy: who, filters: null };
  theme.notesSheet(wb, 'Read_Me', {
    ...meta,
    title: 'dFresh Price lists',
    lines: [
      [`dFresh price lists on ${today} - ${basis.label.toUpperCase()}`, true],
      [`${rows.length} SKUs · lists: ${lists.map((l) => l.label).join(', ')}`],
      [''],
      ['How to use', true],
      ['• Prices sheet: one row per SKU. Edit, then import in the admin (Products and prices > Excel): a dry run shows every change first.'],
      [`• Price_<list>: the price per pack on that list (${basis.short}). Empty on a customer type's list = that list uses the Default price.`],
      ['• Price_default can never be empty. The admin asks from which date the imported prices apply (today or later).'],
      [`• HSN (4, 6 or 8 digits) and GST_rate (${rates.join(', ')} %) belong to the product: give every size of a product the same values.`],
      ['• Packs_per_carton and Min_order_qty: whole numbers from 1. Sell_in: pack, carton (full cartons only) or both.'],
      ['• Read-only: Product, Size, Category. SKUs are not added or removed by the import.'],
      ['• Keep the column names in the dark header row as they are: the import finds its columns by these names.'],
      ['• Commerce DEMO: the prices in dfresh_commerce are demo values.'],
    ],
  });
  theme.tableSheet(wb, SHEET, {
    ...meta,
    title: `dFresh Price lists (${basis.short})`,
    freezeCols: 2,
    columns: [
      { header: 'SKU', width: 16 }, { header: 'Product', width: 30 }, { header: 'Size', width: 18 }, { header: 'Category', width: 18 },
      { header: 'HSN', width: 10 }, { header: 'GST_rate', type: 'number', width: 10 }, { header: 'Packs_per_carton', type: 'number', width: 12 },
      { header: 'Min_order_qty', type: 'number', width: 12 }, { header: 'Sell_in', width: 10 },
      ...lists.map((l) => ({ header: priceHeader(l.key), type: 'number', width: 13 })),
    ],
    rows: rows.map((r) => [
      r.sku_code, r.name, r.size_label, r.category, r.hsn_code, r.gst_rate, r.packs_per_carton, r.min_order_qty, r.sell_unit,
      ...lists.map((l) => { const v = (own.get(r.sku_code) || {})[l.key]; return v === undefined ? null : v; }),
    ]),
  });
  return wb;
}

/** -> { ok, summary, errors, notes, unknownColumns, prices, skus, products, plan } (nothing is written) */
async function diffWorkbook(q, buffer, effective) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new InputError('This is not an Excel (.xlsx) file this tool can read');
  }
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new InputError(`The workbook has no "${SHEET}" sheet (use the exported price list)`);
  const { header, rows } = sheetRows(ws, 'SKU');
  if (!header.includes('SKU')) throw new InputError(`The ${SHEET} sheet has no SKU column`);
  const lists = await pricing.lists(q);
  const listByHeader = new Map(lists.map((l) => [priceHeader(l.key), l]));
  const unknownColumns = header.filter((h) => !FIXED.includes(h) && !listByHeader.has(h)).map((h) => `${SHEET}!${h}`);
  const priceCols = header.filter((h) => listByHeader.has(h));
  const rates = pricing.gstRates(await commerceSettings.read(q));
  const current = new Map((await pricing.skuRows(q)).map((r) => [r.sku_code, r]));
  const own = await pricing.ownPricesOn(q, effective);

  const errors = [];
  const notes = [];
  const prices = [];
  const skus = [];
  const products = [];
  const plan = { prices: [], skus: new Map(), products: new Map() };
  const seen = new Set();
  const productTax = new Map(); // product_id -> { hsn_code, gst_rate, row }
  const stillMissing = []; // SKUs that had no Default price and still have none
  for (const r of rows) {
    const at = `${SHEET} row ${r._row}`;
    const code = txt(r.SKU).toUpperCase();
    if (!code) { errors.push(`${at}: SKU is empty`); continue; }
    if (seen.has(code)) { errors.push(`${at}: ${code} appears twice`); continue; }
    seen.add(code);
    const cur = current.get(code);
    if (!cur) { errors.push(`${at}: there is no SKU ${code} (SKUs are not added by the import)`); continue; }

    // product tax: the same on every row of the product
    const taxRaw = {};
    if (header.includes('HSN')) taxRaw.hsn_code = txt(r.HSN);
    if (header.includes('GST_rate')) taxRaw.gst_rate = txt(r.GST_rate);
    const tax = pricing.checkTax(taxRaw, rates);
    Object.values(tax.errors).forEach((e) => errors.push(`${at} (${code}): ${e}`));
    if (!Object.keys(tax.errors).length && Object.keys(tax.values).length) {
      const prev = productTax.get(cur.product_id);
      if (prev && (prev.hsn_code !== tax.values.hsn_code || prev.gst_rate !== tax.values.gst_rate)) {
        errors.push(`${at} (${code}): ${cur.product_id} has another HSN / GST rate on row ${prev.row} - they belong to the product, give every size the same`);
      } else if (!prev) {
        productTax.set(cur.product_id, { ...tax.values, row: r._row });
        const diffs = Object.entries(tax.values).filter(([k, v]) => (k === 'gst_rate' ? Number(cur[k]) !== v : String(cur[k]) !== v));
        if (diffs.length) {
          plan.products.set(cur.product_id, Object.fromEntries(diffs));
          diffs.forEach(([k, v]) => products.push({ product_id: cur.product_id, name: cur.name, field: k === 'hsn_code' ? 'HSN' : 'GST rate', before: cur[k], after: v }));
        }
      }
    }

    // SKU selling fields
    const skuRaw = {};
    if (header.includes('Packs_per_carton')) skuRaw.packs_per_carton = txt(r.Packs_per_carton);
    if (header.includes('Min_order_qty')) skuRaw.min_order_qty = txt(r.Min_order_qty);
    if (header.includes('Sell_in')) skuRaw.sell_unit = txt(r.Sell_in).toLowerCase();
    const sk = pricing.checkSkuFields(skuRaw);
    Object.values(sk.errors).forEach((e) => errors.push(`${at} (${code}): ${e}`));
    if (!Object.keys(sk.errors).length) {
      const diffs = Object.entries(sk.values).filter(([k, v]) => String(cur[k]) !== String(v));
      if (diffs.length) {
        plan.skus.set(code, Object.fromEntries(diffs));
        diffs.forEach(([k, v]) => skus.push({ sku_code: code, field: { packs_per_carton: 'Packs per carton', min_order_qty: 'Minimum order', sell_unit: 'Sell in' }[k], before: cur[k], after: v }));
      }
    }

    // prices
    for (const h of priceCols) {
      const list = listByHeader.get(h);
      const before = (own.get(code) || {})[list.key];
      const was = before === undefined ? null : before;
      const p = pricing.parsePrice(txt(r[h]));
      if (p.error) { errors.push(`${at} (${code}) ${h}: ${p.error}`); continue; }
      if (p.value === null && list.key === pricing.DEFAULT_LIST) {
        if (was === null) { stillMissing.push(code); continue; } // never had one: nothing changes (it stays unorderable)
        errors.push(`${at} (${code}) ${h}: the Default price cannot be emptied (it was ${was})`);
        continue;
      }
      if (p.value === was) continue;
      plan.prices.push({ sku_code: code, list_key: list.key, price: p.value });
      prices.push({ sku_code: code, name: cur.name, size_label: cur.size_label, list: list.label, before: was, after: p.value });
    }
  }
  const missingCols = FIXED.filter((h) => !READ_ONLY.includes(h) && h !== 'SKU' && !header.includes(h));
  if (missingCols.length) notes.push(`Columns not in the file (left as they are): ${missingCols.join(', ')}`);
  if (stillMissing.length) notes.push(`${stillMissing.length} SKU(s) still have no Default price and cannot be ordered yet: ${stillMissing.join(', ')}`);
  const notInFile = [...current.keys()].filter((k) => !seen.has(k));
  if (notInFile.length) notes.push(`${notInFile.length} SKU(s) not in the file are left as they are: ${notInFile.slice(0, 8).join(', ')}${notInFile.length > 8 ? ' ...' : ''}`);
  const summary = { prices: prices.length, skus: plan.skus.size, products: plan.products.size, errors: errors.length };
  return { ok: errors.length === 0, summary, errors, notes, unknownColumns, prices, skus, products, plan, effective };
}

/** apply a dry-run plan inside the caller's transaction -> number of changes */
async function applyPlan(q, plan, { effective, empId }) {
  let n = 0;
  for (const [productId, values] of plan.products) if (await pricing.updateProductTax(q, productId, values, empId, 'import')) n += 1;
  for (const [code, values] of plan.skus) if (await pricing.updateSku(q, code, values, empId, 'import')) n += 1;
  if (plan.prices.length) n += (await pricing.setPrices(q, plan.prices, { effective, source: 'import', empId })).changed.length;
  return n;
}

module.exports = { buildWorkbook, diffWorkbook, applyPlan, SHEET };
