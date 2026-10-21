// Commerce > Reports (docs/COMMERCE-SPEC.md 10; API /commerce/reports/..., logic in src/backend_routes/reports.js). One
// area for every report: the period (India dates; presets), the report's filters, its checks (the totals tied back to
// the invoices, credit notes and stock), a chart where useful (ReportChart.js), every table with its totals, Excel
// (the GST one in the GST offline tool's sheets and column order) and Print / PDF. A report shows only for a role with
// view on its own section (listed on the report); costs and margins need Reports and Products and prices.
// Reports: Sales, GST (GSTR-1), Margin, Stock, Receivables, Delivery, Returns, Promotions and wallet, Accounting export.
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { InfoCard, Loading, Notice, useAction, useLoad } from './ui';
import { esc, printPage, rs } from './printKit';
import ReportChart from './ReportChart';

const ist = (n = 0) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
function presets() {
  const t = ist(); const y = Number(t.slice(0, 4)); const mo = Number(t.slice(5, 7));
  const lmEnd = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10);
  const fyStart = mo >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
  return [['Today', t, t], ['Last 7 days', ist(-6), t], ['This month', `${t.slice(0, 8)}01`, t], ['Last month', `${lmEnd.slice(0, 8)}01`, lmEnd], ['Last 30 days', ist(-29), t], ['This financial year', fyStart, t]];
}
const cell = (c, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return rs(v);
  if (c.type === 'pct') return `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
  if (c.type === 'num') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (c.type === 'date') return day(v);
  return String(v);
};
const num = (c) => ['money', 'pct', 'num'].includes(c.type);

export default function CommerceReports() {
  const meta = useLoad('/commerce/reports');
  const m = meta.data;
  const allowed = m ? m.reports.filter((r) => r.allowed) : [];
  const [key, setKey] = useState(null);
  useEffect(() => { if (m && !key && allowed.length) setKey(allowed[0].key); }, [m]); // eslint-disable-line react-hooks/exhaustive-deps
  const [p, setP] = useState({ from: `${ist().slice(0, 8)}01`, to: ist() });
  const [f, setF] = useState({ group: 'day', type: '', owner: '', by: 'sku', view: 'movement', days: '' });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const rep = m && allowed.find((r) => r.key === key);
  return (
    <section>
      <h1>Reports</h1>
      <InfoCard title="Reports">
        <ul>
          <li>Choose the report and the period; Excel and Print / PDF give exactly what is on screen. Each report shows only for a role with view on its section; costs and margins need Reports and Products and prices.</li>
          <li>Sales = invoices issued in the period minus credit notes issued in it (returns and cancellations). The checks under each report tie its totals back to the invoices, credit notes and stock.</li>
        </ul>
      </InfoCard>
      <Loading state={meta}>
        {m && (!allowed.length ? <Notice kind="info">No report for your role: each report needs view on its section ({m.reports.map((r) => `${r.label}: ${r.section}`).join('; ')}).</Notice> : (
          <>
            <div className="a-chips a-tabs" role="tablist" aria-label="Reports">
              {allowed.map((r) => <button key={r.key} type="button" role="tab" aria-selected={key === r.key} className={`a-chip${key === r.key ? ' on' : ''}`} onClick={() => setKey(r.key)}>{r.label}</button>)}
            </div>
            <div className="a-filters">
              <label>Period <select value="" aria-label="Period preset" onChange={(e) => { const x = presets().find((pp) => pp[0] === e.target.value); if (x) setP({ from: x[1], to: x[2] }); }}><option value="">Choose...</option>{presets().map(([l]) => <option key={l}>{l}</option>)}</select></label>
              <label>From <input type="date" value={p.from} max={p.to} aria-label="From" onChange={(e) => e.target.value && setP({ ...p, from: e.target.value })} /></label>
              <label>To <input type="date" value={p.to} min={p.from} aria-label="To" onChange={(e) => e.target.value && setP({ ...p, to: e.target.value })} /></label>
              {key === 'sales' && <>
                <label>By <select value={f.group} aria-label="Group by" onChange={(e) => set({ group: e.target.value })}>{Object.entries(m.groups).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Customer type <select value={f.type} aria-label="Customer type" onChange={(e) => set({ type: e.target.value })}><option value="">All</option>{m.types.map((t) => <option key={t.type_key} value={t.type_key}>{t.label}</option>)}</select></label>
                <label>Sales owner <select value={f.owner} aria-label="Sales owner" onChange={(e) => set({ owner: e.target.value })}><option value="">All</option>{m.owners.map((o) => <option key={o.emp_id} value={o.emp_id}>{o.name}</option>)}</select></label>
              </>}
              {key === 'margin' && <label>By <select value={f.by} aria-label="Margin by" onChange={(e) => set({ by: e.target.value })}>{Object.entries(m.marginBy).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
              {key === 'stock' && <>
                <label>View <select value={f.view} aria-label="Stock view" onChange={(e) => set({ view: e.target.value })}>{Object.entries(m.stockViews).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                {f.view === 'slow' && <label>Days <input className="a-qty" inputMode="numeric" value={f.days} placeholder="60" aria-label="Slow days" onChange={(e) => set({ days: e.target.value })} /></label>}
              </>}
            </div>
            {key === 'accounting' ? <Accounting p={p} format={m.accounting} /> : rep && <Report key={key} rkey={key} label={rep.label} section={rep.section} p={p} f={f} />}
          </>
        ))}
      </Loading>
    </section>
  );
}

function Report({ rkey, label, section, p, f }) {
  const keys = { sales: ['group', 'type', 'owner'], margin: ['by'], stock: ['view', 'days'] }[rkey] || [];
  const qs = [`from=${p.from}`, `to=${p.to}`, ...keys.filter((k) => f[k]).map((k) => `${k}=${encodeURIComponent(f[k])}`)].join('&');
  const r = useLoad(`/commerce/reports/${rkey}?${qs}`);
  const act = useAction();
  const chartRef = useRef(null);
  const d = r.data;
  const moneyChart = !(rkey === 'stock' && f.view === 'movement') && !(rkey === 'delivery') && !(rkey === 'returns');
  const excel = () => act.run(() => api.download(`/commerce/reports/${rkey}/export.xlsx?${qs}`, `dFresh_${label}.xlsx`));
  const print = () => {
    const svg = chartRef.current && chartRef.current.querySelector('svg');
    const tables = d.tables.filter((t) => t.rows.length || rkey !== 'gst').map((t) => `<h2>${esc(t.title)}</h2><table><thead><tr>${t.columns.map((c) => `<th${num(c) ? ' class="n"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${t.rows.map((row) => `<tr>${t.columns.map((c) => `<td${num(c) ? ' class="n"' : ''}>${esc(cell(c, row[c.key]))}</td>`).join('')}</tr>`).join('')}
      ${Object.keys(t.totals || {}).length ? `<tr>${t.columns.map((c, i) => `<td${num(c) ? ' class="n"' : ''}><b>${i === 0 ? 'Total' : esc(cell(c, t.totals[c.key]))}</b></td>`).join('')}</tr>` : ''}</tbody></table>`).join('');
    const ok = printPage({ title: `dFresh ${label} ${p.from} to ${p.to}`, size: 'A4 landscape',
      body: `<h1>dFresh ${esc(label)}</h1><p>${esc(day(p.from))} to ${esc(day(p.to))}${keys.filter((k) => f[k]).map((k) => ` · ${esc(k)}: ${esc(f[k])}`).join('')}</p>${svg ? `<div style="max-width:720px">${svg.outerHTML}</div>` : ''}${tables}
        ${(d.checks || []).map((c) => `<p>${c.ok ? 'OK' : 'DIFFERENT'}: ${esc(c.label)} = ${esc(String(c.value))} (${esc(c.detail)})</p>`).join('')}${(d.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join('')}` });
    if (!ok) act.setMsg({ kind: 'error', text: 'Allow pop-ups to print.' });
  };
  return (
    <Loading state={r}>
      {d && (
        <div className="a-report">
          {act.note}
          <div className="a-toolbar">
            <span className="a-muted">{label}: {day(d.from)} to {day(d.to)} · needs view on {section}</span>
            <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={excel}>Excel</button>
            <button type="button" className="a-btn a-btn-ghost" onClick={print}>Print / PDF</button>
          </div>
          {(d.checks || []).map((c) => <Notice key={c.label} kind={c.ok ? 'ok' : 'error'}>{c.ok ? 'Check OK' : 'Check DIFFERENT'}: {c.label} = {typeof c.value === 'number' && rkey !== 'stock' ? rs(c.value) : c.value} ({c.detail})</Notice>)}
          {rkey === 'sales' && d.tables[0].totals.prev_total !== undefined && (
            <div className="a-stats">
              <div className="a-stat"><b>{rs(d.tables[0].totals.total)}</b><span>sales in the period</span></div>
              <div className="a-stat"><b>{rs(d.tables[0].totals.prev_total)}</b><span>previous period</span></div>
              <div className="a-stat"><b>{d.tables[0].totals.change === null ? '-' : `${d.tables[0].totals.change > 0 ? '+' : ''}${d.tables[0].totals.change}%`}</b><span>change</span></div>
              <div className="a-stat"><b>{d.tables[0].totals.invoices}</b><span>invoices</span></div>
            </div>
          )}
          {d.chart && d.chart.x.length > 0 && <div ref={chartRef}><ReportChart chart={d.chart} money={moneyChart} /></div>}
          {d.tables.map((t) => (
            <div key={t.key} className="a-report-table">
              <h2>{t.title}</h2>
              {t.rows.length ? (
                <div className="a-scroll">
                  <table className="a-table">
                    <thead><tr>{t.columns.map((c) => <th key={c.key} className={num(c) ? 'a-num' : undefined}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {t.rows.map((row, i) => <tr key={row.key || i}>{t.columns.map((c) => <td key={c.key} className={num(c) ? 'a-num' : undefined}>{cell(c, row[c.key])}</td>)}</tr>)}
                      {Object.keys(t.totals || {}).length > 0 && <tr className="a-totalrow">{t.columns.map((c, i) => <td key={c.key} className={num(c) ? 'a-num' : undefined}>{i === 0 ? 'Total' : cell(c, t.totals[c.key])}</td>)}</tr>}
                    </tbody>
                  </table>
                </div>
              ) : <p className="a-muted">Nothing in this period.</p>}
            </div>
          ))}
          {(d.notes || []).map((n) => <p key={n} className="a-muted">{n}</p>)}
        </div>
      )}
    </Loading>
  );
}

function Accounting({ p, format }) {
  const r = useLoad(`/commerce/reports/accounting/preview?from=${p.from}&to=${p.to}`);
  const act = useAction();
  const d = r.data;
  const download = () => act.run(() => api.download(`/commerce/reports/accounting/journal.csv?from=${p.from}&to=${p.to}`, `dfresh-journal-${p.from}-${p.to}.csv`));
  return (
    <Loading state={r}>
      {d && (
        <>
          {act.note}
          <Notice kind="info">Accounting software: {format === 'csv' ? 'CSV journal' : format} (Commerce settings &gt; Accounting; Tally and Zoho are to be confirmed by sir). The CSV opens in Excel and has one line per ledger entry.</Notice>
          <div className="a-stats">
            {d.vouchers.map((v) => <div key={v.type} className="a-stat"><b>{v.n}</b><span>{v.type}</span></div>)}
            <div className={`a-stat${Math.abs(d.debit - d.credit) > 0.01 ? ' a-stat-bad' : ''}`}><b>{rs(d.debit)}</b><span>debit = credit {rs(d.credit)}</span></div>
          </div>
          <button type="button" className="a-btn" disabled={act.busy || !d.count} onClick={download}>Download the journal (.csv)</button>
          <div className="a-scroll">
            <table className="a-table">
              <thead><tr><th>Date</th><th>Voucher</th><th>No.</th><th>Party</th><th>Ledger</th><th className="a-num">Debit</th><th className="a-num">Credit</th><th>Narration</th></tr></thead>
              <tbody>{d.lines.map((x, i) => <tr key={i}><td>{day(x.date)}</td><td>{x.type}</td><td>{x.no}</td><td>{x.party}{x.gstin ? <small className="a-muted a-person-sub">{x.gstin}</small> : null}</td><td>{x.ledger}</td>
                <td className="a-num">{x.debit === '' ? '' : rs(x.debit)}</td><td className="a-num">{x.credit === '' ? '' : rs(x.credit)}</td><td>{x.narration}</td></tr>)}</tbody>
            </table>
          </div>
          {d.count > d.lines.length && <p className="a-muted">The first {d.lines.length} of {d.count} lines; the CSV has them all.</p>}
        </>
      )}
    </Loading>
  );
}
