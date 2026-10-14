// Settings (spec F 10, admin): every site_settings row with its description; the public flag is shown, not
// editable here (a secret must never become public by a click). share_image / about_image: preview + Upload /
// Remove (typed values are refused by the server); door_home_product / door_biz_product: the photo product picker.
// mail_logo_url also gets a live preview on the e-mail's ink header (the typed URL, or the built-in logo when
// empty), the server's last check of the saved URL, and "Send test mail" (MAIL_TEST_TO locally, the signed-in
// admin's own e-mail in production). Saving a URL is refused by the server unless it passes the check.
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { API_BASE, mediaUrl } from '../utils/api';
import { Loading, Notice, fmtDate, useAction, useLoad } from './ui';
import { ProductSelect } from './ProductSelect';

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const BUILTIN = `${API_BASE}/api/dfresh/admin/mail-logo/builtin.png`;
const CHECK_TEXT = { ok: 'Checked: works, mails use it.', failing: 'Not reachable: mails use the built-in logo.', unchecked: 'Not checked yet.', off: 'Empty: mails use the built-in logo.' };
// Picture settings: upload + preview instead of a typed path. empty = what the site shows without one.
const PICTURES = {
  share_image: { accept: 'image/jpeg,image/png', button: 'Upload JPG / PNG (1200 x 630)', width: 240, height: 126, empty: '/media/logo/dfresh-logo-tagline-on-light.png', emptyText: 'Empty: links show the dFresh logo.' },
  about_image: { accept: 'image/jpeg,image/png,image/webp', button: 'Upload JPG / PNG / WebP', width: 240, height: 100, empty: null, emptyText: 'Empty: the About section shows no photo.' },
};
const PRODUCT_PICKERS = ['door_home_product', 'door_biz_product'];

export default function Settings() {
  const list = useLoad('/settings');
  const products = useLoad('/products');
  const act = useAction();
  const cards = (products.data || []).filter((p) => !p.variant_of);
  // #setting-<key> (dashboard links): scroll to that row once the list is there
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const el = id && list.data ? document.getElementById(id) : null;
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('a-target'); }
  }, [list.data]);
  return (
    <section>
      <h1>Settings</h1>
      <Notice>
        Addresses are not set here: the office and godown names and addresses are edited in Translations, group Contact
        details (<code>c_office</code>, <code>c_office_a</code>, <code>c_godown</code>, <code>c_godown_a</code>), one text per language. That one copy is used in the
        contact section, the footer, the Google Maps search and Google business data. The footer company line is built
        from <code>company_name</code>, <code>cin</code> and <code>gstin</code> below.
      </Notice>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Setting</th><th>Value</th><th>Public</th><th /></tr></thead>
            <tbody>{(list.data || []).map((s) => <Row key={s.setting_key} s={s} act={act} cards={cards} onSaved={list.reload} />)}</tbody>
          </table>
        </div>
      </Loading>
    </section>
  );
}

function Row({ s, act, cards, onSaved }) {
  const [v, setV] = useState(s.setting_value || '');
  const dirty = v !== (s.setting_value || '');
  const save = () => act.run(async () => { await api.send('PUT', `/settings/${s.setting_key}`, { value: v }); onSaved(); }, `${s.setting_key} saved`);
  const picture = PICTURES[s.setting_key];
  let control;
  if (picture) {
    control = <Picture s={s} cfg={picture} act={act} onSaved={onSaved} />;
  } else if (PRODUCT_PICKERS.includes(s.setting_key)) {
    control = (
      <>
        <span id={`set-${s.setting_key}-l`} className="a-sr">{s.setting_key}</span>
        <ProductSelect id={`set-${s.setting_key}`} labelledBy={`set-${s.setting_key}-l`} products={cards} value={v || null} allowEmpty={false}
          onChange={(x) => setV(x || '')} />
      </>
    );
  } else if (v.length > 60 || v.includes('\n')) {
    control = <textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} aria-label={s.setting_key} />;
  } else {
    control = <input type="text" value={v} onChange={(e) => setV(e.target.value)} aria-label={s.setting_key} />;
  }
  return (
    <tr id={`setting-${s.setting_key}`}>
      <td><code>{s.setting_key}</code><br /><small className="a-muted">{s.description}</small></td>
      <td>
        <div>{control}</div>
        {s.updated_by && <small className="a-muted">Changed {fmtDate(s.updated_at)} by {s.updated_by}</small>}
        {s.setting_key === 'mail_logo_url' && <MailLogo value={v} act={act} />}
      </td>
      <td>{Number(s.is_public) ? 'Yes (on the site)' : 'No'}</td>
      <td>{dirty && !picture && <button type="button" className="a-btn a-btn-sm" onClick={save} disabled={act.busy}>Save</button>}</td>
    </tr>
  );
}

// Preview of the saved picture (or what the site shows without one), Upload, Remove.
function Picture({ s, cfg, act, onSaved }) {
  const value = s.setting_value || '';
  const src = value ? `/media/${value}` : cfg.empty;
  const upload = (file) => act.run(async () => {
    const r = await api.upload(`/settings/${s.setting_key}/image`, file);
    onSaved();
    return r;
  }).then((r) => r && act.setMsg({ kind: 'ok', text: `${s.setting_key} saved: ${Math.round(r.original_bytes / 1024)} KB in -> ${r.width} x ${r.height}, ${Math.round(r.bytes / 1024)} KB` }));
  const remove = () => window.confirm('Remove this picture?') && act.run(async () => { await api.send('PUT', `/settings/${s.setting_key}`, { value: '' }); onSaved(); }, `${s.setting_key} removed`);
  return (
    <div className="a-picture">
      {src
        ? <img src={mediaUrl(src)} alt={`${s.setting_key} preview`} width={cfg.width} height={cfg.height} />
        : <span className="a-picture-none">No photo</span>}
      <small className="a-muted">{value ? <code>{value}</code> : cfg.emptyText}</small>
      <span className="a-row">
        <label className="a-btn a-btn-sm a-btn-ghost a-file">{act.busy ? 'Uploading...' : cfg.button}
          <input type="file" accept={cfg.accept} disabled={act.busy} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); }} />
        </label>
        {value && <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={remove} disabled={act.busy}>Remove</button>}
      </span>
    </div>
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
