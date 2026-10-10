// GET /api/dfresh/brochure/download?token=  (spec D1). Streams the brochure PDF for the token's language,
// falling back to the default language, from private/brochures/<lang_code>/<brochures.file_name>.
// Tokens are short JWTs (purpose 'brochure'): 15 min for the in-page download, 7 days for the e-mailed link.
// They are signed with a key DERIVED from JWT_SECRET, so a brochure token can never pass as an admin or dAdmin
// session token (those use JWT_SECRET itself).
// Errors: 400 bad token, 410 expired, 404 nothing uploaded. A browser opening the link (e-mail) gets a small
// page with the ui_text message in the token's language; API callers get JSON.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../../config/db');
const { translatedSelect } = require('./i18n-sql');
const { esc } = require('./mailer');
const { siteBase } = require('../../config/urls');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const BROCHURE_DIR = path.resolve(__dirname, '..', '..', 'private', 'brochures');
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/;
const PURPOSE = 'brochure';

function tokenKey() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('dfresh-brochure-token').digest();
}

/** Signed download token. ttl: jsonwebtoken expiresIn ('15m', '7d'). */
function signBrochureToken({ leadId, lang }, ttl) {
  return jwt.sign({ purpose: PURPOSE, lid: String(leadId), lang }, tokenKey(), { expiresIn: ttl, algorithm: 'HS256' });
}

function inPageTtl() {
  const min = Number(process.env.BROCHURE_TOKEN_TTL_MIN) || 15;
  return `${Math.min(Math.max(Math.round(min), 1), 60)}m`;
}

async function languages() {
  const [rows] = await db.query('SELECT lang_code, html_lang, is_default FROM languages WHERE is_active = 1');
  const def = rows.find((r) => Number(r.is_default) === 1) || rows[0];
  return { codes: new Set(rows.map((r) => r.lang_code)), def: def.lang_code, rows };
}

// The active brochure file for lang, else the default language's; null when neither exists on disk.
async function findBrochure(lang) {
  const { codes, def } = await languages();
  const want = codes.has(lang) ? lang : def;
  const [rows] = await db.query(
    'SELECT lang_code, file_name FROM brochures WHERE is_active = 1 AND lang_code IN (?, ?)',
    [want, def]
  );
  for (const code of [want, def]) {
    const row = rows.find((r) => r.lang_code === code);
    if (!row) continue;
    if (!SAFE_SEGMENT.test(row.lang_code) || !SAFE_SEGMENT.test(row.file_name)) {
      console.error(`brochure row for ${code} has an unsafe file name, skipped`);
      continue;
    }
    const file = path.join(BROCHURE_DIR, row.lang_code, row.file_name);
    if (fs.existsSync(file)) return { lang: row.lang_code, file };
    console.error(`brochure file missing on disk for ${code} (brochures row is active)`);
  }
  return null;
}

async function uiText(keys, lang) {
  const { codes, def } = await languages();
  const use = codes.has(lang) ? lang : def;
  const { sql, params } = translatedSelect({
    base: 'ui_text_keys', tr: 'ui_text', keys: ['text_key'], baseCols: ['text_key'], trCols: [{ col: 'value' }],
    where: `b.text_key IN (${keys.map(() => '?').join(', ')})`, whereParams: keys,
  }, use, def);
  const [rows] = await db.query(sql, params);
  return { lang: use, ui: Object.fromEntries(rows.map((r) => [r.text_key, r.value])) };
}

// Tiny branded page for a person who opened a dead link from the e-mail. All words come from ui_text.
async function sendErrorPage(res, status, lang, messageKey) {
  const { lang: use, ui } = await uiText([messageKey, 'home_link'], lang);
  const { rows } = await languages();
  const htmlLang = (rows.find((r) => r.lang_code === use) || {}).html_lang || use;
  const home = `${siteBase()}/${use}`;
  res.status(status).type('html').set('Cache-Control', 'no-store').send(`<!doctype html>
<html lang="${esc(htmlLang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>dFresh</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F6F1E4;font:16px/1.6 'Open Sans',Arial,sans-serif;color:#121214;padding:16px;box-sizing:border-box">
<main style="max-width:440px;background:#FCFBF6;border-radius:20px;padding:28px;border:1px solid #E6DFCB">
<p style="margin:0 0 20px">${esc(ui[messageKey] || '')}</p>
<a href="${esc(home)}" style="display:inline-block;background:#121214;color:#F4CF2C;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:999px">${esc(ui.home_link || 'dFresh')}</a>
</main></body></html>`);
}

const ERRORS = {
  400: ['Invalid brochure link', 'bro_expired'],
  410: ['Brochure link expired', 'bro_expired'],
  404: ['Brochure not available yet', 'bro_pending'],
};

async function fail(req, res, status, lang) {
  const [message, key] = ERRORS[status];
  if (req.accepts(['json', 'html']) === 'html') return sendErrorPage(res, status, lang, key);
  return res.status(status).json({ success: false, message });
}

router.get('/brochure/download', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  // Language for an error page only: read without trusting the token (it may be expired).
  const peek = jwt.decode(token);
  const hintLang = peek && typeof peek.lang === 'string' ? peek.lang : '';
  try {
    let claims;
    try {
      claims = jwt.verify(token, tokenKey(), { algorithms: ['HS256'] });
    } catch (err) {
      return await fail(req, res, err.name === 'TokenExpiredError' ? 410 : 400, hintLang);
    }
    if (claims.purpose !== PURPOSE) return await fail(req, res, 400, hintLang);

    const found = await findBrochure(claims.lang);
    if (!found) return await fail(req, res, 404, claims.lang);

    const name = `dFresh_Brochure_${found.lang.toUpperCase()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const stream = fs.createReadStream(found.file);
    stream.on('error', (err) => {
      console.error('brochure stream failed:', err.code || err.message);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Download failed' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    console.error('brochure download failed:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Download failed' });
  }
});

module.exports = router;
module.exports.brochure = { signBrochureToken, inPageTtl, findBrochure, BROCHURE_DIR };
