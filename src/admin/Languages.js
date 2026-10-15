// Languages (spec F 8, docs/04_I18N.md "Adding a language"): add (inactive), edit, switch on / off, reorder,
// delete. Completeness % shows how much is translated before switching on; the rest falls back to the default.
// Script: picked from the server's font catalog (fonts/scripts.json); it sets the font and the text direction.
// The server builds that font for the language's text by itself (font-manager.js); the Font column shows it:
// ready (subset size) / rebuilding / using full font (a rebuild failed) / - while the language is off.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, Field, Loading, useAction, useAdmin, useCan, useLoad } from './ui';

const FIELDS = [
  { name: 'lang_code', label: 'Code (URL prefix)', required: true, help: '2-3 lower-case letters, e.g. te' },
  { name: 'name_en', label: 'Name in English', required: true }, { name: 'native_name', label: 'Native name', required: true },
  { name: 'switch_label', label: 'Switcher label', required: true }, { name: 'html_lang', label: 'html lang', required: true, help: 'e.g. te-IN' },
  { name: 'sort_order', label: 'Order', type: 'number', step: '1' },
];

const FONT_TEXT = { ready: 'ready', rebuilding: 'rebuilding...', full: 'using full font', bundled: 'ready (built in)' };
const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

function FontCell({ l }) {
  if (!l.font_family) return '-';
  const f = l.font;
  const state = f ? FONT_TEXT[f.status] || f.status : 'built when switched on';
  const size = f && f.status === 'ready' && f.subsetSize ? `, ${kb(f.subsetSize)} (${f.characters} characters)` : '';
  return (
    <span title={f && f.error ? f.error : undefined} className={f && f.status === 'full' ? 'a-bad' : undefined}>
      {l.script || l.font_family}: {state}{size}
    </span>
  );
}

export default function Languages() {
  const list = useLoad('/languages');
  const fonts = useLoad('/fonts');
  const { reloadLanguages } = useAdmin();
  const isAdmin = useCan('admin');
  const act = useAction();
  const [open, setOpen] = useState(null);

  const changed = () => { list.reload(); reloadLanguages(); };
  const toggle = (l) => (!l.is_active || window.confirm(`Switch off ${l.name_en}? It disappears from the site's language switcher.`)) && act.run(async () => {
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
      <div className="a-card a-howto">
        <h2>How to add a language</h2>
        <ol>
          <li>Click Add language and pick its script. The script sets the font and the text direction.</li>
          <li>Translate it in Translations and in the product Excel.</li>
          <li>When the Translated % is high enough, click Switch on. It appears in the site&apos;s language switcher at once.</li>
        </ol>
        <p className="a-muted">Anything not translated shows in English. Fonts are prepared automatically, no developer needed.</p>
      </div>
      {isAdmin && <div className="a-toolbar"><button type="button" className="a-btn" onClick={() => setOpen({ create: true })}>Add language</button></div>}
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className={`a-table${isAdmin ? ' a-hover' : ''}`}>
            <thead><tr><th>Code</th><th>Name</th><th>Switcher</th><th>Script / font</th><th>Translated</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(list.data || []).map((l) => (
                // the whole row opens the drawer (as on every admin list); the buttons in it do not
                <tr key={l.lang_code} className={l.is_active ? '' : 'a-off'}
                  {...(isAdmin ? { onClick: () => setOpen({ row: l }), tabIndex: 0, onKeyDown: (e) => e.key === 'Enter' && e.target === e.currentTarget && setOpen({ row: l }) } : {})}>
                  <td><code>{l.lang_code}</code></td>
                  <td>{l.name_en} · {l.native_name}{Number(l.is_default) === 1 && ' (default)'}</td>
                  <td>{l.switch_label}</td>
                  <td><FontCell l={l} /></td>
                  <td title={Object.entries(l.completeness.parts).map(([k, v]) => `${k}: ${v.have}/${v.total}`).join('\n')}>
                    <meter min="0" max="100" value={l.completeness.pct} /> {l.completeness.pct}% ({l.completeness.have}/{l.completeness.total})
                  </td>
                  <td>{l.is_active ? 'On' : 'Off'}</td>
                  <td className="a-row">
                    {isAdmin && Number(l.is_default) !== 1 && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={(e) => { e.stopPropagation(); toggle(l); }} disabled={act.busy}>{l.is_active ? 'Switch off' : 'Switch on'}</button>}
                    {isAdmin && Number(l.is_default) !== 1 && !l.is_active && <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={(e) => { e.stopPropagation(); remove(l); }} disabled={act.busy}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open && <LangEditor row={open.row} scripts={(fonts.data && fonts.data.scripts) || []} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); changed(); }} />}
    </section>
  );
}

function LangEditor({ row, scripts, onClose, onSaved }) {
  const act = useAction();
  const [v, setV] = useState(row ? { ...row } : { sort_order: 99, script: '' });
  const pick = scripts.find((s) => s.script === v.script);
  const save = () => act.run(async () => {
    if (!v.script) throw new Error('Pick the script the language is written in');
    const { completeness, brochure, is_default, is_active, lang_code, font, font_family, dir, ...rest } = v; // eslint-disable-line no-unused-vars
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
        <Field
          def={{ name: 'script', label: 'Script (sets the font and the direction)', type: 'select', options: scripts.map((s) => s.script), allowEmpty: true, required: true }}
          value={v.script || ''}
          onChange={(x) => setV({ ...v, script: x })}
        />
        <p className="a-muted">{pick ? `Font: ${pick.family} · direction ${pick.dir === 'rtl' ? 'right to left' : 'left to right'}. The server prepares it for this language's text by itself.` : 'The font and text direction follow from the script.'}</p>
      </div>
    </Drawer>
  );
}
