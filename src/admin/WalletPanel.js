// A customer's wallet (API /commerce/customers/:id/wallet; logic in src/backend_routes/wallet.js), in the Customers
// drawer and Promotions > Wallets: balance, what can be used now, credits expiring, the statement (every entry with its
// source and the running balance, printable), and the manual credit / debit (Promotions create; through approval when
// the Commerce setting says so).
import { useState } from 'react';
import { api } from './adminApi';
import { Loading, Notice, fmtDate, useAction, useLoad } from './ui';
import { esc, printPage, rs } from './printKit';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');

function printStatement(w) {
  const c = w.customer;
  const rows = w.entries.map((e) => `<tr><td>${esc(fmtDate(e.created_at))}</td><td>${esc(e.source_label)}</td><td>${esc(e.reason)}${e.order_no ? `<br><small>${esc(e.order_no)}</small>` : ''}${e.expires_on ? `<br><small>expires ${esc(day(e.expires_on))}</small>` : ''}</td>
    <td class="n">${e.amount > 0 ? esc(rs(e.amount)) : ''}</td><td class="n">${e.amount < 0 ? esc(rs(-e.amount)) : ''}</td><td class="n">${esc(rs(e.balance))}</td></tr>`).join('');
  return printPage({
    title: `Wallet statement ${c.name}`,
    body: `<div class="row"><div><h1>Wallet statement</h1><b>${esc(c.business_name || c.name)}</b><br>${esc(c.address || '')} ${esc(c.town || '')}<br>${esc(c.phone || '')}</div>
      <div>dFresh<br>Printed ${esc(fmtDate(new Date().toISOString()))}<br><b>Balance ${esc(rs(w.balance))}</b></div></div>
      <table><thead><tr><th>Date</th><th>Source</th><th>Details</th><th class="n">Credit</th><th class="n">Debit</th><th class="n">Balance</th></tr></thead><tbody>${rows}</tbody></table>
      ${w.expiring.length ? `<p>Expiring: ${w.expiring.map((x) => `${esc(rs(x.remaining))} on ${esc(day(x.expires_on))}`).join('; ')}</p>` : ''}`,
  });
}

export default function WalletPanel({ customerId, onChanged }) {
  const w = useLoad(`/commerce/customers/${customerId}/wallet`);
  const act = useAction();
  const [f, setF] = useState({ direction: 'credit', amount: '', reason: '' });
  const d = w.data;
  const save = () => act.run(async () => {
    const r = await api.send('POST', `/commerce/customers/${customerId}/wallet`, f);
    setF({ direction: 'credit', amount: '', reason: '' });
    w.reload(); if (onChanged) onChanged();
    act.setMsg({ kind: r.posted ? 'ok' : 'info', text: r.posted ? `Wallet ${f.direction === 'credit' ? 'credited' : 'debited'} ${rs(f.amount)}.` : `Sent for approval (request #${r.approval_id}): the wallet changes when someone else approves it.` });
  });
  return (
    <Loading state={w}>
      {d && (
        <div className="a-wallet">
          {act.note}
          <div className="a-row">
            <h3>Wallet: {rs(d.balance)}</h3>
            <span className="a-muted">usable now {rs(d.usable)}</span>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { if (!printStatement(d)) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print.' }); }}>Print statement</button>
          </div>
          {d.expiring.length > 0 && <Notice kind="warn">Expiring: {d.expiring.map((x) => `${rs(x.remaining)} ${d.sources[x.source].toLowerCase()} on ${day(x.expires_on)}`).join('; ')}</Notice>}
          {d.pending.map((p) => <Notice key={p.approval_id} kind="info">Waiting for approval (request #{p.approval_id}): {p.summary}</Notice>)}
          {d.entries.length ? (
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>Date</th><th>Source</th><th>Details</th><th className="a-num">Amount</th><th className="a-num">Balance</th></tr></thead>
                <tbody>{[...d.entries].reverse().map((e) => (
                  <tr key={e.entry_id}><td>{fmtDate(e.created_at)}</td><td>{e.source_label}</td>
                    <td>{e.reason}{e.expires_on && <small className="a-muted a-person-sub">expires {day(e.expires_on)}{e.remaining !== null && e.remaining < e.amount ? `, ${rs(e.remaining)} left` : ''}</small>}</td>
                    <td className={`a-num ${e.amount < 0 ? 'a-bad' : 'a-ok'}`}>{e.amount > 0 ? '+' : ''}{rs(e.amount)}</td><td className="a-num">{rs(e.balance)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="a-muted">No wallet movements yet.</p>}
          {d.canManual && (
            <div className="a-card">
              <h4>Manual credit or debit{d.approval ? ' (needs approval by someone else)' : ''}</h4>
              <div className="a-grid2">
                <label className="a-field"><span>What</span><select value={f.direction} aria-label="Credit or debit" onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="credit">Credit (add)</option><option value="debit">Debit (take)</option></select></label>
                <label className="a-field"><span>Amount (Rs)</span><input inputMode="decimal" value={f.amount} aria-label="Wallet amount" onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
              </div>
              <label className="a-field"><span>Why (on the statement)</span><input value={f.reason} maxLength={160} aria-label="Wallet reason" onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
              {f.direction === 'credit' && d.expiryManual > 0 && <p className="a-muted">A manual credit expires after {d.expiryManual} days (Commerce settings &gt; Promotions).</p>}
              <button type="button" className="a-btn" disabled={act.busy || !f.amount || !f.reason.trim()} onClick={save}>{d.approval ? 'Ask for approval' : 'Save'}</button>
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}
