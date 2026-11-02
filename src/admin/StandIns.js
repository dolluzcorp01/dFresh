// Admin > Users and security > Stand-ins (phase 12a; API /stand-ins in foundation.js), as v23: who is on leave today or
// later, their dates, who stands in for them (and what the stand-in signs up to) and whether the leave runs today.
// Someone on leave signs nothing; their requests go to the stand-in, who signs with their powers (Approvals names
// both). Leave and the stand-in are set on the person in Staff (a click on a row opens Staff).
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, InfoCard, Loading, PageHead, Pill, Table, useLoad } from './ui';

export default function StandIns() {
  const data = useLoad('/stand-ins');
  const navigate = useNavigate();
  const d = data.data;
  return (
    <section>
      <PageHead sub="Who approves when someone is on leave"
        rules={['Someone on leave signs nothing', "The stand-in signs with the absent person's rights and limit", 'The audit log names both']} />
      <p className="a-lead">Who approves when someone is on leave. A leave and its stand-in are set on the person, in <Link to="/admin/users">Staff</Link>; this page shows them all in one place. Click a row to change it.</p>
      <Loading state={data}>
        {d && (
          <div className="a-listcard">
            <div className="a-countline"><b>{d.rows.length}</b> leave set · today is {d.today}</div>
            <Table label="Leave and stand-ins" rows={d.rows} rowKey={(r) => r.emp_id} onRowClick={() => navigate('/admin/users')}
              empty={{ icon: 'users', title: 'Nobody is on leave today or later', text: 'Leave is set on the person in Staff.' }}
              columns={[
                { key: 'name', label: 'On leave', sort: true, render: (r) => (
                  <span className="a-person2"><Avatar name={r.name} /><span><b>{r.name}</b><small>{r.emp_id}</small></span></span>
                ) },
                { key: 'from', label: 'Dates', sort: true, render: (r) => `${r.from} to ${r.to}` },
                { key: 'stand_in_name', label: 'Stand-in', render: (r) => (r.stand_in_name ? (
                  <>
                    <span className="a-person2"><Avatar name={r.stand_in_name} /><span><b>{r.stand_in_name}</b><small>{r.stand_in}</small></span></span>
                    <span className="a-sub-l">signs up to {r.stand_in_limit_text}</span>
                    {r.stand_in_problem && <small className="a-bad a-person-sub">Cannot sign for them now: {r.stand_in_problem}</small>}
                  </>
                ) : <span className="a-muted">nobody</span>) },
                { key: 'now', label: 'State', render: (r) => <><Pill tone={r.now ? 'warn' : 'gray'}>{r.now ? 'On leave today' : 'Coming'}</Pill>{r.set_by_name && <span className="a-sub-l">entered by {r.set_by_name}</span>}</> },
              ]} />
          </div>
        )}
      </Loading>
      <InfoCard title="Who can stand in">
        <p>A stand-in must already approve every section the absent person approves, with at least the same limit, and must not be on leave on those dates. An Admin&apos;s leave is entered by that Admin, or by another Admin at least 2 days ahead and for at most 30 days.</p>
      </InfoCard>
    </section>
  );
}
