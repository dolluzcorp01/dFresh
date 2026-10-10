// SEO for the CRA site without server rendering (docs/02 "SEO approach", spec G). In production server.js
// serves build/index.html through render(): per URL and language it sets <html lang>, <title>, meta description,
// canonical, hreflang for every active language + x-default, Open Graph, and JSON-LD (Organization +
// LocalBusiness + ItemList of Products, never a price or offer). /sitemap.xml and /robots.txt are built from
// the DB here too. All words come from ui_text / translations through the cached bootstrap (pageMeta.js).
// Base URL = PUBLIC_SITE_URL. SEO_NOINDEX=true (staging) adds noindex everywhere and robots.txt disallows all.
const { content } = require('./Public_server');
const { siteBase } = require('../../config/urls');
const { BRAND, PAGES, pageMeta } = require('../shared/pageMeta');

const LOGO = '/media/logo/dfresh-logo-on-light.png';
const noindex = () => process.env.SEO_NOINDEX === 'true';

const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON inside <script>: "<" never appears raw, so a text can never close the script tag.
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const ogLocale = (htmlLang) => htmlLang.replace('-', '_');

async function languages() {
  const { data } = await content.loadLanguages();
  return data; // { default, languages: [{ code, htmlLang, dir, ... }] } active only
}

/**
 * Where a request path goes: { lang, page, cat } to render, or { redirect } (301) for a path the client would
 * rewrite anyway (same rules as src/i18n/langRoutes.js fixLangPath + the "*" route), or { root: true } for "/".
 */
function resolve(pathname, query, langs) {
  if (pathname === '/') return { root: true };
  if (/\/[^/]*\.[a-z0-9]{1,5}$/i.test(pathname)) return { notFound: true }; // a missing file, not a page
  const codes = langs.languages.map((l) => l.code);
  const [, rawFirst = '', rest = ''] = /^\/([^/]*)(.*)$/.exec(pathname) || [];
  let first;
  try { first = decodeURIComponent(rawFirst); } catch { first = ''; }
  if (!codes.includes(first)) {
    const lower = first.toLowerCase();
    if (lower && PAGES.includes(lower)) return { redirect: `/${langs.default}${pathname}` };
    return { redirect: `/${codes.includes(lower) ? lower : langs.default}${rest}` };
  }
  const page = rest.replace(/^\/+|\/+$/g, '');
  if (!PAGES.includes(page)) return { redirect: `/${first}` };
  const cat = page === 'products' && typeof query.cat === 'string' ? query.cat : '';
  return { lang: first, page, cat };
}

const pagePath = (lang, page, cat) => `/${lang}${page ? `/${page}` : ''}${cat ? `?cat=${encodeURIComponent(cat)}` : ''}`;

function organisation(base, s) {
  return {
    '@type': 'Organization',
    '@id': `${base}/#organization`,
    name: BRAND,
    legalName: s.company_name || undefined,
    url: `${base}/`,
    logo: `${base}${LOGO}`,
    email: s.public_email || undefined,
    telephone: s.office_phone || undefined,
    address: s.office_address ? { '@type': 'PostalAddress', streetAddress: s.office_address, addressCountry: 'IN' } : undefined,
  };
}

function localBusiness(base, s, boot) {
  const town = (boot.towns || []).find((t) => t.isBase);
  return {
    '@type': 'LocalBusiness',
    '@id': `${base}/#localbusiness`,
    name: BRAND,
    url: `${base}/`,
    image: `${base}${LOGO}`,
    telephone: s.office_phone || undefined,
    email: s.public_email || undefined,
    parentOrganization: { '@id': `${base}/#organization` },
    // The goods ship from the base town's godown; the exact address and pin are open item 4.
    address: { '@type': 'PostalAddress', streetAddress: s.godown_address || s.office_address || '', addressCountry: 'IN' },
    geo: town && town.lat != null ? { '@type': 'GeoCoordinates', latitude: Number(town.lat), longitude: Number(town.lng) } : undefined,
  };
}

// Phase 1 has no prices: Product items carry name, image, sku, brand and description only (no offers).
function itemList(base, lang, products, name) {
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name,
        sku: p.id,
        image: (p.images || []).map((im) => `${base}${im.src}`),
        description: p.oneLiner || p.description || undefined,
        brand: { '@type': 'Brand', name: BRAND },
        category: p.categoryName || undefined,
        url: `${base}/${lang}/products?cat=${encodeURIComponent(p.category)}`,
      },
    })),
  };
}

/** The <head> additions and replacements for one page. */
async function headFor(target, langs) {
  const base = siteBase();
  const { lang, page } = target;
  const boot = (await content.getBootstrap(lang)).data;
  const info = langs.languages.find((l) => l.code === lang);
  const category = target.cat ? (boot.categories || []).find((c) => c.key === target.cat) : null;
  const cat = category ? category.key : ''; // unknown ?cat= -> the plain products page is canonical
  const meta = pageMeta(page, boot.ui, category);
  const canonical = `${base}${pagePath(lang, page, cat)}`;
  const links = [
    `<link rel="canonical" href="${escHtml(canonical)}">`,
    ...langs.languages.map((l) => `<link rel="alternate" hreflang="${escHtml(l.htmlLang)}" href="${escHtml(`${base}${pagePath(l.code, page, cat)}`)}">`),
    `<link rel="alternate" hreflang="x-default" href="${escHtml(`${base}${pagePath(langs.default, page, cat)}`)}">`,
  ];
  const og = [
    ['og:type', 'website'], ['og:site_name', BRAND], ['og:title', meta.title], ['og:description', meta.description],
    ['og:url', canonical], ['og:image', `${base}/media/logo/dfresh-logo-tagline-on-light.png`], ['og:locale', ogLocale(info.htmlLang)],
    ...langs.languages.filter((l) => l.code !== lang).map((l) => ['og:locale:alternate', ogLocale(l.htmlLang)]),
  ].map(([p, v]) => `<meta property="${p}" content="${escHtml(v)}">`);
  const tags = [
    `<meta name="description" content="${escHtml(meta.description)}">`,
    ...(noindex() ? ['<meta name="robots" content="noindex, nofollow">'] : []),
    ...links,
    ...og,
    '<meta name="twitter:card" content="summary">',
  ];
  const graph = [organisation(base, boot.settings)];
  if (page === '') graph.push(localBusiness(base, boot.settings, boot));
  if (page === '' || page === 'products') {
    const catNames = Object.fromEntries((boot.categories || []).map((c) => [c.key, c.name]));
    const products = (boot.products || []).filter((p) => !cat || p.category === cat).map((p) => ({ ...p, categoryName: catNames[p.category] }));
    graph.push(itemList(base, lang, products, category ? category.name : boot.ui.all_h));
  }
  tags.push(jsonLd({ '@context': 'https://schema.org', '@graph': graph }));
  return { htmlLang: info.htmlLang, dir: info.dir === 'rtl' ? 'rtl' : 'ltr', title: meta.title, tags, boot };
}

// The first screen's data (what /languages and /bootstrap would return), so the app renders without waiting for
// two API round trips after main.js. "<" is escaped: no text can close the script element.
const dataTag = (langs, boot) => `<script id="dfresh-data" type="application/json">${
  JSON.stringify({ languages: langs, boot }).replace(/</g, '\\u003c')}</script>`;

function inject(template, head) {
  return template
    .replace(/<html lang="[^"]*"/, `<html lang="${escHtml(head.htmlLang)}" dir="${head.dir}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(head.title)}</title>`)
    .replace('</head>', `${head.tags.join('')}</head>`);
}

/**
 * index.html for a public URL: { status: 200, html }, { status: 301, location } or { status: 404 }.
 * "/" keeps the client's language pick (saved / browser language) but carries the default language's tags.
 */
async function render(template, pathname, query) {
  const langs = await languages();
  const target = resolve(pathname, query || {}, langs);
  if (target.notFound) return { status: 404 };
  if (target.redirect) {
    const qs = new URLSearchParams(query || {}).toString();
    return { status: 301, location: `${target.redirect}${qs ? `?${qs}` : ''}` };
  }
  const head = await headFor(target.root ? { lang: langs.default, page: '' } : target, langs);
  // "/" picks the language in the browser, so only the language list is sent along there.
  head.tags.push(dataTag(langs, target.root ? null : head.boot));
  return { status: 200, html: inject(template, head) };
}

/** /admin/*: the plain shell, never indexed. */
function adminHtml(template) {
  return template.replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>');
}

/** sitemap.xml: every active language x home / products / privacy / terms + each category filter URL. */
async function sitemap() {
  const base = siteBase();
  const langs = await languages();
  const boot = (await content.getBootstrap(langs.default)).data;
  const entries = [['', ''], ['products', ''], ...(boot.categories || []).map((c) => ['products', c.key]), ['privacy', ''], ['terms', '']];
  const x = (v) => escHtml(v).replace(/'/g, '&apos;');
  const urls = [];
  for (const [page, cat] of entries) {
    const alts = [
      ...langs.languages.map((l) => `<xhtml:link rel="alternate" hreflang="${x(l.htmlLang)}" href="${x(`${base}${pagePath(l.code, page, cat)}`)}"/>`),
      `<xhtml:link rel="alternate" hreflang="x-default" href="${x(`${base}${pagePath(langs.default, page, cat)}`)}"/>`,
    ].join('');
    for (const l of langs.languages) urls.push(`<url><loc>${x(`${base}${pagePath(l.code, page, cat)}`)}</loc>${alts}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

function robots() {
  if (noindex()) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteBase()}/sitemap.xml\n`;
}

module.exports = { render, adminHtml, sitemap, robots, resolve, dataTag };
