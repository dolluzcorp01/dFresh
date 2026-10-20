// dFresh Commerce (DEMO, database dfresh_commerce): customers (CRM). Made from an order's customer list, or from a
// lead (Leads > open > Convert to customer). Type, notes, follow-up date (red when due), orders, wallet balance and
// wallet history (cashback, refunds, wallet used on orders). ?open=<id> opens one (link from the lead drawer).
// Phase 3: state and PIN (the state decides CGST + SGST or IGST on orders), credit days and limit (a higher limit waits
// for approval), what the customer owes and an Overdue badge when an invoice is past its due date.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, fmtDate, useAction, useCan, useLoad } from './ui';
import { rs } from './CommerceReturns';
import { CTYPES, SOURCES, checkCustomer } from '../shared/customerRules';
import { GST_STATES } from '../shared/gstStates';

const TYPES = ['Home', 'Hotel', 'Hospital', 'Office', 'Distributor'];
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '');

export default function CommerceCustomers() {
  const list = useLoad('/commerce/customers');
  const location = useLocation();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => Number(new URLSearchParams(location.search).get('open')) || null);
  useEffect(() => { const id = Number(new URLSearchParams(location.search).get('open')); if (id) setOpen(id); }, [location.search]);
  const rows = useMemo(() => list.data || [], [list.data]);
  const shown = rows.filter((r) => (!type || r.ctype === type) && (!q.trim() || `${r.name} ${r.phone} ${r.town}`.toLowerCase().includes(q.trim().toLowerCase())));
  const due = rows.filter((r) => r.follow_due).length;
  const [adding, setAdding] = useState(false);
  const canEdit = useCan('customers', 'create');
  return (
    <section>
      <h1>Customers</h1>
      <InfoCard title="Commerce demo - customers (CRM)">
        <ul>
          <li>Every order belongs to a customer. A lead becomes a customer with Convert to customer in the lead drawer.</li>
          <li>Type, notes and a follow-up date (red when it is due); the customer&apos;s orders and wallet with its history.</li>
          <li>Wallet credit comes from cashback and refunds and can be used on the next order.</li>
        </ul>
      </InfoCard>
      <div className="a-toolbar">
        <div className="a-chips" role="group" aria-label="Type">
          <button type="button" className={`a-chip${type === '' ? ' on' : ''}`} onClick={() => setType('')}>All {rows.length}</button>
          {TYPES.map((t) => <button key={t} type="button" className={`a-chip${type === t ? ' on' : ''}`} onClick={() => setType(t)}>{t} {rows.filter((r) => r.ctype === t).length}</button>)}
        </div>
        <input type="search" placeholder="Search name, phone, town" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {due > 0 && <span className="a-status a-status-bad">{due} follow-up{due > 1 ? 's' : ''} due</span>}
        {canEdit && <button type="button" className="a-btn" onClick={() => setAdding(true)}>Add customer</button>}
      </div>
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Customer</th><th>Type</th><th>Town</th><th className="a-num">Orders</th><th className="a-num">Spent</th><th className="a-num">Owes</th><th className="a-num">Wallet</th><th>Follow-up</th><th>Last order</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.customer_id} className="a-rowlink" tabIndex={0} onClick={() => setOpen(c.customer_id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(c.customer_id)}>
                  <td>{c.name} <small className="a-muted">{c.phone}</small>{c.lead_id ? <small className="a-muted"> (from a lead)</small> : null}</td>
                  <td>{c.ctype}</td><td>{c.town}</td>
                  <td className="a-num">{c.orders}</td><td className="a-num">{rs(c.spent)}</td>
                  <td className="a-num">{c.outstanding ? rs(c.outstanding) : ''}{c.overdue > 0 && <span className="a-overdue">Overdue</span>}</td>
                  <td className="a-num">{c.wallet ? rs(c.wallet) : ''}</td>
                  <td>{c.follow_up ? <span className={c.follow_due ? 'a-status a-status-bad' : ''}>{day(c.follow_up)}</span> : ''}</td>
                  <td>{fmtDate(c.last_order)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open && <CustomerDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {adding && (
        <NewCustomerDrawer onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); list.reload(); setOpen(c.customer_id); }}
          onOpenExisting={(id) => { setAdding(false); setOpen(id); }} />
      )}
    </section>
  );
}

function CustomerDrawer({ id, onClose, onChanged }) {
  const c = useLoad(`/commerce/customers/${id}`);
  const canEdit = useCan('customers', 'edit');
  const act = useAction();
  const [form, setForm] = useState(null);
  const d = c.data;
  useEffect(() => { if (d) setForm({ name: d.name, phone: d.phone, email: d.email || '', ctype: d.ctype, town: d.town || '', state_code: d.state_code || '33', pincode: d.pincode || '', address: d.address || '', gstin: d.gstin || '', notes: d.notes || '', follow_up: d.follow_up || '' }); }, [d]);
  const [credit, setCredit] = useState(null);
  useEffect(() => { if (d) setCredit({ credit_days: String(d.credit_days), credit_limit: String(d.credit_limit) }); }, [d]);
  const creditDirty = Boolean(d && credit && (credit.credit_days !== String(d.credit_days) || credit.credit_limit !== String(d.credit_limit)));
  const saveCredit = () => act.run(async () => {
    const r = await api.send('PUT', `/commerce/customers/${id}/credit`, credit);
    c.reload(); onChanged();
    act.setMsg({ kind: r.pending ? 'info' : 'ok', text: r.pending ? `The higher credit limit waits for approval (request #${r.approval_id}).` : 'Credit terms saved.' });
  });
  const dirty = Boolean(d && form && Object.keys(form).some((k) => String(form[k] ?? '') !== String(d[k] ?? '')));
  const save = () => act.run(async () => { await api.send('PUT', `/commerce/customers/${id}`, form); c.reload(); onChanged(); }, 'Saved');
  const field = (k, label, props = {}) => (
    <label className="a-field" key={k}><span>{label}</span>
      {k === 'notes' ? <textarea rows={3} value={form[k]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        : k === 'ctype' ? <select value={form[k]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          : k === 'state_code' ? <select value={form[k]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>{GST_STATES.map(([code, nm]) => <option key={code} value={code}>{nm} ({code})</option>)}</select>
          : <input value={form[k]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />}
    </label>
  );
  return (
    <Drawer title={d ? d.name : 'Customer'} onClose={onClose} dirty={dirty}
      footer={canEdit && form ? <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>Save</button> : null}>
      <Loading state={c}>
        {d && form && (
          <>
            {act.note}
            {d.lead && <p className="a-muted">From lead <code>{d.lead.lead_ref}</code> ({d.lead.form_type}, {fmtDate(d.lead.created_at)})</p>}
            {!d.lead && d.source && <p className="a-muted">Source: {d.source} ({fmtDate(d.created_at)})</p>}
            {d.business_name && <p className="a-muted">Business: {d.business_name}</p>}
            <div className="a-grid2">
              {field('name', 'Name')}{field('phone', 'Phone')}{field('ctype', 'Type')}{field('town', 'Town')}
              {field('state_code', 'State')}{field('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
              {field('email', 'E-mail')}{field('gstin', 'GSTIN')}{field('follow_up', 'Follow-up date', { type: 'date' })}{field('address', 'Address')}
            </div>
            {field('notes', 'Notes')}
            <h3>Credit</h3>
            <p>Owes <b>{rs(d.outstanding)}</b> on open orders{d.orders.some((o) => o.overdue) && <span className="a-overdue">Overdue</span>}
              {d.pendingCredit && <span className="a-muted"> · waiting for approval: {d.pendingCredit.summary}</span>}</p>
            {credit && (
              <div className="a-toolbar">
                <label className="a-inline">Credit days <input className="a-qty" inputMode="numeric" value={credit.credit_days} disabled={!canEdit} onChange={(e) => setCredit({ ...credit, credit_days: e.target.value })} /></label>
                <label className="a-inline">Credit limit (Rs) <input className="a-price" inputMode="decimal" value={credit.credit_limit} disabled={!canEdit} onChange={(e) => setCredit({ ...credit, credit_limit: e.target.value })} /></label>
                {canEdit && <button type="button" className="a-btn a-btn-sm" disabled={!creditDirty || act.busy} onClick={saveCredit}>Save credit</button>}
                <small className="a-muted">0 days and Rs 0 = no credit. A higher limit waits for approval; an order over the limit or with an overdue invoice too.</small>
              </div>
            )}
            <h3>Wallet: {rs(d.balance)}</h3>
            {d.wallet.length ? (
              <table className="a-table"><thead><tr><th>When</th><th>What</th><th className="a-num">Amount</th></tr></thead>
                <tbody>{d.wallet.map((w) => <tr key={w.entry_id}><td>{fmtDate(w.created_at)}</td><td>{w.reason}</td><td className={`a-num ${Number(w.amount) < 0 ? 'a-bad' : 'a-ok'}`}>{Number(w.amount) > 0 ? '+' : ''}{rs(w.amount)}</td></tr>)}</tbody></table>
            ) : <p className="a-muted">No wallet movements yet.</p>}
            <h3>Orders ({d.orders.length})</h3>
            {d.orders.length ? (
              <div className="a-scroll">
                <table className="a-table"><thead><tr><th>Order</th><th>Status</th><th className="a-num">Total</th><th className="a-num">Due</th><th>Invoice</th><th>Received</th></tr></thead>
                  <tbody>{d.orders.map((o) => (
                    <tr key={o.order_no}><td><code>{o.order_no}</code></td><td><span className={`a-ostatus a-ostatus-${o.status}`}>{o.status}</span></td><td className="a-num">{rs(o.total)}</td>
                      <td className="a-num">{Number(o.amount_due) > 0 && o.status !== 'cancelled' ? rs(o.amount_due) : ''}{o.overdue && <span className="a-overdue">Overdue</span>}</td>
                      <td>{o.invoice_no ? <>{o.invoice_no}<small className="a-muted a-person-sub">due {day(o.due_on)}</small></> : ''}</td><td>{fmtDate(o.created_at)}</td></tr>
                  ))}</tbody></table>
              </div>
            ) : <p className="a-muted">No orders yet.</p>}
          </>
        )}
      </Loading>
    </Drawer>
  );
}

const EMPTY_CUSTOMER = { name: '', phone: '', email: '', ctype: 'Home', business_name: '', gstin: '', address: '', town: '', state_code: '33', pincode: '', source: 'Phone', notes: '', follow_up: '' };

/**
 * Add a customer typed in the admin (phone / WhatsApp / walk-in). Errors in red under each field (shared rules with the
 * server: src/shared/customerRules.js). A phone or e-mail that is already a customer: "Already a customer: <name>" + Open.
 * onSaved(customer) after saving; onOpenExisting(id) for the Open button.
 */
export function NewCustomerDrawer({ onClose, onSaved, onOpenExisting }) {
  const act = useAction();
  const [f, setF] = useState(EMPTY_CUSTOMER);
  const [errors, setErrors] = useState({});
  const [dup, setDup] = useState(null); // { customer_id, name }
  const dirty = Object.keys(EMPTY_CUSTOMER).some((k) => f[k] !== EMPTY_CUSTOMER[k]);
  const set = (k, v) => { setF({ ...f, [k]: v }); if (errors[k]) setErrors({ ...errors, [k]: undefined }); if (dup && (k === 'phone' || k === 'email')) setDup(null); };
  const save = () => {
    const chk = checkCustomer(f);
    setErrors(chk.errors);
    if (Object.keys(chk.errors).length) return;
    act.run(async () => {
      try {
        onSaved(await api.send('POST', '/commerce/customers', f));
      } catch (e) {
        const body = e.data || {};
        if (body.code === 'duplicate') { setDup(body.fields); return; }
        if (body.code === 'fields') { setErrors(body.fields || {}); return; }
        throw e;
      }
    });
  };
  const field = (k, label, input) => (
    <label className="a-field" key={k}><span>{label}</span>{input}
      {errors[k] && <small className="a-bad" role="alert">{errors[k]}</small>}
    </label>
  );
  const text = (k, props = {}) => <input value={f[k]} aria-invalid={errors[k] ? 'true' : undefined} onChange={(e) => set(k, e.target.value)} {...props} />;
  return (
    <Drawer title="New customer" onClose={onClose} dirty={dirty}
      footer={<button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save customer</button>}>
      {act.note}
      {dup && (
        <div className="a-note a-note-warn" role="alert">
          Already a customer: <b>{dup.name}</b>{' '}
          <button type="button" className="a-btn a-btn-sm" onClick={() => onOpenExisting(dup.customer_id)}>Open</button>
        </div>
      )}
      <div className="a-grid2">
        {field('name', 'Name *', text('name', { maxLength: 120, autoFocus: true }))}
        {field('phone', 'Phone * (10-digit mobile)', text('phone', { inputMode: 'tel', placeholder: '98765 43210' }))}
        {field('email', 'E-mail', text('email', { type: 'email' }))}
        {field('ctype', 'Type', <select value={f.ctype} onChange={(e) => set('ctype', e.target.value)}>{CTYPES.map((t) => <option key={t}>{t}</option>)}</select>)}
        {field('business_name', 'Business name', text('business_name', { maxLength: 150 }))}
        {field('gstin', 'GSTIN', text('gstin', { placeholder: '33ABCDE1234F1Z5' }))}
        {field('town', 'Town', text('town', { maxLength: 80 }))}
        {field('state_code', 'State', <select value={f.state_code} onChange={(e) => set('state_code', e.target.value)}>{GST_STATES.map(([code, nm]) => <option key={code} value={code}>{nm} ({code})</option>)}</select>)}
        {field('pincode', 'PIN code', text('pincode', { inputMode: 'numeric', maxLength: 6 }))}
        {field('source', 'Source', <select value={f.source} onChange={(e) => set('source', e.target.value)}>{SOURCES.map((t) => <option key={t}>{t}</option>)}</select>)}
        {field('address', 'Address', text('address', { maxLength: 255 }))}
        {field('follow_up', 'Follow-up date', text('follow_up', { type: 'date' }))}
      </div>
      {field('notes', 'Notes', <textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />)}
    </Drawer>
  );
}
