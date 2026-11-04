// Section 3 Suppliers and buying (phase 16, v23): the checks a supplier's details pass, shared by the API (it decides)
// and the admin (the PAN fills itself while the GSTIN is typed, the hints under the fields). CommonJS.
const { isStateCode, stateName } = require('./gstStates');

const G36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** the 15th character of a GSTIN from its first 14 (GSTN's mod-36 check) */
function gstinCheckChar(g14) {
  let s = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = G36.indexOf(g14[i]) * (i % 2 ? 2 : 1);
    s += Math.floor(p / 36) + (p % 36);
  }
  return G36[(36 - (s % 36)) % 36];
}
/** '' when the GSTIN is right for an address in that state (GST code), else why not (v23 gstinProblem) */
function gstinProblem(g, stateCode) {
  if (!g) return 'Give the GSTIN, or tick "Not registered for GST".';
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return '15 characters: 2 digits, the 10-character PAN, a digit or letter, Z, and a check character.';
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'The last character does not match. One character is mistyped.';
  if (!isStateCode(g.slice(0, 2))) return `Starts with ${g.slice(0, 2)}, which is not a GST state code.`;
  if (stateCode && g.slice(0, 2) !== stateCode) return `Starts with ${g.slice(0, 2)}, but ${stateName(stateCode)} is ${stateCode}. The GSTIN and the address must be in the same state.`;
  return '';
}
const panOf = (g) => (g ? String(g).slice(2, 12) : '');
const ifscOk = (x) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(x);
const udyamOk = (x) => /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(x);
/** a phone typed any way -> "+91 98400 12345", or null when it is not 10 digits (v23 phoneNorm) */
function phoneNorm(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.slice(0, 2) === '91') d = d.slice(2);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : null;
}
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e);
const maskAcc = (a) => (a ? `XXXX${String(a).slice(-4)}` : '');
// what a supplier supplies (v23 SUP_KINDS)
const SUP_KINDS = [['raw', 'Raw material'], ['pack', 'Packing'], ['bought', 'Bought-in packs'], ['service', 'Service or job work']];
const BANK_TYPES = ['Current', 'Savings', 'Cash credit'];
const QC_REASONS = ['Wet or damp', 'Torn or crushed', 'Low GSM (too thin)', 'Wrong size', 'Wrong item', 'Short count', 'Expired or near expiry', 'Other'];
const PAY_MODES = [['bank', 'Bank transfer (NEFT / RTGS / IMPS)'], ['upi', 'UPI'], ['cheque', 'Cheque']];
// a vehicle number like TN 21 AX 4402 (v23)
const vehicleOk = (v) => /^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{4}$/.test(v);

module.exports = { gstinCheckChar, gstinProblem, panOf, ifscOk, udyamOk, phoneNorm, emailOk, maskAcc, SUP_KINDS, BANK_TYPES, QC_REASONS, PAY_MODES, vehicleOk };
