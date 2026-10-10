// Sign-in code truthfulness (issueCode): the code step may only claim "we sent a code" when the mail really
// went out. Against the LOCAL dev database with a fake transport (never SendGrid) and a fake employee id
// ZZU-MAIL (its dadmin.login_otp row and mail_outbox rows are removed afterwards; dadmin.employee is not touched).
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const DADMIN = process.env.DADMIN_DB_NAME || 'dadmin';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const EMP = { emp_id: 'ZZU-MAIL', emp_first_name: 'Test', emp_mail_id: 'zzu-mail@example.com' };
const ENV = { NODE_ENV: process.env.NODE_ENV, MAIL_ENABLED: process.env.MAIL_ENABLED };

// Fresh copies of the route modules for an environment (isProd is read when a module loads).
function load(env, transport) {
  Object.assign(process.env, env);
  const dir = path.resolve(__dirname, '../../src/backend_routes');
  for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
  require(path.join(dir, 'mailer')).setTransport(transport);
  return require(path.join(dir, 'Admin_login_server')).issueCode;
}

async function capture(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = log;
    console.error = error;
  }
}

const otpRow = async () => (await db.query(`SELECT emp_id FROM \`${DADMIN}\`.login_otp WHERE app_key = ? AND emp_id = ?`, [APP, EMP.emp_id]))[0][0];
const lastMail = async () => (await db.query(
  'SELECT mail_id, status, subject, html_body, text_body FROM mail_outbox WHERE to_email = ? ORDER BY mail_id DESC LIMIT 1', [EMP.emp_mail_id]
))[0][0];

async function cleanup() {
  await db.query(`DELETE FROM \`${DADMIN}\`.login_otp WHERE app_key = ? AND emp_id = ?`, [APP, EMP.emp_id]);
  await db.query('DELETE FROM mail_outbox WHERE to_email = ?', [EMP.emp_mail_id]);
}

after(async () => {
  await cleanup();
  Object.assign(process.env, ENV);
  await db.end();
});

const fail = async () => { throw new Error('SendGrid is down'); };

test('development, mail off: code step opens, says e-mail is switched off, code only in the [dev] line', async () => {
  await cleanup();
  const issueCode = load({ NODE_ENV: 'development', MAIL_ENABLED: 'false' }, null);
  const { result, lines } = await capture(() => issueCode(EMP));
  assert.deepEqual(result, { ok: true, sentTo: 'zz***@example.com', mail: 'off', mailNote: 'E-mail is switched off on this server' });
  assert.ok(lines.some((l) => /^\[mail\] #\d+ admin_otp from \S+ to zzu-mail@example\.com.* -> queued \(mail off\)$/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^\[dev\] admin sign-in code for ZZU-MAIL: \d{6} /.test(l)));
  assert.ok(await otpRow());
});

test('development, send fails: code step opens and says the e-mail could not be sent', async () => {
  await cleanup();
  const issueCode = load({ NODE_ENV: 'development', MAIL_ENABLED: 'true' }, fail);
  const { result, lines } = await capture(() => issueCode(EMP));
  assert.equal(result.ok, true);
  assert.equal(result.mail, 'failed');
  assert.match(result.mailNote, /^The code e-mail could not be sent \(SendGrid is down\)$/);
  assert.ok(lines.some((l) => /-> failed SendGrid is down/.test(l)));
});

test('production, send fails: error, no code stored, mail row cancelled and wiped, code never printed', async () => {
  await cleanup();
  const issueCode = load({ NODE_ENV: 'production', MAIL_ENABLED: 'true' }, fail);
  const { result, lines } = await capture(() => issueCode(EMP));
  assert.equal(result.ok, false);
  assert.match(result.message, /^We could not e-mail your sign-in code/);
  assert.equal(await otpRow(), undefined);
  const m = await lastMail();
  assert.equal(m.status, 'cancelled');
  assert.deepEqual([m.html_body, m.text_body], ['-', '-']);
  assert.ok(!/\d{6}/.test(m.subject));
  assert.ok(!lines.some((l) => l.startsWith('[dev]')));
});

test('production, mail off: error, the code step never opens', async () => {
  await cleanup();
  const issueCode = load({ NODE_ENV: 'production', MAIL_ENABLED: 'false' }, null);
  const { result } = await capture(() => issueCode(EMP));
  assert.equal(result.ok, false);
  assert.equal(await otpRow(), undefined);
  assert.equal((await lastMail()).status, 'cancelled');
});

test('production, sent: code step opens with mail "sent", code stored, mail body wiped after sending', async () => {
  await cleanup();
  const issueCode = load({ NODE_ENV: 'production', MAIL_ENABLED: 'true' }, async () => ({ id: 'fake-sg' }));
  const { result, lines } = await capture(() => issueCode(EMP));
  assert.deepEqual(result, { ok: true, sentTo: 'zz***@example.com', mail: 'sent' });
  assert.ok(await otpRow());
  const m = await lastMail();
  assert.equal(m.status, 'sent');
  assert.equal(m.text_body, '-');
  assert.ok(lines.some((l) => / -> sent fake-sg$/.test(l)));
  assert.ok(!lines.some((l) => l.startsWith('[dev]')));
});
