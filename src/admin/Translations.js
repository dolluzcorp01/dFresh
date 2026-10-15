// Translations (spec F 5): every ui_text key x language, grouped; missing cells highlighted; inline edit;
// "missing only" filter; CSV export / import (dry run first) for translators.
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, Notice, useAction, useAdmin, useCan, useLoad } from './ui';
import { COUNTS } from '../shared/countText';

export default function Translations() {
  const grid = useLoad('/ui-text');
  const { languages, reloadLanguages } = useAdmin();
  const canEdit = useCan('editor');
  const act = useAction();
  // ?lang=ta&missing=1 (dashboard "not translated yet" links) opens the grid already filtered
  const { search } = useLocation();
  const [missingOnly, setMissingOnly] = useState(() => new URLSearchParams(search).get('missing') === '1');
  const [lang, setLang] = useState(() => new URLSearchParams(search).get('lang') || '');
  const [q, setQ] = useState('');
  const [csvFile, setCsvFile] = useState(null);
  const [csvReport, setCsvReport] = useState(null);
  const def = grid.data ? grid.data.default : 'en';
  const cols = languages.filter((l) => !lang || l.lang_code === lang || l.lang_code === def);

  // the server's count (GET /languages completeness, ui_text part): the same numbers as the Languages page
  const missingCount = useMemo(() => Object.fromEntries(languages.map((l) => {
    const part = l.completeness && l.completeness.parts && l.completeness.parts.ui_text;
    return [l.lang_code, part ? part.total - part.have : 0];
  })), [languages]);

  const groups = useMemo(() => {
    const keys = (grid.data ? grid.data.keys : []).filter((k) => {
      const f = q.trim().toLowerCase();
      if (f && !k.text_key.includes(f) && !Object.values(k.values).some((v) => v.toLowerCase().includes(f))) return false;
      if (missingOnly) return cols.some((l) => !k.values[l.lang_code] && !(k.default_only && l.lang_code !== def));
      return true;
    });
    const by = new Map();
    for (const k of keys) by.set(k.group_name, [...(by.get(k.group_name) || []), k]);
    return [...by.entries()];
  }, [grid.data, q, missingOnly, cols, def]);

  const save = (key, code, value) => act.run(async () => {
    await api.send('PUT', `/ui-text/${encodeURIComponent(key)}/${code}`, { value });
    grid.setData((d) => ({ ...d, keys: d.keys.map((k) => (k.text_key === key ? { ...k, values: { ...k.values, [code]: value.trim() ? value : undefined } } : k)) }));
    reloadLanguages(); // the missing counts come from the server
  });

  const csvRun = (dry) => act.run(async () => {
    const r = await api.upload(`/ui-text/import?dryRun=${dry ? 1 : 0}`, csvFile);
    setCsvReport(r);
    if (!dry) { grid.reload(); setCsvFile(null); reloadLanguages(); }
  }, dry ? null : 'Imported');

  return (
    <section>
      <h1>Translations</h1>
      <InfoCard title="Live numbers in any text">
        <ul>
          <li>{COUNTS.map((c) => <code key={c}>{`{${c}}`}</code>).reduce((a, b) => [a, ', ', b])} show the current count, e.g. 25</li>
          <li>Add <code>_word</code> for the number in words: <code>{'{towns_word}'}</code> shows &quot;six&quot; (words come from <code>num_words</code>, group &quot;Numbers in text&quot;)</li>
          <li>Other names like <code>{'{name}'}</code> are filled by the site. Keep them exactly as they are, do not translate them.</li>
        </ul>
      </InfoCard>
      <div className="a-card a-trtools">
      <p className="a-muted a-trmissing">Missing per language: {languages.map((l) => <span key={l.lang_code} className={missingCount[l.lang_code] ? 'a-bad' : ''}> {l.lang_code} {missingCount[l.lang_code]} </span>)}</p>
      <div className="a-toolbar">
        <input type="search" placeholder="Search key or text" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="">All languages</option>{languages.filter((l) => l.lang_code !== def).map((l) => <option key={l.lang_code} value={l.lang_code}>{l.name_en}</option>)}
        </select>
        <label className="a-inline"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only</label>
        {canEdit && <button type="button" className="a-btn" onClick={() => act.run(() => api.download('/ui-text/export.xlsx', 'dFresh_Translations.xlsx'))}>Export Excel</button>}
        {canEdit && <button type="button" className="a-btn" onClick={() => act.run(() => api.download('/ui-text/export.csv', 'dFresh_Translations.csv'))} title="The file to edit and import back">Export CSV (for import)</button>}
      </div>
      {canEdit && (
        <div className="a-toolbar">
          <input type="file" accept=".csv,text/csv" aria-label="Translations CSV file" onChange={(e) => { setCsvFile(e.target.files[0] || null); setCsvReport(null); }} />
          <button type="button" className="a-btn" disabled={!csvFile || act.busy} onClick={() => csvRun(true)}>Check CSV</button>
          {csvReport && csvReport.dryRun && !csvReport.errors.length && csvReport.changes > 0 && <button type="button" className="a-btn" disabled={act.busy} onClick={() => csvRun(false)}>Import {csvReport.changes} change(s)</button>}
        </div>
      )}
      </div>
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
                    {cols.map((l) => (k.default_only && l.lang_code !== def ? (
                      <td key={l.lang_code}><small className="a-muted">Staff e-mails use {def} only</small></td>
                    ) : (
                      <td key={l.lang_code} className={k.values[l.lang_code] || l.lang_code !== def ? '' : 'a-missing'}>
                        <Cell value={k.values[l.lang_code] || ''} dir={l.dir} disabled={!canEdit} label={`${k.text_key} ${l.lang_code}`}
                          placeholder={l.lang_code !== def ? 'uses default' : undefined}
                          max={k.max_chars} onSave={(v) => save(k.text_key, l.lang_code, v)} />
                      </td>
                    )))}
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

// Saves on blur when the text changed. max (Google and sharing texts): a live "n / max" counter, red when over;
// a longer text still saves (Google just cuts it short).
function Cell({ value, onSave, disabled, dir, label, max, placeholder }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setV(value); }
  const n = [...v].length;
  return (
    <>
      <textarea rows={Math.min(6, Math.max(1, Math.ceil(v.length / 40)))} value={v} dir={dir} disabled={disabled} aria-label={label} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
      {max ? <small className={`a-count${n > max ? ' a-bad' : ''}`} aria-live="polite">{n} / {max}{n > max ? ' - Google may cut it short' : ''}</small> : null}
    </>
  );
}
