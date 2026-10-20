// Admin users (spec F 11, admin): pick an active dAdmin employee (search by name or emp_id), give a role, Add; change a
// role (asked first, audited); deactivate / reactivate (asked first). The server keeps the rules: nobody can lock
// themselves out, there is always at least one active admin, and someone inactive in dAdmin cannot sign in.
// emp_id is a string like DZIND148 (never a number).
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Link } from 'react-router-dom';
import { Avatar, InfoCard, Loading, fmtDate, useAction, useAdmin, useCan, useConfirm, useLeaveGuard, useLoad } from './ui';


export default function Users() {
  const list = useLoad('/users');
  const rolesData = useLoad('/roles');
  const roles = (rolesData.data && rolesData.data.roles) || [];
  const roleOf = (id) => roles.find((r) => String(r.role_id) === String(id));
  const { me } = useAdmin();
  const canAdd = useCan('users', 'create');
  const canEdit = useCan('users', 'edit');
  const act = useAction();
  const [pick, setPick] = useState(null); // the chosen employee
  const [role, setRole] = useState('3'); // Viewer (read only) until another is chosen
  const [pickerKey, setPickerKey] = useState(0); // remounts the picker after an Add

  const add = (e) => {
    e.preventDefault();
    if (!pick) { act.setMsg({ kind: 'error', text: 'Pick an employee first' }); return; }
    act.run(async () => {
      await api.send('POST', '/users', { emp_id: pick.emp_id, role_id: Number(role) });
      setPick(null); setPickerKey((k) => k + 1); list.reload();
    }, `${pick.name} added as ${(roleOf(role) || {}).name || 'the chosen role'}`);
  };
  const confirm = useConfirm();
  const update = (u, body, ok) => act.run(async () => { await api.send('PUT', `/users/${encodeURIComponent(u.emp_id)}`, body); list.reload(); }, ok);
  // a role picked in the list is only pending: the row is highlighted with Save / Cancel; Save sends it (audited)
  const [pending, setPending] = useState({}); // emp_id -> role
  const pickRole = (u, next) => setPending((p) => {
    const n = { ...p };
    if (String(next) === String(u.role_id)) delete n[u.emp_id]; else n[u.emp_id] = next;
    return n;
  });
  const cancelRole = (u) => setPending((p) => { const n = { ...p }; delete n[u.emp_id]; return n; });
  const saveRole = (u) => act.run(async () => {
    await api.send('PUT', `/users/${encodeURIComponent(u.emp_id)}`, { role_id: Number(pending[u.emp_id]) });
    cancelRole(u);
    list.reload();
  }, `${u.name || u.emp_id} is now ${(roleOf(pending[u.emp_id]) || {}).name || 'changed'}`);
  useLeaveGuard(Object.keys(pending).length > 0);
  const toggle = async (u) => {
    const who = u.name || u.emp_id;
    const ok = await confirm(u.is_active
      ? { title: `Deactivate ${who}?`, message: 'They can no longer sign in to dFresh admin.', action: 'Deactivate', danger: true }
      : { title: `Reactivate ${who}?`, message: `They can sign in to dFresh admin again, as ${u.role_name}.`, action: 'Reactivate' });
    if (ok) update(u, { is_active: u.is_active ? 0 : 1 }, `${who} ${u.is_active ? 'deactivated' : 'reactivated'}`);
  };

  return (
    <section>
      <h1>Admin users</h1>
      <InfoCard title="Who can use dFresh admin">
        <ul>
          <li>People come from dAdmin: pick an active employee, give a role, Add. They sign in with their dAdmin e-mail and password.</li>
          <li>Each person has one role. What a role may see and change is set in <Link to="/admin/roles">Roles</Link>; Admin and Sub-admin are built in.</li>
          <li>Nobody changes their own role or deactivates themselves, and there is always at least one active Admin.</li>
          <li>Someone who left the company (inactive in dAdmin) cannot sign in, whatever their role here.</li>
        </ul>
      </InfoCard>
      {canAdd && (
      <form className="a-card a-adduser" onSubmit={add}>
        <h2>Add a person</h2>
        <div className="a-adduser-row">
          <EmployeePicker key={pickerKey} value={pick} onChange={setPick} />
          <label className="a-field a-adduser-role"><span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}</select>
            <small className="a-muted">{(roleOf(role) || {}).description}</small>
          </label>
          <button type="submit" className="a-btn a-adduser-btn" disabled={act.busy || !pick}>Add</button>
        </div>
      </form>
      )}
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Name</th><th>emp_id</th><th>E-mail</th><th>Role</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {(list.data || []).map((u) => {
                const self = u.emp_id === me.emp_id;
                const next = pending[u.emp_id];
                return (
                  <tr key={u.emp_id} className={`${u.is_active ? '' : 'a-off'}${next ? ' a-pending' : ''}`}>
                    <td>
                      <span className="a-person">
                        <Avatar name={u.name || u.emp_id} photo={u.photo} />
                        <span>
                          <b>{u.name || u.emp_id}</b>{self && <span className="a-muted"> (you)</span>}
                          {u.left_company && <span className="a-warnbadge a-leftbadge" title="Inactive in dAdmin: cannot sign in">Left the company</span>}
                          {u.not_in_dadmin && <span className="a-warnbadge a-leftbadge" title="No dAdmin employee with this emp_id">Not in dAdmin</span>}
                          {(u.designation || u.department) && <small className="a-muted a-person-sub">{[u.designation, u.department].filter(Boolean).join(' · ')}</small>}
                        </span>
                      </span>
                    </td>
                    <td><code>{u.emp_id}</code></td>
                    <td>{u.email}</td>
                    <td>
                      <select aria-label={`Role of ${u.name || u.emp_id}`} value={next || u.role_id || ''} disabled={self || !canEdit || act.busy} title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) => pickRole(u, e.target.value)}>
                        {!u.role_id && <option value="">(no role)</option>}
                        {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td><span className={`a-status ${u.is_active ? 'a-status-on' : 'a-status-off'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>{fmtDate(u.created_at)}<small className="a-muted a-person-sub">by {u.created_by || '-'}</small></td>
                    <td>
                      {next ? (
                        <span className="a-pending-btns">
                          <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => saveRole(u)}>Save</button>
                          <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => cancelRole(u)}>Cancel</button>
                        </span>
                      ) : !self && canEdit && (
                        <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => toggle(u)}>
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Loading>
    </section>
  );
}

// Type a name or emp_id: active dAdmin employees who are not admin users yet (photo / initials, name, emp_id, job title,
// department). Keyboard: Up / Down, Enter picks, Esc closes.
function EmployeePicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let gone = false;
    setLoading(true);
    const id = setTimeout(() => {
      api.get(`/users/employees?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { if (!gone) { setItems(r); setActive(0); } })
        .catch(() => { if (!gone) setItems([]); })
        .finally(() => { if (!gone) setLoading(false); });
    }, 200);
    return () => { gone = true; clearTimeout(id); };
  }, [q, open]);
  useEffect(() => {
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);

  const choose = (emp) => { onChange(emp); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="a-field a-emppick" ref={boxRef}>
      <span id="emp-pick-l">Employee (from dAdmin)</span>
      {value ? (
        <div className="a-emppick-chosen">
          <Avatar name={value.name} photo={value.photo} size={28} />
          <span><b>{value.name}</b> <code>{value.emp_id}</code>{value.designation && <small className="a-muted a-person-sub">{[value.designation, value.department].filter(Boolean).join(' · ')}</small>}</span>
          <button type="button" className="a-link" onClick={() => onChange(null)}>Change</button>
        </div>
      ) : (
        <input type="search" value={q} placeholder="Type a name or emp_id" aria-labelledby="emp-pick-l" role="combobox" aria-expanded={open}
          aria-controls="emp-pick-list" aria-autocomplete="list" autoComplete="off"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={onKey} />
      )}
      {open && !value && (
        <ul id="emp-pick-list" className="a-emppick-list" role="listbox" aria-label="Employees">
          {items.map((emp, i) => (
            <li key={emp.emp_id} role="option" aria-selected={i === active} className={i === active ? 'a-ps-active' : undefined}
              onPointerMove={() => setActive(i)} onClick={() => choose(emp)}>
              <Avatar name={emp.name} photo={emp.photo} />
              <span className="a-emppick-text">
                <b>{emp.name}</b> <code>{emp.emp_id}</code>
                <small className="a-muted a-person-sub">{[emp.designation, emp.department].filter(Boolean).join(' · ') || ' '}</small>
              </span>
            </li>
          ))}
          {!items.length && <li className="a-ps-none" role="presentation">{loading ? 'Searching...' : 'No active employee matches (or they are already a user).'}</li>}
        </ul>
      )}
    </div>
  );
}
