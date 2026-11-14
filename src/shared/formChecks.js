// The fixed checks of the lead forms (phase 24): e-mail, Indian mobile and GST number formats, and the ui_text key of
// each error. Shown read only on Website > Forms > Form rules. Which fields a form has, which are required, the longest
// text, the spam limit and the most products in one quote live in the database (form_fields, site_settings; the API
// reads them in form-rules.js, the React forms through the bootstrap). CommonJS: the server requires it, the site imports it.
const PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  tel: /^(\+?91[\s-]?)?[6-9]\d{4}\s?\d{5}$/,
  gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i,
};
// error -> ui_text key (Translations group "errors"; also editable on Form rules)
const ERRORS = {
  required: 'e_fill',
  requiredChoice: 'e_choose',
  requiredPick: 'e_pick',
  email: 'e_email',
  tel: 'e_tel',
  gst: 'e_gst',
  consent: 'e_fill',
};
// words for the read-only notes on Form rules
const CHECK_NOTES = {
  email: 'An e-mail address: something@something.domain',
  tel: 'An Indian mobile number: 10 digits starting 6 to 9, +91 allowed in front',
  gst: 'A GST number: 15 characters, 2 digits, the PAN, a digit or letter, Z, a check character',
};
const RATE_WINDOW_MIN = 10; // the spam limit counts enquiries from one visitor in this many minutes (fixed)
const RATE_RANGE = [1, 20]; // the spam limit the Admin may set (owner: 1 to 20)

module.exports = { PATTERNS, ERRORS, CHECK_NOTES, RATE_WINDOW_MIN, RATE_RANGE };
