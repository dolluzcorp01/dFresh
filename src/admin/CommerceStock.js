// dFresh Commerce (DEMO, database dfresh_commerce): inventory at one location, the Kanchipuram godown.
// Stock per SKU = the sum of its movements (database/demo/commerce-demo-schema.sql): Good, Returned (R) shown as its own line
// "DF037-M150 (R)", and Damaged. Below its low level a SKU gets a red "Low" badge. Record a movement (in, out,
// adjust, return, damaged; the SKU box takes a scanner) - who and when are kept for every one.
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, fmtDate, useAction, useCan, useLoad } from './ui';

const TYPES = [
  ['in', 'In (received)'], ['out', 'Out (dispatched)'], ['adjust', 'Adjust (count, + / -)'],
  ['return', 'Return (to Returned stock)'], ['damaged', 'Damaged (good -> damaged)'],
];
const KIND = { good: 'Good', returned: 'Returned (R)', damaged: 'Damaged' };

export default function CommerceStock() {
  const stock = useLoad('/commerce/stock');
  const moves = useLoad('/commerce/movements');
  const canEdit = useCan('inventory', 'edit');
  const canRecord = useCan('inventory', 'create');
  const act = useAction();
  const [q, setQ] = useState('');
  const location = useLocation();
  const [lowOnly, setLowOnly] = useState(() => new URLSearchParams(location.search).get('low') === '1');
  const [form, setForm] = useState({ sku_code: '', move_type: 'in', qty: '', note: '' });
  const [levels, setLevels] = useState({}); // sku -> typed low level (pending)
  const rows = useMemo(() => stock.data || [], [stock.data]);
  const isLow = (r) => r.good < r.low_level;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!lowOnly || isLow(r)) && (!s || [r.sku_code, r.name, r.size_label].some((v) => String(v).toLowerCase().includes(s))));
  }, [rows, q, lowOnly]);
  const totals = useMemo(() => ({
    good: rows.reduce((a, r) => a + r.good, 0), returned: rows.reduce((a, r) => a + r.returned, 0),
    damaged: rows.reduce((a, r) => a + r.damaged, 0), low: rows.filter(isLow).length,
  }), [rows]);

  const reload = () => { stock.reload(); moves.reload(); };
  const record = (e) => {
    e.preventDefault();
    const qty = Number(form.qty);
    act.run(async () => {
      const r = await api.send('POST', '/commerce/movements', { ...form, sku_code: form.sku_code.trim().toUpperCase(), qty });
      setForm({ ...form, qty: '', note: '' });
      reload();
      act.setMsg({ kind: 'ok', text: `${form.move_type} ${qty} x ${r.sku_code} recorded. Good stock now ${r.good}.` });
    });
  };
  const saveLevel = (sku) => act.run(async () => {
    await api.send('PUT', `/commerce/stock/${encodeURIComponent(sku)}/low`, { low_level: Number(levels[sku]) });
    setLevels((l) => { const n = { ...l }; delete n[sku]; return n; });
    stock.reload();
  }, `Low level for ${sku} saved`);

  return (
    <section>
      <h1>Inventory</h1>
      <InfoCard title="Commerce demo - stock at the Kanchipuram godown">
        <ul>
          <li>Stock is the sum of movements, never typed in: every change shows who did it and when (below).</li>
          <li>Returned goods in good condition are kept apart as <code>SKU (R)</code>; damaged goods are counted separately.</li>
          <li>A red <span className="a-status a-status-bad">Low</span> badge: good stock is below the SKU&apos;s low level.</li>
          <li>Reserved = held by confirmed orders not yet dispatched; Available = good - reserved (what a new order can take).</li>
        </ul>
      </InfoCard>
      <div className="a-stats">
        <div className="a-stat"><b>{rows.length}</b><span>SKUs</span></div>
        <div className="a-stat"><b>{totals.good}</b><span>units good</span></div>
        <div className={`a-stat${totals.low ? ' a-stat-bad' : ''}`}><b>{totals.low}</b><span>low stock</span></div>
        <div className="a-stat"><b>{totals.returned}</b><span>returned (R)</span></div>
        <div className="a-stat"><b>{totals.damaged}</b><span>damaged</span></div>
      </div>
      {act.note}
      {canRecord && (
        <form className="a-card a-moveform" onSubmit={record}>
          <h2>Record a movement</h2>
          <div className="a-toolbar">
            <label className="a-inline">SKU
              <input list="stock-skus" required value={form.sku_code} placeholder="Scan or type" autoComplete="off"
                onChange={(e) => setForm({ ...form, sku_code: e.target.value })} />
            </label>
            <datalist id="stock-skus">{rows.map((r) => <option key={r.sku_code} value={r.sku_code}>{r.name}</option>)}</datalist>
            <label className="a-inline">Type
              <select value={form.move_type} onChange={(e) => setForm({ ...form, move_type: e.target.value })}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="a-inline">Qty
              <input type="number" required step="1" value={form.qty} className="a-qty" onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </label>
            <label className="a-inline a-grow">Note
              <input value={form.note} maxLength={255} placeholder="e.g. invoice, customer, reason" onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <button type="submit" className="a-btn" disabled={act.busy}>Record</button>
          </div>
        </form>
      )}
      <Loading state={stock}>
        <div className="a-toolbar">
          <input type="search" placeholder="Search SKU or product" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="a-inline"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
          <span className="a-muted">{shown.length} of {rows.length}</span>
        </div>
        <div className="a-scroll">
          <table className="a-table a-stock">
            <thead><tr><th>SKU</th><th>Product</th><th className="a-num">Good</th><th className="a-num" title="Held by confirmed orders">Reserved</th><th className="a-num" title="Good - reserved">Available</th><th className="a-num">Damaged</th><th>Low level</th><th>Last movement</th></tr></thead>
            <tbody>
              {shown.flatMap((r) => [
                <tr key={r.sku_code} className={isLow(r) ? 'a-lowrow' : undefined}>
                  <td><code>{r.sku_code}</code></td>
                  <td>{r.name} <small className="a-muted">{r.size_label}</small></td>
                  <td className="a-num"><b>{r.good}</b> {isLow(r) && <span className="a-status a-status-bad">Low</span>}</td>
                  <td className="a-num">{r.reserved || ''}</td>
                  <td className={`a-num${r.available < 0 ? ' a-bad' : ''}`}>{r.available}</td>
                  <td className="a-num">{r.damaged || ''}</td>
                  <td>
                    {canEdit ? (
                      <span className="a-row">
                        <input type="number" min="0" step="1" className="a-qty" aria-label={`Low level ${r.sku_code}`}
                          value={r.sku_code in levels ? levels[r.sku_code] : r.low_level} onChange={(e) => setLevels({ ...levels, [r.sku_code]: e.target.value })} />
                        {r.sku_code in levels && String(levels[r.sku_code]) !== String(r.low_level) && (
                          <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => saveLevel(r.sku_code)}>Save</button>
                        )}
                      </span>
                    ) : r.low_level}
                  </td>
                  <td>{fmtDate(r.last_move)}</td>
                </tr>,
                r.returned > 0 && (
                  <tr key={`${r.sku_code}-R`} className="a-rrow">
                    <td><code>{r.sku_code} (R)</code></td>
                    <td className="a-muted">Returned stock, good condition</td>
                    <td className="a-num"><b>{r.returned}</b></td>
                    <td colSpan={5} />
                  </tr>
                ),
              ].filter(Boolean))}
            </tbody>
          </table>
        </div>
      </Loading>
      <h2>Movements</h2>
      <Loading state={moves}>
        <div className="a-scroll">
          <table className="a-table a-moves">
            <thead><tr><th>When</th><th>SKU</th><th>Type</th><th className="a-num">Change</th><th>Stock</th><th>Note</th><th>Who</th></tr></thead>
            <tbody>
              {(moves.data || []).map((m) => (
                <tr key={m.move_id}>
                  <td>{fmtDate(m.created_at)}</td>
                  <td><code>{m.sku_code}{m.stock_kind === 'returned' ? ' (R)' : ''}</code></td>
                  <td>{m.move_type}</td>
                  <td className={`a-num ${m.delta < 0 ? 'a-bad' : ''}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                  <td>{KIND[m.stock_kind]}</td>
                  <td>{m.note}</td>
                  <td>{m.emp_name || m.emp_id} <small className="a-muted">{m.emp_id}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
    </section>
  );
}
