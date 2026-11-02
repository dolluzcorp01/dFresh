// Approvals (docs/COMMERCE-SPEC.md 2): the pending queue (red badge in the menu: what you can decide),
// decided requests, and your own, one ApprovalCard each. Approve (note optional) or Reject (note required) on the card; a
// request you cannot decide says why. Each card shows who can sign it (the ladder of approvals.js: Approve on the section, the
// godown, a limit that covers the amount, not on leave; "Approve for X" as X's stand-in). Rules: Admin > Approval rules.
// Phase 12b: an Admin overrides a waiting rule change when every other Admin is away (applies 24 hours later unless an
// Admin cancels it), and the person who raised an expired request sends it again. Pending is grouped as v23: Waiting for
// you, Raised by you, and (Super admin, Admin, Sub-admin: they see every request) Everything else waiting.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { ApprovalCard, Empty, InfoCard, Loading, PageHead, Pill, Tabs, fmtDate, useAction, useAdmin, useConfirm, useLoad } from './ui';

const TABS = [['pending', 'Pending'], ['decided', 'Decided'], ['mine', 'My requests']];
const RULES = ['Nobody signs their own', 'You sign inside your sections, godowns and limit', "A stand-in signs with the absent person's limit"];

/** the pending queue as v23's three lists */
function groups(rows, seesAll) {
  const out = [
    { key: 'you', title: 'Waiting for you', tone: 'gold', empty: 'Nothing is waiting for your signature.', rows: rows.filter((r) => r.can_decide) },
    { key: 'mine', title: 'Raised by you', tone: 'info', empty: 'You have not asked for anything.', rows: rows.filter((r) => r.mine && !r.can_decide) },
  ];
  if (seesAll) out.push({ key: 'else', title: 'Everything else waiting', tone: 'gray', empty: 'Nothing else is waiting.', rows: rows.filter((r) => !r.can_decide && !r.mine) });
  return out;
}

export default function Approvals({ onChanged }) {
  const [tab, setTab] = useState('pending');
  const data = useLoad(`/approvals?status=${tab}`);
  const act = useAction();
  const confirm = useConfirm();
  const rows = (data.data && data.data.rows) || [];
  const { me } = useAdmin();
  const seesAll = Boolean(me && [8, 1, 2].includes(Number(me.role_id))); // Super admin, Admin, Sub-admin (approvals.js list)
  const decide = (r, decision, note) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/decide`, { decision, note });
    data.reload(); if (onChanged) onChanged();
    return true;
  }, decision === 'approved' ? `Approved: ${r.summary}` : `Rejected: ${r.summary}`);
  const withdraw = (r) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/withdraw`);
    data.reload(); if (onChanged) onChanged();
  }, 'Withdrawn');
  const changed = () => { data.reload(); if (onChanged) onChanged(); };
  const override = (r, reason) => act.run(async () => {
    await api.send('POST', `/approvals/${r.approval_id}/override`, { reason });
    changed();
    return true;
  }, 'Override set: it applies in 24 hours unless an Admin cancels it');
  const cancelOverride = async (r) => {
    const ok = await confirm({ title: 'Cancel the override?', message: `"${r.summary}" waits for a second Admin again. Every Admin is told.`,
      action: 'Cancel override', cancel: 'Keep it', danger: true, reason: { label: 'Note (optional)' } });
    if (ok) act.run(async () => { await api.send('POST', `/approvals/${r.approval_id}/override/cancel`, { note: ok.reason }); changed(); }, 'Override cancelled');
  };
  const sendAgain = (r) => act.run(async () => {
    const out = await api.send('POST', `/approvals/${r.approval_id}/again`);
    changed();
    return out;
  }).then((out) => { if (out) act.setMsg({ kind: 'ok', text: `Sent again as request ${out.approval_id}` }); });

  const cards = (list) => (
    <div className="a-approvals">
      {list.map((r) => (
        <ApprovalCard key={r.approval_id} r={r} busy={act.busy} fmtDate={fmtDate}
          onDecide={(decision, note) => decide(r, decision, note)} onWithdraw={() => withdraw(r)}
          onOverride={(reason) => override(r, reason)} onCancelOverride={() => cancelOverride(r)} onSendAgain={() => sendAgain(r)} />
      ))}
    </div>
  );

  return (
    <section>
      <PageHead sub="Requests waiting for your yes or no" rules={RULES} />
      <p className="a-lead">{seesAll ? 'You see every request in the company. "Waiting for you" are the ones you can sign now.'
        : 'You see only the requests you can sign and the ones you raised. Super admin, Admin and Sub-admin see everything.'}</p>
      <InfoCard title="Actions that wait for a second person">
        <ul>
          <li>Large refunds, returns outside the window, "No refund" decisions, rechecks of returned stock, stock write-offs, big discounts, cancelling after dispatch, goodwill wallet credit, credit limit raises and prices below the list can need approval.</li>
          <li>A request waits for the people whose role can Approve its section, who work at its godown, and whose limit covers the amount (the card shows them, smallest limit first). Nobody signs their own request; someone on leave signs nothing and their stand-in signs for them. A reject needs a note.</li>
          <li>A request nobody decides in time expires; the person who raised it can Send again. A rule change waits for a second Admin; when every other Admin is away, an Admin can override it with a reason: it applies 24 hours later unless an Admin cancels it.</li>
          <li>Requests of one kind for one customer, supplier or payee count together over a few days before a limit. What needs approval and above what: <Link to="/admin/approval-rules">Approval rules</Link>; who signs how much: <Link to="/admin/roles">Roles</Link> and <Link to="/admin/users">Staff</Link>.</li>
        </ul>
      </InfoCard>
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label, count: key === 'pending' && tab === 'pending' ? rows.length : 0 }))} value={tab} onChange={setTab} label="Requests" />
      {act.note}
      <Loading state={data}>
        {tab === 'pending' ? groups(rows, seesAll).map((g) => (
          <div key={g.key} className="a-card a-rqgroup">
            <div className="a-cardh"><h2>{g.title}</h2><Pill tone={g.rows.length ? g.tone : 'gray'}>{g.rows.length}</Pill></div>
            <div className="a-cardb">{g.rows.length ? cards(g.rows) : <p className="a-muted">{g.empty}</p>}</div>
          </div>
        )) : !rows.length ? <div className="a-card a-card-flush"><Empty icon="clipboard-check" title="No requests." /></div> : cards(rows)}
      </Loading>
    </section>
  );
}
