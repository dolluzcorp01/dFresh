// dFresh Commerce (DEMO, database dfresh_commerce): operations dashboard. Each card opens the matching screen:
// today's orders, to pack (New), to dispatch (Packed), low stock, returns to collect / inspect / decide,
// the wallet balance owed to customers. Plus the next orders to pack and the SKUs to reorder. A card or table is
// only there when the role can view its section (the API sends null for the others). The Business view (sales,
// margin, owed, stock value, top SKUs and customers) only for a role with Reports and Products and prices.
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

/** the Business view (a role with Reports and Products and prices): sales, margin, what is owed, stock value, the tops */
function Business({ b }) {
  return (
    <div className="a-card a-business">
      <h2>Business</h2>
      <div className="a-stats">
        <Card to="/admin/commerce/reports" value={rs(b.today)} label="sales today" sub="invoices - credit notes" />
        <Card to="/admin/commerce/reports" value={rs(b.month)} label="sales this month" sub={`since ${b.monthFrom}`} />
        <Card to="/admin/commerce/reports" value={rs(b.margin)} label="margin this month" sub={b.marginPct === null ? null : `${b.marginPct}% of the goods value`} />
        <Card to="/admin/commerce/reports" value={rs(b.outstanding)} label="owed by customers" />
        <Card to="/admin/commerce/reports" value={rs(b.stockValue)} label="stock value" sub="good stock at average cost" />
        <Card to="/admin/commerce/reports" value={rs(b.wallet)} label="wallets owed to customers" />
      </div>
      <div className="a-grid2">
        <div><h3>Top SKUs this month</h3><table className="a-table"><tbody>{b.topSkus.map((x) => <tr key={x.name}><td>{x.name}</td><td className="a-num">{rs(x.total)}</td></tr>)}</tbody></table></div>
        <div><h3>Top customers this month</h3><table className="a-table"><tbody>{b.topCustomers.map((x) => <tr key={x.name}><td>{x.name}</td><td className="a-num">{rs(x.total)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
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
              {/* in the order of the admin menu: stock, sales, fulfilment, returns, money owed to customers */}
              {d.lowStock && <Card to="/admin/commerce/stock?tab=reorder" value={d.lowStock.length} label="below reorder level" bad={d.lowStock.length > 0} />}
              {d.followUps && <Card to="/admin/commerce/follow-ups" value={d.followUps.overdue} label="follow-ups overdue" sub={`${d.followUps.mine} of them yours`} bad={d.followUps.overdue > 0} />}
              {d.today && <Card to="/admin/commerce/orders" value={d.today.n} label="orders today" sub={rs(d.today.value)} />}
              {d.packing && <Card to="/admin/commerce/packing" value={d.packing.toPick} label="to pick" bad={d.packing.toPick > 0} />}
              {d.packing && <Card to="/admin/commerce/packing" value={d.packing.toPack} label="to pack (packing)" bad={d.packing.toPack > 0} />}
              {d.delivery && <Card to="/admin/commerce/delivery" value={d.delivery.waitingTrip} label="packed, waiting for a trip" sub={d.delivery.waitingOther ? `+ ${d.delivery.waitingOther} for courier / pickup` : null} />}
              {d.delivery && <Card to="/admin/commerce/orders?status=out_for_delivery" value={d.delivery.outNow} label="out for delivery" sub={d.delivery.withCourier ? `+ ${d.delivery.withCourier} with couriers` : null} />}
              {d.delivery && <Card to="/admin/commerce/delivery" value={d.delivery.failed} label="failed deliveries" bad={d.delivery.failed > 0} />}
              {d.delivery && <Card to="/admin/commerce/delivery" value={rs(d.delivery.codDue)} label="COD cash to collect" sub={d.delivery.cashOnTrips ? `${rs(d.delivery.cashOnTrips)} collected on trips out now` : null} />}
              {d.returns && d.returns.toCollect !== null && <Card to="/admin/commerce/returns?status=collecting" value={d.returns.toCollect} label="returns to collect" sub="customer, trip pickup or courier" />}
              {d.returns && <Card to="/admin/commerce/returns?status=received" value={d.returns.toInspect} label="returns to inspect" sub="at the godown or picked up" bad={d.returns.toInspect > 0} />}
              {d.returns && d.returns.toDecide !== null && <Card to="/admin/commerce/returns?status=inspected" value={d.returns.toDecide} label="returns to decide" sub="refund, replace or no refund" />}
              {d.walletGiven && <Card to="/admin/commerce/customers" value={rs(d.walletGiven.total)} label="wallet balance owed to customers" sub={`from cashback ${rs(d.walletGiven.cashback)}, refunds ${rs(d.walletGiven.refunds)}`} />}
            </div>
            <div className="a-grid2">
              {d.lowStock && (
              <div className="a-card">
                <h2>Reorder (low stock)</h2>
                {d.lowStock.length ? (
                  <table className="a-table"><thead><tr><th>SKU</th><th>Product</th><th className="a-num">Available</th><th className="a-num">Level</th><th className="a-num">Suggested</th></tr></thead>
                    <tbody>{d.lowStock.map((s) => <tr key={s.sku_code}><td><code>{s.sku_code}</code></td><td>{s.name}</td><td className="a-num a-bad">{s.available}</td><td className="a-num">{s.reorder_level}</td><td className="a-num">{s.suggested}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">All SKUs above their level.</p>}
              </div>
              )}
              {d.nextToPack && (
              <div className="a-card">
                <h2>Next to pack</h2>
                {d.nextToPack.length ? (
                  <table className="a-table"><thead><tr><th>Order</th><th>Customer</th><th>Received</th></tr></thead>
                    <tbody>{d.nextToPack.map((o) => <tr key={o.order_no}><td><code>{o.order_no}</code></td><td>{o.customer}</td><td>{fmtDate(o.created_at)}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">Nothing to pack.</p>}
              </div>
              )}
            </div>
            {d.business && <Business b={d.business} />}{/* the review last, as Reports in the menu */}
          </>
        )}
      </Loading>
    </section>
  );
}
