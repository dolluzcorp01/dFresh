// Banner text contrast (WCAG): every active banner at 1440 and 390 in every active language. For the eyebrow label
// and the headline it screenshots the text box twice, as shown and with the letters made transparent (a text-shadow
// or shade behind the text stays, the photo stays), so the second shot is exactly what is behind the letters. The
// pixels the letters cover (where the two shots differ) are compared with the text colour: "p5" = the contrast that
// 95% of those pixels meet or beat (pass mark), "min" = the single worst pixel. The button: label on its own fill
// (text), and the fill against the photo just outside it (p5, non-text, 3:1 is the WCAG mark).
// Pass: 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px bold).
//
// puppeteer-core is NOT a project dependency (same as scripts/visual-parity):
//   npm i --prefix <scratch> puppeteer-core@24
//   NODE_PATH=<scratch>/node_modules node scripts/visual-check/banner-contrast.js <label> [shots]
// Writes visual-output/banners-readability/contrast-<label>.json; "shots" also saves the funky and neon banners as
// <label>-<banner>-<width>.png. Web server on WEB_URL (default http://localhost:3000), languages from the API.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const sharp = require(path.resolve('node_modules/sharp'));

const [label, mode] = process.argv.slice(2);
if (!label) { console.error('usage: banner-contrast.js <label> [shots]'); process.exit(1); }
const OUT = path.resolve('visual-output', 'banners-readability');
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:4012';
const WIDTHS = [[1440, 900], [390, 844]];
const SHOT_BANNERS = ['funky', 'neon'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (css) => (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const r2 = (n) => Math.round(n * 100) / 100;

// clip is in page (document) coordinates: callers add window.scrollX / scrollY to viewport rects.
async function raw(page, clip) {
  const buf = await page.screenshot({ clip, type: 'png' });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

// Contrast of the text colour against what is behind the letters of the element matching sel.
async function textContrast(page, sel) {
  const info = await page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, color: cs.color, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
  });
  const clip = { x: Math.max(0, Math.floor(info.x) - 2), y: Math.max(0, Math.floor(info.y) - 2), width: Math.ceil(info.w) + 4, height: Math.ceil(info.h) + 4 };
  const shown = await raw(page, clip);
  await page.$eval(sel, (el) => el.style.setProperty('color', 'transparent', 'important'));
  await wait(60);
  const behind = await raw(page, clip);
  await page.$eval(sel, (el) => el.style.removeProperty('color'));
  const fg = rgb(info.color);
  const values = [];
  for (let i = 0; i < shown.data.length; i += 3) {
    const d = Math.abs(shown.data[i] - behind.data[i]) + Math.abs(shown.data[i + 1] - behind.data[i + 1]) + Math.abs(shown.data[i + 2] - behind.data[i + 2]);
    if (d > 60) values.push(ratio(fg, [behind.data[i], behind.data[i + 1], behind.data[i + 2]]));
  }
  const large = info.size >= 24 || (info.size >= 18.66 && info.weight >= 700);
  return { p5: values.length ? r2(pct(values, 0.05)) : null, min: values.length ? r2(Math.min(...values)) : null, px: values.length, color: info.color, size: info.size, need: large ? 3 : 4.5 };
}

// Button: label on fill, and fill against the photo in a 6px ring around the button.
async function buttonContrast(page, sel) {
  const b = await page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, color: cs.color, bg: cs.backgroundColor, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
  });
  const fill = rgb(b.bg);
  const pad = 8;
  const clip = { x: Math.floor(b.x) - pad, y: Math.floor(b.y) - pad, width: Math.ceil(b.w) + pad * 2, height: Math.ceil(b.h) + pad * 2 };
  const img = await raw(page, clip);
  const ring = [];
  for (let y = 0; y < img.h; y += 1) {
    for (let x = 0; x < img.w; x += 1) {
      const inX = x >= pad - 1 && x <= img.w - pad; const inY = y >= pad - 1 && y <= img.h - pad;
      if (inX && inY) continue;
      if (x < 2 || y < 2 || x >= img.w - 2 || y >= img.h - 2) continue;
      const i = (y * img.w + x) * 3;
      ring.push(ratio(fill, [img.data[i], img.data[i + 1], img.data[i + 2]]));
    }
  }
  const large = b.size >= 24 || (b.size >= 18.66 && b.weight >= 700);
  return { label: r2(ratio(rgb(b.color), fill)), need: large ? 3 : 4.5, edgeP5: r2(pct(ring, 0.05)) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const langs = (await (await fetch(`${API}/api/dfresh/languages`)).json()).data.languages.map((l) => l.code);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  // Reduced motion: no auto-advance, no zoom, no fade, so each banner is measured in its final, still state.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const rows = [];
  for (const [w, h] of WIDTHS) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    for (const lang of langs) {
      await page.goto(`${WEB}/${lang}`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForSelector('#moods .bs', { timeout: 20000 });
      // the header is fixed: put the banner below it, fully in view
      await page.evaluate(() => { const s = document.querySelector('#moods'); window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - document.querySelector('.top').offsetHeight); });
      await wait(400);
      const keys = await page.$$eval('#moods .bs', (els) => els.map((e) => ({ dark: e.classList.contains('dark') })));
      for (let k = 0; k < keys.length; k += 1) {
        await page.$$eval('#moods .bnr-dots button', (bs, i) => bs[i].click(), k);
        await page.waitForFunction((i) => {
          const s = document.querySelectorAll('#moods .bs')[i];
          const img = s && s.querySelector('img');
          return s.classList.contains('on') && img && img.complete && img.naturalWidth > 0;
        }, { timeout: 20000 }, k);
        await wait(250);
        const sel = (s) => `#moods .bs.on ${s}`;
        const row = {
          width: w, lang, idx: k, theme: keys[k].dark ? 'dark' : 'light',
          label: await textContrast(page, sel('.k')),
          headline: await textContrast(page, sel('h2')),
          button: await buttonContrast(page, sel('.ci .btn')),
        };
        rows.push(row);
        if (mode === 'shots' && lang === 'en') {
          const box = await page.$eval('#moods', (s) => { const r = s.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top) + window.scrollY, width: window.innerWidth, height: Math.min(r.height, window.innerHeight - Math.max(0, r.top)) }; });
          const shot = path.join(OUT, `${label}-${k}-${w}.png`);
          await page.screenshot({ path: shot, clip: box });
        }
      }
    }
  }
  await browser.close();
  // Banner keys in slider order (active, sort order) from the API, to name the rows and the screenshots.
  const boot = (await (await fetch(`${API}/api/dfresh/bootstrap?lang=en`)).json()).data;
  const order = boot.banners.map((b) => b.key);
  for (const r of rows) r.banner = order[r.idx] || String(r.idx);
  if (mode === 'shots') {
    for (const [w] of WIDTHS) {
      order.forEach((key, k) => {
        const from = path.join(OUT, `${label}-${k}-${w}.png`);
        if (!fs.existsSync(from)) return;
        if (SHOT_BANNERS.includes(key)) fs.renameSync(from, path.join(OUT, `${label}-${key}-${w}.png`));
        else fs.rmSync(from);
      });
    }
  }
  fs.writeFileSync(path.join(OUT, `contrast-${label}.json`), JSON.stringify(rows, null, 2));
  const ok = (v, need) => (v !== null && v >= need ? '' : ' FAIL');
  console.log('width lang banner   theme | label p5 (min) need | headline p5 (min) need | button label / edge p5');
  let fails = 0;
  for (const r of rows) {
    const f = ok(r.label.p5, r.label.need) + ok(r.headline.p5, r.headline.need) + ok(r.button.label, r.button.need);
    if (f) fails += 1;
    console.log(`${r.width} ${r.lang.padEnd(3)} ${r.banner.padEnd(9)} ${r.theme.padEnd(5)} | ${r.label.p5} (${r.label.min}) ${r.label.need}${ok(r.label.p5, r.label.need)} | ${r.headline.p5} (${r.headline.min}) ${r.headline.need}${ok(r.headline.p5, r.headline.need)} | ${r.button.label}${ok(r.button.label, r.button.need)} / ${r.button.edgeP5}`);
  }
  console.log(`${rows.length} rows, ${fails} with a failure`);
})().catch((e) => { console.error(e); process.exit(1); });
