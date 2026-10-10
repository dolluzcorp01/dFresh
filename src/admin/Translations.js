// Translations (spec F 5): every ui_text key x language, grouped; missing cells highlighted; inline edit;
// "missing only" filter; CSV export / import (dry run first) for translators.
import { useMemo, useState } from 'react';
import { api } from './adminApi';
import { Loading, Notice, useAction, useAdmin, useCan, useLoad } from './ui';

export default function Translations() {
  const grid = useLoad('/ui-text');
  const { languages } = useAdmin();
  const canEdit = useCan('editor');
  const act = useAction();
  const [missingOnly, setMissingOnly] = useState(false);
  const [lang, setLang] = useState('');
  const [q, setQ] = useState('');
  const [csvFile, setCsvFile] = useState(null);
  const [csvReport, setCsvReport] = useState(null);
  const def = grid.data ? grid.data.default : 'en';
  const cols = languages.filter((l) => !lang || l.lang_code === lang || l.lang_code === def);

  const missingCount = useMemo(() => {
    const out = {};
    for (const l of languages) out[l.lang_code] = (grid.data ? grid.data.keys : []).filter((k) => !k.values[l.lang_code]).length;
    return out;
  }, [grid.data, languages]);

  const groups = useMemo(() => {
    const keys = (grid.data ? grid.data.keys : []).filter((k) => {
      const f = q.trim().toLowerCase();
      if (f && !k.text_key.includes(f) && !Object.values(k.values).some((v) => v.toLowerCase().includes(f))) return false;
      if (missingOnly) return cols.some((l) => !k.values[l.lang_code]);
      return true;
    });
    const by = new Map();
    for (const k of keys) by.set(k.group_name, [...(by.get(k.group_name) || []), k]);
    return [...by.entries()];
  }, [grid.data, q, missingOnly, cols]);

  const save = (key, code, value) => act.run(async () => {
    await api.send('PUT', `/ui-text/${encodeURIComponent(key)}/${code}`, { value });
    grid.setData((d) => ({ ...d, keys: d.keys.map((k) => (k.text_key === key ? { ...k, values: { ...k.values, [code]: value.trim() ? value : undefined } } : k)) }));
  });

  const csvRun = (dry) => act.run(async () => {
    const r = await api.upload(`/ui-text/import?dryRun=${dry ? 1 : 0}`, csvFile);
    setCsvReport(r);
    if (!dry) { grid.reload(); setCsvFile(null); }
  }, dry ? null : 'Imported');

  return (
    <section>
      <h1>Translations</h1>
      <p className="a-muted">Missing per language: {languages.map((l) => <span key={l.lang_code} className={missingCount[l.lang_code] ? 'a-bad' : ''}> {l.lang_code} {missingCount[l.lang_code]} </span>)}</p>
      <div className="a-toolbar">
        <input type="search" placeholder="Search key or text" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="">All languages</option>{languages.filter((l) => l.lang_code !== def).map((l) => <option key={l.lang_code} value={l.lang_code}>{l.name_en}</option>)}
        </select>
        <label className="a-inline"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only</label>
        {canEdit && <button type="button" className="a-btn a-btn-ghost" onClick={() => act.run(() => api.download('/ui-text/export.csv', 'translations.csv'))}>Export CSV</button>}
      </div>
      {canEdit && (
        <div className="a-toolbar">
          <input type="file" accept=".csv,text/csv" onChange={(e) => { setCsvFile(e.target.files[0] || null); setCsvReport(null); }} />
          <button type="button" className="a-btn a-btn-ghost" disabled={!csvFile || act.busy} onClick={() => csvRun(true)}>Check CSV</button>
          {csvReport && csvReport.dryRun && !csvReport.errors.length && csvReport.changes > 0 && <button type="button" className="a-btn" disabled={act.busy} onClick={() => csvRun(false)}>Import {csvReport.changes} change(s)</button>}
        </div>
      )}
      {csvReport && (
        <Notice kind={csvReport.errors.length ? 'error' : 'info'}>
          {csvReport.dryRun ? 'Check' : 'Imported'}: {csvReport.changes} change(s).
          {csvReport.unknownColumns.length > 0 && ` Unknown columns: ${csvReport.unknownColumns.join(', ')}.`}
          {csvReport.errors.length > 0 && ` Errors: ${csvReport.errors.slice(0, 10).join('; ')}`}
        </Notice>
      )}
      {act.note}
      <Loading state={grid}>
        <div className="a-scroll">
          <table className="a-table a-grid">
            <thead><tr><th>Key</th>{cols.map((l) => <th key={l.lang_code}>{l.name_en} <code>{l.lang_code}</code></th>)}</tr></thead>
            {groups.map(([group, keys]) => (
              <tbody key={group}>
                <tr className="a-group"><th colSpan={cols.length + 1}>{group}</th></tr>
                {keys.map((k) => (
                  <tr key={k.text_key}>
                    <td><code>{k.text_key}</code>{k.allows_html ? <small className="a-muted"> html</small> : null}<br /><small className="a-muted">{k.description}</small></td>
                    {cols.map((l) => (
                      <td key={l.lang_code} className={k.values[l.lang_code] ? '' : 'a-missing'}>
                        <Cell value={k.values[l.lang_code] || ''} dir={l.dir} disabled={!canEdit} label={`${k.text_key} ${l.lang_code}`}
                          onSave={(v) => save(k.text_key, l.lang_code, v)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Loading>
    </section>
  );
}

// Saves on blur when the text changed.
function Cell({ value, onSave, disabled, dir, label }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setV(value); }
  return (
    <textarea rows={Math.min(6, Math.max(1, Math.ceil(v.length / 40)))} value={v} dir={dir} disabled={disabled} aria-label={label}
      onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
  );
}
