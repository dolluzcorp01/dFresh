// Product Excel (spec F 4): export in the v0.2 layout; import = dry run (diff) first, apply only on confirm.
// Apply is offered only for the exact file that passed the dry run with 0 errors: the server returns the file's
// fingerprint with the dry run and refuses an apply whose file does not match it (and checks everything again).
// Choosing another file or "Clear" drops the previous result; after an apply the form resets and says what changed.
import { useRef, useState } from 'react';
import { api } from './adminApi';
import { InfoCard, Notice, useAction, useCan } from './ui';

const show = (v) => (v === null || v === undefined || v === '' ? <em className="a-muted">empty</em> : String(v));
// a column like Name_TA / Pack_HI: its language, so the browser picks the right font and shaping
const langOf = (field) => { const m = /_([A-Z]{2,3})$/.exec(field || ''); return m && m[1] !== 'EN' ? m[1].toLowerCase() : undefined; };

export default function ImportExport() {
  const isAdmin = useCan('admin');
  const act = useAction();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null); // the dry run of `file`
  const [applied, setApplied] = useState(null); // { added, changed, removed } after an apply

  const exportXlsx = () => act.run(() => api.download('/products/export.xlsx', 'dFresh_Product_List.xlsx'));
  const reset = () => {
    setFile(null);
    setReport(null);
    if (inputRef.current) inputRef.current.value = '';
  };
  const choose = (f) => {
    setFile(f || null);
    setReport(null);
    setApplied(null);
    act.setMsg(null);
  };
  const dryRun = () => act.run(async () => {
    const checked = file;
    const r = await api.upload('/products/import?dryRun=1', checked);
    setReport({ ...r, file: checked });
  });
  const hasChanges = report && report.summary.added + report.summary.changed + report.summary.removed + report.summary.categories > 0;
  const canApply = Boolean(report && report.dryRun && report.ok && report.file === file && report.fileHash && hasChanges);
  const apply = () => canApply && window.confirm('Apply these changes to the live site?') && act.run(async () => {
    const r = await api.upload(`/products/import?dryRun=0&hash=${encodeURIComponent(report.fileHash)}`, file);
    setApplied({ added: r.summary.added, changed: r.summary.changed, removed: r.summary.removed, categories: r.summary.categories });
    reset();
  });

  return (
    <section>
      <h1>Excel import / export</h1>
      <InfoCard title="How the import works">
        <ul>
          <li>Export the list, edit it in Excel, then choose it here and run the dry run: it lists every change and every error.</li>
          <li>Apply changes is offered only for that same file with 0 errors. A product missing from the sheet is switched off, never deleted.</li>
          <li>Photos are uploaded in Products; UI texts are edited in Translations.</li>
        </ul>
      </InfoCard>
      {act.note}
      <div className="a-card">
        <h2>Export</h2>
        <p>Product List in the v0.2 layout (Products, Categories, UI_Text): one column per language for every text, plus Spec status (internal, the red column).</p>
        <button type="button" className="a-btn" onClick={exportXlsx} disabled={act.busy}>Download products .xlsx</button>
      </div>
      <div className="a-card">
        <h2>Import</h2>
        {!isAdmin && <Notice>Importing needs the admin role.</Notice>}
        {applied && (
          <Notice kind="ok">
            Applied: {applied.added} added, {applied.changed} changed, {applied.removed} deactivated
            {applied.categories ? `, ${applied.categories} category change(s)` : ''}.{' '}
            <button type="button" className="a-link" onClick={exportXlsx} disabled={act.busy}>Download the updated list</button>
          </Notice>
        )}
        <div className="a-toolbar">
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!isAdmin}
            aria-label="Product List file (.xlsx)" onChange={(e) => choose(e.target.files[0])} />
          <button type="button" className="a-btn" disabled={!file || act.busy || !isAdmin} onClick={dryRun}>Dry run</button>
          {file && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => { reset(); act.setMsg(null); }}>Clear</button>}
          {canApply && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={apply}>Apply changes</button>}
        </div>
        {report && report.ok && !hasChanges && <p className="a-muted">No differences with the live list: nothing to apply.</p>}
        {report && !report.ok && <p className="a-bad">Fix the {report.summary.errors} error(s) in the file, choose it again and run the dry run: Apply is offered only for a file with 0 errors.</p>}
        {report && <Report r={report} />}
      </div>
    </section>
  );
}

function Report({ r }) {
  const s = r.summary;
  return (
    <div className="a-report">
      <p><strong>Dry run:</strong> {s.added} added, {s.changed} changed, {s.removed} removed (deactivated), {s.categories} category change(s), {s.errors} error(s).</p>
      {r.errors.length > 0 && <Notice kind="error"><ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
      {r.unknownColumns.length > 0 && <Notice kind="warn">Unknown columns (not imported): {r.unknownColumns.join(', ')}</Notice>}
      {r.unknownSheets.length > 0 && <Notice kind="warn">Unknown sheets (not imported): {r.unknownSheets.join(', ')}</Notice>}
      {r.notes.map((n) => <Notice key={n}>{n}</Notice>)}
      {r.added.length > 0 && <><h3>Added</h3><p>{r.added.map((a) => a.product).join(', ')}</p></>}
      {r.removed.length > 0 && <><h3>Missing from the sheet (will be deactivated)</h3><p>{r.removed.map((a) => a.product).join(', ')}</p></>}
      {r.changed.length > 0 && (
        <>
          <h3>Changed</h3>
          <table className="a-table a-difftable">
            <thead><tr><th>Product</th><th>Column</th><th>Now</th><th>From the sheet</th></tr></thead>
            <tbody>{r.changed.flatMap((c) => c.diffs.map((d) => (
              <tr key={`${c.product}-${d.field}`}><td><code>{c.product}</code></td><td>{d.field}</td>
                <td lang={langOf(d.field)}>{show(d.before)}</td><td lang={langOf(d.field)}>{show(d.after)}</td></tr>
            )))}</tbody>
          </table>
        </>
      )}
      {r.categories.length > 0 && (
        <>
          <h3>Categories</h3>
          <table className="a-table a-difftable"><tbody>{r.categories.flatMap((c) => c.diffs.map((d) => (
            <tr key={`${c.category}-${d.field}`}><td><code>{c.category}</code></td><td>{d.field}</td>
              <td lang={langOf(d.field)}>{show(d.before)}</td><td lang={langOf(d.field)}>{show(d.after)}</td></tr>
          )))}</tbody></table>
        </>
      )}
      {r.readOnly.length > 0 && (
        <>
          <h3>Read-only differences (not applied)</h3>
          <table className="a-table a-difftable"><tbody>{r.readOnly.map((d) => (
            <tr key={`${d.product}-${d.field}`}><td><code>{d.product}</code></td><td>{d.field}</td>
              <td lang={langOf(d.field)}>{show(d.current)}</td><td lang={langOf(d.field)}>{show(d.sheet)}</td></tr>
          ))}</tbody></table>
        </>
      )}
    </div>
  );
}
