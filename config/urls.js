// Public base URLs used in e-mails and links (brochure download, admin link, brochure error page).
// PUBLIC_API_URL = this API as visitors reach it; PUBLIC_SITE_URL = the React site. Dev falls back to localhost.
// In production both must be set to https and not localhost: server.js calls checkPublicUrls() before it
// listens and refuses to start otherwise, so a visitor can never get a localhost or http link.
const isProd = () => process.env.NODE_ENV === 'production';
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');

function apiBase() {
  return trim(process.env.PUBLIC_API_URL) || `http://localhost:${process.env.PORT || 4012}`;
}

function siteBase() {
  return trim(process.env.PUBLIC_SITE_URL) || 'http://localhost:3000';
}

/** Problems with the public URLs in production ([] = fine, and always [] outside production). */
function publicUrlProblems() {
  if (!isProd()) return [];
  const problems = [];
  for (const key of ['PUBLIC_API_URL', 'PUBLIC_SITE_URL']) {
    const value = trim(process.env[key]);
    let url = null;
    try {
      url = new URL(value);
    } catch {
      problems.push(`${key} is missing or not a URL`);
      continue;
    }
    if (url.protocol !== 'https:') problems.push(`${key} must use https (is ${url.protocol.replace(':', '')})`);
    if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) problems.push(`${key} must not be localhost`);
  }
  return problems;
}

module.exports = { apiBase, siteBase, publicUrlProblems };
