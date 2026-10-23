// Sales > Customers (CRM, docs/COMMERCE-SPEC.md 4.5; API /commerce/customers, logic in src/backend_routes/customers.js).
// List: CUS-0001 numbers, type, status (Active / On hold / Inactive), town, sales owner, tags, orders and the last one,
// what is owed (Overdue), wallet, next follow-up. Filters: search (CUS no., name, phone, GSTIN), type, status, town,
// tag, owner, no order in N days, owing at least, wallet at least; a filter can be saved as a segment. Excel export of
// the list and import (dry run first, Apply only that file). Merge duplicates (approval). New customer: the customer,
// its billing address (GSTIN of its state), a shipping address (or the same), a contact, tags; a duplicate phone,
// e-mail or GSTIN is refused with that customer named. ?open=<id> opens one (from a lead or an order).
// The customer drawer is CustomerDrawer.js. With the setting "Sales sees only their own customers" a limited role sees
// only the customers it owns.
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, useAction, useCan, useConfirm, useLoad, useUpload, UploadProgress } from './ui';
import { rs } from './printKit';
import { GST_STATES } from '../shared/gstStates';
import CustomerDrawer from './CustomerDrawer';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATUS_CLASS = { active: 'a-ap-approved', on_hold: 'a-ap-pending', inactive: 'a-status-off' };
export const StatusChip = ({ s, label }) => <span className={`a-status ${STATUS_CLASS[s] || ''}`}>{label}</span>;
const F0 = { q: '', type: '', status: '', town: '', tag: '', owner: '', no_order_days: '', outstanding_min: '', wallet_min: '' };

export default function CommerceCustomers() {
  const location = useLocation();
  const [f, setF] = useState(F0);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 350); return () => clearTimeout(t); }, [search]);
  const qs = [...Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`), ...(segment ? [`segment=${segment}`] : [])].join('&');
  const list = useLoad(`/commerce/customers${qs ? `?${qs}` : ''}`);
  const [open, setOpen] = useState(() => Number(new URLSearchParams(location.search).get('open')) || null);
  useEffect(() => { const o = Number(new URLSearchParams(location.search).get('open')); if (o) setOpen(o); }, [location.search]);
  const [panel, setPanel] = useState(null); // new | import | merge
  const canCreate = useCan('customers', 'create');
  const canEdit = useCan('customers', 'edit');
  const act = useAction();
  const confirm = useConfirm();
  const d = list.data;
  const [meta, setMeta] = useState(null); // the filter lists stay while the list reloads
  useEffect(() => { if (d) setMeta({ types: d.types, owners: d.owners, statuses: d.statuses, tags: d.tags, towns: d.towns, segments: d.segments }); }, [d]);
  const set = (patch) => { setSegment(''); setF((x) => ({ ...x, ...patch })); };
  const chooseSegment = (id) => { setSegment(id); const sg = meta && meta.segments.find((x) => String(x.segment_id) === id); setF({ ...F0, ...(sg ? sg.filters : {}) }); setSearch(sg && sg.filters.q ? sg.filters.q : ''); };
  const [segName, setSegName] = useState('');
  const doSaveSegment = () => act.run(async () => {
    const r = await api.send('POST', '/commerce/segments', { name: segName, filters: f });
    setSegName(''); await list.reload(); setSegment(String(r.segment_id));
  }, `Segment "${segName}" saved`);
  const deleteSegment = async () => {
    const sg = meta.segments.find((x) => String(x.segment_id) === segment);
    if (!(await confirm({ title: `Delete the segment "${sg.name}"?`, message: 'Only the saved filter goes; no customer changes.', action: 'Delete', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/commerce/segments/${segment}`); setSegment(''); setF(F0); list.reload(); }, 'Segment deleted');
  };
  const exportXlsx = () => act.run(() => api.download(`/commerce/customers/export.xlsx${qs ? `?${qs}` : ''}`, 'dFresh_Customers.xlsx'));
  const filtered = Object.values(f).some(Boolean);
  return (
    <section>
      <h1>Customers</h1>
      <InfoCard title="Customers, branches and follow-ups">
        <ul>
          <li>Each customer has billing addresses (each with its own GSTIN and state, for B2B branches) and shipping addresses; an order picks one of each and the GST follows the shipping state.</li>
          <li>On hold: a new order waits for approval. Inactive: no new orders. A price list of its own (not its type&apos;s) and a merge of duplicates wait for approval too.</li>
          <li>The timeline shows calls, WhatsApp, visits, mails and notes next to the orders, payments, returns and wallet; follow-ups go to My follow-ups.</li>
        </ul>
      </InfoCard>
      {act.note}
      {d && d.ownOnly && <Notice kind="info">You see only the customers you own (Commerce settings &gt; Customers).</Notice>}
      <div className="a-toolbar">
        <label className="a-inline">Segment <select value={segment} aria-label="Segment" onChange={(e) => chooseSegment(e.target.value)}><option value="">None</option>{meta && meta.segments.map((sg) => <option key={sg.segment_id} value={sg.segment_id}>{sg.name}</option>)}</select></label>
        {segment && canEdit && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={deleteSegment}>Delete segment</button>}
        {canCreate && <button type="button" className="a-btn" onClick={() => setPanel('new')}>New customer</button>}
        <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={exportXlsx}>Excel</button>
        {canCreate && canEdit && <button type="button" className="a-btn a-btn-ghost" onClick={() => setPanel('import')}>Import</button>}
        {canEdit && <button type="button" className="a-btn a-btn-ghost" onClick={() => setPanel('merge')}>Merge duplicates</button>}
      </div>
      <div className="a-filters">
        <input type="search" placeholder="CUS no., name, phone or GSTIN" aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>Type <select value={f.type} aria-label="Filter type" onChange={(e) => set({ type: e.target.value })}><option value="">All</option>{meta && meta.types.map((t) => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}</select></label>
        <label>Status <select value={f.status} aria-label="Filter status" onChange={(e) => set({ status: e.target.value })}><option value="">All</option>{meta && Object.entries(meta.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="merged">Merged</option></select></label>
        <label>Town <select value={f.town} aria-label="Filter town" onChange={(e) => set({ town: e.target.value })}><option value="">All</option>{meta && meta.towns.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Tag <select value={f.tag} aria-label="Filter tag" onChange={(e) => set({ tag: e.target.value })}><option value="">All</option>{meta && meta.tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}</select></label>
        <label>Owner <select value={f.owner} aria-label="Filter owner" onChange={(e) => set({ owner: e.target.value })}><option value="">All</option><option value="none">No owner</option>{meta && meta.owners.map((o) => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}</select></label>
        <label>No order in <select value={f.no_order_days} aria-label="No order in" onChange={(e) => set({ no_order_days: e.target.value })}><option value="">-</option>{[30, 60, 90, 180].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
        <label>Owes at least <input className="a-price" inputMode="decimal" value={f.outstanding_min} aria-label="Owes at least" onChange={(e) => set({ outstanding_min: e.target.value })} /></label>
        <label>Wallet at least <input className="a-price" inputMode="decimal" value={f.wallet_min} aria-label="Wallet at least" onChange={(e) => set({ wallet_min: e.target.value })} /></label>
        {filtered && !segment && (
          <span className="a-row"><input value={segName} maxLength={80} placeholder="Segment name" aria-label="Segment name" onChange={(e) => setSegName(e.target.value)} />
            <button type="button" className="a-btn a-btn-sm" disabled={!segName.trim() || act.busy} onClick={doSaveSegment}>Save as segment</button></span>
        )}
        {filtered && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { setSegment(''); setF(F0); setSearch(''); }}>Clear</button>}
      </div>
      <Loading state={list}>
        {d && (
          <div className="a-scroll">
            <table className="a-table">
              <thead><tr><th>Customer</th><th>Type</th><th>Status</th><th>Town</th><th>Owner</th><th>Tags</th><th className="a-num">Orders</th><th>Last order</th><th className="a-num">Owes</th><th className="a-num">Wallet</th><th>Follow-up</th></tr></thead>
              <tbody>{d.rows.map((c) => (
                <tr key={c.customer_id} className="a-rowlink" tabIndex={0} onClick={() => setOpen(c.customer_id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(c.customer_id)}>
                  <td><code>{c.customer_no}</code> {c.name}{c.business_name && c.business_name !== c.name && <small className="a-muted a-person-sub">{c.business_name}</small>}<small className="a-muted a-person-sub">{c.phone}</small></td>
                  <td>{c.type_label}{c.price_list && <small className="a-muted a-person-sub">{c.price_list} prices</small>}</td>
                  <td><StatusChip s={c.status} label={c.status_label} /></td><td>{c.town}</td>
                  <td>{c.owner_emp_id ? (meta && (meta.owners.find((o) => o.emp_id === c.owner_emp_id) || {}).name) || c.owner_emp_id : <span className="a-muted">-</span>}</td>
                  <td>{c.tags.map((t) => <span key={t} className="a-tag">{t}</span>)}</td>
                  <td className="a-num">{c.orders}</td><td>{c.last_order ? day(c.last_order) : <span className="a-muted">never</span>}</td>
                  <td className="a-num">{c.outstanding ? rs(c.outstanding) : ''}{c.overdue > 0 && <span className="a-overdue">Overdue</span>}</td>
                  <td className="a-num">{c.wallet ? rs(c.wallet) : ''}</td>
                  <td>{c.next_follow_up ? <span className={new Date(c.next_follow_up) < new Date(new Date().toDateString()) ? 'a-bad' : undefined}>{day(c.next_follow_up)}</span> : ''}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="a-muted">{d.rows.length} customer(s){filtered ? ' match' : ''}.</p>
          </div>
        )}
      </Loading>
      {panel === 'new' && <NewCustomerDrawer onClose={() => setPanel(null)} onSaved={(c) => { setPanel(null); list.reload(); setOpen(c.customer_id); }} onOpenExisting={(id) => { setPanel(null); setOpen(id); }} />}
      {panel === 'import' && <ImportDrawer onClose={() => { setPanel(null); list.reload(); }} />}
      {panel === 'merge' && <MergeDrawer onClose={() => { setPanel(null); list.reload(); }} />}
      {open && <CustomerDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </section>
  );
}

// ---------------------------------------------------------------- new customer (also from New order)
const A0 = { label: '', name: '', gstin: '', contact_person: '', phone: '', address: '', town: '', state_code: '33', pincode: '' };
export function AddressFields({ a, set, kind, areas = [], prefix }) {
  const f = (k) => (e) => set({ ...a, [k]: e.target.value });
  return (
    <div className="a-grid2">
      <label className="a-field"><span>Label (e.g. Branch 2 - Bengaluru)</span><input value={a.label || ''} maxLength={80} aria-label={`${prefix} label`} onChange={f('label')} /></label>
      <label className="a-field"><span>Name on the {kind === 'billing' ? 'invoice' : 'parcel'}</span><input value={a.name || ''} maxLength={150} aria-label={`${prefix} name`} onChange={f('name')} /></label>
      {kind === 'billing' ? <label className="a-field"><span>GSTIN (of this state, optional)</span><input value={a.gstin || ''} maxLength={15} placeholder="33ABCDE1234F1Z5" aria-label={`${prefix} GSTIN`} onChange={(e) => set({ ...a, gstin: e.target.value.toUpperCase() })} /></label>
        : <label className="a-field"><span>Contact person</span><input value={a.contact_person || ''} maxLength={120} aria-label={`${prefix} contact`} onChange={f('contact_person')} /></label>}
      <label className="a-field"><span>Phone</span><input value={a.phone || ''} aria-label={`${prefix} phone`} onChange={f('phone')} /></label>
      <label className="a-field"><span>Address</span><input value={a.address || ''} maxLength={255} aria-label={`${prefix} address`} onChange={f('address')} /></label>
      <label className="a-field"><span>Town</span><input value={a.town || ''} maxLength={80} aria-label={`${prefix} town`} onChange={f('town')} /></label>
      <label className="a-field"><span>State</span><select value={a.state_code || ''} aria-label={`${prefix} state`} onChange={f('state_code')}>{GST_STATES.map(([c, nm]) => <option key={c} value={c}>{nm} ({c})</option>)}</select></label>
      <label className="a-field"><span>PIN code</span><input value={a.pincode || ''} inputMode="numeric" maxLength={6} aria-label={`${prefix} PIN`} onChange={f('pincode')} /></label>
      {kind === 'shipping' && areas.length > 0 && <label className="a-field"><span>Delivery area</span><select value={a.delivery_area_id || ''} aria-label={`${prefix} area`} onChange={f('delivery_area_id')}><option value="">From the PIN code / town</option>{areas.map((x) => <option key={x.area_id} value={x.area_id}>{x.label}</option>)}</select></label>}
    </div>
  );
}

export function NewCustomerDrawer({ onClose, onSaved, onOpenExisting }) {
  const meta = useLoad('/commerce/customers?status=merged'); // only for the type / owner lists (cheap: merged ones)
  const act = useAction();
  const [c, setC] = useState({ name: '', business_name: '', type_key: 'home', phone: '', email: '', source: 'Phone', owner_emp_id: '', tags: '' });
  const [bill, setBill] = useState(A0);
  const [same, setSame] = useState(true);
  const [ship, setShip] = useState(A0);
  const [contact, setContact] = useState({ name: '', role: '', phone: '', email: '', whatsapp: true, gets_invoices: false });
  const [errors, setErrors] = useState({});
  const [dup, setDup] = useState(null);
  const m = meta.data;
  const save = () => act.run(async () => {
    setErrors({}); setDup(null);
    try {
      const r = await api.send('POST', '/commerce/customers', { ...c, tags: c.tags.split(','), bill: { ...bill, name: bill.name || c.business_name || c.name, phone: bill.phone || c.phone },
        ship: same ? null : ship, contacts: contact.name ? [contact] : [] });
      onSaved(r);
    } catch (e) {
      if (e.data && e.data.code === 'duplicate') setDup(e.data.fields);
      else if (e.data && e.data.code === 'fields') setErrors(e.data.fields || {});
      throw e;
    }
  });
  const fe = (k) => errors[k] && <small className="a-bad" role="alert">{errors[k]}</small>;
  const dirty = Boolean(c.name || c.phone);
  return (
    <Drawer title="New customer" onClose={onClose} dirty={dirty} footer={<button type="button" className="a-btn" disabled={act.busy || !c.name.trim() || !c.phone.trim()} onClick={save}>Save customer</button>}>
      {act.note}
      {dup && <Notice kind="warn">Already a customer: {dup.customer_no} {dup.name} (same {dup.by}). {onOpenExisting && <button type="button" className="a-link" onClick={() => onOpenExisting(dup.customer_id)}>Open it</button>}</Notice>}
      <div className="a-grid2">
        <label className="a-field"><span>Name</span><input value={c.name} maxLength={120} aria-label="Customer name" onChange={(e) => setC({ ...c, name: e.target.value })} />{fe('name')}</label>
        <label className="a-field"><span>Business name (optional)</span><input value={c.business_name} maxLength={150} aria-label="Business name" onChange={(e) => setC({ ...c, business_name: e.target.value })} /></label>
        <label className="a-field"><span>Type</span><select value={c.type_key} aria-label="Customer type" onChange={(e) => setC({ ...c, type_key: e.target.value })}>{(m ? m.types : [{ type_key: 'home', label: 'Home' }]).map((t) => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}</select></label>
        <label className="a-field"><span>Mobile</span><input value={c.phone} inputMode="tel" aria-label="Customer phone" onChange={(e) => setC({ ...c, phone: e.target.value })} />{fe('phone')}</label>
        <label className="a-field"><span>E-mail (optional)</span><input value={c.email} aria-label="Customer e-mail" onChange={(e) => setC({ ...c, email: e.target.value })} />{fe('email')}</label>
      </div>
      <h3>Billing address</h3>
      <AddressFields a={bill} set={setBill} kind="billing" prefix="Billing" />
      {Object.entries(errors).filter(([k]) => ['name', 'phone', 'email', 'owner_emp_id'].indexOf(k) < 0).map(([k, v]) => <small key={k} className="a-bad a-person-sub" role="alert">{v}</small>)}
      <label className="a-inline"><input type="checkbox" checked={same} onChange={(e) => { setSame(e.target.checked); if (!e.target.checked) setShip({ ...bill, gstin: '', contact_person: c.name }); }} /> Ship to the billing address</label>
      {!same && (<><h3>Shipping address</h3><AddressFields a={ship} set={setShip} kind="shipping" prefix="Shipping" /></>)}
      <h3>Contact person (optional)</h3>
      <div className="a-grid2">
        <label className="a-field"><span>Name</span><input value={contact.name} aria-label="Contact name" onChange={(e) => setContact({ ...contact, name: e.target.value })} /></label>
        <label className="a-field"><span>Role</span><input value={contact.role} aria-label="Contact role" onChange={(e) => setContact({ ...contact, role: e.target.value })} /></label>
        <label className="a-field"><span>Phone</span><input value={contact.phone} aria-label="Contact phone" onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
        <label className="a-field"><span>E-mail</span><input value={contact.email} aria-label="Contact e-mail" onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
      </div>
      <span className="a-row">
        <label className="a-inline"><input type="checkbox" checked={contact.whatsapp} onChange={(e) => setContact({ ...contact, whatsapp: e.target.checked })} /> On WhatsApp</label>
        <label className="a-inline"><input type="checkbox" checked={contact.gets_invoices} onChange={(e) => setContact({ ...contact, gets_invoices: e.target.checked })} /> Gets invoices</label>
      </span>
      <h3>Owner, source and tags</h3>
      <div className="a-grid2">
        <label className="a-field"><span>Sales owner</span><select value={c.owner_emp_id} aria-label="Sales owner" onChange={(e) => setC({ ...c, owner_emp_id: e.target.value })}><option value="">None</option>{m && m.owners.map((o) => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}</select>{fe('owner_emp_id')}</label>
        <label className="a-field"><span>Source</span><select value={c.source} onChange={(e) => setC({ ...c, source: e.target.value })}>{['Phone', 'WhatsApp', 'Walk-in', 'Referral', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="a-field"><span>Tags (comma separated)</span><input value={c.tags} aria-label="Tags" onChange={(e) => setC({ ...c, tags: e.target.value })} /></label>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- import, merge
function ImportDrawer({ onClose }) {
  const act = useAction();
  const up = useUpload();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const dry = () => act.run(async () => { const r = await up.send('dry', '/commerce/customers/import?dryRun=1', file); setReport({ ...r, file }); });
  const canApply = Boolean(report && report.ok && report.file === file && report.summary.new + report.summary.changed > 0);
  const apply = async () => {
    if (!(await confirm({ title: 'Apply the import?', message: `${report.summary.new} new customer(s), ${report.summary.changed} changed (${report.summary.changes} change(s)).`, action: 'Apply' }))) return;
    act.run(async () => {
      const r = await up.send('apply', `/commerce/customers/import?dryRun=0&hash=${encodeURIComponent(report.fileHash)}`, file);
      setReport(null); setFile(null); if (inputRef.current) inputRef.current.value = '';
      act.setMsg({ kind: 'ok', text: `Imported: ${r.applied.created.length} new (${r.applied.created.join(', ') || '-'}), ${r.applied.changed} changed.` });
    });
  };
  return (
    <Drawer title="Import customers (.xlsx)" onClose={onClose}>
      {act.note}
      <p className="a-muted">Export the list (Excel), edit it, then choose it here. The dry run lists every new customer, every change and every error; Apply is offered only for that file with 0 errors.</p>
      <input ref={inputRef} type="file" accept=".xlsx" aria-label="Customers file" onChange={(e) => { setFile(e.target.files[0] || null); setReport(null); }} />
      <span className="a-row">
        <button type="button" className="a-btn" disabled={!file || act.busy} onClick={dry}>{up.is('dry') ? <UploadProgress state={up.state} /> : 'Dry run'}</button>
        {canApply && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={apply}>{up.is('apply') ? <UploadProgress state={up.state} /> : 'Apply'}</button>}
      </span>
      {report && (
        <>
          <p><b>{report.summary.new} new, {report.summary.changed} customer(s) changed ({report.summary.changes} change(s)), {report.summary.errors} error(s)</b></p>
          {report.errors.length > 0 && <Notice kind="error"><ul>{report.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
          {report.notes.map((n) => <p key={n} className="a-muted">{n}</p>)}
          {report.creates.length > 0 && <table className="a-table"><thead><tr><th>Row</th><th>New customer</th><th>Type</th><th>Phone</th><th>GSTIN</th></tr></thead><tbody>{report.creates.map((x) => <tr key={x.row}><td>{x.row}</td><td>{x.name}</td><td>{x.type}</td><td>{x.phone}</td><td>{x.gstin || ''}</td></tr>)}</tbody></table>}
          {report.changes.length > 0 && <table className="a-table"><thead><tr><th>Customer</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{report.changes.map((x, i) => <tr key={i}><td><code>{x.customer_no}</code> {x.name}</td><td>{x.field}</td><td>{String(x.before ?? '')}</td><td><b>{String(x.after ?? '')}</b></td></tr>)}</tbody></table>}
        </>
      )}
    </Drawer>
  );
}

function MergeDrawer({ onClose }) {
  const pairs = useLoad('/commerce/customers/duplicates');
  const act = useAction();
  const confirm = useConfirm();
  const [pick, setPick] = useState(null); // { keep: {id,no,name}, gone: {...} }
  const [reason, setReason] = useState('');
  const ask = async () => {
    if (!(await confirm({ title: `Merge ${pick.gone.no} into ${pick.keep.no}?`, message: `${pick.gone.no} ${pick.gone.name}: its orders, addresses, contacts, wallet, timeline and follow-ups move to ${pick.keep.no} ${pick.keep.name}; ${pick.gone.no} becomes inactive. It waits for approval by someone else.`, action: 'Ask for approval' }))) return;
    act.run(async () => { const r = await api.send('POST', '/commerce/customers/merge', { keep_id: pick.keep.id, merge_id: pick.gone.id, reason }); setPick(null); setReason(''); act.setMsg({ kind: 'info', text: `Merge sent for approval (request #${r.approval_id}).` }); });
  };
  return (
    <Drawer title="Merge duplicate customers" onClose={onClose}>
      {act.note}
      <p className="a-muted">Customers with the same phone, e-mail, GSTIN or name. Choose the one to keep: the other one&apos;s orders, addresses, contacts, wallet and history move to it (after approval; audited).</p>
      <Loading state={pairs}>
        {pairs.data && (pairs.data.length ? (
          <table className="a-table"><tbody>{pairs.data.map((p) => (
            <tr key={`${p.a_id}-${p.b_id}`}><td><code>{p.a_no}</code> {p.a_name}</td><td><code>{p.b_no}</code> {p.b_name}</td><td className="a-muted">same {p.why}</td>
              <td><span className="a-row">
                <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setPick({ keep: { id: p.a_id, no: p.a_no, name: p.a_name }, gone: { id: p.b_id, no: p.b_no, name: p.b_name } })}>Keep {p.a_no}</button>
                <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setPick({ keep: { id: p.b_id, no: p.b_no, name: p.b_name }, gone: { id: p.a_id, no: p.a_no, name: p.a_name } })}>Keep {p.b_no}</button></span></td></tr>
          ))}</tbody></table>
        ) : <p className="a-muted">No duplicates found.</p>)}
      </Loading>
      {pick && (
        <div className="a-card">
          <p>Keep <b>{pick.keep.no} {pick.keep.name}</b>, merge <b>{pick.gone.no} {pick.gone.name}</b> into it.</p>
          <label className="a-field"><span>Why are they the same customer? (required)</span><input value={reason} maxLength={200} aria-label="Merge reason" onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="a-btn" disabled={act.busy || !reason.trim()} onClick={ask}>Ask to merge</button>
        </div>
      )}
      <p className="a-muted">Every merged customer stays findable with Status: Merged; requests are decided in Approvals (top of the menu).</p>
    </Drawer>
  );
}
