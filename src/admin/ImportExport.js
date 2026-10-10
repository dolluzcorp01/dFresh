// Product Excel (spec F 4): export in the v0.2 layout; import = dry run (diff) first, apply only on confirm.
import { useState } from 'react';
import { api } from './adminApi';
import { Notice, useAction, useCan } from './ui';

const show = (v) => (v === null || v === undefined || v === '' ? <em className="a-muted">empty</em> : String(v));

export default function ImportExport() {
  const isAdmin = useCan('admin');
  const act = useAction();
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);

  const exportXlsx = () => act.run(() => api.download('/products/export.xlsx', 'dFresh_Product_List.xlsx'));
  const dryRun = () => act.run(async () => setReport(await api.upload('/products/import?dryRun=1', file)));
  const apply = () => window.confirm('Apply these changes to the live site?') && act.run(async () => {
    const r = await api.upload('/products/import?dryRun=0', file);
    setReport(r);
    setFile(null);
  }, 'Applied');

  return (
    <section>
      <h1>Excel import / export</h1>
      {act.note}
      <div className="a-card">
        <h2>Export</h2>
        <p>Product List in the v0.2 layout (Products, Categories, UI_Text): one column per language for every text, plus Spec_status (internal).</p>
        <button type="button" className="a-btn" onClick={exportXlsx} disabled={act.busy}>Download products .xlsx</button>
      </div>
      <div className="a-card">
        <h2>Import</h2>
        {!isAdmin && <Notice>Importing needs the admin role.</Notice>}
        <div className="a-toolbar">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!isAdmin}
            onChange={(e) => { setFile(e.target.files[0] || null); setReport(null); }} />
          <button type="button" className="a-btn" disabled={!file || act.busy || !isAdmin} onClick={dryRun}>Dry run</button>
          {report && report.dryRun && report.ok && (report.summary.added + report.summary.changed + report.summary.removed + report.summary.categories > 0) && (
            <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={apply}>Apply changes</button>
          )}
        </div>
        {report && <Report r={report} />}
      </div>
    </section>
  );
}

function Report({ r }) {
  const s = r.summary;
  return (
    <div className="a-report">
      <p><strong>{r.dryRun ? 'Dry run' : `Applied ${r.applied} change(s)`}:</strong> {s.added} added, {s.changed} changed, {s.removed} removed (deactivated), {s.categories} category change(s), {s.errors} error(s).</p>
      {r.errors.length > 0 && <Notice kind="error"><ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
      {r.unknownColumns.length > 0 && <Notice kind="warn">Unknown columns (not imported): {r.unknownColumns.join(', ')}</Notice>}
      {r.unknownSheets.length > 0 && <Notice kind="warn">Unknown sheets (not imported): {r.unknownSheets.join(', ')}</Notice>}
      {r.notes.map((n) => <Notice key={n}>{n}</Notice>)}
      {r.added.length > 0 && <><h3>Added</h3><p>{r.added.map((a) => a.product).join(', ')}</p></>}
      {r.removed.length > 0 && <><h3>Missing from the sheet (will be deactivated)</h3><p>{r.removed.map((a) => a.product).join(', ')}</p></>}
      {r.changed.length > 0 && (
        <>
          <h3>Changed</h3>
          <table className="a-table">
            <thead><tr><th>Product</th><th>Column</th><th>Now</th><th>From the sheet</th></tr></thead>
            <tbody>{r.changed.flatMap((c) => c.diffs.map((d) => (
              <tr key={`${c.product}-${d.field}`}><td><code>{c.product}</code></td><td>{d.field}</td><td>{show(d.before)}</td><td>{show(d.after)}</td></tr>
            )))}</tbody>
          </table>
        </>
      )}
      {r.categories.length > 0 && (
        <>
          <h3>Categories</h3>
          <table className="a-table"><tbody>{r.categories.flatMap((c) => c.diffs.map((d) => (
            <tr key={`${c.category}-${d.field}`}><td><code>{c.category}</code></td><td>{d.field}</td><td>{show(d.before)}</td><td>{show(d.after)}</td></tr>
          )))}</tbody></table>
        </>
      )}
      {r.readOnly.length > 0 && (
        <>
          <h3>Read-only differences (not applied)</h3>
          <table className="a-table"><tbody>{r.readOnly.map((d) => (
            <tr key={`${d.product}-${d.field}`}><td><code>{d.product}</code></td><td>{d.field}</td><td>{show(d.current)}</td><td>{show(d.sheet)}</td></tr>
          ))}</tbody></table>
        </>
      )}
    </div>
  );
}
