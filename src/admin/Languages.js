// Languages (spec F 8, docs/04_I18N.md "Adding a language"): add (inactive), edit, switch on / off, reorder,
// delete. Completeness % shows how much is translated before switching on; the rest falls back to the default.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, Field, Loading, useAction, useAdmin, useCan, useLoad } from './ui';

const FIELDS = [
  { name: 'lang_code', label: 'Code (URL prefix)', required: true, help: '2-3 lower-case letters, e.g. te' },
  { name: 'name_en', label: 'Name in English', required: true }, { name: 'native_name', label: 'Native name', required: true },
  { name: 'switch_label', label: 'Switcher label', required: true }, { name: 'html_lang', label: 'html lang', required: true, help: 'e.g. te-IN' },
  { name: 'dir', label: 'Direction', type: 'select', options: ['ltr', 'rtl'], allowEmpty: false },
  { name: 'font_family', label: 'Google Font for this script', help: 'e.g. Noto Sans Telugu' },
  { name: 'sort_order', label: 'Order', type: 'number', step: '1' },
];

export default function Languages() {
  const list = useLoad('/languages');
  const { reloadLanguages } = useAdmin();
  const isAdmin = useCan('admin');
  const act = useAction();
  const [open, setOpen] = useState(null);

  const changed = () => { list.reload(); reloadLanguages(); };
  const toggle = (l) => act.run(async () => {
    await api.send('PUT', `/languages/${l.lang_code}`, { is_active: l.is_active ? 0 : 1 });
    changed();
  }, `${l.name_en} switched ${l.is_active ? 'off' : 'on'}`);
  const remove = (l) => window.confirm(`Delete ${l.name_en} and all its translations? This cannot be undone.`) && act.run(async () => {
    const r = await api.send('DELETE', `/languages/${l.lang_code}`);
    changed();
    return r;
  }, `${l.name_en} deleted`);

  return (
    <section>
      <h1>Languages</h1>
      <p className="a-muted">A new language starts switched off. Translate it (Translations, product Excel), check the percentage, then switch it on: it appears in the switcher and routes at once, with the default language for anything not translated.</p>
      {isAdmin && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => setOpen({ create: true })}>Add language</button></div>}
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Code</th><th>Name</th><th>Switcher</th><th>Font</th><th>Translated</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(list.data || []).map((l) => (
                <tr key={l.lang_code} className={l.is_active ? '' : 'a-off'}>
                  <td><code>{l.lang_code}</code></td>
                  <td>{l.name_en} · {l.native_name}{Number(l.is_default) === 1 && ' (default)'}</td>
                  <td>{l.switch_label}</td>
                  <td>{l.font_family || '-'}</td>
                  <td title={Object.entries(l.completeness.parts).map(([k, v]) => `${k}: ${v.have}/${v.total}`).join('\n')}>
                    <meter min="0" max="100" value={l.completeness.pct} /> {l.completeness.pct}% ({l.completeness.have}/{l.completeness.total})
                  </td>
                  <td>{l.is_active ? 'On' : 'Off'}</td>
                  <td className="a-row">
                    {isAdmin && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setOpen({ row: l })}>Edit</button>}
                    {isAdmin && Number(l.is_default) !== 1 && <button type="button" className="a-btn a-btn-sm" onClick={() => toggle(l)} disabled={act.busy}>{l.is_active ? 'Switch off' : 'Switch on'}</button>}
                    {isAdmin && Number(l.is_default) !== 1 && !l.is_active && <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={() => remove(l)} disabled={act.busy}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open && <LangEditor row={open.row} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); changed(); }} />}
    </section>
  );
}

function LangEditor({ row, onClose, onSaved }) {
  const act = useAction();
  const [v, setV] = useState(row ? { ...row } : { dir: 'ltr', sort_order: 99 });
  const save = () => act.run(async () => {
    const { completeness, brochure, is_default, is_active, lang_code, ...rest } = v; // eslint-disable-line no-unused-vars
    if (row) await api.send('PUT', `/languages/${row.lang_code}`, rest);
    else await api.send('POST', '/languages', { lang_code, ...rest });
    onSaved();
  });
  return (
    <Drawer title={row ? `Edit ${row.name_en}` : 'Add language (starts switched off)'} onClose={onClose}
      footer={<button type="button" className="a-btn" onClick={save} disabled={act.busy}>{row ? 'Save' : 'Add'}</button>}>
      {act.note}
      <div className="a-grid2">
        {FIELDS.map((f) => (
          <Field key={f.name} def={f.name === 'lang_code' && row ? { ...f, type: 'readonly' } : f} value={v[f.name]} onChange={(x) => setV({ ...v, [f.name]: x })} />
        ))}
      </div>
    </Drawer>
  );
}
