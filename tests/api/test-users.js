// Temporary admin users for the API tests (not a test file itself: npm run test:api runs *.test.js only).
// A session needs an admin_users row with a role_id AND an active dAdmin employee (auth.readSession: someone who left
// the company loses access at once). The tests never write to dAdmin: they borrow active employees who are not admin
// users yet (read only), give each a role here, and afterwards remove those admin_users rows and only the audit rows
// written during the run. Nothing else about the employee is touched.

const DADMIN = process.env.DADMIN_DB_NAME || 'dadmin';

/**
 * Borrow one spare employee per name: { name: role_id } -> { name: emp_id }. Every godown, like today's users.
 * Returns { ids, release } where release() removes what was added.
 */
async function borrow(db, roles, createdBy) {
  const names = Object.keys(roles);
  const [spare] = await db.query(
    `SELECT e.emp_id FROM \`${DADMIN}\`.employee e LEFT JOIN admin_users a ON a.emp_id = e.emp_id
      WHERE e.deleted_time IS NULL AND e.active = 1 AND a.emp_id IS NULL ORDER BY e.emp_id DESC LIMIT ?`, [names.length]
  );
  if (spare.length < names.length) throw new Error(`test users: ${names.length} spare active dAdmin employees needed, ${spare.length} found`);
  const [[{ m: auditFrom }]] = await db.query('SELECT COALESCE(MAX(audit_id), 0) AS m FROM audit_log');
  const ids = {};
  for (const [i, name] of names.entries()) {
    ids[name] = spare[i].emp_id;
    await db.query('INSERT INTO admin_users (emp_id, role_id, godowns_all, is_active, created_by) VALUES (?, ?, 1, 1, ?)',
      [ids[name], roles[name], createdBy]);
  }
  const all = Object.values(ids);
  const release = async () => {
    await db.query('DELETE FROM audit_log WHERE audit_id > ? AND emp_id IN (?)', [auditFrom, all]);
    await db.query('DELETE FROM admin_users WHERE emp_id IN (?) AND created_by = ?', [all, createdBy]);
  };
  return { ids, release };
}

/** a temporary custom role with the given rights: { section: ['view', 'edit', ...] } -> role_id; dropRole() removes it */
async function makeRole(db, name, rights) {
  await dropRole(db, name);
  const [r] = await db.query("INSERT INTO roles (name, description, limit_kind, created_by) VALUES (?, 'API test role', 'none', 'api-test')", [name]);
  for (const [section, acts] of Object.entries(rights)) {
    const has = (a) => (acts.includes(a) ? 1 : 0);
    await db.query(
      `INSERT INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_cancel, can_export, can_delete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.insertId, section, has('view'), has('create'), has('edit'), has('approve'), has('cancel'), has('export'), has('delete')]
    );
  }
  return r.insertId;
}

async function dropRole(db, name) {
  await db.query("DELETE FROM roles WHERE name = ? AND created_by = 'api-test'", [name]); // role_permissions cascade
}

module.exports = { borrow, makeRole, dropRole };
