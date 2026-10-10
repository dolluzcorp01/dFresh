// The five forms (spec D): title / subtitle / button keys and, per field, its label key, whether it spans both
// columns and its autocomplete hint. Field names, types, required flags and lengths come from
// src/shared/rules.json (the same file the API validates with), in the order listed there.
import rules from '../shared/rules.json';

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
LAYOUT.sample = LAYOUT.quote; // the quote form in "free sample" mode (form_type sample)

const ruleFields = (type) => {
  const def = rules.forms[type];
  return typeof def === 'string' ? rules.forms[def] : def;
};

export const FORM_TYPES = Object.keys(LAYOUT);

/** { title, sub, button, fields: [{ name, type, required, max, list, label, full, autoComplete }] } */
export function formConfig(type) {
  const l = LAYOUT[type];
  if (!l) return null;
  return {
    title: l.title,
    sub: l.sub,
    button: l.button,
    fields: ruleFields(type).map((f) => {
      const [label, full, autoComplete] = l.fields[f.name];
      return { ...f, label, full, autoComplete };
    }),
  };
}
