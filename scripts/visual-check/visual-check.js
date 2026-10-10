// Visual check (phase 8): a screenshot of every home section, the products drawer, a legal page and the contact
// form, at 1440 and 390, in every active language, with normal and reduced motion, into visual-output/<out>/.
// Also checks: no sideways scroll at 360 / 390 / 1440, and that nothing auto-moves with reduced motion (hero,
// banners and the featured rail compared over 3 s).
//
// puppeteer-core is NOT a project dependency (same as scripts/visual-parity): install it outside the repo and
// point NODE_PATH at it. Chrome must be installed (CHROME_PATH overrides). Site on WEB_URL.
//   npm i --prefix <scratch> puppeteer-core@24
//   NODE_PATH=<scratch>/node_modules WEB_URL=http://localhost:3000 node scripts/visual-check/visual-check.js phase-08/visual-check
// LANGS=en,ta limits the languages (default: all active, from /api/dfresh/languages).
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const out = process.argv[2];
if (!out) { console.error('usage: visual-check.js <output folder under visual-output>'); process.exit(1); }
const OUT = path.resolve('visual-output', out);
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const API = process.env.API_URL || (WEB.includes(':3000') ? 'http://localhost:4012' : WEB);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SECTIONS = [
  ['header', '.top'], ['hero', '.hero'], ['banners', '#moods'], ['doors', '.doors'], ['range', '#range'],
  ['featured', '#featured'], ['play', '#play'], ['business', '#business'], ['where', '#where'], ['about', '#about'],
  ['contact', '#contact'], ['footer', 'footer.dark'],
];
const STILL = ['.hero', '#moods', '#featured']; // must not change by themselves with reduced motion
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, url, w, motion) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: w < 500 ? 844 : 900, isMobile: w < 500, hasTouch: w < 500 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1500);
  return page;
}

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const langs = process.env.LANGS ? process.env.LANGS.split(',')
    : (await (await fetch(`${API}/api/dfresh/languages`)).json()).data.languages.map((l) => l.code);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const problems = [];
  let shots = 0;

  for (const lang of langs) {
    for (const w of [360]) {
      const page = await open(browser, `${WEB}/${lang}`, w, 'reduce');
      for (const p of ['', '/products', '/privacy']) {
        if (p) { await page.goto(`${WEB}/${lang}${p}`, { waitUntil: 'networkidle2' }); await wait(1200); }
        const over = await sideways(page);
        if (over > 0) problems.push(`${lang}${p} at ${w}: ${over}px sideways scroll`);
      }
      await page.close();
    }
    for (const w of [1440, 390]) {
      for (const motion of ['no-preference', 'reduce']) {
        const tag = `${lang}-${w}-${motion === 'reduce' ? 'still' : 'motion'}`;
        const page = await open(browser, `${WEB}/${lang}`, w, motion);
        const over = await sideways(page);
        if (over > 0) problems.push(`${tag}: ${over}px sideways scroll`);
        for (const [name, sel] of SECTIONS) {
          const el = await page.$(sel);
          if (!el) { problems.push(`${tag}: section ${name} (${sel}) missing`); continue; }
          // through the section once (end, then start) so every scroll reveal inside a tall section has run
          await el.evaluate((e) => e.scrollIntoView({ block: 'end' }));
          await wait(motion === 'reduce' ? 150 : 900);
          await el.evaluate((e) => e.scrollIntoView({ block: 'start' }));
          await wait(motion === 'reduce' ? 300 : 1200);
          await el.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
          shots += 1;
        }
        if (motion === 'reduce') {
          for (const sel of STILL) {
            const el = await page.$(sel);
            await el.evaluate((e) => e.scrollIntoView({ block: 'start' }));
            await wait(1200); // let the scroll-dependent header state settle first; only what moves after that counts
            const a = await el.screenshot({ encoding: 'base64' });
            await wait(3000);
            const b = await el.screenshot({ encoding: 'base64' });
            if (a !== b) problems.push(`${tag}: ${sel} changed by itself within 3 s with reduced motion`);
          }
        }
        // products drawer, privacy page, contact form (viewport shots)
        await page.goto(`${WEB}/${lang}/products`, { waitUntil: 'networkidle2' });
        await wait(1200);
        await page.screenshot({ path: path.join(OUT, `${tag}-products.png`) });
        await page.goto(`${WEB}/${lang}/privacy`, { waitUntil: 'networkidle2' });
        await wait(800);
        await page.screenshot({ path: path.join(OUT, `${tag}-privacy.png`) });
        await page.goto(`${WEB}/${lang}`, { waitUntil: 'networkidle2' });
        await wait(1200);
        await page.evaluate(() => document.querySelector('#contact .acts .btn').click());
        await wait(900);
        await page.screenshot({ path: path.join(OUT, `${tag}-form.png`) });
        shots += 3;
        await page.close();
        console.log(`${tag}: done`);
      }
    }
  }
  await browser.close();
  console.log(`\n${shots} screenshots in ${path.relative(process.cwd(), OUT)}`);
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n- ${problems.join('\n- ')}` : 'no problems: no sideways scroll at 360 / 390 / 1440, nothing auto-moves with reduced motion');
  process.exitCode = problems.length ? 1 : 0;
})().catch((err) => { console.error(err.message); process.exit(1); });
