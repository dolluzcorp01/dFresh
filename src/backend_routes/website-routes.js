// Section 18 Website pages' API (phase 24, the owner's field map docs/claude-tasks/phase-24-field-map.md): Home doors,
// Most loved, Form rules, Where we deliver map, Menu links, Visit cards, and the read-only facts of Site settings and
// Google and sharing. Banners, Size picker, Kits, Form options keep the entity API (admin-entities.js); texts per
// language stay Translations rows (ui_text), edited here or on Translations: one source, two ways in.
// Rights: the Content row (view / edit / create / delete), as the other Website pages. Every save clears the site's
// content cache ({ content: true }), so the site shows it on the next load.
const { audit } = require('./audit');
const godowns = require('./godowns');
const company = require('./company');
const targets = require('../shared/siteTargets');
const { CHECK_NOTES, RATE_RANGE, RATE_WINDOW_MIN } = require('../shared/formChecks');
const formRules = require('./form-rules');

const DOOR_TEXTS = ['doors_k', 'doors_h', 'for_home', 'dh_h', 'dh_p', 'dh_go', 'for_business', 'db_h', 'db_p', 'db_go'];
const DOORS = { home: { label: 'For Home', action: 'products_home', target: '' }, biz: { label: 'For Business', action: 'section', target: 'business' } };
const MAX_PRODUCTS = [1, 100];
const GEO = [['lat', 6, 37, 'Latitude'], ['lng', 68, 98, 'Longitude']];
const MAP_W = 600; const MAP_H = 360;
const ANCHORS = ['start', 'middle', 'end'];
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function register({ route, tx, db, by, InputError, setUiText, languages }) {
  const C = { content: true };
  const fail = (fields) => { const e = new InputError('Check the marked fields'); e.code = 'fields'; e.fields = fields; throw e; };

  // ---------------------------------------------------------------- shared: texts of a set of ui_text keys
  async function textsOf(keys) {
    if (!keys.length) return [];
    const [k] = await db.query('SELECT text_key, group_name, description, max_chars FROM ui_text_keys WHERE text_key IN (?)', [keys]);
    const [v] = await db.query('SELECT text_key, lang_code, value FROM ui_text WHERE text_key IN (?)', [keys]);
    const byKey = new Map(k.map((r) => [r.text_key, { ...r, max_chars: r.max_chars === null ? null : Number(r.max_chars), values: {} }]));
    for (const r of v) if (byKey.has(r.text_key)) byKey.get(r.text_key).values[r.lang_code] = r.value;
    return keys.map((x) => byKey.get(x)).filter(Boolean);
  }
  /** a new Translations text (group, description) with its words per language { lang: value } */
  async function newText(q, key, group, description, values, empId, langs) {
    await q.query('INSERT INTO ui_text_keys (text_key, group_name, description, allows_html, max_chars) VALUES (?, ?, ?, 0, ?)', [key, group, description, 255]);
    for (const [lang, val] of Object.entries(values || {})) if (langs.codes.includes(lang) && String(val || '').trim()) await setUiText(q, key, lang, String(val).trim(), empId, langs);
  }
  /** words per language for a text: the default language is required */
  function wordsOk(values, langs, label, max = 255) {
    const v = values && typeof values === 'object' ? values : {};
    if (!String(v[langs.def] || '').trim()) return `${label}: the ${langs.def} text is required`;
    for (const [l, x] of Object.entries(v)) {
      if (!langs.codes.includes(l)) return `${label}: unknown language ${l}`;
      if (String(x || '').length > max) return `${label} (${l}): at most ${max} characters`;
    }
    return '';
  }
  async function setWords(q, key, values, empId, langs) {
    for (const l of langs.codes) if (values && l in values) await setUiText(q, key, l, String(values[l] || '').trim(), empId, langs);
  }
  const cards = async () => (await db.query(`SELECT p.product_id, COALESCE(t.name, p.product_id) AS name, p.is_active, p.is_featured, p.featured_order,
      (SELECT i.file_name FROM product_images i WHERE i.product_id = p.product_id ORDER BY i.position LIMIT 1) AS image
      FROM products p LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = (SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1)
      WHERE p.variant_of IS NULL ORDER BY p.product_id`))[0];

  // ================================================================ Home doors (rows 12 to 15)
  route('get', '/website/doors', 'content:view', async () => {
    const [s] = await db.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key LIKE 'door\\_%'");
    const set = Object.fromEntries(s.map((r) => [r.setting_key, r.setting_value]));
    const [cats] = await db.query("SELECT c.category_key, COALESCE(t.name, c.category_key) AS name, c.is_active FROM categories c LEFT JOIN category_translations t ON t.category_key = c.category_key AND t.lang_code = 'en' ORDER BY c.sort_order");
    return {
      doors: Object.entries(DOORS).map(([which, d]) => ({ which, label: d.label, product: set[`door_${which}_product`] || '', action: set[`door_${which}_action`] || d.action, target: set[`door_${which}_target`] ?? d.target })),
      products: await cards(), categories: cats.map((c) => ({ ...c, is_active: Number(c.is_active) })),
      choices: { actions: targets.ACTIONS, sections: targets.SECTIONS, forms: targets.FORMS }, texts: await textsOf(DOOR_TEXTS),
    };
  });
  route('put', '/website/doors/:which', 'content:edit', async (req) => {
    const d = DOORS[req.params.which];
    if (!d) throw new InputError('No such door', 404);
    const b = req.body || {};
    const set = {};
    if ('product' in b) {
      const [[p]] = await db.query('SELECT product_id FROM products WHERE product_id = ? AND variant_of IS NULL', [String(b.product || '')]);
      if (!p) fail({ product: 'Pick a product from the list (its first photo shows on the door)' });
      set[`door_${req.params.which}_product`] = p.product_id;
    }
    if ('action' in b || 'target' in b) {
      const [cats] = await db.query('SELECT category_key FROM categories');
      const why = targets.actionProblem(b.action, b.target, cats.map((c) => c.category_key));
      if (why) fail({ target: `Where it goes: ${why}` });
      set[`door_${req.params.which}_action`] = b.action;
      set[`door_${req.params.which}_target`] = targets.keptTarget(b.action, b.target);
    }
    if (!Object.keys(set).length) throw new InputError('Nothing to save');
    await tx(async (q) => {
      for (const [k, v] of Object.entries(set)) {
        const [[before]] = await q.query('SELECT setting_value FROM site_settings WHERE setting_key = ? FOR UPDATE', [k]);
        if (!before) throw new InputError(`${k} is missing: apply database/migrations/20261114_stage2_24_01_website_pages.sql`, 500);
        if (before.setting_value === v) continue;
        await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [v, by(req), k]);
        await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: k, before: { value: before.setting_value }, after: { value: v } });
      }
    });
    return { saved: Object.keys(set) };
  }, C);

  // ================================================================ Most loved (rows 16 to 19)
  route('get', '/website/most-loved', 'content:view', async () => {
    const [keys] = await db.query("SELECT text_key FROM ui_text_keys WHERE group_name = 'featured' ORDER BY text_key");
    return { products: (await cards()).map((p) => ({ ...p, is_active: Number(p.is_active), is_featured: Number(p.is_featured), featured_order: p.featured_order === null ? null : Number(p.featured_order) })), texts: await textsOf(keys.map((k) => k.text_key)) };
  });
  // ids: the ticked products, in order (left to right); every other product is unticked. No limit: the row scrolls.
  route('put', '/website/most-loved', 'content:edit', async (req) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : null;
    if (!ids) throw new InputError('ids: the ticked products in order');
    if (new Set(ids).size !== ids.length) throw new InputError('A product is in the list twice');
    const [rows] = await db.query('SELECT product_id, is_featured, featured_order FROM products WHERE variant_of IS NULL');
    const known = new Set(rows.map((r) => r.product_id));
    const bad = ids.find((x) => !known.has(x));
    if (bad) throw new InputError(`${bad}: not a product card`);
    await tx(async (q) => {
      await q.query('UPDATE products SET is_featured = 0, featured_order = NULL, updated_by = ? WHERE variant_of IS NULL AND is_featured = 1 AND product_id NOT IN (?)', [by(req), ids.length ? ids : ['']]);
      for (const [i, id] of ids.entries()) await q.query('UPDATE products SET is_featured = 1, featured_order = ?, updated_by = ? WHERE product_id = ?', [i + 1, by(req), id]);
      await audit(q, { empId: by(req), action: 'update', entity: 'most_loved', entityId: 'home', before: { ids: rows.filter((r) => Number(r.is_featured)).sort((a, b) => (a.featured_order || 0) - (b.featured_order || 0)).map((r) => r.product_id) }, after: { ids } });
    });
    return { ids };
  }, C);

  // ================================================================ Form rules (rows 39 to 69)
  const ERROR_TEXTS = ['e_fill', 'e_choose', 'e_pick', 'e_email', 'e_tel', 'e_gst', 'e_rate'];
  route('get', '/website/form-rules', 'content:view', async () => {
    const [rows] = await db.query('SELECT form_type, field_name, sort_order, field_type, list_key, max_len, is_required, locked, updated_by, updated_at FROM form_fields ORDER BY FIELD(form_type, \'brochure\', \'quote\', \'distributor\', \'contact\'), sort_order');
    const [st] = await db.query("SELECT setting_key, setting_value, updated_by, updated_at FROM site_settings WHERE setting_key IN ('lead_rate_max', 'lead_max_products')");
    const s = Object.fromEntries(st.map((r) => [r.setting_key, r]));
    const [labels] = await db.query("SELECT text_key, value FROM ui_text WHERE lang_code = 'en' AND text_key LIKE 'fl\\_%' OR (lang_code = 'en' AND text_key IN ('first_name', 'last_name', 'email', 'mobile'))");
    return {
      fields: rows.map((r) => ({ ...r, max_len: r.max_len === null ? null : Number(r.max_len), is_required: Number(r.is_required) === 1, locked: Number(r.locked) === 1 })),
      labels: Object.fromEntries(labels.map((l) => [l.text_key, l.value])),
      limits: { rate_max: Number(s.lead_rate_max ? s.lead_rate_max.setting_value : 5), rate_window: RATE_WINDOW_MIN, rate_range: RATE_RANGE,
        max_products: Number(s.lead_max_products ? s.lead_max_products.setting_value : 40), max_products_range: MAX_PRODUCTS },
      checks: CHECK_NOTES, texts: await textsOf(ERROR_TEXTS),
    };
  });
  route('put', '/website/form-rules/field', 'content:edit', async (req) => {
    const b = req.body || {};
    const [[f]] = await db.query('SELECT form_type, field_name, is_required, locked FROM form_fields WHERE form_type = ? AND field_name = ?', [String(b.form_type || ''), String(b.field_name || '')]);
    if (!f) throw new InputError('No such field', 404);
    if (Number(f.locked) === 1) throw new InputError('Phone stays required on every form, so every lead can be called back (read only).', 409);
    const req1 = bool(b.required);
    if (req1 === Number(f.is_required)) return { changed: false };
    await tx(async (q) => {
      await q.query('UPDATE form_fields SET is_required = ?, updated_by = ? WHERE form_type = ? AND field_name = ?', [req1, by(req), f.form_type, f.field_name]);
      await audit(q, { empId: by(req), action: 'update', entity: 'form_rule', entityId: `${f.form_type}.${f.field_name}`, before: { required: Number(f.is_required) === 1 }, after: { required: req1 === 1 } });
    });
    return { changed: true };
  }, C);
  route('put', '/website/form-rules/limits', 'content:edit', async (req) => {
    const b = req.body || {};
    const errs = {};
    const set = {};
    if ('rate_max' in b) {
      const n = Number(b.rate_max);
      if (!Number.isInteger(n) || n < RATE_RANGE[0] || n > RATE_RANGE[1]) errs.rate_max = `A whole number from ${RATE_RANGE[0]} to ${RATE_RANGE[1]}`; else set.lead_rate_max = String(n);
    }
    if ('max_products' in b) {
      const n = Number(b.max_products);
      if (!Number.isInteger(n) || n < MAX_PRODUCTS[0] || n > MAX_PRODUCTS[1]) errs.max_products = `A whole number from ${MAX_PRODUCTS[0]} to ${MAX_PRODUCTS[1]}`; else set.lead_max_products = String(n);
    }
    if (Object.keys(errs).length) fail(errs);
    await tx(async (q) => {
      for (const [k, v] of Object.entries(set)) {
        const [[before]] = await q.query('SELECT setting_value FROM site_settings WHERE setting_key = ? FOR UPDATE', [k]);
        if (!before || before.setting_value === v) continue;
        await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [v, by(req), k]);
        await audit(q, { empId: by(req), action: 'update', entity: 'setting', entityId: k, before: { value: before.setting_value }, after: { value: v } });
      }
    });
    return { saved: Object.keys(set) };
  }, C);

  // ================================================================ Where we deliver map (rows 70 to 75): Delivery areas
  async function mapRows() {
    const langs = await languages();
    const [rows] = await db.query(`SELECT a.area_id, a.label, a.towns, a.is_active, a.show_on_map, a.map_key, a.map_sort, a.is_base, a.map_x, a.map_y,
        a.label_dx, a.label_dy, a.label_anchor, a.lat, a.lng FROM delivery_areas a ORDER BY a.show_on_map DESC, a.map_sort, a.area_id`);
    const [names] = await db.query('SELECT area_id, lang_code, name FROM delivery_area_translations');
    return {
      languages: langs.codes, default: langs.def,
      areas: rows.map((r) => ({
        ...r, is_active: Number(r.is_active), show_on_map: Number(r.show_on_map), is_base: Number(r.is_base), map_sort: Number(r.map_sort),
        lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng),
        names: Object.fromEntries(names.filter((n) => n.area_id === r.area_id).map((n) => [n.lang_code, n.name])),
      })),
      size: { w: MAP_W, h: MAP_H },
    };
  }
  route('get', '/website/map', 'content:view', async () => mapRows());
  function mapValues(b) {
    const v = {};
    const errs = {};
    for (const [k, min, max] of [['map_x', 0, MAP_W], ['map_y', 0, MAP_H]]) {
      if (!(k in b)) continue;
      if (b[k] === null || b[k] === '') { v[k] = null; continue; }
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < min || n > max) errs[k] = `A whole number from ${min} to ${max}`; else v[k] = n;
    }
    for (const k of ['label_dx', 'label_dy']) {
      if (!(k in b)) continue;
      const n = Number(b[k]);
      if (!Number.isInteger(n) || Math.abs(n) > 300) errs[k] = 'A whole number from -300 to 300'; else v[k] = n;
    }
    if ('label_anchor' in b) { if (!ANCHORS.includes(b.label_anchor)) errs.label_anchor = 'start, middle or end'; else v.label_anchor = b.label_anchor; }
    for (const [k, min, max, label] of GEO) {
      if (!(k in b)) continue;
      if (b[k] === null || String(b[k]).trim() === '') { v[k] = null; continue; }
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < min || n > max) errs[k] = `${label} must be a number from ${min} to ${max} (India).`; else v[k] = n;
    }
    if ('is_base' in b) v.is_base = bool(b.is_base);
    if ('show_on_map' in b) v.show_on_map = bool(b.show_on_map);
    return { v, errs };
  }
  async function saveNames(q, areaId, names, langs, empId) {
    for (const l of langs.codes) {
      if (!names || !(l in names)) continue;
      const s = String(names[l] || '').trim();
      if (s.length > 80) throw new InputError(`Name (${l}): at most 80 characters`);
      if (!s) {
        if (l === langs.def) throw new InputError(`Name (${l}): required`);
        await q.query('DELETE FROM delivery_area_translations WHERE area_id = ? AND lang_code = ?', [areaId, l]);
      } else await q.query('INSERT INTO delivery_area_translations (area_id, lang_code, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [areaId, l, s]);
    }
    await audit(q, { empId, action: 'update', entity: 'map_town', entityId: String(areaId), after: { names } });
  }
  route('put', '/website/map/:id', 'content:edit', async (req) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const { v, errs } = mapValues(b);
    if (Object.keys(errs).length) fail(errs);
    const langs = await languages();
    await tx(async (q) => {
      const [[a]] = await q.query('SELECT * FROM delivery_areas WHERE area_id = ? FOR UPDATE', [id]);
      if (!a) throw new InputError('No such town', 404);
      const showing = 'show_on_map' in v ? v.show_on_map : Number(a.show_on_map);
      if (showing) {
        const [[nm]] = await q.query('SELECT name FROM delivery_area_translations WHERE area_id = ? AND lang_code = ?', [id, langs.def]);
        const def = b.names && langs.def in b.names ? String(b.names[langs.def] || '').trim() : (nm ? nm.name : '');
        if (!def) fail({ names: `Give its name on the map (${langs.def}) before showing it` });
      }
      if (v.is_base) await q.query('UPDATE delivery_areas SET is_base = 0 WHERE area_id <> ? AND is_base = 1', [id]);
      if ('show_on_map' in v && v.show_on_map && !a.map_key) v.map_key = `area-${id}`;
      if ('show_on_map' in v && v.show_on_map && !Number(a.show_on_map)) {
        const [[mx]] = await q.query('SELECT COALESCE(MAX(map_sort), 0) AS n FROM delivery_areas WHERE show_on_map = 1');
        v.map_sort = Number(mx.n) + 1;
      }
      if (Object.keys(v).length) {
        await q.query(`UPDATE delivery_areas SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE area_id = ?`, [...Object.values(v), id]);
        await audit(q, { empId: by(req), action: 'update', entity: 'map_town', entityId: String(id), before: Object.fromEntries(Object.keys(v).map((k) => [k, a[k]])), after: v });
      }
      if (b.names) await saveNames(q, id, b.names, langs, by(req));
    });
    return mapRows();
  }, C);
  // a town for the map only (not a delivery area: inactive for delivery charges, so no order changes)
  route('post', '/website/map', 'content:create', async (req) => {
    const b = req.body || {};
    const langs = await languages();
    const why = wordsOk(b.names, langs, 'Name', 80);
    if (why) fail({ names: why });
    const { v, errs } = mapValues(b);
    if (Object.keys(errs).length) fail(errs);
    const name = String(b.names[langs.def]).trim();
    const [[clash]] = await db.query('SELECT area_id, label FROM delivery_areas WHERE LOWER(label) = LOWER(?)', [name]);
    if (clash) fail({ names: `${clash.label} is already on the list: show it on the map instead (one town list)` });
    const id = await tx(async (q) => {
      const [[mx]] = await q.query('SELECT COALESCE(MAX(map_sort), 0) AS m, COALESCE(MAX(sort_order), 0) AS s FROM delivery_areas');
      const [ins] = await q.query(`INSERT INTO delivery_areas (label, towns, charge, days, show_on_map, map_sort, sort_order, is_active) VALUES (?, ?, 0, 'Mon,Tue,Wed,Thu,Fri,Sat', 1, ?, ?, 0)`,
        [name, name, Number(mx.m) + 1, Number(mx.s) + 1]);
      if (v.is_base) await q.query('UPDATE delivery_areas SET is_base = 0 WHERE is_base = 1');
      const rest = { ...v, map_key: `area-${ins.insertId}` };
      delete rest.show_on_map;
      await q.query(`UPDATE delivery_areas SET ${Object.keys(rest).map((k) => `${k} = ?`).join(', ')} WHERE area_id = ?`, [...Object.values(rest), ins.insertId]);
      await audit(q, { empId: by(req), action: 'create', entity: 'map_town', entityId: String(ins.insertId), after: { label: name, map_only: true, ...rest } });
      await saveNames(q, ins.insertId, b.names, langs, by(req));
      return ins.insertId;
    });
    return { area_id: id, ...(await mapRows()) };
  }, C);
  route('put', '/website/map-order', 'content:edit', async (req) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : null;
    const [shown] = await db.query('SELECT area_id FROM delivery_areas WHERE show_on_map = 1');
    const have = new Set(shown.map((r) => r.area_id));
    if (!ids || ids.length !== have.size || ids.some((x) => !have.has(x)) || new Set(ids).size !== ids.length) throw new InputError('The order must list every town on the map once (reload and drag again)');
    await tx(async (q) => {
      for (const [i, id] of ids.entries()) await q.query('UPDATE delivery_areas SET map_sort = ? WHERE area_id = ?', [i + 1, id]);
      await audit(q, { empId: by(req), action: 'reorder', entity: 'map_town', entityId: 'map', after: { ids } });
    });
    return mapRows();
  }, C);

  // ================================================================ Menu links (rows 76 to 81)
  async function linkRows() {
    const [rows] = await db.query('SELECT link_key, text_key, target_kind, target, sort_order, in_header, in_phone, in_footer, is_active, updated_by, updated_at FROM menu_links ORDER BY sort_order, link_key');
    const texts = await textsOf(rows.map((r) => r.text_key));
    const byKey = Object.fromEntries(texts.map((t) => [t.text_key, t.values]));
    const langs = await languages();
    return {
      languages: langs.codes, default: langs.def,
      links: rows.map((r) => ({ ...r, in_header: Number(r.in_header), in_phone: Number(r.in_phone), in_footer: Number(r.in_footer), is_active: Number(r.is_active), names: byKey[r.text_key] || {}, added: /^nav_l\d+$/.test(r.text_key) })),
      choices: { kinds: targets.LINK_KINDS, pages: targets.PAGES, sections: targets.LINK_SECTIONS },
    };
  }
  route('get', '/website/menu-links', 'content:view', async () => linkRows());
  function linkValues(b, creating) {
    const v = {};
    if (creating || 'target_kind' in b || 'target' in b) {
      const why = targets.linkProblem(b.target_kind, b.target);
      if (why) fail({ target: `Where it goes: ${why}` });
      v.target_kind = b.target_kind; v.target = b.target;
    }
    for (const k of ['in_header', 'in_phone', 'in_footer', 'is_active']) if (k in b || creating) v[k] = k in b ? bool(b[k]) : 1;
    return v;
  }
  route('post', '/website/menu-links', 'content:create', async (req) => {
    const b = req.body || {};
    const langs = await languages();
    const why = wordsOk(b.names, langs, 'Name', 60);
    if (why) fail({ names: why });
    const v = linkValues(b, true);
    const key = await tx(async (q) => {
      const [[mx]] = await q.query("SELECT COALESCE(MAX(CAST(SUBSTRING(link_key, 2) AS UNSIGNED)), 0) AS n FROM menu_links WHERE link_key REGEXP '^l[0-9]+$'");
      const linkKey = `l${Number(mx.n) + 1}`;
      const textKey = `nav_${linkKey}`;
      await newText(q, textKey, 'nav', `Menu link added on Website > Brand and layout > Menu links (${linkKey})`, b.names, by(req), langs);
      const [[so]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) AS n FROM menu_links');
      await q.query('INSERT INTO menu_links (link_key, text_key, target_kind, target, sort_order, in_header, in_phone, in_footer, is_active, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [linkKey, textKey, v.target_kind, v.target, Number(so.n) + 1, v.in_header, v.in_phone, v.in_footer, v.is_active, by(req)]);
      await audit(q, { empId: by(req), action: 'create', entity: 'menu_link', entityId: linkKey, after: { ...v, names: b.names } });
      return linkKey;
    });
    return { link_key: key, ...(await linkRows()) };
  }, C);
  route('put', '/website/menu-links/:key', 'content:edit', async (req) => {
    const b = req.body || {};
    const langs = await languages();
    if (b.names) { const why = wordsOk(b.names, langs, 'Name', 60); if (why) fail({ names: why }); }
    const v = linkValues(b, false);
    await tx(async (q) => {
      const [[l]] = await q.query('SELECT * FROM menu_links WHERE link_key = ? FOR UPDATE', [req.params.key]);
      if (!l) throw new InputError('No such link', 404);
      if (Object.keys(v).length) {
        await q.query(`UPDATE menu_links SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE link_key = ?`, [...Object.values(v), by(req), l.link_key]);
        await audit(q, { empId: by(req), action: 'update', entity: 'menu_link', entityId: l.link_key, before: Object.fromEntries(Object.keys(v).map((k) => [k, l[k]])), after: v });
      }
      if (b.names) await setWords(q, l.text_key, b.names, by(req), langs);
    });
    return linkRows();
  }, C);
  route('put', '/website/menu-links-order', 'content:edit', async (req) => {
    const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys.map(String) : null;
    const [all] = await db.query('SELECT link_key FROM menu_links');
    const have = new Set(all.map((r) => r.link_key));
    if (!keys || keys.length !== have.size || keys.some((k) => !have.has(k)) || new Set(keys).size !== keys.length) throw new InputError('The order must list every link once (reload and drag again)');
    await tx(async (q) => {
      for (const [i, k] of keys.entries()) await q.query('UPDATE menu_links SET sort_order = ? WHERE link_key = ?', [i + 1, k]);
      await audit(q, { empId: by(req), action: 'reorder', entity: 'menu_link', entityId: 'menus', after: { keys } });
    });
    return linkRows();
  }, C);
  route('delete', '/website/menu-links/:key', 'content:delete', async (req) => {
    await tx(async (q) => {
      const [[l]] = await q.query('SELECT * FROM menu_links WHERE link_key = ? FOR UPDATE', [req.params.key]);
      if (!l) throw new InputError('No such link', 404);
      if (!/^nav_l\d+$/.test(l.text_key)) throw new InputError('A built-in link is not deleted: hide it instead (its name is a Translations text other pages use)', 409);
      await q.query('DELETE FROM menu_links WHERE link_key = ?', [l.link_key]);
      await q.query('DELETE FROM ui_text_keys WHERE text_key = ?', [l.text_key]); // its words go with it (ON DELETE CASCADE)
      await audit(q, { empId: by(req), action: 'delete', entity: 'menu_link', entityId: l.link_key, before: l });
    });
    return linkRows();
  }, C);

  // ================================================================ Visit cards (rows 82 to 88)
  async function cardRows() {
    const [rows] = await db.query('SELECT card_id, name_key, address_key, hours_key, map_query, phone, godown_id, sort_order, is_active, updated_by, updated_at FROM visit_cards ORDER BY sort_order, card_id');
    const texts = await textsOf([...new Set(rows.flatMap((r) => [r.name_key, r.address_key, r.hours_key].filter(Boolean)))]);
    const w = Object.fromEntries(texts.map((t) => [t.text_key, t.values]));
    const [gs] = await db.query('SELECT location_id, code, name, address, addr_line2, city, pin, state, phone, open_time, close_time, weekly_off, is_active FROM locations ORDER BY sort_order, location_id');
    const langs = await languages();
    return {
      languages: langs.codes, default: langs.def,
      cards: rows.map((r) => ({ ...r, is_active: Number(r.is_active), names: w[r.name_key] || {}, addresses: w[r.address_key] || {}, hours: r.hours_key ? w[r.hours_key] || {} : {}, added: /^vc_\d+_n$/.test(r.name_key) })),
      godowns: gs.filter((g) => Number(g.is_active)).map((g) => ({
        godown_id: g.location_id, code: g.code, name: g.name, phone: g.phone || '',
        address: [g.address, g.addr_line2, g.city, [g.state, g.pin].filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).join(', '),
        hours: g.open_time && g.close_time ? godowns.hoursText({ ...g, weekly_off: godowns.offDays(g.weekly_off) }) : '',
      })),
    };
  }
  route('get', '/website/visit-cards', 'content:view', async () => cardRows());
  function cardValues(b) {
    const v = {};
    const errs = {};
    if ('map_query' in b) { const s = String(b.map_query || '').trim(); if (s.length > 255) errs.map_query = 'At most 255 characters'; else v.map_query = s; }
    if ('phone' in b) {
      const s = String(b.phone || '').trim();
      if (s && !/^\+?[0-9][0-9 -]{5,24}$/.test(s)) errs.phone = 'A phone number: digits, spaces, - and a + in front'; else v.phone = s || null;
    }
    if ('godown_id' in b) v.godown_id = b.godown_id ? Number(b.godown_id) : null;
    if ('is_active' in b) v.is_active = bool(b.is_active);
    if (Object.keys(errs).length) fail(errs);
    return v;
  }
  async function cardWords(q, card, b, langs, empId) {
    if (b.names) await setWords(q, card.name_key, b.names, empId, langs);
    if (b.addresses) await setWords(q, card.address_key, b.addresses, empId, langs);
    if (b.hours) {
      const any = Object.values(b.hours).some((x) => String(x || '').trim());
      let key = card.hours_key;
      if (any && !key) {
        key = `vc_${card.card_id}_h`;
        const [[k]] = await q.query('SELECT text_key FROM ui_text_keys WHERE text_key = ?', [key]);
        if (!k) await q.query("INSERT INTO ui_text_keys (text_key, group_name, description, allows_html, max_chars) VALUES (?, 'Contact details', ?, 0, 255)", [key, `Visit card ${card.card_id}: opening hours`]);
        await q.query('UPDATE visit_cards SET hours_key = ? WHERE card_id = ?', [key, card.card_id]);
      }
      if (key) {
        if (!any) { await q.query('UPDATE visit_cards SET hours_key = NULL WHERE card_id = ?', [card.card_id]); if (/^vc_\d+_h$/.test(key)) await q.query('DELETE FROM ui_text_keys WHERE text_key = ?', [key]); } else {
          // the default language's hours first (a language may be left empty to use it)
          if (!String(b.hours[langs.def] || '').trim()) fail({ hours: `Opening hours: fill the ${langs.def} text, or empty them all to show none` });
          await setWords(q, key, b.hours, empId, langs);
        }
      }
    }
  }
  route('post', '/website/visit-cards', 'content:create', async (req) => {
    const b = req.body || {};
    const langs = await languages();
    const errs = {};
    const n = wordsOk(b.names, langs, 'Card name', 120); if (n) errs.names = n;
    const a = wordsOk(b.addresses, langs, 'Address', 255); if (a) errs.addresses = a;
    if (Object.keys(errs).length) fail(errs);
    const v = cardValues(b);
    const id = await tx(async (q) => {
      const [[so]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) AS n FROM visit_cards');
      const [[next]] = await q.query("SELECT AUTO_INCREMENT AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'visit_cards'");
      let cid = Number(next.n) || 1;
      // keys first (the card refers to them); the id is taken again from the insert
      const nk = (x) => `vc_${cid}_${x}`;
      const [[taken]] = await q.query('SELECT text_key FROM ui_text_keys WHERE text_key IN (?, ?)', [nk('n'), nk('a')]);
      if (taken) { const [[mx]] = await q.query('SELECT COALESCE(MAX(card_id), 0) + 100 AS n FROM visit_cards'); cid = Number(mx.n); }
      await newText(q, nk('n'), 'Contact details', `Visit card ${cid}: name (Website > Brand and layout > Visit cards)`, b.names, by(req), langs);
      await newText(q, nk('a'), 'Contact details', `Visit card ${cid}: address`, b.addresses, by(req), langs);
      const [ins] = await q.query('INSERT INTO visit_cards (card_id, name_key, address_key, map_query, phone, godown_id, sort_order, is_active, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [cid, nk('n'), nk('a'), v.map_query ?? String(b.addresses[langs.def] || '').trim(), v.phone ?? null, v.godown_id ?? null, Number(so.n) + 1, 'is_active' in v ? v.is_active : 1, by(req)]);
      const card = { card_id: ins.insertId || cid, name_key: nk('n'), address_key: nk('a'), hours_key: null };
      await cardWords(q, card, { hours: b.hours }, langs, by(req));
      await audit(q, { empId: by(req), action: 'create', entity: 'visit_card', entityId: String(card.card_id), after: { names: b.names, addresses: b.addresses, ...v } });
      return card.card_id;
    });
    return { card_id: id, ...(await cardRows()) };
  }, C);
  route('put', '/website/visit-cards/:id', 'content:edit', async (req) => {
    const b = req.body || {};
    const langs = await languages();
    const errs = {};
    if (b.names) { const n = wordsOk(b.names, langs, 'Card name', 120); if (n) errs.names = n; }
    if (b.addresses) { const a = wordsOk(b.addresses, langs, 'Address', 255); if (a) errs.addresses = a; }
    if (Object.keys(errs).length) fail(errs);
    const v = cardValues(b);
    await tx(async (q) => {
      const [[c]] = await q.query('SELECT * FROM visit_cards WHERE card_id = ? FOR UPDATE', [Number(req.params.id)]);
      if (!c) throw new InputError('No such card', 404);
      if (Object.keys(v).length) {
        await q.query(`UPDATE visit_cards SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE card_id = ?`, [...Object.values(v), by(req), c.card_id]);
        await audit(q, { empId: by(req), action: 'update', entity: 'visit_card', entityId: String(c.card_id), before: Object.fromEntries(Object.keys(v).map((k) => [k, c[k]])), after: v });
      }
      await cardWords(q, c, b, langs, by(req));
    });
    return cardRows();
  }, C);
  route('put', '/website/visit-cards-order', 'content:edit', async (req) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : null;
    const [all] = await db.query('SELECT card_id FROM visit_cards');
    const have = new Set(all.map((r) => r.card_id));
    if (!ids || ids.length !== have.size || ids.some((x) => !have.has(x)) || new Set(ids).size !== ids.length) throw new InputError('The order must list every card once (reload and drag again)');
    await tx(async (q) => {
      for (const [i, id] of ids.entries()) await q.query('UPDATE visit_cards SET sort_order = ? WHERE card_id = ?', [i + 1, id]);
      await audit(q, { empId: by(req), action: 'reorder', entity: 'visit_card', entityId: 'cards', after: { ids } });
    });
    return cardRows();
  }, C);
  route('delete', '/website/visit-cards/:id', 'content:delete', async (req) => {
    await tx(async (q) => {
      const [[c]] = await q.query('SELECT * FROM visit_cards WHERE card_id = ? FOR UPDATE', [Number(req.params.id)]);
      if (!c) throw new InputError('No such card', 404);
      if (!/^vc_\d+_n$/.test(c.name_key)) throw new InputError('A built-in card is not deleted: hide it instead (its texts are also the address Google reads)', 409);
      await q.query('DELETE FROM visit_cards WHERE card_id = ?', [c.card_id]);
      await q.query('DELETE FROM ui_text_keys WHERE text_key IN (?)', [[c.name_key, c.address_key, c.hours_key].filter(Boolean)]);
      await audit(q, { empId: by(req), action: 'delete', entity: 'visit_card', entityId: String(c.card_id), before: c });
    });
    return cardRows();
  }, C);

  // ================================================================ read-only facts for Site settings / Google and sharing
  route('get', '/website/facts', 'content:view', async () => {
    const co = await company.facts(db);
    const [[wa]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'whatsapp_display'");
    return {
      company: { name: co.name, cin: co.cin, gstin: co.gstin, phone: co.phone, email: co.email, whatsapp: wa ? wa.setting_value : '' },
      site_url: require('../../config/urls').siteBase(), // eslint-disable-line global-require
      forms: formRules.FORM_TYPES,
    };
  });
}

module.exports = { register, DOOR_TEXTS };
