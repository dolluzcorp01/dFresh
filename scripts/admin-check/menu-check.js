// Stage 2 menu check (phase 11), with Commerce switched ON (the check switches it on and puts it back). Exit 1 on any
// failure.
// 1. Count and order: as Admin (1440 wide) every group and sub-group is opened by clicking its header, then the menu is
//    read in screen order (top lines, sub-groups, pages). It must be the 148 lines of docs/STAGE2-MENU-GUIDE.txt in the
//    same order with the same names ("(not built yet)" / "(later)" after a guide name is the entry's tag, not its name);
//    the diff lists every missing, extra or renamed line.
// 2. Every entry opens: all 148 lines are clicked (13 group headers, Online store, 23 sub-group headers, 111 pages).
//    A page with a screen: no "could not load" panel, no "No access", loading finished, the screen shows its data (a
//    table, cards, a form or its empty state). A page without one: the placeholder with "Not built yet - phase NN" (or
//    "Later") as menu.js says, and the guide's "What you see" text. Zero console errors over the whole run.
// 3. Roles: a Sales and a Warehouse user (temporary admin users, removed at the end): the groups they see; every entry
//    they see is one their role may open and every entry it may open is shown (computed from role_permissions and
//    the map in src/admin/menu.js); the API answers 403 for the sections they lack.
// Setup like admin-nav.js (puppeteer-core is NOT a project dependency; Chrome must be installed):
//   NODE_PATH=<scratch>/node_modules WEB_URL=http://localhost:3000 npm run test:admin-menu
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

const ROOT = path.join(__dirname, '..', '..');
const WEB = process.env.WEB_URL || 'http://localhost:3000';
// the API (dev: its own port; a production build is served by server.js on the same origin)
const API = process.env.API_URL || (/:3000\b/.test(WEB) ? 'http://localhost:4012' : WEB);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DADMIN = /^[A-Za-z0-9_]{1,32}$/.test(process.env.DADMIN_DB_NAME || '') ? process.env.DADMIN_DB_NAME : 'dadmin';
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const ADMIN_EMP = process.env.MENU_CHECK_ADMIN || 'DZIND002';
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// a GET route per section, to see the API refuse a role without that section (Admin_server.js)
const PROBE = { leads: '/leads', orders: '/commerce/orders', packing: '/commerce/packing', delivery: '/commerce/my-trips', inventory: '/commerce/stock',
  returns: '/commerce/returns', customers: '/commerce/customers', promotions: '/commerce/promotions', products: '/prices', content: '/ui-text',
  settings: '/settings', users: '/users', audit: '/audit' };

/** the guide's 148 lines: { depth, name, tag } (tag = "not built yet" | "later" | null) */
function guideLines() {
  const out = [];
  for (const l of fs.readFileSync(path.join(ROOT, 'docs', 'STAGE2-MENU-GUIDE.txt'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([│ ]*)(├──|└──) (.*)$/);
    if (!m) continue;
    let text = m[3].trim();
    const depth = m[1].length / 4;
    if (depth === 0) text = text.replace(/^\S+\s+/, '').replace(/\s+-\s+.*$/, ''); // the emoji and " - tagline"
    const t = text.match(/^(.*?)\s*\((not built yet|later)\)$/);
    out.push({ depth, name: t ? t[1] : text, tag: t ? t[2] : null });
  }
  return out;
}

/** src/admin/menu.js (generated, plain data) without a bundler */
function menuData() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'admin', 'menu.js'), 'utf8');
  const body = src.slice(src.indexOf('export const MENU =') + 'export const MENU ='.length).trim().replace(/;\s*$/, '');
  return new Function(`return (${body});`)(); // eslint-disable-line no-new-func
}
function entriesOf(menu) {
  const out = [];
  for (const g of menu) {
    if (g.solo) { out.push(g); continue; }
    for (const k of g.kids) (k.kids ? k.kids : [k]).forEach((e) => out.push(e));
  }
  return out;
}
const okTarget = (perms, t, isDriver) => (!t.driver || isDriver) && (!t.section || permissions.can(perms, t.section, t.action || 'view'));
const visibleFor = (perms, e, isDriver) => (e.to ? e.to.some((t) => okTarget(perms, t, isDriver)) : !e.section || permissions.can(perms, e.section, 'view'));

async function main() {
  const guide = guideLines();
  const menu = menuData();
  const entries = entriesOf(menu);
  let failures = 0;
  const fail = (msg) => { failures += 1; console.log(`FAIL ${msg}`); };
  const errors = [];
  const temp = [];

  const [[cs]] = await db.query("SELECT value FROM commerce_settings WHERE setting_key = 'commerce_enabled'");
  const commerceWas = cs ? cs.value : null;
  await db.query("UPDATE commerce_settings SET value = '1' WHERE setting_key = 'commerce_enabled'");
  const [free] = await db.query(`SELECT e.emp_id FROM \`${DADMIN}\`.employee e WHERE e.active = 1 AND e.deleted_time IS NULL
      AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.emp_id = e.emp_id) ORDER BY e.emp_id LIMIT 2`);
  if (free.length < 2) throw new Error('needs 2 active dAdmin employees who are not admin users');
  const ROLES = [['Sales', 6, free[0].emp_id], ['Warehouse', 5, free[1].emp_id]];
  for (const [, roleId, emp] of ROLES) {
    await db.query("INSERT INTO admin_users (emp_id, role, role_id, is_active, created_by) VALUES (?, 'viewer', ?, 1, 'menu check')", [emp, roleId]);
    temp.push(emp);
  }
  const token = (emp) => jwt.sign({ sub: emp, app: APP, stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 120000 });

  async function newPage(emp, width = 1440, height = 900) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width, height });
    page.on('pageerror', (e) => errors.push(`${emp} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${emp} console: ${m.text()}`); });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.setCookie({ name: COOKIE, value: token(emp), domain: new URL(WEB).hostname, path: '/api/dfresh/admin', httpOnly: true, sameSite: 'Strict' });
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.waitForSelector('#a-nav .a-navlist', { timeout: 30000 });
    return page;
  }
  /** opens every closed group and sub-group by clicking its header; returns how many headers were clicked */
  async function openAll(page) {
    let clicks = 0;
    for (;;) {
      const closed = await page.$$('#a-nav .a-ng[aria-expanded="false"], #a-nav .a-nsg[aria-expanded="false"]');
      if (!closed.length) return clicks;
      await closed[0].click();
      clicks += 1;
      await wait(60);
    }
  }
  /** the menu as shown: [{ depth, name, tag, kind }] in screen order */
  const readMenu = (page) => page.$$eval('#a-nav .a-navlist .a-ng, #a-nav .a-navlist .a-nsg, #a-nav .a-navlist .a-np', (els) => els.map((el) => {
    const depth = el.classList.contains('a-ng') ? 0 : el.closest('.a-sub') ? (el.classList.contains('a-nsg') ? 1 : 2) : 1;
    const name = (el.querySelector('.a-lbl, .a-np-l') || el).childNodes[0].textContent.trim();
    const tagEl = el.querySelector('.a-tg');
    return { depth, name, tag: tagEl ? tagEl.textContent.trim() : null, kind: el.classList.contains('a-np') || el.classList.contains('a-ng-solo') ? 'page' : 'head', href: el.getAttribute('href') };
  }));

  try {
    // ---- 1. count, order, names (Admin, every group and sub-group opened by a click) ----
    const page = await newPage(ADMIN_EMP);
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dfresh-admin-nav')).forEach((k) => localStorage.removeItem(k)));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#a-nav .a-navlist');
    // close what is open, so every header is clicked at least once on the way back open
    for (;;) {
      const openOnes = await page.$$('#a-nav .a-nsg[aria-expanded="true"], #a-nav .a-ng[aria-expanded="true"]');
      if (!openOnes.length) break;
      await openOnes[openOnes.length - 1].click();
      await wait(40);
    }
    const headerClicks = await openAll(page);
    const shown = await readMenu(page);
    console.log(`menu (Admin, Commerce on): ${shown.length} lines (${shown.filter((x) => x.depth === 0).length} top lines, ${shown.filter((x) => x.kind === 'head' && x.depth === 1).length} sub-groups, ${shown.filter((x) => x.kind === 'page' && x.depth > 0).length} pages); ${headerClicks} group / sub-group headers clicked open`);
    const tagOf = (t) => (t === 'Later' ? 'later' : t === 'Not built' ? 'not built yet' : t);
    const diff = [];
    const n = Math.max(guide.length, shown.length);
    for (let i = 0; i < n; i += 1) {
      const g = guide[i];
      const s = shown[i];
      if (!g) { diff.push(`+ extra line ${i + 1}: "${s.name}"`); continue; }
      if (!s) { diff.push(`- missing line ${i + 1}: "${g.name}"`); continue; }
      if (g.name.toLowerCase() !== s.name.toLowerCase() || g.depth !== s.depth) diff.push(`~ line ${i + 1}: guide "${g.name}" (level ${g.depth}) / menu "${s.name}" (level ${s.depth})`);
      else if (g.tag && g.tag !== tagOf(s.tag) && !(g.tag === 'later' && g.depth === 0)) diff.push(`~ line ${i + 1}: "${g.name}" tag guide "${g.tag}" / menu "${s.tag}"`);
    }
    console.log(`diff against docs/STAGE2-MENU-GUIDE.txt (${guide.length} lines): ${diff.length ? `\n  ${diff.join('\n  ')}` : 'no missing, extra or renamed line'}`);
    if (shown.length !== 148) fail(`menu has ${shown.length} lines, not 148`);
    diff.forEach((d) => fail(`menu vs guide ${d}`));

    // ---- 2. every entry opens ----
    const pages = shown.filter((x) => x.kind === 'page');
    let built = 0;
    let holders = 0;
    for (const x of pages) {
      const e = x.href.includes('/admin/p/') ? entries.find((en) => `/admin/p/${en.id}` === x.href) : null;
      const link = await page.$(`#a-nav a[href="${x.href}"]`);
      if (!link) { fail(`no link for ${x.name}`); continue; }
      await Promise.all([page.waitForNetworkIdle({ idleTime: 400, timeout: 30000 }).catch(() => {}), link.click()]);
      await page.waitForFunction(() => ![...document.querySelectorAll('.a-main p.a-muted')].some((el) => el.textContent.trim() === 'Loading...'), { timeout: 20000 }).catch(() => {});
      await wait(450);
      const state = await page.evaluate(() => {
        const main = document.querySelector('.a-main');
        const text = main ? main.innerText : '';
        return {
          url: window.location.pathname + window.location.search + window.location.hash,
          h1: (main && main.querySelector('h1') ? main.querySelector('h1').innerText : '').trim(),
          crashed: /This screen could not load/.test(text),
          noAccess: Boolean(main && main.querySelector('.a-noaccess')) || /Commerce is switched off/.test(text),
          loading: Boolean(main) && [...main.querySelectorAll('p.a-muted')].some((el) => el.textContent.trim() === 'Loading...'),
          placeholder: Boolean(main && main.querySelector('.a-placeholder')),
          pill: main && main.querySelector('.a-placeholder .a-pill') ? main.querySelector('.a-placeholder .a-pill').innerText.trim() : '',
          see: main && main.querySelector('.a-ph-kv dd') ? main.querySelector('.a-ph-kv dd').innerText.trim() : '',
          content: Boolean(main && main.querySelector('table, .a-card, .a-stat, .a-empty, form, .a-tile, .a-rqc, .a-alert, .a-infocard, .a-mytrips, .a-tripcard')),
          active: (document.querySelector('#a-nav .a-np.on, #a-nav .a-ng-solo.on') || {}).textContent || '',
        };
      });
      const where = `${x.name} (${state.url})`;
      if (state.crashed) fail(`${where}: "This screen could not load"`);
      if (state.noAccess) fail(`${where}: no access / Commerce off`);
      if (state.loading) fail(`${where}: still loading`);
      if (!state.active.includes(x.name)) fail(`${where}: the highlighted menu item is "${state.active}"`);
      if (x.href.includes('/admin/p/')) {
        holders += 1;
        const want = e && e.phase === 'later' ? 'Later' : `Not built yet - phase ${e && e.phase}`;
        if (!state.placeholder) fail(`${where}: placeholder page expected`);
        else if (state.pill !== want) fail(`${where}: pill "${state.pill}", expected "${want}"`);
        if (e && state.see.toLowerCase() !== String(e.see).toLowerCase()) fail(`${where}: "What you see" text differs from the guide`);
      } else {
        built += 1;
        if (state.placeholder) fail(`${where}: a built screen shows the placeholder`);
        if (!state.content) fail(`${where}: no table, card, form or empty state on the screen`);
      }
    }
    console.log(`clicked: ${headerClicks} headers + ${pages.length} pages = ${headerClicks + pages.length} menu lines; ${built} screens with data, ${holders} placeholders`);
    await page.close();

    // ---- 3. roles: Sales and Warehouse ----
    const [permRows] = await db.query('SELECT role_id, section, can_view, can_create, can_edit, can_approve, can_delete FROM role_permissions');
    for (const [label, roleId, emp] of ROLES) {
      const perms = permissions.permsFor(roleId, permRows.filter((r) => Number(r.role_id) === roleId));
      const rp = await newPage(emp);
      await openAll(rp);
      const seen = await readMenu(rp);
      const groups = seen.filter((x) => x.depth === 0).map((x) => x.name);
      const seenPages = seen.filter((x) => x.kind === 'page').map((x) => x.name);
      const expected = entries.filter((e) => visibleFor(perms, e, false)).map((e) => e.label);
      console.log(`${label} (${emp}, role ${roleId}): ${groups.length} groups: ${groups.join(', ')}; ${seenPages.length} pages`);
      const extra = seenPages.filter((nm) => !expected.includes(nm));
      const missing = expected.filter((nm) => !seenPages.includes(nm));
      if (extra.length) fail(`${label} sees entries the role may not open: ${extra.join(', ')}`);
      if (missing.length) fail(`${label} misses entries the role may open: ${missing.join(', ')}`);
      const lacks = Object.keys(PROBE).filter((s) => !permissions.can(perms, s, 'view'));
      const has = Object.keys(PROBE).find((s) => permissions.can(perms, s, 'view'));
      const okStatus = has ? await fetch(`${API}/api/dfresh/admin${PROBE[has]}`, { headers: { cookie: `${COOKIE}=${token(emp)}` } }).then((r) => r.status) : null;
      if (has && okStatus !== 200) fail(`${label}: GET ${PROBE[has]} (a section it has) answered ${okStatus}, not 200`);
      const answers = [];
      for (const s of lacks) {
        const status = await fetch(`${API}/api/dfresh/admin${PROBE[s]}`, { headers: { cookie: `${COOKIE}=${token(emp)}` } }).then((r) => r.status);
        answers.push(`${s} ${PROBE[s]} -> ${status}`);
        if (status !== 403) fail(`${label}: GET ${PROBE[s]} answered ${status}, not 403`);
      }
      console.log(`  API for the sections ${label} lacks: ${answers.join('; ') || '(none)'}${has ? ` (and ${has} ${PROBE[has]} -> ${okStatus}, a section it has)` : ''}`);
      await rp.close();
    }
  } finally {
    await browser.close();
    if (commerceWas !== null) await db.query("UPDATE commerce_settings SET value = ? WHERE setting_key = 'commerce_enabled'", [commerceWas]);
    if (temp.length) {
      await db.query('DELETE FROM audit_log WHERE emp_id IN (?)', [temp]);
      await db.query('DELETE FROM admin_users WHERE emp_id IN (?)', [temp]);
    }
  }
  console.log(`console / page errors: ${errors.length ? `\n  ${errors.join('\n  ')}` : '0'}`);
  failures += errors.length;
  console.log(failures ? `FAIL: ${failures} failure(s)` : 'PASS: 0 failure(s)');
  await db.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error('FAILED', e.message); try { await db.end(); } catch { /* closed */ } process.exit(1); });
