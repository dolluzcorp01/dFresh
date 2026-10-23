// Admin sign-in (spec F, Inside D pattern): /api/dfresh/admin/login, /login/verify, /logout, /me.
// Settings two_step_login (read at every sign-in, so a change applies to the next sign-in only; open sessions keep
// their 8 hours): 'on' (also when the row is missing) = password + e-mailed code as below; 'off' = a correct
// password starts the session at once (data.signedIn), no code and no mail.
// 1. POST /admin/login { email, password }: dadmin.employee (active, not deleted) + bcrypt, and the emp_id must be an
//    active dfresh.admin_users row. Two-step on: a 6-digit code is bcrypt-hashed into dadmin.login_otp (app_key dFresh, one
//    row per employee, 10 min, 5 tries) and e-mailed through the outbox AT ONCE; a challenge cookie is set.
//    The answer says whether the mail really went out (data.mail 'sent' | 'off' | 'failed'). Production: a code
//    that could not be sent is a 503 and the code step never opens. Outside production the code step opens
//    anyway, says why no mail came (data.mailNote) and the code is printed to the server console (Inside D).
//    Wrong e-mail, wrong password and "not a dFresh admin" all get the same 401, so the form reveals nothing.
// 2. POST /admin/login/verify { code } with the challenge cookie -> session cookie; the code row is deleted.
// 3. POST /admin/login/resend with the challenge cookie: a new code (the old one stops working), at most one per
//    30 s and 3 per employee per 15 minutes (each resend gives 5 fresh tries, so this caps the guessing).
// Password tries (whatever two_step_login says):
// - per account (the emp_id of the typed e-mail, or the e-mail itself when no employee has it): 5 wrong passwords
//   within 15 minutes lock that account's sign-in for 15 minutes, even with the right password. Kept in audit_log
//   (entity_type 'admin_login', actions login_failed / login_lock / login_blocked), so a restart does not lift it.
// - per IP, in memory: 20 wrong passwords within 15 minutes block that IP for 15 minutes.
// A wrong e-mail, a wrong password and "not a dFresh admin" all get the same 401; a locked account and a blocked IP
// the same 429, whether the account exists or not.
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
const ACCOUNT_TRIES = 5;
const LOCK_MIN = 15;
const IP_TRIES = 20;
const PW_WINDOW_MS = 15 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// compared when no employee has the e-mail, so a wrong e-mail takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const ipFailures = new Map(); // ip -> [timestamps]
const resends = new Map(); // emp_id -> [timestamps]

const bcryptCheck = (password, hash) => bcrypt.compare(password, hash || DUMMY_HASH);
let passwordMatches = bcryptCheck; // tests replace it

/** Tests only: replace the password check (fn(password, emp) -> boolean). null = bcrypt. */
function setPasswordCheck(fn) {
  passwordMatches = fn ? (password, hash, emp) => fn(password, emp) : bcryptCheck;
}

const ipHash = (ip) => crypto.createHash('sha256').update(`${process.env.IP_HASH_SALT || ''}|${ip || ''}`).digest('hex').slice(0, 16);

function ipBlocked(ip) {
  const now = Date.now();
  const recent = (ipFailures.get(ip) || []).filter((t) => now - t < PW_WINDOW_MS);
  if (recent.length) ipFailures.set(ip, recent);
  else ipFailures.delete(ip);
  return recent.length >= IP_TRIES;
}

// One audit row per failed or refused try. emp_id is the employee's when the e-mail is theirs, else '(unknown)'.
const loginAudit = (action, account, empId, ip, extra = {}) => audit(null, {
  empId: empId || '(unknown)', action, entity: 'admin_login', entityId: account, after: { ip: ipHash(ip), ...extra },
});

async function accountLocked(account) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'admin_login' AND entity_id = ? AND action = 'login_lock'
        AND created_at > NOW() - INTERVAL ? MINUTE`, [account, LOCK_MIN]
  );
  return Number(row.n) > 0;
}

async function noteFailure(account, empId, ip, reason) {
  ipFailures.set(ip, [...(ipFailures.get(ip) || []), Date.now()]);
  await loginAudit('login_failed', account, empId, ip, { reason });
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'admin_login' AND entity_id = ? AND action = 'login_failed'
        AND created_at > NOW() - INTERVAL ? MINUTE`, [account, LOCK_MIN]
  );
  if (Number(row.n) >= ACCOUNT_TRIES) await loginAudit('login_lock', account, empId, ip, { minutes: LOCK_MIN, failures: Number(row.n) });
}

/** On unless the setting says 'off' (a missing row keeps the code step). Read at every sign-in. */
async function twoStepOn() {
  const [[row]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'two_step_login'");
  return !(row && String(row.setting_value).trim().toLowerCase() === 'off');
}

const deny = (res) => res.status(401).json({ success: false, message: 'E-mail or password is not correct' });
const tooMany = (res) => res.status(429).json({ success: false, message: `Too many tries. Wait ${LOCK_MIN} minutes and try again.` });
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

// A sign-in code mail for emp, queued and sent at once (outbox-worker.sendMailNow). -> { code, r, mailId }
async function mailCode(emp) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const [[company]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'company_name'");
  const m = mailer.renderLoginCode({
    name: emp.emp_first_name || emp.emp_id, code, minutes: CODE_MIN, companyName: company ? company.setting_value : '',
    ui: await mailer.staffText(),
  });
  // Not due for a minute: the 15 s worker pass leaves it alone, sendMailNow below sends it.
  const [ins] = await db.query(
    `INSERT INTO mail_outbox (to_email, subject, html_body, text_body, purpose, next_attempt_at)
     VALUES (?, ?, ?, ?, 'admin_otp', NOW() + INTERVAL 1 MINUTE)`,
    [emp.emp_mail_id, m.subject, m.html, m.text]
  );
  return { code, r: await outboxWorker.sendMailNow(ins.insertId), mailId: ins.insertId };
}

// A code mail that did not go out: cancelled and wiped, so it can never arrive late.
async function dropCodeMail(mailId, r) {
  await db.query(
    `UPDATE mail_outbox SET status = 'cancelled', subject = 'dFresh admin sign-in code (not sent, removed)',
            html_body = '-', text_body = '-', last_error = ? WHERE mail_id = ?`,
    [String(r.error || r.reason || r.status).slice(0, 500), mailId]
  );
}

const masked = (mail) => { const [local, domain] = mail.split('@'); return `${local.slice(0, 2)}***@${domain}`; };

// New code for emp: the mail is queued and sent at once (outbox-worker.sendMailNow), so the answer is the truth.
// -> { ok: true, sentTo, mail: 'sent' } or, outside production only, { ok: true, mail: 'off' | 'failed', mailNote }
//    with the code printed to the server console ([dev] line);
// -> production, not sent: { ok: false, message }. The new code is then never stored (an earlier code keeps
//    working) and its mail row is cancelled and wiped, so it can never arrive late.
async function issueCode(emp) {
  const { code, r, mailId } = await mailCode(emp);
  const sent = r.status === 'sent';
  if (!sent && isProd) {
    await dropCodeMail(mailId, r);
    return { ok: false, message: NOT_SENT };
  }
  await db.query(
    `INSERT INTO \`${auth.DADMIN}\`.login_otp (app_key, emp_id, email, otp_hash, expires_at, attempts)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ? MINUTE, 0)
     ON DUPLICATE KEY UPDATE email = VALUES(email), otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), attempts = 0`,
    [auth.APP_KEY, emp.emp_id, emp.emp_mail_id, await bcrypt.hash(code, 10), CODE_MIN]
  );
  const sentTo = masked(emp.emp_mail_id);
  if (sent) return { ok: true, sentTo, mail: 'sent' };
  console.log(`[dev] admin sign-in code for ${emp.emp_id}: ${code} (mail not sent: ${r.reason || r.error || r.status})`);
  return { ok: true, sentTo, mail: r.status === 'off' ? 'off' : 'failed', mailNote: mailProblem(r) };
}

const codeData = (issued) => ({
  sentTo: issued.sentTo, resendAfter: RESEND_GAP_S, mail: issued.mail, ...(issued.mailNote ? { mailNote: issued.mailNote } : {}),
});

async function login(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL.test(email) || !password || password.length > 200) return deny(res);

  try {
    // any employee with this e-mail (also an inactive one): the lock is per account, whoever types the e-mail
    const [[known]] = await db.query(
      `SELECT emp_id FROM \`${auth.DADMIN}\`.employee WHERE LOWER(emp_mail_id) = ? AND deleted_time IS NULL LIMIT 1`, [email]
    );
    const account = (known ? known.emp_id : email).slice(0, 80);
    const knownId = known ? known.emp_id : null;
    if (ipBlocked(req.ip)) {
      await loginAudit('login_blocked', account, knownId, req.ip, { reason: 'ip' });
      return tooMany(res);
    }
    if (await accountLocked(account)) {
      await loginAudit('login_blocked', account, knownId, req.ip, { reason: 'account' });
      return tooMany(res);
    }
    const [[emp]] = await db.query(
      `SELECT emp_id, emp_first_name, emp_last_name, emp_mail_id, account_pass
         FROM \`${auth.DADMIN}\`.employee WHERE LOWER(emp_mail_id) = ? AND deleted_time IS NULL AND active = 1 LIMIT 1`,
      [email]
    );
    const ok = await passwordMatches(password, emp && emp.account_pass, emp);
    if (!emp || !emp.account_pass || !ok) {
      await noteFailure(account, knownId, req.ip, !known ? 'unknown e-mail' : !emp ? 'employee inactive' : 'wrong password');
      return deny(res);
    }
    const [[user]] = await db.query('SELECT role FROM admin_users WHERE emp_id = ? AND is_active = 1', [emp.emp_id]);
    if (!user) {
      await noteFailure(account, knownId, req.ip, 'not an active dFresh admin');
      return deny(res);
    }

    if (!(await twoStepOn())) {
      // password only: the same 8-hour session as after a code; no code, no mail
      auth.startSession(res, emp.emp_id);
      await audit(null, { empId: emp.emp_id, action: 'login', entity: 'admin_user', entityId: emp.emp_id, after: { twoStep: 'off' } });
      return res.json({ success: true, data: { signedIn: true, emp_id: emp.emp_id, role: user.role } });
    }
    const issued = await issueCode(emp);
    if (!issued.ok) return res.status(503).json({ success: false, message: issued.message });
    auth.setChallenge(res, emp.emp_id);
    return res.json({ success: true, data: codeData(issued) });
  } catch (err) {
    console.error('admin login failed:', err.code || err.message);
    return res.status(500).json({ success: false, message: 'Sign-in is not available right now' });
  }
}
router.post('/admin/login', login);

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
        WHERE e.emp_id = ? AND e.deleted_time IS NULL AND e.active = 1`,
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
    // Commerce settings commerce_enabled: the admin shows the Commerce menus only while it is on
    let commerceEnabled = false;
    try {
      const [[c]] = await db.query("SELECT value FROM commerce_settings WHERE setting_key = 'commerce_enabled'");
      commerceEnabled = Boolean(c && c.value === '1');
    } catch { /* table not there yet: off */ }
    // linked to a driver (Commerce settings > Drivers): the menu shows My trips only then
    let isDriver = false;
    try {
      const [[d]] = await db.query('SELECT driver_id FROM drivers WHERE emp_id = ? AND is_active = 1 LIMIT 1', [req.admin.emp_id]);
      isDriver = Boolean(d);
    } catch { /* table not there yet */ }
    res.json({ success: true, data: { ...req.admin, name, commerce_enabled: commerceEnabled, is_driver: isDriver } });
  } catch (err) {
    console.error('admin me failed:', err.code || err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Turning two_step_login ON (admin Settings): first a code to the admin making the change, and the setting is only
// switched on once that code is typed back (proves their mail arrives, so nobody is locked out). In memory per
// emp_id: 10 minutes, 5 tries; after a restart a new code is needed. A code mail that does not go out is an error
// in every environment, and the setting stays off.
const switchCodes = new Map(); // emp_id -> { hash, expires, tries }

async function sendSwitchCode(empId) {
  const [[emp]] = await db.query(
    `SELECT emp_id, emp_first_name, emp_mail_id FROM \`${auth.DADMIN}\`.employee
      WHERE emp_id = ? AND deleted_time IS NULL AND active = 1`, [empId]
  );
  if (!emp || !EMAIL.test(emp.emp_mail_id || '')) return { ok: false, message: 'Your dAdmin record has no e-mail address, so no code can be sent. Two-step sign-in stays off.' };
  const { code, r, mailId } = await mailCode(emp);
  if (r.status !== 'sent') {
    await dropCodeMail(mailId, r);
    switchCodes.delete(empId);
    return { ok: false, message: `${mailProblem(r)}. Two-step sign-in stays off.` };
  }
  switchCodes.set(empId, { hash: await bcrypt.hash(code, 10), expires: Date.now() + CODE_MIN * 60 * 1000, tries: 0 });
  return { ok: true, sentTo: masked(emp.emp_mail_id), minutes: CODE_MIN };
}

/** -> { ok: true } (the code is used up) or { ok: false, message, restart } */
async function checkSwitchCode(empId, code) {
  const c = switchCodes.get(empId);
  if (!c || c.expires < Date.now()) {
    switchCodes.delete(empId);
    return { ok: false, restart: true, message: 'This code has expired or was never sent. Ask for a new one.' };
  }
  if (!/^\d{6}$/.test(String(code || '')) || !(await bcrypt.compare(String(code), c.hash))) {
    c.tries += 1;
    const left = CODE_TRIES - c.tries;
    if (left <= 0) {
      switchCodes.delete(empId);
      return { ok: false, restart: true, message: 'Wrong code, and that was the last try. Ask for a new one.' };
    }
    return { ok: false, message: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` };
  }
  switchCodes.delete(empId);
  return { ok: true };
}

// Start-up check: this router holds only the sign-in routes, which are public by design (Admin_server.js checks that
// every other /admin route declares its permission).
(function assertOnlyPublic() {
  const PUBLIC = new Set(['POST /admin/login', 'POST /admin/login/verify', 'POST /admin/login/resend', 'POST /admin/logout', 'GET /admin/me']);
  const extra = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) if (!PUBLIC.has(`${m.toUpperCase()} ${layer.route.path}`)) extra.push(`${m.toUpperCase()} ${layer.route.path}`);
  }
  if (extra.length) throw new Error(`sign-in router has routes that are not sign-in routes: ${extra.join(', ')} (put them in Admin_server.js with a permission)`);
}());

module.exports = router;
module.exports.issueCode = issueCode; // tests
module.exports.login = login; // tests
module.exports.setPasswordCheck = setPasswordCheck; // tests
module.exports.sendSwitchCode = sendSwitchCode;
module.exports.checkSwitchCode = checkSwitchCode;
