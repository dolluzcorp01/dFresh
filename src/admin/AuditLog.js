// Admin > Users and security > Audit log (v23 Audit log; API GET /audit, /audit/mine, /audit/export.csv in Admin_server.js,
// screens and who sees what in src/backend_routes/audit.js). One log for every section: when, who, the screen, what, and
// the old value struck through next to the new one.
// - Super admin and Admin: every change, the "Everybody" list, Export CSV (exactly the rows the filters give; the export
//   itself is logged).
// - A role with View on Audit log (Sub-admin): every screen of the sections it may view, never Company; no export.
// - Everybody else: only the changes they made themselves, no "Everybody" list.
// Filters: search, person, screen, From / To (India days) and Clear. Nobody can edit or clear the log.
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Alert, Loading, LIcon, PageHead, Table, fmtDate, useAction, useCan, useLoad, useToast } from './ui';

const LIMIT = 50;
const EMPTY = { q: '', emp: '', screen: '', from: '', to: '' };
const NOTE = {
  all: 'You see every change in every section.',
  sections: 'You see every change of the sections your role may view, except Company (bank, GSTIN), which is for the Super admin and Admin only.',
  own: 'You see only the changes you made yourself.',
};

/** the old value struck through and the new value, one line per field that changed; past 2 lines, "+N more" opens the rest (v23: compact rows) */
function Change({ changes }) {
  const [all, setAll] = useState(false);
  if (!changes.length) return <span className="a-muted">-</span>;
  const shown = all ? changes : changes.slice(0, 2);
  return <>{shown.map((c, i) => (
    // eslint-disable-next-line react/no-array-index-key
    <div key={`${c.field}-${i}`} className="a-au-ch">
      {c.field && <span className="a-au-f">{c.field}</span>}
      {c.from !== null && <s>{c.from}</s>}
      {c.from !== null && c.to !== null && ' '}
      {c.to !== null && <ins>{c.to}</ins>}
    </div>
  ))}
  {changes.length > 2 && <button type="button" className="a-link a-au-more" onClick={() => setAll((x) => !x)}>{all ? 'Show less' : `+${changes.length - 2} more`}</button>}</>;
}

export default function AuditLog() {
  const full = useCan('audit', 'view');
  const [f, setF] = useState(EMPTY);
  const [pageNo, setPageNo] = useState(1);
  const [q, setQ] = useState(''); // the search box, sent 300 ms after the last key
  const toast = useToast();
  const act = useAction();
  const params = new URLSearchParams(Object.entries({ ...f, page: pageNo > 1 ? pageNo : '' }).filter(([, v]) => v)).toString();
  const list = useLoad(`${full ? '/audit' : '/audit/mine'}?${params}${params ? '&' : ''}limit=${LIMIT}`);
  const d = list.data;
  const last = useRef(null); // the person and screen lists stay while the next page loads
  if (d) last.current = d;
  const m = d || last.current;
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPageNo(1); };
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const typing = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set('q', v.trim()), 300);
  };
  const clear = () => { clearTimeout(timer.current); setQ(''); setF(EMPTY); setPageNo(1); };
  const filtered = Object.values(f).some(Boolean);
  const exportCsv = () => act.run(async () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    await api.download(`/audit/export.csv${qs ? `?${qs}` : ''}`, `dfresh-audit-log-${d.today}.csv`);
    toast('good', 'Exported', `${d.total} change${d.total === 1 ? '' : 's'} in dfresh-audit-log-${d.today}.csv. The export itself is in the log.`);
    list.reload();
  }, null);

  return (
    <section>
      <PageHead sub="Every change, who made it, when"
        actions={m && m.can_export && (
          <button type="button" className="a-btn" disabled={act.busy || !d || !d.total} onClick={exportCsv}><LIcon name="download" size="sm" />Export CSV</button>
        )}
        rules={['Nobody can edit or clear it, including Admin', 'Old value struck through, new value next to it', 'You see only what your role may see']} />
      {act.note}
      {m && <Alert tone="info" title="Nobody can edit or clear the audit log, including Admin.">{` ${NOTE[m.scope]}`}</Alert>}
      <div className="a-listcard a-au">
        <div className="a-au-filters">
          <label className="a-au-fi a-au-grow"><LIcon name="search" size="sm" />
            <input type="search" value={q} placeholder="Search changes" aria-label="Search changes" onChange={(e) => typing(e.target.value)} />
          </label>
          {m && m.people && (
            <label className="a-au-fi"><LIcon name="user" size="sm" />
              <select value={f.emp} aria-label="Changes by" onChange={(e) => set('emp', e.target.value)}>
                <option value="">Everybody</option>
                {m.people.map((p) => <option key={p.emp_id} value={p.emp_id}>{p.name}{p.name !== p.emp_id ? ` (${p.emp_id})` : ''}</option>)}
              </select>
            </label>
          )}
          {m && (
            <label className="a-au-fi"><LIcon name="list-todo" size="sm" />
              <select value={f.screen} aria-label="Screen" onChange={(e) => set('screen', e.target.value)}>
                <option value="">All screens</option>
                {m.screens.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          )}
          <label className="a-au-fi"><span className="a-muted">From</span>
            <input type="date" value={f.from} max={f.to || undefined} aria-label="From date" onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="a-au-fi"><span className="a-muted">To</span>
            <input type="date" value={f.to} min={f.from || undefined} aria-label="To date" onChange={(e) => set('to', e.target.value)} />
          </label>
          {filtered && <button type="button" className="a-btn a-btn-sm" onClick={clear}>Clear</button>}
        </div>
        <Loading state={list}>
          {d && (
            <>
              <div className="a-countline"><b>{d.total}</b> change{d.total === 1 ? '' : 's'}{d.scope === 'own' ? ` by you, ${d.me.name}` : ''}</div>
              <Table label="Audit log" className="a-au-t" rows={d.rows} rowKey={(r) => r.audit_id}
                empty={{ icon: 'inbox', title: 'No changes to show', text: filtered ? 'No change matches the filters.' : 'Every change in every section appears here.' }}
                columns={[
                  { key: 'created_at', label: 'When', className: 'a-au-when', render: (r) => fmtDate(r.created_at) },
                  { key: 'who', label: 'Who', render: (r) => <>{r.who}{r.who !== r.emp_id && <small className="a-sub-l">{r.emp_id}</small>}</> },
                  { key: 'screen_label', label: 'Screen', hideSm: true },
                  { key: 'what', label: 'What', render: (r) => <><b>{r.action.replace(/_/g, ' ')} {r.entity_type.replace(/_/g, ' ')}</b>{r.entity_id && <small className="a-sub-l">{r.entity_id}</small>}</> },
                  { key: 'change', label: 'Change', className: 'a-au-diff', render: (r) => <Change changes={r.changes} /> },
                ]} />
              {d.total > LIMIT && (
                <div className="a-pager a-au-pager">
                  <button type="button" className="a-btn a-btn-sm" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>Previous</button>
                  <span>Page {pageNo} of {Math.ceil(d.total / LIMIT)}</span>
                  <button type="button" className="a-btn a-btn-sm" disabled={pageNo * LIMIT >= d.total} onClick={() => setPageNo(pageNo + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </Loading>
      </div>
    </section>
  );
}
