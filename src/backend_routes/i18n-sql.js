// The ONE place that builds "base table + translation with default-language fallback" queries.
// Every entity (products, categories, banners, kits, towns, form options, ui_text) goes through
// translatedSelect() so the fallback rule is written once (docs/03_DATABASE.md).
//
// Join shape:
//   FROM <base> b
//   JOIN      <tr> e ON <keys> AND e.lang_code = <default>   -- default row always exists
//   LEFT JOIN <tr> t ON <keys> AND t.lang_code = <requested> -- may be missing
// and every translated column is COALESCE(t.col, e.col[, b.baseFallback]).
//
// Only named columns are selected. Identifiers come from code, never from user input;
// the two language codes are always bound as ? parameters.

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name) {
  if (!IDENT.test(name)) throw new Error(`i18n-sql: bad identifier "${name}"`);
  return name;
}

/**
 * @param {object} o
 * @param {string}   o.base      base table name
 * @param {string}   o.tr        translation table name
 * @param {string[]} o.keys      columns joining base -> translation (same name on both)
 * @param {Array<string|[string,string]>} o.baseCols  base columns, or [column, alias]
 * @param {Array<{col:string, as?:string, baseFallback?:string}>} o.trCols  translated columns;
 *        baseFallback = a base column used when neither translation row has a value
 * @param {Array<{col:string, as:string}>} [o.defaultCols] translated columns taken from the default
 *        language row only (e.g. the English name, for search in another language)
 * @param {string}   [o.where]   extra condition on base alias b (no user input; use ? + whereParams)
 * @param {Array}    [o.whereParams]
 * @param {string}   [o.presenceAs] alias for a 0/1 column telling whether the requested language
 *        has its own row (1) or everything came from the fallback (0)
 * @param {string}   [o.orderBy] e.g. 'b.sort_order'
 * @param {string}   lang        requested language (already validated)
 * @param {string}   fallback    default language
 * @returns {{ sql: string, params: Array }}
 */
function translatedSelect(o, lang, fallback) {
  const on = (alias) => o.keys.map((k) => `${alias}.${ident(k)} = b.${ident(k)}`).join(' AND ');

  const cols = o.baseCols.map((c) => {
    const [col, as] = Array.isArray(c) ? c : [c, c];
    return `b.${ident(col)} AS ${ident(as)}`;
  });
  for (const c of o.trCols) {
    const parts = [`t.${ident(c.col)}`, `e.${ident(c.col)}`];
    if (c.baseFallback) parts.push(`b.${ident(c.baseFallback)}`);
    cols.push(`COALESCE(${parts.join(', ')}) AS ${ident(c.as || c.col)}`);
  }
  for (const c of o.defaultCols || []) cols.push(`e.${ident(c.col)} AS ${ident(c.as)}`);
  if (o.presenceAs) cols.push(`(t.lang_code IS NOT NULL) AS ${ident(o.presenceAs)}`);

  const sql = [
    `SELECT ${cols.join(', ')}`,
    `FROM ${ident(o.base)} b`,
    `JOIN ${ident(o.tr)} e ON ${on('e')} AND e.lang_code = ?`,
    `LEFT JOIN ${ident(o.tr)} t ON ${on('t')} AND t.lang_code = ?`,
    o.where ? `WHERE ${o.where}` : '',
    o.orderBy ? `ORDER BY ${o.orderBy}` : '',
  ].filter(Boolean).join('\n');

  return { sql, params: [fallback, lang, ...(o.whereParams || [])] };
}

module.exports = { translatedSelect };
