// Setup > Roles (docs/COMMERCE-SPEC.md 1): the roles, who has them, and each role's grid of sections x actions.
// Admin and Sub-admin are built in (shown, not editable). A custom role: name, description, ticks; create / edit /
// approve / delete tick view too, unticking view clears the row. The API enforces the same grid on every route.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, useAction, useCan, useConfirm, useLoad } from './ui';

const ACTION_LABEL = { view: 'View', create: 'Create', edit: 'Edit', approve: 'Approve', delete: 'Delete' };

export default function Roles() {
  const data = useLoad('/roles');
  const canCreate = useCan('users', 'create');
  const [open, setOpen] = useState(null); // role_id | 'new'
  const [done, setDone] = useState(''); // what the last save / delete did (the drawer is closed by then)
  const d = data.data;
  return (
    <section>
      <h1>Roles</h1>
      <InfoCard title="What each role may see and change">
        <ul>
          <li>Every admin user has one role (<Link to="/admin/users">Admin users</Link>). A role is a grid of sections x View / Create / Edit / Approve / Delete.</li>
          <li>Admin (everything) and Sub-admin (everything except Roles and users and Settings) are built in and cannot be changed.</li>
          <li>The server checks the grid on every request: a hidden button is only a convenience, a blocked action answers &quot;No access&quot;.</li>
        </ul>
      </InfoCard>
      {done && <Notice kind="ok" onClose={() => setDone('')}>{done}</Notice>}
      {canCreate && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => { setDone(''); setOpen('new'); }}>New role</button></div>}
      <Loading state={data}>
        {d && (
          <div className="a-scroll">
            <table className="a-table a-roles">
              <thead><tr><th>Role</th><th>What it is for</th><th className="a-num">Users</th><th>Sections it can open</th></tr></thead>
              <tbody>
                {d.roles.map((r) => (
                  <tr key={r.role_id} className="a-rowlink" tabIndex={0} onClick={() => setOpen(r.role_id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.role_id)}>
                    <td><b>{r.name}</b>{r.is_builtin && <span className="a-status a-status-off a-builtin">Built in</span>}</td>
                    <td className="a-muted">{r.description}</td>
                    <td className="a-num">{r.users}</td>
                    <td>{d.sections.filter((x) => r.perms[x.key] && r.perms[x.key].view).map((x) => x.label).join(', ') || <span className="a-muted">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loading>
      {open && d && <RoleDrawer key={open} meta={d} role={open === 'new' ? null : d.roles.find((r) => r.role_id === open)} onClose={() => setOpen(null)} onSaved={(text) => { setOpen(null); setDone(text); data.reload(); }} />}
    </section>
  );
}

const emptyGrid = (meta) => Object.fromEntries(meta.sections.map((x) => [x.key, Object.fromEntries(meta.actions.map((a) => [a, false]))]));

function RoleDrawer({ meta, role, onClose, onSaved }) {
  const act = useAction();
  const confirm = useConfirm();
  const creating = !role;
  const builtin = role && role.is_builtin;
  const canEdit = useCan('users', creating ? 'create' : 'edit') && !builtin;
  const canDelete = useCan('users', 'delete') && !creating && !builtin;
  const [name, setName] = useState(role ? role.name : '');
  const [description, setDescription] = useState(role ? role.description || '' : '');
  const [grid, setGrid] = useState(() => (role ? JSON.parse(JSON.stringify(role.perms)) : emptyGrid(meta)));
  const [saved] = useState(() => JSON.stringify({ name, description, grid }));
  const dirty = JSON.stringify({ name, description, grid }) !== saved;
  useEffect(() => { if (creating) setGrid(emptyGrid(meta)); }, [creating, meta]);

  const tick = (sec, a, on) => setGrid((g) => {
    const row = { ...g[sec], [a]: on };
    if (a === 'view' && !on) meta.actions.forEach((x) => { row[x] = false; });
    if (a !== 'view' && on) row.view = true;
    return { ...g, [sec]: row };
  });
  const save = () => act.run(async () => {
    if (creating) await api.send('POST', '/roles', { name, description, perms: grid });
    else await api.send('PUT', `/roles/${role.role_id}`, { name, description, perms: grid });
    onSaved(creating ? `Role ${name.trim()} created` : `Role ${name.trim()} saved`);
  });
  const remove = async () => {
    if (!(await confirm({ title: `Delete the role ${role.name}?`, message: role.users ? `${role.users} user(s) have it: give them another role first.` : 'Nobody has this role. It is removed for good.', action: 'Delete role', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/roles/${role.role_id}`); onSaved(`Role ${role.name} deleted`); });
  };

  return (
    <Drawer title={creating ? 'New role' : role.name} onClose={onClose} dirty={canEdit && dirty}
      footer={(canEdit || canDelete) ? (
        <>
          {canEdit && <button type="button" className="a-btn" disabled={act.busy || !name.trim()} onClick={save}>{creating ? 'Create role' : 'Save'}</button>}
          {canDelete && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={remove}>Delete role</button>}
        </>
      ) : null}>
      {act.note}
      {builtin && <Notice kind="info">{role.name} is built in: its rights are fixed and cannot be changed.</Notice>}
      <div className="a-grid2">
        <label className="a-field"><span>Name</span><input value={name} maxLength={60} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></label>
        <label className="a-field"><span>What it is for</span><input value={description} maxLength={255} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>
      <div className="a-scroll">
        <table className="a-table a-permgrid">
          <thead><tr><th>Section</th>{meta.actions.map((a) => <th key={a} className="a-center">{ACTION_LABEL[a]}</th>)}</tr></thead>
          <tbody>
            {meta.sections.map((x) => (
              <tr key={x.key}>
                <th scope="row">{x.label}{x.commerce && <span className="a-muted"> (Commerce)</span>}<small className="a-muted a-person-sub">{x.covers}</small></th>
                {meta.actions.map((a) => {
                  const na = meta.viewOnly.includes(x.key) && a !== 'view';
                  return (
                    <td key={a} className="a-center">
                      {na ? <span className="a-muted" aria-label="not used">-</span> : (
                        <input type="checkbox" aria-label={`${x.label}: ${ACTION_LABEL[a]}`} checked={Boolean(grid[x.key] && grid[x.key][a])} disabled={!canEdit}
                          onChange={(e) => tick(x.key, a, e.target.checked)} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
