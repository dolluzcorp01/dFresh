// Visual parity check (CLAUDE.md "How we work"): measures the same selectors on the approved preview and on
// our /en page at 1920, 1440 and 390 and writes visual-output/<phase>/m-<label>.json. With "shots" it also saves
// side-by-side PNGs (preview left, ours right) as visual-output/<phase>/parity-<label>-<section>-<width>.png.
// Then: node scripts/visual-parity/diff.js <phase> before [after]  -> the table.
//
// puppeteer-core is NOT a project dependency. Install it in a scratch folder outside the repo and point
// NODE_PATH at it; Chrome must be installed (CHROME_PATH overrides the default location). Web server on WEB_URL.
//   npm i --prefix <scratch> puppeteer-core@24
//   NODE_PATH=<scratch>/node_modules node scripts/visual-parity/measure.js phase-04 before shots
// ONLY=play,business,... limits the run to those sections (a stage with none of them is skipped).
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

// The front of the first flip card inside scope (Phase 4).
function CARD_FRONT(scope, items) {
  const c = `${scope} .card`;
  return [...items, ['card', c], ['carousel', `${c} .car`], ['photo dot', `${c} .dots button:not([aria-current="true"])`], ['photo dot on', `${c} .dots button[aria-current="true"]`], ['body', `${c} .fb`],
    ['id chip', `${c} .idc`], ['name', `${c} h3`], ['one-liner', `${c} .one`], ['chips', `${c} .chips`],
    ['kw chip', `${c} .chips span`], ['know more', `${c} .km`], ['know more icon', `${c} .km i`]];
}

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
  ['featured', '#featured', CARD_FRONT('#featured', [
    ['section', '#featured'], ['h2', '#featured .sh h2'], ['p', '#featured .sh p:not(.k)'], ['rail', '#featured .rail'],
    ['rail btn', '#featured .rail-ctrl button'],
  ])],
  // Phase 5
  ['play', '#play', [
    ['section', '#play'], ['duo', '#play .duo'], ['roll tile', '#play .t-roll'], ['nap tile', '#play .t-nap'], ['hint', '#play .t-roll .hint'],
    ['kicker', '#play .t-roll .k'], ['h3', '#play .t-roll h3'], ['p', '#play .t-roll p'], ['urb', '#play .urb'], ['roll', '#play .urb .roll'],
    ['paper canvas', '#play .urb canvas'], ['napbox', '#play .napbox'], ['napkin', '#play .nap'], ['size', '#play .szr b'],
    ['size unit', '#play .szr b small'], ['product', '#play .szr .pn'], ['size btns', '#play .szb'], ['size btn', '#play .szb button'],
  ]],
  ['business', '#business', [
    ['section', '#business'], ['h2', '#business .sh h2'], ['p', '#business .sh p:not(.k)'], ['acc', '#business .acc'],
    ['kit open', '#business .ac.open'], ['kit closed', '#business .ac:not(.open)'], ['num', '#business .ac.open .n'], ['photo', '#business .ac.open .im'],
    ['h3 open', '#business .ac.open h3'], ['h3 closed', '#business .ac:not(.open) h3'], ['tagline', '#business .ac.open .more p'],
    ['item', '#business .ac.open .more li'], ['acts', '#business .ac.open .acts'], ['wa btn', '#business .ac.open .acts .btn'],
    ['sample btn', '#business .ac.open .acts .btn:nth-child(2)'],
  ]],
  ['where', '#where', [
    ['section', '#where'], ['grid', '#where .grid'], ['kicker', '#where .sh .k'], ['h2', '#where .sh h2'], ['p', '#where .sh p:not(.k)'],
    ['towns', '#where .townlist'], ['town', '#where .townlist span'], ['btn', '#where .btn'], ['map', '#where .fmap'], ['map svg', '#where .fmap svg'],
    ['label', '#where .fmap text'],
  ]],
  ['about', '#about', [
    ['section', '#about'], ['ab', '#about .ab'], ['kicker', '#about .txt .k'], ['h2', '#about .txt h2'], ['p', '#about .txt > p:not(.k)'],
    ['pic', '#about .pic'], ['points', '#about .pts'], ['point', '#about .pt'], ['icon', '#about .pt i'], ['point h', '#about .pt b'], ['point p', '#about .pt p'],
  ]],
  ['contact', '#contact', [
    ['section', '#contact'], ['blob', '#contact .blob'], ['h2', '#contact h2'], ['p', '#contact > .wrap > p'], ['acts', '#contact .acts'],
    ['sample btn', '#contact .acts .btn:nth-child(1)'], ['wa btn', '#contact .acts .btn:nth-child(2)'], ['brochure btn', '#contact .acts .btn:nth-child(3)'],
    ['msg btn', '#contact .acts .btn:nth-child(4)'], ['nums', '#contact .nums'], ['num', '#contact .nums b'], ['visit', '#contact .visit'],
    ['card', '#contact .vc'], ['map frame', '#contact .vc .mapf'], ['card body', '#contact .vc .vb'], ['card h', '#contact .vc .vb b'],
    ['card p', '#contact .vc .vb p'], ['card btn', '#contact .vc .vb .btn'],
  ]],
  ['footer', 'footer.dark', [
    ['footer', 'footer.dark'], ['wrap', 'footer.dark .wrap'], ['logo', 'footer.dark .flogo'], ['h4', 'footer.dark h4'], ['legal', 'footer.dark .legal'],
    ['bigf', '.bigf'], ['letter', '.bigf span'],
  ]],
];

// Phase 4: the drawer (opened from the hero's "See all products") and a flipped card's back.
const DRAWER = [
  ['drawer', '.drawer', CARD_FRONT('.drawer', [
    ['head', '.drawer .dh'], ['head wrap', '.drawer .dh .wrap'], ['h2', '.drawer .dh h2'], ['search', '.drawer .search'],
    ['search input', '.drawer .search input'], ['close', '.drawer .xbtn'], ['filters', '.drawer .filters'],
    ['chip', '.drawer .filters button'], ['chip count', '.drawer .filters button span'], ['grid', '.drawer .grid4'],
    ['swatches', '.drawer .sw'], ['swatch', '.drawer .sw button'], ['swatch name', '.drawer .sw .swn'],
  ])],
];
const FLIPPED = [
  ['card back', '.drawer .card', [
    ['back', '.drawer .card .back'], ['id chip', '.drawer .card .back .idc'], ['h3', '.drawer .card .back h3'],
    ['desc', '.drawer .card .back .desc'], ['spec', '.drawer .card .back .spec'], ['dt', '.drawer .card .back .spec dt'],
    ['dd', '.drawer .card .back .spec dd'], ['buttons', '.drawer .card .back .bb'], ['wa btn', '.drawer .card .back .bb .btn'],
    ['quote btn', '.drawer .card .back .bb .btn:nth-child(2)'], ['back btn', '.drawer .card .back .bk'],
  ]],
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const pick = (sections) => (ONLY ? sections.filter(([name]) => ONLY.includes(name)) : sections);
const STAGES = [
  { name: 'page', sections: SECTIONS, setup: async (page) => {
    // every card on photo 1 right before measuring (auto-advance keeps ticking after a dot click)
    await page.evaluate(() => document.querySelectorAll('.card .dots button:first-child').forEach((b) => b.click()));
    await wait(250);
  } },
  { name: 'drawer', sections: DRAWER, fixed: true, setup: async (page) => {
    // fresh load: nothing left over from the page stage (scroll, hero confetti widening a mobile viewport)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.reload({ waitUntil: 'networkidle2' });
    await wait(2500);
    await page.evaluate(() => document.querySelector('.hero .ctas .btn:nth-child(2)').click());
    await wait(1800);
    await page.evaluate(() => document.querySelectorAll('.drawer .card .dots button:first-child').forEach((b) => b.click()));
    await wait(900);
  } },
  { name: 'flipped', sections: FLIPPED, setup: async (page) => {
    await page.evaluate(() => document.querySelector('.drawer .card .km').click());
    await wait(1400);
  } },
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
  for (let y = 0; y < H; y += 400) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await wait(60); }
  // both pages on banner 1 and every card on photo 1, pointer away from the slider
  await page.evaluate(() => { const d = document.querySelector('.bnr-dots button'); if (d) d.click(); });
  await page.evaluate(() => document.querySelectorAll('.card .dots button:first-child').forEach((b) => b.click()));
  await page.evaluate(() => window.scrollTo(0, 0));
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
    const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (s === '.top' ? 0 : 0));
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
  const shots = []; // [stage, section]
  for (const [w, h] of VIEWS) {
    result[w] = {};
    for (const which of ['preview', 'ours']) {
      const page = await open(browser, which, w, h);
      result[w][which] = { __doc: await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth })) };
      for (const st0 of STAGES) {
        const st = { ...st0, sections: pick(st0.sections) };
        if (!st.sections.length) continue;
        if (st.setup) await st.setup(page);
        Object.assign(result[w][which], await page.evaluate(measure, st.sections));
        if (mode === 'shots') {
          fs.mkdirSync(OUT, { recursive: true });
          for (const [sec, ssel] of st.sections) {
            const file = path.join(SCR, `_${which}-${sec}-${w}.png`);
            if (st.name === 'page') await shotSection(page, ssel, file);
            else if (st.fixed) await page.screenshot({ path: file });
            else await (await page.$(ssel)).screenshot({ path: file });
            if (which === 'ours' && w === VIEWS[0][0]) shots.push(sec);
          }
        }
      }
      await page.close();
    }
    if (mode === 'shots') {
      for (const sec of shots) {
        const a = path.join(SCR, `_preview-${sec}-${w}.png`), b = path.join(SCR, `_ours-${sec}-${w}.png`);
        const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
        const H = Math.max(ma.height, mb.height);
        const file = path.join(OUT, `parity-${label}-${sec.replace(/ /g, '-')}-${w}.png`);
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
