// Leads (spec F 2): filters, table, detail drawer (status, assign, staff notes), outbox rows with retry, Excel / CSV
// download of the filtered list.
// ?ref=DFL-... (link in the staff alert e-mail) opens that lead.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, Loading, fmtDate, useAction, useAdmin, useCan, useConfirm, useLoad } from './ui';
import rules from '../shared/rules.json';

// Lead drawer: every field of the lead's form, in the form's own order (src/shared/rules.json, the same file the site
// and the API use), always shown, so leads of one form type line up when compared; an empty one is the label with a
// blank value. [label, value] per form field; phone also gets its WhatsApp line.
const formFields = (type) => {
  const def = rules.forms[type];
  return (typeof def === 'string' ? rules.forms[def] : def || []).map((x) => x.name);
};
function fieldRows(name, l, details) {
  const d = (k) => details[k] ?? null;
  switch (name) {
    case 'first_name': return [['First name', l.first_name]];
    case 'last_name': return [['Last name', l.last_name]];
    case 'full_name': return [['Name', l.full_name]];
    case 'business_name': return [['Business', l.business_name]];
    case 'firm_name': return [['Firm', l.business_name || d('firm_name')]];
    case 'business_type': return [['Business type', l.business_type]];
    case 'town': return [['Town', l.town]];
    case 'phone': return [['Phone', l.phone && <a href={`tel:+91${l.phone}`}>{l.phone}</a>], ['WhatsApp', l.phone && <a href={`https://wa.me/91${l.phone}`} target="_blank" rel="noreferrer">wa.me/91{l.phone}</a>]];
    case 'email': return [['E-mail', l.email && <a href={`mailto:${l.email}`}>{l.email}</a>]];
    case 'products': return [['Products', (l.products || []).map((p) => `${p.product_id} ${p.name || ''}`).join(', ')]];
    case 'monthly_quantity': return [['Monthly quantity', l.monthly_quantity]];
    case 'message': return [['Message', l.message]];
    case 'gst_no': return [['GST no.', d('gst_no')]];
    case 'areas': return [['Areas covered', d('areas')]];
    case 'godown_vehicles': return [['Godown / vehicles', d('godown_vehicles')]];
    case 'brands': return [['Brands handled', d('brands')]];
    case 'monthly_sales': return [['Monthly tissue sales', d('monthly_sales')]];
    default: return [[name.replace(/_/g, ' '), l[name] ?? d(name)]];
  }
}

// Brochure lead: did the visitor get the PDF? (details_json from Leads_server.js / Brochure_server.js)
function brochureStatus(d) {
  if (d.brochure_downloaded_at) return `Downloaded (${String(d.brochure_lang || '').toUpperCase()}), ${fmtDate(d.brochure_downloaded_at)}`;
  if (d.brochure_delivery === 'off') return 'Not sent, download off - send it to the visitor';
  if (d.brochure_lang) return `Offered (${String(d.brochure_lang).toUpperCase()}): download started and copy link e-mailed, not opened yet`;
  return 'Not sent, no brochure uploaded - send it to the visitor';
}

const FORMS = ['brochure', 'quote', 'sample', 'distributor', 'contact'];
const STATUS = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];
const FILTERS = ['form', 'status', 'lang', 'from', 'to', 'q', 'ref', 'age', 'outbox', 'page'];
// Filters the dashboard links to, shown as removable chips: [param, value, label]
const CHIPS = [['age', '24h', 'Older than 24 hours'], ['outbox', 'failed', 'With a failed e-mail or sheet row']];

export default function Leads() {
  // Filters live in the URL (useLocation / useNavigate: router exports the public bundle already has).
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = (next) => navigate({ search: next.toString() ? `?${next}` : '' }, { replace: true });
  const { languages, leadsVersion } = useAdmin();
  const canEdit = useCan('leads', 'edit');
  const query = useMemo(() => {
    const q = new URLSearchParams();
    FILTERS.forEach((k) => params.get(k) && q.set(k, params.get(k)));
    q.set('limit', '50');
    return q.toString();
  }, [params]);
  const list = useLoad(`/leads?${query}`);
  // Live: when leads arrive (AdminApp polls), the same query is fetched again quietly: no loading state, the open
  // drawer and its unsaved edits are untouched (it keeps its own data), filters stay, new rows get a fading highlight,
  // and when the page is scrolled the rows on screen stay where they are.
  const [fresh, setFresh] = useState(() => new Set());
  const anchor = useRef(null);
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    if (!leadsVersion) return undefined;
    let alive = true;
    api.get(`/leads?${query}`).then((data) => {
      const cur = listRef.current;
      if (!alive || !cur.data) return;
      const before = new Set(cur.data.rows.map((r) => r.lead_id));
      const added = data.rows.filter((r) => !before.has(r.lead_id)).map((r) => r.lead_id);
      if (window.scrollY > 0) {
        const rows = [...document.querySelectorAll('.a-main tbody tr[data-lead]')];
        const first = rows.find((tr) => tr.getBoundingClientRect().top >= 0);
        if (first) anchor.current = { id: first.dataset.lead, top: first.getBoundingClientRect().top };
      }
      cur.setData(data);
      if (added.length) setFresh(new Set(added));
    }, () => {});
    return () => { alive = false; };
  }, [leadsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a) return;
    const tr = document.querySelector(`.a-main tbody tr[data-lead="${a.id}"]`);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - a.top);
  }, [list.data]);
  useEffect(() => {
    if (!fresh.size) return undefined;
    const id = setTimeout(() => setFresh(new Set()), 4000);
    return () => clearTimeout(id);
  }, [fresh]);
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
  const exportXlsx = () => dl.run(() => api.download(`/leads/export.xlsx?${query}`, 'dFresh_Leads.xlsx'));
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
        {CHIPS.filter(([k, v]) => params.get(k) === v).map(([k, , label]) => (
          <button key={k} type="button" className="a-btn a-btn-ghost" onClick={() => setFilter(k, '')} aria-label={`Remove filter: ${label}`}>{label} ×</button>
        ))}
        {canEdit && <button type="button" className="a-btn" onClick={exportXlsx} disabled={dl.busy}>Export Excel</button>}
        {canEdit && <button type="button" className="a-btn a-btn-ghost" onClick={exportCsv} disabled={dl.busy}>Export CSV</button>}
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
                    <tr key={r.lead_id} data-lead={r.lead_id} className={fresh.has(r.lead_id) ? 'a-fresh' : undefined} onClick={() => setOpenId(r.lead_id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.lead_id)}>
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
  const canEdit = useCan('leads', 'edit');
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

  // Commerce: the lead becomes a customer (once; a second click opens the same one) with its address and contact person
  const goTo = useNavigate();
  const convert = () => act.run(async () => {
    const r = await api.send('POST', `/commerce/customers/from-lead/${id}`);
    act.setMsg({ kind: 'ok', text: r.existed ? `Already a customer: ${r.customer_no} ${r.name}. Opening it.` : `Customer ${r.customer_no} created: ${r.name} (${r.type_key}), with its address and contact person. Opening it.` });
    setTimeout(() => goTo(`/admin/commerce/customers?open=${r.customer_id}`), 900);
  });
  // Admin only (test leads before launch, junk): asks first; the sheet row, if already written, stays in the sheet.
  const isAdmin = useCan('leads', 'delete');
  const canCreateCustomer = useCan('customers', 'create');
  const { me: meNow } = useAdmin();
  const canConvert = canCreateCustomer && Boolean(meNow && meNow.commerce_enabled);
  const confirm = useConfirm();
  const remove = async () => {
    const yes = await confirm({
      title: `Delete lead ${l.lead_ref}?`,
      message: `The lead, its e-mail history and its sheet queue row are removed for good.${l.sheet_synced_at ? ` Its row is already in the Google Sheet: delete that row there (Lead Ref ${l.lead_ref}).` : ''}`,
      action: 'Delete lead', danger: true,
    });
    if (!yes) return;
    act.run(async () => {
      await api.send('DELETE', `/leads/${id}`);
      onChanged();
      onClose();
    });
  };
  const details = l && l.details_json ? (typeof l.details_json === 'string' ? JSON.parse(l.details_json) : l.details_json) : {};
  const rows = l ? [
    ['Form', l.form_type], ['Received', fmtDate(l.created_at)],
    ...formFields(l.form_type).flatMap((name) => fieldRows(name, l, details)),
    ...(l.form_type === 'brochure' ? [['Brochure', brochureStatus(details)]] : []),
    ['Language', l.lang_code], ['Page', l.source_page], ['Opened from', l.source_ref], ['Consent', l.consent_given ? `Yes, ${fmtDate(l.consent_at)}: "${l.consent_text}"` : 'No'],
    ['Sheet synced', fmtDate(l.sheet_synced_at)],
  ] : [];

  return (
    <Drawer title={l ? `Lead ${l.lead_ref}` : 'Lead'} onClose={onClose}
      dirty={Boolean(form && l && (form.status !== l.status || form.assigned_to !== (l.assigned_to || '') || form.staff_notes !== (l.staff_notes || '')))}
      footer={form && (canEdit || isAdmin || canConvert) ? (
        <>
          {canEdit && <button type="button" className="a-btn" onClick={save} disabled={act.busy}>Save</button>}
          {canConvert && <button type="button" className="a-btn a-btn-ghost" onClick={convert} disabled={act.busy}>Convert to customer</button>}
          {isAdmin && <button type="button" className="a-btn a-btn-danger" onClick={remove} disabled={act.busy}>Delete lead</button>}
        </>
      ) : null}>
      <Loading state={lead}>
        {l && form && (
          <>
            {act.note}
            <dl className="a-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === null || v === undefined ? '' : v}</dd></div>)}</dl>
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
            {/* its own sideways scroll on a phone; long addresses wrap first */}
            <div className="a-scroll">
            <table className="a-table a-outbox">
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
            </div>
          </>
        )}
      </Loading>
    </Drawer>
  );
}
