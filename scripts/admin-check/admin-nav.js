// Admin navigation check for the Stage 2 left menu (src/admin/menu.js, docs/STAGE2-MENU-GUIDE.txt) with Commerce
// switched OFF, the state the live site starts in: the check switches commerce_enabled off and puts it back at the end.
// The menu then lists only the live site's screens (the entries of menu.js with a non-commerce target: 22 for Admin).
// Exit code 1 on any failure. (Commerce ON, all 148 entries, the Sales / Warehouse roles: menu-check.js.)
// 1. Expanded (Admin, 1366 wide): every live entry to every other one (n x (n - 1) moves, one Euler circuit so every
//    ordered pair occurs once), each through the menu: a closed group or sub-group is opened by its header first
//    (they are closed again along the way, so this happens often). After each move: the address, the page title (the
//    menu entry's name, or the screen's own: Settings, Commerce settings), no "could not load" panel, loading
//    finished, list screens show their own first row (compared with the API), the entry is the only highlighted one,
//    its group and sub-group are open, zero console errors. Then Back / Forward.
// 2. Group headers: aria-expanded / aria-controls, Enter and Space toggle them, the state survives a reload.
// 3. Desktop: the header's menu button collapses the menu to icons ("Collapse menu" / "Expand menu", aria-expanded);
//    every group icon has its name as a tooltip, a click on one expands the menu with that group open; the collapsed
//    state survives a reload.
// 4. 390 wide: the drawer (header menu button, groups, a link closes it, the backdrop and Esc close it, focus back on
//    the menu button), every live entry through it.
// 5. Roles: Sub-admin and Viewer (the roles the old editor and viewer users get) see exactly the entries their role's
//    permissions open (src/shared/permissions.js + role_permissions), and each of them loads.
// 6. Enquiries badge = the API's count of New leads. The header's User Interface link -> /en in a new tab.
// 7. Error boundary: one list answered (in the browser only) with a broken row shows "This screen could not load"
//    inside the page, logs the error, and the menu keeps working.
// Three active dAdmin employees who are not admin users yet become temporary admin users (Admin, Sub-admin, Viewer; a
// session needs an active dAdmin employee) with session cookies signed with JWT_SECRET; they and their audit rows are
// removed at the end. Read-only otherwise.
// Setup like scripts/visual-check (puppeteer-core is NOT a project dependency; Chrome must be installed):
//   npm i --prefix <scratch> puppeteer-core@24
//   NODE_PATH=<scratch>/node_modules WEB_URL=http://localhost:3000 npm run test:admin-nav
// WEB_URL = the React dev server (API on 4012) or a production build served by server.js (SERVE_BUILD=true).
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run against NODE_ENV=production');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../../config/db');
const permissions = require('../../src/shared/permissions');

const WEB = process.env.WEB_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USERS = {}; // admin / subadmin / viewer -> emp_id (picked in main)
const ROLE_ID = { admin: permissions.ADMIN_ROLE_ID, subadmin: permissions.SUBADMIN_ROLE_ID, viewer: 3 };
const DADMIN = /^[A-Za-z0-9_]{1,32}$/.test(process.env.DADMIN_DB_NAME || '') ? process.env.DADMIN_DB_NAME : 'dadmin';
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

/** the live entries of src/admin/menu.js (generated, plain data): { id, label, group, sub, href, section } in menu order */
function liveEntries() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'admin', 'menu.js'), 'utf8');
  const body = src.slice(src.indexOf('export const MENU =') + 'export const MENU ='.length).trim().replace(/;\s*$/, '');
  const menu = new Function(`return (${body});`)(); // eslint-disable-line no-new-func
  const out = [];
  const add = (e, g, s) => {
    const t = e.to && e.to.find((x) => !x.commerce);
    if (t) out.push({ id: e.id, label: e.label, group: g.key, sub: s ? s.key : null, section: t.section, href: `/admin/${t.path}${t.search ? `?${t.search}` : ''}${t.hash ? `#${t.hash}` : ''}` });
  };
  for (const g of menu) {
    if (g.solo) continue;
    for (const k of g.kids) (k.kids ? k.kids.forEach((e) => add(e, g, k)) : add(k, g, null));
  }
  return out;
}
const SCREENS = liveEntries();
// the page title when it is not the menu entry's name; API list to compare the first row with ([endpoint, keys])
const TITLE = { '/admin/settings': 'Settings', '/admin/commerce-settings': 'Commerce settings' };
// phase 14: Categories shows each category's English name (Masters > Catalogue, v23); Kits is a card grid (no table row to compare)
const FIRST_ROW = { '/admin/categories': ['/catalogue/categories', ['name.en']], '/admin/size-picker': ['/size-picker', ['size_label']],
  '/admin/banners': ['/banners', ['banner_key']], '/admin/towns': ['/towns', ['town_key']], '/admin/form-options': ['/form-options', ['option_value']] };
const titleOf = (s) => TITLE[s.href.split('#')[0]] || s.label;
const linkSel = (s) => `#a-nav a[href="${s.href}"]`;
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
  const [free] = await db.query(`SELECT e.emp_id FROM \`${DADMIN}\`.employee e WHERE e.active = 1 AND e.deleted_time IS NULL
      AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.emp_id = e.emp_id) ORDER BY e.emp_id LIMIT 3`);
  if (free.length < 3) throw new Error('needs 3 active dAdmin employees who are not admin users');
  ['admin', 'subadmin', 'viewer'].forEach((r, i) => { USERS[r] = free[i].emp_id; });
  for (const [role, emp] of Object.entries(USERS)) {
    await db.query("INSERT INTO admin_users (emp_id, role, role_id, is_active, created_by) VALUES (?, 'viewer', ?, 1, 'admin-nav check')", [emp, ROLE_ID[role]]);
  }
  const [[cs]] = await db.query("SELECT value FROM commerce_settings WHERE setting_key = 'commerce_enabled'");
  const commerceWas = cs ? cs.value : null;
  await db.query("UPDATE commerce_settings SET value = '0' WHERE setting_key = 'commerce_enabled'");
  const [permRows] = await db.query('SELECT role_id, section, can_view, can_create, can_edit, can_approve, can_delete FROM role_permissions');
  const permsOf = (role) => permissions.permsFor(ROLE_ID[role], permRows.filter((r) => Number(r.role_id) === ROLE_ID[role]));
  const opens = (role, s) => !s.section || permissions.can(permsOf(role), s.section, 'view');
  const token = (emp) => jwt.sign({ sub: emp, app: APP, stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 120000 });
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
    await page.waitForSelector('#a-nav .a-navlist', { timeout: 30000 });
    return page;
  }

  const isVisible = (page, sel) => page.$eval(sel, (el) => el.offsetParent !== null).catch(() => false);
  // Reach a screen through the menu: open its group, then its sub-group, when closed (a real click on the header).
  async function go(page, s) {
    for (const [key, cls] of [[s.group, '.a-ng'], [s.sub, '.a-nsg']]) {
      if (!key || await isVisible(page, linkSel(s))) continue;
      const id = cls === '.a-ng' ? `a-grp-${key}` : `a-sub-${key.replace(/\W+/g, '-')}`;
      const h = `#a-nav ${cls}[aria-controls="${id}"]`;
      if ((await page.$eval(h, (b) => b.getAttribute('aria-expanded')).catch(() => null)) === 'true') continue;
      await page.click(h);
      const opened = await page.$eval(h, (b) => b.getAttribute('aria-expanded')).catch(() => null);
      if (opened !== 'true') fail(`${key} did not open (aria-expanded=${opened})`);
    }
    await page.click(linkSel(s));
  }

  const apiCall = (page, p) => page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return (await r.json()).data;
  }, `${page.url().includes(':3000') ? 'http://localhost:4012' : ''}/api/dfresh/admin${p}`);

  async function check(page, i, label, firstRow = {}) {
    const s = SCREENS[i];
    const want = titleOf(s);
    // the address first (two entries can share a page and its title, e.g. Settings #cs-s-home-page / #cs-s-company)
    const norm = (u) => u.replace(/\/(?=$|[?#])/, '');
    await page.waitForFunction((href) => (window.location.pathname + window.location.search + window.location.hash).replace(/\/(?=$|[?#])/, '') === href,
      { timeout: 15000 }, norm(s.href)).catch(() => {});
    await wait(200); // the address changes at once, the menu re-renders a frame later
    const ok = await page.waitForFunction((h) => {
      const h1 = document.querySelector('.a-main h1');
      const loading = [...document.querySelectorAll('.a-main p')].some((p) => p.textContent === 'Loading...');
      return h1 && h1.textContent.trim() === h && !loading;
    }, { timeout: 30000 }, want).then(() => true, () => false); // big screens (Translations) on a busy dev machine
    const state = await page.evaluate((grp, sub) => ({
      h1: (document.querySelector('.a-main h1') || {}).textContent || null,
      broken: !!document.querySelector('.a-main .a-crash'),
      url: window.location.pathname + window.location.search + window.location.hash,
      first: [...(([...document.querySelectorAll('.a-main table.a-table tbody tr')].find((tr) => tr.querySelector('td')) || { querySelectorAll: () => [] }).querySelectorAll('td'))].map((td) => td.textContent.trim()), // grouped lists start with a header row
      on: [...document.querySelectorAll('#a-nav a.on')].map((a) => a.getAttribute('href')),
      current: [...document.querySelectorAll('#a-nav a[aria-current="page"]')].map((a) => a.getAttribute('href')),
      groupOpen: (document.querySelector(`#a-nav .a-ng[aria-controls="a-grp-${grp}"]`) || {}).ariaExpanded === 'true' || !!document.querySelector('#a-nav.mini'),
      groupCurrent: !!document.querySelector(`#a-nav .a-ng.cur[aria-controls="a-grp-${grp}"]`),
      subOpen: !sub || (document.querySelector(`#a-nav .a-nsg[aria-controls="a-sub-${sub.replace(/\W+/g, '-')}"]`) || {}).ariaExpanded === 'true' || !!document.querySelector('#a-nav.mini'),
    }), s.group, s.sub);
    if (!ok) fail(`${label}: ${s.href} did not show "${want}" (shows "${state.h1}")`);
    if (state.broken) fail(`${label}: ${s.href} shows the "could not load" panel`);
    if (norm(state.url) !== norm(s.href)) fail(`${label}: url ${state.url}`);
    if (JSON.stringify(state.on) !== JSON.stringify([s.href]) || JSON.stringify(state.current) !== JSON.stringify([s.href])) {
      fail(`${label}: highlighted ${JSON.stringify(state.on)} / aria-current ${JSON.stringify(state.current)}`);
    }
    if (!state.groupOpen) fail(`${label}: group ${s.group} of the current page is not open`);
    if (!state.groupCurrent) fail(`${label}: group ${s.group} is not marked current`);
    if (!state.subOpen) fail(`${label}: sub-group ${s.sub} of the current page is not open`);
    if (firstRow[s.href] && !firstRow[s.href].every((v) => state.first.includes(v))) {
      fail(`${label}: ${s.href} first row [${state.first.slice(0, 4).join(' | ')}] is not its own (expected ${firstRow[s.href].join(' + ')})`);
    }
    if (errors.length) { fail(`${label}: ${errors.join(' || ').slice(0, 300)}`); errors.length = 0; }
  }

  try {
    // ---- 1. admin, expanded -------------------------------------------------------------------
    const page = await newPage('admin');
    const firstRow = {};
    for (const [href, [api, keys]] of Object.entries(FIRST_ROW)) {
      const rows = await apiCall(page, api);
      const list = Array.isArray(rows) ? rows : (rows && rows.rows) || null; // phase 14: { rows } answers too
      firstRow[href] = list && list.length ? keys.map((k) => String(k.split('.').reduce((o, x) => (o ? o[x] : undefined), list[0]))) : null;
    }
    // every group and sub-group open, then read the menu
    for (;;) {
      const closed = await page.$$('#a-nav .a-ng[aria-expanded="false"], #a-nav .a-nsg[aria-expanded="false"]');
      if (!closed.length) break;
      await closed[0].click();
      await wait(40);
    }
    const menu = await page.evaluate(() => ({
      pages: [...document.querySelectorAll('#a-nav a.a-np')].map((a) => a.getAttribute('href')),
      groups: [...document.querySelectorAll('#a-nav .a-ng .a-lbl')].map((b) => b.textContent.trim()),
      ext: [...document.querySelectorAll('.a-head a[target]')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })),
    }));
    if (JSON.stringify(menu.pages) !== JSON.stringify(SCREENS.map((s) => s.href))) fail(`admin menu pages ${menu.pages.join(' ')}`);
    if (JSON.stringify(menu.groups) !== JSON.stringify(['Home', 'Sales', 'Masters', 'Website', 'Admin'])) fail(`groups ${menu.groups.join(' | ')}`);
    const ui = menu.ext.find((x) => x.href === '/en');
    if (!ui || ui.target !== '_blank' || ui.rel !== 'noopener noreferrer' || ui.label !== 'User Interface - opens the website in a new tab') fail(`User Interface link: ${JSON.stringify(menu.ext)}`);
    else console.log(`admin menu (Commerce off): ${menu.groups.length} groups (${menu.groups.join(', ')}), ${SCREENS.length} pages, no commerce entry; User Interface -> /en (header, new tab, noopener noreferrer)`);

    // Enquiries badge = API count of New leads
    const counts = await apiCall(page, '/nav-counts');
    const leads = SCREENS.find((s) => s.id === 'sales/leads/enquiries');
    const badge = await page.$eval(linkSel(leads), (a) => { const b = a.querySelector('.a-ncount'); return b ? Number(b.firstChild.textContent) : 0; });
    if (badge !== counts.newLeads) fail(`Enquiries badge ${badge}, API says ${counts.newLeads} new`);
    else console.log(`enquiries badge: ${badge} (API: ${counts.newLeads} new leads)`);

    const order = circuit(SCREENS.length);
    await page.click(linkSel(SCREENS[0]));
    await check(page, order[0], 'start', firstRow);
    let reopened = 0;
    for (let m = 1; m < order.length; m += 1) {
      if (m % 5 === 0) {
        // close every open group except the current page's, and every open sub-group, so the next moves must open them again
        const closed = await page.evaluate(() => {
          let n = 0;
          document.querySelectorAll('#a-nav .a-ng:not(.cur)[aria-expanded="true"], #a-nav .a-nsg[aria-expanded="true"]').forEach((b) => { b.click(); n += 1; });
          return n;
        });
        reopened += closed;
        await wait(60);
      }
      await go(page, SCREENS[order[m]]);
      await check(page, order[m], `move ${m} ${SCREENS[order[m - 1]].id} -> ${SCREENS[order[m]].id}`, firstRow);
    }
    console.log(`expanded: ${order.length - 1} moves (every ordered pair once), groups / sub-groups closed ${reopened} times along the way and reopened by their headers`);
    const tail = order.slice(-SCREENS.length);
    for (let k = tail.length - 2; k >= 0; k -= 1) { await page.goBack(); await check(page, tail[k], `back to ${SCREENS[tail[k]].id}`, firstRow); }
    for (let k = 1; k < tail.length; k += 1) { await page.goForward(); await check(page, tail[k], `forward to ${SCREENS[tail[k]].id}`, firstRow); }
    console.log(`back / forward: ${tail.length - 1} + ${tail.length - 1}`);

    // ---- 2. group headers: keyboard + remembered -----------------------------------------------
    await go(page, SCREENS[0]);
    await check(page, 0, 'dashboard for the keyboard check');
    const hdr = '#a-nav .a-ng[aria-controls="a-grp-website"]';
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

    // ---- 3. collapsed to icons (the header's menu button) ---------------------------------------
    const toggle = '.a-head button[aria-controls="a-nav"]';
    const state = () => page.$eval(toggle, (b) => `${b.getAttribute('aria-label')}|${b.getAttribute('aria-expanded')}`);
    const t0 = await state();
    await page.click(toggle);
    await page.waitForSelector('#a-nav.mini');
    const t1 = await state();
    if (t0 !== 'Collapse menu|true' || t1 !== 'Expand menu|false') fail(`menu button: ${t0} -> ${t1}`);
    else console.log(`menu button: "${t0}" -> click -> "${t1}"`);
    const tips = await page.$$eval('#a-nav.mini .a-ng', (bs) => bs.map((b) => [b.title, b.offsetParent !== null]));
    const noTip = tips.filter(([t, v]) => !t || !v);
    if (noTip.length) fail(`collapsed: group icons without tooltip or hidden: ${JSON.stringify(noTip)}`);
    await page.reload({ waitUntil: 'networkidle0' });
    if (!(await page.$('#a-nav.mini'))) fail('collapsed state not remembered after reload');
    // a click on a group icon expands the menu with that group open; then its pages are reached as usual
    const target = SCREENS.find((s) => s.group === 'website' && !s.sub);
    await page.evaluate(() => { const b = document.querySelector('#a-nav .a-ng[aria-controls="a-grp-website"]'); if (b.getAttribute('aria-expanded') === 'true') b.click(); });
    await page.click('#a-nav.mini .a-ng[title="Website"]');
    await page.waitForFunction(() => !document.querySelector('#a-nav.mini'));
    const websiteOpen = await page.$eval('#a-nav .a-ng[aria-controls="a-grp-website"]', (b) => b.getAttribute('aria-expanded'));
    if (websiteOpen !== 'true') fail('collapsed: a click on the Website icon did not open the Website group');
    await go(page, target);
    await check(page, SCREENS.indexOf(target), `from the icons -> ${target.id}`, firstRow);
    console.log(`collapsed: ${tips.length} group icons with tooltips, remembered after reload; a click on the Website icon expanded the menu with Website open and reached ${target.label}`);

    // ---- 4. 390 wide: the drawer ------------------------------------------------------------------
    const phone = await newPage('admin', 390, 844);
    const drawerOpen = () => phone.$eval('#a-nav', (n) => n.classList.contains('open') && getComputedStyle(n).visibility === 'visible');
    for (let i = 1; i < SCREENS.length; i += 1) {
      await phone.click(toggle);
      await phone.waitForFunction(() => document.querySelector('#a-nav').classList.contains('open'));
      await wait(260);
      await go(phone, SCREENS[i]);
      await check(phone, i, `drawer -> ${SCREENS[i].id}`, firstRow);
      await wait(260);
      if (await drawerOpen()) fail(`drawer -> ${SCREENS[i].id}: still open after the link`);
    }
    await phone.click(toggle);
    await wait(260);
    await phone.click('.a-nav-backdrop', { offset: { x: 370, y: 400 } }).catch(() => phone.mouse.click(375, 400));
    await wait(260);
    const afterBackdrop = await drawerOpen();
    await phone.click(toggle);
    await wait(260);
    await phone.keyboard.press('Escape');
    await wait(260);
    const afterEsc = await drawerOpen();
    const focusBack = await phone.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-controls') === 'a-nav');
    if (afterBackdrop || afterEsc || !focusBack) fail(`drawer close: backdrop ${!afterBackdrop}, Esc ${!afterEsc}, focus back on the menu button ${focusBack}`);
    else console.log(`390 drawer: ${SCREENS.length - 1} pages through the groups, closes on a link, the backdrop and Esc (focus back on the menu button)`);
    if (errors.length) { fail(`drawer: ${errors.join(' || ').slice(0, 300)}`); errors.length = 0; }

    // ---- 5. roles ------------------------------------------------------------------------------------
    for (const role of ['viewer', 'subadmin']) {
      const p = await newPage(role);
      for (;;) {
        const closed = await p.$$('#a-nav .a-ng[aria-expanded="false"], #a-nav .a-nsg[aria-expanded="false"]');
        if (!closed.length) break;
        await closed[0].click();
        await wait(40);
      }
      const shown = await p.$$eval('#a-nav a.a-np', (as) => as.map((a) => a.getAttribute('href')));
      const want = SCREENS.filter((s) => opens(role, s));
      const admin = await p.$$eval('#a-nav .a-ng[aria-controls="a-grp-admin"] + .a-kids a', (as) => as.map((a) => a.textContent.trim()));
      if (JSON.stringify(shown) !== JSON.stringify(want.map((s) => s.href))) fail(`${role}: menu ${shown.join(' ')} (expected ${want.map((s) => s.href).join(' ')})`);
      else console.log(`${role}: ${shown.length} pages, Admin group = ${admin.join(', ') || '(none)'}`);
      for (const s of want) {
        await go(p, s);
        await check(p, SCREENS.indexOf(s), `${role} -> ${s.id}`);
      }
      await p.browserContext().close();
    }

    // ---- 7. error boundary ----------------------------------------------------------------------------
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      // phase 14: the Kits page reads /catalogue/kits ({ kits, ... }); one broken kit row crashes it
      if (/\/api\/dfresh\/admin\/catalogue\/kits$/.test(r.url())) r.respond({ // same CORS headers as the API (dev: the page on :3000 calls the API on :4012)
        status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { kits: [null], godowns: [], business_types: [], skus: [], products: [], languages: [], basis: '' } }),
        headers: { 'Access-Control-Allow-Origin': new URL(WEB).origin, 'Access-Control-Allow-Credentials': 'true' },
      });
      else r.continue();
    });
    await go(page, SCREENS.find((s) => s.id === 'masters/catalogue/kits'));
    const panel = await page.waitForSelector('.a-main .a-crash', { timeout: 10000 }).then(() => true, () => false);
    const logged = errors.some((e) => /screen could not load/.test(e));
    errors.length = 0;
    const towns = SCREENS.find((s) => s.href === '/admin/towns');
    await go(page, towns);
    await check(page, SCREENS.indexOf(towns), 'after a crashed screen, menu to Where we deliver map', firstRow);
    if (!panel) fail('boundary: a crashing screen did not show the "could not load" panel');
    if (!logged) fail('boundary: the error was not logged to the console');
    else console.log('boundary: crashing screen showed the panel, error logged, the menu still works');

    console.log(`${failures ? 'FAILED' : 'PASS'}: ${failures} failure(s)`);
  } finally {
    await browser.close();
    const emps = Object.values(USERS);
    if (emps.length) {
      await db.query(`DELETE FROM audit_log WHERE emp_id IN (${emps.map(() => '?').join(', ')})`, emps);
      await db.query(`DELETE FROM admin_users WHERE emp_id IN (${emps.map(() => '?').join(', ')})`, emps);
    }
    if (commerceWas !== null) await db.query("UPDATE commerce_settings SET value = ? WHERE setting_key = 'commerce_enabled'", [commerceWas]);
    await db.end();
  }
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error('admin-nav check could not run:', err.message);
  process.exit(1);
});
