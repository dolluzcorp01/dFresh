// Indian states and union territories with their GST state codes (the first two digits of a GSTIN). Used for the
// customer and order addresses and the GST type: the place of supply (placeOfSupply below) against the seller state.
// Admin-only reference data (not shown on the public site). CommonJS: the server requires it too.
const GST_STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'],
];
const STATE_NAME = Object.fromEntries(GST_STATES);
const stateName = (code) => STATE_NAME[code] || code || '';
const isStateCode = (code) => Boolean(STATE_NAME[String(code || '')]);

/**
 * Place of supply (GST): B2B (the billing address has a GSTIN) = the state of that GSTIN (its first two digits), even
 * when the goods are shipped to another state (bill-to / ship-to); B2C (no GSTIN) = the shipping state. rule 'ship'
 * (Commerce setting place_of_supply_rule) = always the shipping state. To be confirmed by the accountant.
 * -> { code, reason }
 */
function placeOfSupply(billGstin, shipState, rule = 'gstin') {
  const g = String(billGstin || '').trim().toUpperCase();
  if (rule !== 'ship' && /^\d{2}/.test(g) && isStateCode(g.slice(0, 2))) return { code: g.slice(0, 2), reason: `B2B: the state of the billing GSTIN ${g}` };
  return { code: shipState, reason: rule === 'ship' ? 'the shipping state (Commerce setting)' : 'B2C (no GSTIN): the shipping state' };
}

/** why a stored place of supply is what it is (orders and invoices keep the code; this says the reason) */
function posReason(billGstin, pos) {
  const g = String(billGstin || '').trim().toUpperCase();
  return g && g.slice(0, 2) === pos ? `B2B: the state of the billing GSTIN ${g}` : g ? 'the shipping state' : 'B2C (no GSTIN): the shipping state';
}

module.exports = { GST_STATES, stateName, isStateCode, placeOfSupply, posReason };
