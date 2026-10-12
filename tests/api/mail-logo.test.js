// Hosted e-mail logo safety (mail-logo-check.js): the URL check (200, type, size, dimensions, 5 s timeout),
// the automatic fallback to the built-in logo, the one-line warnings and the dashboard state, against the LOCAL
// dev database with a fake fetch (nothing goes to the network) and a fake mail transport.
// site_settings.mail_logo_url is restored afterwards.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getDBConnection } = require('../../config/db');
const logoCheck = require('../../src/backend_routes/mail-logo-check');
const mailer = require('../../src/backend_routes/mailer');

// The worker pass started below must never send or sync anything.
process.env.MAIL_ENABLED = 'false';
process.env.GSHEET_ENABLED = 'false';

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const LOGO = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'backend_routes', 'mail-logo.png')); // 124x68 PNG
const URL = 'https://logo.example/media/mail/dfresh-mail-logo.png';
let saved;

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#121214' } }).jpeg().toBuffer();
const reply = (body, type = 'image/png', status = 200, headers = {}) => async () => new Response(body, {
  status, headers: { 'content-type': type, ...headers },
});

async function capture(fn) {
  const lines = [];
  const { log, warn, error } = console;
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    await fn();
  } finally {
    Object.assign(console, { log, warn, error });
  }
  return lines;
}

before(async () => {
  [[saved]] = await db.query("SELECT setting_value, updated_by, updated_at FROM site_settings WHERE setting_key = 'mail_logo_url'");
});

after(async () => {
  logoCheck.setFetch(null);
  mailer.setTransport(null);
  await db.query("UPDATE site_settings SET setting_value = ?, updated_by = ?, updated_at = ? WHERE setting_key = 'mail_logo_url'",
    [saved.setting_value, saved.updated_by, saved.updated_at]);
  logoCheck.record('', null);
  await db.end();
});

test('check passes: 200, image/png 124x68, the same 62:34 ratio (248x136), image/jpeg', async () => {
  for (const [body, type, size] of [[LOGO, 'image/png', '124x68'], [await png(248, 136), 'image/png', '248x136'], [await jpeg(124, 68), 'image/jpeg; charset=binary', '124x68']]) {
    logoCheck.setFetch(reply(body, type));
    const r = await logoCheck.check(URL);
    assert.equal(r.ok, true, `${type} ${size}: ${r.reason}`);
    assert.equal(`${r.width}x${r.height}`, size);
  }
});

test('check refuses with the exact reason: not https, HTTP status, type, size, dimensions, wrong file, timeout', async () => {
  const cases = [
    ['http://logo.example/l.png', reply(LOGO), /not an https:\/\/ URL/],
    [URL, reply('nope', 'text/html', 404), /answered HTTP 404, not 200/],
    [URL, reply('<html>', 'text/html'), /Content-Type is "text\/html", not image\/png or image\/jpeg/],
    [URL, reply(LOGO, 'image/png', 200, { 'content-length': String(60 * 1024) }), /is 60 KB, more than 50 KB/],
    [URL, reply(Buffer.concat([LOGO, Buffer.alloc(51 * 1024)])), /more than 50 KB/],
    [URL, reply(await png(100, 100)), /is 100x100 px; it must be 124x68 \(or the same 62:34 ratio\)/],
    [URL, reply(await jpeg(124, 68), 'image/png'), /says image\/png but the file is jpeg/],
    [URL, reply(Buffer.from('not an image')), /not a readable image/],
    [URL, async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }, /could not be fetched \(ENOTFOUND\)/],
  ];
  for (const [url, fake, reason] of cases) {
    logoCheck.setFetch(fake);
    const r = await logoCheck.check(url);
    assert.equal(r.ok, false, String(reason));
    assert.match(r.reason, reason);
  }
  // A server that never answers: aborted after the timeout (5 s in use; 100 ms here).
  logoCheck.setFetch((u, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))));
  const t0 = Date.now();
  const r = await logoCheck.check(URL, { timeoutMs: 100 });
  assert.match(r.reason, /no answer within 0.1 s/);
  assert.ok(Date.now() - t0 < 2000);
});

test('fallback: a URL is used only while its last check passed; one warning line when it fails, one when it works again', async () => {
  let lines = await capture(() => { logoCheck.record(URL, { ok: true }); });
  assert.equal(logoCheck.usableUrl(URL), URL);
  assert.equal(logoCheck.status().state, 'ok');

  lines = await capture(() => {
    logoCheck.record(URL, { ok: false, reason: 'it answered HTTP 503, not 200' });
    logoCheck.record(URL, { ok: false, reason: 'it answered HTTP 503, not 200' }); // still failing: no second line
  });
  assert.deepEqual(lines, [`[mail] logo URL ${URL} not usable (it answered HTTP 503, not 200); mails use the built-in logo`]);
  assert.equal(logoCheck.usableUrl(URL), '');
  assert.equal(logoCheck.status().state, 'failing');
  assert.equal(logoCheck.status().reason, 'it answered HTTP 503, not 200');

  lines = await capture(() => { logoCheck.record(URL, { ok: true }); });
  assert.deepEqual(lines, [`[mail] logo URL ${URL} works again; mails use it`]);
  assert.equal(logoCheck.usableUrl(URL), URL);
  assert.equal(logoCheck.usableUrl(''), '');
});

test('recheck (start-up / every 6 hours) reads the saved setting; send() falls back to the inline CID logo while it fails', async () => {
  await db.query("UPDATE site_settings SET setting_value = ? WHERE setting_key = 'mail_logo_url'", [URL]);
  const sent = [];
  mailer.setTransport(async (msg) => { sent.push(msg); return { id: 'fake' }; });
  const view = mailer.renderLoginCode({ name: 'T', code: '123456', minutes: 10, companyName: 'D' });

  logoCheck.setFetch(reply('down', 'text/plain', 502));
  await capture(() => logoCheck.recheck());
  assert.equal(logoCheck.status().state, 'failing');
  await mailer.send({ to: 'obx@example.com', subject: view.subject, html: view.html, text: view.text });

  logoCheck.setFetch(reply(LOGO));
  await capture(() => logoCheck.recheck());
  assert.equal(logoCheck.status().state, 'ok');
  await mailer.send({ to: 'obx@example.com', subject: view.subject, html: view.html, text: view.text });

  assert.ok(sent[0].html.includes(`src="${mailer.LOGO_SRC}"`), 'failing URL: built-in logo');
  assert.equal(sent[0].attachments.length, 1);
  assert.ok(sent[1].html.includes(`<img src="${URL}" alt="dFresh"`), 'working URL: hosted logo');
  assert.equal(sent[1].attachments, undefined);
});

test('a URL saved by hand in the DB and never checked is not used until a check passed', async () => {
  const other = 'https://other.example/l.png';
  await db.query("UPDATE site_settings SET setting_value = ? WHERE setting_key = 'mail_logo_url'", [other]);
  logoCheck.setFetch(reply(LOGO));
  await capture(async () => {
    assert.equal(logoCheck.usableUrl(other), ''); // starts a check
    await logoCheck.recheck();
  });
  assert.equal(logoCheck.usableUrl(other), other);
});

test('the outbox worker checks the saved URL at start-up (then every 6 hours) and stops the timer with it', async () => {
  const worker = require('../../src/backend_routes/outbox-worker');
  await db.query("UPDATE site_settings SET setting_value = ? WHERE setting_key = 'mail_logo_url'", [URL]);
  logoCheck.record('', null);
  logoCheck.setFetch(reply('gone', 'text/html', 404));
  const lines = await capture(async () => {
    worker.start();
    await logoCheck.recheck(); // the start-up check already in flight
    worker.stop();
  });
  assert.equal(logoCheck.status().state, 'failing');
  assert.ok(lines.includes(`[mail] logo URL ${URL} not usable (it answered HTTP 404, not 200); mails use the built-in logo`), lines.join(' | '));
});
