// Unit tests for the lead validation (validation.js with the format checks of src/shared/formChecks.js). No DB: the
// form rules are given as the database holds them after migration 20261114_stage2_24_01 (the values rules.json had).
// Run: npm run test:api
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLead: validate, isFormType } = require('../../src/backend_routes/validation');

const F = (name, type, required, max, list) => ({ name, type, ...(list ? { list } : {}), required, ...(max ? { max } : {}) });
const RULES = {
  maxProducts: 40,
  forms: {
    brochure: [F('first_name', 'text', true, 60), F('last_name', 'text', true, 60), F('email', 'email', true, 150), F('phone', 'tel', true, 20)],
    quote: [F('full_name', 'text', true, 120), F('business_name', 'text', true, 150), F('business_type', 'select', true, 80, 'business_type'),
      F('town', 'text', true, 120), F('phone', 'tel', true, 20), F('email', 'email', true, 150), F('products', 'pick', true),
      F('monthly_quantity', 'text', false, 150), F('message', 'textarea', false, 2000)],
    sample: 'quote',
    distributor: [F('full_name', 'text', true, 120), F('firm_name', 'text', true, 150), F('gst_no', 'gst', false, 15), F('areas', 'text', true, 255),
      F('godown_vehicles', 'select', true, 80, 'yes_no'), F('brands', 'text', false, 255), F('monthly_sales', 'select', true, 80, 'monthly_sales'),
      F('phone', 'tel', true, 20), F('email', 'email', true, 150)],
    contact: [F('full_name', 'text', true, 120), F('phone', 'tel', true, 20), F('email', 'email', true, 150), F('message', 'textarea', true, 2000)],
  },
};
const validateLead = (type, body, lookups) => validate(type, body, lookups, RULES);

const lookups = {
  options: { business_type: new Set(['hotel']), yes_no: new Set(['yes', 'no']), monthly_sales: new Set(['under_50k']) },
  products: new Set(['DZIND-DF007', 'DZIND-DF008-BUR']),
};

test('form types', () => {
  for (const t of ['brochure', 'quote', 'sample', 'distributor', 'contact']) assert.ok(isFormType(t), t);
  assert.ok(!isFormType('toString'));
  assert.ok(!isFormType('admin'));
});

test('valid quote is normalised', () => {
  const r = validateLead('quote', {
    consent: true, full_name: '  Meena   S ', business_name: 'Hotel', business_type: 'hotel', town: 'Kanchipuram',
    phone: '+91 98765 43210', email: 'Meena@Example.COM', products: ['DZIND-DF008-BUR', 'DZIND-DF008-BUR'],
  }, lookups);
  assert.equal(r.ok, true);
  assert.equal(r.values.full_name, 'Meena S');
  assert.equal(r.values.phone, '9876543210');
  assert.equal(r.values.email, 'meena@example.com');
  assert.deepEqual(r.values.products, ['DZIND-DF008-BUR']);
  assert.equal(r.values.message, null);
});

test('errors are ui_text keys', () => {
  const r = validateLead('quote', {
    full_name: '', business_name: 'B', business_type: 'spaceship', town: 'T', phone: '5876543210', email: 'x@y', products: ['NOPE'],
  }, lookups);
  assert.deepEqual(r.fields, { full_name: 'e_fill', business_type: 'e_choose', phone: 'e_tel', email: 'e_email', products: 'e_pick', consent: 'e_fill' });
});

test('distributor GST optional, checked and upper-cased', () => {
  const base = { consent: true, full_name: 'L', firm_name: 'F', areas: 'A', godown_vehicles: 'yes', monthly_sales: 'under_50k', phone: '9876543210', email: 'a@b.co' };
  assert.equal(validateLead('distributor', base, lookups).ok, true);
  assert.equal(validateLead('distributor', { ...base, gst_no: '33abcde1234f1z5' }, lookups).values.gst_no, '33ABCDE1234F1Z5');
  assert.equal(validateLead('distributor', { ...base, gst_no: '33ABCDE1234F1Z' }, lookups).fields.gst_no, 'e_gst');
});

test('non-string input never throws', () => {
  const r = validateLead('contact', { full_name: { $gt: '' }, phone: 9876543210, email: ['a@b.co'], message: null, consent: 'true' }, lookups);
  assert.equal(r.ok, false);
  assert.equal(r.fields.consent, 'e_fill');
});
