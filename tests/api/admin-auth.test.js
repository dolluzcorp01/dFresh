// Admin API roles and sessions against the LOCAL dev database (spec F, phase 7 acceptance).
// Run: npm run test:api   (needs a seeded DB: npm run db:reset)
// Temporary admin_users rows ZZU-VIEW / ZZU-EDIT / ZZU-ADMIN get session cookies signed here with JWT_SECRET
// (the e-mailed code step is not part of this test); they and their audit rows are removed afterwards.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const APP = process.env.ADMIN_APP_KEY || 'dFresh';
const USERS = { viewer: 'ZZU-VIEW', editor: 'ZZU-EDIT', admin: 'ZZU-ADMIN' };
let base;
let server;

const token = (sub, extra = {}) => jwt.sign({ sub, app: APP, stage: 'session', ...extra }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function call(method, path, { as, cookie, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Cookie = `${COOKIE}=${token(USERS[as])}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}/api/dfresh${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function cleanup() {
  const ids = Object.values(USERS);
  await db.query(`DELETE FROM audit_log WHERE emp_id IN (${ids.map(() => '?').join(', ')})`, ids);
  await db.query(`DELETE FROM admin_users WHERE emp_id IN (${ids.map(() => '?').join(', ')})`, ids);
}

before(async () => {
  await cleanup();
  for (const [role, id] of Object.entries(USERS)) {
    await db.query("INSERT INTO admin_users (emp_id, role, is_active, created_by) VALUES (?, ?, 1, 'test')", [id, role]);
  }
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/dfresh', require('../../src/backend_routes/Admin_login_server'));
  app.use('/api/dfresh', require('../../src/backend_routes/Admin_server'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await cleanup();
  server.close();
  await db.end();
});

test('no cookie, a challenge token or a token of another app is never a session', async () => {
  assert.equal((await call('GET', '/admin/me')).status, 401);
  const challenge = jwt.sign({ sub: USERS.admin, app: APP, stage: 'otp' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  assert.equal((await call('GET', '/admin/me', { cookie: `${COOKIE}=${challenge}` })).status, 401);
  const other = jwt.sign({ sub: USERS.admin, app: 'dAdmin', stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  assert.equal((await call('GET', '/admin/me', { cookie: `${COOKIE}=${other}` })).status, 401);
  const forged = jwt.sign({ sub: USERS.admin, app: APP, stage: 'session' }, 'not-the-secret', { expiresIn: '5m' });
  assert.equal((await call('GET', '/admin/dashboard', { cookie: `${COOKIE}=${forged}` })).status, 401);
  const me = await call('GET', '/admin/me', { as: 'admin' });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.role, 'admin');
});

test('code step: no challenge or no live code sends the user back to sign in (resend too)', async () => {
  for (const path of ['/admin/login/verify', '/admin/login/resend']) {
    const none = await call('POST', path, { body: { code: '123456' } });
    assert.equal(none.status, 401, `${path} without challenge`);
    assert.equal(none.json.data.restart, true);
    assert.match(none.json.message, /timed out\. Sign in again/);
    // A valid challenge for an employee with no login_otp row (ZZU-ADMIN never got a code): read-only on dadmin.
    const challenge = jwt.sign({ sub: USERS.admin, app: APP, stage: 'otp' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const stale = await call('POST', path, { cookie: `${COOKIE}_otp=${challenge}`, body: { code: '123456' } });
    assert.equal(stale.status, 401, `${path} without a code row`);
    assert.equal(stale.json.data.restart, true);
    assert.match(stale.json.message, /expired\. Sign in again/);
  }
});

test('viewer reads but every write is 403 from the API', async () => {
  assert.equal((await call('GET', '/admin/leads', { as: 'viewer' })).status, 200);
  assert.equal((await call('GET', '/admin/products', { as: 'viewer' })).status, 200);
  assert.equal((await call('GET', '/admin/dashboard', { as: 'viewer' })).status, 200);
  const writes = [
    ['PUT', '/admin/categories/napkins', { sort_order: 1 }],
    ['POST', '/admin/products', {}],
    ['DELETE', '/admin/kits/hotels'],
    ['PUT', '/admin/ui-text/back/en', { value: 'x' }],
    ['PATCH', '/admin/leads/1', { status: 'won' }],
    ['POST', '/admin/outbox/mail/1/retry'],
    ['POST', '/admin/products/import?dryRun=1'],
    ['GET', '/admin/products/export.xlsx'],
    ['GET', '/admin/leads/export.csv'],
    ['PUT', '/admin/settings/company_name', { value: 'x' }],
    ['POST', '/admin/languages', { lang_code: 'zz' }],
    ['POST', '/admin/users', { emp_id: 'X', role: 'viewer' }],
    ['GET', '/admin/audit'],
  ];
  for (const [m, p, b] of writes) {
    const r = await call(m, p, { as: 'viewer', body: b });
    assert.equal(r.status, 403, `${m} ${p} -> ${r.status}`);
  }
});

test('editor writes content but not settings, users, languages or the Excel import', async () => {
  const cat = await call('GET', '/admin/categories/napkins', { as: 'editor' });
  assert.equal(cat.status, 200);
  const put = await call('PUT', '/admin/categories/napkins', { as: 'editor', body: { sort_order: cat.json.data.sort_order } });
  assert.equal(put.status, 200);
  for (const [m, p, b] of [
    ['PUT', '/admin/settings/company_name', { value: 'x' }],
    ['GET', '/admin/settings'],
    ['POST', '/admin/users', { emp_id: 'X', role: 'viewer' }],
    ['PUT', '/admin/users/DZIND148', { role: 'viewer' }],
    ['POST', '/admin/languages', { lang_code: 'zz' }],
    ['PUT', '/admin/languages/ta', { sort_order: 2 }],
    ['DELETE', '/admin/languages/hi'],
    ['POST', '/admin/products/import?dryRun=1'],
  ]) {
    const r = await call(m, p, { as: 'editor', body: b });
    assert.equal(r.status, 403, `${m} ${p} -> ${r.status}`);
  }
  const [[a]] = await db.query("SELECT action, entity_type, entity_id FROM audit_log WHERE emp_id = ? ORDER BY audit_id DESC LIMIT 1", [USERS.editor]);
  assert.deepEqual({ ...a }, { action: 'update', entity_type: 'category', entity_id: 'napkins' });
});

test('a deactivated admin user loses access at once', async () => {
  await db.query('UPDATE admin_users SET is_active = 0 WHERE emp_id = ?', [USERS.viewer]);
  assert.equal((await call('GET', '/admin/leads', { as: 'viewer' })).status, 401);
  await db.query('UPDATE admin_users SET is_active = 1 WHERE emp_id = ?', [USERS.viewer]);
});

test('bad input is a 400 with a message, never a 500', async () => {
  const r = await call('PUT', '/admin/categories/napkins', { as: 'editor', body: { sort_order: 'abc' } });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /sort_order/);
  const t = await call('PUT', '/admin/categories/napkins', { as: 'editor', body: { tr: { en: { name: '' } } } });
  assert.equal(t.status, 400);
  const nf = await call('GET', '/admin/kits/nope', { as: 'viewer' });
  assert.equal(nf.status, 404);
});

test('admin setting mail_logo_url: https URL or empty only; a bad value is refused and nothing is saved', async () => {
  const [[row]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'mail_logo_url'");
  for (const bad of ['http://a.example/l.png', 'https://a.example/l .png', 'javascript:alert(1)']) {
    const r = await call('PUT', '/admin/settings/mail_logo_url', { as: 'admin', body: { value: bad } });
    assert.equal(r.status, 400, bad);
    assert.match(r.json.message, /https:\/\/ URL/);
  }
  assert.equal((await call('PUT', '/admin/settings/mail_logo_url', { as: 'editor', body: { value: '' } })).status, 403);
  const [[after]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'mail_logo_url'");
  assert.equal(after.setting_value, row.setting_value);
});

// ---- mail logo safety (fake fetch / fake transport; mail_logo_url and the test rows restored) ----
const mailLogo = () => {
  const fsx = require('fs');
  const pathx = require('path');
  return fsx.readFileSync(pathx.join(__dirname, '..', '..', 'src', 'backend_routes', 'mail-logo.png'));
};
const logoReply = (body, type = 'image/png', status = 200) => async () => new Response(body, { status, headers: { 'content-type': type } });

test('saving mail_logo_url fetches it first: refused with the exact reason (nothing saved) or saved and shown as working', async () => {
  const logoCheck = require('../../src/backend_routes/mail-logo-check');
  const [[row]] = await db.query("SELECT setting_value, updated_by, updated_at FROM site_settings WHERE setting_key = 'mail_logo_url'");
  const URL = 'https://logo.example/media/mail/dfresh-mail-logo.png';
  try {
    logoCheck.setFetch(logoReply('gone', 'text/html', 404));
    const bad = await call('PUT', '/admin/settings/mail_logo_url', { as: 'admin', body: { value: URL } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.message, 'Logo URL not saved: it answered HTTP 404, not 200.');
    const [[still]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'mail_logo_url'");
    assert.equal(still.setting_value, row.setting_value);

    logoCheck.setFetch(logoReply(mailLogo()));
    const ok = await call('PUT', '/admin/settings/mail_logo_url', { as: 'admin', body: { value: URL } });
    assert.equal(ok.status, 200);
    assert.equal((await call('GET', '/admin/mail-logo', { as: 'admin' })).json.data.state, 'ok');
    assert.equal((await call('GET', '/admin/dashboard', { as: 'viewer' })).json.data.mailLogo.state, 'ok');

    // The 6-hourly re-check finds it down: the dashboard shows it (red notice in the admin) until it works.
    logoCheck.record(URL, { ok: false, reason: 'no answer within 5 s' });
    const dash = (await call('GET', '/admin/dashboard', { as: 'viewer' })).json.data.mailLogo;
    assert.deepEqual([dash.state, dash.reason, dash.url], ['failing', 'no answer within 5 s', URL]);

    const off = await call('PUT', '/admin/settings/mail_logo_url', { as: 'admin', body: { value: '' } });
    assert.equal(off.status, 200);
    assert.equal((await call('GET', '/admin/dashboard', { as: 'viewer' })).json.data.mailLogo.state, 'off');
  } finally {
    logoCheck.setFetch(null);
    // Value AND who / when: the admin Settings page shows "Changed ... by", which must not say ZZU-ADMIN.
    await db.query("UPDATE site_settings SET setting_value = ?, updated_by = ?, updated_at = ? WHERE setting_key = 'mail_logo_url'",
      [row.setting_value, row.updated_by, row.updated_at]);
    logoCheck.record('', null);
  }
});

test('built-in logo preview: admin only, the 124x68 PNG', async () => {
  const get = (as) => fetch(`${base}/api/dfresh/admin/mail-logo/builtin.png`, { headers: { Cookie: `${COOKIE}=${token(USERS[as])}` } });
  const r = await get('admin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [124, 68]);
  assert.equal((await get('editor')).status, 403);
});

test('"Send test mail": through the outbox to MAIL_TEST_TO locally (admin\'s own e-mail in production); refused clearly when mail is off', async () => {
  const mailer = require('../../src/backend_routes/mailer');
  const keep = { MAIL_ENABLED: process.env.MAIL_ENABLED, NODE_ENV: process.env.NODE_ENV, MAIL_TEST_TO: process.env.MAIL_TEST_TO };
  const [[{ m: before }]] = await db.query('SELECT COALESCE(MAX(mail_id), 0) AS m FROM mail_outbox');
  const sent = [];
  try {
    process.env.MAIL_TEST_TO = 'test-inbox@example.com';
    process.env.MAIL_ENABLED = 'false';
    const off = await call('POST', '/admin/mail-logo/test-mail', { as: 'admin' });
    assert.equal(off.status, 503);
    assert.equal(off.json.message, 'Test mail not sent: e-mail is switched off on this server');

    process.env.MAIL_ENABLED = 'true';
    mailer.setTransport(async (msg) => { sent.push(msg); return { id: 'fake-test' }; });
    const ok = await call('POST', '/admin/mail-logo/test-mail', { as: 'admin' });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.json.data.to, ok.json.data.logo, ok.json.data.provider_id], ['test-inbox@example.com', 'builtin', 'fake-test']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'test-inbox@example.com');
    assert.match(sent[0].text, /Logo used: the built-in logo/);
    assert.equal((await call('POST', '/admin/mail-logo/test-mail', { as: 'editor' })).status, 403);

    // Production: the signed-in admin's own dAdmin e-mail (ZZU-ADMIN has none, so it says so).
    process.env.NODE_ENV = 'production';
    const prod = await call('POST', '/admin/mail-logo/test-mail', { as: 'admin' });
    assert.equal(prod.status, 400);
    assert.equal(prod.json.message, 'Your dAdmin account has no e-mail address');

    const [rows] = await db.query("SELECT purpose, status FROM mail_outbox WHERE mail_id > ? AND purpose = 'logo_test' ORDER BY mail_id", [before]);
    assert.deepEqual(rows.map((r) => r.status), ['cancelled', 'sent']);
  } finally {
    Object.assign(process.env, keep);
    mailer.setTransport(null);
    await db.query("DELETE FROM mail_outbox WHERE mail_id > ? AND purpose = 'logo_test'", [before]);
  }
});
