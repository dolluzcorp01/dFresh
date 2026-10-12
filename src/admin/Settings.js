// Settings (spec F 10, admin): every site_settings row with its description; the public flag is shown, not
// editable here (a secret must never become public by a click).
// mail_logo_url also gets a live preview on the e-mail's ink header (the typed URL, or the built-in logo when
// empty), the server's last check of the saved URL, and "Send test mail" (MAIL_TEST_TO locally, the signed-in
// admin's own e-mail in production). Saving a URL is refused by the server unless it passes the check.
import { useState } from 'react';
import { api } from './adminApi';
import { API_BASE } from '../utils/api';
import { Loading, fmtDate, useAction, useLoad } from './ui';

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const BUILTIN = `${API_BASE}/api/dfresh/admin/mail-logo/builtin.png`;
const CHECK_TEXT = { ok: 'Checked: works, mails use it.', failing: 'Not reachable: mails use the built-in logo.', unchecked: 'Not checked yet.', off: 'Empty: mails use the built-in logo.' };

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
        {s.setting_key === 'mail_logo_url' && <MailLogo value={v} act={act} />}
      </td>
      <td>{Number(s.is_public) ? 'Yes (on the site)' : 'No'}</td>
      <td>{dirty && <button type="button" className="a-btn a-btn-sm" onClick={save} disabled={act.busy}>Save</button>}</td>
    </tr>
  );
}

// Preview of the e-mail header (ink, 4px gold rule, logo 62x34) + the server's check + a test mail.
function MailLogo({ value, act }) {
  const status = useLoad('/mail-logo');
  const [img, setImg] = useState(null); // { src, w, h } of the loaded preview, or { src, error }
  const typed = value.trim();
  const src = typed ? (HTTPS.test(typed) ? typed : '') : BUILTIN;
  const st = status.data;
  const test = () => act.run(async () => {
    const r = await api.send('POST', '/mail-logo/test-mail');
    return r;
  }, 'Test mail sent (check the inbox; the mail says which logo it used)');
  return (
    <div className="a-maillogo">
      <div className="a-maillogo-head" aria-label="E-mail header preview">
        {src
          ? <img src={src} alt="dFresh" width="62" height="34" onLoad={(e) => setImg({ src, w: e.target.naturalWidth, h: e.target.naturalHeight })} onError={() => setImg({ src, error: true })} />
          : <span>Not an https:// URL</span>}
      </div>
      <small className="a-muted">
        {typed ? 'Preview of the typed URL' : 'Built-in logo (field empty)'}
        {img && img.src === src && (img.error ? ' - the image did not load' : ` - ${img.w}x${img.h} px`)}
        {st && st.url && ` | Saved URL: ${CHECK_TEXT[st.state]}${st.reason ? ` (${st.reason})` : ''}`}
      </small>
      <button type="button" className="a-btn a-btn-sm" onClick={test} disabled={act.busy}>Send test mail</button>
    </div>
  );
}
