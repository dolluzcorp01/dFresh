// THE ONLY place that talks to SendGrid (CLAUDE.md rule 7). Routes never send: they render a message with the
// templates below and insert it into mail_outbox; outbox-worker.js calls send() later.
// - Sender: site_settings mail_from (address) + mail_from_name, read on every send. No sender lives in code;
//   an empty or malformed mail_from fails the send (the row stays in the outbox and retries).
// - MAIL_TEST_TO (local testing only, never on the server): every message goes to that address instead,
//   with the real recipient named in the subject. Outside production a real send REQUIRES it, so a dev machine
//   can never mail info@ or a visitor.
// - Every message has a plain-text part (send() throws without one); inline CSS only; every interpolated
//   value goes through esc().
// - Logo: image only (alt "dFresh", fixed 62x34, no text wordmark), the same header in every template. Templates
//   render LOGO_SRC (cid:); send() decides per message, reading site_settings on every send:
//   mail_logo_url set AND its last check passed (mail-logo-check.js) -> that URL replaces LOGO_SRC and nothing is
//   attached; otherwise (empty, unchecked or failing) -> the inline CID attachment mail-logo.png (built by
//   scripts/mail-logo.js). Never SVG. Already queued mails follow the setting.
// - Log: logMail() prints one "[mail] #id purpose from .. to .. -> outcome" line per mail and outcome (the
//   outbox worker calls it); the subject and body are never printed, so a sign-in code never reaches the log.
// - Size: Gmail clips html over 102 KB. Rendered templates stay far below MAX_HTML_BYTES (60 KB) because every
//   field is length-capped by rules.json; shared style strings keep the markup small. SendGrid click tracking
//   is off: it rewrites every link into a long redirect (and would route the brochure token through it).
const fs = require('fs');
const path = require('path');
const sgMail = require('@sendgrid/mail');
const { getDBConnection } = require('../../config/db');
const { siteBase } = require('../../config/urls');
const logoCheck = require('./mail-logo-check');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const isProd = process.env.NODE_ENV === 'production';
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

const C = { ink: '#121214', gold: '#E5BF24', goldL: '#F4CF2C', paper: '#FCFBF6', beige: '#F6F1E4', line: '#E6DFCB', ink2: '#4A4840', ink3: '#77736A' };
const FONT = "'Open Sans',Arial,Helvetica,sans-serif";
const HEAD = 'Saira,Arial,sans-serif';
const MAX_HTML_BYTES = 60 * 1024;

const LOGO_CID = 'dfresh-logo';
const LOGO_SRC = `cid:${LOGO_CID}`;
const LOGO_FILE = path.join(__dirname, 'mail-logo.png');
let logoAttachment = null; // read once, on the first send

function logo() {
  if (!logoAttachment) {
    logoAttachment = {
      content: fs.readFileSync(LOGO_FILE).toString('base64'),
      filename: 'dfresh-logo.png',
      type: 'image/png',
      disposition: 'inline',
      content_id: LOGO_CID,
    };
  }
  return logoAttachment;
}

let transport = null; // (message) => Promise; null = SendGrid

/** Tests and the dev preview only: replace SendGrid with a function that receives the final message. */
function setTransport(fn) {
  transport = fn;
}

const testTo = () => (process.env.MAIL_TEST_TO || '').trim();

/** Whether the worker may send now. { ok, reason } - reason is logged once by the worker. */
function readiness() {
  if (process.env.MAIL_ENABLED !== 'true') return { ok: false, reason: 'MAIL_ENABLED is not true' };
  if (transport) return { ok: true };
  if (!/^SG\.[\w-]{10,}\.[\w-]{10,}$/.test(process.env.SENDGRID_API_KEY || '')) return { ok: false, reason: 'SENDGRID_API_KEY is missing or a placeholder' };
  if (!isProd && !EMAIL.test(testTo())) return { ok: false, reason: 'outside production a real send needs MAIL_TEST_TO (local test inbox)' };
  return { ok: true };
}

async function mailSettings() {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('mail_from', 'mail_from_name', 'mail_logo_url')"
  );
  return Object.fromEntries(rows.map((r) => [r.setting_key, (r.setting_value || '').trim()]));
}

function senderOf(s) {
  if (!EMAIL.test(s.mail_from || '')) throw new Error('site_settings.mail_from is empty or not a plain e-mail address');
  return { email: s.mail_from, name: s.mail_from_name || undefined };
}

async function sender() {
  return senderOf(await mailSettings());
}

/** The sender address for the log line, or why there is none (never throws). */
async function fromAddress() {
  try {
    return (await sender()).email;
  } catch (err) {
    return `(no sender: ${err.message})`;
  }
}

/**
 * One terminal line per mail and outcome (the subject is never printed: a sign-in code is in it):
 * [mail] #<id> <purpose> from <from> to <to> (redirected to <MAIL_TEST_TO>) -> sent <id> | queued (...) | failed <reason>
 */
function logMail({ id, purpose, from, to }, outcome) {
  const redirect = testTo();
  const line = `[mail] #${id} ${purpose} from ${from} to ${to}${redirect ? ` (redirected to ${redirect})` : ''} -> ${outcome}`;
  if (outcome.startsWith('failed')) console.error(line);
  else console.log(line);
}

/** The "queued" outcome for a not-ready readiness() result. */
const queuedOutcome = (reason) => (process.env.MAIL_ENABLED !== 'true' ? 'queued (mail off)' : `queued (not sending: ${reason})`);

/**
 * Sends one message. { to, subject, html, text } - text is mandatory.
 * Returns the message as handed to the transport (from / to after the MAIL_TEST_TO redirect) plus providerId
 * (SendGrid's x-message-id; a test transport may return { id }).
 */
async function send({ to, subject, html, text }) {
  if (!text || !String(text).trim()) throw new Error('mailer: plain-text part is mandatory');
  if (!html) throw new Error('mailer: html part missing');
  if (!EMAIL.test(to || '')) throw new Error('mailer: bad recipient');
  const redirect = testTo();
  const settings = await mailSettings();
  const logoUrl = logoCheck.usableUrl(settings.mail_logo_url);
  const hasLogo = html.includes(LOGO_SRC);
  const message = {
    from: senderOf(settings),
    to: redirect || to,
    subject: redirect ? `[TEST for ${to}] ${subject}` : subject,
    html: hasLogo && logoUrl ? html.split(LOGO_SRC).join(esc(logoUrl)) : html,
    text,
    ...(hasLogo && !logoUrl ? { attachments: [logo()] } : {}),
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };
  let providerId = null;
  if (transport) {
    const r = await transport(message);
    providerId = (r && r.id) || null;
  } else {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const [response] = await sgMail.send(message);
    providerId = (response && response.headers && response.headers['x-message-id']) || null;
  }
  return { ...message, providerId };
}

// ---------------------------------------------------------------------------------------------
// Templates (render at enqueue time; the outbox row stores the finished html + text)
// ---------------------------------------------------------------------------------------------
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

// Shared inline styles (inline CSS only: many clients drop <style>).
const S = {
  h1: `margin:0 0 14px;font:700 24px/1.25 ${HEAD};color:${C.ink}`,
  small: `font:12px/1.5 ${FONT};color:${C.ink3}`,
  label: `padding:8px 12px 8px 0;border-bottom:1px solid ${C.line};font:600 13px/1.4 ${FONT};color:${C.ink3};vertical-align:top;white-space:nowrap`,
  value: `padding:8px 0;border-bottom:1px solid ${C.line};font:14px/1.5 ${FONT};color:${C.ink};vertical-align:top`,
};

function button(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${C.ink};color:${C.goldL};font:600 15px/1.3 ${FONT};text-decoration:none;padding:13px 26px;border-radius:999px">${esc(label)}</a>`;
}

// Branded shell: ink header with the on-dark logo and a gold rule, paper body, beige footer. The logo is the
// image only (no text wordmark), fixed 62x34 so nothing shifts while it loads; src is LOGO_SRC, which send()
// turns into mail_logo_url or the inline CID attachment. Every template uses this one header.
const LOGO_IMG = `<img src="${LOGO_SRC}" alt="dFresh" width="62" height="34" style="display:block;width:62px;height:34px;border:0;outline:none;text-decoration:none">`;

function shell({ htmlLang = 'en', title, preheader = '', body, footer }) {
  return `<!doctype html>
<html lang="${esc(htmlLang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.beige}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.beige}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.paper};border-radius:16px;overflow:hidden;border:1px solid ${C.line}">
<tr><td style="background:${C.ink};padding:22px 28px;border-bottom:4px solid ${C.gold}">${LOGO_IMG}</td></tr>
<tr><td style="padding:28px;font:15px/1.6 ${FONT};color:${C.ink}">${body}</td></tr>
<tr><td style="padding:16px 28px;background:#F3EEDF;font:12px/1.5 ${FONT};color:${C.ink2}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

// Staff alert rows: [label, value, href?]; empty values are left out.
function alertRows(rows) {
  return rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([label, value, href]) => {
      const val = href ? `<a href="${esc(href)}" style="color:${C.ink};font-weight:600">${esc(value)}</a>` : nl2br(value);
      return `<tr><td style="${S.label}">${esc(label)}</td><td style="${S.value}">${val}</td></tr>`;
    })
    .join('');
}

const textRows = (rows) => rows
  .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
  .map(([label, value]) => `${label}: ${String(value).replace(/\n/g, '\n  ')}`)
  .join('\n');

// Staff e-mails (lead alert, sign-in code): their words are Translations group "Staff e-mails" (ma_*, mc_*), read in
// the default language only (staffText). A missing text shows its key, so nothing is ever blank.
const { STAFF_GROUP } = require('./text-groups');
async function staffText(q = db) {
  const [rows] = await q.query(
    `SELECT t.text_key, t.value FROM ui_text_keys k
       JOIN languages l ON l.is_default = 1
       JOIN ui_text t ON t.text_key = k.text_key AND t.lang_code = l.lang_code
      WHERE k.group_name = ?`,
    [STAFF_GROUP]
  );
  return Object.fromEntries(rows.map((r) => [r.text_key, r.value]));
}
const say = (ui, key, vars = {}) => String((ui && ui[key]) || key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));

/**
 * Staff lead alert (default language, internal). lead = the saved row values plus:
 * { leadRef, formType, receivedAt, languageName, products: [{id, name}], options: {field: label},
 *   details: {...distributor extras}, brochure: 'sent' | 'pending' | null, companyName, ui: staffText() }
 */
function renderLeadAlert(lead) {
  const { ui } = lead;
  const L = (key) => say(ui, `ma_l_${key}`);
  const form = say(ui, `ma_form_${lead.formType}`);
  const name = lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  const opt = (field, value) => (value ? `${lead.options[field] || value} (${value})` : null);
  const d = lead.details || {};
  const products = (lead.products || []).map((p) => `${p.id} - ${p.name}`).join('\n');
  const adminUrl = `${siteBase()}/admin/leads?ref=${encodeURIComponent(lead.leadRef)}`;
  const brochure = lead.brochure === 'sent' ? say(ui, 'ma_bro_sent', { lang: lead.brochureLang })
    : lead.brochure === 'pending' ? say(ui, 'ma_bro_pending') : null;
  const rows = [
    [L('ref'), lead.leadRef],
    [L('form'), form],
    [L('received'), lead.receivedAt],
    [L('name'), name],
    [L('business'), lead.businessName],
    [L('business_type'), opt('business_type', lead.businessType)],
    [L('town'), lead.town],
    [L('phone'), lead.phone, `tel:+91${lead.phone}`],
    [L('whatsapp'), `wa.me/91${lead.phone}`, `https://wa.me/91${lead.phone}`],
    [L('email'), lead.email, `mailto:${lead.email}`],
    [L('products'), products],
    [L('quantity'), lead.monthlyQuantity],
    [L('message'), lead.message],
    [L('gst'), d.gst_no],
    [L('areas'), d.areas],
    [L('godown'), opt('godown_vehicles', d.godown_vehicles)],
    [L('brands'), d.brands],
    [L('sales'), opt('monthly_sales', d.monthly_sales)],
    [L('brochure'), brochure],
    [L('language'), lead.languageName],
    [L('page'), lead.sourcePage],
    [L('from'), lead.sourceRef],
    [L('consent'), lead.consentText ? say(ui, 'ma_consent_yes', { text: lead.consentText }) : null],
  ];
  const vars = { ref: lead.leadRef, form, name };
  const subject = say(ui, 'ma_subject', vars);
  const open = say(ui, 'ma_button');
  const html = shell({
    title: subject,
    preheader: `${say(ui, 'ma_preheader', vars)}${lead.town ? `, ${lead.town}` : ''}`,
    body: `<p style="margin:0 0 4px;font:600 12px/1 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3}">${esc(say(ui, 'ma_kicker'))}</p>`
      + `<h1 style="margin:0 0 18px;font:700 26px/1.2 ${HEAD};color:${C.ink}">${esc(lead.leadRef)} &middot; ${esc(form)}</h1>`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${alertRows(rows)}</table>`
      + `<p style="margin:24px 0 0">${button(adminUrl, open)}</p>`,
    footer: `${esc(say(ui, 'ma_footer'))} &middot; ${esc(lead.companyName)}`,
  });
  const text = `${say(ui, 'ma_text_head', vars)}\n\n${textRows(rows)}\n\n${open}: ${adminUrl}\n`;
  return { subject, html, text };
}

/**
 * Brochure copy for the visitor, in the visitor's language (ui_text mail_bro_subject / mail_bro_intro with
 * {name}, button label download_brochure). { htmlLang, ui, name, link, companyName, publicEmail }
 */
function renderBrochureCopy({ htmlLang, ui, name, link, companyName, publicEmail }) {
  const intro = String(ui.mail_bro_intro).replace(/\{name\}/g, name);
  const subject = ui.mail_bro_subject;
  const html = shell({
    htmlLang,
    title: subject,
    preheader: intro,
    body: `<h1 style="${S.h1}">${esc(subject)}</h1>`
      + `<p style="margin:0 0 22px">${esc(intro)}</p>`
      + `<p style="margin:0 0 18px">${button(link, ui.download_brochure)}</p>`
      + `<p style="margin:0;${S.small};word-break:break-all"><a href="${esc(link)}" style="color:${C.ink3}">${esc(link)}</a></p>`,
    footer: `${esc(companyName)}${publicEmail ? ` &middot; <a href="mailto:${esc(publicEmail)}" style="color:${C.ink2}">${esc(publicEmail)}</a>` : ''}`,
  });
  const text = `${subject}\n\n${intro}\n\n${ui.download_brochure}: ${link}\n\n${companyName}${publicEmail ? ` - ${publicEmail}` : ''}\n`;
  return { subject, html, text };
}

/**
 * Visitor confirmation (quote, sample, distributor, contact), in the visitor's language: ui_text thanks_name
 * ({name}), mail_ack_subject ({ref}), mail_ack_intro, mail_ack_ref, mail_ack_next_h, ok_other, mail_ack_keep,
 * whatsapp_us, wa_general. { htmlLang, ui, name, leadRef, whatsappNumber, whatsappDisplay, companyName, publicEmail }
 */
function renderLeadAck({ htmlLang, ui, name, leadRef, whatsappNumber, whatsappDisplay, companyName, publicEmail }) {
  const subject = String(ui.mail_ack_subject).replace(/\{ref\}/g, leadRef);
  const title = String(ui.thanks_name).replace(/\{name\}/g, name);
  const wa = whatsappNumber ? `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(ui.wa_general || '')}` : null;
  const html = shell({
    htmlLang,
    title: subject,
    preheader: `${ui.mail_ack_intro} ${ui.mail_ack_ref}: ${leadRef}`,
    body: `<h1 style="margin:0 0 10px;font:700 24px/1.25 ${HEAD};color:${C.ink}">${esc(title)}</h1>`
      + `<p style="margin:0 0 20px">${esc(ui.mail_ack_intro)}</p>`
      + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:${C.beige};border:1px solid ${C.line};border-radius:12px;padding:14px 20px">`
      + `<p style="margin:0 0 4px;font:600 12px/1.4 ${FONT};color:${C.ink3}">${esc(ui.mail_ack_ref)}</p>`
      + `<p style="margin:0;font:700 22px/1.2 ${HEAD};letter-spacing:.04em;color:${C.ink}">${esc(leadRef)}</p>`
      + '</td></tr></table>'
      + `<h2 style="margin:0 0 6px;font:700 17px/1.3 ${HEAD};color:${C.ink}">${esc(ui.mail_ack_next_h)}</h2>`
      + `<p style="margin:0 0 6px">${esc(ui.ok_other)}</p>`
      + `<p style="margin:0 0 22px;color:${C.ink2}">${esc(ui.mail_ack_keep)}</p>`
      + (wa ? `<p style="margin:0">${button(wa, `${ui.whatsapp_us}${whatsappDisplay ? ` ${whatsappDisplay}` : ''}`)}</p>` : ''),
    footer: `${esc(companyName)}${publicEmail ? ` &middot; <a href="mailto:${esc(publicEmail)}" style="color:${C.ink2}">${esc(publicEmail)}</a>` : ''}`,
  });
  const text = `${title}\n\n${ui.mail_ack_intro}\n\n${ui.mail_ack_ref}: ${leadRef}\n\n${ui.mail_ack_next_h}\n${ui.ok_other}\n${ui.mail_ack_keep}\n`
    + (wa ? `\n${ui.whatsapp_us}${whatsappDisplay ? ` ${whatsappDisplay}` : ''}: ${wa}\n` : '')
    + `\n${companyName}${publicEmail ? ` - ${publicEmail}` : ''}\n`;
  return { subject, html, text };
}

/** Admin sign-in code (default language, staff only). { name, code, minutes, companyName, ui: staffText() } */
function renderLoginCode({ name, code, minutes, companyName, ui }) {
  const vars = { name, code, minutes };
  const subject = say(ui, 'mc_subject', vars);
  const hello = say(ui, 'mc_hello', vars);
  const intro = say(ui, 'mc_intro', vars);
  const valid = say(ui, 'mc_valid', vars);
  const html = shell({
    title: subject,
    preheader: say(ui, 'mc_preheader', vars),
    body: `<p style="margin:0 0 14px">${esc(hello)}</p>`
      + `<p style="margin:0 0 18px">${esc(intro)}</p>`
      + `<p style="margin:0 0 18px;font:700 32px/1 ${HEAD};letter-spacing:.3em;color:${C.ink}">${esc(code)}</p>`
      + `<p style="margin:0;color:${C.ink2}">${esc(valid)}</p>`,
    footer: `${esc(say(ui, 'mc_footer'))} &middot; ${esc(companyName)}`,
  });
  const text = `${hello}\n\n${intro} ${code}\n\n${valid}\n`;
  return { subject, html, text };
}

/** "Send test mail" in admin Settings (English, staff only). { logo: 'url' | 'builtin', url, companyName } */
function renderLogoTest({ logo, url, companyName }) {
  const subject = 'dFresh test mail: e-mail header logo';
  const source = logo === 'url' ? `the hosted logo URL (${url})` : 'the built-in logo (attached to the mail)';
  const html = shell({
    title: subject,
    preheader: 'A test of the e-mail header.',
    body: `<h1 style="${S.h1}">${esc(subject)}</h1>`
      + `<p style="margin:0 0 14px">This test mail was sent from dFresh admin Settings. The header above should show the dFresh logo.</p>`
      + `<p style="margin:0">Logo used: ${esc(source)}.</p>`,
    footer: `dFresh admin &middot; ${esc(companyName)}`,
  });
  const text = `${subject}\n\nThis test mail was sent from dFresh admin Settings. The header should show the dFresh logo.\nLogo used: ${source}.\n`;
  return { subject, html, text };
}

module.exports = {
  send, readiness, setTransport, fromAddress, logMail, queuedOutcome, renderLeadAlert, renderBrochureCopy, renderLeadAck, renderLoginCode,
  staffText, STAFF_GROUP,
  renderLogoTest, esc, LOGO_SRC, LOGO_URL: logoCheck.LOGO_URL, MAX_HTML_BYTES,
};
