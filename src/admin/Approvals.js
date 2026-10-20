// Setup > Approvals (docs/COMMERCE-SPEC.md 2): the pending queue (red badge in the menu: what you can decide),
// decided requests, and your own. Approve (note optional) or Reject (note required) right in the row; a request you
// cannot decide says why (you raised it, your role is not an approver, no "approve" on that section). The thresholds
// and approver roles are in Commerce settings > Approvals.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, fmtDate, useAction, useLoad } from './ui';

const TABS = [['pending', 'Pending'], ['decided', 'Decided'], ['mine', 'My requests']];
const rs = (n) => (n === null || n === undefined ? '' : `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function Approvals({ onChanged }) {
  const [tab, setTab] = useState('pending');
  const data = useLoad(`/approvals?status=${tab}`);
  const act = useAction();
  const [open, setOpen] = useState(null); // { id, decision }
  const [note, setNote] = useState('');
  const rows = (data.data && data.data.rows) || [];
  const decide = (r, decision) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/decide`, { decision, note });
    setOpen(null); setNote(''); data.reload(); if (onChanged) onChanged();
  }, decision === 'approved' ? `Approved: ${r.summary}` : `Rejected: ${r.summary}`);
  const withdraw = (r) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/withdraw`);
    data.reload(); if (onChanged) onChanged();
  }, 'Withdrawn');

  return (
    <section>
      <h1>Approvals</h1>
      <InfoCard title="Actions that wait for a second person">
        <ul>
          <li>Large refunds, stock write-offs, big discounts, cancelling after dispatch, goodwill wallet credit, credit limit raises and prices below the list can need approval.</li>
          <li>The approver needs an approver role and &quot;approve&quot; on the section. Nobody approves their own request. A reject needs a note.</li>
          <li>Thresholds and approver roles: <Link to="/admin/commerce-settings#group-Approvals">Commerce settings &gt; Approvals</Link>. Requests expire after the days set there.</li>
        </ul>
      </InfoCard>
      <div className="a-chips" role="tablist" aria-label="Requests">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => { setTab(k); setOpen(null); }}>{l}</button>)}
      </div>
      {act.note}
      <Loading state={data}>
        {!rows.length ? <p className="a-muted">{tab === 'pending' ? 'Nothing is waiting for approval.' : 'No requests.'}</p> : (
          <div className="a-approvals">
            {rows.map((r) => (
              <div key={r.approval_id} className={`a-card a-approval a-approval-${r.status}`}>
                <div className="a-approval-head">
                  <span className="a-status a-status-off">{r.kind_label}</span>
                  <b>{r.summary}</b>
                  {r.amount !== null && <span className="a-approval-amt">{rs(r.amount)}</span>}
                  <span className={`a-status a-ap-${r.status}`}>{r.status}</span>
                </div>
                <p className="a-muted">
                  Asked by <code>{r.requested_by}</code>{r.mine ? ' (you)' : ''}, {fmtDate(r.requested_at)}
                  {r.decided_by && <> - {r.status} by <code>{r.decided_by}</code>, {fmtDate(r.decided_at)}</>}
                  {r.note && <> - &quot;{r.note}&quot;</>}
                </p>
                {r.status === 'pending' && (
                  r.can_decide ? (
                    open && open.id === r.approval_id ? (
                      <div className="a-approval-decide">
                        <label className="a-field"><span>{open.decision === 'rejected' ? 'Why is it rejected? (required)' : 'Note (optional)'}</span>
                          <textarea rows={2} value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} />
                        </label>
                        <span className="a-row">
                          <button type="button" className={`a-btn${open.decision === 'rejected' ? ' a-btn-danger' : ''}`} disabled={act.busy || (open.decision === 'rejected' && !note.trim())}
                            onClick={() => decide(r, open.decision)}>{open.decision === 'rejected' ? 'Reject' : 'Approve'}</button>
                          <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => { setOpen(null); setNote(''); }}>Cancel</button>
                        </span>
                      </div>
                    ) : (
                      <span className="a-row">
                        <button type="button" className="a-btn a-btn-sm" onClick={() => { setOpen({ id: r.approval_id, decision: 'approved' }); setNote(''); }}>Approve</button>
                        <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { setOpen({ id: r.approval_id, decision: 'rejected' }); setNote(''); }}>Reject</button>
                      </span>
                    )
                  ) : (
                    <p className="a-muted a-approval-why">You cannot decide this: {r.why_not}.
                      {r.mine && <> <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => withdraw(r)}>Withdraw my request</button></>}
                    </p>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </Loading>
    </section>
  );
}
