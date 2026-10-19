// Settings value rules, shared by the API (Admin_server.js, PUT /settings/:key) and the admin Settings page, so both
// check and tidy a value the same way. checkSetting(key, raw) -> { value, error }: value is the tidied text to save
// (e.g. "+91 93302 59330"), error a plain sentence (null = fine). Empty is always allowed here; settings without a
// rule are saved as typed. whatsapp_number is never typed: it follows whatsapp_display (wa.me needs digits only).
// CommonJS: required by the server, imported by the admin.
const { parseFocus, formatFocus } = require('./photoFocus');

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

// "+91 93302 59330", "+919330259330", "+91-93302-59330" -> "+91 93302 59330"; anything else -> null
function indianPhone(v) {
  const d = String(v).replace(/[\s-]/g, '');
  return /^\+91\d{10}$/.test(d) ? `+91 ${d.slice(3, 8)} ${d.slice(8)}` : null;
}

const phone = { tidy: indianPhone, message: 'Use +91 and the 10-digit number, e.g. +91 93302 59330.' };
const email = { tidy: (v) => (EMAIL.test(v) ? v : null), message: 'A plain e-mail address, e.g. info@dolluzcorp.com.' };
const onOff = { tidy: (v) => (/^(on|off)$/i.test(v) ? v.toLowerCase() : null), message: 'on or off.' };

const RULES = {
  office_phone: phone,
  whatsapp_display: phone,
  public_email: email,
  lead_email: email,
  mail_from: email,
  brochure_download_enabled: onOff,
  // GSTIN: 2-digit state, PAN (5 letters, 4 digits, 1 letter), entity number, Z, check character
  gstin: {
    tidy: (v) => { const g = v.replace(/\s/g, '').toUpperCase(); return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) ? g : null; },
    message: 'A GSTIN has 15 characters, like 33ABCDE1234F1Z5, or leave it empty.',
  },
  // CIN: L/U, 5-digit industry code, state, year, company type, 6-digit number
  cin: {
    tidy: (v) => { const c = v.replace(/\s/g, '').toUpperCase(); return /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(c) ? c : null; },
    message: 'A CIN has 21 characters, like U72501TN2018OPC120419, or leave it empty.',
  },
  ga4_measurement_id: {
    tidy: (v) => (/^G-[A-Z0-9]{4,15}$/i.test(v) ? v.toUpperCase() : null),
    message: 'Use the GA4 Measurement ID, like G-XXXXXXXXXX, or leave it empty.',
  },
  about_image_focus: {
    tidy: (v) => { const f = parseFocus(v); return f ? formatFocus(f) : null; },
    message: 'A point like 70% 50% (across, down; 0 to 100).',
  },
  gsheet_spreadsheet_id: {
    // the ID, or the whole sheet link (the ID is taken out of it)
    tidy: (v) => {
      const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(v);
      const id = m ? m[1] : v;
      return /^[A-Za-z0-9_-]{20,100}$/.test(id) ? id : null;
    },
    message: 'Paste the sheet link or its ID (the long part between /d/ and /edit).',
  },
};

/** { value, error } for a typed setting value. */
function checkSetting(key, raw) {
  const v = String(raw == null ? '' : raw).trim();
  const rule = RULES[key];
  if (!v || !rule) return { value: v, error: null };
  const tidy = rule.tidy(v);
  return tidy === null ? { value: v, error: rule.message } : { value: tidy, error: null };
}

/** The wa.me number for a WhatsApp display number: "91" + 10 digits, or '' when the display number is not valid. */
function whatsappNumber(display) {
  const p = indianPhone(display || '');
  return p ? p.replace(/\D/g, '') : '';
}

// settings that are computed from another one, never typed: { derived key: source key }
const DERIVED = { whatsapp_number: 'whatsapp_display' };

module.exports = { checkSetting, whatsappNumber, DERIVED };
