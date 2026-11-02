// Admin visual parity (phase 11 onward): measures the same parts of docs/reference/dFresh_Back_Office_v23.html and of
// our /admin at 1440 and 390 and writes visual-output/<phase>/m-<label>.json (same format as measure.js, so
// `node scripts/visual-parity/diff.js <phase> <label> [after]` prints the table of every difference over 4px or 5%).
// With "shots": side-by-side PNGs (v23 left, ours right) as visual-output/<phase>/parity-<label>-<part>-<width>.png.
// The drawer: v23's first customer is active, so ours is the first Active customer (not one on hold with its notice).
// Parts: header, menu (open, on the Customer list page), menu collapsed (icons only, desktop), list page (v23 Customer
// list / our Orders: both a list with tabs), drawer (the first customer's) and toast. The toast: v23's own toast(); ours is the ToastProvider markup
// (src/admin/ui/Toast.js) put on the page, because no read-only action shows one.
// Signed in as MEASURE_EMP (default DZIND002, an Admin) with a session cookie signed with JWT_SECRET; Commerce must be on.
//   NODE_PATH=<scratch>/node_modules node scripts/visual-parity/admin-measure.js phase-11 before shots
require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const sharp = require(path.resolve('node_modules/sharp'));

const [phase, label, mode] = process.argv.slice(2);
if (!phase || !label) { console.error('usage: admin-measure.js <phase> <label> [shots]'); process.exit(1); }
const OUT = path.resolve('visual-output', phase);
const V23 = 'file:///' + path.resolve('docs/reference/dFresh_Back_Office_v23.html').split(path.sep).join('/');
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const EMP = process.env.MEASURE_EMP || 'DZIND002';
const VIEWS = [[1440, 900], [390, 844]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// [part, [v23 section selector, ours], [[name, v23 selector, our selector]...]]; a v23 selector { d, p } = desktop / phone
const PARTS = {
  header: [['.head', '.a-head'], [
    ['header', '.head', '.a-head'], ['menu button', { d: '[data-a="mini"]', p: '[data-a="phoneMenu"]' }, '.a-head button[aria-controls="a-nav"]'],
    ['godown chip', '.head label.chip', '.a-head .a-hchip'], ['bell', '#bellBtn', '.a-head .a-dd .a-iconbtn'],
    ['bell count', '#bellDot', '.a-head .a-dd .a-dot2'], ['me', '.head .me', '.a-head .a-me'], ['me avatar', '.head .me .av', '.a-head .a-me .a-avatar'],
    ['me name', '.head .me .t b', '.a-head .a-me-t b'], ['me role', '.head .me .t span', '.a-head .a-me-t span'],
  ]],
  menu: [['.side', '.a-side'], [
    ['menu', '.side', '.a-side'], ['brand', '.side .brand', '.a-side .a-brand2'], ['logo box', '.brand .logo', '.a-logo'], ['logo', '.brand .logo img', '.a-logo img'],
    ['brand name', '.brand b', '.a-brand2-t b'], ['brand sub', '.brand small', '.a-brand2-t small'],
    ['find', '.side-search label', '.a-side-search label'], ['find input', '#navq', '.a-side-search input'],
    ['list', '#nav', '.a-navlist'], ['group', '.nav .g', '.a-navlist .a-ng'], ['group icon', '.nav .g svg', '.a-navlist .a-ng .a-i'],
    ['sub-group', '.nav .sg', '.a-navlist .a-nsg'], ['page', '.nav .open > .kids > .open > .kids > .p:not(.on)', '.a-navlist .a-sub.open .a-np:not(.on)'], ['page on', '.nav .p.on', '.a-navlist .a-np.on'],
    ['kids', '.nav .open > .kids', '.a-navlist .a-grp2.open > .a-kids'],
    ['foot', '.side-foot', '.a-side-foot'], ['foot avatar', '.side-foot .av', '.a-side-foot .a-avatar'], ['foot name', '.side-foot .who b', '.a-who2 b'],
  ]],
  'menu collapsed': [['.side', '.a-side'], [
    ['menu', '.side', '.a-side'], ['brand', '.side .brand', '.a-side .a-brand2'], ['logo box', '.brand .logo', '.a-logo'],
    ['group', '.nav .g', '.a-navlist .a-ng'], ['foot', '.side-foot', '.a-side-foot'],
  ]],
  'list page': [['#page', '.a-main'], [
    ['page', '#page', '.a-main'], ['crumb', '.crumb', '.a-crumb'], ['title', '.ph h1', '.a-ph h1'], ['subtitle', '.ph p', '.a-ph p'],
    ['primary button', '.ph .acts .btn.primary', '.a-ph-acts .a-btn:not(.a-btn-ghost)'], ['ghost button', '.ph .acts .btn:not(.primary)', '.a-ph-acts .a-btn.a-btn-ghost'],
    ['tabs', '.tabs', '.a-tabs'], ['tab', '.tabs button', '.a-tabs > button'], ['tab on', '.tabs button[aria-selected=true]', '.a-tabs > button[aria-selected=true]'],
    ['table card', '.card:has(.tw)', '.a-tw'], ['table', 'table.t', '.a-tw table.a-table'], ['th', 'table.t th', '.a-tw .a-table th'], ['td', 'table.t tbody td', '.a-tw .a-table tbody td'],
    ['pill', 'table.t .pill', '.a-tw .a-table .a-pill, .a-tw .a-table .a-ostatus'],
  ]],
  drawer: [['.drawer', '.a-drawer'], [
    ['drawer', '.drawer', '.a-drawer'], ['head', '.drawer .dh', '.a-drawer > header'], ['title', '.drawer .dh h2', '.a-drawer > header h2'],
    ['close', '.drawer .dh .iconbtn', '.a-drawer > header .a-iconbtn'], ['body', '.drawer .db', '.a-drawer-body'], ['status bar', '.drawer .statusbar', '.a-drawer .a-statusbar'],
    ['tabs', '.drawer .dtabs', '.a-drawer .a-tabs'], ['foot', '.drawer .df', '.a-drawer > footer'], ['foot button', '.drawer .df .btn', '.a-drawer > footer .a-btn'],
  ]],
  toast: [['.toasts', '.a-toasts'], [
    ['stack', '.toasts', '.a-toasts'], ['toast', '.toast', '.a-tst'], ['icon', '.toast > svg', '.a-tst > .a-i'], ['title', '.toast .tx b', '.a-tst-tx b'], ['text', '.toast .tx span', '.a-tst-tx span'],
  ]],
};

function measure(sections) {
  const px = (v) => (v === 'normal' ? null : parseFloat(v));
  const out = {};
  for (const [sec, ssel, items] of sections) {
    const s = document.querySelector(ssel);
    if (!s) { out[sec] = null; continue; }
    const sr = s.getBoundingClientRect();
    out[sec] = {};
    for (const [name, sel] of items) {
      const el = document.querySelector(sel);
      if (!el) { out[sec][name] = null; continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0);
      out[sec][name] = !visible ? { hidden: 1 } : {
        x: Math.round(r.left - sr.left), y: Math.round(r.top - sr.top), w: Math.round(r.width), h: Math.round(r.height),
        font: px(cs.fontSize), lh: px(cs.lineHeight), weight: +cs.fontWeight,
        pt: px(cs.paddingTop), pr: px(cs.paddingRight), pb: px(cs.paddingBottom), pl: px(cs.paddingLeft), radius: px(cs.borderTopLeftRadius),
      };
    }
  }
  return out;
}

async function v23Page(browser, w, h) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h });
  await p.goto(`${V23}#sales/customers/customer-list`, { waitUntil: 'load' });
  await wait(700);
  return p;
}
// our page per part: the list page is Orders (a list with tabs, like v23's Customer list); the rest on the Customer list
const OUR_PATH = { 'list page': 'commerce/orders' };
async function ourPage(browser, w, h, part) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h });
  await p.setCookie({ name: 'dfresh_admin_token', value: jwt.sign({ sub: EMP, app: 'dFresh', stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '30m' }), domain: new URL(WEB).hostname, path: '/' });
  await p.goto(`${WEB}/admin/${OUR_PATH[part] || 'commerce/customers'}`, { waitUntil: 'networkidle0', timeout: 90000 });
  await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dfresh-admin-nav-collapsed')).forEach((k) => localStorage.removeItem(k)));
  await wait(700);
  return p;
}

// each part: how to bring it on screen in v23 / ours (null = as loaded); phone: the menu opens as a drawer
const SETUP = {
  header: [null, null],
  menu: [async (p, w) => { if (w < 900) { await p.click('[data-a="phoneMenu"]'); await wait(400); } },
    async (p, w) => { if (w < 900) { await p.click('.a-head button[aria-controls="a-nav"]'); await wait(400); } }],
  'menu collapsed': [async (p) => { await p.click('[data-a="mini"]'); await wait(300); }, async (p) => { await p.click('.a-head button[aria-controls="a-nav"]'); await wait(300); }],
  'list page': [null, null],
  drawer: [async (p) => { await p.click('table.t tbody tr'); await wait(500); }, async (p) => { await p.evaluate(() => [...document.querySelectorAll('.a-tw table.a-table tbody tr')].find((r) => /Active/.test(r.innerText)).click()); await wait(1200); }],
  toast: [async (p) => { await p.evaluate(() => window.toast('good', 'Customer saved', 'CUS-0141 Hotel Kanchi Residency')); await wait(300); },
    async (p) => {
      await p.evaluate(() => {
        const icon = document.querySelector('.a-head .a-i').outerHTML; // any of our 18 px line icons, same size as the toast icon
        document.querySelector('.a-toasts').innerHTML = `<div class="a-tst a-tst-good">${icon}<div class="a-tst-tx"><b>Customer saved</b><span>CUS-0141 Hotel Kanchi Residency</span></div><button type="button" class="a-x">×</button></div>`;
      });
      await wait(300);
    }],
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--allow-file-access-from-files'] });
  const result = {};
  fs.mkdirSync(OUT, { recursive: true });
  try {
    for (const [w, h] of VIEWS) {
      result[w] = { preview: {}, ours: {} };
      for (const [part, [secSel, items]] of Object.entries(PARTS)) {
        if (part === 'menu collapsed' && w < 900) continue; // no icon-only menu on a phone (both: a drawer)
        const files = [];
        for (const [i, which] of [[0, 'preview'], [1, 'ours']]) {
          const p = which === 'preview' ? await v23Page(browser, w, h) : await ourPage(browser, w, h, part);
          if (!result[w][which].__doc) result[w][which].__doc = await p.evaluate(() => ({ scrollW: document.documentElement.scrollWidth }));
          if (SETUP[part][i]) await SETUP[part][i](p, w);
          const pick = (x) => (typeof x === 'object' ? (w < 900 ? x.p : x.d) : x);
          const sec = [[part, secSel[i], items.map(([n, a, b]) => [n, i ? b : pick(a)])]];
          Object.assign(result[w][which], await p.evaluate(measure, sec));
          if (mode === 'shots') {
            const file = path.join(OUT, `_${which}-${part}-${w}.png`);
            const el = await p.$(secSel[i]);
            if (el && part !== 'drawer' && part !== 'toast' && !(part === 'menu' && w < 900)) await el.screenshot({ path: file });
            else await p.screenshot({ path: file });
            files.push(file);
          }
          await p.browserContext().close().catch(() => p.close());
        }
        if (mode === 'shots') {
          const [ma, mb] = await Promise.all(files.map((f) => sharp(f).metadata()));
          const out = path.join(OUT, `parity-${label}-${part.replace(/ /g, '-')}-${w}.png`);
          await sharp({ create: { width: ma.width + mb.width + 24, height: Math.max(ma.height, mb.height), channels: 3, background: '#d0d0d0' } })
            .composite([{ input: files[0], left: 0, top: 0 }, { input: files[1], left: ma.width + 24, top: 0 }]).png().toFile(out);
          files.forEach((f) => fs.unlinkSync(f));
          console.log('saved', path.relative(process.cwd(), out));
        }
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, `m-${label}.json`), JSON.stringify(result, null, 1));
  console.log('wrote', path.relative(process.cwd(), path.join(OUT, `m-${label}.json`)));
})().catch((e) => { console.error(e); process.exit(1); });
