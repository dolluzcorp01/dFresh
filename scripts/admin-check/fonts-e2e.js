// Script fonts, end to end in a real browser against a running server (no font command is run):
// 1. Tamil: a text is saved through the admin with a character the current Tamil subset does not have; the
//    /ta page is reloaded until that text renders ONLY with "Noto Sans Tamil" (Chrome's own report of the
//    fonts used, CSS.getPlatformFontsForNode; a missing glyph would show a system font there). Restored after.
// 2. Telugu: a test language "zte" with the Telugu script gets 3 texts and is switched on; /zte is reloaded
//    until those texts render with "Noto Sans Telugu". Then switched off and deleted.
// Prints the seconds each took. Exit code 1 on failure. Temporary admin ZZU-FONTE, removed afterwards.
// Setup like admin-nav.js:  NODE_PATH=<scratch>/node_modules WEB_URL=http://localhost:4013 npm run test:fonts-e2e
// WEB_URL must be a server started with server.js (SERVE_BUILD=true, or production) on the LOCAL dev database.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run against NODE_ENV=production');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const fontverter = require('fontverter');
const { getDBConnection } = require('../../config/db');

const WEB = process.env.WEB_URL || 'http://localhost:4013';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ADMIN = 'ZZU-FONTE';
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };

async function api(method, p, body) {
  const token = jwt.sign({ sub: ADMIN, app: APP, stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const res = await fetch(`${WEB}/api/dfresh${p}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `${COOKIE}=${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function sourceCmap(family) {
  const { Blob: HbBlob, Face } = await import('harfbuzzjs');
  const file = path.join(__dirname, '..', '..', 'fonts', 'source', `${family.toLowerCase().replace(/ /g, '-')}.woff2`);
  return new Set(new Face(new HbBlob(await fontverter.convert(fs.readFileSync(file), 'truetype')), 0).collectUnicodes());
}

const covered = (css, family) => {
  const rule = css.split('\n').find((l) => l.includes(`font-family:'${family}'`)) || '';
  const set = new Set();
  for (const r of (((/unicode-range:([^}]+)/.exec(rule)) || [])[1] || '').split(',')) {
    const [a, b] = r.trim().replace('U+', '').split('-').map((h) => parseInt(h, 16));
    if (Number.isFinite(a)) for (let c = a; c <= (b ?? a); c += 1) set.add(c);
  }
  return { rule, set };
};

// Reload page until the node's text renders only with `family`; returns seconds or null after `limit` s.
async function renderedWith(page, url, selector, family, limit) {
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const t0 = Date.now();
  let last = [];
  while ((Date.now() - t0) / 1000 < limit) {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (nodeId) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      last = fonts.map((f) => `${f.familyName} x${f.glyphCount}`);
      if (fonts.length && fonts.every((f) => f.familyName === family)) return { secs: (Date.now() - t0) / 1000, fonts: last };
    }
    await sleep(400);
  }
  return { secs: null, fonts: last };
}

async function main() {
  await db.query('DELETE FROM admin_users WHERE emp_id = ?', [ADMIN]);
  await db.query("INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, 'admin', 1, 'fonts e2e')", [ADMIN]);
  await db.query("DELETE FROM languages WHERE lang_code = 'zte'");
  const [[orig]] = await db.query("SELECT value FROM ui_text WHERE text_key = 'eyebrow' AND lang_code = 'ta'");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 860 });

    // 1. Tamil: a character the subset does not have yet
    const css0 = await (await fetch(`${WEB}/api/dfresh/fonts.css`)).text();
    const have = covered(css0, 'Noto Sans Tamil').set;
    const font = await sourceCmap('Noto Sans Tamil');
    let cp = null;
    for (let c = 0x0b80; c <= 0x0bff && cp === null; c += 1) if (font.has(c) && !have.has(c)) cp = c;
    check('found a Tamil character missing from the subset', cp !== null, cp !== null ? `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}` : 'subset already has every Tamil character');
    if (cp !== null) {
      const t0 = Date.now();
      const r = await api('PUT', '/admin/ui-text/eyebrow/ta', { value: `${String.fromCodePoint(cp)} ${orig.value}` });
      check('saved through the admin', r.status === 200, String(r.status));
      const res = await renderedWith(page, `${WEB}/ta`, '.hero .k', 'Noto Sans Tamil', 30);
      check('the new character renders in Noto Sans Tamil, no command run', res.secs !== null, `${res.fonts.join(', ')}; ${((Date.now() - t0) / 1000).toFixed(1)} s after saving`);
      await page.screenshot({ path: path.join(process.env.SHOTS || '.', 'fonts-e2e-ta.png'), clip: { x: 0, y: 80, width: 900, height: 420 } }).catch(() => {});
    }

    // 2. Telugu test language
    const add = await api('POST', '/admin/languages', { lang_code: 'zte', name_en: 'Telugu (test)', native_name: 'తెలుగు', switch_label: 'తెలుగు', html_lang: 'te-IN', script: 'Telugu', sort_order: 98 });
    check('test language zte added with the Telugu script', add.status === 201, add.json && add.json.data ? `${add.json.data.font_family}, ${add.json.data.dir}` : JSON.stringify(add.json));
    for (const [key, value] of [['eyebrow', 'టిష్యూ & పరిశుభ్రత కాగితం · కాంచీపురం'], ['lede', 'ఇళ్లు, హోటళ్లు, రెస్టారెంట్లు, కార్యాలయాలు, ఆసుపత్రులకు నాప్కిన్లు, రోల్స్, టవల్స్.'], ['touch', 'తాకండి, లేదా ఎక్కడైనా పట్టుకుని ఎత్తండి']]) {
      await api('PUT', `/admin/ui-text/${key}/zte`, { value });
    }
    const t1 = Date.now();
    const on = await api('PUT', '/admin/languages/zte', { is_active: 1 });
    check('switched on', on.status === 200, String(on.status));
    const te = await renderedWith(page, `${WEB}/zte`, '.hero .lede', 'Noto Sans Telugu', 30);
    check('the Telugu page renders in Noto Sans Telugu within seconds', te.secs !== null && te.secs < 15, `${te.fonts.join(', ')}; ${((Date.now() - t1) / 1000).toFixed(1)} s after switching on`);
    await page.screenshot({ path: path.join(process.env.SHOTS || '.', 'fonts-e2e-te.png'), clip: { x: 0, y: 80, width: 900, height: 420 } }).catch(() => {});
    const lang = (await api('GET', '/admin/languages')).json.data.find((l) => l.lang_code === 'zte');
    check('admin Languages shows its font status', lang && lang.font && lang.font.status === 'ready', lang && lang.font ? `${lang.script}: ${lang.font.status}, ${Math.round(lang.font.subsetSize / 1024)} KB, ${lang.font.characters} characters` : 'no font status');
  } finally {
    await browser.close();
    await api('PUT', '/admin/languages/zte', { is_active: 0 }).catch(() => {});
    const del = await api('DELETE', '/admin/languages/zte').catch(() => ({ status: 0 }));
    console.log(`cleanup: test language zte deleted (${del.status}); Tamil eyebrow restored`);
    await api('PUT', '/admin/ui-text/eyebrow/ta', { value: orig.value });
    await db.query('DELETE FROM audit_log WHERE emp_id = ?', [ADMIN]);
    await db.query('DELETE FROM admin_users WHERE emp_id = ?', [ADMIN]);
    await db.end();
  }
  console.log(failures ? `FAILED: ${failures} check(s)` : 'PASS: fonts end to end');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('fonts e2e could not run:', err.message);
  process.exit(1);
});
