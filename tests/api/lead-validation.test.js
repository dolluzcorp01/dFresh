// Unit tests for the shared lead rules (src/shared/rules.json via validation.js). No DB.
// Run: npm run test:api
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLead, isFormType } = require('../../src/backend_routes/validation');

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
