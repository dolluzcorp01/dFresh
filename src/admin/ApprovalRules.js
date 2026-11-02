// Admin > Users and security > Approval rules (phase 12a, gap map D4; API /approval-rules in foundation.js), as v23:
// one row per kind of request, grouped by the section whose Approve right signs it - needs approval on / off, and the
// size above which it does: an amount (Rs; Stock write-off also a number of packs), a percent, or every one - and who
// can sign it today (Approve on its section, a limit that covers it, not on leave). The three locked rules (a company
// bank change, a supplier bank change, weakening a rule) are always on. Only an Admin changes a rule; changes wait in
// the Save bar (Save / Cancel changes) and each one is audited. Who can sign up to how much: Roles and Staff.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, Notice, PageHead, useAction, useLeaveGuard, useLoad } from './ui';

export default function ApprovalRules() {
  const data = useLoad('/approval-rules');
  const act = useAction();
  const [pending, setPending] = useState({}); // kind -> { is_on, limit_value, limit_packs }
  const changes = Object.keys(pending);
  useLeaveGuard(changes.length > 0);
  const d = data.data;
  const valueOf = (r) => pending[r.kind] || { is_on: r.is_on, limit_value: r.limit_value ?? '', limit_packs: r.limit_packs ?? '' };
  const edit = (r, patch) => setPending((p) => {
    const next = { ...valueOf(r), ...patch };
    const n = { ...p };
    const same = Boolean(next.is_on) === Boolean(r.is_on) && String(next.limit_value) === String(r.limit_value ?? '') && String(next.limit_packs) === String(r.limit_packs ?? '');
    if (same) delete n[r.kind]; else n[r.kind] = next;
    return n;
  });
  // one PUT per changed rule, in order; a refused rule stays pending with the server's reason
  const save = () => act.run(async () => {
    for (const kind of changes) {
      const r = d.rules.find((x) => x.kind === kind);
      const v = pending[kind];
      const body = { is_on: v.is_on ? 1 : 0 };
      if (r.unit !== 'all') body.limit_value = v.limit_value;
      if (r.limit_packs !== null) body.limit_packs = v.limit_packs;
      try {
        await api.send('PUT', `/approval-rules/${kind}`, body);
      } catch (e) {
        data.reload();
        throw new Error(`${r.label}: ${e.message}`);
      }
      setPending((p) => { const n = { ...p }; delete n[kind]; return n; });
    }
    data.reload();
  }, `${changes.length} rule${changes.length === 1 ? '' : 's'} saved`);
  const sections = d ? d.sections.filter((s) => d.rules.some((r) => r.section === s.key)) : [];
  const ro = !d || !d.can_edit || act.busy;
  return (
    <section>
      <PageHead sub="What needs a second person's yes, up to what amount"
        rules={['Off = done straight away, with a line in the audit log', d ? `${d.rules.length} rules` : 'Rules', 'Only an Admin changes these']} />
      <p className="a-lead">Which actions need a second person, and from what size. Who may sign is decided by roles (the Approve tick) and limits (the money): <Link to="/admin/roles">Roles</Link>, <Link to="/admin/users">Staff</Link>.</p>
      {act.note}
      {d && !d.can_edit && <Notice kind="info">View only: only an Admin changes the approval rules.</Notice>}
      <Loading state={data}>
        {d && (
          <div className="a-listcard">
            <div className="a-scroll">
              <table className="a-table a-rules">
                <thead><tr><th>Action</th><th>Needs approval</th><th className="a-num">Above</th><th>Who can sign today</th></tr></thead>
                {sections.map((s) => (
                  <tbody key={s.key}>
                    <tr className="a-grp-row"><td colSpan={4}>{s.label}</td></tr>
                    {d.rules.filter((r) => r.section === s.key).map((r) => {
                      const v = valueOf(r);
                      return (
                        <tr key={r.kind} className={pending[r.kind] ? 'a-pending' : undefined}>
                          <td><b>{r.label}</b>{r.limit_packs !== null && <span className="a-note-l">Needs approval above the amount, or above the number of packs</span>}</td>
                          <td>
                            <span className="a-switch-row">
                              <button type="button" role="switch" aria-checked={Boolean(r.locked || v.is_on)} aria-label={`${r.label}: needs approval`} className="a-switch"
                                disabled={ro || Boolean(r.locked)} title={r.locked ? 'Can never be switched off' : undefined}
                                onClick={() => edit(r, { is_on: !v.is_on })}><span className="a-switch-knob" aria-hidden="true" /></button>
                              {r.locked ? <small className="a-muted">Always on</small> : !v.is_on && <small className="a-muted">Off</small>}
                            </span>
                          </td>
                          <td className="a-num">
                            {r.unit === 'all' ? <span className="a-muted">every one</span> : (
                              <span className="a-above">
                                {r.unit === 'Rs' && <span>Rs</span>}
                                <input type="number" min="0" step="any" className="a-numin" aria-label={`${r.label}: above`} value={v.limit_value} disabled={ro}
                                  onChange={(e) => edit(r, { limit_value: e.target.value })} />
                                {r.unit === '%' && <span>%</span>}
                              </span>
                            )}
                            {r.limit_packs !== null && (
                              <span className="a-above a-person-sub">or
                                <input type="number" min="0" step="1" className="a-numin" aria-label={`${r.label}: packs`} value={v.limit_packs} disabled={ro}
                                  onChange={(e) => edit(r, { limit_packs: e.target.value })} /> packs</span>
                            )}
                          </td>
                          <td className="a-signers">
                            {r.signers.length ? r.signers.map((p, i) => <span key={p.emp_id}>{i > 0 && ', '}{p.name} <small>({p.limit_text})</small></span>)
                              : <span className="a-bad">Nobody today</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        )}
      </Loading>
      {changes.length > 0 && (
        <div className="a-savebar" role="status">
          <span><b>{changes.length}</b> rule{changes.length === 1 ? '' : 's'} changed, not saved yet</span>
          <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setPending({})}>Cancel changes</button>
          <button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save</button>
        </div>
      )}
      {d && (
        <InfoCard title="How a request finds its signer">
          <ul>
            <li>Each request goes to the people whose role can Approve its section, who work at its godown, and whose limit covers the amount.</li>
            <li>Requests of one kind for one customer, supplier or payee in the last {d.split_days} days count together before a money limit; a request waits {d.expiry_days} days, then expires (<Link to="/admin/commerce-settings#cs-g-approvals">Switches</Link>).</li>
            <li>Always on: a company bank change, a supplier bank change and weakening a rule can never be switched off.</li>
          </ul>
        </InfoCard>
      )}
    </section>
  );
}
