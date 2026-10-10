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
