// Visual parity check (CLAUDE.md "How we work"): measures the same selectors on the approved preview and on
// our /en page at 1920, 1440 and 390 and writes visual-output/<phase>/m-<label>.json. With "shots" it also saves
// side-by-side PNGs (preview left, ours right) as visual-output/<phase>/parity-<label>-<section>-<width>.png.
// Then: node scripts/visual-parity/diff.js <phase> before [after]  -> the table.
//
// puppeteer-core is NOT a project dependency. Install it in a scratch folder outside the repo and point
// NODE_PATH at it; Chrome must be installed (CHROME_PATH overrides the default location). Web server on WEB_URL.
//   npm i --prefix <scratch> puppeteer-core@24
//   NODE_PATH=<scratch>/node_modules node scripts/visual-parity/measure.js phase-04 before shots
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const sharp = require(path.resolve('node_modules/sharp'));
const [phase, label, mode] = process.argv.slice(2);
if (!phase || !label) { console.error('usage: measure.js <phase> <label> [shots]'); process.exit(1); }
const OUT = path.resolve('visual-output', phase);
const SCR = OUT;
const PREVIEW = 'file:///' + path.resolve('docs/reference/dfresh-preview-v3.html').split(path.sep).join('/');
const OURS = `${process.env.WEB_URL || 'http://localhost:3000'}/en`;
const VIEWS = [[1920, 1080], [1440, 900], [390, 844]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// [section, sectionSelector, [[name, selector]...]]. Each phase adds the sections it builds.
const SECTIONS = [
  ['header', '.top', [
    ['header', '.top'], ['wrap', '.top .wrap'], ['logo', '.brand img'], ['nav', '.nav'], ['nav link', '.nav a'],
    ['langs', '.langs'], ['lang EN', '.langs button:nth-child(1)'], ['lang TA', '.langs button:nth-child(2)'], ['lang HI', '.langs button:nth-child(3)'], ['brochure btn', '.top .btn'], ['menu btn', '.mnav'],
  ]],
  ['hero', '.hero', [
    ['hero', '.hero'], ['wrap', '.hero > .wrap'], ['copy', '.hero .copy'], ['eyebrow', '.hero .copy .k'],
    ['h1', '.hero h1'], ['lede', '.hero .lede'], ['ctas', '.hero .ctas'], ['btn whatsapp', '.hero .ctas .btn:nth-child(1)'],
    ['btn products', '.hero .ctas .btn:nth-child(2)'], ['sheet', '.hero .sheet'], ['sheet canvas', '.hero .sheet canvas'],
    ['hint', '.hero .hint'],
  ]],
  ['stats', '.stats', [
    ['stats', '.stats'], ['wrap', '.stats .wrap'], ['stat', '.stats .stat'], ['stat num', '.stats .stat b'], ['stat label', '.stats .stat span'],
  ]],
  ['banners', '#moods', [
    ['section', '#moods'], ['slides', '.bnr-slides'], ['slide', '.bnr-slides .bs.on'], ['image', '.bnr-slides .bs.on img'],
    ['caption box', '.bnr-slides .bs.on .ci'], ['kicker', '.bnr-slides .bs.on .k'], ['title', '.bnr-slides .bs.on h2'],
    ['cta', '.bnr-slides .bs.on .btn'], ['dots', '.bnr-dots'], ['ui', '.bnr-ui'], ['dot', '.bnr-dots button'], ['arrow', '.bnr-arrows button'],
  ]],
  ['doors', '.doors', [
    ['section', '.doors'], ['wrap', '.doors > .wrap'], ['kicker', '.doors .sh .k'], ['kicker img', '.doors .sh .k img'], ['h2', '.doors .sh h2'],
    ['grid', '.doors .grid'], ['door', '.doors .door'], ['door k', '.doors .door .k'], ['door h3', '.doors .door h3'],
    ['door p', '.doors .door p'], ['go', '.doors .door .go'], ['go arrow', '.doors .door .go i'], ['art', '.doors .door .art'],
  ]],
  ['range', '#range', [
    ['section', '#range'], ['wrap', '#range .sh'], ['kicker', '#range .sh .k'], ['h2', '#range .sh h2'], ['p', '#range .sh p:not(.k)'],
    ['ringwrap', '#range .ringwrap'], ['item', '#range .ri'], ['pack', '#range .ri .pa'], ['item name', '#range .ri b'],
    ['item count', '#range .ri small'], ['controls', '#range .ringctl'], ['ctl btn', '#range .ringctl button'], ['ctl hint', '#range .ringctl span'],
  ]],
];

function measure(sections) {
  const px = (v) => (v === 'normal' ? null : parseFloat(v));
  const dur = (v) => Math.max(...v.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000)));
  // pass 1: timing, as authored
  const timing = {};
  for (const [sec, , items] of sections) for (const [name, sel] of items) {
    const el = document.querySelector(sel); if (!el) continue;
    const cs = getComputedStyle(el);
    timing[sec + '|' + name] = { trans_ms: dur(cs.transitionDuration), anim_ms: dur(cs.animationDuration) };
  }
  // pass 2: geometry with transitions frozen and the ring items un-rotated (their rotation is time-based)
  const fz = document.createElement('style');
  fz.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(fz);
  const ri = [...document.querySelectorAll('.ri')].map((e) => [e, e.style.transform]);
  ri.forEach(([e]) => { e.style.transform = 'none'; });
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
      const w = el.offsetWidth ?? r.width, h = el.offsetHeight ?? r.height;
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && (w > 0 || h > 0);
      out[sec][name] = !visible ? { hidden: 1 } : {
        x: Math.round(r.left - sr.left), y: Math.round(r.top - sr.top), w, h,
        font: px(cs.fontSize), lh: px(cs.lineHeight), weight: +cs.fontWeight, ls: px(cs.letterSpacing),
        pt: px(cs.paddingTop), pr: px(cs.paddingRight), pb: px(cs.paddingBottom), pl: px(cs.paddingLeft),
        mt: px(cs.marginTop), mb: px(cs.marginBottom), gap: px(cs.columnGap), rgap: px(cs.rowGap), radius: px(cs.borderTopLeftRadius),
        ...timing[sec + '|' + name],
      };
    }
  }
  ri.forEach(([e, t]) => { e.style.transform = t; });
  fz.remove();
  return out;
}

async function settle(page, w) {
  await page.evaluate(() => document.fonts.ready);
  // walk the page so every reveal has fired, then come back to the top
  const H = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < Math.min(H, 9000); y += 400) { await page.evaluate((yy) => scrollTo(0, yy), y); await wait(60); }
  // both pages on banner 1, pointer away from the slider
  await page.evaluate(() => { const d = document.querySelector('.bnr-dots button'); if (d) d.click(); });
  await page.evaluate(() => scrollTo(0, 0));
  await wait(2500);
}

async function open(browser, which, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  await page.goto(which === 'ours' ? OURS : PREVIEW, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1200);
  await settle(page, w);
  return page;
}

async function shotSection(page, sel, file) {
  // a fixed 1200ms after scrolling, top of section at top of viewport (header sticky is hidden for the shot)
  await page.evaluate((s) => {
    const t = document.querySelector('.top'); if (t && s !== '.top') t.style.visibility = 'hidden'; else if (t) t.style.visibility = '';
    const el = document.querySelector(s); scrollTo(0, el.getBoundingClientRect().top + scrollY - (s === '.top' ? 0 : 0));
  }, sel);
  await wait(1200);
  const el = await page.$(sel);
  await el.screenshot({ path: file });
  await page.evaluate(() => { const t = document.querySelector('.top'); if (t) t.style.visibility = ''; });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const result = {};
  for (const [w, h] of VIEWS) {
    result[w] = {};
    for (const which of ['preview', 'ours']) {
      const page = await open(browser, which, w, h);
      result[w][which] = await page.evaluate(measure, SECTIONS);
      result[w][which].__doc = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth }));
      if (mode === 'shots') {
        fs.mkdirSync(OUT, { recursive: true });
        for (const [sec, ssel] of SECTIONS) await shotSection(page, ssel, path.join(SCR, `_${which}-${sec}-${w}.png`));
      }
      await page.close();
    }
    if (mode === 'shots') {
      for (const [sec] of SECTIONS) {
        const a = path.join(SCR, `_preview-${sec}-${w}.png`), b = path.join(SCR, `_ours-${sec}-${w}.png`);
        const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
        const H = Math.max(ma.height, mb.height);
        const file = path.join(OUT, `parity-${label}-${sec}-${w}.png`);
        await sharp({ create: { width: ma.width + mb.width + 24, height: H, channels: 3, background: '#d0d0d0' } })
          .composite([{ input: a, left: 0, top: 0 }, { input: b, left: ma.width + 24, top: 0 }]).png().toFile(file);
        fs.unlinkSync(a); fs.unlinkSync(b); // the two halves this run just wrote
        console.log('saved', path.relative(process.cwd(), file));
      }
    }
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(SCR, `m-${label}.json`), JSON.stringify(result, null, 1));
  console.log('wrote', path.relative(process.cwd(), path.join(OUT, `m-${label}.json`)));
})().catch((e) => { console.error(e); process.exit(1); });
