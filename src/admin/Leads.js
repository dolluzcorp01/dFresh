// Leads (spec F 2): filters, table, detail drawer (status, assign, staff notes), outbox rows with retry, CSV.
// ?ref=DFL-... (link in the staff alert e-mail) opens that lead.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, Loading, fmtDate, useAction, useAdmin, useCan, useLoad } from './ui';

const FORMS = ['brochure', 'quote', 'sample', 'distributor', 'contact'];
const STATUS = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];
const FILTERS = ['form', 'status', 'lang', 'from', 'to', 'q', 'ref', 'page'];

export default function Leads() {
  // Filters live in the URL (useLocation / useNavigate: router exports the public bundle already has).
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = (next) => navigate({ search: next.toString() ? `?${next}` : '' }, { replace: true });
  const { languages } = useAdmin();
  const canEdit = useCan('editor');
  const query = useMemo(() => {
    const q = new URLSearchParams();
    FILTERS.forEach((k) => params.get(k) && q.set(k, params.get(k)));
    q.set('limit', '50');
    return q.toString();
  }, [params]);
  const list = useLoad(`/leads?${query}`);
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState(params.get('q') || '');
  const dl = useAction();

  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  // ?ref= from the alert e-mail: open the single match.
  useEffect(() => {
    if (params.get('ref') && list.data && list.data.rows.length === 1) setOpenId(list.data.rows[0].lead_id);
  }, [params, list.data]);

  const exportCsv = () => dl.run(() => api.download(`/leads/export.csv?${query}`, 'dfresh-leads.csv'));
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;

  return (
    <section>
      <h1>Leads</h1>
      <div className="a-toolbar">
        <select aria-label="Form" value={params.get('form') || ''} onChange={(e) => setFilter('form', e.target.value)}>
          <option value="">All forms</option>{FORMS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select aria-label="Status" value={params.get('status') || ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>{STATUS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Language" value={params.get('lang') || ''} onChange={(e) => setFilter('lang', e.target.value)}>
          <option value="">All languages</option>{languages.map((l) => <option key={l.lang_code} value={l.lang_code}>{l.name_en}</option>)}
        </select>
        <label className="a-inline">From <input type="date" value={params.get('from') || ''} onChange={(e) => setFilter('from', e.target.value)} /></label>
        <label className="a-inline">To <input type="date" value={params.get('to') || ''} onChange={(e) => setFilter('to', e.target.value)} /></label>
        <form onSubmit={(e) => { e.preventDefault(); setFilter('q', search.trim()); }}>
          <input type="search" placeholder="Name, phone, e-mail, ref..." aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        {params.get('ref') && <button type="button" className="a-btn a-btn-ghost" onClick={() => setFilter('ref', '')}>Clear ref {params.get('ref')}</button>}
        {canEdit && <button type="button" className="a-btn" onClick={exportCsv} disabled={dl.busy}>Export CSV</button>}
      </div>
      {dl.note}
      <Loading state={list}>
        {d && (
          <>
            <p className="a-muted">{d.total} lead(s)</p>
            <div className="a-scroll">
              <table className="a-table a-hover">
                <thead><tr><th>Ref</th><th>Received</th><th>Form</th><th>Name</th><th>Business / town</th><th>Phone</th><th>Lang</th><th>Status</th><th>Assigned</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.lead_id} onClick={() => setOpenId(r.lead_id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.lead_id)}>
                      <td><code>{r.lead_ref}</code></td>
                      <td>{fmtDate(r.created_at)}</td>
                      <td>{r.form_type}</td>
                      <td>{r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
                      <td>{[r.business_name, r.town].filter(Boolean).join(', ')}</td>
                      <td>{r.phone}</td>
                      <td>{r.lang_code}</td>
                      <td><span className={`a-pill a-st-${r.status}`}>{r.status}</span></td>
                      <td>{r.assigned_to || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="a-pager">
                <button type="button" className="a-btn a-btn-ghost" disabled={d.page <= 1} onClick={() => setFilter('page', String(d.page - 1))}>Previous</button>
                <span>Page {d.page} of {pages}</span>
                <button type="button" className="a-btn a-btn-ghost" disabled={d.page >= pages} onClick={() => setFilter('page', String(d.page + 1))}>Next</button>
              </div>
            )}
          </>
        )}
      </Loading>
      {openId && <LeadDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </section>
  );
}

function LeadDrawer({ id, onClose, onChanged }) {
  const lead = useLoad(`/leads/${id}`);
  const people = useLoad('/assignees');
  const canEdit = useCan('editor');
  const act = useAction();
  const [form, setForm] = useState(null);
  const l = lead.data;
  useEffect(() => { if (l) setForm({ status: l.status, assigned_to: l.assigned_to || '', staff_notes: l.staff_notes || '' }); }, [l]);

  const save = () => act.run(async () => {
    const data = await api.send('PATCH', `/leads/${id}`, form);
    lead.setData(data);
    onChanged();
  }, 'Saved');
  const retry = (type, rowId) => act.run(async () => {
    await api.send('POST', `/outbox/${type}/${rowId}/retry`);
    lead.reload();
  }, 'Queued again');

  const details = l && l.details_json ? (typeof l.details_json === 'string' ? JSON.parse(l.details_json) : l.details_json) : {};
  const rows = l ? [
    ['Form', l.form_type], ['Received', fmtDate(l.created_at)], ['Name', l.full_name || [l.first_name, l.last_name].filter(Boolean).join(' ')],
    ['Business', l.business_name], ['Business type', l.business_type], ['Town', l.town],
    ['Phone', l.phone && <a href={`tel:+91${l.phone}`}>{l.phone}</a>], ['WhatsApp', l.phone && <a href={`https://wa.me/91${l.phone}`} target="_blank" rel="noreferrer">wa.me/91{l.phone}</a>],
    ['E-mail', l.email && <a href={`mailto:${l.email}`}>{l.email}</a>],
    ['Products', l.products.map((p) => `${p.product_id} ${p.name || ''}`).join(', ')], ['Monthly quantity', l.monthly_quantity], ['Message', l.message],
    ...Object.entries(details).filter(([k]) => k !== 'firm_name').map(([k, v]) => [k.replace(/_/g, ' '), v]),
    ['Language', l.lang_code], ['Page', l.source_page], ['Opened from', l.source_ref], ['Consent', l.consent_given ? `Yes, ${fmtDate(l.consent_at)}: "${l.consent_text}"` : 'No'],
    ['Sheet synced', fmtDate(l.sheet_synced_at)],
  ] : [];

  return (
    <Drawer title={l ? `Lead ${l.lead_ref}` : 'Lead'} onClose={onClose}
      footer={canEdit && form ? <button type="button" className="a-btn" onClick={save} disabled={act.busy}>Save</button> : null}>
      <Loading state={lead}>
        {l && form && (
          <>
            {act.note}
            <dl className="a-dl">{rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <h3>Handling</h3>
            <div className="a-grid2">
              <label className="a-field"><span>Status</span>
                <select disabled={!canEdit} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <label className="a-field"><span>Assigned to</span>
                <select disabled={!canEdit} value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
                  <option value="">Nobody</option>
                  {(people.data || []).map((p) => <option key={p.emp_id} value={p.emp_id}>{p.name || p.emp_id} ({p.emp_id})</option>)}
                </select>
              </label>
              <label className="a-field a-wide"><span>Staff notes (internal)</span>
                <textarea rows={4} disabled={!canEdit} value={form.staff_notes} onChange={(e) => setForm({ ...form, staff_notes: e.target.value })} />
              </label>
            </div>
            <h3>E-mail and sheet</h3>
            <table className="a-table">
              <thead><tr><th>Type</th><th>To / target</th><th>Status</th><th>Tries</th><th /></tr></thead>
              <tbody>
                {l.outbox.mail.map((m) => (
                  <tr key={`m${m.id}`}>
                    <td>{m.purpose}</td><td>{m.to_email}</td>
                    <td title={m.last_error || ''}><span className={`a-pill a-ob-${m.status}`}>{m.status}</span>{m.sent_at ? ` ${fmtDate(m.sent_at)}` : ''}</td>
                    <td className="a-num">{m.attempts}</td>
                    <td>{canEdit && m.status === 'failed' && <button type="button" className="a-btn a-btn-sm" onClick={() => retry('mail', m.id)}>Retry</button>}</td>
                  </tr>
                ))}
                {l.outbox.sync.map((s) => (
                  <tr key={`s${s.id}`}>
                    <td>sheet</td><td>{s.target}</td>
                    <td title={s.last_error || ''}><span className={`a-pill a-ob-${s.status}`}>{s.status}</span>{s.done_at ? ` ${fmtDate(s.done_at)}` : ''}</td>
                    <td className="a-num">{s.attempts}</td>
                    <td>{canEdit && s.status === 'failed' && <button type="button" className="a-btn a-btn-sm" onClick={() => retry('sync', s.id)}>Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Loading>
    </Drawer>
  );
}
