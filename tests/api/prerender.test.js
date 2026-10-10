// Pre-rendered page bodies (seo.js bodyFor): HTML is only sent when it was rendered from exactly the data the
// page carries (#dfresh-data); stale build-time HTML is rendered again; "/" and a broken render get the plain
// shell. Uses a fake build-ssr (temp folder) and the LOCAL dev database for the content.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDBConnection } = require('../../config/db');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dfresh-ssr-'));
process.env.SSR_DIR = DIR;
const TEMPLATE = '<!doctype html><html lang="en"><head><title>x</title></head><body><div id="root"></div></body></html>';
let seo;
let content;

before(async () => {
  // Fake bundle: says which page it rendered; '/hi' fails.
  fs.writeFileSync(path.join(DIR, 'ssr.js'), `let n = 0;
exports.renderPage = async (url) => { if (url === '/hi') throw new Error('boom'); n += 1; return '<p>live ' + url + ' ' + n + '</p>'; };`);
  seo = require('../../src/backend_routes/seo');
  ({ content } = require('../../src/backend_routes/Public_server'));
  const langs = (await content.loadLanguages()).data;
  const en = (await content.getBootstrap('en')).data;
  fs.writeFileSync(path.join(DIR, 'pages.json'), JSON.stringify({
    '/en': { hash: seo.dataHash(langs, en), html: '<p>built /en</p>' },
    '/en/terms': { hash: 'stale', html: '<p>built /en/terms</p>' },
  }));
});

after(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  await getDBConnection(process.env.DB_NAME || 'dfresh').end();
});

const body = (html) => /<div id="root">([\s\S]*?)<\/div>/.exec(html)[1];

test('build-time HTML is used when its data matches', async () => {
  assert.equal(body((await seo.render(TEMPLATE, '/en', {})).html), '<p>built /en</p>');
});

test('stale build-time HTML is never sent: the page is rendered again, once', async () => {
  const first = body((await seo.render(TEMPLATE, '/en/terms', {})).html);
  assert.match(first, /^<p>live \/en\/terms \d+<\/p>$/);
  assert.equal(body((await seo.render(TEMPLATE, '/en/terms', {})).html), first);
});

test('"/" and a failing render get the plain shell', async () => {
  assert.equal(body((await seo.render(TEMPLATE, '/', {})).html), '');
  const { status, html } = await seo.render(TEMPLATE, '/hi', {});
  assert.equal(status, 200);
  assert.equal(body(html), '');
});
