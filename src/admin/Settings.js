// Settings (spec F 10, admin): every site_settings row with its description; the public flag is shown, not
// editable here (a secret must never become public by a click).
import { useState } from 'react';
import { api } from './adminApi';
import { Loading, fmtDate, useAction, useLoad } from './ui';

export default function Settings() {
  const list = useLoad('/settings');
  const act = useAction();
  return (
    <section>
      <h1>Settings</h1>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Setting</th><th>Value</th><th>Public</th><th /></tr></thead>
            <tbody>{(list.data || []).map((s) => <Row key={s.setting_key} s={s} act={act} onSaved={list.reload} />)}</tbody>
          </table>
        </div>
      </Loading>
    </section>
  );
}

function Row({ s, act, onSaved }) {
  const [v, setV] = useState(s.setting_value || '');
  const dirty = v !== (s.setting_value || '');
  const save = () => act.run(async () => { await api.send('PUT', `/settings/${s.setting_key}`, { value: v }); onSaved(); }, `${s.setting_key} saved`);
  return (
    <tr>
      <td><code>{s.setting_key}</code><br /><small className="a-muted">{s.description}</small></td>
      <td>
        {v.length > 60 || v.includes('\n')
          ? <textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} aria-label={s.setting_key} />
          : <input type="text" value={v} onChange={(e) => setV(e.target.value)} aria-label={s.setting_key} />}
        {s.updated_by && <small className="a-muted">Changed {fmtDate(s.updated_at)} by {s.updated_by}</small>}
      </td>
      <td>{Number(s.is_public) ? 'Yes (on the site)' : 'No'}</td>
      <td>{dirty && <button type="button" className="a-btn a-btn-sm" onClick={save} disabled={act.busy}>Save</button>}</td>
    </tr>
  );
}
