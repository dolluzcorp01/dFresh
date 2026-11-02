// The godown scope of a request (godowns.viewScope: null = every godown, else godown ids) as a SQL condition, for the
// long report and list queries whose ? placeholders are already in a fixed order: the ids are escaped by mysql2's
// format, exactly as a ? placeholder is (they are whole numbers from the person's own godowns, never typed text).
const mysql = require('mysql2');

/** "col IN (1, 2)" for the scope; '1 = 1' for every godown; '1 = 0' for none */
function inScope(col, scope) {
  if (scope === null || scope === undefined) return '1 = 1';
  const ids = scope.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? mysql.format(`${col} IN (?)`, [ids]) : '1 = 0';
}

/** orders of the scope, as a condition on an order_id column */
const ordersIn = (col, scope) => (scope === null || scope === undefined ? '1 = 1' : `${col} IN (SELECT so.order_id FROM orders so WHERE ${inScope('so.godown_id', scope)})`);
/** customers of the scope, as a condition on a customer_id column */
const customersIn = (col, scope) => (scope === null || scope === undefined ? '1 = 1' : `${col} IN (SELECT sc.customer_id FROM customers sc WHERE ${inScope('sc.godown_id', scope)})`);

module.exports = { inScope, ordersIn, customersIn };
