// The five forms (spec D): title / subtitle / button keys and, per field, its label key, whether it spans both
// columns and its autocomplete hint. Field names, types, required flags and lengths are the form rules (phase 24:
// Website > Forms > Form rules, the database), sent in the bootstrap (data.formRules); the API validates with the
// same rows. In their order.

const LAYOUT = {
  brochure: {
    title: 'm_brochure', sub: 'm_brochure_s', button: 'download_brochure',
    fields: {
      first_name: ['first_name', false, 'given-name'],
      last_name: ['last_name', false, 'family-name'],
      email: ['email', true, 'email'],
      phone: ['mobile', true, 'tel'],
    },
  },
  quote: {
    title: 'm_quote', sub: 'm_quote_s', button: 'send',
    fields: {
      full_name: ['fl_name', false, 'name'],
      business_name: ['fl_biz', false, 'organization'],
      business_type: ['fl_type', false, ''],
      town: ['fl_town', false, 'address-level2'],
      phone: ['fl_phone', false, 'tel'],
      email: ['email', false, 'email'],
      products: ['fl_prod', true, ''],
      monthly_quantity: ['fl_qty', false, ''],
      message: ['fl_msg', true, ''],
    },
  },
  distributor: {
    title: 'm_dist', sub: 'm_dist_s', button: 'submit',
    fields: {
      full_name: ['fl_name', false, 'name'],
      firm_name: ['fl_firm', false, 'organization'],
      gst_no: ['fl_gst', false, ''],
      areas: ['fl_area', false, ''],
      godown_vehicles: ['fl_gd', false, ''],
      brands: ['fl_brands', false, ''],
      monthly_sales: ['fl_sales', false, ''],
      phone: ['fl_phone', false, 'tel'],
      email: ['email', true, 'email'],
    },
  },
  contact: {
    title: 'm_contact', sub: 'm_contact_s', button: 'send',
    fields: {
      full_name: ['fl_name', true, 'name'],
      phone: ['fl_phone', false, 'tel'],
      email: ['email', false, 'email'],
      message: ['fl_msg', true, ''],
    },
  },
};
// the quote form in "free sample" mode (form_type sample), with its own title (Translations m_sample)
LAYOUT.sample = { ...LAYOUT.quote, title: 'm_sample' };

const ruleFields = (rules, type) => {
  const def = rules.forms[type];
  return typeof def === 'string' ? rules.forms[def] : def;
};

export const FORM_TYPES = Object.keys(LAYOUT);

/** { title, sub, button, fields: [{ name, type, required, max, list, label, full, autoComplete }] }; rules = data.formRules */
export function formConfig(type, rules) {
  const l = LAYOUT[type];
  if (!l) return null;
  return {
    title: l.title,
    sub: l.sub,
    button: l.button,
    fields: ruleFields(rules, type).filter((f) => l.fields[f.name]).map((f) => {
      const [label, full, autoComplete] = l.fields[f.name];
      return { ...f, label, full, autoComplete };
    }),
  };
}
