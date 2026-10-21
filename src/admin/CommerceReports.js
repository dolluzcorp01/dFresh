// Commerce > Reports (section "reports"). For a period (India dates, this month by default):
// - Returns (API /commerce/reports/returns, phase 6): by reason (returns and packs) and by SKU (packs returned, what
//   inspection found, refunded or replaced) with the return rate = packs returned / packs delivered in the same period
//   (rejected returns not counted).
// - Promotions and wallet (API /commerce/reports/promotions, phase 7): coupon and offer usage, discounts given by month,
//   cashback credited / used / expired / reversed, and the wallet balance owed to customers now (total liability).
import { useState } from 'react';
import { InfoCard, Loading, useLoad } from './ui';
import { rs } from './printKit';

const ist = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export default function CommerceReports() {
  const [f, setF] = useState(() => ({ from: `${ist().slice(0, 8)}01`, to: ist() }));
  const [tab, setTab] = useState('returns');
  return (
    <section>
      <h1>Reports</h1>
      <div className="a-chips a-tabs" role="tablist" aria-label="Reports">
        {[['returns', 'Returns'], ['promotions', 'Promotions and wallet']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="a-filters">
        <label>From <input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} /></label>
        <label>To <input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} /></label>
      </div>
      {tab === 'returns' ? <ReturnsReport f={f} /> : <PromotionsReport f={f} />}
    </section>
  );
}

function ReturnsReport({ f }) {
  const rep = useLoad(`/commerce/reports/returns?from=${f.from}&to=${f.to}`);
  const d = rep.data;
  const total = d ? d.byReason.reduce((a, r) => a + r.packs, 0) : 0;
  return (
    <>
      <InfoCard title="Returns">
        <ul>
          <li>Returns entered in the period, by reason and by SKU. Rejected returns (outside the window, not approved) are left out.</li>
          <li>Return rate = packs returned / packs delivered in the same period, per SKU.</li>
        </ul>
      </InfoCard>
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
    </>
  );
}

function PromotionsReport({ f }) {
  const rep = useLoad(`/commerce/reports/promotions?from=${f.from}&to=${f.to}`);
  const d = rep.data;
  const tot = (k) => (d ? d.discounts.reduce((a, m) => a + m[k], 0) : 0);
  return (
    <>
      <InfoCard title="Promotions and the wallet">
        <ul>
          <li>Coupons and offers used on orders entered in the period (cancelled orders and given-back coupons left out); discounts by month.</li>
          <li>Cashback credited, used on orders, expired and taken back in the period; the wallet balance owed to customers is as of now.</li>
        </ul>
      </InfoCard>
      <Loading state={rep}>
        {d && (
          <>
            <div className="a-stats">
              <div className="a-stat"><b>{rs(d.liability.total)}</b><span>wallet balance owed to {d.liability.customers} customer(s)</span></div>
              <div className="a-stat"><b>{rs(d.cashback.credited)}</b><span>cashback credited ({d.cashback.credits})</span></div>
              <div className="a-stat"><b>{rs(d.cashback.used)}</b><span>cashback used on orders</span></div>
              <div className="a-stat"><b>{rs(d.cashback.expired)}</b><span>cashback expired</span></div>
              <div className="a-stat"><b>{rs(d.cashback.reversed)}</b><span>cashback taken back (returns)</span></div>
            </div>
            <h2>Discounts given</h2>
            {d.discounts.length ? (
              <div className="a-scroll">
                <table className="a-table">
                  <thead><tr><th>Month</th><th className="a-num">Orders</th><th className="a-num">Goods</th><th className="a-num">Offers</th><th className="a-num">Coupons</th><th className="a-num">Manual</th><th className="a-num">Delivery waived</th><th className="a-num">Wallet as discount</th><th className="a-num">All</th></tr></thead>
                  <tbody>{d.discounts.map((m) => (
                    <tr key={m.month}><td>{m.month}</td><td className="a-num">{m.orders}</td><td className="a-num">{rs(m.goods)}</td><td className="a-num">{rs(m.offers)}</td><td className="a-num">{rs(m.coupons)}</td><td className="a-num">{rs(m.manual)}</td>
                      <td className="a-num">{rs(m.delivery)}</td><td className="a-num">{rs(m.wallet)}</td><td className="a-num"><b>{rs(m.offers + m.coupons + m.manual + m.delivery + m.wallet)}</b></td></tr>
                  ))}
                  {d.discounts.length > 1 && <tr><td><b>Total</b></td><td className="a-num">{tot('orders')}</td><td className="a-num">{rs(tot('goods'))}</td><td className="a-num">{rs(tot('offers'))}</td><td className="a-num">{rs(tot('coupons'))}</td><td className="a-num">{rs(tot('manual'))}</td><td className="a-num">{rs(tot('delivery'))}</td><td className="a-num">{rs(tot('wallet'))}</td><td /></tr>}</tbody>
                </table>
              </div>
            ) : <p className="a-muted">No order in this period.</p>}
            <h2>Coupons used</h2>
            {d.coupons.length ? (
              <div className="a-scroll"><table className="a-table"><thead><tr><th>Coupon</th><th>Type</th><th className="a-num">Orders</th><th className="a-num">Customers</th><th className="a-num">Discount</th></tr></thead>
                <tbody>{d.coupons.map((c) => <tr key={c.code}><td><code>{c.code}</code></td><td>{c.kind_label}</td><td className="a-num">{c.orders}</td><td className="a-num">{c.customers}</td><td className="a-num">{rs(c.amount)}</td></tr>)}</tbody></table></div>
            ) : <p className="a-muted">No coupon used in this period.</p>}
            <h2>Offers used</h2>
            {d.offers.length ? (
              <div className="a-scroll"><table className="a-table"><thead><tr><th>Offer</th><th>Type</th><th className="a-num">Orders</th><th className="a-num">Discount</th><th className="a-num">Free packs</th><th className="a-num">Free packs at list price</th></tr></thead>
                <tbody>{d.offers.map((o) => <tr key={o.offer_id}><td>{o.name}</td><td>{o.kind_label}</td><td className="a-num">{o.orders}</td><td className="a-num">{rs(o.discount)}</td><td className="a-num">{o.free_packs || ''}</td><td className="a-num">{o.free_value ? rs(o.free_value) : ''}</td></tr>)}</tbody></table></div>
            ) : <p className="a-muted">No offer used in this period.</p>}
            <h2>Wallet balance owed to customers (now)</h2>
            <p className="a-muted">Still to use, by source: {d.liability.bySource.map((x) => `${x.label} ${rs(x.amount)}${x.soon ? ` (${rs(x.soon)} expires within 30 days)` : ''}`).join('; ') || 'nothing'}.</p>
            {d.liability.top.length > 0 && (
              <table className="a-table"><thead><tr><th>Customer</th><th>Type</th><th className="a-num">Balance</th></tr></thead>
                <tbody>{d.liability.top.map((c) => <tr key={c.customer_id}><td>{c.name}</td><td>{c.ctype}</td><td className="a-num">{rs(c.balance)}</td></tr>)}</tbody></table>
            )}
          </>
        )}
      </Loading>
    </>
  );
}
