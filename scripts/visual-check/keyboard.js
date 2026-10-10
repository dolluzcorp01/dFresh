// Keyboard-only check (phase 8 accessibility pass, acceptance "Keyboard only"): tabs through the home page
// and reports every stop with no visible focus indicator or off screen; then opens and closes the products
// drawer, a card flip, a colour swatch and the contact form with the keyboard only (focus trapped inside, Esc
// closes, focus returns to the opener). Same setup as visual-check.js (puppeteer-core via NODE_PATH, WEB_URL).
//   NODE_PATH=<scratch>/node_modules WEB_URL=http://localhost:3000 node scripts/visual-check/keyboard.js [lang] [width]
const puppeteer = require('puppeteer-core');

const WEB = process.env.WEB_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const lang = process.argv[2] || 'en';
const width = Number(process.argv[3]) || 1440;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` -> ${extra}` : ''}`); };

// The focused element: a short label, whether a focus indicator is drawn, whether it is on screen.
const ACTIVE = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const drawn = (s) => (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
  // The ring may be drawn on a wrapper (e.g. .ac:has(.ac-t:focus-visible)): the element or one of 3 ancestors.
  let ring = drawn(cs);
  for (let n = el.parentElement, i = 0; !ring && n && i < 3; n = n.parentElement, i += 1) ring = drawn(getComputedStyle(n));
  const r = el.getBoundingClientRect();
  const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const path = [];
  for (let n = el; n && path.length < 3; n = n.parentElement) path.unshift(n.id ? `#${n.id}` : (n.className && typeof n.className === 'string' ? `${n.tagName.toLowerCase()}.${n.className.split(' ')[0]}` : n.tagName.toLowerCase()));
  if (!el.dataset.kb) el.dataset.kb = String((window.kbN = (window.kbN || 0) + 1)); // unique per element
  return { key: el.dataset.kb, label: `${path.join(' > ')} "${label}"`, ring, onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth, inDialog: Boolean(el.closest('[role="dialog"]')) };
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); // stable positions
  await page.goto(`${WEB}/${lang}`, { waitUntil: 'networkidle2' });
  await wait(1500);

  // 1. Tab through the whole page once
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    await page.keyboard.press('Tab');
    await wait(60);
    const a = await page.evaluate(ACTIVE);
    if (!a) continue;
    if (seen.has(a.key) && stops.length > 5) break; // wrapped around
    seen.add(a.key);
    stops.push(a);
  }
  const noRing = stops.filter((s) => !s.ring);
  const off = stops.filter((s) => !s.onScreen);
  check(`Tab reaches ${stops.length} controls, each with a visible focus indicator`, noRing.length === 0, noRing.map((s) => s.label).join(' | '));
  check('every focused control is scrolled on screen', off.length === 0, off.map((s) => s.label).join(' | '));

  // 2. Products drawer from the hero "See all products" button
  await page.goto(`${WEB}/${lang}`, { waitUntil: 'networkidle2' });
  await wait(1200);
  await page.focus('.hero .ctas .btn:nth-child(2)');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawer[role="dialog"]', { visible: true });
  await wait(900);
  let inside = true;
  for (let i = 0; i < 60; i += 1) { await page.keyboard.press('Tab'); const a = await page.evaluate(ACTIVE); if (!a || !a.inDialog) { inside = false; break; } }
  check('drawer: Enter opens it, 60 Tabs stay inside (focus trap)', inside);

  // card flip + back with the keyboard
  await page.focus('.drawer .card .km');
  await page.keyboard.press('Enter');
  await wait(900);
  const flipped = await page.$eval('.drawer .card', (c) => c.classList.contains('flipped'));
  const focusOnBack = await page.evaluate(() => Boolean(document.activeElement.closest('.face.back')));
  await page.keyboard.press('Enter'); // focus is on the back's "Back" button (Esc would close the drawer itself)
  await wait(900);
  const unflipped = await page.$eval('.drawer .card', (c) => !c.classList.contains('flipped'));
  const kmFocused = await page.evaluate(() => document.activeElement.classList.contains('km'));
  check('card: Enter on "Know more" flips it and moves focus to the back', flipped && focusOnBack);
  check('card: Enter on "Back" flips it back and focus returns to "Know more"', unflipped && kmFocused, `unflipped=${unflipped} km focused=${kmFocused}`);

  // colour swatch (the product with colours)
  const sw = await page.$('.drawer .card .sw button[aria-pressed="false"]');
  if (sw) {
    await sw.focus();
    await page.keyboard.press('Enter');
    await wait(400);
    check('swatch: Enter selects another colour', await sw.evaluate((b) => b.getAttribute('aria-pressed') === 'true'));
  } else {
    check('swatch: a product with colours is in the drawer', false);
  }

  await page.keyboard.press('Escape');
  await wait(900);
  const drawerGone = !(await page.$('.drawer[role="dialog"]'));
  const backOnOpener = await page.evaluate(() => document.activeElement.matches('.hero .ctas .btn:nth-child(2)'));
  check('drawer: Esc closes it and focus returns to the opener', drawerGone && backOnOpener, `closed=${drawerGone} focus back=${backOnOpener}`);

  // 3. Contact form modal
  await page.focus('#contact .acts .btn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.scrim:not([hidden]) .modal', { visible: true });
  await wait(500);
  inside = true;
  for (let i = 0; i < 40; i += 1) { await page.keyboard.press('Tab'); const a = await page.evaluate(ACTIVE); if (!a || !a.inDialog || !a.ring) { inside = false; console.log('   escaped or no ring at', a && a.label); break; } }
  check('form: Enter opens it, 40 Tabs stay inside, every field shows focus', inside);
  await page.keyboard.press('Escape');
  await wait(600);
  const modalGone = !(await page.$('.scrim:not([hidden]) .modal'));
  const formOpener = await page.evaluate(() => document.activeElement.matches('#contact .acts .btn'));
  check('form: Esc closes it and focus returns to the opener', modalGone && formOpener);

  await browser.close();
  console.log(`\n${lang} at ${width}px: ${failed ? `${failed} FAILED` : 'all keyboard checks passed'}`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error(err.message); process.exit(1); });
