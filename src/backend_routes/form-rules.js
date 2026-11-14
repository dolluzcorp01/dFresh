// Form rules (phase 24, Website > Forms > Form rules): ONE source for the lead forms, the database. form_fields holds
// each form's fields in order (type, option list, longest text, required; Phone is locked required), site_settings the
// spam limit (lead_rate_max, 1 to 20 per 10 minutes) and the most products in one quote (lead_max_products). Read here,
// cached with the site's content (content-cache.js: a save clears it), by the API (validation.js, Leads_server.js) and,
// through the bootstrap, by the React forms. The fixed format checks are src/shared/formChecks.js.
const cache = require('./content-cache');
const { RATE_WINDOW_MIN } = require('../shared/formChecks');

const FORM_TYPES = ['brochure', 'quote', 'distributor', 'contact']; // sample = the quote form (its own title)
const FORM_OF = { sample: 'quote' };

async function build(db) {
  const [rows] = await db.query('SELECT form_type, field_name, sort_order, field_type, list_key, max_len, is_required, locked FROM form_fields ORDER BY form_type, sort_order, field_name');
  const [st] = await db.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('lead_rate_max', 'lead_max_products')");
  const s = Object.fromEntries(st.map((r) => [r.setting_key, r.setting_value]));
  const forms = Object.fromEntries(FORM_TYPES.map((t) => [t, []]));
  for (const r of rows) {
    if (!forms[r.form_type]) continue;
    forms[r.form_type].push({
      name: r.field_name, type: r.field_type, ...(r.list_key ? { list: r.list_key } : {}),
      required: Number(r.is_required) === 1, ...(r.max_len !== null ? { max: Number(r.max_len) } : {}),
      ...(Number(r.locked) === 1 ? { locked: true } : {}),
    });
  }
  const maxProducts = Number(s.lead_max_products) || 40;
  const rateMax = Number(s.lead_rate_max) || 5;
  return {
    forms: { ...forms, ...FORM_OF }, // "sample": "quote" as before
    maxProducts, rateMax, rateWindowMinutes: RATE_WINDOW_MIN,
    public: { forms: { ...forms, ...FORM_OF }, maxProducts }, // what the site's forms need (no spam limit)
  };
}

/** the rules (cached until a content save) */
async function load(db) {
  return (await cache.getOrBuild('form-rules', () => build(db))).data;
}

/** the fields of a form type (sample = quote) */
function fieldsOf(rules, formType) {
  const def = rules.forms[formType];
  return typeof def === 'string' ? rules.forms[def] : def;
}

module.exports = { FORM_TYPES, FORM_OF, load, fieldsOf };
