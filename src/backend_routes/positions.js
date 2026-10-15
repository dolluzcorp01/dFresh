// Positions (sort order 1, 2, 3 ...) for products, categories, kits, banners and the size picker, and the featured
// order of products.
// A position is a whole number from 1, unique in its list:
//   main product:   among the main products of its category
//   colour version: among the colour versions of its main product
//   featured order: among the featured products (empty when not featured)
//   category, kit, banner, size: in its whole list
// The admin moves rows by drag and drop (reorder = the full list in its new order); a new row, a product moved to
// another category / main product, or a newly featured product without a number goes to the end; leaving a list
// closes the gap. A typed position that is taken is refused with a clear message.
const { InputError, coerce } = require('./admin-entities');

const LISTS = {
  products: { table: 'products', key: 'product_id' },
  categories: { table: 'categories', key: 'category_key' },
  kits: { table: 'kits', key: 'kit_key' },
  banners: { table: 'banners', key: 'banner_key' },
  towns: { table: 'towns', key: 'town_key' },
  'size-picker': { table: 'size_picker', key: 'size_id' },
};
const has = (name) => Boolean(LISTS[name]);
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** The list a row belongs to: { where, params, label } (label for messages). */
function scopeOf(name, row) {
  if (name !== 'products') return { where: '1 = 1', params: [], label: '' };
  if (row.variant_of) return { where: 'variant_of = ?', params: [row.variant_of], label: ` among the colour versions of ${row.variant_of}` };
  return { where: 'variant_of IS NULL AND category_key = ?', params: [row.category_key], label: ` in the category ${row.category_key}` };
}
const sameScope = (name, a, b) => name !== 'products' || ((a.variant_of || null) === (b.variant_of || null) && (a.variant_of || a.category_key === b.category_key));

async function nextPosition(q, name, row) {
  const { table } = LISTS[name];
  const s = scopeOf(name, row);
  // FOR UPDATE: a second admin adding to the same list at the same moment waits for this transaction (no shared number)
  const [[r]] = await q.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM ${table} WHERE ${s.where} FOR UPDATE`, s.params);
  return Number(r.n);
}

async function assertFree(q, name, row, pos, selfKey) {
  const { table, key } = LISTS[name];
  const s = scopeOf(name, row);
  const [[r]] = await q.query(`SELECT ${key} AS k FROM ${table} WHERE ${s.where} AND sort_order = ? AND ${key} <> ? LIMIT 1`, [...s.params, pos, selfKey || '']);
  if (r) throw new InputError(`Position ${pos} is already used by ${r.k}${s.label}. Drag the rows to reorder instead.`);
}

/** 1..n in the current order (closes gaps), for the list of `row`. */
async function renumber(q, name, row) {
  const { table, key } = LISTS[name];
  const s = scopeOf(name, row);
  const [rows] = await q.query(`SELECT ${key} AS k FROM ${table} WHERE ${s.where} ORDER BY sort_order, ${key}`, s.params);
  for (const [i, r] of rows.entries()) await q.query(`UPDATE ${table} SET sort_order = ? WHERE ${key} = ?`, [i + 1, r.k]);
}

async function renumberFeatured(q) {
  const [rows] = await q.query('SELECT product_id FROM products WHERE is_featured = 1 ORDER BY featured_order IS NULL, featured_order, product_id');
  for (const [i, r] of rows.entries()) await q.query('UPDATE products SET featured_order = ? WHERE product_id = ?', [i + 1, r.product_id]);
  await q.query('UPDATE products SET featured_order = NULL WHERE is_featured = 0 AND featured_order IS NOT NULL');
}

const positive = (field, v) => coerce(field, { type: 'int', min: 1 }, v);

/**
 * Before a create (before = null) or an update: settles sort_order (and featured_order for products) in body.
 * Returns what to tidy after the save ({ oldScope, featured }).
 */
async function prepare(q, name, body, before) {
  if (!has(name)) return {};
  const keyName = LISTS[name].key;
  const row = { ...(before || {}), ...body };
  const moved = before && !sameScope(name, before, row);
  if (!before || moved) {
    // a new row (or one moved to another list) always goes to the end: the number the admin's form showed is only a
    // preview, so two people adding at once never get the same position
    body.sort_order = await nextPosition(q, name, row);
  } else if (!blank(body.sort_order) && Number(body.sort_order) !== Number(before.sort_order)) {
    body.sort_order = positive('sort_order', body.sort_order);
    await assertFree(q, name, row, body.sort_order, before[keyName]);
  } else {
    delete body.sort_order; // unchanged: keep it
  }
  const tidy = { oldScope: moved ? before : null, featured: false };
  if (name !== 'products') return tidy;

  if (!before) delete body.featured_order; // a new featured product goes last (below); the form's number is a preview
  const featured = 'is_featured' in body ? Number(coerce('is_featured', { type: 'bool' }, body.is_featured)) === 1 : Boolean(before && Number(before.is_featured));
  const wasFeatured = Boolean(before && Number(before.is_featured));
  if (!featured) {
    body.featured_order = null;
    tidy.featured = wasFeatured; // close the gap it leaves
  } else if (blank(body.featured_order)) {
    if (!wasFeatured || blank(before.featured_order)) {
      const [[r]] = await q.query('SELECT COALESCE(MAX(featured_order), 0) + 1 AS n FROM products WHERE is_featured = 1 AND product_id <> ? FOR UPDATE', [row.product_id || '']);
      body.featured_order = Number(r.n); // newly featured: last
    } else delete body.featured_order;
  } else {
    const n = positive('featured_order', body.featured_order);
    if (!wasFeatured || n !== Number(before.featured_order)) {
      const [[r]] = await q.query('SELECT product_id FROM products WHERE is_featured = 1 AND featured_order = ? AND product_id <> ? LIMIT 1', [n, row.product_id || '']);
      if (r) throw new InputError(`Featured order ${n} is already used by ${r.product_id}. Drag the featured list to reorder instead.`);
    }
    body.featured_order = n;
  }
  return tidy;
}

/** After the save: close the gap in a list the row left, and in the featured list when it left that. */
async function tidyUp(q, name, tidy) {
  if (tidy && tidy.oldScope) await renumber(q, name, tidy.oldScope);
  if (tidy && tidy.featured) await renumberFeatured(q);
}

/** After a delete: close the gaps it leaves. */
async function afterDelete(q, name, before) {
  if (!has(name)) return;
  await renumber(q, name, before);
  if (name === 'products' && Number(before.is_featured)) await renumberFeatured(q);
}

/** Drag and drop: `ids` must be exactly the rows of one list (named by `of`, for products), set to 1..n. */
async function reorder(q, name, ids, of = {}) {
  if (!has(name)) throw new InputError('This list cannot be reordered');
  if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== 'string')) throw new InputError('order must be a list of keys');
  const { table, key } = LISTS[name];
  const s = scopeOf(name, of);
  const [rows] = await q.query(`SELECT ${key} AS k FROM ${table} WHERE ${s.where}`, s.params);
  const have = new Set(rows.map((r) => String(r.k))); // ids arrive as strings (size_id is a number)
  if (ids.length !== have.size || new Set(ids).size !== ids.length || ids.some((x) => !have.has(x))) {
    throw new InputError('The order must list every row of the list exactly once (reload the page and drag again)');
  }
  for (const [i, k] of ids.entries()) await q.query(`UPDATE ${table} SET sort_order = ? WHERE ${key} = ?`, [i + 1, k]);
}

async function reorderFeatured(q, ids) {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw new InputError('order must be a list of product IDs');
  const [rows] = await q.query('SELECT product_id FROM products WHERE is_featured = 1');
  const have = new Set(rows.map((r) => r.product_id));
  if (ids.length !== have.size || new Set(ids).size !== ids.length || ids.some((x) => !have.has(x))) {
    throw new InputError('The order must list every featured product exactly once (reload the page and drag again)');
  }
  for (const [i, k] of ids.entries()) await q.query('UPDATE products SET featured_order = ? WHERE product_id = ?', [i + 1, k]);
}

module.exports = { has, prepare, tidyUp, afterDelete, reorder, reorderFeatured, scopeOf, LISTS };
