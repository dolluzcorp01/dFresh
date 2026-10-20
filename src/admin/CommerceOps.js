// dFresh Commerce (DEMO, database dfresh_commerce): operations dashboard. Each card opens the matching screen:
// today's orders, to pack (New), to dispatch (Packed), low stock, open returns (replacement not delivered yet),
// wallet credit given (cashback + refunds). Plus the next orders to pack and the SKUs to reorder.
import { Link } from 'react-router-dom';
import { InfoCard, Loading, fmtDate, useLoad } from './ui';
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
          <li>To pack = New orders; to dispatch = Packed orders (dispatching takes the stock out).</li>
        </ul>
      </InfoCard>
      <Loading state={ops}>
        {d && (
          <>
            <div className="a-stats">
              <Card to="/admin/commerce/orders" value={d.today.n} label="orders today" sub={rs(d.today.value)} />
              <Card to="/admin/commerce/orders?status=new" value={d.toPack} label="to pack" bad={d.toPack > 0} />
              <Card to="/admin/commerce/orders?status=packed" value={d.toDispatch} label="to dispatch" bad={d.toDispatch > 0} />
              <Card to="/admin/commerce/stock?low=1" value={d.lowStock.length} label="low stock SKUs" bad={d.lowStock.length > 0} />
              <Card to="/admin/commerce/returns" value={d.openReturns} label="open returns" sub="replacement not delivered" />
              <Card to="/admin/commerce/customers" value={rs(d.walletGiven.total)} label="wallet credit given" sub={`cashback ${rs(d.walletGiven.cashback)}, refunds ${rs(d.walletGiven.refunds)}`} />
            </div>
            <div className="a-grid2">
              <div className="a-card">
                <h2>Next to pack</h2>
                {d.nextToPack.length ? (
                  <table className="a-table"><thead><tr><th>Order</th><th>Customer</th><th>Received</th></tr></thead>
                    <tbody>{d.nextToPack.map((o) => <tr key={o.order_no}><td><code>{o.order_no}</code></td><td>{o.customer}</td><td>{fmtDate(o.created_at)}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">Nothing to pack.</p>}
              </div>
              <div className="a-card">
                <h2>Reorder (low stock)</h2>
                {d.lowStock.length ? (
                  <table className="a-table"><thead><tr><th>SKU</th><th>Product</th><th className="a-num">Good</th><th className="a-num">Low level</th></tr></thead>
                    <tbody>{d.lowStock.map((s) => <tr key={s.sku_code}><td><code>{s.sku_code}</code></td><td>{s.name}</td><td className="a-num a-bad">{s.good}</td><td className="a-num">{s.low_level}</td></tr>)}</tbody></table>
                ) : <p className="a-muted">All SKUs above their level.</p>}
              </div>
            </div>
          </>
        )}
      </Loading>
    </section>
  );
}
