// Fonts that never need a developer. Every active language's script font is served as a subset of the full
// source font (fonts/source, catalog fonts/scripts.json) holding exactly the characters that language's text
// uses, and kept up to date at run time:
// - After every content change (content-cache bust: any ui_text / *_translations save or import, a language
//   switched on or edited) and at start-up, the characters each script font must cover are collected from the
//   public content of the languages that use it (bootstrap, legal pages, language list, the UI's own symbols).
// - When some are missing from the current subset, the CSS switches AT ONCE to the full font for that script
//   (status 'rebuilding': never a missing or wrong glyph), the subset is rebuilt in a worker thread, written
//   under a content-hashed name in media/fonts/, and the CSS switches to it (status 'ready'); each switch bumps
//   the content version. A failed rebuild keeps the full font (status 'full'), logs one line and shows on the
//   admin dashboard until a rebuild succeeds (retried on the next content change and every 10 minutes).
// - Language-switch labels: a tiny subset per font ("dFresh label <font>", src/i18n/fonts.js labelFamily) so
//   the switch shows each script without loading that script's font.
// - css(): the @font-face rules, inlined into every page by seo.js (GET /api/dfresh/fonts.css for the dev
//   server). Latin (Open Sans) and Saira live in the build (src/styles/fonts.css); only their label face is here.
// State survives restarts in private/fonts/manifest.json (never served).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const contentCache = require('./content-cache');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(ROOT, 'fonts', 'source');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts', 'scripts.json'), 'utf8')).scripts;
const OUT = process.env.FONT_DIR || path.join(ROOT, 'media', 'fonts');
const URL_BASE = '/media/fonts';
// not under media/: nginx serves media/ from disk, the manifest (character lists) stays private
const MANIFEST = process.env.FONT_MANIFEST || path.join(ROOT, 'private', 'fonts', 'manifest.json');
const DEBOUNCE_MS = Number(process.env.FONT_DEBOUNCE_MS || 1500);
const RETRY_MS = 10 * 60 * 1000;

const byFamily = new Map(CATALOG.map((s) => [s.family, s]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);

let manifest = { families: {} }; // family -> { subset: { file, chars, size }, full: { file, size }, label: { file, text, size } }
const state = new Map(); // family -> { status, error, at }
const cmapCache = new Map(); // family -> Set of code points the source font has
let content = null; // Public_server content (late require: it requires this module's users)
let timer = null;
let pending = false; // a debounced refresh is scheduled
let ownBust = false; // our own version bumps must not schedule another refresh (a failing rebuild would loop)
let running = null;
let again = false;
let retryTimer = null;
let worker = null;
let jobId = 0;
const jobs = new Map();
let uiSymbols = '';

function loadManifest() {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { manifest = { families: {} }; }
  if (!manifest.families) manifest.families = {};
}

function saveManifest() {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
}

// Symbols the public UI code renders itself (arrows, stars), from the sources when they are on this machine.
function scanSymbols() {
  const dir = path.join(ROOT, 'src');
  let out = '';
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['admin', 'fonts', 'backend_routes'].includes(e.name)) walk(p); } else if (/\.(js|css)$/.test(e.name)) out += fs.readFileSync(p, 'utf8');
    }
  };
  try { walk(dir); } catch { return ''; }
  return [...new Set(out.match(/[\u0080-\u{10ffff}]/gu) || [])].join('');
}

async function cmapOf(family) {
  if (cmapCache.has(family)) return cmapCache.get(family);
  const { Blob: HbBlob, Face } = await import('harfbuzzjs');
  // harfbuzz reads sfnt only: the woff2 source is unpacked first (fontverter, as subset-font does)
  const sfnt = await require('fontverter').convert(fs.readFileSync(path.join(SOURCE, byFamily.get(family).file)), 'truetype');
  const face = new Face(new HbBlob(sfnt), 0);
  const set = new Set(face.collectUnicodes());
  cmapCache.set(family, set);
  return set;
}

let subsetter = null; // tests: replace the worker (setSubsetter)

/** Tests only: fn(family, text) -> Promise<Buffer> instead of the worker; null = the worker. */
function setSubsetter(fn) {
  subsetter = fn;
}

function subsetInWorker(family, text) {
  if (subsetter) return subsetter(family, text);
  if (!worker) {
    worker = new Worker(path.join(__dirname, 'font-worker.js'));
    worker.unref();
    worker.on('message', ({ id, woff2, error }) => {
      const job = jobs.get(id);
      if (!job) return;
      jobs.delete(id);
      if (error) job.reject(new Error(error)); else job.resolve(Buffer.from(woff2));
    });
    worker.on('error', (err) => { for (const j of jobs.values()) j.reject(err); jobs.clear(); worker = null; });
  }
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, source: path.join(SOURCE, byFamily.get(family).file), text });
  });
}

function writeFile(prefix, buf) {
  const file = `${prefix}-${hash(buf)}.woff2`;
  const p = path.join(OUT, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, buf);
  return file;
}

// The full source font as a served file (used while a subset is rebuilt or after a failure).
function ensureFull(family) {
  const m = manifest.families[family] || (manifest.families[family] = {});
  if (m.full && fs.existsSync(path.join(OUT, m.full.file))) return;
  const buf = fs.readFileSync(path.join(SOURCE, byFamily.get(family).file));
  m.full = { file: writeFile(`${slug(family)}-full`, buf), size: buf.length };
}

// "U+20, U+B85-B8A" for a set of code points
function ranges(cps) {
  const sorted = [...new Set(cps)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    const hex = (n) => n.toString(16).toUpperCase();
    out.push(i === j ? `U+${hex(sorted[i])}` : `U+${hex(sorted[i])}-${hex(sorted[j])}`);
    i = j + 1;
  }
  return out.join(', ');
}

const codepoints = (text) => [...new Set([...text].map((c) => c.codePointAt(0)))];

// Characters each script font must cover now: from the content of the active languages using it.
async function wanted() {
  const langs = (await content.loadLanguages()).data;
  const out = new Map(); // family -> { text, labels }
  const listText = JSON.stringify(langs);
  for (const l of langs.languages) {
    if (!byFamily.has(l.fontFamily)) continue;
    const e = out.get(l.fontFamily) || { text: '', labels: ' ' };
    e.labels += l.switchLabel;
    if (!byFamily.get(l.fontFamily).bundled) {
      const boot = (await content.getBootstrap(l.code)).data;
      const legal = [];
      for (const page of ['privacy', 'terms']) {
        try { legal.push((await content.getLegal(page, l.code)).data); } catch { /* no legal page */ }
      }
      e.text += JSON.stringify([boot, legal]) + listText + uiSymbols;
    }
    out.set(l.fontFamily, e);
  }
  return out;
}

async function refreshOnce() {
  const need = await wanted();
  let changed = false;
  // fonts no active language uses any more leave the CSS
  for (const family of [...state.keys()]) if (!need.has(family)) { state.delete(family); changed = true; }
  for (const [family, { text, labels }] of need) {
    const cmap = await cmapOf(family);
    const m = manifest.families[family] || (manifest.families[family] = {});
    // label face (every font, also the bundled Latin one)
    const labelCps = codepoints(labels).filter((c) => cmap.has(c)).sort((a, b) => a - b);
    if (!m.label || m.label.text !== String.fromCodePoint(...labelCps) || !fs.existsSync(path.join(OUT, m.label.file))) {
      try {
        const buf = await subsetInWorker(family, String.fromCodePoint(...labelCps));
        m.label = { file: writeFile(`label-${slug(family)}`, buf), text: String.fromCodePoint(...labelCps), size: buf.length };
        changed = true;
      } catch (err) {
        console.error(`[fonts] label font for ${family} could not be built: ${err.message}`);
      }
    }
    if (byFamily.get(family).bundled) { state.set(family, { status: 'bundled', error: null, at: Date.now() }); continue; }
    // content subset: only characters this font has; always the space
    const cps = codepoints(text + ' ').filter((c) => cmap.has(c)).sort((a, b) => a - b);
    const have = m.subset && fs.existsSync(path.join(OUT, m.subset.file)) ? new Set(codepoints(m.subset.chars)) : null;
    const missing = have ? cps.filter((c) => !have.has(c)) : cps;
    if (have && !missing.length) {
      if (!state.get(family) || state.get(family).status !== 'ready') { state.set(family, { status: 'ready', error: null, at: Date.now() }); changed = true; }
      continue;
    }
    // missing characters: the full font serves at once, then the new subset replaces it
    ensureFull(family);
    state.set(family, { status: 'rebuilding', error: null, at: Date.now(), missing: missing.length });
    saveManifest();
    bumpVersion(); // pages from now on carry the full font
    try {
      const chars = String.fromCodePoint(...cps);
      const buf = await subsetInWorker(family, chars);
      m.subset = { file: writeFile(slug(family), buf), chars, size: buf.length };
      state.set(family, { status: 'ready', error: null, at: Date.now() });
      console.log(`[fonts] ${family}: subset rebuilt, ${cps.length} characters, ${Math.round(buf.length / 1024)} KB (${missing.length} new)`);
    } catch (err) {
      state.set(family, { status: 'full', error: err.message, at: Date.now() });
      console.error(`[fonts] ${family}: subset rebuild failed, serving the full font: ${err.message}`);
    }
    changed = true;
  }
  if (changed) { saveManifest(); bumpVersion(); }
}

function bumpVersion() {
  ownBust = true;
  try { contentCache.bust(); } finally { ownBust = false; }
}

// Serialised: a change during a refresh runs one more refresh after it.
function refresh() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await refreshOnce(); } while (again);
    } catch (err) {
      console.error('[fonts] refresh failed:', err.message);
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedule() {
  clearTimeout(timer);
  pending = true;
  timer = setTimeout(() => { pending = false; refresh(); }, DEBOUNCE_MS);
  timer.unref();
}

/** Start: last state from disk (CSS available at once), then a refresh; afterwards on every content change. */
function init() {
  fs.mkdirSync(OUT, { recursive: true });
  loadManifest();
  ({ content } = require('./Public_server'));
  uiSymbols = scanSymbols();
  for (const [family, m] of Object.entries(manifest.families)) {
    if (!byFamily.has(family)) continue;
    const ok = m.subset && fs.existsSync(path.join(OUT, m.subset.file));
    state.set(family, { status: byFamily.get(family).bundled ? 'bundled' : ok ? 'ready' : 'rebuilding', error: null, at: Date.now() });
  }
  contentCache.onBust(() => { if (!ownBust) schedule(); }); // a real content change (admin save, import, ...)
  retryTimer = setInterval(() => { if ([...state.values()].some((s) => s.status === 'full')) refresh(); }, RETRY_MS);
  retryTimer.unref();
  return refresh();
}

function face(family, file, range) {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:300 800;font-display:swap;src:url(${URL_BASE}/${file}) format('woff2')${range ? `;unicode-range:${range}` : ''}}`;
}

/** The @font-face rules for every script font in use (and the switch labels). */
function css() {
  const out = ['/* dFresh script fonts (font-manager.js) */'];
  for (const [family, m] of Object.entries(manifest.families)) {
    const s = byFamily.get(family);
    const st = state.get(family);
    if (!s || !st) continue;
    if (m.label) out.push(face(`dFresh label ${family}`, m.label.file, ranges(codepoints(m.label.text))));
    if (s.bundled) continue;
    if (st.status === 'ready' && m.subset) out.push(face(family, m.subset.file, ranges(codepoints(m.subset.chars))));
    else if (m.full) out.push(face(family, m.full.file, cmapCache.has(family) ? ranges([...cmapCache.get(family)]) : null));
  }
  return out.join('\n');
}

/** Per font: status ready | rebuilding | full (failed, full font served) | bundled, sizes, error. */
function status() {
  return [...state.entries()].map(([family, st]) => {
    const m = manifest.families[family] || {};
    return {
      family,
      script: byFamily.get(family).script,
      status: st.status,
      error: st.error || null,
      subsetSize: m.subset ? m.subset.size : null,
      characters: m.subset ? codepoints(m.subset.chars).length : null,
      fullSize: m.full ? m.full.size : null,
      labelSize: m.label ? m.label.size : null,
    };
  });
}

function familyStatus(family) {
  return status().find((s) => s.family === family) || null;
}

/** Tests: resolves when no refresh is scheduled or running (at most ~60 s). */
async function whenIdle() {
  for (let i = 0; i < 1200; i += 1) {
    if (!running && !pending) return;
    if (running) await running; else await new Promise((r) => setTimeout(r, 50));
  }
}

function stop() {
  clearTimeout(timer);
  clearInterval(retryTimer);
  if (worker) { worker.terminate(); worker = null; }
}

module.exports = { init, refresh, schedule, css, status, familyStatus, whenIdle, stop, setSubsetter, CATALOG: CATALOG.map(({ script, family, dir }) => ({ script, family, dir })) };
