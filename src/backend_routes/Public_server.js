// Public, read-only content API: /api/dfresh/languages, /bootstrap, /legal/:page (docs/06_API.md).
// Everything is built from the DB with the default-language fallback (i18n-sql.js) and cached per
// language (content-cache.js). Internal columns (spec_status, banners.note, non-public settings)
// are never selected.

const express = require('express');
const { getDBConnection } = require('../../config/db');
const { translatedSelect } = require('./i18n-sql');
const cache = require('./content-cache');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';
const IMAGE_SIZES = [400, 800, 1200];

// Legal pages: title key + HTML body key. The bodies are served here, not in the bootstrap ui map.
const LEGAL_PAGES = {
  privacy: { title: 'lg_priv', body: 'legal_privacy_body' },
  terms: { title: 'lg_terms_h', body: 'legal_terms_body' },
};
const LEGAL_BODY_KEYS = Object.values(LEGAL_PAGES).map((p) => p.body);

const UI_HTML_TAGS = new Set(['br', 'em']);
const LEGAL_HTML_TAGS = new Set(['p', 'h3', 'h4', 'ul', 'ol', 'li', 'br', 'em', 'strong']);

// Keeps only allow-listed tags (attributes dropped); every other '<' / '>' is escaped, so text
// left between removed tags can never re-form markup.
function sanitizeHtml(html, allowed) {
  const src = String(html)
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const escape = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>/g;
  let out = '';
  let last = 0;
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    out += escape(src.slice(last, m.index));
    const tag = m[2].toLowerCase();
    if (allowed.has(tag)) out += tag === 'br' ? '<br>' : `<${m[1]}${tag}>`;
    last = tagRe.lastIndex;
  }
  return out + escape(src.slice(last));
}

const bool = (v) => Number(v) === 1;
const num = (v) => (v === null || v === undefined ? null : Number(v));

function splitKeywords(s) {
  return String(s || '').split(',').map((k) => k.trim()).filter(Boolean);
}

function imageUrls(file) {
  const f = encodeURIComponent(file);
  return {
    src: `/media/products/1200/${f}`,
    srcset: IMAGE_SIZES.map((w) => `/media/products/${w}/${f} ${w}w`).join(', '),
  };
}

// ---------------------------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------------------------
function loadLanguages() {
  return cache.getOrBuild('languages', async () => {
    const [rows] = await db.query(
      `SELECT lang_code, native_name, switch_label, html_lang, dir, font_family, is_default
         FROM languages
        WHERE is_active = 1
        ORDER BY sort_order, lang_code`
    );
    const languages = rows.map((r) => ({
      code: r.lang_code,
      nativeName: r.native_name,
      switchLabel: r.switch_label,
      htmlLang: r.html_lang,
      dir: r.dir,
      fontFamily: r.font_family,
      isDefault: bool(r.is_default),
    }));
    if (!languages.length) throw new Error('no active language');
    const def = languages.find((l) => l.isDefault) || languages[0];
    return { languages, default: def.code };
  });
}

// Unknown, inactive or malformed lang -> the default language (the client then redirects).
async function resolveLang(requested) {
  const { data } = await loadLanguages();
  const active = data.languages.some((l) => l.code === requested);
  return { lang: active ? requested : data.default, fallback: data.default, activeCount: data.languages.length };
}

// ---------------------------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------------------------
async function query(spec, lang, fallback) {
  const { sql, params } = translatedSelect(spec, lang, fallback);
  const [rows] = await db.query(sql, params);
  return rows;
}

async function buildBootstrap(lang, fallback, activeLanguages) {
  const q = (spec) => query(spec, lang, fallback);
  const [uiRows, productRows, imageRows, categoryRows, bannerRows, kitRows, kitProductRows,
    townRows, optionRows, sizeRows, settingRows] = await Promise.all([
    q({
      base: 'ui_text_keys', tr: 'ui_text', keys: ['text_key'],
      baseCols: ['text_key', 'allows_html'], trCols: [{ col: 'value' }],
      where: `b.text_key NOT IN (${LEGAL_BODY_KEYS.map(() => '?').join(', ')})`,
      whereParams: LEGAL_BODY_KEYS,
      orderBy: 'b.text_key',
    }),
    q({
      base: 'products', tr: 'product_translations', keys: ['product_id'],
      baseCols: ['product_id', 'category_key', 'variant_of', 'sort_order', 'is_featured',
        'featured_order', 'show_for_home', 'swatch_hex'],
      trCols: [
        { col: 'name' }, { col: 'one_liner' }, { col: 'keywords' }, { col: 'description' },
        { col: 'best_for' }, { col: 'colour_name' },
        { col: 'specification', baseFallback: 'specification' },
        { col: 'pack', baseFallback: 'pack' },
        { col: 'alt_text' }, { col: 'whatsapp_message' },
      ],
      where: 'b.is_active = 1 AND b.category_key IN (SELECT category_key FROM categories WHERE is_active = 1)',
      orderBy: 'b.sort_order, b.product_id',
    }),
    db.query('SELECT product_id, position, file_name, width, height FROM product_images ORDER BY product_id, position')
      .then(([r]) => r),
    q({
      base: 'categories', tr: 'category_translations', keys: ['category_key'],
      baseCols: ['category_key', 'sort_order', 'rep_product_id'], trCols: [{ col: 'name' }],
      where: 'b.is_active = 1', orderBy: 'b.sort_order, b.category_key',
    }),
    q({
      base: 'banners', tr: 'banner_translations', keys: ['banner_key'],
      baseCols: ['banner_key', 'theme', 'cta_action', 'cta_target', 'desktop_file', 'mobile_file'],
      trCols: [{ col: 'headline' }, { col: 'cta_label' }],
      where: 'b.is_active = 1', orderBy: 'b.sort_order, b.banner_key',
    }),
    q({
      base: 'kits', tr: 'kit_translations', keys: ['kit_key'],
      baseCols: ['kit_key', 'business_type', 'rep_product_id'], trCols: [{ col: 'name' }, { col: 'tagline' }],
      where: 'b.is_active = 1', orderBy: 'b.sort_order, b.kit_key',
    }),
    db.query('SELECT kit_key, product_id FROM kit_products ORDER BY kit_key, sort_order, product_id')
      .then(([r]) => r),
    q({
      base: 'towns', tr: 'town_translations', keys: ['town_key'],
      baseCols: ['town_key', 'is_base', 'map_x', 'map_y', 'lat', 'lng'], trCols: [{ col: 'name' }],
      where: 'b.is_active = 1', orderBy: 'b.sort_order, b.town_key',
    }),
    q({
      base: 'form_options', tr: 'form_option_translations', keys: ['list_key', 'option_value'],
      baseCols: ['list_key', 'option_value'], trCols: [{ col: 'label' }],
      where: 'b.is_active = 1', orderBy: 'b.list_key, b.sort_order, b.option_value',
    }),
    db.query('SELECT position, product_id, size_label, scale, is_default FROM size_picker ORDER BY position')
      .then(([r]) => r),
    db.query('SELECT setting_key, setting_value FROM site_settings WHERE is_public = 1 ORDER BY setting_key')
      .then(([r]) => r),
  ]);

  const ui = {};
  for (const r of uiRows) ui[r.text_key] = bool(r.allows_html) ? sanitizeHtml(r.value, UI_HTML_TAGS) : r.value;

  const imagesByProduct = new Map();
  for (const r of imageRows) {
    if (!imagesByProduct.has(r.product_id)) imagesByProduct.set(r.product_id, []);
    imagesByProduct.get(r.product_id).push({
      pos: Number(r.position), ...imageUrls(r.file_name), width: num(r.width), height: num(r.height),
    });
  }

  const toProduct = (r) => ({
    id: r.product_id,
    category: r.category_key,
    sort: Number(r.sort_order),
    featured: bool(r.is_featured),
    featuredOrder: num(r.featured_order),
    forHome: bool(r.show_for_home),
    swatch: r.swatch_hex,
    spec: r.specification,
    pack: r.pack,
    name: r.name,
    oneLiner: r.one_liner,
    keywords: splitKeywords(r.keywords),
    description: r.description,
    bestFor: r.best_for,
    colourName: r.colour_name,
    alt: r.alt_text,
    whatsapp: r.whatsapp_message,
    images: imagesByProduct.get(r.product_id) || [],
  });

  // Cards first, then attach each variant to its (active) parent; orphans are dropped.
  const products = [];
  const cardsById = new Map();
  for (const r of productRows) {
    if (r.variant_of !== null) continue;
    const card = { ...toProduct(r), variants: [] };
    products.push(card);
    cardsById.set(card.id, card);
  }
  for (const r of productRows) {
    if (r.variant_of === null) continue;
    const parent = cardsById.get(r.variant_of);
    if (parent) {
      const { category, featured, featuredOrder, forHome, ...variant } = toProduct(r);
      parent.variants.push(variant);
    }
  }

  const cardCount = (key) => products.filter((p) => p.category === key).length;
  const categories = categoryRows.map((r) => ({
    key: r.category_key,
    sort: Number(r.sort_order),
    repProductId: r.rep_product_id,
    name: r.name,
    count: cardCount(r.category_key),
  }));

  const banners = bannerRows.map((r) => ({
    key: r.banner_key,
    theme: r.theme,
    ctaAction: r.cta_action,
    ctaTarget: r.cta_target,
    desktop: `/media/banners/desktop/${encodeURIComponent(r.desktop_file)}`,
    mobile: `/media/banners/mobile/${encodeURIComponent(r.mobile_file)}`,
    headline: r.headline,
    ctaLabel: r.cta_label,
  }));

  const kitProducts = new Map();
  for (const r of kitProductRows) {
    if (!cardsById.has(r.product_id)) continue;
    if (!kitProducts.has(r.kit_key)) kitProducts.set(r.kit_key, []);
    kitProducts.get(r.kit_key).push(r.product_id);
  }
  const kits = kitRows.map((r) => ({
    key: r.kit_key,
    businessType: r.business_type,
    repProductId: r.rep_product_id,
    name: r.name,
    tagline: r.tagline,
    products: kitProducts.get(r.kit_key) || [],
  }));

  const towns = townRows.map((r) => ({
    key: r.town_key,
    isBase: bool(r.is_base),
    mapX: num(r.map_x),
    mapY: num(r.map_y),
    lat: num(r.lat),
    lng: num(r.lng),
    name: r.name,
  }));

  const formOptions = {};
  for (const r of optionRows) {
    (formOptions[r.list_key] ||= []).push({ value: r.option_value, label: r.label });
  }

  const sizePicker = sizeRows
    .filter((r) => cardsById.has(r.product_id))
    .map((r) => ({
      pos: Number(r.position),
      productId: r.product_id,
      size: r.size_label,
      scale: Number(r.scale),
      isDefault: bool(r.is_default),
    }));

  const settings = {};
  for (const r of settingRows) settings[r.setting_key] = r.setting_value;

  return {
    lang,
    ui,
    settings,
    categories,
    products,
    banners,
    kits,
    towns,
    formOptions,
    sizePicker,
    stats: {
      products: products.length,
      categories: categories.length,
      towns: towns.length,
      languages: activeLanguages,
    },
    contentVersion: cache.getContentVersion(),
  };
}

async function getBootstrap(requested) {
  const { lang, fallback, activeCount } = await resolveLang(requested);
  return cache.getOrBuild(`bootstrap:${lang}`, () => buildBootstrap(lang, fallback, activeCount));
}

// ---------------------------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------------------------
async function buildLegal(page, lang, fallback) {
  const { title, body } = LEGAL_PAGES[page];
  const rows = await query({
    base: 'ui_text_keys', tr: 'ui_text', keys: ['text_key'],
    baseCols: ['text_key'], trCols: [{ col: 'value' }],
    where: 'b.text_key IN (?, ?)', whereParams: [title, body],
    presenceAs: 'has_own',
  }, lang, fallback);
  const byKey = Object.fromEntries(rows.map((r) => [r.text_key, r]));
  if (!byKey[title] || !byKey[body]) throw new Error(`legal text missing for ${page}`);
  return {
    lang,
    page,
    title: byKey[title].value,
    html: sanitizeHtml(byKey[body].value, LEGAL_HTML_TAGS),
    isEnglishFallback: !bool(byKey[body].has_own),
  };
}

async function getLegal(page, requested) {
  const { lang, fallback } = await resolveLang(requested);
  return cache.getOrBuild(`legal:${page}:${lang}`, () => buildLegal(page, lang, fallback));
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------
function sendCached(req, res, entry) {
  res.set('Cache-Control', CACHE_CONTROL);
  res.set('ETag', entry.etag);
  res.type('application/json');
  res.send(entry.body); // Express answers 304 itself when If-None-Match matches the ETag
}

const langParam = (req) => (typeof req.query.lang === 'string' ? req.query.lang : '');

function fail(res, err, what) {
  console.error(`${what} failed:`, err.code || err.message);
  res.status(500).json({ success: false, message: 'Content unavailable' });
}

router.get('/languages', async (req, res) => {
  try {
    sendCached(req, res, await loadLanguages());
  } catch (err) {
    fail(res, err, 'languages');
  }
});

router.get('/bootstrap', async (req, res) => {
  try {
    sendCached(req, res, await getBootstrap(langParam(req)));
  } catch (err) {
    fail(res, err, 'bootstrap');
  }
});

router.get('/legal/:page', async (req, res) => {
  if (!Object.hasOwn(LEGAL_PAGES, req.params.page)) {
    return res.status(404).json({ success: false, message: 'Page not found' });
  }
  try {
    sendCached(req, res, await getLegal(req.params.page, langParam(req)));
  } catch (err) {
    fail(res, err, 'legal');
  }
});

module.exports = router;
// For tests: the same cached builders the routes use.
module.exports.content = { loadLanguages, getBootstrap, getLegal, sanitizeHtml };
