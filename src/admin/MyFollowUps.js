// Sales > Leads > Follow-ups (API /commerce/follow-ups; the old My follow-ups): the open follow-ups assigned to me, overdue first (red), with
// Done (and an outcome) or Snooze; a role with edit on Customers can switch to everyone's. A customer opens its drawer.
import { useState } from 'react';
import { InfoCard, Loading, PageHead, useCan, useLoad } from './ui';
import CustomerDrawer, { FollowUpList } from './CustomerDrawer';

export default function MyFollowUps() {
  const canAll = useCan('customers', 'edit');
  const [all, setAll] = useState(false);
  const list = useLoad(`/commerce/follow-ups${all ? '?all=1' : ''}`);
  const [open, setOpen] = useState(null);
  const d = list.data;
  const overdue = d ? d.rows.filter((r) => r.overdue).length : 0;
  return (
    <section>
      <PageHead sub="Calls and visits you said you would make, overdue first." />
      <InfoCard title="Calls and visits to make">
        <ul>
          <li>Follow-ups are added on a customer (Sales &gt; Customers &gt; Customer list, open it &gt; Follow-ups). Overdue ones are red and counted on Operations.</li>
          <li>Done closes it (with what came of it); Snooze moves the due date. Both show on the customer&apos;s timeline.</li>
        </ul>
      </InfoCard>
      {canAll && (
        <div className="a-chips" role="group" aria-label="Whose">
          <button type="button" className={`a-chip${!all ? ' on' : ''}`} onClick={() => setAll(false)}>Mine</button>
          <button type="button" className={`a-chip${all ? ' on' : ''}`} onClick={() => setAll(true)}>Everyone&apos;s</button>
        </div>
      )}
      <Loading state={list}>
        {d && (
          <>
            <p className={overdue ? 'a-bad' : 'a-muted'}>{d.rows.length} open, {overdue} overdue.</p>
            <FollowUpList rows={d.rows} people={d.people} onChanged={list.reload} onOpen={setOpen} />
          </>
        )}
      </Loading>
      {open && <CustomerDrawer id={open} onClose={() => { setOpen(null); list.reload(); }} onChanged={list.reload} />}
    </section>
  );
}
