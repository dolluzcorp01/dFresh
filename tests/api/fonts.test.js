// Script fonts without a developer (font-manager.js), against the LOCAL dev database, through the admin API:
// - a Tamil text saved with a character missing from the subset -> the full Tamil font is served at once,
//   the subset is rebuilt by itself and the CSS points to the new file, which has the glyph;
// - a failing rebuild keeps the full font, logs one line, shows on the dashboard, and recovers;
// - a test language with the Telugu script, 3 texts, switched on -> Noto Sans Telugu is served within seconds;
//   switched off and deleted -> gone from the CSS.
// Fonts are written to a temp folder (FONT_DIR / FONT_MANIFEST), not media/ or private/. Restores every text,
// deletes the test language (zte) and the temporary admin ZZU-FONT.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dfresh-fonts-'));
process.env.FONT_DIR = path.join(TMP, 'fonts');
process.env.FONT_MANIFEST = path.join(TMP, 'manifest.json');
process.env.FONT_DEBOUNCE_MS = '50';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const subsetFont = require('subset-font');
const fontverter = require('fontverter');
const { getDBConnection } = require('../../config/db');
const fontManager = require('../../src/backend_routes/font-manager');
const contentCache = require('../../src/backend_routes/content-cache');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const ADMIN = 'ZZU-FONT';
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const TAMIL = 'Noto Sans Tamil';
const TELUGU = 'Noto Sans Telugu';
const SOURCE = (family) => path.join(__dirname, '..', '..', 'fonts', 'source', `${family.toLowerCase().replace(/ /g, '-')}.woff2`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let base;
let server;
const saved = [];

async function call(method, p, body) {
  const token = jwt.sign({ sub: ADMIN, app: APP, stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const res = await fetch(`${base}/api/dfresh${p}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: `${COOKIE}=${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function cmap(file) {
  const { Blob: HbBlob, Face } = await import('harfbuzzjs');
  const sfnt = await fontverter.convert(fs.readFileSync(file), 'truetype');
  return new Set(new Face(new HbBlob(sfnt), 0).collectUnicodes());
}

const manifest = () => JSON.parse(fs.readFileSync(process.env.FONT_MANIFEST, 'utf8')).families;
const faceOf = (family) => fontManager.css().split('\n').find((l) => l.includes(`font-family:'${family}'`)) || '';
const realSubset = async (family, text) => subsetFont(fs.readFileSync(SOURCE(family)), text, { targetFormat: 'woff2' });
const inRange = (rule, cp) => (((/unicode-range:([^}]+)/.exec(rule)) || [])[1] || '').split(',').some((r) => {
  const [a, b] = r.trim().replace('U+', '').split('-').map((h) => parseInt(h, 16));
  return cp >= a && cp <= (b ?? a);
});

// A character the Tamil font has but the current subset does not.
async function missingTamil(skip = []) {
  const have = new Set([...manifest()[TAMIL].subset.chars].map((c) => c.codePointAt(0)));
  const font = await cmap(SOURCE(TAMIL));
  for (let cp = 0x0b80; cp <= 0x0bff; cp += 1) if (font.has(cp) && !have.has(cp) && !skip.includes(cp)) return cp;
  throw new Error('no Tamil character left to test with');
}

async function setText(key, lang, value) {
  const [[row]] = await db.query('SELECT value FROM ui_text WHERE text_key = ? AND lang_code = ?', [key, lang]);
  if (!saved.some((s) => s.key === key && s.lang === lang)) saved.push({ key, lang, value: row ? row.value : null });
  const r = await call('PUT', `/admin/ui-text/${key}/${lang}`, { value });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

before(async () => {
  await db.query('DELETE FROM admin_users WHERE emp_id = ?', [ADMIN]);
  await db.query("INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, 'admin', 1, 'fonts test')", [ADMIN]);
  await db.query("DELETE FROM languages WHERE lang_code = 'zte'");
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/dfresh', require('../../src/backend_routes/Admin_login_server'));
  app.use('/api/dfresh', require('../../src/backend_routes/Admin_server'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await fontManager.init();
  await fontManager.whenIdle();
});

after(async () => {
  fontManager.setSubsetter(null);
  for (const s of saved.reverse()) {
    if (s.value === null) await db.query('DELETE FROM ui_text WHERE text_key = ? AND lang_code = ?', [s.key, s.lang]);
    else await db.query('UPDATE ui_text SET value = ? WHERE text_key = ? AND lang_code = ?', [s.value, s.key, s.lang]);
  }
  await db.query("DELETE FROM languages WHERE lang_code = 'zte'");
  await db.query('DELETE FROM audit_log WHERE emp_id = ?', [ADMIN]);
  await db.query('DELETE FROM admin_users WHERE emp_id = ?', [ADMIN]);
  contentCache.bust();
  fontManager.stop();
  server.close();
  await db.end();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('start-up: Tamil and Devanagari subsets ready, Open Sans built in, every face in the CSS', () => {
  const st = Object.fromEntries(fontManager.status().map((s) => [s.family, s.status]));
  assert.equal(st[TAMIL], 'ready');
  assert.equal(st['Noto Sans Devanagari'], 'ready');
  assert.equal(st['Open Sans'], 'bundled');
  assert.match(faceOf(TAMIL), /url\(\/media\/fonts\/noto-sans-tamil-[0-9a-f]{10}\.woff2\)/);
  assert.ok(fontManager.css().includes("font-family:'dFresh label Noto Sans Tamil'"));
});

test('a saved Tamil text with a new character: full font at once, subset rebuilt by itself with the glyph', async () => {
  const cp = await missingTamil();
  const before = faceOf(TAMIL);
  const version = contentCache.getContentVersion();
  fontManager.setSubsetter(async (family, text) => { await sleep(600); return realSubset(family, text); });
  const [[eyebrow]] = await db.query("SELECT value FROM ui_text WHERE text_key = 'eyebrow' AND lang_code = 'ta'");
  await setText('eyebrow', 'ta', `${eyebrow.value} ${String.fromCodePoint(cp)}`);
  // while it is rebuilt: the full Tamil font (has every Tamil glyph) - never a missing glyph
  let sawFull = false;
  for (let i = 0; i < 60 && !sawFull; i += 1) { await sleep(25); sawFull = fontManager.familyStatus(TAMIL).status === 'rebuilding' && faceOf(TAMIL).includes('noto-sans-tamil-full-'); }
  assert.ok(sawFull, 'the full font is served while the subset is rebuilt');
  await fontManager.whenIdle();
  fontManager.setSubsetter(null);
  const after = faceOf(TAMIL);
  assert.equal(fontManager.familyStatus(TAMIL).status, 'ready');
  assert.notEqual(after, before, 'new content-hashed file');
  assert.ok(inRange(after, cp), `unicode-range covers U+${cp.toString(16)}`);
  const file = /url\(\/media\/fonts\/([^)]+)\)/.exec(after)[1];
  assert.ok((await cmap(path.join(process.env.FONT_DIR, file))).has(cp), 'the new subset file has the glyph');
  assert.ok(contentCache.getContentVersion() > version, 'contentVersion bumped');
});

test('a failing rebuild keeps the full font, logs one line, shows on the dashboard, and recovers', async () => {
  const cp = await missingTamil();
  const lines = [];
  const { error } = console;
  console.error = (...a) => lines.push(a.join(' '));
  try {
    fontManager.setSubsetter(async () => { throw new Error('harfbuzz said no'); });
    const [[lede]] = await db.query("SELECT value FROM ui_text WHERE text_key = 'lede' AND lang_code = 'ta'");
    await setText('lede', 'ta', `${lede.value} ${String.fromCodePoint(cp)}`);
    await fontManager.whenIdle();
  } finally {
    console.error = error;
  }
  assert.equal(fontManager.familyStatus(TAMIL).status, 'full');
  assert.ok(faceOf(TAMIL).includes('noto-sans-tamil-full-'), 'the full font is served');
  assert.deepEqual(lines.filter((l) => l.startsWith('[fonts]')), [`[fonts] ${TAMIL}: subset rebuild failed, serving the full font: harfbuzz said no`]);
  const dash = await call('GET', '/admin/dashboard');
  assert.equal(dash.json.data.fonts.find((f) => f.family === TAMIL).status, 'full');
  // the next try (here: a refresh; on the server the next text change or the 10-minute retry) succeeds
  fontManager.setSubsetter(null);
  await fontManager.refresh();
  await fontManager.whenIdle();
  assert.equal(fontManager.familyStatus(TAMIL).status, 'ready');
  assert.ok(inRange(faceOf(TAMIL), cp));
});

test('a new language with the Telugu script, 3 texts, switched on -> Noto Sans Telugu within seconds; deleted -> gone', async () => {
  const add = await call('POST', '/admin/languages', {
    lang_code: 'zte', name_en: 'Telugu (test)', native_name: 'తెలుగు', switch_label: 'తెలుగు', html_lang: 'te-IN', script: 'Telugu', sort_order: 98,
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.deepEqual([add.json.data.font_family, add.json.data.dir], [TELUGU, 'ltr']);
  await setText('eyebrow', 'zte', 'టిష్యూ & పరిశుభ్రత కాగితం');
  await setText('lede', 'zte', 'ఇళ్లు, హోటళ్లు, రెస్టారెంట్లకు నాప్కిన్లు, రోల్స్, టవల్స్.');
  await setText('touch', 'zte', 'తాకండి, లేదా ఎక్కడైనా పట్టుకుని ఎత్తండి');
  const t0 = Date.now();
  assert.equal((await call('PUT', '/admin/languages/zte', { is_active: 1 })).status, 200);
  await fontManager.whenIdle();
  const secs = (Date.now() - t0) / 1000;
  console.log(`  Telugu ready ${secs.toFixed(1)} s after switching the language on`);
  assert.equal(fontManager.familyStatus(TELUGU).status, 'ready');
  assert.ok(secs < 10, `within seconds (${secs} s)`);
  const rule = faceOf(TELUGU);
  assert.match(rule, /noto-sans-telugu-[0-9a-f]{10}\.woff2/);
  assert.ok(inRange(rule, 'ట'.codePointAt(0)));
  const row = (await call('GET', '/admin/languages')).json.data.find((l) => l.lang_code === 'zte');
  assert.deepEqual([row.script, row.font.status], ['Telugu', 'ready']);
  assert.equal((await call('POST', '/admin/languages', { lang_code: 'zzq', name_en: 'x', native_name: 'x', switch_label: 'x', html_lang: 'xx', script: 'Klingon' })).status, 400);

  assert.equal((await call('PUT', '/admin/languages/zte', { is_active: 0 })).status, 200);
  const del = await call('DELETE', '/admin/languages/zte');
  assert.equal(del.status, 200, JSON.stringify(del.json));
  saved.splice(0, saved.length, ...saved.filter((s) => s.lang !== 'zte')); // its texts went with it
  await fontManager.whenIdle();
  assert.equal(faceOf(TELUGU), '', 'no Telugu face once no language uses it');
});
