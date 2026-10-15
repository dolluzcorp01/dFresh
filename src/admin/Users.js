// Admin users (spec F 11, admin): pick an active dAdmin employee (search by name or emp_id), give a role, Add; change a
// role (asked first, audited); deactivate / reactivate (asked first). The server keeps the rules: nobody can lock
// themselves out, there is always at least one active admin, and someone inactive in dAdmin cannot sign in.
// emp_id is a string like DZIND148 (never a number).
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Avatar, InfoCard, Loading, fmtDate, useAction, useAdmin, useLoad } from './ui';

const ROLES = ['viewer', 'editor', 'admin'];
const ROLE_HELP = {
  viewer: 'Viewer: sees content and leads.',
  editor: 'Editor: edits content and leads.',
  admin: 'Admin: everything (settings, users, languages, Excel import).',
};

export default function Users() {
  const list = useLoad('/users');
  const { me } = useAdmin();
  const act = useAction();
  const [pick, setPick] = useState(null); // the chosen employee
  const [role, setRole] = useState('viewer');
  const [pickerKey, setPickerKey] = useState(0); // remounts the picker after an Add

  const add = (e) => {
    e.preventDefault();
    if (!pick) { act.setMsg({ kind: 'error', text: 'Pick an employee first' }); return; }
    act.run(async () => {
      await api.send('POST', '/users', { emp_id: pick.emp_id, role });
      setPick(null); setPickerKey((k) => k + 1); list.reload();
    }, `${pick.name} added as ${role}`);
  };
  const update = (u, body, ok) => act.run(async () => { await api.send('PUT', `/users/${encodeURIComponent(u.emp_id)}`, body); list.reload(); }, ok);
  const changeRole = (u, next) => {
    if (next === u.role) return;
    if (!window.confirm(`Change role of ${u.name || u.emp_id} to ${next}?`)) return;
    update(u, { role: next }, `${u.name || u.emp_id} is now ${next}`);
  };
  const toggle = (u) => {
    const question = u.is_active
      ? `Deactivate ${u.name || u.emp_id}? They can no longer sign in to dFresh admin.`
      : `Reactivate ${u.name || u.emp_id}? They can sign in to dFresh admin again (as ${u.role}).`;
    if (window.confirm(question)) update(u, { is_active: u.is_active ? 0 : 1 }, `${u.name || u.emp_id} ${u.is_active ? 'deactivated' : 'reactivated'}`);
  };

  return (
    <section>
      <h1>Admin users</h1>
      <InfoCard title="Who can use dFresh admin">
        <ul>
          <li>People come from dAdmin: pick an active employee, give a role, Add. They sign in with their dAdmin e-mail and password.</li>
          <li>{ROLE_HELP.viewer} {ROLE_HELP.editor} {ROLE_HELP.admin}</li>
          <li>Someone who left the company (inactive in dAdmin) cannot sign in, whatever their role here.</li>
        </ul>
      </InfoCard>
      <form className="a-card a-adduser" onSubmit={add}>
        <h2>Add a person</h2>
        <div className="a-adduser-row">
          <EmployeePicker key={pickerKey} value={pick} onChange={setPick} />
          <label className="a-field a-adduser-role"><span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            <small className="a-muted">{ROLE_HELP[role]}</small>
          </label>
          <button type="submit" className="a-btn a-adduser-btn" disabled={act.busy || !pick}>Add</button>
        </div>
      </form>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Name</th><th>emp_id</th><th>E-mail</th><th>Role</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {(list.data || []).map((u) => {
                const self = u.emp_id === me.emp_id;
                return (
                  <tr key={u.emp_id} className={u.is_active ? '' : 'a-off'}>
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
                      <select aria-label={`Role of ${u.name || u.emp_id}`} value={u.role} disabled={self || act.busy} title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) => changeRole(u, e.target.value)}>
                        {ROLES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td><span className={`a-status ${u.is_active ? 'a-status-on' : 'a-status-off'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>{fmtDate(u.created_at)}<small className="a-muted a-person-sub">by {u.created_by || '-'}</small></td>
                    <td>
                      {!self && (
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
