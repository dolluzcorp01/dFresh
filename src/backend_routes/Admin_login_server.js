// Admin sign-in (spec F, Inside D pattern): /api/dfresh/admin/login, /login/verify, /logout, /me.
// 1. POST /admin/login { email, password }: dadmin.employee (not deleted) + bcrypt, and the emp_id must be an
//    active dfresh.admin_users row. A 6-digit code is bcrypt-hashed into dadmin.login_otp (app_key dFresh, one
//    row per employee, 10 min, 5 tries) and e-mailed through the outbox; a challenge cookie is set.
//    Wrong e-mail, wrong password and "not a dFresh admin" all get the same 401, so the form reveals nothing.
//    Outside production, when mail cannot be sent, the code is printed to the server console (Inside D).
// 2. POST /admin/login/verify { code } with the challenge cookie -> session cookie; the code row is deleted.
// Password tries are limited per e-mail + IP in memory (10 per 15 minutes).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { getDBConnection } = require('../../config/db');
const auth = require('./auth');
const mailer = require('./mailer');
const outboxWorker = require('./outbox-worker');
const { audit } = require('./audit');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const isProd = process.env.NODE_ENV === 'production';
const CODE_MIN = 10;
const CODE_TRIES = 5;
const PW_TRIES = 10;
const PW_WINDOW_MS = 15 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const failures = new Map(); // `${email}|${ip}` -> [timestamps]

function throttled(key) {
  const now = Date.now();
  const recent = (failures.get(key) || []).filter((t) => now - t < PW_WINDOW_MS);
  if (recent.length) failures.set(key, recent);
  else failures.delete(key);
  return recent.length >= PW_TRIES;
}

function noteFailure(key) {
  failures.set(key, [...(failures.get(key) || []), Date.now()]);
}

const deny = (res) => res.status(401).json({ success: false, message: 'E-mail or password is not correct' });

router.post('/admin/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL.test(email) || !password || password.length > 200) return deny(res);
  const key = `${email}|${req.ip}`;
  if (throttled(key)) return res.status(429).json({ success: false, message: 'Too many tries. Wait 15 minutes and try again.' });

  try {
    const [[emp]] = await db.query(
      `SELECT emp_id, emp_first_name, emp_last_name, emp_mail_id, account_pass
         FROM \`${auth.DADMIN}\`.employee WHERE LOWER(emp_mail_id) = ? AND deleted_time IS NULL LIMIT 1`,
      [email]
    );
    const ok = emp && emp.account_pass && await bcrypt.compare(password, emp.account_pass);
    if (!ok) {
      noteFailure(key);
      return deny(res);
    }
    const [[user]] = await db.query('SELECT role FROM admin_users WHERE emp_id = ? AND is_active = 1', [emp.emp_id]);
    if (!user) {
      noteFailure(key);
      return deny(res);
    }
    failures.delete(key);

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await db.query(
      `INSERT INTO \`${auth.DADMIN}\`.login_otp (app_key, emp_id, email, otp_hash, expires_at, attempts)
       VALUES (?, ?, ?, ?, NOW() + INTERVAL ? MINUTE, 0)
       ON DUPLICATE KEY UPDATE email = VALUES(email), otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), attempts = 0`,
      [auth.APP_KEY, emp.emp_id, emp.emp_mail_id, await bcrypt.hash(code, 10), CODE_MIN]
    );
    const [[company]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'company_name'");
    const m = mailer.renderLoginCode({
      name: emp.emp_first_name || emp.emp_id, code, minutes: CODE_MIN, companyName: company ? company.setting_value : '',
    });
    await db.query(
      "INSERT INTO mail_outbox (to_email, subject, html_body, text_body, purpose) VALUES (?, ?, ?, ?, 'admin_otp')",
      [emp.emp_mail_id, m.subject, m.html, m.text]
    );
    const ready = mailer.readiness();
    if (ready.ok) outboxWorker.tick(); // send now instead of on the next 15 s pass
    else if (!isProd) console.log(`[dev] admin sign-in code for ${emp.emp_id}: ${code} (mail not sent: ${ready.reason})`);

    auth.setChallenge(res, emp.emp_id);
    const [local, domain] = emp.emp_mail_id.split('@');
    return res.json({ success: true, data: { sentTo: `${local.slice(0, 2)}***@${domain}` } });
  } catch (err) {
    console.error('admin login failed:', err.code || err.message);
    return res.status(500).json({ success: false, message: 'Sign-in is not available right now' });
  }
});

router.post('/admin/login/verify', async (req, res) => {
  const challenge = auth.readChallenge(req);
  if (!challenge) return res.status(401).json({ success: false, message: 'The code expired. Sign in again.' });
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  try {
    const [[row]] = await db.query(
      `SELECT otp_hash, attempts, expires_at > NOW() AS live FROM \`${auth.DADMIN}\`.login_otp WHERE app_key = ? AND emp_id = ?`,
      [auth.APP_KEY, challenge.sub]
    );
    if (!row || !Number(row.live) || row.attempts >= CODE_TRIES) {
      return res.status(401).json({ success: false, message: 'The code expired. Sign in again.' });
    }
    if (!/^\d{6}$/.test(code) || !(await bcrypt.compare(code, row.otp_hash))) {
      await db.query(
        `UPDATE \`${auth.DADMIN}\`.login_otp SET attempts = attempts + 1 WHERE app_key = ? AND emp_id = ?`,
        [auth.APP_KEY, challenge.sub]
      );
      const left = CODE_TRIES - row.attempts - 1;
      return res.status(401).json({ success: false, message: left > 0 ? `Wrong code. ${left} tries left.` : 'Wrong code. Sign in again.' });
    }
    const [[user]] = await db.query('SELECT role FROM admin_users WHERE emp_id = ? AND is_active = 1', [challenge.sub]);
    if (!user) return res.status(401).json({ success: false, message: 'E-mail or password is not correct' });
    await db.query(`DELETE FROM \`${auth.DADMIN}\`.login_otp WHERE app_key = ? AND emp_id = ?`, [auth.APP_KEY, challenge.sub]);
    auth.startSession(res, challenge.sub);
    await audit(null, { empId: challenge.sub, action: 'login', entity: 'admin_user', entityId: challenge.sub });
    return res.json({ success: true, data: { emp_id: challenge.sub, role: user.role } });
  } catch (err) {
    console.error('admin code check failed:', err.code || err.message);
    return res.status(500).json({ success: false, message: 'Sign-in is not available right now' });
  }
});

router.post('/admin/logout', (req, res) => {
  auth.endSession(res);
  res.json({ success: true, data: null });
});

router.get('/admin/me', auth.requireAuth, async (req, res) => {
  try {
    const [[emp]] = await db.query(
      `SELECT emp_first_name, emp_last_name FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ?`, [req.admin.emp_id]
    );
    const name = emp ? [emp.emp_first_name, emp.emp_last_name].filter(Boolean).join(' ') : req.admin.emp_id;
    res.json({ success: true, data: { ...req.admin, name } });
  } catch (err) {
    console.error('admin me failed:', err.code || err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
