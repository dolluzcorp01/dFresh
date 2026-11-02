// Brochures (spec F 9): one PDF per language (<= 5 MB, checked as a real PDF), replace, download, delete.
// A language without its own brochure gets the default language's.
import { api } from './adminApi';
import { Loading, PageHead, Table, UploadButton, fmtDate, useAction, useAdmin, useCan, useConfirm, useLoad, useUpload } from './ui';

export default function Brochures() {
  const list = useLoad('/brochures');
  const { languages } = useAdmin();
  const canEdit = useCan('content', 'create'); // upload / replace
  const canDelete = useCan('content', 'delete');
  const act = useAction();
  const byLang = new Map((list.data || []).map((b) => [b.lang_code, b]));

  const up = useUpload();
  const upload = (lang, file) => act.run(async () => { await up.send(lang, `/brochures/${lang}`, file); list.reload(); }, `${lang} brochure saved`);
  const confirm = useConfirm();
  const remove = async (lang) => {
    if (!(await confirm({ title: `Delete the ${lang.toUpperCase()} brochure?`, message: 'Visitors asking for it in this language get no download until a new PDF is uploaded.', action: 'Delete', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/brochures/${lang}`); list.reload(); }, 'Deleted');
  };

  return (
    <section>
      <PageHead sub="The PDF brochure visitors download, one per language." />
      {act.note}
      <Loading state={list}>
        <Table label="Brochures" rows={languages} rowKey={(l) => l.lang_code} columns={[
          { key: 'lang', label: 'Language', render: (l) => <>{l.name_en} <code>{l.lang_code}</code></> },
          { key: 'file', label: 'File', render: (l) => { const b = byLang.get(l.lang_code); return b ? <>{b.file_name}{!b.on_disk && <span className="a-bad"> (file missing on disk)</span>}</> : <span className="a-muted">none - visitors get the default language&apos;s</span>; } },
          { key: 'size', label: 'Size', render: (l) => { const b = byLang.get(l.lang_code); return b ? `${b.file_size_kb} KB` : ''; } },
          { key: 'up', label: 'Uploaded', render: (l) => { const b = byLang.get(l.lang_code); return b ? `${fmtDate(b.uploaded_at)} by ${b.uploaded_by || '-'}` : ''; } },
          { key: 'act', label: '', render: (l) => {
            const b = byLang.get(l.lang_code);
            return (
              <span className="a-row">
                {b && b.on_disk && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => act.run(() => api.download(`/brochures/${l.lang_code}/file`, b.file_name))}>Download</button>}
                {canEdit && (
                  <UploadButton upload={up} uploadKey={l.lang_code} label={`${b ? 'Replace' : 'Upload'} PDF`} accept="application/pdf"
                    className="a-btn a-btn-sm" disabled={act.busy} onFile={(f) => upload(l.lang_code, f)} />
                )}
                {canDelete && b && <button type="button" className="a-btn a-btn-sm a-btn-danger" disabled={act.busy} onClick={() => remove(l.lang_code)}>Delete</button>}
              </span>
            );
          } },
        ]} />
      </Loading>
    </section>
  );
}
