// Admin users (spec F 11, admin): add a dAdmin employee by emp_id with a role, change role, deactivate.
// emp_id is a string like DZIND148 (never a number).
import { useState } from 'react';
import { api } from './adminApi';
import { Loading, fmtDate, useAction, useAdmin, useLoad } from './ui';

const ROLES = ['viewer', 'editor', 'admin'];

export default function Users() {
  const list = useLoad('/users');
  const { me } = useAdmin();
  const act = useAction();
  const [empId, setEmpId] = useState('');
  const [role, setRole] = useState('viewer');

  const add = (e) => {
    e.preventDefault();
    act.run(async () => { await api.send('POST', '/users', { emp_id: empId.trim(), role }); setEmpId(''); list.reload(); }, 'Added');
  };
  const update = (u, body) => act.run(async () => { await api.send('PUT', `/users/${encodeURIComponent(u.emp_id)}`, body); list.reload(); }, 'Saved');

  return (
    <section>
      <h1>Admin users</h1>
      <p className="a-muted">Roles: viewer = read and see leads; editor = content and leads; admin = everything (settings, users, languages, Excel import).</p>
      <form className="a-toolbar" onSubmit={add}>
        <input placeholder="emp_id, e.g. DZIND148" aria-label="emp_id" value={empId} onChange={(e) => setEmpId(e.target.value)} required />
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <button type="submit" className="a-btn" disabled={act.busy}>Add</button>
      </form>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>emp_id</th><th>Name</th><th>E-mail</th><th>Role</th><th>Status</th><th>Added</th></tr></thead>
            <tbody>
              {(list.data || []).map((u) => (
                <tr key={u.emp_id} className={u.is_active ? '' : 'a-off'}>
                  <td><code>{u.emp_id}</code></td>
                  <td>{u.name || <span className="a-bad">not in dAdmin</span>}{Number(u.deleted_in_dadmin) === 1 && <span className="a-bad"> (deleted in dAdmin)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select aria-label={`Role of ${u.emp_id}`} value={u.role} disabled={u.emp_id === me.emp_id || act.busy} onChange={(e) => update(u, { role: e.target.value })}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.emp_id === me.emp_id ? 'You' : (
                      <button type="button" className={`a-btn a-btn-sm${u.is_active ? ' a-btn-danger' : ''}`} disabled={act.busy} onClick={() => update(u, { is_active: u.is_active ? 0 : 1 })}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                  <td>{fmtDate(u.created_at)} by {u.created_by || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
    </section>
  );
}
