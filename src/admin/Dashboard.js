// Dashboard (spec F 1): "Attention needed" first (only what applies, every line a link to where it is fixed; a calm
// "All good" when nothing is), then the counters (leads today / 7 days / by form, outbox health, translations per
// language) and quick-jump tiles for the sidebar groups. Lines for screens a role cannot open are left out.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { Loading, useAdmin, useCan, useLoad } from './ui';
import Icon from './icons';
import { groupsFor } from './Sidebar';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const names = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** [{ key, text, to, kind: 'bad' | 'warn' }] for the attention panel. */
function attentionLines(d, isAdmin) {
  const a = d.attention || {};
  const out = [];
  if (a.staleNew > 0) {
    out.push({ key: 'stale', kind: 'bad', to: '/admin/leads?status=new&age=24h', text: `${plural(a.staleNew, 'new lead', 'new leads')} not handled for more than 24 hours` });
  }
  if (a.failed && (a.failed.mail > 0 || a.failed.sync > 0)) {
    const parts = [a.failed.mail > 0 && plural(a.failed.mail, 'e-mail', 'e-mails'), a.failed.sync > 0 && plural(a.failed.sync, 'Google Sheet row', 'Google Sheet rows')].filter(Boolean);
    out.push({ key: 'failed', kind: 'bad', to: '/admin/leads?outbox=failed', text: `${names(parts)} failed to send (${plural(a.failed.leads, 'lead', 'leads')}): retry them from the lead` });
  }
  if (isAdmin && d.mailLogo && d.mailLogo.state === 'failing') {
    out.push({ key: 'logo', kind: 'bad', to: '/admin/settings#setting-mail_logo_url', text: `E-mail logo URL is not reachable - mails use the built-in logo${d.mailLogo.reason ? ` (${d.mailLogo.reason})` : ''}` });
  }
  for (const f of (d.fonts || []).filter((x) => x.status === 'full')) {
    out.push({ key: `font-${f.family}`, kind: 'warn', to: '/admin/languages', text: `The ${f.script} font could not be rebuilt - the full font is used for now (it retries by itself)` });
  }
  // the privacy / terms bodies are English by rule: not counted here (the Translations card shows every gap)
  for (const l of (d.languages || []).filter((x) => x.missing - (x.legalMissing || 0) > 0)) {
    const n = l.missing - (l.legalMissing || 0);
    out.push({
      key: `tr-${l.lang_code}`, kind: Number(l.is_active) ? 'warn' : 'info', to: `/admin/translations?lang=${encodeURIComponent(l.lang_code)}&missing=1`,
      text: `${l.name_en}: ${plural(n, 'text', 'texts')} not translated yet${Number(l.is_active) ? ' (English is shown instead)' : ' (language switched off)'}`,
    });
  }
  if (isAdmin) {
    const empty = (a.emptySettings || []);
    if (empty.includes('gstin')) out.push({ key: 'gstin', kind: 'info', to: '/admin/settings#setting-gstin', text: 'GSTIN is still empty - the footer leaves it out until it is filled' });
    if (empty.includes('ga4_measurement_id')) out.push({ key: 'ga4', kind: 'info', to: '/admin/settings#setting-ga4_measurement_id', text: 'Google Analytics (GA4) id is still empty - no visits are counted' });
  }
  const missing = a.noBrochure || [];
  if (missing.length) {
    const def = missing.find((l) => l.is_default);
    out.push({
      key: 'brochure', kind: def ? 'bad' : 'warn', to: '/admin/brochures',
      text: `No brochure PDF for ${names(missing.map((l) => l.name_en))}${def ? ' - brochure requests get "being finalised" until it is uploaded' : ' - those visitors get the default language\'s brochure'}`,
    });
  }
  return out;
}

export default function Dashboard() {
  const s = useLoad('/dashboard');
  const { me, leadsVersion } = useAdmin();
  // Live: new leads (AdminApp polls) refresh the counts and the attention panel quietly, without a loading state
  useEffect(() => {
    if (!leadsVersion) return undefined;
    let alive = true;
    api.get('/dashboard').then((d) => { if (alive) s.setData(d); }, () => {});
    return () => { alive = false; };
  }, [leadsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const isAdmin = useCan('admin');
  const d = s.data;
  const lines = d ? attentionLines(d, isAdmin) : [];
  return (
    <section>
      <h1>Dashboard</h1>
      <Loading state={s}>
        {d && (
          <>
            <div className={`a-attn${lines.length ? '' : ' a-attn-ok'}`} role="region" aria-labelledby="a-attn-h">
              <h2 id="a-attn-h">{lines.length ? 'Attention needed' : 'All good'}</h2>
              {lines.length ? (
                <ul>
                  {lines.map((l) => (
                    <li key={l.key} className={`a-attn-${l.kind}`}>
                      <Link to={l.to}><span className="a-attn-dot" aria-hidden="true" />{l.text}<Icon name="chevron" className="a-attn-go" /></Link>
                    </li>
                  ))}
                </ul>
              ) : <p>Nothing needs attention: leads are handled, e-mails and sheet rows are sent, texts are translated and the setup is complete.</p>}
            </div>
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
                  <tbody>{(d.languages || []).map((l) => (
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
            <h2 className="a-jump-h">Go to</h2>
            <div className="a-jump">
              {groupsFor(me.role).map((g) => (
                <div className="a-jump-tile" key={g.key}>
                  <Link className="a-jump-title" to={`/admin/${g.items[0].path}`}><Icon name={g.icon} />{g.label}</Link>
                  <ul>{g.items.map((it) => <li key={it.path}><Link to={`/admin/${it.path}`}>{it.label}</Link></li>)}</ul>
                </div>
              ))}
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
