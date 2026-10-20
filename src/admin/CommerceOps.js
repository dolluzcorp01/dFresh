// dFresh Commerce (DEMO, database dfresh_commerce): operations dashboard. Each card opens the matching screen:
// today's orders, to pack (New), to dispatch (Packed), low stock, open returns (replacement not delivered yet),
// wallet credit given (cashback + refunds). Plus the next orders to pack and the SKUs to reorder. A card or table is
// only there when the role can view its section (the API sends null for the others).
import { Link } from 'react-router-dom';
import { InfoCard, Loading, Notice, fmtDate, useLoad } from './ui';
import { rs } from './CommerceReturns';

function Card({ to, value, label, sub, bad }) {
  return (
    <Link to={to} className={`a-stat a-statlink${bad ? ' a-stat-bad' : ''}`}>
      <b>{value}</b><span>{label}</span>{sub ? <small>{sub}</small> : null}
    </Link>
  );
}

export default function CommerceOps() {
  const ops = useLoad('/commerce/ops');
  const d = ops.data;
  return (
    <section>
      <h1>Operations</h1>
      <InfoCard title="Commerce demo - today at a glance">
        <ul>
          <li>Click a card to open the list behind it.</li>
          <li>To pick = New orders; to pack = Packing; then trips, couriers and pickups (the goods leave the godown with the invoice).</li>
        </ul>
      </InfoCard>
      <Loading state={ops}>
        {d && (
          <>
            {d.lowStock && d.lowStock.length > 0 && (
              <Notice kind="warn">{d.lowStock.length} SKU{d.lowStock.length === 1 ? ' is' : 's are'} below the reorder level: <Link to="/admin/commerce/stock?tab=reorder">open the Reorder list</Link>.</Notice>
            )}
            {d.expiry && d.expiry.expired + d.expiry.near > 0 && (
              <Notice kind={d.expiry.expired ? 'error' : 'warn'}>{d.expiry.expired ? `${d.expiry.expired} expired batch${d.expiry.expired === 1 ? '' : 'es'} in stock (blocked from orders: write them off)` : ''}{d.expiry.expired && d.expiry.near ? '; ' : ''}{d.expiry.near ? `${d.expiry.near} batch${d.expiry.near === 1 ? '' : 'es'} near expiry` : ''}: <Link to="/admin/commerce/stock?tab=batches">Batches</Link>.</Notice>
            )}
            <div className="a-stats">
              {d.today && <Card to="/admin/commerce/orders" value={d.today.n} label="orders today" sub={rs(d.today.value)} />}
              {d.packing && <Card to="/admin/commerce/packing" value={d.packing.toPick} label="to pick" bad={d.packing.toPick > 0} />}
              {d.packing && <Card to="/admin/commerce/packing" value={d.packing.toPack} label="to pack (packing)" bad={d.packing.toPack > 0} />}
              {d.delivery && <Card to="/admin/commerce/delivery" value={d.delivery.waitingTrip} label="packed, waiting for a trip" sub={d.delivery.waitingOther ? `+ ${d.delivery.waitingOther} for courier / pickup` : null} />}
              {d.delivery && <Card to="/admin/commerce/orders?status=out_for_delivery" value={d.delivery.outNow} label="out for delivery" sub={d.delivery.withCourier ? `+ ${d.delivery.withCourier} with couriers` : null} />}
              {d.delivery && <Card to="/admin/commerce/delivery" value={d.delivery.failed} label="failed deliveries" bad={d.delivery.failed > 0} />}
              {d.delivery && <Card to="/admin/commerce/delivery" value={rs(d.delivery.codDue)} label="COD cash to collect" sub={d.delivery.cashOnTrips ? `${rs(d.delivery.cashOnTrips)} collected on trips out now` : null} />}
              {d.lowStock && <Card to="/admin/commerce/stock?tab=reorder" value={d.lowStock.length} label="below reorder level" bad={d.lowStock.length > 0} />}
              {d.openReturns !== null && <Card to="/admin/commerce/returns" value={d.openReturns} label="open returns" sub="replacement not delivered" />}
              {d.walletGiven && <Card to="/admin/commerce/customers" value={rs(d.walletGiven.total)} label="wallet credit given" sub={`cashback ${rs(d.walletGiven.cashback)}, refunds ${rs(d.walletGiven.refunds)}`} />}
            </div>
            <div className="a-grid2">
              {d.nextToPack && (
              <div className="a-card">
                <h2>Next to pack</h2>
                {d.nextToPack.length ? (
                  <table className="a-table"><thead><tr><th>Order</th><th>Customer</th><th>Received</th></tr></thead>
                    <tbody>{d.nextToPack.map((o) => <tr key={o.order_no}><td><code>{o.order_no}</code></td><td>{o.customer}</td><td>{fmtDate(o.created_at)}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">Nothing to pack.</p>}
              </div>
              )}
              {d.lowStock && (
              <div className="a-card">
                <h2>Reorder (low stock)</h2>
                {d.lowStock.length ? (
                  <table className="a-table"><thead><tr><th>SKU</th><th>Product</th><th className="a-num">Available</th><th className="a-num">Level</th><th className="a-num">Suggested</th></tr></thead>
                    <tbody>{d.lowStock.map((s) => <tr key={s.sku_code}><td><code>{s.sku_code}</code></td><td>{s.name}</td><td className="a-num a-bad">{s.available}</td><td className="a-num">{s.reorder_level}</td><td className="a-num">{s.suggested}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">All SKUs above their level.</p>}
              </div>
              )}
            </div>
          </>
        )}
      </Loading>
    </section>
  );
}
