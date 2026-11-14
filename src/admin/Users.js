// Admin > Users and security > Staff (spec F 11, admin; phase 12a), as v23: one row per person (role, godowns, what they
// sign up to, driver, state with leave and stand-in). Add staff opens a panel: an active dAdmin employee (search by name
// or emp_id), a role, the godowns they work at. A click on a person opens their panel: role, personal approval limit
// (or the role's), the godowns they work at (every godown, later ones too, or a list), leave with a stand-in (the
// stand-in list says who cannot stand in, and why), the notification e-mail, deactivate / reactivate (asked first). The
// server keeps the rules (foundation.js): nobody changes their own row (their own leave excepted), the Super admin's
// row is never changed, only the Super admin changes an Admin, nobody gives more than they have, there is always at
// least one active Admin, and someone inactive in dAdmin cannot sign in.
// emp_id is a string like DZIND148 (never a number). Staff notification mails (phase 10) go to the dAdmin e-mail, or to
// the notification e-mail set here (Change, then Save; empty = back to the dAdmin e-mail; audited).
// Phase 12b: adding or bringing back someone who can sign, a wider role, limit or godown scope waits for a second Admin
// (the person stays as they were; a new one stays inactive with "Waiting for a second Admin"): the server answers
// `waiting` and each message shows as a warn toast. Someone marked as left shows when.
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Link } from 'react-router-dom';
import { TwoStepSetting } from './Website';
import { Avatar, Drawer, Field, LIcon, Loading, Notice, PageHead, Pill, Table, fmtDate, useAction, useAdmin, useCan, useConfirm, useLoad, useToast } from './ui';

const WAIT_TITLE = 'Waiting for a second Admin';
/** the server's `waiting` (a string or a list of strings, phase 12b) as warn toasts; true when something waits */
function toastWaiting(toast, waiting) {
  const list = [].concat(waiting || []).filter(Boolean);
  list.forEach((m) => (toast ? toast('warn', WAIT_TITLE, m) : null));
  return list.length > 0;
}


export default function Users() {
  const list = useLoad('/users');
  const staffData = useLoad('/staff');
  const staffOf = (emp) => ((staffData.data && staffData.data.staff) || []).find((x) => x.emp_id === emp);
  // emp_id of the person's panel | 'add'; ?open=<emp_id> opens that person (Roles: Open in Staff)
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('open'));
  const rolesData = useLoad('/roles');
  const roles = (rolesData.data && rolesData.data.roles) || [];
  const { me } = useAdmin();
  const canAdd = useCan('users', 'create');
  const act = useAction();
  const reload = () => { list.reload(); staffData.reload(); };
  const canSeeSettings = useCan('settings', 'view'); // two-step sign-in (field map row 101)
  const rows = list.data || [];
  const userOf = (emp) => rows.find((u) => u.emp_id === emp);

  return (
    <section>
      <PageHead sub="Everyone with a login"
        actions={canAdd && <button type="button" className="a-btn" onClick={() => setOpen('add')}><LIcon name="plus" size="sm" />Add staff</button>}
        rules={['People come from dAdmin', 'Godown scope on every person', 'Role limit, with a personal override', 'Who can sign waits for a second Admin', 'Leaving blocks login at once']} />
      <p className="a-lead">Each person has one role (<Link to="/admin/roles">Roles</Link>); a personal limit beats the role&apos;s. Nobody changes their own row, only the Super admin changes an Admin, and nobody gives more than they have.</p>
      {act.note}
      <Loading state={list}>
        <div className="a-listcard">
          <div className="a-countline"><b>{rows.length}</b> {rows.length === 1 ? 'person' : 'people'} · login comes from dAdmin, so nobody has a second password · click a row to open it</div>
          <Table label="Staff" rows={rows} rowKey={(u) => u.emp_id} onRowClick={(u) => setOpen(u.emp_id)} rowClass={(u) => (u.is_active ? '' : 'a-off')}
            columns={[
              { key: 'name', label: 'Person', render: (u) => (
                <span className="a-person2">
                  <Avatar name={u.name || u.emp_id} photo={u.photo} />
                  <span>
                    <b>{u.name || u.emp_id}{u.emp_id === me.emp_id && <span className="a-muted"> (you)</span>}</b>
                    <small>{u.emp_id}</small>
                    {u.left_company && <span className="a-warnbadge a-leftbadge" title="Inactive in dAdmin: cannot sign in">Left the company</span>}
                    {u.not_in_dadmin && <span className="a-warnbadge a-leftbadge" title="No dAdmin employee with this emp_id">Not in dAdmin</span>}
                  </span>
                </span>
              ) },
              { key: 'role', label: 'Role', render: (u) => (u.role_id ? <Pill tone={TOP_ROLES.includes(Number(u.role_id)) ? 'gold' : 'gray'}>{u.role_name}</Pill> : <span className="a-muted">no role</span>) },
              { key: 'godowns', label: 'Godowns', render: (u) => { const x = staffOf(u.emp_id); return x && (x.godowns === 'ALL' ? <Pill tone="good">Every godown</Pill> : godownsText(x.godowns, staffData.data.godowns)); } },
              { key: 'limit', label: 'Can sign up to', num: true, render: (u) => { const x = staffOf(u.emp_id); return x && <><b>{x.limit_text}</b><span className="a-sub-l">{x.limit_personal ? `personal, role is ${x.role_limit_text}` : 'role default'}</span></>; } },
              { key: 'driver', label: 'Driver', hideSm: true, render: (u) => { const x = staffOf(u.emp_id); return x && x.driver ? <Pill tone="info">Driver</Pill> : <span className="a-muted">-</span>; } },
              { key: 'status', label: 'State', render: (u) => stateCell(u, staffOf(u.emp_id)) },
            ]} />
        </div>
      </Loading>
      {open === 'add' && staffData.data && (
        <AddStaffDrawer roles={roles} me={me} meta={staffData.data} onClose={() => setOpen(null)}
          onSaved={(text, kind = 'ok') => { setOpen(null); act.setMsg({ kind, text }); reload(); }} />
      )}
      {open && open !== 'add' && staffOf(open) && staffData.data && (
        <StaffDrawer key={open} person={staffOf(open)} user={userOf(open)} meta={staffData.data} roles={roles}
          onClose={() => setOpen(null)} onSaved={(text) => { setOpen(null); act.setMsg({ kind: 'ok', text }); reload(); }} onChanged={reload} />
      )}
      {canSeeSettings && (
        <div className="a-listcard a-twostep-card">
          <h2>Two-step sign-in</h2>
          <p className="a-muted">Admin sign-in security (moved here from Site settings, phase 24). Turning it on needs the code e-mailed to you; turning it off waits for a second Admin.</p>
          <TwoStepSetting />
        </div>
      )}
    </section>
  );
}

const TOP_ROLES = [8, 1, 2]; // Super admin, Admin, Sub-admin: gold pills
function stateCell(u, x) {
  if (Number(u.pending_add) === 1) return <Pill tone="warn">{WAIT_TITLE}</Pill>;
  if (!u.is_active) return <><Pill tone="gray">Inactive</Pill>{u.left_on && <span className="a-sub-l">left on {u.left_on}</span>}</>;
  if (x && x.leave && x.leave.now) {
    return <><Pill tone="warn">On leave to {x.leave.to.slice(5)}</Pill>{x.leave.stand_in_name && <span className="a-sub-l">{x.leave.stand_in_name} stands in</span>}</>;
  }
  return (
    <>
      <Pill tone="good">Active</Pill>
      {x && x.leave && <span className="a-sub-l">leave {x.leave.from.slice(5)} to {x.leave.to.slice(5)}</span>}
      {x && x.stands_in_for.length > 0 && <span className="a-sub-l">standing in for {x.stands_in_for.map((y) => y.name).join(', ')}</span>}
    </>
  );
}

/** Add staff: an active dAdmin employee, a role, and the godowns they work at (default: where the adder works) */
function AddStaffDrawer({ roles, me, meta, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const [pick, setPick] = useState(null);
  const [role, setRole] = useState('3'); // Viewer (read only) until another is chosen
  const mineAll = meta.me.godowns === 'ALL';
  const [all, setAll] = useState(mineAll);
  const [gs, setGs] = useState(mineAll ? [] : meta.me.godowns);
  const roleOf = (id) => roles.find((r) => String(r.role_id) === String(id));
  const tick = (id, on) => setGs((x) => (on ? [...x, id].sort((a, b) => a - b) : x.filter((y) => y !== id)));
  const add = () => act.run(async () => {
    const out = await api.send('POST', '/users', { emp_id: pick.emp_id, role_id: Number(role) });
    const waits = toastWaiting(toast, out && out.waiting);
    const done = `${pick.name} ${waits ? 'added, waiting for a second Admin,' : 'added'} as ${(roleOf(role) || {}).name || 'the chosen role'}`;
    // the server gives a new person the adder's godowns; anything else is a second step on the person
    if (all === mineAll && (all || JSON.stringify(gs) === JSON.stringify(meta.me.godowns))) { onSaved(done); return; }
    try {
      const g = await api.send('PUT', `/staff/${encodeURIComponent(pick.emp_id)}`, { godowns: all ? 'ALL' : gs });
      toastWaiting(toast, g && g.waiting);
      onSaved(done);
    } catch (e) {
      onSaved(`${done}, but the godowns were not saved (${e.message}). Open the person to set them.`, 'error');
    }
  });
  return (
    <Drawer title="Add staff" sub="From dAdmin: they sign in with their dAdmin e-mail and password" onClose={onClose} dirty={Boolean(pick)}
      footer={<button type="button" className="a-btn" disabled={act.busy || !pick || (!all && !gs.length)} onClick={add}>Add</button>}>
      {act.note}
      <div className="a-addstaff">
        <EmployeePicker value={pick} onChange={setPick} />
        <label className="a-field"><span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>{giveable(roles, me).map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}</select>
          <small className="a-hint">{(roleOf(role) || {}).description}</small>
        </label>
      </div>
      <h3>Works at</h3>
      <div className="a-chkgrid">
        <label className="a-check"><input type="checkbox" checked={all} disabled={!meta.me.is_admin && !mineAll} onChange={(e) => setAll(e.target.checked)} /> Every godown (later ones too)</label>
        {!all && meta.godowns.filter((g) => g.is_active).map((g) => (
          <label key={g.godown_id} className="a-check"><input type="checkbox" checked={gs.includes(g.godown_id)} disabled={!meta.me.is_admin && !g.mine}
            onChange={(e) => tick(g.godown_id, e.target.checked)} /> {g.name} <code>{g.code}</code></label>
        ))}
      </div>
      <small className="a-hint">The approval limit, leave and stand-in are set on the person after the Add.</small>
    </Drawer>
  );
}

// the roles this person may give (Super admin never; Admin only by the Super admin; Sub-admin only by an Admin); keep: the current one
const giveable = (roles, me, keep) => roles.filter((r) => String(r.role_id) === String(keep)
  || (Number(r.role_id) !== 8 && (Number(r.role_id) !== 1 || Number(me.role_id) === 8) && (Number(r.role_id) !== 2 || me.is_admin)));
const godownsText = (g, all) => (g === 'ALL' ? 'Every godown' : (g || []).map((id) => (all.find((x) => x.godown_id === id) || {}).name || `#${id}`).join(', ') || 'No godown');

/** a person's panel: role, personal limit, godowns, leave and stand-in (each saved through PUT /staff/:emp) */
function StaffDrawer({ person: p, user, meta, roles, onClose, onSaved, onChanged }) {
  const act = useAction();
  const toast = useToast();
  const waitingAdd = Boolean(user && Number(user.pending_add) === 1);
  const confirm = useConfirm();
  const canEdit = useCan('users', 'edit');
  const self = p.emp_id === meta.me.emp_id;
  const locked = !canEdit || Boolean(p.locked);
  const leaveLocked = !canEdit || (Boolean(p.locked) && !self);
  const start = {
    role_id: String(p.role_id), limitKind: p.limit_personal ? p.limit.kind : 'role', limitAmount: p.limit_personal && p.limit.kind === 'amount' ? String(p.limit.amount) : '',
    all: p.godowns === 'ALL', godowns: p.godowns === 'ALL' ? [] : p.godowns, from: p.leave ? p.leave.from : '', to: p.leave ? p.leave.to : '', standIn: p.leave ? p.leave.standIn || '' : '',
  };
  const [f, setF] = useState(start);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const [cands, setCands] = useState(null);
  useEffect(() => {
    let gone = false;
    const qs = f.from && f.to ? `?from=${f.from}&to=${f.to}` : '';
    api.get(`/staff/${encodeURIComponent(p.emp_id)}/stand-ins${qs}`).then((r) => { if (!gone) setCands(r); }, () => { if (!gone) setCands([]); });
    return () => { gone = true; };
  }, [p.emp_id, f.from, f.to]);
  const save = () => act.run(async () => {
    const body = {};
    if (!locked) {
      if (f.role_id !== start.role_id) body.role_id = Number(f.role_id);
      if (f.limitKind !== start.limitKind || f.limitAmount !== start.limitAmount) body.limit = { kind: f.limitKind, amount: f.limitAmount };
      if (f.all !== start.all || JSON.stringify(f.godowns) !== JSON.stringify(start.godowns)) body.godowns = f.all ? 'ALL' : f.godowns;
    }
    if (!leaveLocked && (f.from !== start.from || f.to !== start.to || f.standIn !== start.standIn)) body.leave = f.from || f.to ? { from: f.from, to: f.to, stand_in: f.standIn || null } : null;
    const out = await api.send('PUT', `/staff/${encodeURIComponent(p.emp_id)}`, body);
    const waits = (out && out.waiting) || [];
    toastWaiting(toast, waits);
    if (waits.length) { onChanged(); onClose(); if (waits.length < Object.keys(body).length) toast('good', `${p.name}: the rest is saved`); return; }
    onSaved(`${p.name} saved`);
  });
  // Mark as left (v23 0.14, 0.35): their customers, open enquiries and follow-ups go to someone, and their godowns get a
  // new person in charge (the server refuses until both are chosen when needed); their leave and stand-ins end
  const [leaving, setLeaving] = useState(null); // null | { to, inCharge }
  const takers = (meta.staff || []).filter((x) => x.active && !x.pending && x.emp_id !== p.emp_id);
  const markLeft = () => act.run(async () => {
    const out = await api.send('PUT', `/users/${encodeURIComponent(p.emp_id)}`, { is_active: 0, hand_over_to: leaving.to || undefined, in_charge_to: leaving.inCharge || undefined });
    const h = out && out.handed_over;
    const moved = h ? [h.customers + h.enquiries + h.follow_ups ? `${h.customers} customers, ${h.enquiries} enquiries and ${h.follow_ups} follow-ups handed over` : '',
      h.godowns.length ? `in charge of ${h.godowns.join(', ')} changed` : '', h.stand_ins_ended ? `${h.stand_ins_ended} stand-in(s) ended` : ''].filter(Boolean).join('; ') : '';
    onSaved(`${p.name} marked as left${moved ? `: ${moved}` : ''}`);
  });
  const toggle = async () => {
    if (user.is_active) { setLeaving({ to: '', inCharge: '' }); return; }
    const ok = await confirm({ title: `Bring back ${p.name}?`, message: `They can sign in to dFresh admin again, as ${p.role_name}. If they can sign, this waits for a second Admin (the Super admin brings them back at once, as before).`, action: 'Bring back' });
    if (ok) {
      act.run(async () => {
        const out = await api.send('PUT', `/users/${encodeURIComponent(p.emp_id)}`, { is_active: 1 });
        if (toastWaiting(toast, out && out.waiting)) { onChanged(); onClose(); return; }
        onSaved(`${p.name} brought back`);
      });
    }
  };
  const canToggle = canEdit && !self && Boolean(user) && !p.locked && !waitingAdd; // a waiting add is decided in Approvals
  const tickGodown = (id, on) => set({ godowns: on ? [...f.godowns, id].sort((a, b) => a - b) : f.godowns.filter((x) => x !== id) });
  const whose = self ? 'your' : `${p.name}'s`;
  return (
    <Drawer title={p.name} sub={`${p.emp_id} · ${p.role_name}`} onClose={onClose} dirty={dirty}
      status={<>{waitingAdd ? <Pill tone="warn">{WAIT_TITLE}</Pill> : <Pill tone={p.active ? 'good' : 'gray'}>{p.active ? 'Active' : user && user.left_on ? `Left on ${user.left_on}` : 'Left'}</Pill>}<span className="a-custhead">signs up to {p.limit_text} · {godownsText(p.godowns, meta.godowns)}{p.see_cost ? ' · sees cost' : ''}</span></>}
      footer={(!(locked && leaveLocked) || canToggle) ? (
        <>
          {!(locked && leaveLocked) && <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>Save</button>}
          {canToggle && !leaving && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={toggle}>{user.is_active ? 'Mark as left' : 'Bring back'}</button>}
        </>
      ) : null}>
      {act.note}
      {waitingAdd && <Notice kind="warn">Waiting for a second Admin: {p.name} can sign, so their access starts when another Admin approves it in <Link to="/admin/approvals">Approvals</Link>. Until then they cannot sign in.</Notice>}
      {!waitingAdd && user && !user.is_active && user.left_on && <Notice kind="info">Left on {user.left_on}{user.left_by ? ` (marked by ${user.left_by})` : ''}.</Notice>}
      {p.locked && <Notice kind="info">{self ? `${p.locked} You can still enter your own leave.` : p.locked}</Notice>}
      {p.stands_in_for.length > 0 && <Notice kind="info">Stands in for {p.stands_in_for.map((x) => `${x.name} (${x.from} to ${x.to})`).join(', ')}.</Notice>}
      {leaving && (
        <div className="a-card a-leaving">
          <div className="a-cardh"><h2>Mark {p.name} as left</h2></div>
          <div className="a-cardb">
            <p className="a-hint">They can no longer sign in. Their customers, open enquiries and follow-ups go to the person you choose; the godowns they are in charge of get a new person in charge; their leave and any stand-in end.</p>
            <div className="a-grid2">
              <Field def={{ name: 'hand_over_to', label: 'Hand over to', type: 'select', options: takers.map((x) => ({ value: x.emp_id, label: `${x.name} (${x.role_name})` })),
                info: 'Their customers, open enquiries and open follow-ups. Needed when they have any.' }} value={leaving.to} onChange={(v) => setLeaving((x) => ({ ...x, to: v || '' }))} />
              <Field def={{ name: 'in_charge_to', label: 'New person in charge of their godowns', type: 'select', options: takers.map((x) => ({ value: x.emp_id, label: `${x.name} (${x.role_name})` })),
                info: 'Only when they are in charge of a godown: someone who works there.' }} value={leaving.inCharge} onChange={(v) => setLeaving((x) => ({ ...x, inCharge: v || '' }))} />
            </div>
            <div className="a-racts">
              <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setLeaving(null)}>Cancel</button>
              <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={markLeft}>Hand over and mark as left</button>
            </div>
          </div>
        </div>
      )}
      {p.dadmin && (
        <div className="a-dadmin">
          <h3>From dAdmin, read only</h3>
          <dl className="a-kv a-kvs">
            <dt>Employee ID</dt><dd><code>{p.emp_id}</code></dd>
            <dt>E-mail</dt><dd>{p.dadmin.email || '-'}</dd>
            <dt>Phone</dt><dd>{p.dadmin.phone || '-'}</dd>
            <dt>Last login</dt><dd>{p.last_login || 'Never'}</dd>
          </dl>
        </div>
      )}
      <h3>Role and limit</h3>
      <div className="a-grid2">
        <Field def={{ name: 'role', label: 'Role', type: 'select', allowEmpty: false, locked, options: giveable(roles, meta.me, p.role_id).map((r) => ({ value: String(r.role_id), label: r.name })) }}
          value={f.role_id} onChange={(v) => set({ role_id: v })} />
        <Field def={{ name: 'limit_kind', label: 'Approval limit', type: 'select', allowEmpty: false, locked, info: 'The most this person signs. Role default follows the role (Roles); a personal limit beats it.',
          options: [{ value: 'role', label: `Role default (${p.role_limit_text})` }, { value: 'none', label: 'Nothing' }, { value: 'amount', label: 'Up to an amount' }, { value: 'any', label: 'Anything' }] }}
          value={f.limitKind} onChange={(v) => set({ limitKind: v })} />
        {f.limitKind === 'amount' && <Field def={{ name: 'limit_amount', label: 'Up to (Rs)', type: 'number', min: 0, locked }} value={f.limitAmount} onChange={(v) => set({ limitAmount: v })} />}
      </div>
      <h3>Works at</h3>
      <div className="a-chkgrid">
        <label className="a-check"><input type="checkbox" checked={f.all} disabled={locked || (!meta.me.is_admin && meta.me.godowns !== 'ALL')} onChange={(e) => set({ all: e.target.checked })} /> Every godown (later ones too)</label>
        {!f.all && meta.godowns.filter((g) => g.is_active).map((g) => (
          <label key={g.godown_id} className="a-check"><input type="checkbox" checked={f.godowns.includes(g.godown_id)} disabled={locked || (!meta.me.is_admin && !g.mine)}
            onChange={(e) => tickGodown(g.godown_id, e.target.checked)} /> {g.name} <code>{g.code}</code></label>
        ))}
      </div>
      <h3>Leave and stand-in</h3>
      <div className="a-grid2">
        <label className="a-field"><span>From</span><input type="date" value={f.from} disabled={leaveLocked} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="a-field"><span>To</span><input type="date" value={f.to} min={f.from || undefined} disabled={leaveLocked} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="a-field a-wide"><span>Stand-in (signs with {whose} powers while away)</span>
          <select value={f.standIn} disabled={leaveLocked || !f.from} onChange={(e) => set({ standIn: e.target.value })}>
            <option value="">Nobody</option>
            {(cands || []).map((c) => <option key={c.emp_id} value={c.emp_id} disabled={Boolean(c.problem)}>{c.name} ({c.role_name}, {c.limit_text}){c.problem ? ' - cannot stand in' : ''}</option>)}
          </select>
          {(cands || []).some((c) => c.problem) && (
            <small className="a-hint">Cannot stand in: {(cands || []).filter((c) => c.problem).map((c) => c.problem).join(' ')}</small>
          )}
        </label>
      </div>
      {(f.from || f.to) && !leaveLocked && <button type="button" className="a-link" onClick={() => set({ from: '', to: '', standIn: '' })}>Remove the leave</button>}
      {user && (
        <>
          <h3>E-mail</h3>
          <p>{user.email || '-'}<NotifyMail u={user} canEdit={canEdit} act={act} onSaved={onChanged} /></p>
          <small className="a-hint">Added {fmtDate(user.created_at)} by {user.created_by || '-'}{(user.designation || user.department) ? ` · ${[user.designation, user.department].filter(Boolean).join(' · ')}` : ''}</small>
        </>
      )}
    </Drawer>
  );
}

/** the address staff notifications go to: the dAdmin e-mail unless another one is set */
function NotifyMail({ u, canEdit, act, onSaved }) {
  const [v, setV] = useState(null); // null = not editing
  const save = () => act.run(async () => {
    await api.send('PUT', `/users/${encodeURIComponent(u.emp_id)}`, { notify_email: v });
    setV(null); onSaved();
  }, `${u.name || u.emp_id}: notifications to ${v.trim() || 'the dAdmin e-mail'}`);
  if (v === null) {
    return (
      <small className="a-muted a-person-sub">Notifications: {u.notify_email || 'this e-mail'}
        {canEdit && <> <button type="button" className="a-link" onClick={() => setV(u.notify_email || '')}>Change</button></>}</small>
    );
  }
  return (
    <span className="a-inline a-person-sub">
      <input type="email" value={v} placeholder={u.email || 'e-mail'} aria-label={`Notification e-mail of ${u.name || u.emp_id}`} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={save}>Save</button>
      <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setV(null)}>Cancel</button>
    </span>
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
