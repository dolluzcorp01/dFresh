// Admin CRUD for every content table with a translation table (spec F 3, 6, 7): one definition per entity,
// one generic load / create / update / delete. Values are checked against the definition (type, length,
// enum) before they reach SQL; identifiers only ever come from these definitions, never from the request.
//
// Translations: the default language row is required (its required columns must be filled). Another
// language's row is all-or-nothing for required columns; a language with every column empty has its row
// deleted, so the site falls back to the default language (an empty string would show as blank instead).
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const KEY = (max) => ({ type: 'key', max });
const TEXT = (max, extra = {}) => ({ type: 'text', max, ...extra });

const ENTITIES = {
  products: {
    table: 'products', keys: ['product_id'], order: 'b.sort_order, b.product_id', updatedBy: true,
    cols: {
      product_id: KEY(30), category_key: KEY(30), variant_of: { ...KEY(30), nullable: true },
      sort_order: { type: 'decimal' }, is_featured: { type: 'bool' }, featured_order: { type: 'int', nullable: true },
      show_for_home: { type: 'bool' }, swatch_hex: { type: 'hex', nullable: true },
      specification: TEXT(255, { required: true }), pack: TEXT(120, { required: true }),
      spec_status: TEXT(255, { nullable: true }), is_active: { type: 'bool' },
    },
    tr: {
      table: 'product_translations', updatedBy: true,
      cols: {
        name: TEXT(150, { required: true }), one_liner: TEXT(255, { required: true }),
        keywords: TEXT(255, { required: true }), description: TEXT(20000, { required: true }),
        best_for: TEXT(255, { required: true }), colour_name: TEXT(50), specification: TEXT(255), pack: TEXT(120),
        alt_text: TEXT(255), whatsapp_message: TEXT(500),
      },
    },
  },
  categories: {
    table: 'categories', keys: ['category_key'], order: 'b.sort_order, b.category_key',
    cols: { category_key: KEY(30), sort_order: { type: 'int' }, rep_product_id: { ...KEY(30), nullable: true }, is_active: { type: 'bool' } },
    tr: { table: 'category_translations', cols: { name: TEXT(100, { required: true }) } },
  },
  banners: {
    table: 'banners', keys: ['banner_key'], order: 'b.sort_order, b.banner_key', updatedBy: true,
    cols: {
      banner_key: KEY(40), sort_order: { type: 'int' }, theme: { type: 'enum', values: ['light', 'dark'] },
      cta_action: { type: 'enum', values: ['products', 'products_home', 'products_category', 'section', 'form'] },
      cta_target: TEXT(60, { nullable: true }), desktop_file: { ...TEXT(150), readOnly: true },
      mobile_file: { ...TEXT(150), readOnly: true }, is_active: { type: 'bool' }, note: TEXT(255, { nullable: true }),
    },
    tr: { table: 'banner_translations', cols: { headline: TEXT(200, { required: true }), cta_label: TEXT(80, { required: true }) } },
  },
  kits: {
    table: 'kits', keys: ['kit_key'], order: 'b.sort_order, b.kit_key',
    cols: { kit_key: KEY(40), sort_order: { type: 'int' }, business_type: KEY(40), rep_product_id: { ...KEY(30), nullable: true }, is_active: { type: 'bool' } },
    tr: { table: 'kit_translations', cols: { name: TEXT(100, { required: true }), tagline: TEXT(255, { required: true }) } },
    links: { table: 'kit_products', item: 'product_id', field: 'products' },
  },
  towns: {
    table: 'towns', keys: ['town_key'], order: 'b.sort_order, b.town_key',
    cols: {
      town_key: KEY(40), sort_order: { type: 'int' }, is_base: { type: 'bool' },
      map_x: { type: 'int', nullable: true }, map_y: { type: 'int', nullable: true },
      lat: { type: 'decimal', nullable: true }, lng: { type: 'decimal', nullable: true }, is_active: { type: 'bool' },
    },
    tr: { table: 'town_translations', cols: { name: TEXT(80, { required: true }) } },
  },
  'form-options': {
    table: 'form_options', keys: ['list_key', 'option_value'], order: 'b.list_key, b.sort_order, b.option_value',
    cols: { list_key: KEY(40), option_value: KEY(80), sort_order: { type: 'int' }, is_active: { type: 'bool' } },
    tr: { table: 'form_option_translations', cols: { label: TEXT(120, { required: true }) } },
  },
  'size-picker': {
    table: 'size_picker', keys: ['position'], order: 'b.position',
    cols: { position: { type: 'int' }, product_id: KEY(30), size_label: TEXT(20, { required: true }), scale: { type: 'decimal' }, is_default: { type: 'bool' } },
  },
};

// Entities whose rows have their own translation table (for completeness % and the language promise).
const TRANSLATED = Object.entries(ENTITIES).filter(([, e]) => e.tr).map(([name, e]) => ({ name, ...e }));

function entity(name) {
  const e = ENTITIES[name];
  if (!e) throw new InputError('Unknown section', 404);
  return e;
}

/** URL id <-> key values (composite keys are joined with "~"). */
function parseId(e, id) {
  const parts = String(id).split('~');
  if (parts.length !== e.keys.length || parts.some((p) => !p)) throw new InputError('Bad id', 404);
  return parts.map((p, i) => coerce(e.keys[i], e.cols[e.keys[i]], p));
}
const idOf = (e, row) => e.keys.map((k) => row[k]).join('~');

function coerce(name, def, raw) {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  if (empty) {
    if (def.nullable) return null;
    if (def.type === 'bool') return 0;
    throw new InputError(`${name} is required`);
  }
  const s = typeof raw === 'string' ? raw.trim() : raw;
  switch (def.type) {
    case 'key':
      if (typeof s !== 'string' || !new RegExp(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,${def.max - 1}}$`).test(s)) {
        throw new InputError(`${name}: letters, digits, - _ . only, up to ${def.max}`);
      }
      return s;
    case 'text': {
      const v = String(s);
      if (v.length > def.max) throw new InputError(`${name}: at most ${def.max} characters`);
      return v;
    }
    case 'int': {
      const n = Number(s);
      if (!Number.isInteger(n) || Math.abs(n) > 2147483647) throw new InputError(`${name}: whole number`);
      return n;
    }
    case 'decimal': {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new InputError(`${name}: number`);
      return n;
    }
    case 'bool':
      return s === true || s === 1 || s === '1' || s === 'true' ? 1 : 0;
    case 'enum':
      if (!def.values.includes(s)) throw new InputError(`${name}: one of ${def.values.join(', ')}`);
      return s;
    case 'hex':
      if (!/^#[0-9A-Fa-f]{6}$/.test(String(s))) throw new InputError(`${name}: colour like #A1B2C3`);
      return String(s).toUpperCase();
    default:
      throw new Error(`unknown type ${def.type}`);
  }
}

async function languages(q = db) {
  const [rows] = await q.query('SELECT lang_code, is_default FROM languages ORDER BY sort_order, lang_code');
  const def = (rows.find((r) => Number(r.is_default) === 1) || rows[0]).lang_code;
  return { codes: rows.map((r) => r.lang_code), def };
}

const where = (e, alias = '') => e.keys.map((k) => `${alias}${k} = ?`).join(' AND ');

/** All rows (or one, when keyValues is given) with { tr: { lang: {col: value} }, [links field]: [...] }. */
async function load(name, keyValues = null, q = db) {
  const e = entity(name);
  const cols = Object.keys(e.cols).map((c) => `b.${c}`).join(', ');
  const [rows] = await q.query(
    `SELECT ${cols} FROM ${e.table} b ${keyValues ? `WHERE ${where(e, 'b.')}` : ''} ORDER BY ${e.order}`,
    keyValues || []
  );
  const byId = new Map(rows.map((r) => [idOf(e, r), r]));
  for (const r of rows) {
    for (const [c, def] of Object.entries(e.cols)) {
      if (def.type === 'bool') r[c] = Number(r[c]);
      if (def.type === 'decimal' && r[c] !== null) r[c] = Number(r[c]);
    }
    if (e.tr) r.tr = {};
    if (e.links) r[e.links.field] = [];
  }
  if (e.tr && rows.length) {
    const trCols = Object.keys(e.tr.cols).join(', ');
    const [trs] = await q.query(
      `SELECT ${e.keys.join(', ')}, lang_code, ${trCols} FROM ${e.tr.table} ${keyValues ? `WHERE ${where(e)}` : ''}`,
      keyValues || []
    );
    for (const t of trs) {
      const r = byId.get(idOf(e, t));
      if (!r) continue;
      r.tr[t.lang_code] = Object.fromEntries(Object.keys(e.tr.cols).map((c) => [c, t[c]]));
    }
  }
  if (e.links && rows.length) {
    const [links] = await q.query(
      `SELECT ${e.keys.join(', ')}, ${e.links.item} FROM ${e.links.table} ${keyValues ? `WHERE ${where(e)}` : ''} ORDER BY sort_order`,
      keyValues || []
    );
    for (const l of links) {
      const r = byId.get(idOf(e, l));
      if (r) r[e.links.field].push(l[e.links.item]);
    }
  }
  if (name === 'products' && rows.length) {
    const [imgs] = await q.query(
      `SELECT product_id, position, file_name, width, height FROM product_images ${keyValues ? 'WHERE product_id = ?' : ''} ORDER BY position`,
      keyValues || []
    );
    for (const r of rows) r.images = [];
    for (const i of imgs) {
      const r = byId.get(i.product_id);
      if (r) r.images.push({ position: i.position, file_name: i.file_name, width: i.width, height: i.height });
    }
  }
  return keyValues ? rows[0] || null : rows;
}

/** Validated base values from body (create: every writable column; update: only the ones sent, keys never). */
function baseValues(e, body, creating) {
  const out = {};
  for (const [c, def] of Object.entries(e.cols)) {
    if (def.readOnly) continue;
    if (!creating && e.keys.includes(c)) continue;
    if (!creating && !(c in body)) continue;
    if (creating && !(c in body) && (def.nullable || def.type === 'bool')) {
      out[c] = def.type === 'bool' ? (c === 'is_active' ? 1 : 0) : null;
      continue;
    }
    if (creating && !(c in body) && c === 'sort_order') {
      out[c] = 0;
      continue;
    }
    out[c] = coerce(c, def, body[c]);
  }
  return out;
}

/** Normalised translation rows per language: { lang: {col: value} | null } (null = delete the row). */
function trValues(e, tr, langs) {
  const out = {};
  if (!tr || typeof tr !== 'object') return out;
  for (const [lang, values] of Object.entries(tr)) {
    if (!langs.codes.includes(lang)) throw new InputError(`Unknown language ${lang}`);
    if (!values || typeof values !== 'object') continue;
    const row = {};
    for (const [c, def] of Object.entries(e.tr.cols)) {
      const v = values[c];
      const s = v === null || v === undefined ? '' : String(v).trim();
      if (s.length > def.max) throw new InputError(`${c} (${lang}): at most ${def.max} characters`);
      row[c] = s === '' ? null : s;
    }
    const required = Object.entries(e.tr.cols).filter(([, d]) => d.required).map(([c]) => c);
    const filled = Object.values(row).some((v) => v !== null);
    if (!filled) {
      if (lang === langs.def) throw new InputError(`The ${lang} text is required`);
      out[lang] = null;
      continue;
    }
    const missing = required.filter((c) => row[c] === null);
    if (missing.length) {
      throw new InputError(`${lang}: fill ${missing.join(', ')} too (or leave this language empty to use ${langs.def})`);
    }
    out[lang] = row;
  }
  return out;
}

async function writeTranslations(q, e, keyValues, rows, empId) {
  for (const [lang, row] of Object.entries(rows)) {
    if (row === null) {
      await q.query(`DELETE FROM ${e.tr.table} WHERE ${where(e)} AND lang_code = ?`, [...keyValues, lang]);
      continue;
    }
    const cols = [...e.keys, 'lang_code', ...Object.keys(row), ...(e.tr.updatedBy ? ['updated_by'] : [])];
    const vals = [...keyValues, lang, ...Object.values(row), ...(e.tr.updatedBy ? [empId] : [])];
    const upd = [...Object.keys(row), ...(e.tr.updatedBy ? ['updated_by'] : [])].map((c) => `${c} = VALUES(${c})`).join(', ');
    await q.query(
      `INSERT INTO ${e.tr.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${upd}`,
      vals
    );
  }
}

async function writeLinks(q, e, keyValues, items) {
  if (!Array.isArray(items)) throw new InputError(`${e.links.field} must be a list`);
  const clean = [...new Set(items.map((v, i) => coerce(`${e.links.field}[${i}]`, KEY(30), v)))];
  await q.query(`DELETE FROM ${e.links.table} WHERE ${where(e)}`, keyValues);
  for (const [i, item] of clean.entries()) {
    await q.query(
      `INSERT INTO ${e.links.table} (${e.keys.join(', ')}, ${e.links.item}, sort_order) VALUES (${e.keys.map(() => '?').join(', ')}, ?, ?)`,
      [...keyValues, item, i + 1]
    );
  }
}

async function create(q, name, body, empId) {
  const e = entity(name);
  const langs = await languages(q);
  const base = baseValues(e, body, true);
  if (e.updatedBy) base.updated_by = empId;
  for (const [c, def] of Object.entries(e.cols)) if (def.readOnly && !(c in base)) base[c] = '';
  const cols = Object.keys(base);
  await q.query(`INSERT INTO ${e.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(base));
  const keyValues = e.keys.map((k) => base[k]);
  if (e.tr) {
    const rows = trValues(e, body.tr, langs);
    if (!rows[langs.def]) throw new InputError(`The ${langs.def} text is required`);
    await writeTranslations(q, e, keyValues, rows, empId);
  }
  if (e.links && body[e.links.field] !== undefined) await writeLinks(q, e, keyValues, body[e.links.field]);
  return keyValues;
}

async function update(q, name, keyValues, body, empId) {
  const e = entity(name);
  const langs = await languages(q);
  const base = baseValues(e, body, false);
  if (Object.keys(base).length) {
    if (e.updatedBy) base.updated_by = empId;
    await q.query(
      `UPDATE ${e.table} SET ${Object.keys(base).map((c) => `${c} = ?`).join(', ')} WHERE ${where(e)}`,
      [...Object.values(base), ...keyValues]
    );
  }
  if (e.tr && body.tr) await writeTranslations(q, e, keyValues, trValues(e, body.tr, langs), empId);
  if (e.links && body[e.links.field] !== undefined) await writeLinks(q, e, keyValues, body[e.links.field]);
}

async function remove(q, name, keyValues) {
  const e = entity(name);
  const [r] = await q.query(`DELETE FROM ${e.table} WHERE ${where(e)}`, keyValues);
  return r.affectedRows;
}

/** Sets sort_order = 1..n in the given order (single-key entities). */
async function reorder(q, name, ids) {
  const e = entity(name);
  if (e.keys.length !== 1 || !e.cols.sort_order) throw new InputError('This list cannot be reordered');
  if (!Array.isArray(ids) || !ids.length) throw new InputError('order must be a list');
  for (const [i, id] of ids.entries()) {
    await q.query(`UPDATE ${e.table} SET sort_order = ? WHERE ${e.keys[0]} = ?`, [i + 1, parseId(e, id)[0]]);
  }
}

/**
 * Translation completeness per language: for ui_text and every translated entity, how many rows that exist in
 * the default language also exist in this language. { lang: { have, total, pct, parts: {name: {have,total}} } }
 */
async function completeness(q = db) {
  const langs = await languages(q);
  const parts = [{ name: 'ui_text', table: 'ui_text', keys: ['text_key'] },
    ...TRANSLATED.map((t) => ({ name: t.name, table: t.tr.table, keys: t.keys }))];
  const out = Object.fromEntries(langs.codes.map((l) => [l, { have: 0, total: 0, parts: {} }]));
  for (const p of parts) {
    const on = p.keys.map((k) => `x.${k} = d.${k}`).join(' AND ');
    const [rows] = await q.query(
      `SELECT l.lang_code, COUNT(d.lang_code) AS total, COUNT(x.lang_code) AS have
         FROM languages l
         JOIN ${p.table} d ON d.lang_code = ?
         LEFT JOIN ${p.table} x ON ${on} AND x.lang_code = l.lang_code
        GROUP BY l.lang_code`,
      [langs.def]
    );
    for (const r of rows) {
      const o = out[r.lang_code];
      if (!o) continue;
      o.parts[p.name] = { have: Number(r.have), total: Number(r.total) };
      o.have += Number(r.have);
      o.total += Number(r.total);
    }
  }
  for (const o of Object.values(out)) o.pct = o.total ? Math.floor((o.have / o.total) * 1000) / 10 : 100;
  return out;
}

module.exports = {
  ENTITIES, TRANSLATED, InputError, entity, parseId, idOf, coerce, languages, load, create, update, remove, reorder,
  completeness, trValues, writeTranslations,
};
