// Admin > Users and security > Roles (docs/COMMERCE-SPEC.md 1; phase 12a), as v23: one card per role (people, what it
// signs), and the chosen role below: name, default approval limit (nothing, up to an amount, anything; a person's own
// limit in Staff beats it), See cost, Own customers only, description, and its grid of sections x actions (View,
// Create, Edit, Approve, Cancel, Export, Delete). Save role stays grey until something changes; Cancel changes puts it
// back. Super admin and Admin are built in with every right; Sub-admin is built in, only an Admin changes its limit.
// Every other action ticks View too, unticking View clears the row. Nobody changes a role they hold, and a person who
// is not an Admin gives no right or limit they do not have (the API checks the same, and the same grid on every route).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, LIcon, Loading, Notice, PageHead, useAction, useCan, useConfirm, useLeaveGuard, useLoad } from './ui';

const ACTION_LABEL = { view: 'View', create: 'Create', edit: 'Edit', approve: 'Approve', cancel: 'Cancel', export: 'Export', delete: 'Delete' };
const LIMIT_OPTIONS = [{ value: 'none', label: 'Nothing (signs nothing)' }, { value: 'amount', label: 'Up to an amount' }, { value: 'any', label: 'Anything' }];
const DISCARD = { title: 'Discard unsaved changes?', message: 'The changes to this role are not saved.', action: 'Discard', danger: true };

export default function Roles() {
  const data = useLoad('/roles');
  const staff = useLoad('/staff');
  const canCreate = useCan('users', 'create');
  const confirm = useConfirm();
  const [sel, setSel] = useState(null); // role_id | 'new'
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(''); // what the last save / delete did
  const d = data.data;
  const chosen = sel !== null ? sel : d && d.roles.length ? d.roles[0].role_id : null;
  const choose = async (id) => {
    if (id === chosen) return;
    if (dirty && !(await confirm(DISCARD))) return;
    setDone(''); setDirty(false); setSel(id);
  };
  const role = d && chosen !== 'new' ? d.roles.find((r) => r.role_id === chosen) : null;
  const people = ((staff.data && staff.data.staff) || []).filter((p) => role && String(p.role_id) === String(role.role_id));
  return (
    <section>
      <PageHead sub="What each job can see and do"
        actions={canCreate && <button type="button" className="a-btn" onClick={() => choose('new')}><LIcon name="plus" size="sm" />New role</button>}
        rules={d ? [`${d.sections.length} sections x ${d.actions.length} actions`, 'Any action switches on View', 'An Approve tick without a limit signs nothing', 'Built-in roles are locked'] : undefined} />
      {done && <Notice kind="ok" onClose={() => setDone('')}>{done}</Notice>}
      <Loading state={data}>
        {d && (
          <>
            <div className="a-rolecards" role="group" aria-label="Roles">
              {d.roles.map((r) => (
                <button key={r.role_id} type="button" aria-pressed={r.role_id === chosen} onClick={() => choose(r.role_id)}>
                  <b>{r.name}</b><small>{r.users} {r.users === 1 ? 'person' : 'people'} · signs {r.limit_text}</small>
                </button>
              ))}
              {chosen === 'new' && <button type="button" aria-pressed="true"><b>New role</b><small>not saved yet</small></button>}
            </div>
            {role && people.length > 0 && (
              <details className="a-card a-rolepeople">
                <summary>Show people in {role.name} ({people.length})</summary>
                <p>{people.map((p) => `${p.name} (${p.emp_id})`).join(', ')}</p>
              </details>
            )}
            {(role || chosen === 'new') && (
              <RoleEditor key={chosen} meta={d} role={role} onDirty={setDirty}
                onSaved={(text, next) => { setDirty(false); setDone(text); setSel(next === undefined ? chosen : next); data.reload(); }} />
            )}
          </>
        )}
      </Loading>
      <InfoCard title="What each role may see and change">
        <ul>
          <li>Every admin user has one role (<Link to="/admin/users">Staff</Link>). A role is a grid of sections x View / Create / Edit / Approve / Cancel / Export / Delete, plus See cost, Own customers only and a default approval limit.</li>
          <li>Super admin and Admin (every right, sign anything) are built in and never change. Sub-admin (everything; Roles and users and Settings view only) is built in; only an Admin changes its limit.</li>
          <li>Nobody changes a role they hold, and nobody gives a right or limit they do not have.</li>
          <li>The server checks the grid on every request: a hidden button is only a convenience, a blocked action answers &quot;No access&quot;.</li>
        </ul>
      </InfoCard>
    </section>
  );
}

const emptyGrid = (meta) => Object.fromEntries(meta.sections.map((x) => [x.key, Object.fromEntries(meta.actions.map((a) => [a, false]))]));
const startOf = (meta, role) => ({
  name: role ? role.name : '', description: role ? role.description || '' : '',
  grid: role ? JSON.parse(JSON.stringify(role.perms)) : emptyGrid(meta),
  seeCost: Boolean(role && role.see_cost), own: Boolean(role && role.own_customers_only),
  limitKind: role ? role.limit.kind : 'none', limitAmount: role && role.limit.kind === 'amount' ? String(role.limit.amount) : '',
});

function RoleEditor({ meta, role, onDirty, onSaved }) {
  const act = useAction();
  const confirm = useConfirm();
  const creating = !role;
  const builtin = role && role.is_builtin;
  const lockText = role && role.lock;
  const mayEdit = useCan('users', creating ? 'create' : 'edit') && !lockText;
  const canEdit = mayEdit && !builtin; // name, rights, flags
  const canLimit = mayEdit && (!builtin || role.role_id === 2); // Sub-admin: its limit only
  const canDelete = useCan('users', 'delete') && !creating && !builtin && !lockText;
  const [start] = useState(() => startOf(meta, role));
  const [f, setF] = useState(start);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useLeaveGuard(dirty);
  const limitBody = { kind: f.limitKind, amount: f.limitAmount };

  const tick = (sec, a, on) => setF((x) => {
    const row = { ...x.grid[sec], [a]: on };
    if (a === 'view' && !on) meta.actions.forEach((y) => { row[y] = false; });
    if (a !== 'view' && on) row.view = true;
    return { ...x, grid: { ...x.grid, [sec]: row } };
  });
  const save = () => act.run(async () => {
    const flags = { see_cost: f.seeCost, own_customers_only: f.own, limit: limitBody };
    if (creating) {
      const r = await api.send('POST', '/roles', { name: f.name, description: f.description, perms: f.grid, ...flags });
      onSaved(`Role ${f.name.trim()} created`, r && r.role_id !== undefined ? r.role_id : null);
      return;
    }
    if (builtin) await api.send('PUT', `/roles/${role.role_id}`, { limit: limitBody });
    else await api.send('PUT', `/roles/${role.role_id}`, { name: f.name, description: f.description, perms: f.grid, ...flags });
    onSaved(`Role ${f.name.trim()} saved`);
  });
  const remove = async () => {
    if (!(await confirm({ title: `Delete the role ${role.name}?`, message: role.users ? `${role.users} user(s) have it: give them another role first.` : 'Nobody has this role. It is removed for good.', action: 'Delete role', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/roles/${role.role_id}`); onSaved(`Role ${role.name} deleted`, null); });
  };
  const yesNo = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];

  return (
    <div className="a-card a-roleedit">
      <div className="a-cardh">
        <h2>{creating ? 'New role' : role.name}</h2>
        {(canEdit || canLimit) && dirty && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setF(start)}>Cancel changes</button>}
        {canDelete && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={remove}>Delete role</button>}
        {(canEdit || canLimit) && <button type="button" className="a-btn" disabled={act.busy || !f.name.trim() || !dirty} onClick={save}><LIcon name="check" size="sm" />{creating ? 'Create role' : 'Save role'}</button>}
      </div>
      <div className="a-cardb">
        {act.note}
        {lockText ? <Notice kind="info">{lockText}</Notice>
          : builtin && <Notice kind="info">{role.name} is built in: its rights are fixed{canLimit ? '; only its default limit can change' : ''}.</Notice>}
        <div className="a-grid3">
          <label className="a-field"><span>Role name<span className="a-req"> *</span></span><input value={f.name} maxLength={60} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="a-field"><span>Default limit<span className="a-req"> *</span></span>
            <select value={f.limitKind} disabled={!canLimit} onChange={(e) => set({ limitKind: e.target.value })}>{LIMIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            {f.limitKind === 'amount'
              ? <input type="number" min="0" step="any" aria-label="Up to (Rs)" placeholder="Up to (Rs)" value={f.limitAmount} disabled={!canLimit} onChange={(e) => set({ limitAmount: e.target.value })} />
              : null}
            <small className="a-hint">What its people sign, even where the grid says Approve; a person&apos;s own limit in Staff beats it.</small>
          </label>
          <label className="a-field"><span>See cost, margin and stock value</span>
            <select value={f.seeCost ? '1' : '0'} disabled={!canEdit} onChange={(e) => set({ seeCost: e.target.value === '1' })}>{yesNo.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <small className="a-hint">No: reports show quantities and sales, not cost.</small>
          </label>
          <label className="a-field"><span>Role description</span>
            <input value={f.description} maxLength={255} disabled={!canEdit} onChange={(e) => set({ description: e.target.value })} />
            <small className="a-hint">Who should be given it. Shown when choosing a role for a person.</small>
          </label>
          <label className="a-field"><span>Own customers only</span>
            <select value={f.own ? '1' : '0'} disabled={!canEdit} onChange={(e) => set({ own: e.target.value === '1' })}>{yesNo.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <small className="a-hint">Yes: only their own customers and those customers&apos; orders.</small>
          </label>
        </div>
      </div>
      <div className="a-scroll">
        <table className="a-table a-rolegrid">
          <thead><tr><th>Section</th>{meta.actions.map((a) => <th key={a}>{ACTION_LABEL[a]}</th>)}</tr></thead>
          <tbody>
            {meta.sections.map((x) => (
              <tr key={x.key}>
                <td><b>{x.label}</b>{x.commerce && <span className="a-muted"> (Commerce)</span>}<span className="a-sub-l">{x.covers}</span></td>
                {meta.actions.map((a) => {
                  const na = meta.viewOnly.includes(x.key) && a !== 'view';
                  const on = Boolean(f.grid[x.key] && f.grid[x.key][a]);
                  const was = Boolean(start.grid[x.key] && start.grid[x.key][a]);
                  return (
                    <td key={a} className={on !== was ? 'chg' : undefined}>
                      {na ? <span className="a-muted" aria-label="not used">-</span> : (
                        <input type="checkbox" aria-label={`${x.label}: ${ACTION_LABEL[a]}`} checked={on} disabled={!canEdit} onChange={(e) => tick(x.key, a, e.target.checked)} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
