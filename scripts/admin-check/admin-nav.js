// Admin navigation check for the grouped sidebar (Dashboard, Sales, Catalogue, Website content, Setup, divider,
// User Interface). Exit code 1 on any failure.
// 1. Expanded (admin, 1366 wide): every admin screen to every other screen (16 x 15 = 240 moves, one Euler circuit so
//    every ordered pair occurs once), each through its group: a closed group is opened by its header first (groups
//    are closed again along the way, so this happens often). After each move: the screen's heading, no "could not
//    load" panel, loading finished, list screens show their own first row (compared with the API), the item is the
//    only active one, its group is open and marked current, zero console errors. Then Back / Forward.
// 2. Group headers: aria-expanded / aria-controls, Enter and Space toggle them, the state survives a reload.
// 3. Desktop: no menu toggle in the header; the one pinned under the sidebar list collapses / expands ("Collapse menu"
//    / "Expand menu", aria-expanded). Collapsed to icons: every screen through its icon (tooltip), survives a reload.
// 4. 390 wide: the drawer (burger, groups, a link closes it, the backdrop and Esc close it), every screen through it.
// 5. Roles: viewer and editor see exactly the items their role may open (Setup: Languages only), admin all 16.
// 6. Leads badge = the API's count of New leads. User Interface -> /en in a new tab, never active.
// 7. Error boundary: one list answered (in the browser only) with a broken row shows "This screen could not load"
//    inside the page, logs the error, and the sidebar keeps working.
// Temporary admin users ZZU-NAV (admin), ZZU-NAV-E (editor), ZZU-NAV-V (viewer) get session cookies signed with
// JWT_SECRET (no dAdmin row needed); they and their audit rows are removed at the end. Read-only otherwise.
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
const USERS = { admin: 'ZZU-NAV', editor: 'ZZU-NAV-E', viewer: 'ZZU-NAV-V' };
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

// path, heading, group ('' = no group), lowest role, API list to compare the first row with ([endpoint, keys]) or null.
// Order = the sidebar order.
const SCREENS = [
  ['', 'Dashboard', '', 'viewer', null],
  ['leads', 'Leads', 'sales', 'viewer', null],
  ['products', 'Products', 'catalogue', 'viewer', null],
  ['categories', 'Categories', 'catalogue', 'viewer', ['/categories', ['category_key']]],
  ['kits', 'Business kits', 'catalogue', 'viewer', ['/kits', ['kit_key']]],
  ['size-picker', 'Size picker (Try it)', 'catalogue', 'viewer', ['/size-picker', ['position']]],
  ['import-export', 'Excel import / export', 'catalogue', 'editor', null],
  ['banners', 'Banners', 'content', 'viewer', ['/banners', ['banner_key']]],
  ['translations', 'Translations', 'content', 'viewer', null],
  ['towns', 'Towns', 'content', 'viewer', ['/towns', ['town_key']]],
  ['form-options', 'Form options', 'content', 'viewer', ['/form-options', ['list_key', 'option_value']]],
  ['brochures', 'Brochures', 'content', 'viewer', null],
  ['languages', 'Languages', 'setup', 'viewer', null],
  ['settings', 'Settings', 'setup', 'admin', null],
  ['users', 'Admin users', 'setup', 'admin', null],
  ['audit', 'Audit log', 'setup', 'admin', null],
];
const RANK = { viewer: 1, editor: 2, admin: 3 };
const href = (path) => `/admin/${path}`;
const linkSel = (path) => `.a-nav a[href="${href(path)}"]`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Euler circuit of the complete directed graph on the screens (Hierholzer): n*(n-1) moves, each ordered pair once.
function circuit(n) {
  const next = Array.from({ length: n }, (_, v) => Array.from({ length: n }, (__, w) => w).filter((w) => w !== v));
  const stack = [0];
  const out = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    if (next[v].length) stack.push(next[v].shift());
    else out.push(stack.pop());
  }
  return out.reverse();
}

async function main() {
  for (const [role, emp] of Object.entries(USERS)) {
    await db.query('DELETE FROM admin_users WHERE emp_id = ?', [emp]);
    await db.query("INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, ?, 1, 'admin-nav check')", [emp, role]);
  }
  const token = (emp) => jwt.sign({ sub: emp, app: APP, stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  let failures = 0;
  const fail = (msg) => { failures += 1; console.log(`FAIL ${msg}`); };
  const errors = [];

  async function newPage(role, width = 1366, height = 860) {
    const ctx = await browser.createBrowserContext(); // own localStorage per role
    const page = await ctx.newPage();
    await page.setViewport({ width, height });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.setCookie({ name: COOKIE, value: token(USERS[role]), domain: new URL(WEB).hostname, path: '/api/dfresh/admin', httpOnly: true, sameSite: 'Strict' });
    // the first load may meet an API that has just (re)started (dev: nodemon), so allow it a minute
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.a-nav', { timeout: 30000 });
    return page;
  }

  const isVisible = (page, sel) => page.$eval(sel, (el) => el.offsetParent !== null).catch(() => false);
  // Reach a screen through the sidebar: open its group first when it is closed (a real click on the header).
  async function go(page, path) {
    const s = SCREENS.find((x) => x[0] === path);
    if (s[2] && !(await isVisible(page, linkSel(path)))) {
      const h = `.a-nav .a-grp-h[aria-controls="a-grp-${s[2]}"]`;
      await page.click(h);
      const opened = await page.$eval(h, (b) => b.getAttribute('aria-expanded')).catch(() => null);
      if (opened !== 'true') fail(`group ${s[2]} did not open (aria-expanded=${opened})`);
    }
    await page.click(linkSel(path));
  }

  const apiCall = (page, path) => page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return (await r.json()).data;
  }, `${page.url().includes(':3000') ? 'http://localhost:4012' : ''}/api/dfresh/admin${path}`);

  async function check(page, i, label, firstRow = {}) {
    const [path, heading, group] = SCREENS[i];
    const ok = await page.waitForFunction((h) => {
      const h1 = document.querySelector('.a-main h1');
      const loading = [...document.querySelectorAll('.a-main p')].some((p) => p.textContent === 'Loading...');
      return h1 && h1.textContent === h && !loading;
    }, { timeout: 30000 }, heading).then(() => true, () => false); // big screens (Translations) on a busy dev machine
    const state = await page.evaluate((g) => ({
      h1: (document.querySelector('.a-main h1') || {}).textContent || null,
      broken: !!document.querySelector('.a-main .a-crash'),
      url: window.location.pathname,
      first: [...document.querySelectorAll('.a-main table.a-table tbody tr:first-child td')].map((td) => td.textContent.trim()),
      active: [...document.querySelectorAll('.a-nav a.active')].map((a) => a.getAttribute('href')),
      current: [...document.querySelectorAll('.a-nav a[aria-current="page"]')].map((a) => a.getAttribute('href')),
      groupOpen: g ? (document.querySelector(`#a-grp-${g}`) || {}).hidden === false : true,
      groupCurrent: g ? !!document.querySelector(`.a-grp.current .a-grp-h[aria-controls="a-grp-${g}"]`) || document.querySelector('.a-nav.collapsed') !== null : true,
      extActive: [...document.querySelectorAll('.a-nav a[target]')].some((a) => a.classList.contains('active') || a.hasAttribute('aria-current')),
    }), group);
    if (!ok) fail(`${label}: ${href(path)} did not show "${heading}" (shows "${state.h1}")`);
    if (state.broken) fail(`${label}: ${href(path)} shows the "could not load" panel`);
    if (state.url.replace(/\/$/, '') !== `/admin${path ? `/${path}` : ''}`) fail(`${label}: url ${state.url}`);
    if (JSON.stringify(state.active) !== JSON.stringify([href(path)]) || JSON.stringify(state.current) !== JSON.stringify([href(path)])) {
      fail(`${label}: active items ${JSON.stringify(state.active)} / aria-current ${JSON.stringify(state.current)}`);
    }
    if (!state.groupOpen) fail(`${label}: group ${group} of the current page is not open`);
    if (!state.groupCurrent) fail(`${label}: group ${group} is not marked current`);
    if (state.extActive) fail(`${label}: the User Interface link is marked active`);
    if (firstRow[path] && !firstRow[path].every((v) => state.first.includes(v))) {
      fail(`${label}: ${href(path)} first row [${state.first.slice(0, 4).join(' | ')}] is not its own (expected ${firstRow[path].join(' + ')})`);
    }
    if (errors.length) { fail(`${label}: ${errors.join(' || ').slice(0, 300)}`); errors.length = 0; }
  }

  try {
    // ---- 1. admin, expanded -------------------------------------------------------------------
    const page = await newPage('admin');
    const firstRow = {};
    for (const [path, , , , api] of SCREENS) {
      if (!api) continue;
      const rows = await apiCall(page, api[0]);
      firstRow[path] = rows && rows.length ? api[1].map((k) => String(rows[0][k])) : null;
    }
    const sidebar = await page.evaluate(() => ({
      screens: [...document.querySelectorAll('.a-nav a')].filter((a) => !a.target).map((a) => a.getAttribute('href')),
      groups: [...document.querySelectorAll('.a-nav .a-grp-h')].map((b) => b.textContent.trim()),
      ext: [...document.querySelectorAll('.a-nav a[target]')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })),
    }));
    if (JSON.stringify(sidebar.screens) !== JSON.stringify(SCREENS.map(([p]) => href(p)))) fail(`admin sidebar screens ${sidebar.screens.join(' ')}`);
    if (JSON.stringify(sidebar.groups.map((g) => g.replace(/\d+\s*new$/, '').trim())) !== JSON.stringify(['Sales', 'Catalogue', 'Website content', 'Setup'])) fail(`groups ${sidebar.groups.join(' | ')}`);
    const ui = sidebar.ext.find((x) => x.href === '/en');
    if (!ui || ui.target !== '_blank' || ui.rel !== 'noopener noreferrer' || ui.label !== 'User Interface - opens the website in a new tab') fail(`User Interface link: ${JSON.stringify(sidebar.ext)}`);
    else console.log('admin sidebar: Dashboard + 4 groups (16 screens) + User Interface -> /en (new tab, noopener noreferrer)');

    // Leads badge = API count of New leads
    const counts = await apiCall(page, '/nav-counts');
    const badge = await page.$eval(linkSel('leads'), (a) => { const b = a.querySelector('.a-badge'); return b ? Number(b.firstChild.textContent) : 0; });
    if (badge !== counts.newLeads) fail(`Leads badge ${badge}, API says ${counts.newLeads} new`);
    else console.log(`leads badge: ${badge} (API: ${counts.newLeads} new leads)`);

    const order = circuit(SCREENS.length);
    await page.click(linkSel(''));
    await check(page, order[0], 'start', firstRow);
    let reopened = 0;
    for (let m = 1; m < order.length; m += 1) {
      if (m % 5 === 0) {
        // close every open group except the current page's, so the next moves must open them again
        const closed = await page.evaluate(() => {
          let n = 0;
          document.querySelectorAll('.a-grp:not(.current) .a-grp-h[aria-expanded="true"]').forEach((b) => { b.click(); n += 1; });
          return n;
        });
        reopened += closed;
      }
      const to = SCREENS[order[m]][0];
      await go(page, to);
      await check(page, order[m], `move ${m} ${SCREENS[order[m - 1]][0] || 'dashboard'} -> ${to || 'dashboard'}`, firstRow);
    }
    console.log(`expanded: ${order.length - 1} moves (every ordered pair once), groups closed ${reopened} times along the way and reopened by their headers`);
    const tail = order.slice(-16);
    for (let k = tail.length - 2; k >= 0; k -= 1) { await page.goBack(); await check(page, tail[k], `back to ${SCREENS[tail[k]][0] || 'dashboard'}`, firstRow); }
    for (let k = 1; k < tail.length; k += 1) { await page.goForward(); await check(page, tail[k], `forward to ${SCREENS[tail[k]][0] || 'dashboard'}`, firstRow); }
    console.log(`back / forward: ${tail.length - 1} + ${tail.length - 1}`);

    // ---- 2. group headers: keyboard + remembered -----------------------------------------------
    await page.click(linkSel(''));
    await check(page, 0, 'dashboard for the keyboard check');
    const hdr = '.a-nav .a-grp-h[aria-controls="a-grp-content"]';
    const exp = () => page.$eval(hdr, (b) => b.getAttribute('aria-expanded'));
    const start = await exp();
    await page.focus(hdr);
    await page.keyboard.press('Enter');
    const afterEnter = await exp();
    await page.keyboard.press('Space');
    const afterSpace = await exp();
    if (afterEnter === start || afterSpace !== start) fail(`keyboard toggle: ${start} -> Enter ${afterEnter} -> Space ${afterSpace}`);
    await page.keyboard.press('Enter'); // leave it the opposite of start, then reload
    const before = await exp();
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector(hdr);
    if ((await exp()) !== before) fail(`group state not remembered after reload (${before} -> ${await exp()})`);
    else console.log(`group header: Enter / Space toggle aria-expanded (${start} -> ${afterEnter} -> ${afterSpace}), state remembered after reload`);

    // ---- 3. collapsed to icons (desktop: no header toggle; the pinned one collapses and expands, labelled) -------
    const toggles = () => page.evaluate(() => {
      const b = document.querySelector('.a-nav .a-collapse');
      return { header: !!document.querySelector('.a-top .a-burger'), pinned: `${b.getAttribute('aria-label')}|${b.getAttribute('aria-expanded')}` };
    });
    const t0 = await toggles();
    await page.click('.a-nav .a-collapse');
    await page.waitForSelector('.a-nav.collapsed');
    const t1 = await toggles();
    if (t0.header || t1.header) fail('desktop: the header has a menu toggle (it belongs under 900px only)');
    if (t0.pinned !== 'Collapse menu|true' || t1.pinned !== 'Expand menu|false') fail(`pinned toggle: ${t0.pinned} -> ${t1.pinned}`);
    else console.log(`pinned toggle: "${t0.pinned}" -> click -> "${t1.pinned}"; no header toggle on desktop`);
    const tips = await page.$$eval('.a-nav.collapsed a', (as) => as.map((a) => [a.getAttribute('href'), a.title, a.offsetParent !== null]));
    const noTip = tips.filter(([, t, v]) => !t || !v);
    if (noTip.length) fail(`collapsed: items without tooltip or hidden: ${JSON.stringify(noTip)}`);
    for (let i = 1; i < SCREENS.length; i += 1) {
      await page.click(linkSel(SCREENS[i][0]));
      await check(page, i, `collapsed -> ${SCREENS[i][0]}`, firstRow);
    }
    await page.reload({ waitUntil: 'networkidle0' });
    const stillCollapsed = await page.$('.a-nav.collapsed').then(Boolean);
    if (!stillCollapsed) fail('collapsed state not remembered after reload');
    await page.click('.a-nav .a-collapse'); // the pinned toggle expands again
    await page.waitForFunction(() => !document.querySelector('.a-nav.collapsed'));
    console.log(`collapsed: ${tips.length} icons with tooltips, ${SCREENS.length - 1} screens reached, remembered after reload, expanded again`);

    // ---- 4. 390 wide: the drawer ------------------------------------------------------------------
    const phone = await newPage('admin', 390, 844);
    const drawerOpen = () => phone.$eval('#a-nav', (n) => n.classList.contains('open') && getComputedStyle(n).visibility === 'visible');
    for (let i = 1; i < SCREENS.length; i += 1) {
      await phone.click('.a-burger');
      await phone.waitForFunction(() => document.querySelector('#a-nav').classList.contains('open'));
      await wait(260);
      await go(phone, SCREENS[i][0]);
      await check(phone, i, `drawer -> ${SCREENS[i][0]}`, firstRow);
      await wait(260);
      if (await drawerOpen()) fail(`drawer -> ${SCREENS[i][0]}: still open after the link`);
    }
    await phone.click('.a-burger');
    await wait(260);
    await phone.click('.a-nav-backdrop', { offset: { x: 370, y: 400 } }).catch(() => phone.mouse.click(375, 400));
    await wait(260);
    const afterBackdrop = await drawerOpen();
    await phone.click('.a-burger');
    await wait(260);
    await phone.keyboard.press('Escape');
    await wait(260);
    const afterEsc = await drawerOpen();
    const focusBurger = await phone.evaluate(() => document.activeElement && document.activeElement.classList.contains('a-burger'));
    if (afterBackdrop || afterEsc || !focusBurger) fail(`drawer close: backdrop ${!afterBackdrop}, Esc ${!afterEsc}, focus back on Menu ${focusBurger}`);
    else console.log(`390 drawer: ${SCREENS.length - 1} screens through the groups, closes on a link, the backdrop and Esc (focus back on Menu)`);
    if (errors.length) { fail(`drawer: ${errors.join(' || ').slice(0, 300)}`); errors.length = 0; }

    // ---- 5. roles ------------------------------------------------------------------------------------
    for (const role of ['viewer', 'editor']) {
      const p = await newPage(role);
      const shown = await p.$$eval('.a-nav a', (as) => as.filter((a) => !a.target).map((a) => a.getAttribute('href')));
      const want = SCREENS.filter((s) => RANK[role] >= RANK[s[3]]).map(([path]) => href(path));
      const setup = await p.$$eval('#a-grp-setup a', (as) => as.map((a) => a.textContent.trim()));
      if (JSON.stringify(shown) !== JSON.stringify(want)) fail(`${role}: sidebar ${shown.join(' ')} (expected ${want.join(' ')})`);
      else if (JSON.stringify(setup) !== JSON.stringify(['Languages'])) fail(`${role}: Setup shows ${setup.join(', ')}`);
      else console.log(`${role}: ${shown.length} items, Setup = Languages only${role === 'editor' ? ', Excel import / export shown' : ', no Excel import / export'}`);
      for (const path of want.map((h) => h.replace('/admin/', ''))) {
        await go(p, path);
        await check(p, SCREENS.findIndex((s) => s[0] === path), `${role} -> ${path || 'dashboard'}`);
      }
      await p.browserContext().close();
    }

    // ---- 7. error boundary ----------------------------------------------------------------------------
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (/\/api\/dfresh\/admin\/kits$/.test(r.url())) r.respond({ // same CORS headers as the API (dev: the page on :3000 calls the API on :4012)
        status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [null] }),
        headers: { 'Access-Control-Allow-Origin': new URL(WEB).origin, 'Access-Control-Allow-Credentials': 'true' },
      });
      else r.continue();
    });
    await go(page, 'kits');
    const panel = await page.waitForSelector('.a-main .a-crash', { timeout: 10000 }).then(() => true, () => false);
    const logged = errors.some((e) => /screen could not load/.test(e));
    errors.length = 0;
    await go(page, 'towns');
    await check(page, SCREENS.findIndex((x) => x[0] === 'towns'), 'after a crashed screen, sidebar to towns', firstRow);
    if (!panel) fail('boundary: a crashing screen did not show the "could not load" panel');
    if (!logged) fail('boundary: the error was not logged to the console');
    else console.log('boundary: crashing screen showed the panel, error logged, sidebar still works');

    console.log(`${failures ? 'FAILED' : 'PASS'}: ${failures} failure(s)`);
  } finally {
    await browser.close();
    const emps = Object.values(USERS);
    await db.query(`DELETE FROM audit_log WHERE emp_id IN (${emps.map(() => '?').join(', ')})`, emps);
    await db.query(`DELETE FROM admin_users WHERE emp_id IN (${emps.map(() => '?').join(', ')})`, emps);
    await db.end();
  }
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error('admin-nav check could not run:', err.message);
  process.exit(1);
});
