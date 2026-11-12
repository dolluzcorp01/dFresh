// Scenario scripts (phase 23 on): the v23 "Tests" tabs, one file per section (section-NN.js), run through the admin API
// in this process against the LOCAL dev database. Run with `npm run scenarios` (every section) or
// `npm run scenarios -- 12` (one; `-- 12 13` several). The runner dumps the database first, restores that dump before
// every test that says "Start again" (ctx.fresh) and once more at the end, so the dev data is left as it was.
// Needs: .env with DB_NAME (never production), MySQL client tools (MYSQL_BIN, default the MySQL 8.0 folder on Windows).
// No mail leaves: MAIL_ENABLED is forced off here.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
process.env.MAIL_ENABLED = 'false';

const BIN = process.env.MYSQL_BIN || 'C:/Program Files/MySQL/MySQL Server 8.0/bin';
const exe = (n) => path.join(BIN, process.platform === 'win32' ? `${n}.exe` : n);
const DB = process.env.DB_NAME;
function devOnly() {
  if (process.env.NODE_ENV === 'production') throw new Error('Scenario scripts never run with NODE_ENV=production');
  if (!DB || DB === 'dfresh') throw new Error(`Scenario scripts run on a local dev copy only (DB_NAME is "${DB || ''}"; the live database is "dfresh")`);
}
const dbEnv = () => ({ ...process.env, MYSQL_PWD: process.env.DB_PASSWORD });
const dbArgs = () => [`--host=${process.env.DB_HOST || 'localhost'}`, `--port=${process.env.DB_PORT || 3306}`, `--user=${process.env.DB_USER}`];
const run = (file, args, input) => new Promise((res, rej) => {
  const p = execFile(file, args, { env: dbEnv(), maxBuffer: 1 << 30, encoding: 'buffer' }, (e, out, err) => (e ? rej(new Error(`${path.basename(file)}: ${String(err || e.message).slice(0, 400)}`)) : res(out)));
  if (input) { p.stdin.end(input); }
});
/** dump the dev database to a file (async: a timer in the API may run meanwhile) */
async function dump(file) {
  devOnly();
  await run(exe('mysqldump'), [...dbArgs(), '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', `--result-file=${file}`, DB]);
  return fs.statSync(file).size;
}
/** put the dump back exactly: every table is dropped first, so no table made since is left behind */
async function restore(file) {
  devOnly();
  const names = String(await run(exe('mysql'), [...dbArgs(), '-N', '-e', `SELECT table_name FROM information_schema.tables WHERE table_schema = '${DB.replace(/'/g, '')}' AND table_type = 'BASE TABLE'`]))
    .split(/\r?\n/).filter(Boolean);
  const drop = `SET FOREIGN_KEY_CHECKS=0;${names.map((x) => `DROP TABLE IF EXISTS \`${x}\`;`).join('')}SET FOREIGN_KEY_CHECKS=1;\n`;
  await run(exe('mysql'), [...dbArgs(), '--default-character-set=utf8mb4', DB], Buffer.concat([Buffer.from(drop), fs.readFileSync(file)]));
}
const tmpFile = (name) => path.join(os.tmpdir(), `dfresh-scenarios-${process.pid}-${name}`);

// v23's people as ours on the dev data (emp_id is a string, never a number)
const P = { SH: 'DZIND002', PV: 'DZIND148', AN: 'DZIND135', KU: 'DZIND146', DV: 'DZIND147', MU: 'DZIND136', RA: 'DZIND142' };

/** the admin API in this process, signed in as anyone by emp_id */
async function startApi() {
  devOnly();
  const jwt = require('jsonwebtoken');
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { getDBConnection } = require(path.join(ROOT, 'config', 'db'));
  const pool = getDBConnection(DB).promise();
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/dfresh', require(path.join(ROOT, 'src', 'backend_routes', 'Admin_login_server')));
  app.use('/api/dfresh', require(path.join(ROOT, 'src', 'backend_routes', 'Admin_server')));
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  server.keepAliveTimeout = 600000;
  const base = `http://127.0.0.1:${server.address().port}/api/dfresh/admin`;
  const cookie = (as) => `dfresh_admin_token=${jwt.sign({ sub: P[as] || as, app: process.env.ADMIN_APP_KEY || 'dFresh', stage: 'session' }, process.env.JWT_SECRET, { expiresIn: '60m' })}`;
  const parse = async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = null; }
    return { status: r.status, data: j && j.data, msg: j && (j.message || (j.data && j.data.message)), fields: j && (j.fields || (j.data && j.data.fields)), raw: t.slice(0, 600), text: j ? undefined : t, headers: r.headers }; }; // text: a non-JSON body (a CSV) in full
  const api = async (as, method, p, body) => {
    const go = () => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie(as) }, body: body ? JSON.stringify(body) : undefined });
    return parse(await go().catch(() => go()));
  };
  /** multipart: fields + one image file named "file" (a small JPEG made here) */
  let jpeg = null;
  const upload = async (as, p, fields = {}) => {
    if (!jpeg) jpeg = await require(path.join(ROOT, 'node_modules', 'sharp'))({ create: { width: 64, height: 64, channels: 3, background: '#c8b070' } }).jpeg().toBuffer();
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
    return parse(await fetch(`${base}${p}`, { method: 'POST', headers: { Cookie: cookie(as) }, body: fd }));
  };
  const close = async () => { server.close(); await pool.end(); };
  return { pool, api, upload, base, cookie, close };
}

/** the context every section gets: api, db helpers, ok / say, approvals, and the order-to-delivered helpers */
function context(h, counts, freshFn) {
  const { api, pool } = h;
  const say = (...a) => console.log('     ', ...a);
  const ok = (c, what, got) => {
    counts.steps += 1; if (c) counts.pass += 1; else { counts.fail += 1; counts.failed.push(`${counts.test}: ${what}`); }
    console.log(`  ${c ? 'PASS' : 'FAIL'} ${what}${got !== undefined ? ` -> ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`);
  };
  const q1 = async (sql, a = []) => (await pool.query(sql, a))[0][0];
  const qa = async (sql, a = []) => (await pool.query(sql, a))[0];
  const setting = (k, v) => pool.query('UPDATE commerce_settings SET value = ? WHERE setting_key = ?', [String(v), k]);
  const decide = (as, id, decision = 'approved', note = 'scenario') => api(as, 'POST', `/approvals/${id}/decide`, { decision, note });
  // on the dev data a second person with a high enough limit signs (Anitha first, then the Admins)
  const decideAny = async (id, d = 'approved', note = 'scenario') => {
    let r; for (const as of ['AN', 'PV', 'SH']) { r = await decide(as, id, d, note); if (r.status === 200) return r; }
    say(`(nobody could decide #${id}: ${r.status} ${r.msg})`); return r;
  };
  const pendingOf = (kind, ref) => q1(`SELECT approval_id, summary, requested_by FROM approvals WHERE kind = ? AND status = 'pending'${ref !== undefined ? ' AND ref_id = ?' : ''} ORDER BY approval_id DESC LIMIT 1`, ref !== undefined ? [kind, String(ref)] : [kind]);
  const approveAll = async (ref) => { for (const x of await qa("SELECT approval_id FROM approvals WHERE ref_id = ? AND status = 'pending'", [String(ref)])) await decideAny(x.approval_id); };
  const lines = async (no) => (await api('SH', 'GET', `/fulfil/packing/${no}`)).data.lines;
  const scanAll = async (no) => { for (const l of await lines(no)) if (l.need > 0) await api('SH', 'POST', `/commerce/packing/${no}/scan`, { code: l.batch_no ? `${l.sku_code}/${l.batch_no}` : l.sku_code, n: l.need }); };
  /** a new order (its approvals signed) -> order_no */
  const order = async (cid, items, extra = {}, as = 'SH') => {
    const r = await api(as, 'POST', '/commerce/orders', { customer_id: cid, items, ...extra });
    if (r.status >= 300) { say('order:', r.status, r.msg); return null; }
    if (r.data.status !== 'new') for (const a of r.data.approvals || []) await decideAny(a);
    return r.data.order_no;
  };
  const packed = async (cid, items, extra = {}) => {
    const no = await order(cid, items, extra); if (!no) return null;
    const p = await api('SH', 'POST', '/fulfil/pick-lists', { order_nos: [no] }); if (p.status >= 300) say('pick:', p.status, p.msg);
    await scanAll(no);
    const d = await api('SH', 'POST', `/commerce/packing/${no}/packed`, { cartons: 1, weight_kg: '3' }); if (d.status >= 300) say('packed:', d.status, d.msg);
    return no;
  };
  /** packed, invoiced, on a trip, delivered -> { no, invoice_no, trip_id } */
  const delivered = async (cid, items, extra = {}) => {
    const no = await packed(cid, items, extra); if (!no) return null;
    const iv = await api('SH', 'POST', '/billing/invoices', { order_no: no }); if (iv.status >= 300) say('invoice:', iv.status, iv.msg);
    const t = await api('SH', 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [no] }); if (t.status >= 300) say('trip:', t.status, t.msg);
    await api('SH', 'POST', `/commerce/trips/${t.data.trip_id}/start`);
    const trip = (await api('SH', 'GET', `/commerce/trips/${t.data.trip_id}`)).data;
    const st = trip.stops.find((x) => x.order_no === no) || trip.stops[0];
    const otp = (await q1('SELECT otp FROM trip_stops WHERE stop_id = ?', [st.stop_id])).otp;
    const d = await api('SH', 'POST', `/commerce/stops/${st.stop_id}/delivered`, { receiver_name: 'Scenario', otp, signed: '1' });
    if (d.status >= 300) say('delivered:', d.status, d.msg);
    return { no, invoice_no: iv.data && iv.data.invoice_no, trip_id: t.data.trip_id };
  };
  const backdate = (no, days) => pool.query('UPDATE orders SET delivered_at = DATE_SUB(delivered_at, INTERVAL ? DAY) WHERE order_no = ?', [days, no]);
  const owes = async (cid) => (await api('SH', 'GET', `/money/receipt-form?customer_id=${cid}`)).data.customer.owes;
  const shelf = async (sku, kind, g = 1) => Number((await q1('SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code = ? AND location_id = ? AND stock_kind = ?', [sku, g, kind])).n);
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const T = (id, title) => { counts.test = id; console.log(`\n  ${id} ${title}`); };
  return { ...h, say, ok, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh: freshFn, P,
    enc: encodeURIComponent, today: () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) };
}

module.exports = { ROOT, P, devOnly, dump, restore, tmpFile, startApi, context };
