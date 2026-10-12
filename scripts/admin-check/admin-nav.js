// Admin navigation check: every admin screen to every other admin screen (16 x 15 = 240 moves, one sidebar click
// each, in one Euler circuit so every ordered pair occurs exactly once), then browser Back through the history
// and Forward again. After each move: the screen's own heading, no "could not load" panel, loading finished,
// on the list screens the first row is that screen's own data (compared with the API), and zero console errors.
// External links in the sidebar (User Interface -> the public site) are not screens: they are skipped, and only
// checked to point to /en in a new tab and never be marked active.
// Finally the error boundary: one list answered (in the browser only) with a broken row must show "This screen
// could not load" inside the page, log the error, and leave the sidebar working.
// Exit code 1 on any failure.
// A temporary admin user ZZU-NAV (role admin) gets a session cookie signed with JWT_SECRET (no dAdmin row
// needed); it and its audit rows are removed at the end. Read-only otherwise.
// Setup like scripts/visual-check (puppeteer-core is NOT a project dependency; Chrome must be installed):
//   npm i --prefix <scratch> puppeteer-core@24
//   NODE_PATH=<scratch>/node_modules WEB_URL=http://localhost:3000 npm run test:admin-nav
// WEB_URL = the React dev server (API on 4012) or a production build served by server.js (SERVE_BUILD=true).
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run against NODE_ENV=production');
  process.exit(1);
}

const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../../config/db');

const WEB = process.env.WEB_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EMP = 'ZZU-NAV';
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

// path, heading, API list to compare the first row with ([endpoint, key fields]) or null
const SCREENS = [
  ['', 'Dashboard', null], ['leads', 'Leads', null], ['products', 'Products', null],
  ['import-export', 'Excel import / export', null], ['translations', 'Translations', null],
  ['banners', 'Banners', ['/banners', ['banner_key']]], ['kits', 'Business kits', ['/kits', ['kit_key']]],
  ['towns', 'Towns', ['/towns', ['town_key']]], ['categories', 'Categories', ['/categories', ['category_key']]],
  ['size-picker', 'Size picker (Try it)', ['/size-picker', ['position']]],
  ['form-options', 'Form options', ['/form-options', ['list_key', 'option_value']]],
  ['languages', 'Languages', null], ['brochures', 'Brochures', null],
  ['settings', 'Settings', null], ['users', 'Admin users', null], ['audit', 'Audit log', null],
];

// Euler circuit of the complete directed graph on the screens (Hierholzer): 240 moves, each ordered pair once.
function circuit(n) {
  const next = Array.from({ length: n }, (_, v) => Array.from({ length: n }, (__, w) => w).filter((w) => w !== v));
  const stack = [0];
  const out = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    if (next[v].length) stack.push(next[v].shift());
    else out.push(stack.pop());
  }
  return out.reverse(); // n*(n-1) + 1 vertices
}

async function main() {
  await db.query('DELETE FROM admin_users WHERE emp_id = ?', [EMP]);
  await db.query("INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, 'admin', 1, 'admin-nav check')", [EMP]);
  const token = jwt.sign({ sub: EMP, app: APP, stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  let failures = 0;
  const fail = (msg) => { failures += 1; console.log(`FAIL ${msg}`); };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 860 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.setCookie({ name: COOKIE, value: token, domain: new URL(WEB).hostname, path: '/api/dfresh/admin', httpOnly: true, sameSite: 'Strict' });

    // The API's first row per list screen (what that screen must show first).
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle0' });
    const apiBase = await page.evaluate(() => (window.location.port === '3000' ? 'http://localhost:4012' : ''));
    const firstRow = {};
    for (const [path, , api] of SCREENS) {
      if (!api) continue;
      const rows = await page.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        return (await r.json()).data;
      }, `${apiBase}/api/dfresh/admin${api[0]}`);
      firstRow[path] = rows && rows.length ? api[1].map((k) => String(rows[0][k])) : null;
    }

    // The sidebar: the 16 screens, plus the User Interface link to the public site (not a screen, never active).
    const sidebar = await page.evaluate(() => ({
      screens: [...document.querySelectorAll('.a-nav a')].filter((a) => !a.target).map((a) => a.getAttribute('href')),
      ext: [...document.querySelectorAll('.a-nav a[target]')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })),
    }));
    const wantScreens = SCREENS.map(([p]) => `/admin/${p}`);
    if (JSON.stringify(sidebar.screens) !== JSON.stringify(wantScreens)) fail(`sidebar screens ${sidebar.screens.join(' ')}`);
    const ui = sidebar.ext.find((x) => x.href === '/en');
    if (!ui || ui.target !== '_blank' || ui.rel !== 'noopener noreferrer' || ui.label !== 'User Interface - opens the website in a new tab') {
      fail(`User Interface link: ${JSON.stringify(sidebar.ext)}`);
    } else console.log('sidebar: 16 screens + User Interface -> /en (new tab, noopener noreferrer)');
    const extActive = async (label) => {
      const bad = await page.evaluate(() => [...document.querySelectorAll('.a-nav a[target]')].some((a) => a.classList.contains('active') || a.hasAttribute('aria-current')));
      if (bad) fail(`${label}: the User Interface link is marked active`);
    };

    const check = async (i, label) => {
      const [path, heading] = SCREENS[i];
      const ok = await page.waitForFunction((h) => {
        const h1 = document.querySelector('.a-main h1');
        const loading = [...document.querySelectorAll('.a-main p')].some((p) => p.textContent === 'Loading...');
        return h1 && h1.textContent === h && !loading;
      }, { timeout: 10000 }, heading).then(() => true, () => false);
      const state = await page.evaluate(() => ({
        h1: (document.querySelector('.a-main h1') || {}).textContent || null,
        broken: !!document.querySelector('.a-main .a-crash'),
        url: window.location.pathname,
        first: [...document.querySelectorAll('.a-main table.a-table tbody tr:first-child td')].map((td) => td.textContent.trim()),
      }));
      if (!ok) fail(`${label}: /admin/${path} did not show "${heading}" (shows "${state.h1}")`);
      if (state.broken) fail(`${label}: /admin/${path} shows the "could not load" panel`);
      if (state.url.replace(/\/$/, '') !== `/admin${path ? `/${path}` : ''}`) fail(`${label}: url ${state.url}`);
      if (firstRow[path]) {
        const want = firstRow[path];
        const has = want.every((v) => state.first.includes(v));
        if (!has) fail(`${label}: /admin/${path} first row [${state.first.slice(0, 4).join(' | ')}] is not its own (expected ${want.join(' + ')})`);
      }
      if (errors.length) { fail(`${label}: console: ${errors.join(' || ').slice(0, 300)}`); errors.length = 0; }
      await extActive(label);
    };

    const order = circuit(SCREENS.length);
    await page.click('.a-nav a[href="/admin/"]').catch(() => page.goto(`${WEB}/admin`, { waitUntil: 'networkidle0' }));
    await check(order[0], 'start');
    for (let m = 1; m < order.length; m += 1) {
      const to = SCREENS[order[m]][0];
      await page.click(`.a-nav a[href="/admin/${to}"]`);
      await check(order[m], `move ${m} ${SCREENS[order[m - 1]][0] || 'dashboard'} -> ${to || 'dashboard'}`);
    }
    const moves = order.length - 1;
    // Browser Back through the last 15 screens, then Forward again.
    const tail = order.slice(-16);
    for (let k = tail.length - 2; k >= 0; k -= 1) {
      await page.goBack();
      await check(tail[k], `back to ${SCREENS[tail[k]][0] || 'dashboard'}`);
    }
    for (let k = 1; k < tail.length; k += 1) {
      await page.goForward();
      await check(tail[k], `forward to ${SCREENS[tail[k]][0] || 'dashboard'}`);
    }
    // Error boundary: a broken kits row (in this browser only) -> the panel, an error in the console, sidebar alive.
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (/\/api\/dfresh\/admin\/kits$/.test(r.url())) {
        r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [null] }) });
      } else r.continue();
    });
    await page.click('.a-nav a[href="/admin/kits"]');
    const panel = await page.waitForSelector('.a-main .a-crash', { timeout: 10000 }).then(() => true, () => false);
    const logged = errors.some((e) => /screen could not load/.test(e));
    errors.length = 0;
    await page.click('.a-nav a[href="/admin/towns"]');
    await check(SCREENS.findIndex((x) => x[0] === 'towns'), 'after a crashed screen, sidebar to towns');
    if (!panel) fail('boundary: a crashing screen did not show the "could not load" panel');
    if (!logged) fail('boundary: the error was not logged to the console');
    else console.log('boundary: crashing screen showed the panel, error logged, sidebar still works');
    console.log(`${failures ? 'FAILED' : 'PASS'}: ${moves} moves between ${SCREENS.length} screens (every ordered pair once) + ${tail.length - 1} Back + ${tail.length - 1} Forward; ${failures} failure(s)`);
  } finally {
    await browser.close();
    await db.query('DELETE FROM audit_log WHERE emp_id = ?', [EMP]);
    await db.query('DELETE FROM admin_users WHERE emp_id = ?', [EMP]);
    await db.end();
  }
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error('admin-nav check could not run:', err.message);
  process.exit(1);
});
