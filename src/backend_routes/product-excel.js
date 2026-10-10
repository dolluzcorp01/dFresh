// Product List Excel (spec F 4): export in the v0.2 layout (docs/reference/dFresh_Website_Product_List_v0.2.xlsx),
// import as a dry-run diff, apply on confirm.
// Layout: sheets Read_Me, Products, Categories, UI_Text. Per-language column groups are _EN _TA _HI as in v0.2,
// and every other language in the languages table (active or not, so translators can fill a new one before it
// goes live) gets its own column right after _HI in each group, e.g. Name_TE.
// One deliberate difference: the v0.2 Spec_status header has an en dash before "do not publish"; ours has "-"
// (house style). Import accepts any header that starts with "Spec_status".
// Import rules:
// - Products sheet: one row per Product_ID. Changed rows are updated, new IDs added, IDs missing from the sheet
//   are reported as removed and, on apply, DEACTIVATED (never deleted: leads may point at them).
// - Read-only columns (Category_XX on Products, Image_1..3, Products count on Categories) are compared but
//   never written; a difference there is reported, not applied. Images are managed in the admin.
// - Categories sheet: Order and Category_XX names are applied. UI_Text is not imported here (use the
//   Translations CSV); unknown sheets and columns are reported.
// - Any row error blocks the apply; the dry-run lists every error.
const ExcelJS = require('exceljs');
const entities = require('./admin-entities');

const CORE = ['en', 'ta', 'hi'];
const FIELD_GROUPS = [ // [header base, translation column, read-only]
  ['Category', null, true], ['Name', 'name'], ['One_liner', 'one_liner'], ['Keywords', 'keywords'],
  ['Description', 'description'], ['Best_for', 'best_for'], ['Colour', 'colour_name'],
];
const SPEC_HEADER = 'Spec_status (INTERNAL - do not publish)';
const HEADER_FILL = 'FFE5BF24';
const INTERNAL_FILL = 'FFF4CCCC';
const V02_WIDTHS = {
  Sort_order: 8, Featured: 9, Featured_order: 9, Product_ID: 15, Category_key: 11, Category: [20, 22, 20],
  Name: [28, 30, 28], One_liner: [40, 44, 42], Keywords: [34, 38, 36], Description: [60, 66, 62],
  Specification: 34, Pack: 22, Best_for: [30, 34, 32], Image: 22, Alt_text_EN: 40, WhatsApp_message_EN: 50,
  [SPEC_HEADER]: 34, Variant_of: 15, Colour: [12, 14, 12], Swatch_hex: 11,
};

const LANG_SUFFIX = (lang) => lang.toUpperCase();

/** Ordered language codes for the column groups: en, ta, hi, then the others by sort order. */
async function columnLanguages(q) {
  const [rows] = await q.query('SELECT lang_code FROM languages ORDER BY sort_order, lang_code');
  const codes = rows.map((r) => r.lang_code);
  return [...CORE.filter((c) => codes.includes(c)), ...codes.filter((c) => !CORE.includes(c))];
}

function productColumns(langs) {
  const group = (base) => langs.map((l, i) => ({ header: `${base}_${LANG_SUFFIX(l)}`, base, lang: l, idx: i }));
  return [
    { header: 'Sort_order' }, { header: 'Featured' }, { header: 'Featured_order' }, { header: 'Product_ID' },
    { header: 'Category_key' }, ...group('Category'), ...group('Name'), ...group('One_liner'), ...group('Keywords'),
    ...group('Description'), { header: 'Specification' }, { header: 'Pack' }, ...group('Best_for'),
    { header: 'Image_1', image: 1 }, { header: 'Image_2', image: 2 }, { header: 'Image_3', image: 3 },
    { header: 'Alt_text_EN' }, { header: 'WhatsApp_message_EN' }, { header: SPEC_HEADER }, { header: 'Variant_of' },
    ...group('Colour'), { header: 'Swatch_hex' },
  ];
}

const widthOf = (col) => {
  const w = V02_WIDTHS[col.base || (col.image ? 'Image' : col.header)];
  return Array.isArray(w) ? w[Math.min(col.idx, 2)] : w || 14;
};

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const norm = (v) => (blank(v) ? null : String(v).trim());

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------
function catName(cats, key, lang) {
  const c = cats.find((x) => x.category_key === key);
  return c && c.tr[lang] ? c.tr[lang].name : null;
}

function productCell(col, p, cats) {
  const t = (lang) => p.tr[lang] || {};
  if (col.base === 'Category') return catName(cats, p.category_key, col.lang);
  if (col.base) return t(col.lang)[FIELD_GROUPS.find((g) => g[0] === col.base)[1]] ?? null;
  if (col.image) return (p.images.find((i) => i.position === col.image) || {}).file_name || null;
  switch (col.header) {
    case 'Sort_order': return p.sort_order;
    case 'Featured': return p.is_featured ? 'Yes' : 'No';
    case 'Featured_order': return p.featured_order;
    case 'Product_ID': return p.product_id;
    case 'Category_key': return p.category_key;
    case 'Specification': return p.specification;
    case 'Pack': return p.pack;
    case 'Alt_text_EN': return t('en').alt_text ?? null;
    case 'WhatsApp_message_EN': return t('en').whatsapp_message ?? null;
    case SPEC_HEADER: return p.spec_status;
    case 'Variant_of': return p.variant_of;
    case 'Swatch_hex': return p.swatch_hex;
    default: return null;
  }
}

function styleHeader(ws, cols, internalHeader) {
  const row = ws.getRow(1);
  row.height = 34;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FF121214' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.value === internalHeader ? INTERNAL_FILL : HEADER_FILL } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.columns.forEach((c, i) => { c.width = cols[i]; });
}

async function buildWorkbook(q) {
  const langs = await columnLanguages(q);
  const products = await entities.load('products', null, q);
  const cats = await entities.load('categories', null, q);
  const [ui] = await q.query('SELECT k.text_key, t.lang_code, t.value FROM ui_text_keys k LEFT JOIN ui_text t ON t.text_key = k.text_key ORDER BY k.group_name, k.text_key');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'dFresh admin';

  const readMe = wb.addWorksheet('Read_Me');
  readMe.getColumn(2).width = 150;
  [
    ['dFresh Website - Product List (export from the admin)', true],
    [`Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${products.filter((p) => !p.variant_of).length} products + ${products.filter((p) => p.variant_of).length} colour variants · languages: ${langs.map(LANG_SUFFIX).join(', ')}`],
    [''],
    ['How to use', true],
    ['• Products sheet: one row per product (Variant_of filled = a colour of that product). Edit, then import in the admin: a dry run shows every change first.'],
    ['• Columns ending _EN / _TA / _HI (and any other language code) are the same field per language. Leave a language empty to show English.'],
    ['• Read-only: Category_XX on Products (edit names on the Categories sheet), Image_1..3 (upload photos in the admin), Products count.'],
    ['• Spec_status is INTERNAL and never shown on the website. No prices in phase 1.'],
    ['• A product missing from the sheet is deactivated on import, never deleted.'],
    ['• UI_Text is for reference; edit UI text in Translations (CSV export / import).'],
  ].forEach(([text, bold], i) => {
    const c = readMe.getCell(9 + i, 2);
    c.value = text;
    if (bold) c.font = { bold: true, size: i === 0 ? 14 : 12 };
  });

  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', xSplit: 4, ySplit: 1, topLeftCell: 'E2', activeCell: 'E2' }] });
  const cols = productColumns(langs);
  ws.addRow(cols.map((c) => c.header));
  for (const p of products) {
    const row = ws.addRow(cols.map((c) => productCell(c, p, cats)));
    row.alignment = { vertical: 'top', wrapText: true };
  }
  styleHeader(ws, cols.map(widthOf), SPEC_HEADER);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: products.length + 1, column: cols.length } };

  const cs = wb.addWorksheet('Categories');
  cs.addRow(['Order', 'Category_key', ...langs.map((l) => `Category_${LANG_SUFFIX(l)}`), 'Products']);
  for (const c of cats) {
    const count = products.filter((p) => p.category_key === c.category_key && !p.variant_of).length;
    cs.addRow([c.sort_order, c.category_key, ...langs.map((l) => (c.tr[l] ? c.tr[l].name : null)), count]);
  }
  styleHeader(cs, [7, 14, ...langs.map((l, i) => [26, 30, 26][Math.min(i, 2)]), 10], null);

  const us = wb.addWorksheet('UI_Text');
  us.addRow(['Key', ...langs.map(LANG_SUFFIX)]);
  const byKey = new Map();
  for (const r of ui) {
    if (!byKey.has(r.text_key)) byKey.set(r.text_key, {});
    if (r.lang_code) byKey.get(r.text_key)[r.lang_code] = r.value;
  }
  for (const [key, vals] of byKey) us.addRow([key, ...langs.map((l) => vals[l] ?? null)]).alignment = { vertical: 'top', wrapText: true };
  styleHeader(us, [20, ...langs.map((l, i) => [46, 52, 48][Math.min(i, 2)])], null);

  return wb;
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
  return v;
}

function sheetRows(ws) {
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = norm(cellValue(c.value)); });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r = { _row: n };
    row.eachCell({ includeEmpty: true }, (c, i) => { if (header[i]) r[header[i]] = cellValue(c.value); });
    if (Object.entries(r).some(([k, v]) => k !== '_row' && !blank(v))) rows.push(r);
  });
  return { header: header.filter(Boolean), rows };
}

/** Maps a Products header to { kind, ... } or null (unknown). */
function classify(header, langCodes) {
  if (header.startsWith('Spec_status')) return { kind: 'base', col: 'spec_status' };
  const fixed = {
    Sort_order: 'sort_order', Featured: 'is_featured', Featured_order: 'featured_order', Product_ID: 'product_id',
    Category_key: 'category_key', Specification: 'specification', Pack: 'pack', Variant_of: 'variant_of', Swatch_hex: 'swatch_hex',
  };
  if (fixed[header]) return { kind: 'base', col: fixed[header] };
  if (/^Image_[123]$/.test(header)) return { kind: 'image', position: Number(header.slice(6)) };
  if (header === 'Alt_text_EN') return { kind: 'tr', lang: 'en', col: 'alt_text' };
  if (header === 'WhatsApp_message_EN') return { kind: 'tr', lang: 'en', col: 'whatsapp_message' };
  const m = /^([A-Za-z_]+)_([A-Z]{2,10})$/.exec(header);
  if (!m) return null;
  const lang = m[2].toLowerCase();
  const g = FIELD_GROUPS.find((x) => x[0] === m[1]);
  if (!g || !langCodes.includes(lang)) return null;
  return g[2] ? { kind: 'category', lang } : { kind: 'tr', lang, col: g[1] };
}

const featured = (v) => {
  const s = norm(v);
  if (s === null) return 0;
  if (/^(yes|y|1|true)$/i.test(s)) return 1;
  if (/^(no|n|0|false)$/i.test(s)) return 0;
  throw new entities.InputError('Featured: Yes or No');
};

const same = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
};

/**
 * Reads the uploaded workbook and compares it with the DB. Returns
 * { ok, summary, added, changed, removed, categories, readOnly, unknownColumns, unknownSheets, errors, plan }.
 */
async function diffWorkbook(q, buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new entities.InputError('This is not an Excel (.xlsx) file this tool can read');
  }
  const ws = wb.getWorksheet('Products');
  if (!ws) throw new entities.InputError('The workbook has no "Products" sheet');
  const [langRows] = await q.query('SELECT lang_code, is_default FROM languages');
  const langCodes = langRows.map((r) => r.lang_code);
  const def = (langRows.find((r) => Number(r.is_default) === 1) || langRows[0]).lang_code;
  const pdef = entities.ENTITIES.products;

  const { header, rows } = sheetRows(ws);
  if (!header.includes('Product_ID')) throw new entities.InputError('The Products sheet has no Product_ID column');
  const columns = header.map((h) => ({ h, c: classify(h, langCodes) }));
  const unknownColumns = columns.filter((x) => !x.c).map((x) => `Products!${x.h}`);
  const known = columns.filter((x) => x.c);

  const current = new Map((await entities.load('products', null, q)).map((p) => [p.product_id, p]));
  const cats = await entities.load('categories', null, q);
  const errors = [];
  const added = [];
  const changed = [];
  const readOnly = [];
  const plan = [];
  const seen = new Set();

  for (const r of rows) {
    const id = norm(r.Product_ID);
    const at = `Products row ${r._row}`;
    if (!id) { errors.push(`${at}: Product_ID is empty`); continue; }
    if (seen.has(id)) { errors.push(`${at}: ${id} appears twice`); continue; }
    seen.add(id);
    const before = current.get(id) || null;
    const base = {};
    const tr = {};
    const diffs = [];
    try {
      for (const { h, c } of known) {
        const raw = r[h];
        if (c.kind === 'base') {
          if (c.col === 'product_id') continue;
          const v = c.col === 'is_featured' ? featured(raw) : entities.coerce(h, pdef.cols[c.col], norm(raw));
          base[c.col] = v;
          if (!before || !same(before[c.col], v)) diffs.push({ field: h, before: before ? before[c.col] : null, after: v });
        } else if (c.kind === 'tr') {
          const def2 = pdef.tr.cols[c.col];
          const v = norm(raw);
          if (v !== null && v.length > def2.max) throw new entities.InputError(`${h}: at most ${def2.max} characters`);
          (tr[c.lang] ||= {})[c.col] = v;
          const old = before && before.tr[c.lang] ? before.tr[c.lang][c.col] : null;
          if (!same(old, v)) diffs.push({ field: h, before: old, after: v });
        } else if (c.kind === 'image' && before) {
          const old = (before.images.find((i) => i.position === c.position) || {}).file_name || null;
          if (!same(old, norm(raw))) readOnly.push({ product: id, field: h, sheet: norm(raw), current: old });
        } else if (c.kind === 'category' && before) {
          const old = catName(cats, before.category_key, c.lang);
          if (!same(old, norm(raw))) readOnly.push({ product: id, field: h, sheet: norm(raw), current: old });
        }
      }
      // A language row is written whole: required columns all filled, or all empty (= use the default language).
      const trRows = {};
      for (const [lang, vals] of Object.entries(tr)) {
        const merged = { ...((before && before.tr[lang]) || {}), ...vals };
        const required = Object.entries(pdef.tr.cols).filter(([, d]) => d.required).map(([col]) => col);
        const filled = Object.values(merged).some((v) => !blank(v));
        if (!filled) {
          if (lang === def) throw new entities.InputError(`${def.toUpperCase()} text is required`);
          if (before && before.tr[lang]) trRows[lang] = null;
          continue;
        }
        const missing = required.filter((col) => blank(merged[col]));
        if (missing.length) throw new entities.InputError(`${lang.toUpperCase()}: fill ${missing.join(', ')} too, or leave all ${lang.toUpperCase()} columns empty`);
        trRows[lang] = vals;
      }
      if (!before) {
        for (const [col, d] of Object.entries(pdef.cols)) {
          if (col !== 'product_id' && !(col in base) && !d.nullable && d.type !== 'bool' && col !== 'sort_order') {
            throw new entities.InputError(`new product needs ${col}`);
          }
        }
        if (!trRows[def]) throw new entities.InputError(`new product needs the ${def.toUpperCase()} texts`);
        entities.coerce('Product_ID', pdef.cols.product_id, id);
      }
      if (!before) { added.push({ product: id, row: r._row }); plan.push({ id, create: true, base, trRows }); }
      else if (diffs.length) { changed.push({ product: id, row: r._row, diffs }); plan.push({ id, base, trRows, diffs }); }
    } catch (err) {
      if (!(err instanceof entities.InputError)) throw err;
      errors.push(`${at} (${id}): ${err.message}`);
    }
  }
  const removed = [...current.values()].filter((p) => !seen.has(p.product_id) && p.is_active).map((p) => ({ product: p.product_id }));

  // Categories sheet (optional)
  const categories = [];
  const cws = wb.getWorksheet('Categories');
  if (cws) {
    const { header: ch, rows: crows } = sheetRows(cws);
    for (const h of ch) {
      if (!['Order', 'Category_key', 'Products'].includes(h) && !(classify(h, langCodes) || {}).lang) unknownColumns.push(`Categories!${h}`);
    }
    for (const r of crows) {
      const key = norm(r.Category_key);
      const cat = cats.find((c) => c.category_key === key);
      if (!key) continue;
      if (!cat) { errors.push(`Categories row ${r._row}: unknown category ${key} (add categories in the admin)`); continue; }
      const diffs = [];
      const trRows = {};
      if ('Order' in r && !same(cat.sort_order, Number(norm(r.Order)))) {
        const n = Number(norm(r.Order));
        if (!Number.isInteger(n)) { errors.push(`Categories row ${r._row}: Order must be a whole number`); continue; }
        diffs.push({ field: 'Order', before: cat.sort_order, after: n });
      }
      for (const h of ch) {
        const c = classify(h, langCodes);
        if (!c || c.kind !== 'category') continue;
        const v = norm(r[h]);
        const old = cat.tr[c.lang] ? cat.tr[c.lang].name : null;
        if (same(old, v)) continue;
        if (v === null && c.lang === def) { errors.push(`Categories row ${r._row}: ${h} is required`); continue; }
        if (v !== null && v.length > 100) { errors.push(`Categories row ${r._row}: ${h} is too long`); continue; }
        diffs.push({ field: h, before: old, after: v });
        trRows[c.lang] = v === null ? null : { name: v };
      }
      if (diffs.length) categories.push({ category: key, diffs, trRows, order: diffs.find((d) => d.field === 'Order')?.after });
    }
  }
  const unknownSheets = wb.worksheets.map((s) => s.name).filter((n) => !['Read_Me', 'Products', 'Categories', 'UI_Text'].includes(n));
  const notes = wb.getWorksheet('UI_Text') ? ['UI_Text sheet is not imported here: use Translations (CSV) for UI text.'] : [];

  return {
    ok: errors.length === 0,
    summary: { added: added.length, changed: changed.length, removed: removed.length, categories: categories.length, errors: errors.length },
    added, changed, removed, categories: categories.map(({ category, diffs }) => ({ category, diffs })),
    readOnly, unknownColumns, unknownSheets, notes, errors,
    plan: { products: plan, removed: removed.map((r) => r.product), categories },
  };
}

/** Applies a dry-run plan inside the caller's transaction. Returns the audit entries to write. */
async function applyPlan(q, plan, empId) {
  const changes = [];
  for (const p of plan.products) {
    const before = p.create ? null : await entities.load('products', [p.id], q);
    if (p.create) {
      await entities.create(q, 'products', { product_id: p.id, ...p.base, tr: Object.fromEntries(Object.entries(p.trRows).filter(([, v]) => v)) }, empId);
    } else {
      const base = Object.fromEntries(Object.entries(p.base).filter(([col, v]) => !same(before[col], v)));
      if (Object.keys(base).length) {
        await q.query(`UPDATE products SET ${Object.keys(base).map((c) => `${c} = ?`).join(', ')}, updated_by = ? WHERE product_id = ?`, [...Object.values(base), empId, p.id]);
      }
      const trChanged = Object.fromEntries(Object.entries(p.trRows).filter(([lang, vals]) => vals === null
        || Object.entries(vals).some(([col, v]) => !same(before.tr[lang] ? before.tr[lang][col] : null, v))));
      await entities.writeTranslations(q, entities.ENTITIES.products, [p.id], trChanged, empId);
    }
    changes.push({ entity: 'product', id: p.id, before, after: await entities.load('products', [p.id], q) });
  }
  for (const id of plan.removed) {
    const before = await entities.load('products', [id], q);
    await q.query('UPDATE products SET is_active = 0, updated_by = ? WHERE product_id = ?', [empId, id]);
    changes.push({ entity: 'product', id, before, after: await entities.load('products', [id], q) });
  }
  for (const c of plan.categories) {
    const before = await entities.load('categories', [c.category], q);
    if (c.order !== undefined) await q.query('UPDATE categories SET sort_order = ? WHERE category_key = ?', [c.order, c.category]);
    await entities.writeTranslations(q, entities.ENTITIES.categories, [c.category], c.trRows, empId);
    changes.push({ entity: 'category', id: c.category, before, after: await entities.load('categories', [c.category], q) });
  }
  return changes;
}

module.exports = { buildWorkbook, diffWorkbook, applyPlan, SPEC_HEADER };
