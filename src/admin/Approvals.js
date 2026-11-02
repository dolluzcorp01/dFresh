// Approvals (docs/COMMERCE-SPEC.md 2): the pending queue (red badge in the menu: what you can decide),
// decided requests, and your own, one ApprovalCard each. Approve (note optional) or Reject (note required) on the card; a
// request you cannot decide says why (you raised it, your role is not an approver, no "approve" on that section). The thresholds
// and approver roles are in Commerce settings > Approvals.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { ApprovalCard, Empty, InfoCard, Loading, PageHead, Tabs, fmtDate, useAction, useLoad } from './ui';

const TABS = [['pending', 'Pending'], ['decided', 'Decided'], ['mine', 'My requests']];

export default function Approvals({ onChanged }) {
  const [tab, setTab] = useState('pending');
  const data = useLoad(`/approvals?status=${tab}`);
  const act = useAction();
  const rows = (data.data && data.data.rows) || [];
  const decide = (r, decision, note) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/decide`, { decision, note });
    data.reload(); if (onChanged) onChanged();
    return true;
  }, decision === 'approved' ? `Approved: ${r.summary}` : `Rejected: ${r.summary}`);
  const withdraw = (r) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/withdraw`);
    data.reload(); if (onChanged) onChanged();
  }, 'Withdrawn');

  return (
    <section>
      <PageHead sub="Requests waiting for a yes or no, with who asked, the amount and who can sign." />
      <InfoCard title="Actions that wait for a second person">
        <ul>
          <li>Large refunds, returns outside the window, "No refund" decisions, rechecks of returned stock, stock write-offs, big discounts, cancelling after dispatch, goodwill wallet credit, credit limit raises and prices below the list can need approval.</li>
          <li>The approver needs an approver role and &quot;approve&quot; on the section. Nobody approves their own request. A reject needs a note.</li>
          <li>Thresholds and approver roles: <Link to="/admin/commerce-settings#cs-g-approvals">Commerce settings &gt; Approvals</Link>. Requests expire after the days set there.</li>
        </ul>
      </InfoCard>
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label, count: key === 'pending' && tab === 'pending' ? rows.length : 0 }))} value={tab} onChange={setTab} label="Requests" />
      {act.note}
      <Loading state={data}>
        {!rows.length ? <div className="a-card a-card-flush"><Empty icon="clipboard-check" title={tab === 'pending' ? 'Nothing is waiting for approval.' : 'No requests.'} /></div> : (
          <div className="a-approvals">
            {rows.map((r) => (
              <ApprovalCard key={r.approval_id} r={r} busy={act.busy} fmtDate={fmtDate}
                onDecide={(decision, note) => decide(r, decision, note)} onWithdraw={() => withdraw(r)} />
            ))}
          </div>
        )}
      </Loading>
    </section>
  );
}
