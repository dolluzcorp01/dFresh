// Is an address allowed as the From of our mails in SendGrid? (admin Settings, before mail_from is saved.)
// SendGrid sends from an address only when it is a verified Single Sender, or when its domain is authenticated
// (Domain Authentication). Two read-only calls with SENDGRID_API_KEY, nothing is changed in SendGrid:
//   GET /v3/verified_senders      -> { results: [{ from_email, verified }] }
//   GET /v3/whitelabel/domains    -> [{ domain, valid }]
// check(address) never throws and answers one of:
//   { state: 'verified', how }       a verified sender, or a valid authenticated domain
//   { state: 'not_verified' }        both lists were read and neither has it
//   { state: 'unknown', reason }     the check could not run (no network, no key, key without the scope, timeout)
const API = 'https://api.sendgrid.com/v3';
const TIMEOUT_MS = 6000;
const KEY = /^SG\.[\w-]{10,}\.[\w-]{10,}$/;

let fetchImpl = (...a) => fetch(...a); // tests replace it (setFetch)

/** Tests only: replace fetch. null = the real one. */
function setFetch(fn) {
  fetchImpl = fn || ((...a) => fetch(...a));
}

/** GET a SendGrid list: { ok: true, body } or { ok: false, reason }. */
async function read(pathAndQuery, key, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${API}${pathAndQuery}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (res.status === 401) return { ok: false, reason: 'SendGrid refused the API key (401)' };
    if (res.status === 403) return { ok: false, reason: 'the API key may not read sender settings (403)' };
    if (res.status !== 200) return { ok: false, reason: `SendGrid answered HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (err) {
    if (ctrl.signal.aborted) return { ok: false, reason: `no answer from SendGrid within ${timeoutMs / 1000} s` };
    return { ok: false, reason: `SendGrid could not be reached (${(err.cause && err.cause.code) || err.message})` };
  } finally {
    clearTimeout(timer);
  }
}

async function check(address, { timeoutMs = TIMEOUT_MS } = {}) {
  const email = String(address || '').trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  const key = process.env.SENDGRID_API_KEY || '';
  if (!KEY.test(key)) return { state: 'unknown', reason: 'SENDGRID_API_KEY is missing or a placeholder' };
  const [senders, domains] = await Promise.all([
    read('/verified_senders?limit=100', key, timeoutMs),
    read('/whitelabel/domains?limit=100', key, timeoutMs),
  ]);
  const senderList = senders.ok && Array.isArray(senders.body && senders.body.results) ? senders.body.results : null;
  const domainList = domains.ok && Array.isArray(domains.body) ? domains.body : null;
  if (senderList && senderList.some((s) => s && s.verified === true && String(s.from_email || '').trim().toLowerCase() === email)) {
    return { state: 'verified', how: 'verified sender' };
  }
  if (domainList && domainList.some((d) => d && d.valid === true && String(d.domain || '').trim().toLowerCase() === domain)) {
    return { state: 'verified', how: `authenticated domain ${domain}` };
  }
  if (senderList && domainList) return { state: 'not_verified' };
  return { state: 'unknown', reason: (!senderList ? senders.reason : domains.reason) || 'unexpected answer from SendGrid' };
}

module.exports = { check, setFetch };
