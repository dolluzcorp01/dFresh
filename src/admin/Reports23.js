// Reports (phase 23, v23 viewRepSales / viewRepStock / viewRepMoney / viewRepGst; API /reports23/:page, rules in
// src/backend_routes/reports23.js) and the Home > Dashboard tiles (v23 dashTiles / dashBiz; API /dashboard/home).
// A report page: rule chips, the period and godown filter with CSV (Export right) and Print, the figures of the page,
// tabs, a chart of the top values and the table that carries every number. Costs a role may not see read "hidden".
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, LIcon, Loading, PageHead, Pill, Stat, Tabs, money, useAction, useLoad } from './ui';
import { mediaUrl } from '../utils/api';

const PAGE = {
  sales: { sub: 'What sold, what we earned, what we bought', rules: ['Sale = invoiced value without GST, less credit notes', 'Margin only where the cost is known', 'Financial year from April'] },
  stock: { sub: 'Money in stock, and what is getting old', rules: ['Good shelf, packed boxes not yet invoiced, stock on the road and Disputed, at average cost', 'Packs with no cost yet are counted, not valued', "Today's stock"] },
  money: { sub: 'Who owes us, whom we owe', rules: ['Customers: from the ledger, oldest first', 'Suppliers: MSME must be paid within 45 days', 'Collections by month'] },
  gst: { sub: 'Tax totals; on-time and failed deliveries', rules: ['GST: the same figures as GSTR-1 / 3B data', 'Delivery: on time means on or before the promised day', 'Old invoices before this system are not in GST'] },
};
const NO_PERIOD = { stock: ['value', 'ageing', 'expiry', 'slow'], money: ['customers', 'suppliers'], gst: ['gst'] };

function cellText(c, v, hidden) {
  if (hidden) return <span className="a-muted">hidden</span>;
  if (v === null || v === undefined || v === '') return '';
  return c.type === 'money' || c.type === 'cost' ? money(v) : c.type === 'num' ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v);
}
function ReportTable({ t }) {
  if (!t) return null;
  const hid = (i) => Boolean(t.hidden && t.hidden.includes(i));
  if (!t.rows.length) return <div className="a-card"><p className="a-muted">Nothing in this period. Change the period or the godown.</p></div>;
  return (
    <div className="a-listcard a-p23-fit" id="printArea">
      <div className="a-tw"><table className="a-table" aria-label={t.title}>
        <thead><tr>{t.cols.map((c) => <th key={c.label} className={c.type !== 'text' ? 'a-num' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, n) => <tr key={n}>{r.map((v, i) => <td key={i} className={t.cols[i].type !== 'text' ? 'a-num' : undefined}>{cellText(t.cols[i], v, hid(i))}</td>)}</tr>)}</tbody>
        {t.foot && <tfoot><tr>{t.foot.map((v, i) => <td key={i} className={t.cols[i].type !== 'text' ? 'a-num' : undefined}><b>{cellText(t.cols[i], v, hid(i))}</b></td>)}</tr></tfoot>}
      </table></div>
    </div>
  );
}

/** v23 bars16: the top 10 as gold columns (150px for the largest), a short value above, the label cut to 14 letters below */
const shortMoney = (v) => { const a = Math.abs(v); const s = v < 0 ? '-' : ''; return a >= 100000 ? `${s}${Math.round(a / 1000) / 100}L` : a >= 1000 ? `${s}${Math.round(a / 100) / 10}k` : `${s}${Math.round(a)}`; };
function Bars16({ rows, label, money: isMoney }) {
  const top = rows.slice(0, 10); if (!top.length) return null;
  const mx = Math.max(1, ...top.map((r) => Math.abs(r.v)));
  return (
    <div className="a-card a-card-flush a-p23-chart"><div className="a-card-b"><div className="a-bars" role="img" aria-label={`${label}: the values are in the table below`}>
      {top.map((r) => <div key={r.l} className="a-bar" title={`${r.l}: ${isMoney ? money(r.v) : r.v}`}><em>{shortMoney(r.v)}</em><i style={{ height: Math.max(2, Math.round((Math.abs(r.v) / mx) * 150)) }} className={r.v < 0 ? 'neg' : undefined} /><span>{String(r.l).slice(0, 14)}</span></div>)}
    </div></div></div>
  );
}

function ReportPage({ page }) {
  const [f, setF] = useState({ tab: '', per: 'month', from: '', to: '', godown: '' });
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const data = useLoad(`/reports23/${page}${qs ? `?${qs}` : ''}`);
  const act = useAction();
  const d = data.data;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const csv = () => act.run(async () => { await api.download(`/reports23/${page}/export.csv${qs ? `?${qs}` : ''}`, `dfresh-${page}.csv`); });
  const noPer = d && (NO_PERIOD[page] || []).includes(d.tab);
  const chart = d && d.chart && d.chart.length ? d.chart : null; // v23 bars16: the table under it has every value
  return (
    <section>
      <PageHead sub={PAGE[page].sub} rules={PAGE[page].rules} />
      {act.note}
      <Loading state={data}>{d && <>
        <div className="a-card a-card-flush"><div className="a-card-b">
          <div className="a-grid4 a-p23-filters">
            {!noPer && <label className="a-field"><span>Period</span><select value={f.per} aria-label="Period" onChange={(e) => set({ per: e.target.value })}>{Object.entries(d.periods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
            {!noPer && f.per === 'custom' && <><label className="a-field"><span>From</span><input type="date" value={f.from || d.from} onChange={(e) => set({ from: e.target.value })} /></label>
              <label className="a-field"><span>To</span><input type="date" value={f.to || d.to} onChange={(e) => set({ to: e.target.value })} /></label></>}
            <label className="a-field"><span>Godown</span><select value={f.godown} aria-label="Godown" onChange={(e) => set({ godown: e.target.value })}><option value="">All my godowns</option>{d.godowns.map((g) => <option key={g.godown_id} value={g.godown_id}>{g.name}</option>)}</select></label>
            <div className="a-field"><span>&nbsp;</span><span className="a-row">
              {d.can.export && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={csv}><LIcon name="download" size="sm" />CSV</button>}
              <button type="button" className="a-btn a-btn-ghost" onClick={() => window.print()}><LIcon name="printer" size="sm" />Print</button></span></div>
          </div>
          {!noPer && <p className="a-hint-s">{d.from} to {d.to}{d.own ? ' · your own customers only' : ''}</p>}
        </div></div>
        {page === 'sales' && <div className="a-stats">
          <Stat label="Sales in the period" value={money(d.stats.sales)} sub={`${d.stats.invoices} invoices · credit notes ${money(d.stats.credit_notes)}`} icon="trending-up" tone="good" card />
          <Stat label="Orders in hand" value={money(d.stats.in_hand)} sub="Confirmed, not invoiced yet" icon="package" tone="info" card />
          <Stat label="Margin" value={d.stats.margin} sub="Sales less average cost" icon="percent" tone="gold" card />
        </div>}
        {page === 'stock' && <div className="a-stats">
          <Stat label="Stock at cost" value={d.seesCost ? money(d.stats.value) : 'Hidden'} sub={d.seesCost ? `${d.stats.no_cost} packs have no cost yet` : 'Needs See cost on your role'} icon="package" tone="info" card />
          <Stat label="Near expiry" value={`${d.stats.near} packs`} sub="Sell first" icon="clock" tone="warn" card />
          <Stat label="Expired" value={`${d.stats.expired} packs`} sub="Write off or send back" icon="triangle-alert" tone="bad" card />
        </div>}
        <Tabs label="Report" value={d.tab} onChange={(k) => set({ tab: k })} tabs={Object.entries(d.tabs).map(([key, label]) => ({ key, label }))} />
        {d.blocked ? <Alert tone="warn" title="Not shown.">{d.blocked}</Alert> : <>
          {d.notes.map((n) => <Alert key={n} tone={/Profit before tax: Rs -|MSME/.test(n) ? 'warn' : 'info'} title="">{n}</Alert>)}
          {chart && !(page === 'stock' && !d.seesCost) && <Bars16 rows={chart} label={d.table ? d.table.title : 'Chart'} money={!(d.table && d.table.cols[1] && d.table.cols[1].type === 'num' && d.tab !== 'time')} />}
          {chart && page === 'stock' && !d.seesCost && <p className="a-hint-s">Chart: values hidden (See cost).</p>}
          <ReportTable t={d.table} />
          <ReportTable t={d.table2} />
          {(d.extra || []).map((t) => <ReportTable key={t.title} t={t} />)}
          {d.hint && <p className="a-hint-s">{d.hint}</p>}
        </>}
      </>}</Loading>
    </section>
  );
}
export const SalesAndPurchases = () => <ReportPage page="sales" />;
export const StockReport = () => <ReportPage page="stock" />;
export const MoneyOwed = () => <ReportPage page="money" />;
export const GstAndDelivery = () => <ReportPage page="gst" />;

/** a v23 card: a head (title, line, an action) and its body */
function Card2({ title, sub, action, children }) {
  return (
    <div className="a-card a-card-flush">
      <div className="a-card-h"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><span className="a-sp" />{action}</div>
      <div className="a-card-b">{children}</div>
    </div>
  );
}

/** Home > Dashboard (v23 dashTiles + dashBiz): the tiles, top 5, newest alerts, and the website at a glance */
export function DashboardTiles() {
  const data = useLoad('/dashboard/home');
  const navigate = useNavigate();
  const d = data.data;
  const go = (to) => () => navigate(to);
  const more = (label, to) => <button type="button" className="a-btn a-btn-ghost a-btn-sm a-p23-more" onClick={go(to)}>{label} <LIcon name="chevron-right" size="sm" /></button>;
  return (
    <Loading state={data}>{d && <>
      <div className="a-stats">
        {d.tiles.map((t) => (
          <button key={t.key} type="button" className={`a-p23-tile${String(t.money ? money(t.value) : t.value).length > 11 ? ' a-p23-long' : ''}`} onClick={go(t.to)} aria-label={`${t.label}: open the page`}>
            <Stat label={t.label} value={t.money ? money(t.value) : t.value} sub={t.sub} icon={t.icon} tone={t.tone} card />
          </button>
        ))}
      </div>
      <div className="a-grid2 a-p23-two">
        {d.top && (
          <Card2 title="Top 5 products this month" sub="Invoiced, without GST" action={more('Report', '/admin/sales-and-purchases')}>
            {d.top.length ? <table className="a-table"><tbody>{d.top.map((g, i) => <tr key={g.label}><td>{i + 1}</td><td><b>{g.label}</b><small className="a-muted a-p15-sub">{g.qty} packs</small></td><td className="a-num">{money(g.val)}</td></tr>)}</tbody></table>
              : <p className="a-muted">Nothing invoiced this month yet.</p>}
          </Card2>
        )}
        <Card2 title="Newest alerts" sub="Live from the data" action={more('All', '/admin/alerts')}>
          {d.alerts.length ? d.alerts.map((a) => (
            <p key={a.key} className="a-p23-al"><span className={`a-p23-ic a-tone-${a.tone}`}><LIcon name={a.icon} size="sm" /></span><span><b>{a.title}</b><small className="a-muted a-p15-sub">{a.text}</small></span></p>
          )) : <p className="a-muted">All clear.</p>}
        </Card2>
      </div>
      {d.site && (
        <div className="a-grid2 a-p23-two">
          <Card2 title="Most loved on dfresh.us" sub="The home page row, in this order">
            <div className="a-p23-loved">
              {d.site.loved.map((p) => (
                <div key={p.product_id} className="it" role="button" tabIndex={0} onClick={go('/admin/products')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/admin/products'); }}>
                  {p.image ? <img src={mediaUrl(`/media/products/400/${p.image}`)} alt="" /> : <span className="a-thumb a-thumb-none a-p23-noimg" />}
                  <span className="n">{p.featured_order}</span><br />{p.name}
                </div>
              ))}
              {d.site.loved.length < 5 && <div className="a-muted">{5 - d.site.loved.length} place{5 - d.site.loved.length > 1 ? 's' : ''} free</div>}
            </div>
            <div className="a-p23-gh">Business kits</div>
            {d.site.kits.map((k) => (
              <div key={k.kit_key} className="a-p23-kit" role="button" tabIndex={0} onClick={go('/admin/kits')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/admin/kits'); }}>
                {k.image ? <img src={mediaUrl(`/media/products/400/${k.image}`)} alt="" /> : <span className="a-thumb a-thumb-none" style={{ width: 44, height: 44 }} />}
                <div style={{ flex: 1 }}><b>{k.name}</b><span className="s">{k.parts} products{k.tagline ? ` · ${k.tagline}` : ''}</span></div>
                <Pill tone={k.ready ? 'good' : 'bad'}>{k.ready ? `${k.ready} ready` : 'Unavailable'}</Pill>
              </div>
            ))}
          </Card2>
          <Card2 title="Where we deliver" sub={`${d.site.towns.length} towns on the website map`}>
            <div className="a-p23-towns">{d.site.towns.map((t) => <Pill key={t.name} tone={t.base ? 'gold' : 'gray'}>{t.name}{t.base ? ' · godown' : ''}</Pill>)}</div>
            <div className="a-p23-gh">Company</div>
            <dl className="a-dl">
              <div><dt>Legal name</dt><dd>{d.site.company.name || '-'}</dd></div>
              <div><dt>CIN</dt><dd>{d.site.company.cin || '-'}</dd></div>
              <div><dt>GSTIN</dt><dd>{d.site.company.gstin || <Pill tone="warn">To be provided</Pill>}</dd></div>
              <div><dt>Office</dt><dd>{d.site.company.office || '-'}</dd></div>
              <div><dt>Godowns</dt><dd>{d.site.company.godowns}</dd></div>
              <div><dt>Phone</dt><dd>{d.site.company.phone || '-'}</dd></div>
            </dl>
          </Card2>
        </div>
      )}
    </>}</Loading>
  );
}
