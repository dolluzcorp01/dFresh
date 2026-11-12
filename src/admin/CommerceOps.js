// Home > Dashboard (phase 23, v23 viewDash: dashTiles + dashBiz; API /dashboard/home, Reports23.js DashboardTiles).
// The tiles (each opens its page), the top 5 products of the month, the newest alerts and the website at a glance.
// Before phase 23 this page also listed the day's work cards (API /commerce/ops, still served): those lists are now on
// their own pages (Packing, Delivery, Returns, Inventory > Reorder) and in Home > Alerts, as v23.
import { useNavigate } from 'react-router-dom';
import { LIcon, PageHead } from './ui';
import { DashboardTiles } from './Reports23';

export default function CommerceOps() {
  const navigate = useNavigate();
  return (
    <section>
      <PageHead title="Dashboard" sub="Today's sales, stock, money owed and alerts"
        actions={<button type="button" className="a-btn" onClick={() => navigate('/admin/products')}><LIcon name="package" size="sm" />Products</button>} />
      <DashboardTiles />
    </section>
  );
}
