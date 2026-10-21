// Commerce > Reports (section "reports"; API /commerce/reports/returns). Phase 6: returns for a period (India dates,
// this month by default): by reason (returns and packs) and by SKU (packs returned, what inspection found, refunded or
// replaced) with the return rate = packs returned / packs delivered in the same period (rejected returns not counted).
import { useState } from 'react';
import { InfoCard, Loading, useLoad } from './ui';

const ist = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export default function CommerceReports() {
  const [f, setF] = useState(() => ({ from: `${ist().slice(0, 8)}01`, to: ist() }));
  const rep = useLoad(`/commerce/reports/returns?from=${f.from}&to=${f.to}`);
  const d = rep.data;
  const total = d ? d.byReason.reduce((a, r) => a + r.packs, 0) : 0;
  return (
    <section>
      <h1>Reports</h1>
      <InfoCard title="Returns">
        <ul>
          <li>Returns entered in the period, by reason and by SKU. Rejected returns (outside the window, not approved) are left out.</li>
          <li>Return rate = packs returned / packs delivered in the same period, per SKU.</li>
        </ul>
      </InfoCard>
      <div className="a-filters">
        <label>From <input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} /></label>
        <label>To <input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} /></label>
      </div>
      <Loading state={rep}>
        {d && (
          <>
            <h2>Returns by reason</h2>
            {d.byReason.length ? (
              <div className="a-scroll">
                <table className="a-table">
                  <thead><tr><th>Reason</th><th className="a-num">Returns</th><th className="a-num">Packs</th><th className="a-num">Share of packs</th></tr></thead>
                  <tbody>{d.byReason.map((r) => (
                    <tr key={r.reason}><td>{r.reason}</td><td className="a-num">{r.returns}</td><td className="a-num">{r.packs}</td><td className="a-num">{total ? `${Math.round((r.packs / total) * 1000) / 10}%` : ''}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="a-muted">No return in this period.</p>}
            <h2>Returns by SKU</h2>
            {d.bySku.length ? (
              <div className="a-scroll">
                <table className="a-table">
                  <thead><tr><th>SKU</th><th>Product</th><th className="a-num">Returns</th><th className="a-num">Packs</th><th className="a-num">OK (R)</th><th className="a-num">Damaged</th>
                    <th className="a-num">Expired</th><th className="a-num">Not recd.</th><th className="a-num">Refunded</th><th className="a-num">Replaced</th><th className="a-num">Delivered</th><th className="a-num">Return rate</th></tr></thead>
                  <tbody>{d.bySku.map((r) => (
                    <tr key={r.sku_code}><td><code>{r.sku_code}</code></td><td>{r.name} <small className="a-muted">{r.size_label}</small></td><td className="a-num">{r.returns}</td><td className="a-num"><b>{r.packs}</b></td>
                      <td className="a-num">{r.ok || ''}</td><td className="a-num">{r.damaged || ''}</td><td className="a-num">{r.expired || ''}</td><td className="a-num">{r.missing || ''}</td>
                      <td className="a-num">{r.refunded || ''}</td><td className="a-num">{r.replaced || ''}</td><td className="a-num">{r.delivered}</td>
                      <td className="a-num">{r.rate === null ? <span className="a-muted" title="Nothing of this SKU delivered in the period">-</span> : <b>{r.rate}%</b>}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="a-muted">No return in this period.</p>}
          </>
        )}
      </Loading>
    </section>
  );
}
