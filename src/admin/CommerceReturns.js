// dFresh Commerce (DEMO, database dfresh_commerce): returns. The list here; a return is made in a delivered
// order's drawer (Orders > open > Return items: ReturnForm below). OK packs go to Returned (R) stock, damaged packs
// to Damaged; outcome refund to wallet, refund (demo) or a replacement order at Rs 0. Logic: commerce.js createReturn.
import { useState } from 'react';
import { api } from './adminApi';
import { InfoCard, Loading, fmtDate, useAction, useConfirm, useLoad } from './ui';

export const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OUTCOMES = [['wallet', 'Refund to wallet'], ['refund', 'Refund to payment (demo)'], ['replacement', 'Replacement (new order at Rs 0)']];

export default function CommerceReturns() {
  const list = useLoad('/commerce/returns');
  return (
    <section>
      <h1>Returns</h1>
      <InfoCard title="Commerce demo - returns and refunds">
        <ul>
          <li>A return is made on a delivered order: Orders, open the order, Return items.</li>
          <li>Each pack is checked: OK goes to the Returned (R) stock, Damaged to Damaged (both in Inventory).</li>
          <li>Outcome: refund to the customer&apos;s wallet, refund to the payment (demo, no money moves) or a replacement order.</li>
        </ul>
      </InfoCard>
      <Loading state={list}>
        <ReturnsTable rows={list.data || []} />
      </Loading>
    </section>
  );
}

export function ReturnsTable({ rows, compact = false }) {
  if (!rows.length) return <p className="a-muted">No returns.</p>;
  return (
    <div className="a-scroll">
      <table className="a-table">
        <thead><tr><th>Return</th>{!compact && <th>Order</th>}{!compact && <th>Customer</th>}<th>Packs</th><th>Reason</th><th>Outcome</th><th className="a-num">Value</th><th>When</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.return_no}>
              <td><code>{r.return_no}</code></td>
              {!compact && <td><code>{r.order_no}</code></td>}
              {!compact && <td>{r.customer}</td>}
              <td>{r.items}</td>
              <td>{r.reason}</td>
              <td>{r.outcome_label}{r.replacement_no ? <> <code>{r.replacement_no}</code></> : null}</td>
              <td className="a-num">{rs(r.amount)}</td>
              <td>{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** In a delivered order's drawer: pick packs, check each OK / Damaged, reason, outcome; asks before saving. */
export function ReturnForm({ order, onDone, onCancel }) {
  const act = useAction();
  const confirm = useConfirm();
  const [lines, setLines] = useState(() => order.items.map((i) => ({ sku_code: i.sku_code, max: i.qty, qty: 0, item_check: 'ok' })));
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState('wallet');
  const picked = lines.filter((l) => Number(l.qty) > 0);
  const set = (n, patch) => setLines((ls) => ls.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const save = async () => {
    const what = picked.map((l) => `${l.qty} x ${l.sku_code} ${l.item_check === 'ok' ? '(to Returned stock)' : '(damaged)'}`).join(', ');
    if (!(await confirm({ title: `Return on ${order.order_no}?`, message: `${what}. ${OUTCOMES.find((o) => o[0] === outcome)[1]}.`, action: 'Save return' }))) return;
    act.run(async () => {
      const r = await api.send('POST', `/commerce/orders/${order.order_no}/returns`, { items: picked.map(({ sku_code, qty, item_check }) => ({ sku_code, qty: Number(qty), item_check })), reason, outcome });
      onDone(r);
    });
  };
  return (
    <div className="a-card a-returnform">
      <h3>Return items</h3>
      {act.note}
      <table className="a-table">
        <thead><tr><th>SKU</th><th className="a-num">Ordered</th><th className="a-num">Return</th><th>Check</th></tr></thead>
        <tbody>
          {lines.map((l, n) => (
            <tr key={l.sku_code}>
              <td><code>{l.sku_code}</code></td>
              <td className="a-num">{l.max}</td>
              <td className="a-num"><input type="number" min="0" max={l.max} step="1" className="a-qty" value={l.qty} aria-label={`Return qty ${l.sku_code}`} onChange={(e) => set(n, { qty: e.target.value })} /></td>
              <td>
                <select value={l.item_check} aria-label={`Check ${l.sku_code}`} onChange={(e) => set(n, { item_check: e.target.value })}>
                  <option value="ok">OK - to Returned (R)</option><option value="damaged">Damaged</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a-grid2">
        <label className="a-field"><span>Reason</span><input value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, wet cartons" /></label>
        <label className="a-field"><span>Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{OUTCOMES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
      </div>
      <span className="a-row">
        <button type="button" className="a-btn" disabled={act.busy || !picked.length || !reason.trim()} onClick={save}>Save return</button>
        <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}
