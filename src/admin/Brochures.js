// Brochures (spec F 9): one PDF per language (<= 5 MB, checked as a real PDF), replace, download, delete.
// A language without its own brochure gets the default language's.
import { api } from './adminApi';
import { Loading, fmtDate, useAction, useAdmin, useCan, useLoad } from './ui';

export default function Brochures() {
  const list = useLoad('/brochures');
  const { languages } = useAdmin();
  const canEdit = useCan('editor');
  const act = useAction();
  const byLang = new Map((list.data || []).map((b) => [b.lang_code, b]));

  const upload = (lang, file) => act.run(async () => { await api.upload(`/brochures/${lang}`, file); list.reload(); }, `${lang} brochure saved`);
  const remove = (lang) => window.confirm(`Delete the ${lang} brochure?`) && act.run(async () => { await api.send('DELETE', `/brochures/${lang}`); list.reload(); }, 'Deleted');

  return (
    <section>
      <h1>Brochures</h1>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Language</th><th>File</th><th>Size</th><th>Uploaded</th><th /></tr></thead>
            <tbody>
              {languages.map((l) => {
                const b = byLang.get(l.lang_code);
                return (
                  <tr key={l.lang_code}>
                    <td>{l.name_en} <code>{l.lang_code}</code></td>
                    <td>{b ? <>{b.file_name}{!b.on_disk && <span className="a-bad"> (file missing on disk)</span>}</> : <span className="a-muted">none - visitors get the default language's</span>}</td>
                    <td>{b ? `${b.file_size_kb} KB` : ''}</td>
                    <td>{b ? `${fmtDate(b.uploaded_at)} by ${b.uploaded_by || '-'}` : ''}</td>
                    <td className="a-row">
                      {b && b.on_disk && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => act.run(() => api.download(`/brochures/${l.lang_code}/file`, b.file_name))}>Download</button>}
                      {canEdit && (
                        <label className="a-btn a-btn-sm a-file">{b ? 'Replace' : 'Upload'} PDF
                          <input type="file" accept="application/pdf" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(l.lang_code, f); }} />
                        </label>
                      )}
                      {canEdit && b && <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={() => remove(l.lang_code)}>Delete</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Loading>
    </section>
  );
}
