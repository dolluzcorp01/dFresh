// Integration tests for the public content API builders against the LOCAL dev database.
// Run: npm run test:api   (needs a seeded DB: npm run db:reset)
// Temporary rows use the language code 'zt'; translation rows go with it (ON DELETE CASCADE).
require('dotenv').config({ quiet: true });

// These tests write to the DB. Refuse BEFORE any module below opens a pool.
if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDBConnection } = require('../../config/db');
const cache = require('../../src/backend_routes/content-cache');
const { content } = require('../../src/backend_routes/Public_server');

const pool = getDBConnection(process.env.DB_NAME || 'dfresh');
const db = pool.promise();
const TMP = 'zt';

async function removeTmpLanguage() {
  await db.query('DELETE FROM languages WHERE lang_code = ?', [TMP]);
}

async function bootstrap(lang) {
  const entry = await content.getBootstrap(lang);
  return { data: entry.data, body: entry.body };
}

before(async () => {
  await removeTmpLanguage();
  await db.query(
    `INSERT INTO languages (lang_code, name_en, native_name, switch_label, html_lang, dir, font_family, is_default, is_active, sort_order)
     VALUES (?, 'Test', 'Test', 'ZT', 'zt-IN', 'ltr', NULL, 0, 1, 99)`, [TMP]
  );
  // Exactly one translated product and one translated UI key; everything else must fall back.
  await db.query(
    `INSERT INTO product_translations (product_id, lang_code, name, one_liner, keywords, description, best_for)
     VALUES ('DZIND-DF007', ?, 'ZT napkin', 'ZT line', 'zt-a, zt-b', 'ZT desc', 'ZT best')`, [TMP]
  );
  await db.query(`INSERT INTO ui_text (text_key, lang_code, value) VALUES ('lg_priv', ?, 'ZT privacy')`, [TMP]);
});

beforeEach(() => cache.bust());

test('cache entries are rebuilt after the TTL; a failed rebuild serves the expired copy', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    let builds = 0;
    let failNext = false;
    const builder = async () => {
      builds += 1;
      if (failNext) throw new Error('db down');
      return { n: builds };
    };
    assert.equal((await cache.getOrBuild('ttl-test', builder)).data.n, 1);
    now += cache.TTL_MS - 1000;
    assert.equal((await cache.getOrBuild('ttl-test', builder)).data.n, 1, 'rebuilt before the TTL');
    now += 2000;
    assert.equal((await cache.getOrBuild('ttl-test', builder)).data.n, 2, 'not rebuilt after the TTL');

    now += cache.TTL_MS + 1;
    failNext = true;
    assert.equal((await cache.getOrBuild('ttl-test', builder)).data.n, 2, 'expired copy not served on failure');
    failNext = false;
    assert.equal((await cache.getOrBuild('ttl-test', builder)).data.n, 4, 'failed rebuild not retried');

    cache.bust();
    failNext = true;
    await assert.rejects(cache.getOrBuild('ttl-test', builder), /db down/);
  } finally {
    Date.now = realNow;
  }
});

after(async () => {
  await removeTmpLanguage();
  cache.bust();
  await pool.promise().end();
});

test('missing translation rows fall back to English, present rows are used', async () => {
  const en = (await bootstrap('en')).data;
  const zt = (await bootstrap(TMP)).data;
  assert.equal(zt.lang, TMP);

  const df7 = zt.products.find((p) => p.id === 'DZIND-DF007');
  assert.equal(df7.name, 'ZT napkin');
  assert.deepEqual(df7.keywords, ['zt-a', 'zt-b']);
  // Columns NULL in the zt row fall back too (alt text, WhatsApp, spec override -> base spec).
  const enDf7 = en.products.find((p) => p.id === 'DZIND-DF007');
  assert.equal(df7.alt, enDf7.alt);
  assert.equal(df7.spec, enDf7.spec);
  assert.ok(df7.spec.length > 0);

  const df1 = zt.products.find((p) => p.id === 'DZIND-DF001');
  assert.equal(df1.name, en.products.find((p) => p.id === 'DZIND-DF001').name);

  assert.equal(zt.ui.lg_priv, 'ZT privacy');
  assert.equal(zt.ui.lg_terms_h, en.ui.lg_terms_h);
  assert.equal(Object.keys(zt.ui).length, Object.keys(en.ui).length);
  assert.deepEqual(zt.categories.map((c) => c.name), en.categories.map((c) => c.name));
  assert.equal(zt.banners.length, en.banners.length);
  assert.deepEqual(zt.formOptions, en.formOptions);

  const legal = (await content.getLegal('privacy', TMP)).data;
  assert.equal(legal.title, 'ZT privacy');
  assert.equal(legal.isEnglishFallback, true);
  assert.equal((await content.getLegal('privacy', 'en')).data.isEnglishFallback, false);
});

test('inactive or unknown language is served as the default language', async () => {
  await db.query('UPDATE languages SET is_active = 0 WHERE lang_code = ?', [TMP]);
  try {
    cache.bust();
    const langs = (await content.loadLanguages()).data;
    assert.ok(!langs.languages.some((l) => l.code === TMP), 'inactive language is listed');

    const inactive = (await bootstrap(TMP)).data;
    assert.equal(inactive.lang, langs.default);
    assert.equal(inactive.products.find((p) => p.id === 'DZIND-DF007').name,
      (await bootstrap(langs.default)).data.products.find((p) => p.id === 'DZIND-DF007').name);

    assert.equal((await bootstrap('nope')).data.lang, langs.default);
    assert.equal((await bootstrap('')).data.lang, langs.default);
  } finally {
    await db.query('UPDATE languages SET is_active = 1 WHERE lang_code = ?', [TMP]);
  }
});

test('variants are nested under their card and never listed as cards', async () => {
  const { data } = await bootstrap('en');
  const [[{ cards }]] = await db.query(
    `SELECT COUNT(*) AS cards FROM products p JOIN categories c ON c.category_key = p.category_key
      WHERE p.is_active = 1 AND c.is_active = 1 AND p.variant_of IS NULL`
  );
  assert.equal(data.products.length, Number(cards));
  assert.ok(data.products.every((p) => Array.isArray(p.variants)));

  const [variantRows] = await db.query(
    'SELECT product_id, variant_of FROM products WHERE is_active = 1 AND variant_of IS NOT NULL ORDER BY sort_order'
  );
  assert.ok(variantRows.length > 0);
  for (const v of variantRows) {
    assert.ok(!data.products.some((p) => p.id === v.product_id), `${v.product_id} listed as a card`);
    const parent = data.products.find((p) => p.id === v.variant_of);
    assert.ok(parent.variants.some((x) => x.id === v.product_id), `${v.product_id} not under ${v.variant_of}`);
  }
  const df8 = data.products.find((p) => p.id === 'DZIND-DF008');
  assert.deepEqual(df8.variants.map((v) => v.id), ['DZIND-DF008-BLK', 'DZIND-DF008-BUR', 'DZIND-DF008-LAV']);
  for (const v of df8.variants) {
    assert.equal(v.images.length, 3);
    assert.match(v.images[0].srcset, /400w, .* 800w, .* 1200w$/);
    assert.ok(v.colourName);
  }
});

test('internal fields never appear in public responses', async () => {
  const [statusRows] = await db.query('SELECT DISTINCT spec_status FROM products WHERE spec_status IS NOT NULL');
  const [hiddenSettings] = await db.query('SELECT setting_key FROM site_settings WHERE is_public = 0');
  const [notes] = await db.query('SELECT DISTINCT note FROM banners WHERE note IS NOT NULL');
  assert.ok(statusRows.length > 0 && hiddenSettings.length > 0);

  const bodies = [];
  for (const lang of ['en', 'ta', 'hi', TMP]) bodies.push((await bootstrap(lang)).body);
  bodies.push((await content.loadLanguages()).body);
  bodies.push((await content.getLegal('privacy', 'en')).body, (await content.getLegal('terms', 'ta')).body);

  for (const body of bodies) {
    for (const word of ['spec_status', 'specStatus', 'staff_notes', 'ip_hash', 'is_public']) {
      assert.ok(!body.includes(word), `"${word}" found in a public response`);
    }
    for (const { spec_status } of statusRows) assert.ok(!body.includes(spec_status), 'spec_status value leaked');
    for (const { note } of notes) assert.ok(!body.includes(note), 'banner note leaked');
    for (const { setting_key } of hiddenSettings) {
      assert.ok(!body.includes(`"${setting_key}"`), `non-public setting ${setting_key} leaked`);
    }
  }
  // Legal bodies are served by /legal, not inside the bootstrap ui map.
  const en = (await bootstrap('en')).data;
  assert.ok(!('legal_privacy_body' in en.ui) && !('legal_terms_body' in en.ui));
});

test('HTML sanitiser keeps only allow-listed tags', () => {
  const allowed = new Set(['p', 'em', 'br']);
  assert.equal(
    content.sanitizeHtml('<p class="x" onclick="y()">Hi <em>you</em><br/></p><script>alert(1)</script>', allowed),
    '<p>Hi <em>you</em><br></p>'
  );
  // Removing a disallowed tag must not let the remaining text re-form a <script> tag.
  assert.equal(content.sanitizeHtml('<scr<b>ipt>alert(1)</scr</b>ipt>', allowed),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(content.sanitizeHtml('<img src=x onerror=alert(1)>a < b', allowed), 'a &lt; b');
});
