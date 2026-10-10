// Admin sign-in (spec F, Inside D pattern): /api/dfresh/admin/login, /login/verify, /logout, /me.
// 1. POST /admin/login { email, password }: dadmin.employee (not deleted) + bcrypt, and the emp_id must be an
//    active dfresh.admin_users row. A 6-digit code is bcrypt-hashed into dadmin.login_otp (app_key dFresh, one
//    row per employee, 10 min, 5 tries) and e-mailed through the outbox AT ONCE; a challenge cookie is set.
//    The answer says whether the mail really went out (data.mail 'sent' | 'off' | 'failed'). Production: a code
//    that could not be sent is a 503 and the code step never opens. Outside production the code step opens
//    anyway, says why no mail came (data.mailNote) and the code is printed to the server console (Inside D).
//    Wrong e-mail, wrong password and "not a dFresh admin" all get the same 401, so the form reveals nothing.
// 2. POST /admin/login/verify { code } with the challenge cookie -> session cookie; the code row is deleted.
// 3. POST /admin/login/resend with the challenge cookie: a new code (the old one stops working), at most one per
//    30 s and 3 per employee per 15 minutes (each resend gives 5 fresh tries, so this caps the guessing).
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
const RESEND_GAP_S = 30;
const RESENDS = 3;
const PW_TRIES = 10;
const PW_WINDOW_MS = 15 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const failures = new Map(); // `${email}|${ip}` -> [timestamps]
const resends = new Map(); // emp_id -> [timestamps]

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
const expired = (res, message = 'This code has expired. Sign in again to get a new one.') => (
  res.status(401).json({ success: false, message, data: { restart: true } }));

// Why a code did not go out, as the sign-in screen says it.
function mailProblem(r) {
  if (r.status === 'off') {
    return process.env.MAIL_ENABLED !== 'true' ? 'E-mail is switched off on this server' : `E-mail cannot be sent from this server (${r.reason})`;
  }
  return `The code e-mail could not be sent (${r.error || 'unknown error'})`;
}

const NOT_SENT = 'We could not e-mail your sign-in code. Try again in a few minutes; if it keeps failing, tell the dFresh admin.';

// New code for emp: the mail is queued and sent at once (outbox-worker.sendMailNow), so the answer is the truth.
// -> { ok: true, sentTo, mail: 'sent' } or, outside production only, { ok: true, mail: 'off' | 'failed', mailNote }
//    with the code printed to the server console ([dev] line);
// -> production, not sent: { ok: false, message }. The new code is then never stored (an earlier code keeps
//    working) and its mail row is cancelled and wiped, so it can never arrive late.
async function issueCode(emp) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const [[company]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'company_name'");
  const m = mailer.renderLoginCode({
    name: emp.emp_first_name || emp.emp_id, code, minutes: CODE_MIN, companyName: company ? company.setting_value : '',
  });
  // Not due for a minute: the 15 s worker pass leaves it alone, sendMailNow below sends it.
  const [ins] = await db.query(
    `INSERT INTO mail_outbox (to_email, subject, html_body, text_body, purpose, next_attempt_at)
     VALUES (?, ?, ?, ?, 'admin_otp', NOW() + INTERVAL 1 MINUTE)`,
    [emp.emp_mail_id, m.subject, m.html, m.text]
  );
  const r = await outboxWorker.sendMailNow(ins.insertId);
  const sent = r.status === 'sent';
  if (!sent && isProd) {
    await db.query(
      `UPDATE mail_outbox SET status = 'cancelled', subject = 'dFresh admin sign-in code (not sent, removed)',
              html_body = '-', text_body = '-', last_error = ? WHERE mail_id = ?`,
      [String(r.error || r.reason || r.status).slice(0, 500), ins.insertId]
    );
    return { ok: false, message: NOT_SENT };
  }
  await db.query(
    `INSERT INTO \`${auth.DADMIN}\`.login_otp (app_key, emp_id, email, otp_hash, expires_at, attempts)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ? MINUTE, 0)
     ON DUPLICATE KEY UPDATE email = VALUES(email), otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), attempts = 0`,
    [auth.APP_KEY, emp.emp_id, emp.emp_mail_id, await bcrypt.hash(code, 10), CODE_MIN]
  );
  const [local, domain] = emp.emp_mail_id.split('@');
  const sentTo = `${local.slice(0, 2)}***@${domain}`;
  if (sent) return { ok: true, sentTo, mail: 'sent' };
  console.log(`[dev] admin sign-in code for ${emp.emp_id}: ${code} (mail not sent: ${r.reason || r.error || r.status})`);
  return { ok: true, sentTo, mail: r.status === 'off' ? 'off' : 'failed', mailNote: mailProblem(r) };
}

const codeData = (issued) => ({
  sentTo: issued.sentTo, resendAfter: RESEND_GAP_S, mail: issued.mail, ...(issued.mailNote ? { mailNote: issued.mailNote } : {}),
});

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

    const issued = await issueCode(emp);
    if (!issued.ok) return res.status(503).json({ success: false, message: issued.message });
    auth.setChallenge(res, emp.emp_id);
    return res.json({ success: true, data: codeData(issued) });
  } catch (err) {
    console.error('admin login failed:', err.code || err.message);
    return res.status(500).json({ success: false, message: 'Sign-in is not available right now' });
  }
});

router.post('/admin/login/verify', async (req, res) => {
  const challenge = auth.readChallenge(req);
  if (!challenge) return expired(res, 'This sign-in timed out. Sign in again to get a new code.');
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  try {
    const [[row]] = await db.query(
      `SELECT otp_hash, attempts, expires_at > NOW() AS live FROM \`${auth.DADMIN}\`.login_otp WHERE app_key = ? AND emp_id = ?`,
      [auth.APP_KEY, challenge.sub]
    );
    if (!row || !Number(row.live)) return expired(res);
    if (row.attempts >= CODE_TRIES) return expired(res, 'Too many wrong codes. Sign in again to get a new one.');
    if (!/^\d{6}$/.test(code) || !(await bcrypt.compare(code, row.otp_hash))) {
      await db.query(
        `UPDATE \`${auth.DADMIN}\`.login_otp SET attempts = attempts + 1 WHERE app_key = ? AND emp_id = ?`,
        [auth.APP_KEY, challenge.sub]
      );
      const left = CODE_TRIES - row.attempts - 1;
      if (left <= 0) return expired(res, 'Wrong code, and that was the last try. Sign in again to get a new one.');
      return res.status(401).json({ success: false, message: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`, data: { left } });
    }
    const [[user]] = await db.query('SELECT role FROM admin_users WHERE emp_id = ? AND is_active = 1', [challenge.sub]);
    if (!user) return expired(res, 'This account can no longer sign in to dFresh admin.');
    await db.query(`DELETE FROM \`${auth.DADMIN}\`.login_otp WHERE app_key = ? AND emp_id = ?`, [auth.APP_KEY, challenge.sub]);
    auth.startSession(res, challenge.sub);
    await audit(null, { empId: challenge.sub, action: 'login', entity: 'admin_user', entityId: challenge.sub });
    return res.json({ success: true, data: { emp_id: challenge.sub, role: user.role } });
  } catch (err) {
    console.error('admin code check failed:', err.code || err.message);
    return res.status(500).json({ success: false, message: 'Sign-in is not available right now' });
  }
});

router.post('/admin/login/resend', async (req, res) => {
  const challenge = auth.readChallenge(req);
  if (!challenge) return expired(res, 'This sign-in timed out. Sign in again to get a new code.');
  try {
    const [[row]] = await db.query(
      `SELECT TIMESTAMPDIFF(SECOND, expires_at - INTERVAL ? MINUTE, NOW()) AS age FROM \`${auth.DADMIN}\`.login_otp
        WHERE app_key = ? AND emp_id = ?`,
      [CODE_MIN, auth.APP_KEY, challenge.sub]
    );
    if (!row) return expired(res);
    const wait = RESEND_GAP_S - Number(row.age);
    if (wait > 0) {
      return res.status(429).json({ success: false, message: `Wait ${wait} s before asking for a new code.`, data: { resendAfter: wait } });
    }
    const now = Date.now();
    const recent = (resends.get(challenge.sub) || []).filter((t) => now - t < PW_WINDOW_MS);
    if (recent.length >= RESENDS) {
      return res.status(429).json({ success: false, message: 'Too many new codes. Wait 15 minutes and sign in again.' });
    }
    const [[emp]] = await db.query(
      `SELECT e.emp_id, e.emp_first_name, e.emp_mail_id FROM \`${auth.DADMIN}\`.employee e
         JOIN admin_users a ON a.emp_id = e.emp_id AND a.is_active = 1
        WHERE e.emp_id = ? AND e.deleted_time IS NULL`,
      [challenge.sub]
    );
    if (!emp) return expired(res, 'This account can no longer sign in to dFresh admin.');
    resends.set(challenge.sub, [...recent, now]);
    const issued = await issueCode(emp);
    if (!issued.ok) {
      return res.status(503).json({ success: false, message: `${issued.message} Your earlier code still works.` });
    }
    auth.setChallenge(res, emp.emp_id);
    return res.json({ success: true, data: codeData(issued) });
  } catch (err) {
    console.error('admin code resend failed:', err.code || err.message);
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
module.exports.issueCode = issueCode; // tests
