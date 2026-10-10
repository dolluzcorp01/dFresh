// SEO head injection, redirects, sitemap and robots (phase 8, spec G) against the LOCAL dev database.
// Run: npm run test:api   (needs a seeded DB: npm run db:reset)
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}
process.env.PUBLIC_SITE_URL = 'https://site.example';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../../src/backend_routes/seo');
const { getDBConnection } = require('../../config/db');

const TEMPLATE = '<!DOCTYPE html><html lang="en"><head><title>dFresh</title></head><body><div id="root"></div></body></html>';
const LANGS = { default: 'en', languages: [{ code: 'en' }, { code: 'ta' }, { code: 'hi' }] };

after(() => getDBConnection(process.env.DB_NAME || 'dfresh').end());

const tag = (html, re) => (re.exec(html) || [])[1];
const ldOf = (html) => JSON.parse(tag(html, /<script type="application\/ld\+json">(.*?)<\/script>/s));

test('paths resolve like the client router (langRoutes.js fixLangPath + the "*" route)', () => {
  const cases = [
    ['/', { root: true }], ['/en', { lang: 'en', page: '', cat: '' }], ['/ta/products', { lang: 'ta', page: 'products', cat: '' }],
    ['/products', { redirect: '/en/products' }], ['/EN/terms', { redirect: '/en/terms' }], ['/xx/privacy', { redirect: '/en/privacy' }],
    ['/foo', { redirect: '/en' }], ['/hi/nope', { redirect: '/hi' }], ['/static/js/gone.js', { notFound: true }],
  ];
  for (const [path, want] of cases) assert.deepEqual(seo.resolve(path, {}, LANGS), want, path);
});

test('every page gets its language, title, description, canonical, hreflang x3 + x-default, OG and JSON-LD', async () => {
  const out = await seo.render(TEMPLATE, '/ta/products', { cat: 'napkins' });
  assert.equal(out.status, 200);
  const h = out.html;
  // The script's type tuning and font are on <html> before main.js (same rule as applyLanguage in I18nProvider).
  assert.match(h, /<html lang="ta-IN" dir="ltr" data-script="long" style="--f-lang: &quot;Noto Sans Tamil&quot;">/);
  assert.match(tag(h, /<title>(.*?)<\/title>/), / \| dFresh$/);
  assert.ok(tag(h, /<meta name="description" content="([^"]+)"/).length > 40);
  assert.equal(tag(h, /<link rel="canonical" href="([^"]+)"/), 'https://site.example/ta/products?cat=napkins');
  const alts = [...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(alts.sort(), [
    'en-IN https://site.example/en/products?cat=napkins', 'hi-IN https://site.example/hi/products?cat=napkins',
    'ta-IN https://site.example/ta/products?cat=napkins', 'x-default https://site.example/en/products?cat=napkins',
  ]);
  assert.match(h, /<meta property="og:locale" content="ta_IN">/);
  const ld = ldOf(h)['@graph'];
  const list = ld.find((g) => g['@type'] === 'ItemList');
  assert.ok(list.itemListElement.length > 0 && list.itemListElement.every((i) => i.item.sku && i.item.brand.name === 'dFresh'));
  assert.ok(!/"(offers|price|priceCurrency)"/.test(JSON.stringify(ld)), 'no price or offers anywhere (Phase 1)');
  const data = JSON.parse(tag(h, /<script id="dfresh-data" type="application\/json">(.*?)<\/script>/s));
  assert.equal(data.boot.lang, 'ta');
});

test('home has Organization + LocalBusiness (geo from the base town) + all products; an unknown ?cat= is canonical without it', async () => {
  const home = ldOf((await seo.render(TEMPLATE, '/en', {})).html)['@graph'];
  assert.deepEqual(home.map((g) => g['@type']), ['Organization', 'LocalBusiness', 'ItemList']);
  assert.equal(typeof home[1].geo.latitude, 'number');
  const [[{ n }]] = await getDBConnection(process.env.DB_NAME || 'dfresh').promise()
    .query('SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND variant_of IS NULL');
  assert.equal(home[2].itemListElement.length, Number(n));
  const odd = (await seo.render(TEMPLATE, '/en/products', { cat: 'nope' })).html;
  assert.equal(tag(odd, /<link rel="canonical" href="([^"]+)"/), 'https://site.example/en/products');
});

test('text that looks like markup cannot break out of the head: the JSON blocks hold no raw "<"', async () => {
  const out = await seo.render(TEMPLATE, '/hi', {});
  const data = tag(out.html, /<script id="dfresh-data" type="application\/json">(.*?)<\/script>/s);
  const ld = tag(out.html, /<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(data.length > 1000 && !data.includes('<'), 'data script');
  assert.ok(!ld.includes('<'), 'JSON-LD');
  assert.equal(JSON.parse(data).boot.lang, 'hi');
  // A hostile text (e.g. typed into the admin) stays inside the script and reads back unchanged.
  const evil = '</script><script>alert(1)</script><!--';
  const t = seo.dataTag({ x: 1 }, { ui: { k: evil } });
  assert.equal((t.match(/<\/script>/g) || []).length, 1);
  assert.equal(JSON.parse(t.replace(/^<script[^>]*>|<\/script>$/g, '')).boot.ui.k, evil);
});

test('redirects keep the query; missing files are 404', async () => {
  assert.deepEqual(await seo.render(TEMPLATE, '/products', { cat: 'wipes' }), { status: 301, location: '/en/products?cat=wipes' });
  assert.deepEqual(await seo.render(TEMPLATE, '/media/nope.webp', {}), { status: 404 });
});

test('sitemap: every active language x (home, products, each category, privacy, terms), with alternates', async () => {
  const xml = await seo.sitemap();
  const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
  const [[{ langs }]] = await db.query('SELECT COUNT(*) AS langs FROM languages WHERE is_active = 1');
  const [[{ cats }]] = await db.query('SELECT COUNT(*) AS cats FROM categories WHERE is_active = 1');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, Number(langs) * (4 + Number(cats)));
  assert.equal(new Set(locs).size, locs.length, 'no duplicates');
  assert.ok(locs.includes('https://site.example/hi/terms') && locs.includes('https://site.example/ta/products?cat=napkins'));
  assert.equal((xml.match(/hreflang="x-default"/g) || []).length, locs.length);
});

test('robots: admin and api disallowed, sitemap listed; SEO_NOINDEX blocks everything', () => {
  assert.equal(seo.robots(), 'User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: https://site.example/sitemap.xml\n');
  process.env.SEO_NOINDEX = 'true';
  try {
    assert.equal(seo.robots(), 'User-agent: *\nDisallow: /\n');
  } finally {
    delete process.env.SEO_NOINDEX;
  }
});
