// The hosted e-mail logo (site_settings.mail_logo_url) is only used while it is known to work. One check
// (check(url)) is used everywhere:
// - admin Settings refuses to save a URL that fails it (the exact reason is shown, nothing saved);
// - the outbox worker re-checks the saved URL at start-up and every 6 hours (start());
// - mailer.send() asks usableUrl(): the URL only when the LAST check of exactly that URL passed, otherwise ''
//   (= the inline CID logo). A failing URL therefore never breaks a mail: it falls back automatically.
// - the admin dashboard shows status(): state 'failing' = red "Mail logo URL not reachable" notice.
// A check passes when the URL is https, answers 200 within 5 s, is image/png or image/jpeg, is at most 50 KB,
// and the image is 124x68 or the same 62:34 ratio (the 62x34 header slot, 2x for retina).
// One warning line is logged when a URL starts failing (or fails for a new reason), one line when it works again.
const sharp = require('sharp');
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const LOGO_URL = /^https:\/\/[^\s"'<>]+$/;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 50 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpeg' };
const RATIO = 62 / 34;
const RECHECK_MS = 6 * 60 * 60 * 1000;

let fetchImpl = (...a) => fetch(...a); // tests replace it (setFetch)
let state = { url: '', ok: false, checkedAt: null, reason: null }; // last check
let timer = null;
let inFlight = null;

/** Tests only: replace fetch. null = the real one. */
function setFetch(fn) {
  fetchImpl = fn || ((...a) => fetch(...a));
}

const fail = (reason) => ({ ok: false, reason });

/** { ok: true, width, height, type, bytes } or { ok: false, reason } (a sentence for the admin). Never throws. */
async function check(url, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!LOGO_URL.test(url || '')) return fail('it is not an https:// URL (no spaces or quotes)');
  const ctrl = new AbortController();
  const timer5 = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { Accept: 'image/png,image/jpeg' } });
    } catch (err) {
      if (ctrl.signal.aborted) return fail(`no answer within ${timeoutMs / 1000} s`);
      return fail(`it could not be fetched (${(err.cause && err.cause.code) || err.message})`);
    }
    if (res.status !== 200) return fail(`it answered HTTP ${res.status}, not 200`);
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES[type]) return fail(`its Content-Type is "${type || 'missing'}", not image/png or image/jpeg`);
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_BYTES) return fail(`it is ${Math.ceil(declared / 1024)} KB, more than 50 KB`);
    // Read at most 50 KB + 1 byte, whatever the header said.
    const chunks = [];
    let bytes = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) {
        ctrl.abort();
        return fail('it is more than 50 KB');
      }
      chunks.push(Buffer.from(value));
    }
    let meta;
    try {
      meta = await sharp(Buffer.concat(chunks)).metadata();
    } catch {
      return fail('it is not a readable image');
    }
    if (meta.format !== TYPES[type]) return fail(`it says ${type} but the file is ${meta.format || 'something else'}`);
    const { width, height } = meta;
    const sameRatio = height > 0 && Math.abs(width / height - RATIO) <= RATIO * 0.01;
    if (!(width === 124 && height === 68) && !sameRatio) {
      return fail(`it is ${width}x${height} px; it must be 124x68 (or the same 62:34 ratio)`);
    }
    return { ok: true, width, height, type, bytes };
  } catch (err) {
    if (ctrl.signal.aborted) return fail(`no answer within ${timeoutMs / 1000} s`);
    return fail(`it could not be read (${err.message})`);
  } finally {
    clearTimeout(timer5);
  }
}

/** Store the result of a check of url (also used by admin Settings after a passing save), logging changes. */
function record(url, result) {
  const prev = state;
  state = { url: url || '', ok: Boolean(url && result && result.ok), checkedAt: new Date(), reason: url && result && !result.ok ? result.reason : null };
  if (!url) return state;
  if (!state.ok && (prev.url !== url || prev.ok || prev.reason !== state.reason || !prev.checkedAt)) {
    console.warn(`[mail] logo URL ${url} not usable (${state.reason}); mails use the built-in logo`);
  } else if (state.ok && prev.url === url && !prev.ok && prev.checkedAt) {
    console.log(`[mail] logo URL ${url} works again; mails use it`);
  }
  return state;
}

async function savedUrl() {
  const [[row]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'mail_logo_url'");
  return row ? String(row.setting_value || '').trim() : '';
}

/** Check the saved setting now (start-up, every 6 hours, or when send() sees a URL it has not checked). */
function recheck() {
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const url = await savedUrl();
        return record(url, url ? await check(url) : null);
      } catch (err) {
        console.error('[mail] logo URL check failed:', err.code || err.message);
        return state;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

/** The URL to put in mails, or '' for the inline CID logo. A URL not checked yet starts a check and is not used. */
function usableUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (state.url === u && state.ok) return u;
  if (state.url !== u) recheck().catch(() => {});
  return '';
}

/** For the dashboard: { state: 'off' | 'ok' | 'failing' | 'unchecked', url, reason, checkedAt }. */
function status() {
  const s = !state.url ? 'off' : !state.checkedAt ? 'unchecked' : state.ok ? 'ok' : 'failing';
  return { state: s, url: state.url, reason: state.reason, checkedAt: state.checkedAt };
}

function start() {
  if (timer) return;
  recheck().catch(() => {});
  timer = setInterval(() => { recheck().catch(() => {}); }, RECHECK_MS);
  timer.unref();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { LOGO_URL, MAX_BYTES, check, record, recheck, usableUrl, status, start, stop, setFetch };
