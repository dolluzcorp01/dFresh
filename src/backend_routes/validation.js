// Lead form validation + normalisation. The rules (which fields, required, longest text, most products) come from the
// database (form-rules.js; the React forms get the same rows through the bootstrap) and the format checks from
// src/shared/formChecks.js, so the browser and the API can never disagree on what is valid. Error values are ui_text
// keys (e_fill, e_email ...); the form translates them.
const { PATTERNS, ERRORS } = require('../shared/formChecks');
const { fieldsOf } = require('./form-rules');

const PRODUCT_ID = /^[A-Z0-9-]{3,30}$/;
const FORM_TYPES = ['brochure', 'quote', 'sample', 'distributor', 'contact'];

const isFormType = (t) => typeof t === 'string' && FORM_TYPES.includes(t);

// Collapses inner whitespace runs in single-line fields; keeps line breaks in a textarea.
function cleanText(v, multiline) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\r\n?/g, '\n').trim();
  return multiline ? s.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
}

// '+91 98765 43210' / '98765-43210' -> '9876543210' (only called after the pattern matched)
const normalisePhone = (v) => v.replace(/\D/g, '').slice(-10);

/**
 * @param {string} formType  brochure | quote | sample | distributor | contact
 * @param {object} body      request body
 * @param {object} lookups   { options: { list_key: Set(values) }, products: Set(active product ids) }
 * @param {object} rules     form-rules.js load(): { forms, maxProducts }
 * @returns {{ ok: true, values } | { ok: false, fields: { name: errorKey } }}
 */
function validateLead(formType, body, lookups, rules) {
  const fields = {};
  const values = {};
  for (const f of fieldsOf(rules, formType)) {
    const raw = body[f.name];
    if (f.type === 'pick') {
      const ids = Array.isArray(raw) ? [...new Set(raw.filter((x) => typeof x === 'string'))] : [];
      const valid = ids.length <= rules.maxProducts && ids.every((id) => PRODUCT_ID.test(id) && lookups.products.has(id));
      if (!valid) fields[f.name] = ERRORS.requiredPick;
      else if (f.required && !ids.length) fields[f.name] = ERRORS.requiredPick;
      values[f.name] = valid ? ids : [];
      continue;
    }
    const v = cleanText(raw, f.type === 'textarea');
    if (!v) {
      if (f.required) fields[f.name] = f.type === 'select' ? ERRORS.requiredChoice : ERRORS.required;
      values[f.name] = null;
      continue;
    }
    if (f.max && v.length > f.max) {
      fields[f.name] = ERRORS.required;
    } else if (f.type === 'select') {
      if (!lookups.options[f.list] || !lookups.options[f.list].has(v)) fields[f.name] = ERRORS.requiredChoice;
    } else if (PATTERNS[f.type] && !PATTERNS[f.type].test(v)) {
      fields[f.name] = ERRORS[f.type];
    }
    if (f.type === 'tel') values[f.name] = normalisePhone(v);
    else if (f.type === 'email') values[f.name] = v.toLowerCase();
    else if (f.type === 'gst') values[f.name] = v.toUpperCase();
    else values[f.name] = v;
  }
  if (body.consent !== true) fields.consent = ERRORS.consent;
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, values };
}

module.exports = { FORM_TYPES, isFormType, validateLead, normalisePhone };
