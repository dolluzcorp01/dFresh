// dFresh Commerce (DEMO, database dfresh_commerce): customers (CRM). Made from an order's customer list, or from a
// lead (Leads > open > Convert to customer). Type, notes, follow-up date (red when due), orders, wallet balance and
// wallet history (cashback, refunds, wallet used on orders). ?open=<id> opens one (link from the lead drawer).
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, fmtDate, useAction, useCan, useLoad } from './ui';
import { rs } from './CommerceReturns';

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
      </div>
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Customer</th><th>Type</th><th>Town</th><th className="a-num">Orders</th><th className="a-num">Spent</th><th className="a-num">Wallet</th><th>Follow-up</th><th>Last order</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.customer_id} className="a-rowlink" tabIndex={0} onClick={() => setOpen(c.customer_id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(c.customer_id)}>
                  <td>{c.name} <small className="a-muted">{c.phone}</small>{c.lead_id ? <small className="a-muted"> (from a lead)</small> : null}</td>
                  <td>{c.ctype}</td><td>{c.town}</td>
                  <td className="a-num">{c.orders}</td><td className="a-num">{rs(c.spent)}</td>
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
    </section>
  );
}

function CustomerDrawer({ id, onClose, onChanged }) {
  const c = useLoad(`/commerce/customers/${id}`);
  const canEdit = useCan('editor');
  const act = useAction();
  const [form, setForm] = useState(null);
  const d = c.data;
  useEffect(() => { if (d) setForm({ name: d.name, phone: d.phone, email: d.email || '', ctype: d.ctype, town: d.town || '', address: d.address || '', gstin: d.gstin || '', notes: d.notes || '', follow_up: d.follow_up || '' }); }, [d]);
  const dirty = Boolean(d && form && Object.keys(form).some((k) => String(form[k] ?? '') !== String(d[k] ?? '')));
  const save = () => act.run(async () => { await api.send('PUT', `/commerce/customers/${id}`, form); c.reload(); onChanged(); }, 'Saved');
  const field = (k, label, props = {}) => (
    <label className="a-field" key={k}><span>{label}</span>
      {k === 'notes' ? <textarea rows={3} value={form[k]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        : k === 'ctype' ? <select value={form[k]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
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
            <div className="a-grid2">
              {field('name', 'Name')}{field('phone', 'Phone')}{field('ctype', 'Type')}{field('town', 'Town')}
              {field('email', 'E-mail')}{field('gstin', 'GSTIN')}{field('follow_up', 'Follow-up date', { type: 'date' })}{field('address', 'Address')}
            </div>
            {field('notes', 'Notes')}
            <h3>Wallet: {rs(d.balance)}</h3>
            {d.wallet.length ? (
              <table className="a-table"><thead><tr><th>When</th><th>What</th><th className="a-num">Amount</th></tr></thead>
                <tbody>{d.wallet.map((w) => <tr key={w.entry_id}><td>{fmtDate(w.created_at)}</td><td>{w.reason}</td><td className={`a-num ${Number(w.amount) < 0 ? 'a-bad' : 'a-ok'}`}>{Number(w.amount) > 0 ? '+' : ''}{rs(w.amount)}</td></tr>)}</tbody></table>
            ) : <p className="a-muted">No wallet movements yet.</p>}
            <h3>Orders ({d.orders.length})</h3>
            {d.orders.length ? (
              <table className="a-table"><thead><tr><th>Order</th><th>Status</th><th className="a-num">Total</th><th>Received</th></tr></thead>
                <tbody>{d.orders.map((o) => <tr key={o.order_no}><td><code>{o.order_no}</code></td><td><span className={`a-ostatus a-ostatus-${o.status}`}>{o.status}</span></td><td className="a-num">{rs(o.total)}</td><td>{fmtDate(o.created_at)}</td></tr>)}</tbody></table>
            ) : <p className="a-muted">No orders yet.</p>}
          </>
        )}
      </Loading>
    </Drawer>
  );
}
