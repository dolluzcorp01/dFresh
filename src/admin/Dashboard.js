// Dashboard: leads today / 7 days / by form, outbox health, missing translations per language (spec F 1).
import { Link } from 'react-router-dom';
import { Loading, useLoad } from './ui';

export default function Dashboard() {
  const s = useLoad('/dashboard');
  const d = s.data;
  return (
    <section>
      <h1>Dashboard</h1>
      <Loading state={s}>
        {d && (
          <>
            <div className="a-tiles">
              <Tile label="Leads today" value={d.leads.today} to="/admin/leads" />
              <Tile label="Leads last 7 days" value={d.leads.last7} to="/admin/leads" />
              <Tile label="New (not handled)" value={d.leads.open_new} to="/admin/leads?status=new" />
              <Tile label="Mail pending / failed" value={`${d.outbox.mail.pending || 0} / ${d.outbox.mail.failed || 0}`} warn={d.outbox.mail.failed > 0} />
              <Tile label="Sheet pending / failed" value={`${d.outbox.sync.pending || 0} / ${d.outbox.sync.failed || 0}`} warn={d.outbox.sync.failed > 0} />
            </div>
            <div className="a-cols">
              <div className="a-card">
                <h2>Leads by form (7 days)</h2>
                {d.byForm.length ? (
                  <table className="a-table"><tbody>{d.byForm.map((r) => <tr key={r.form_type}><td>{r.form_type}</td><td className="a-num">{r.n}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">No leads in the last 7 days.</p>}
              </div>
              <div className="a-card">
                <h2>Translations</h2>
                <table className="a-table">
                  <thead><tr><th>Language</th><th>Complete</th><th>Missing</th></tr></thead>
                  <tbody>{d.languages.map((l) => (
                    <tr key={l.lang_code}>
                      <td>{l.name_en} <code>{l.lang_code}</code>{Number(l.is_active) ? '' : ' (off)'}</td>
                      <td className="a-num">{l.pct}%</td>
                      <td className={`a-num${l.missing ? ' a-bad' : ''}`}>{l.missing}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p><Link to="/admin/translations">Open translations</Link></p>
              </div>
            </div>
          </>
        )}
      </Loading>
    </section>
  );
}

function Tile({ label, value, to, warn }) {
  const body = <><span className="a-tile-v">{value}</span><span className="a-tile-l">{label}</span></>;
  return to ? <Link className={`a-tile${warn ? ' a-warn' : ''}`} to={to}>{body}</Link> : <div className={`a-tile${warn ? ' a-warn' : ''}`}>{body}</div>;
}
