// Admin sessions (Inside D pattern, docs/reference/insideD-patterns.md).
// - Identity is dadmin.employee; the role lives in dfresh.admin_users and is read on EVERY request, so a role
//   change or deactivation applies at once.
// - Two token kinds, both HS256 with JWT_SECRET (shared with dAdmin) and tagged with app + stage:
//   challenge (stage 'otp', 10 min, after the password) and session (stage 'session', 8 h, after the code).
//   readSession() accepts only stage 'session' for this app, so a challenge token, a dAdmin token or a
//   brochure token (different key) can never pass as a session.
// - Revocation: dadmin.login_session_revoke (app_key, emp_id, revoked_at) kills every session issued before
//   revoked_at. Fails open on a DB error (logged), like Inside D, so a dadmin hiccup does not lock staff out.
// - Cookies are httpOnly, SameSite=Strict, Secure in production, scoped to /api/dfresh/admin.
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const isProd = process.env.NODE_ENV === 'production';
const APP_KEY = process.env.ADMIN_APP_KEY || 'dFresh';
const DADMIN = /^[A-Za-z0-9_]{1,32}$/.test(process.env.DADMIN_DB_NAME || '') ? process.env.DADMIN_DB_NAME : 'dadmin';
const SESSION_COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const CHALLENGE_COOKIE = `${SESSION_COOKIE}_otp`;
const SESSION_TTL_S = 8 * 60 * 60;
const CHALLENGE_TTL_S = 10 * 60;
const COOKIE_PATH = '/api/dfresh/admin';

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

function secret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
  return process.env.JWT_SECRET;
}

const cookieOptions = (maxAgeS) => ({
  httpOnly: true, secure: isProd, sameSite: 'strict', path: COOKIE_PATH, maxAge: maxAgeS * 1000,
});

function sign(empId, stage, ttl) {
  return jwt.sign({ sub: String(empId), app: APP_KEY, stage }, secret(), { algorithm: 'HS256', expiresIn: ttl });
}

/** Verified claims of a token of this app and stage, else null. */
function verify(token, stage) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const c = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (c.app !== APP_KEY || c.stage !== stage || typeof c.sub !== 'string' || !c.sub) return null;
    return c;
  } catch {
    return null;
  }
}

function setChallenge(res, empId) {
  res.cookie(CHALLENGE_COOKIE, sign(empId, 'otp', CHALLENGE_TTL_S), cookieOptions(CHALLENGE_TTL_S));
}

const readChallenge = (req) => verify(req.cookies && req.cookies[CHALLENGE_COOKIE], 'otp');

function startSession(res, empId) {
  res.clearCookie(CHALLENGE_COOKIE, { path: COOKIE_PATH });
  res.cookie(SESSION_COOKIE, sign(empId, 'session', SESSION_TTL_S), cookieOptions(SESSION_TTL_S));
}

function endSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
  res.clearCookie(CHALLENGE_COOKIE, { path: COOKIE_PATH });
}

async function isRevoked(empId, issuedAtS) {
  try {
    const [[row]] = await db.query(
      `SELECT revoked_at FROM \`${DADMIN}\`.login_session_revoke WHERE app_key = ? AND emp_id = ?`, [APP_KEY, empId]
    );
    return Boolean(row && new Date(row.revoked_at).getTime() >= issuedAtS * 1000);
  } catch (err) {
    console.error('session revoke check failed (allowing):', err.code || err.message);
    return false;
  }
}

/** { emp_id, role, name } for a valid, unrevoked session of an active admin user; else null. */
async function readSession(req) {
  const claims = verify(req.cookies && req.cookies[SESSION_COOKIE], 'session');
  if (!claims) return null;
  const [[user]] = await db.query(
    'SELECT emp_id, role FROM admin_users WHERE emp_id = ? AND is_active = 1', [claims.sub]
  );
  if (!user) return null;
  if (await isRevoked(user.emp_id, claims.iat)) return null;
  return { emp_id: user.emp_id, role: user.role };
}

async function requireAuth(req, res, next) {
  try {
    const admin = await readSession(req);
    if (!admin) return res.status(401).json({ success: false, message: 'Please sign in' });
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Role guard (after requireAuth): the user's role must rank at least `min`. */
function requireRole(min) {
  if (!ROLE_RANK[min]) throw new Error(`requireRole: unknown role ${min}`);
  return (req, res, next) => {
    if ((ROLE_RANK[req.admin && req.admin.role] || 0) >= ROLE_RANK[min]) return next();
    return res.status(403).json({ success: false, message: `This needs the ${min} role` });
  };
}

module.exports = {
  APP_KEY, DADMIN, ROLE_RANK,
  setChallenge, readChallenge, startSession, endSession, readSession, requireAuth, requireRole,
};
