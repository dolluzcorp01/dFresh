// Product List Excel (spec F 4): export in the v0.2 layout (docs/reference/dFresh_Website_Product_List_v0.2.xlsx),
// import as a dry-run diff, apply on confirm.
// Layout: sheets Read_Me, Products, Categories, UI_Text, branded by excel-theme.js (logo + title rows 1-3, header row 4). Per-language column groups are _EN _TA _HI as in v0.2,
// and every other language in the languages table (active or not, so translators can fill a new one before it
// goes live) gets its own column right after _HI in each group, e.g. Name_TE.
// One deliberate difference: the internal column's header reads "Spec status - INTERNAL, do not publish" on a red
// header cell (v0.2: "Spec_status (INTERNAL ... do not publish)"). Import accepts any header that starts with
// "Spec status" or "Spec_status", so v0.2 files and older exports still import.
// Import rules:
// - Products sheet: one row per Product_ID. Changed rows are updated, new IDs added, IDs missing from the sheet
//   are reported as removed and, on apply, DEACTIVATED (never deleted: leads may point at them).
// - Read-only columns (Category_XX on Products, Image_1..3, Products count on Categories) are compared but
//   never written; a difference there is reported, not applied. Images are managed in the admin.
// - Categories sheet: Order and Category_XX names are applied. UI_Text is not imported here (use the
//   Translations CSV); unknown sheets and columns are reported.
// - Any row error blocks the apply; the dry-run lists every error. A row with an error is never listed as a change.
// - Checked on what the sheet would leave behind (validateRows): Product_ID format, Category_key exists, Variant_of
//   (an existing or same-file main product, not itself, no chains, same category), Swatch_hex on a colour version and
//   on its main product. Apply runs the same checks again (it re-reads the file inside its transaction).
const ExcelJS = require('exceljs');
const entities = require('./admin-entities');
const { RETIRED_KEYS } = require('./text-groups');
const theme = require('./excel-theme');

const CORE = ['en', 'ta', 'hi'];
const FIELD_GROUPS = [ // [header base, translation column, read-only]
  ['Category', null, true], ['Name', 'name'], ['One_liner', 'one_liner'], ['Keywords', 'keywords'],
  ['Description', 'description'], ['Best_for', 'best_for'], ['Colour', 'colour_name'],
];
// Optional per-language replacements of a main column, e.g. Specification_TA. No column for the default language:
// Specification / Pack are its value. Empty = the site uses the main column.
const OVERRIDE_GROUPS = [['Specification', 'specification'], ['Pack', 'pack']];
const SPEC_HEADER = 'Spec status - INTERNAL, do not publish';
const isSpecHeader = (h) => /^spec[ _]status\b/i.test(h);
// The internal column must stand out: red header with white text (6.5:1), light red cells.
const SPEC_LOOK = { head: { fill: 'FFB42318', color: 'FFFFFFFF' }, tint: ['FFFEF3F2', 'FFFCE4E1'] };
const V02_WIDTHS = {
  Sort_order: 8, Featured: 9, Featured_order: 9, Product_ID: 18, Category_key: 11, Category: [20, 22, 20],
  Name: [28, 30, 28], One_liner: [40, 44, 42], Keywords: [34, 38, 36], Description: [60, 66, 62],
  Specification: 34, Pack: 22, Best_for: [30, 34, 32], Image: 22, Alt_text_EN: 40, WhatsApp_message_EN: 50,
  [SPEC_HEADER]: 34, Variant_of: 15, Colour: [12, 14, 12], Swatch_hex: 11,
};

const LANG_SUFFIX = (lang) => lang.toUpperCase();

/** Ordered language codes for the column groups: en, ta, hi, then the others by sort order; plus the default. */
async function columnLanguages(q) {
  const [rows] = await q.query('SELECT lang_code, is_default FROM languages ORDER BY sort_order, lang_code');
  const codes = rows.map((r) => r.lang_code);
  const def = (rows.find((r) => Number(r.is_default) === 1) || rows[0]).lang_code;
  return { langs: [...CORE.filter((c) => codes.includes(c)), ...codes.filter((c) => !CORE.includes(c))], def };
}

function productColumns(langs, def) {
  const group = (base) => langs.map((l, i) => ({ header: `${base}_${LANG_SUFFIX(l)}`, base, lang: l, idx: i }));
  const over = (base) => langs.filter((l) => l !== def)
    .map((l) => ({ header: `${base}_${LANG_SUFFIX(l)}`, base, lang: l, over: OVERRIDE_GROUPS.find((g) => g[0] === base)[1] }));
  return [
    { header: 'Sort_order' }, { header: 'Featured' }, { header: 'Featured_order' }, { header: 'Product_ID' },
    { header: 'Category_key' }, ...group('Category'), ...group('Name'), ...group('One_liner'), ...group('Keywords'),
    ...group('Description'), { header: 'Specification' }, ...over('Specification'), { header: 'Pack' }, ...over('Pack'),
    ...group('Best_for'),
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
  if (col.over) return t(col.lang)[col.over] ?? null;
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

// Column types for the theme: numbers stay numbers, everything else (IDs, keys, hex) is stored as text.
const NUMBER_COLS = new Set(['Sort_order', 'Featured_order']);

/** The branded Product List workbook. who = "Name (EMP_ID)" of the admin exporting it. */
async function buildWorkbook(q, { who = 'dFresh admin' } = {}) {
  const { langs, def } = await columnLanguages(q);
  const products = await entities.load('products', null, q);
  const cats = await entities.load('categories', null, q);
  const [ui] = await q.query(
    'SELECT k.text_key, t.lang_code, t.value FROM ui_text_keys k LEFT JOIN ui_text t ON t.text_key = k.text_key WHERE k.text_key NOT IN (?) ORDER BY k.group_name, k.text_key', [RETIRED_KEYS]
  );
  const wb = theme.newWorkbook('dFresh Products');
  const meta = { exportedBy: who, filters: null };

  theme.notesSheet(wb, 'Read_Me', {
    ...meta,
    title: 'dFresh Products',
    lines: [
      ['dFresh Website - Product List (export from the admin)', true],
      [`${products.filter((p) => !p.variant_of).length} products + ${products.filter((p) => p.variant_of).length} colour variants · languages: ${langs.map(LANG_SUFFIX).join(', ')}`],
      [''],
      ['How to use', true],
      ['• Products sheet: one row per product (Variant_of filled = a colour of that product). Edit, then import in the admin: a dry run shows every change first.'],
      ['• Columns ending _EN / _TA / _HI (and any other language code) are the same field per language. Leave a language empty to show English.'],
      [`• Specification and Pack are the ${LANG_SUFFIX(def)} value. ${OVERRIDE_GROUPS.map((g) => `${g[0]}_XX`).join(' / ')}: only when that language needs its own text; empty = the main column.`],
      ['• Read-only: Category_XX on Products (edit names on the Categories sheet), Image_1..3 (upload photos in the admin), Products count.'],
      ['• Spec status (the red column) is INTERNAL and never shown on the website. No prices in phase 1.'],
      ['• A product missing from the sheet is deactivated on import, never deleted.'],
      ['• UI_Text is for reference; edit UI text in Translations (CSV export / import).'],
      ['• Keep the column names in the dark header row as they are: the import finds its columns by these names.'],
    ],
  });

  const cols = productColumns(langs, def);
  theme.tableSheet(wb, 'Products', {
    ...meta,
    title: 'dFresh Products',
    freezeCols: 4, // Sort_order .. Product_ID stay in view
    columns: cols.map((c) => ({
      header: c.header, type: NUMBER_COLS.has(c.header) ? 'number' : 'text', width: widthOf(c),
      ...(c.header === SPEC_HEADER ? SPEC_LOOK : {}),
    })),
    rows: products.map((p) => cols.map((c) => productCell(c, p, cats))),
  });

  theme.tableSheet(wb, 'Categories', {
    ...meta,
    title: 'dFresh Product categories',
    columns: [
      { header: 'Order', type: 'number', width: 9 }, { header: 'Category_key', width: 15 },
      ...langs.map((l, i) => ({ header: `Category_${LANG_SUFFIX(l)}`, width: [26, 30, 26][Math.min(i, 2)] })),
      { header: 'Products', type: 'number', width: 11 },
    ],
    rows: cats.map((c) => [
      c.sort_order, c.category_key, ...langs.map((l) => (c.tr[l] ? c.tr[l].name : null)),
      products.filter((p) => p.category_key === c.category_key && !p.variant_of).length,
    ]),
  });

  const byKey = new Map();
  for (const r of ui) {
    if (!byKey.has(r.text_key)) byKey.set(r.text_key, {});
    if (r.lang_code) byKey.get(r.text_key)[r.lang_code] = r.value;
  }
  theme.tableSheet(wb, 'UI_Text', {
    ...meta,
    title: 'dFresh Website texts (reference)',
    freezeCols: 1,
    columns: [{ header: 'Key', width: 22 }, ...langs.map((l, i) => ({ header: LANG_SUFFIX(l), width: [46, 52, 48][Math.min(i, 2)], wrap: true }))],
    rows: [...byKey].map(([key, vals]) => [key, ...langs.map((l) => vals[l] ?? null)]),
  });

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

/**
 * Header + data rows of a sheet. The header row is found by a column it must have (Product_ID / Category_key), so the
 * branded export (logo and title in rows 1-3, header in row 4) and the old plain layout (header in row 1) both
 * import; formatting is ignored, only values are read.
 */
function sheetRows(ws, mustHave) {
  const at = theme.findHeaderRow(ws, mustHave, cellValue) || 1;
  const header = [];
  ws.getRow(at).eachCell({ includeEmpty: true }, (c, i) => { header[i] = norm(cellValue(c.value)); });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n <= at) return;
    const r = { _row: n };
    row.eachCell({ includeEmpty: true }, (c, i) => { if (header[i]) r[header[i]] = cellValue(c.value); });
    if (Object.entries(r).some(([k, v]) => k !== '_row' && !blank(v))) rows.push(r);
  });
  return { header: header.filter(Boolean), rows };
}

/** Maps a Products header to { kind, ... } or null (unknown). */
function classify(header, langCodes, def) {
  if (isSpecHeader(header)) return { kind: 'base', col: 'spec_status' };
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
  const o = OVERRIDE_GROUPS.find((x) => x[0] === m[1]);
  if (o) return langCodes.includes(lang) && lang !== def ? { kind: 'tr', lang, col: o[1] } : null; // no default-language override
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

const ID_FORMAT = /^DZIND-DF\d{3}(-[A-Z]{3})?$/;
const yesNo = (v) => (v === null || v === undefined ? v : Number(v) ? 'Yes' : 'No');

/**
 * Cross-row checks on the final state (DB + sheet). sheetIds: Product_IDs of the sheet rows in order, with their row
 * numbers. Returns { errors, bad } (bad = product IDs whose row has an error).
 */
function validateRows(final, sheetIds, cats) {
  const errors = [];
  const bad = new Set();
  const catKeys = cats.map((c) => c.category_key);
  const fail = (id, row, msg) => { errors.push(`Products row ${row} (${id}): ${msg}`); bad.add(id); };
  for (const [id, row] of sheetIds) {
    const p = final.get(id);
    if (!p) continue;
    if (!ID_FORMAT.test(id)) fail(id, row, 'Product_ID must look like DZIND-DF001 (a colour version: DZIND-DF008-BLK).');
    if (p.category_key && !catKeys.includes(p.category_key)) {
      fail(id, row, `Category_key '${p.category_key}' does not exist. Use one of: ${catKeys.join(', ')}.`);
    }
    if (p.variant_of) {
      const main = final.get(p.variant_of);
      let linkOk = false;
      if (p.variant_of === id) fail(id, row, `Variant_of '${p.variant_of}' is this product itself. Leave it empty for a main product.`);
      else if (!main) fail(id, row, `Variant_of '${p.variant_of}' is not a product.`);
      else if (main.variant_of) fail(id, row, `Variant_of '${p.variant_of}' is a colour version itself (of ${main.variant_of}). Point to the main product ${main.variant_of}.`);
      else if (main.category_key !== p.category_key) fail(id, row, `a colour version must be in the same category as its main product: ${p.variant_of} is in '${main.category_key}', this row in '${p.category_key}'.`);
      else if ([...final.values()].some((x) => x.variant_of === id)) fail(id, row, `it has colour versions of its own, so it cannot be a colour version (Variant_of '${p.variant_of}'). No chains.`);
      else linkOk = true;
      // a missing swatch is only worth saying once the link itself is right
      if (linkOk && !p.swatch_hex) fail(id, row, 'Swatch_hex is required for a colour version (e.g. #7A1F2B).');
    }
    const versions = [...final.values()].filter((x) => x.variant_of === id).map((x) => x.id);
    if (!p.variant_of && versions.length && !p.swatch_hex) fail(id, row, `Swatch_hex is required: it has colour versions (${versions.join(', ')}).`);
  }
  return { errors, bad };
}

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

  const { header, rows } = sheetRows(ws, 'Product_ID');
  if (!header.includes('Product_ID')) throw new entities.InputError('The Products sheet has no Product_ID column');
  const columns = header.map((h) => ({ h, c: classify(h, langCodes, def) }));
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
          // shown to people: Featured as Yes / No
          const show = c.col === 'is_featured' ? yesNo : (x) => x;
          if (!before || !same(before[c.col], v)) diffs.push({ field: h, before: before ? show(before[c.col]) : null, after: show(v) });
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
  // Cross-row checks (validateRows) on DB + sheet; a row that fails is dropped from the plan and the change lists.
  {
    const state = new Map([...current.values()].map((p) => [p.product_id, { id: p.product_id, category_key: p.category_key, variant_of: p.variant_of, swatch_hex: p.swatch_hex }]));
    for (const item of plan) state.set(item.id, { ...(state.get(item.id) || { id: item.id }), ...item.base, id: item.id });
    const sheetIds = rows.map((r) => [norm(r.Product_ID), r._row]).filter(([id]) => id && state.has(id));
    const checked = validateRows(state, [...new Map(sheetIds)], cats);
    errors.push(...checked.errors);
    for (const list of [plan, added, changed]) {
      for (let i = list.length - 1; i >= 0; i--) if (checked.bad.has(list[i].id || list[i].product)) list.splice(i, 1);
    }
  }
  // Positions (positions.js rules), checked on what the sheet would leave behind: Sort_order is unique among the main
  // products of a category and among the colour versions of a main product; Featured_order is unique among featured
  // products (a featured product without one goes last; a product that is not featured has none).
  const rowOf = new Map(rows.map((r) => [norm(r.Product_ID), r._row]));
  const final = new Map([...current.values()].map((p) => [p.product_id, {
    id: p.product_id, category_key: p.category_key, variant_of: p.variant_of, sort_order: Number(p.sort_order),
    is_featured: Number(p.is_featured), featured_order: p.featured_order === null ? null : Number(p.featured_order),
  }]));
  for (const item of plan) final.set(item.id, { ...(final.get(item.id) || { id: item.id }), ...item.base, id: item.id });
  const where = (id) => (rowOf.has(id) ? `${id} (row ${rowOf.get(id)})` : `${id} (not in the sheet)`);
  const groups = new Map();
  for (const p of final.values()) {
    const g = p.variant_of ? `among the colour versions of ${p.variant_of}` : `in the category ${p.category_key}`;
    const key = `${g}|${p.sort_order}`;
    groups.set(key, [...(groups.get(key) || []), p.id]);
  }
  for (const [key, ids] of groups) {
    if (ids.length > 1) {
      const [g, pos] = key.split('|');
      errors.push(`Sort_order ${pos} is used ${ids.length} times ${g}: ${ids.map(where).join(', ')}. Use 1, 2, 3 ... once each.`);
    }
  }
  const featuredRows = [...final.values()].filter((p) => p.is_featured);
  const byOrder = new Map();
  for (const p of featuredRows.filter((x) => x.featured_order !== null)) byOrder.set(p.featured_order, [...(byOrder.get(p.featured_order) || []), p.id]);
  for (const [n, ids] of byOrder) if (ids.length > 1) errors.push(`Featured_order ${n} is used ${ids.length} times: ${ids.map(where).join(', ')}. Use 1, 2, 3 ... once each.`);
  const positionNotes = [];
  let nextFeatured = Math.max(0, ...featuredRows.map((p) => p.featured_order || 0));
  for (const item of plan) {
    const p = final.get(item.id);
    if (!p.is_featured && p.featured_order !== null) item.base.featured_order = null;
    else if (p.is_featured && p.featured_order === null) {
      nextFeatured += 1;
      item.base.featured_order = nextFeatured;
      positionNotes.push(`${item.id}: Featured with an empty Featured_order: it goes last (${nextFeatured}).`);
    }
  }

  const removed = [...current.values()].filter((p) => !seen.has(p.product_id) && p.is_active).map((p) => ({ product: p.product_id }));

  // Categories sheet (optional)
  const categories = [];
  const cws = wb.getWorksheet('Categories');
  if (cws) {
    const { header: ch, rows: crows } = sheetRows(cws, 'Category_key');
    for (const h of ch) {
      if (!['Order', 'Category_key', 'Products'].includes(h) && !(classify(h, langCodes, def) || {}).lang) unknownColumns.push(`Categories!${h}`);
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
        const c = classify(h, langCodes, def);
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
  // Categories sheet Order: whole numbers from 1, each used once (positions.js)
  const catOrder = new Map(cats.map((c) => [c.category_key, Number(c.sort_order)]));
  for (const c of categories) if (c.order !== undefined) catOrder.set(c.category, c.order);
  const usedOrder = new Map();
  for (const [k, n] of catOrder) {
    if (!Number.isInteger(n) || n < 1) errors.push(`Categories: Order of ${k} must be a whole number from 1 (1, 2, 3 ...)`);
    usedOrder.set(n, [...(usedOrder.get(n) || []), k]);
  }
  for (const [n, ks] of usedOrder) if (ks.length > 1) errors.push(`Categories: Order ${n} is used ${ks.length} times (${ks.join(', ')}). Use 1, 2, 3 ... once each.`);
  const unknownSheets = wb.worksheets.map((s) => s.name).filter((n) => !['Read_Me', 'Products', 'Categories', 'UI_Text'].includes(n));
  const notes = [...positionNotes, ...(wb.getWorksheet('UI_Text') ? ['UI_Text sheet is not imported here: use Translations (CSV) for UI text.'] : [])];

  // in sheet order: "Products row 6" before "Products row 7"; other messages keep their place after them
  const rowNo = (e) => { const m = /^Products row (\d+)/.exec(e); return m ? Number(m[1]) : Infinity; };
  errors.sort((a, b) => rowNo(a) - rowNo(b));

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

module.exports = { buildWorkbook, diffWorkbook, applyPlan, SPEC_HEADER, cellValue, sheetRows }; // the last two: price-excel.js
