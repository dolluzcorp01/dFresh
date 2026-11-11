// Marketing helpers shared by the phase 22 pages (Marketing.js): the chip picker, the coupon text and the coupon usage
// drawer. The old address /admin/commerce/promotions?tab=... (one page with four tabs before phase 22) now opens the page
// of its tab: Offers, Coupons, Cashback rules or Customer wallets.
import { Navigate, useLocation } from 'react-router-dom';
import { Drawer, Loading, fmtDate, useLoad } from './ui';
import { rs } from './printKit';

const TO = { offers: 'offers', coupons: 'coupons', cashback: 'cashback-rules', wallets: 'customer-wallets' };
export default function CommercePromotions() {
  const t = new URLSearchParams(useLocation().search).get('tab');
  return <Navigate to={`/admin/${TO[t] || 'coupons'}`} replace />;
}

/** chips picked from a list (customer types, customers, SKUs / categories) */
export function Picker({ label, options, values, onChange }) {
  const left = options.filter((o) => !values.includes(o.value));
  return (
    <div className="a-field">
      <span>{label}</span>
      <div className="a-chips">
        {values.map((v) => <span key={v} className="a-chip on">{(options.find((o) => o.value === v) || { label: v }).label} <button type="button" className="a-x" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>)}
        {left.length > 0 && <select value="" aria-label={label} onChange={(e) => e.target.value && onChange([...values, e.target.value])}><option value="">+ add</option>{left.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
      </div>
    </div>
  );
}

export function couponText(c) {
  const v = c.kind === 'percent' ? `${c.value}% off${c.max_discount !== null ? `, at most ${rs(c.max_discount)}` : ''}` : c.kind === 'fixed' ? `${rs(c.value)} off` : 'Free delivery';
  return `${v}${c.min_order > 0 ? `, from ${rs(c.min_order)}` : ''}`;
}
export function UsageDrawer({ code, onClose }) {
  const u = useLoad(`/commerce/coupons/${code}/usage`);
  return (
    <Drawer title={`Coupon ${code}: usage`} onClose={onClose}>
      <Loading state={u}>
        {u.data && (u.data.length ? (
          <table className="a-table"><thead><tr><th>Order</th><th>Customer</th><th className="a-num">Discount</th><th>When</th></tr></thead>
            <tbody>{u.data.map((r) => (
              <tr key={r.id} className={r.status === 'active' ? undefined : 'a-offrow'}><td><code>{r.order_no}</code><small className="a-muted a-person-sub">{r.order_status.replace(/_/g, ' ')}{r.status === 'released' ? ' - given back' : ''}</small></td>
                <td>{r.customer}<small className="a-muted a-person-sub">{r.ctype}</small></td><td className="a-num">{rs(r.amount)}</td><td>{fmtDate(r.created_at)}</td></tr>
            ))}</tbody></table>
        ) : <p className="a-muted">Not used yet.</p>)}
      </Loading>
    </Drawer>
  );
}
