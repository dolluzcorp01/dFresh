// Commerce DEMO: the rules for a new customer, shared by the API (Admin_server.js) and the admin drawer
// (CommerceCustomers.js), so both show the same message under the same field. CommonJS (the server requires it).
// checkCustomer(raw) -> { values, errors: { field: message } }; phone saved as "+91 98765 43210".
const { checkSetting } = require('./settingRules');
const { isStateCode } = require('./gstStates');

const CTYPES = ['Home', 'Hotel', 'Hospital', 'Office', 'Distributor'];
const SOURCES = ['Phone', 'WhatsApp', 'Walk-in', 'Referral', 'Other'];
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/** 10-digit Indian mobile (6-9 first), with or without +91 / 0 / spaces -> "+91 98765 43210"; else null */
function indianMobile(v) {
  let d = String(v || '').replace(/[\s-]/g, '');
  if (d.startsWith('+91')) d = d.slice(3); else if (/^91\d{10}$/.test(d)) d = d.slice(2); else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : null;
}

/** the 10 digits used for the duplicate check */
const phoneDigits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

function checkCustomer(raw) {
  const t = (k) => String(raw[k] ?? '').trim();
  const errors = {};
  const values = {
    name: t('name'), phone: t('phone'), email: t('email') || null, ctype: t('ctype') || 'Home', business_name: t('business_name') || null,
    gstin: t('gstin') || null, address: t('address') || null, town: t('town') || null, state_code: t('state_code') || '33', pincode: t('pincode') || null, source: t('source') || 'Phone',
    notes: t('notes') || null, follow_up: t('follow_up') || null,
  };
  if (!values.name) errors.name = 'Name is required.';
  else if (values.name.length > 120) errors.name = 'At most 120 characters.';
  const phone = indianMobile(values.phone);
  if (!values.phone) errors.phone = 'Phone is required.';
  else if (!phone) errors.phone = 'A 10-digit Indian mobile number, e.g. 98765 43210.';
  else values.phone = phone;
  if (values.email && !EMAIL.test(values.email)) errors.email = 'A plain e-mail address, e.g. name@example.com.';
  if (!CTYPES.includes(values.ctype)) errors.ctype = `One of ${CTYPES.join(', ')}.`;
  if (!SOURCES.includes(values.source)) errors.source = `One of ${SOURCES.join(', ')}.`;
  if (values.gstin) {
    const g = checkSetting('gstin', values.gstin);
    if (g.error) errors.gstin = g.error; else values.gstin = g.value;
  }
  if (values.follow_up && !/^\d{4}-\d{2}-\d{2}$/.test(values.follow_up)) errors.follow_up = 'A date.';
  if (!isStateCode(values.state_code)) errors.state_code = 'Choose the state (it decides CGST + SGST or IGST).';
  if (values.pincode && !/^[1-9]\d{5}$/.test(values.pincode)) errors.pincode = 'PIN code: 6 digits.';
  if (values.gstin && !errors.gstin && values.gstin.slice(0, 2) !== values.state_code) errors.gstin = 'This GSTIN is registered in another state than the one chosen.';
  for (const [k, max] of [['business_name', 150], ['address', 255], ['town', 80]]) if (values[k] && values[k].length > max) errors[k] = `At most ${max} characters.`;
  return { values, errors };
}

module.exports = { CTYPES, SOURCES, checkCustomer, indianMobile, phoneDigits };
