// audit_log writer: every admin write records who, what, and the row before / after (spec F).
// Pass the transaction connection when the write is in one, so the audit row commits or rolls back with it.
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

async function audit(q, { empId, action, entity, entityId = null, before = null, after = null }) {
  await (q || db).query(
    `INSERT INTO audit_log (emp_id, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empId, action, entity, entityId === null ? null : String(entityId).slice(0, 80), json(before), json(after)]
  );
}

module.exports = { audit };
