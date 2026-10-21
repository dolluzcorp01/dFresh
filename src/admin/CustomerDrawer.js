// The customer drawer (Commerce > Customers; API /commerce/customers/:id..., logic in src/backend_routes/customers.js).
// Tabs: Overview (the customer, status with a reason, sales owner, tags, credit terms and a price list of its own -
// both may wait for approval -, the lead it came from with its history), Addresses (billing with GSTIN per branch,
// shipping with contact and delivery area, the defaults), Contacts, Timeline (calls, WhatsApp, visits, mails, notes typed
// here and what happened: orders, payments, returns, wallet, follow-ups), Follow-ups (assignee, due date, done / snooze),
// Statement (invoices, payments, credit notes, wallet, running balance, ageing; print / PDF), Wallet, Orders.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, Loading, Notice, fmtDate, useAction, useCan, useLoad } from './ui';
import { esc, printPage, rs } from './printKit';
import { AddressFields, StatusChip } from './CommerceCustomers';
import WalletPanel from './WalletPanel';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ist = (n = 0) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const TABS = [['overview', 'Overview'], ['addresses', 'Addresses'], ['contacts', 'Contacts'], ['timeline', 'Timeline'], ['follow', 'Follow-ups'], ['statement', 'Statement'], ['wallet', 'Wallet'], ['orders', 'Orders']];

export default function CustomerDrawer({ id, onClose, onChanged }) {
  const c = useLoad(`/commerce/customers/${id}`);
  const [tab, setTab] = useState('overview');
  const d = c.data;
  const reload = () => { c.reload(); if (onChanged) onChanged(); };
  return (
    <Drawer title={d ? `${d.customer_no} ${d.name}` : 'Customer'} onClose={onClose}>
      <Loading state={c}>
        {d && (
          <>
            <p className="a-custhead"><StatusChip s={d.status} label={d.status_label} /> {d.type_label}{d.priceList.own ? ` · ${d.priceList.label} prices` : ''} · {d.phone}{d.email ? ` · ${d.email}` : ''}
              {d.outstanding > 0 && <> · owes <b>{rs(d.outstanding)}</b></>}{d.wallet ? ` · wallet ${rs(d.wallet)}` : ''}</p>
            {d.merged_into && <Notice kind="warn">Merged into {d.merged_into_no}: open that customer.</Notice>}
            {d.status !== 'active' && d.hold_reason && <Notice kind={d.status === 'on_hold' ? 'warn' : 'info'}>{d.status_label}: {d.hold_reason}{d.status === 'on_hold' ? ' - a new order waits for approval.' : ''}</Notice>}
            {d.pending.map((p) => <Notice key={p.approval_id} kind="info">Waiting for approval (#{p.approval_id}): {p.summary}</Notice>)}
            <div className="a-chips a-tabs" role="tablist" aria-label="Customer">
              {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {tab === 'overview' && <Overview d={d} reload={reload} />}
            {tab === 'addresses' && <Addresses d={d} reload={reload} />}
            {tab === 'contacts' && <Contacts d={d} reload={reload} />}
            {tab === 'timeline' && <Timeline d={d} />}
            {tab === 'follow' && <FollowUps d={d} reload={reload} />}
            {tab === 'statement' && <Statement d={d} />}
            {tab === 'wallet' && <WalletPanel customerId={d.customer_id} onChanged={onChanged} />}
            {tab === 'orders' && <Orders d={d} />}
          </>
        )}
      </Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------- overview
function Overview({ d, reload }) {
  const canEdit = useCan('customers', 'edit') && !d.merged_into;
  const act = useAction();
  const [f, setF] = useState({ name: d.name, business_name: d.business_name || '', type_key: d.type_key, phone: d.phone, email: d.email || '', owner_emp_id: d.owner_emp_id || '', source: d.source || '', tags: d.tags.join(', '),
    lang_code: d.lang_code || '', opt_out_reminders: Number(d.opt_out_reminders) === 1, opt_out_offers: Number(d.opt_out_offers) === 1 });
  const [st, setSt] = useState({ status: d.status, reason: '' });
  const [credit, setCredit] = useState({ credit_days: String(d.credit_days), credit_limit: String(d.credit_limit) });
  const [pl, setPl] = useState(d.price_list || '');
  const save = () => act.run(async () => { await api.send('PUT', `/commerce/customers/${d.customer_id}`, { ...f, tags: f.tags.split(',') }); reload(); }, 'Saved');
  const saveStatus = () => act.run(async () => { await api.send('PUT', `/commerce/customers/${d.customer_id}/status`, st); reload(); }, `Status: ${d.statuses[st.status]}`);
  const saveCredit = () => act.run(async () => { const r = await api.send('PUT', `/commerce/customers/${d.customer_id}/credit`, credit); reload(); act.setMsg({ kind: r.pending ? 'info' : 'ok', text: r.pending ? `The higher limit waits for approval (#${r.approval_id}).` : 'Credit terms saved' }); });
  const savePl = () => act.run(async () => { const r = await api.send('PUT', `/commerce/customers/${d.customer_id}/price-list`, { price_list: pl }); reload(); act.setMsg({ kind: r.pending ? 'info' : 'ok', text: r.pending ? `The price list waits for approval (#${r.approval_id}).` : 'Price list saved' }); });
  const owner = (e) => (d.owners.find((o) => o.emp_id === e) || { name: e }).name;
  return (
    <>
      {act.note}
      <div className="a-grid2">
        <label className="a-field"><span>Name</span><input value={f.name} disabled={!canEdit} aria-label="Customer name" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="a-field"><span>Business name</span><input value={f.business_name} disabled={!canEdit} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></label>
        <label className="a-field"><span>Type</span><select value={f.type_key} disabled={!canEdit} aria-label="Customer type" onChange={(e) => setF({ ...f, type_key: e.target.value })}>{d.types.map((t) => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}</select></label>
        <label className="a-field"><span>Mobile</span><input value={f.phone} disabled={!canEdit} aria-label="Customer phone" onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="a-field"><span>E-mail</span><input value={f.email} disabled={!canEdit} aria-label="Customer e-mail" onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="a-field"><span>Sales owner</span><select value={f.owner_emp_id} disabled={!canEdit} aria-label="Sales owner" onChange={(e) => setF({ ...f, owner_emp_id: e.target.value })}><option value="">None</option>{d.owners.map((o) => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}</select></label>
        <label className="a-field"><span>Source</span><select value={f.source} disabled={!canEdit} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">-</option>{[...d.sources, 'Lead', 'Import'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="a-field"><span>Tags (comma separated)</span><input value={f.tags} disabled={!canEdit} aria-label="Tags" onChange={(e) => setF({ ...f, tags: e.target.value })} /></label>
        <label className="a-field"><span>Mails in</span><select value={f.lang_code} disabled={!canEdit} aria-label="Mail language" onChange={(e) => setF({ ...f, lang_code: e.target.value })}>
          {d.languages.map((l) => <option key={l.lang_code} value={Number(l.is_default) === 1 ? '' : l.lang_code}>{l.name_en}{Number(l.is_default) === 1 ? ' (default)' : ''}</option>)}</select></label>
        <div className="a-field"><span>Notifications</span>
          <label className="a-check"><input type="checkbox" checked={f.opt_out_reminders} disabled={!canEdit} aria-label="No reminders" onChange={(e) => setF({ ...f, opt_out_reminders: e.target.checked })} /> No reminders (overdue, wallet expiry)</label>
          <label className="a-check"><input type="checkbox" checked={f.opt_out_offers} disabled={!canEdit} aria-label="No offers" onChange={(e) => setF({ ...f, opt_out_offers: e.target.checked })} /> No offers</label>
          <small className="a-muted">Invoices, receipts and delivery mails always go.</small></div>
      </div>
      {canEdit && <button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save</button>}
      <p className="a-muted">{d.customer_no} · since {day(d.created_at)} by {d.created_by}{d.owner_emp_id ? ` · owner ${owner(d.owner_emp_id)}` : ''}</p>
      <div className="a-card">
        <h4>Status</h4>
        <div className="a-grid2">
          <label className="a-field"><span>Status</span><select value={st.status} disabled={!canEdit} aria-label="Customer status" onChange={(e) => setSt({ ...st, status: e.target.value })}>{Object.entries(d.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {st.status !== 'active' && <label className="a-field"><span>Why? (required)</span><input value={st.reason} aria-label="Status reason" onChange={(e) => setSt({ ...st, reason: e.target.value })} /></label>}
        </div>
        {canEdit && st.status !== d.status && <button type="button" className="a-btn a-btn-sm" disabled={act.busy || (st.status !== 'active' && !st.reason.trim())} onClick={saveStatus}>Save status</button>}
      </div>
      <div className="a-card">
        <h4>Credit and prices</h4>
        <div className="a-grid2">
          <label className="a-field"><span>Credit days</span><input inputMode="numeric" value={credit.credit_days} disabled={!canEdit} onChange={(e) => setCredit({ ...credit, credit_days: e.target.value })} /></label>
          <label className="a-field"><span>Credit limit (Rs; a higher one waits for approval)</span><input inputMode="decimal" value={credit.credit_limit} disabled={!canEdit} onChange={(e) => setCredit({ ...credit, credit_limit: e.target.value })} /></label>
        </div>
        {canEdit && (credit.credit_days !== String(d.credit_days) || credit.credit_limit !== String(d.credit_limit)) && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={saveCredit}>Save credit</button>}
        <label className="a-field"><span>Price list (now: {d.priceList.label}{d.priceList.own ? ', its own' : `, its type's`})</span>
          <select value={pl} disabled={!canEdit} aria-label="Price list" onChange={(e) => setPl(e.target.value)}><option value="">Its type&apos;s list ({d.type_label})</option>{d.lists.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        {canEdit && pl !== (d.price_list || '') && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={savePl}>{pl ? 'Ask for this price list (approval)' : 'Back to its type\'s list'}</button>}
      </div>
      {d.lead && (
        <div className="a-card">
          <h4>From lead {d.lead.lead_ref}</h4>
          <dl className="a-dl">
            <div><dt>Came in</dt><dd>{fmtDate(d.lead.created_at)} · {d.lead.form_type} form{d.lead.source_page ? ` on ${d.lead.source_page}` : ''}</dd></div>
            <div><dt>Lead status</dt><dd>{d.lead.status}{d.lead.updated_at ? ` (last change ${fmtDate(d.lead.updated_at)})` : ''}</dd></div>
            <div><dt>Contact</dt><dd>{d.lead.full_name}{d.lead.business_name ? `, ${d.lead.business_name}` : ''}{d.lead.business_type ? ` (${d.lead.business_type})` : ''} · {d.lead.phone}{d.lead.email ? ` · ${d.lead.email}` : ''}</dd></div>
            {d.lead.monthly_quantity && <div><dt>Quantity</dt><dd>{d.lead.monthly_quantity}</dd></div>}
            {d.lead.products && d.lead.products.length > 0 && <div><dt>Products</dt><dd>{d.lead.products.join(', ')}</dd></div>}
            {d.lead.message && <div><dt>Message</dt><dd>{d.lead.message}</dd></div>}
            {d.lead.staff_notes && <div><dt>Staff notes</dt><dd>{d.lead.staff_notes}</dd></div>}
          </dl>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- addresses, contacts
function Addresses({ d, reload }) {
  const canEdit = useCan('customers', 'edit') && !d.merged_into;
  const act = useAction();
  const [form, setForm] = useState(null); // { ...address, kind, address_id? }
  const save = () => act.run(async () => {
    const body = { ...form, delivery_area_id: form.delivery_area_id || '' };
    if (form.address_id) await api.send('PUT', `/commerce/customers/${d.customer_id}/addresses/${form.address_id}`, body);
    else await api.send('POST', `/commerce/customers/${d.customer_id}/addresses`, body);
    setForm(null); reload();
  }, 'Address saved');
  const def = (a) => act.run(async () => { await api.send('PUT', `/commerce/customers/${d.customer_id}/addresses/${a.address_id}`, { ...a, is_default: true }); reload(); }, `${a.label || a.name} is the default ${a.kind} address`);
  const remove = (a) => act.run(async () => { await api.send('PUT', `/commerce/customers/${d.customer_id}/addresses/${a.address_id}`, { is_active: false }); reload(); }, 'Address removed');
  return (
    <>
      {act.note}
      {['billing', 'shipping'].map((kind) => (
        <div key={kind}>
          <h3>{kind === 'billing' ? 'Billing addresses (the GSTIN of each branch)' : 'Shipping addresses'}</h3>
          <div className="a-addr">
            {d.addresses.filter((a) => a.kind === kind).map((a) => (
              <div key={a.address_id} className="a-card">
                <h4>{a.label || a.name} {a.is_default && <span className="a-status a-ap-approved">Default</span>}</h4>
                <div>{a.name}</div>{a.gstin && <div>GSTIN <b>{a.gstin}</b></div>}{a.contact_person && <div>Contact: {a.contact_person}</div>}
                <div>{[a.address, a.town, a.pincode].filter(Boolean).join(', ')}</div><div>{a.state} ({a.state_code}){a.area ? ` · area ${a.area}` : ''}</div>{a.phone && <div>{a.phone}</div>}
                {canEdit && <span className="a-row">
                  <button type="button" className="a-link" onClick={() => setForm({ ...a, delivery_area_id: a.delivery_area_id || '' })}>Edit</button>
                  {!a.is_default && <button type="button" className="a-link" onClick={() => def(a)}>Make default</button>}
                  {!a.is_default && <button type="button" className="a-link" onClick={() => remove(a)}>Remove</button>}</span>}
              </div>
            ))}
          </div>
          {canEdit && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setForm({ kind, label: '', name: d.business_name || d.name, gstin: '', contact_person: '', phone: '', address: '', town: '', state_code: '33', pincode: '', delivery_area_id: '' })}>Add a {kind} address</button>}
        </div>
      ))}
      {form && (
        <div className="a-card">
          <h4>{form.address_id ? 'Change the address' : `New ${form.kind} address`}</h4>
          <AddressFields a={form} set={setForm} kind={form.kind} areas={d.areas} prefix="Address" />
          <label className="a-inline"><input type="checkbox" checked={Boolean(form.is_default)} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Default {form.kind} address</label>
          <span className="a-row"><button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save address</button><button type="button" className="a-btn a-btn-ghost" onClick={() => setForm(null)}>Cancel</button></span>
        </div>
      )}
    </>
  );
}

function Contacts({ d, reload }) {
  const canEdit = useCan('customers', 'edit') && !d.merged_into;
  const act = useAction();
  const [form, setForm] = useState(null);
  const save = () => act.run(async () => {
    if (form.contact_id) await api.send('PUT', `/commerce/customers/${d.customer_id}/contacts/${form.contact_id}`, form);
    else await api.send('POST', `/commerce/customers/${d.customer_id}/contacts`, form);
    setForm(null); reload();
  }, 'Contact saved');
  const remove = (x) => act.run(async () => { await api.send('PUT', `/commerce/customers/${d.customer_id}/contacts/${x.contact_id}`, { is_active: false }); reload(); }, 'Contact removed');
  return (
    <>
      {act.note}
      {d.contacts.length ? (
        <table className="a-table"><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>E-mail</th><th>WhatsApp</th><th>Invoices</th><th /></tr></thead>
          <tbody>{d.contacts.map((x) => (
            <tr key={x.contact_id}><td>{x.name}</td><td>{x.role}</td><td>{x.phone && <a href={`tel:${x.phone.replace(/\s/g, '')}`}>{x.phone}</a>}</td><td>{x.email}</td><td>{x.whatsapp ? 'Yes' : ''}</td><td>{x.gets_invoices ? 'Yes' : ''}</td>
              <td>{canEdit && <span className="a-row"><button type="button" className="a-link" onClick={() => setForm(x)}>Edit</button><button type="button" className="a-link" onClick={() => remove(x)}>Remove</button></span>}</td></tr>
          ))}</tbody></table>
      ) : <p className="a-muted">No contact person yet.</p>}
      {canEdit && !form && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setForm({ name: '', role: '', phone: '', email: '', whatsapp: true, gets_invoices: false })}>Add a contact</button>}
      {form && (
        <div className="a-card">
          <div className="a-grid2">
            {['name', 'role', 'phone', 'email'].map((k) => <label key={k} className="a-field"><span>{{ name: 'Name', role: 'Role', phone: 'Phone', email: 'E-mail' }[k]}</span><input value={form[k] || ''} aria-label={`Contact ${k}`} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>)}
          </div>
          <span className="a-row">
            <label className="a-inline"><input type="checkbox" checked={Boolean(form.whatsapp)} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} /> On WhatsApp</label>
            <label className="a-inline"><input type="checkbox" checked={Boolean(form.gets_invoices)} onChange={(e) => setForm({ ...form, gets_invoices: e.target.checked })} /> Gets invoices</label>
          </span>
          <span className="a-row"><button type="button" className="a-btn" disabled={act.busy || !form.name.trim()} onClick={save}>Save contact</button><button type="button" className="a-btn a-btn-ghost" onClick={() => setForm(null)}>Cancel</button></span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- timeline, follow-ups
const KIND_LABEL = { call: 'Call', whatsapp: 'WhatsApp', visit: 'Visit', mail: 'Mail', note: 'Note', order: 'Order', delivered: 'Delivered', cancelled: 'Cancelled', payment: 'Payment', refund: 'Refund' };
function Timeline({ d }) {
  const t = useLoad(`/commerce/customers/${d.customer_id}/timeline`);
  const canEdit = useCan('customers', 'edit') && !d.merged_into;
  const act = useAction();
  const [f, setF] = useState({ kind: 'call', happened_at: '', note: '' });
  const add = () => act.run(async () => { await api.send('POST', `/commerce/customers/${d.customer_id}/activity`, f); setF({ kind: 'call', happened_at: '', note: '' }); t.reload(); }, 'Added to the timeline');
  const label = (r) => (r.src === 'activity' ? KIND_LABEL[r.kind] : r.src === 'return' ? 'Return' : r.src === 'wallet' ? 'Wallet' : r.src === 'follow_up' ? 'Follow-up' : r.src === 'notification' ? 'Notification' : KIND_LABEL[r.kind] || r.kind);
  return (
    <>
      {act.note}
      {canEdit && (
        <div className="a-card">
          <div className="a-grid2">
            <label className="a-field"><span>What</span><select value={f.kind} aria-label="Activity kind" onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(d.activityKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="a-field"><span>When (empty = now)</span><input type="datetime-local" value={f.happened_at} aria-label="Activity time" onChange={(e) => setF({ ...f, happened_at: e.target.value })} /></label>
          </div>
          <label className="a-field"><span>What was said or done</span><textarea rows={2} value={f.note} maxLength={2000} aria-label="Activity note" onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy || !f.note.trim()} onClick={add}>Add</button>
        </div>
      )}
      <Loading state={t}>
        {t.data && (
          <ul className="a-timeline">{t.data.map((r, i) => (
            <li key={i} className={`a-tl-${r.src}`}><span className="a-tl-when">{fmtDate(r.at)}</span> <b>{label(r)}</b> {r.text}{r.emp_id ? <small className="a-muted"> ({r.emp_id})</small> : null}</li>
          ))}</ul>
        )}
      </Loading>
    </>
  );
}

function FollowUps({ d, reload }) {
  const canEdit = useCan('customers', 'edit') && !d.merged_into;
  const act = useAction();
  const [f, setF] = useState({ assignee: d.owner_emp_id || '', due_on: ist(1), note: '' });
  const add = () => act.run(async () => { await api.send('POST', `/commerce/customers/${d.customer_id}/follow-ups`, f); setF({ ...f, note: '' }); reload(); }, 'Follow-up added');
  return (
    <>
      {act.note}
      {canEdit && (
        <div className="a-card">
          <div className="a-grid2">
            <label className="a-field"><span>For</span><select value={f.assignee} aria-label="Follow-up for" onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Me</option>{d.owners.map((o) => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}</select></label>
            <label className="a-field"><span>Due on</span><input type="date" value={f.due_on} aria-label="Follow-up due" onChange={(e) => setF({ ...f, due_on: e.target.value })} /></label>
          </div>
          <label className="a-field"><span>About</span><input value={f.note} maxLength={255} aria-label="Follow-up note" onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy || !f.note.trim()} onClick={add}>Add follow-up</button>
        </div>
      )}
      <FollowUpList rows={d.followUps.map((x) => ({ ...x, customer: null }))} people={d.owners} onChanged={reload} />
    </>
  );
}

/** follow-ups with Done / Snooze (also used by My follow-ups) */
export function FollowUpList({ rows, people, onChanged, onOpen }) {
  const act = useAction();
  const [done, setDone] = useState(null); // { id, note }
  const who = (e) => (people.find((p) => p.emp_id === e) || { name: e }).name;
  const call = (fid, body, text) => act.run(async () => { await api.send('PUT', `/commerce/follow-ups/${fid}`, body); setDone(null); onChanged(); }, text);
  if (!rows.length) return <p className="a-muted">No follow-up.</p>;
  return (
    <>
      {act.note}
      <div className="a-scroll">
      <table className="a-table">
        <thead><tr><th>Due</th>{rows[0].customer !== null && <th>Customer</th>}<th>About</th><th>For</th><th /></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.follow_up_id} className={x.status === 'done' ? 'a-offrow' : x.overdue ? 'a-lowrow' : undefined}>
            <td>{day(x.due_on)}{x.overdue && x.status !== 'done' && <span className="a-overdue">Overdue</span>}{x.snoozes > 0 && <small className="a-muted a-person-sub">snoozed {x.snoozes}x</small>}</td>
            {x.customer !== null && <td>{onOpen ? <button type="button" className="a-link" onClick={() => onOpen(x.customer_id)}><code>{x.customer_no}</code> {x.customer}</button> : x.customer}<small className="a-muted a-person-sub">{x.phone}</small></td>}
            <td>{x.note}{x.status === 'done' && <small className="a-muted a-person-sub">done {fmtDate(x.done_at)} by {x.done_by}{x.done_note ? `: ${x.done_note}` : ''}</small>}</td>
            <td>{who(x.assignee)}</td>
            <td>{x.status === 'open' && (done && done.id === x.follow_up_id ? (
              <span className="a-row"><input value={done.note} placeholder="Outcome (optional)" aria-label="Follow-up outcome" onChange={(e) => setDone({ ...done, note: e.target.value })} />
                <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => call(x.follow_up_id, { action: 'done', note: done.note }, 'Done')}>Save</button></span>
            ) : (
              <span className="a-row">
                <button type="button" className="a-btn a-btn-sm" onClick={() => setDone({ id: x.follow_up_id, note: '' })}>Done</button>
                <select value="" aria-label="Snooze" onChange={(e) => e.target.value && call(x.follow_up_id, { action: 'snooze', days: Number(e.target.value) }, `Snoozed ${e.target.value} day(s)`)}>
                  <option value="">Snooze...</option>{[1, 2, 3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>)}</select>
              </span>
            ))}</td>
          </tr>
        ))}</tbody>
      </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- statement of account
const BUCKETS = [['d0_30', '0-30 days'], ['d31_60', '31-60 days'], ['d61_90', '61-90 days'], ['d90', '90+ days']];
function printStatement(s) {
  const c = s.customer; const b = s.bill || {};
  const rows = s.lines.map((l) => `<tr><td>${esc(day(l.day))}</td><td>${esc(l.text)}</td><td class="n">${l.debit ? esc(rs(l.debit)) : ''}</td><td class="n">${l.credit ? esc(rs(l.credit)) : ''}</td><td class="n">${esc(rs(l.balance))}</td></tr>`).join('');
  return printPage({
    title: `Statement ${c.customer_no}`,
    body: `<div class="row"><div><h1>Statement of account</h1><b>${esc(s.seller.name)}</b><br>${esc(s.seller.address)}</div>
      <div><b>${esc(c.customer_no)} ${esc(b.name || c.business_name || c.name)}</b><br>${esc([b.address, b.town, b.pincode].filter(Boolean).join(', '))}${b.gstin ? `<br>GSTIN ${esc(b.gstin)}` : ''}<br>${esc(c.phone)}<br>
      Period: ${s.from ? esc(day(s.from)) : 'from the start'} to ${s.to ? esc(day(s.to)) : esc(day(ist()))}<br>Credit: ${c.credit_days} days, limit ${esc(rs(c.credit_limit))}</div></div>
      <table><thead><tr><th>Date</th><th>Details</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>
      ${s.from ? `<tr><td></td><td>Opening balance</td><td></td><td></td><td class="n">${esc(rs(s.opening))}</td></tr>` : ''}${rows}
      <tr><td></td><td><b>Closing balance</b></td><td></td><td></td><td class="n"><b>${esc(rs(s.closing))}</b></td></tr></tbody></table>
      <h2>Ageing of what is open (by invoice date)</h2>
      <table><thead><tr>${BUCKETS.map(([, l]) => `<th class="n">${l}</th>`).join('')}<th class="n">Total open</th></tr></thead><tbody><tr>${BUCKETS.map(([k]) => `<td class="n">${esc(rs(s.ageing[k]))}</td>`).join('')}<td class="n"><b>${esc(rs(s.outstanding))}</b></td></tr></tbody></table>
      ${s.open.length ? `<p>${s.open.map((o) => `${esc(o.invoice_no)} (${esc(day(o.day))}, ${o.age} days${o.overdue ? ', OVERDUE' : ''}): ${esc(rs(o.amount_due))}`).join('<br>')}</p>` : ''}`,
  });
}
function Statement({ d }) {
  const [p, setP] = useState({ from: '', to: '' });
  const s = useLoad(`/commerce/customers/${d.customer_id}/statement?from=${p.from}&to=${p.to}`);
  const act = useAction();
  const x = s.data;
  return (
    <>
      {act.note}
      <div className="a-filters">
        <label>From <input type="date" value={p.from} aria-label="Statement from" onChange={(e) => setP({ ...p, from: e.target.value })} /></label>
        <label>To <input type="date" value={p.to} aria-label="Statement to" onChange={(e) => setP({ ...p, to: e.target.value })} /></label>
        {x && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { if (!printStatement(x)) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print.' }); }}>Print / PDF</button>}
      </div>
      <Loading state={s}>
        {x && (
          <>
            <div className="a-stats a-ageing">
              {BUCKETS.map(([k, l]) => <div key={k} className={`a-stat${k === 'd90' && x.ageing[k] > 0 ? ' a-stat-bad' : ''}`}><b>{rs(x.ageing[k])}</b><span>{l}</span></div>)}
              <div className="a-stat"><b>{rs(x.outstanding)}</b><span>open in all</span></div>
            </div>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>Date</th><th>Details</th><th className="a-num">Debit</th><th className="a-num">Credit</th><th className="a-num">Balance</th></tr></thead>
                <tbody>
                  {x.from && <tr><td /><td>Opening balance</td><td /><td /><td className="a-num">{rs(x.opening)}</td></tr>}
                  {x.lines.map((l, i) => <tr key={i}><td>{day(l.day)}</td><td>{l.text}</td><td className="a-num">{l.debit ? rs(l.debit) : ''}</td><td className="a-num">{l.credit ? rs(l.credit) : ''}</td><td className="a-num">{rs(l.balance)}</td></tr>)}
                  <tr><td /><td><b>Closing balance</b></td><td /><td /><td className="a-num"><b>{rs(x.closing)}</b></td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loading>
    </>
  );
}

function Orders({ d }) {
  if (!d.orders.length) return <p className="a-muted">No order yet.</p>;
  return (
    <div className="a-scroll">
      <table className="a-table"><thead><tr><th>Order</th><th>Status</th><th>Billed to GSTIN</th><th>Ship to</th><th className="a-num">Total</th><th className="a-num">Due</th><th>Invoice</th><th>Received</th></tr></thead>
        <tbody>{d.orders.map((o) => (
          <tr key={o.order_no}><td><code>{o.order_no}</code></td><td><span className={`a-ostatus a-ostatus-${o.status}`}>{o.status.replace(/_/g, ' ')}</span></td><td>{o.bill_gstin || ''}</td><td>{o.ship_town}</td>
            <td className="a-num">{rs(o.total)}</td><td className="a-num">{Number(o.amount_due) > 0 && o.status !== 'cancelled' ? rs(o.amount_due) : ''}{o.overdue && <span className="a-overdue">Overdue</span>}</td>
            <td>{o.invoice_no || ''}{o.due_on && <small className="a-muted a-person-sub">due {day(o.due_on)}</small>}</td><td>{fmtDate(o.created_at)}</td></tr>
        ))}</tbody></table>
    </div>
  );
}
