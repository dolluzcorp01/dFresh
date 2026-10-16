// Settings (spec F 10, admin): every site_settings row with its description, in sections; the public flag is shown as
// a badge, not editable here (a secret must never become public by a click). Typed values are pending until Save
// (Save / Cancel on the row), checked with the API's own rules (shared/settingRules.js); whatsapp_number follows
// whatsapp_display. The lead sheet ID gets "Open sheet" and a read-only "Test connection". share_image / about_image: preview + Upload /
// Remove (typed values are refused by the server); door_home_product / door_biz_product: the photo product picker.
// mail_logo_url also gets a live preview on the e-mail's ink header (the typed URL, or the built-in logo when
// empty), the server's last check of the saved URL, and "Send test mail" (MAIL_TEST_TO locally, the signed-in
// admin's own e-mail in production). Saving a URL is refused by the server unless it passes the check.
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { API_BASE, mediaUrl } from '../utils/api';
import { InfoCard, Loading, fmtDate, useAction, useConfirm, useLeaveGuard, useLoad } from './ui';
import { ProductSelect } from './ProductSelect';
import { DERIVED, checkSetting, whatsappNumber } from '../shared/settingRules';

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const BUILTIN = `${API_BASE}/api/dfresh/admin/mail-logo/builtin.png`;
const CHECK_TEXT = { ok: 'Checked: works, mails use it.', failing: 'Not reachable: mails use the built-in logo.', unchecked: 'Not checked yet.', off: 'Empty: mails use the built-in logo.' };
// Picture settings: upload + preview instead of a typed path. empty = what the site shows without one.
const PICTURES = {
  share_image: { accept: 'image/jpeg,image/png', button: 'Upload JPG / PNG (1200 x 630)', width: 240, height: 126, empty: '/media/logo/dfresh-logo-tagline-on-light.png', emptyText: 'Empty: links show the dFresh logo.' },
  about_image: { accept: 'image/jpeg,image/png,image/webp', button: 'Upload JPG / PNG / WebP', width: 240, height: 100, empty: null, emptyText: 'Empty: the About section shows no photo.' },
};
const PRODUCT_PICKERS = ['door_home_product', 'door_biz_product'];

// Sections, in this order; a setting not listed here shows under "Other".
const SECTIONS = [
  ['Company', ['company_name', 'cin', 'gstin']],
  ['Contact', ['office_phone', 'public_email', 'whatsapp_display', 'whatsapp_number']],
  ['Home page', ['about_image', 'door_home_product', 'door_biz_product']],
  ['Sharing and SEO', ['share_image', 'ga4_measurement_id']],
  ['E-mail', ['mail_logo_url', 'lead_email', 'mail_from', 'mail_from_name']],
  ['Integrations', ['gsheet_spreadsheet_id']],
];

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
  // typed values are pending (row highlighted, Save / Cancel on the row) until saved; leaving the page asks first
  const [pending, setPending] = useState({}); // key -> typed value
  const setValue = (s, v) => setPending((p) => {
    const n = { ...p };
    if (v === (s.setting_value || '')) delete n[s.setting_key]; else n[s.setting_key] = v;
    return n;
  });
  const drop = (key) => setPending((p) => { const n = { ...p }; delete n[key]; return n; });
  useLeaveGuard(Object.keys(pending).length > 0);
  const save = (s) => {
    const { value } = checkSetting(s.setting_key, pending[s.setting_key]);
    return act.run(async () => {
      await api.send('PUT', `/settings/${s.setting_key}`, { value });
      drop(s.setting_key);
      list.reload();
    }, `${s.setting_key} saved`);
  };

  const rows = list.data || [];
  const byKey = new Map(rows.map((r) => [r.setting_key, r]));
  const listed = new Set(SECTIONS.flatMap(([, keys]) => keys));
  const sections = [...SECTIONS.map(([title, keys]) => [title, keys.map((k) => byKey.get(k)).filter(Boolean)]),
    ['Other', rows.filter((r) => !listed.has(r.setting_key))]].filter(([, items]) => items.length);
  const valueOf = (key) => (key in pending ? pending[key] : ((byKey.get(key) || {}).setting_value || ''));

  return (
    <section>
      <h1>Settings</h1>
      <InfoCard title="Addresses are not set here">
        <ul>
          <li>Office and godown names and addresses: Translations, group Contact details (<code>c_office</code>, <code>c_office_a</code>, <code>c_godown</code>, <code>c_godown_a</code>), one text per language.</li>
          <li>That one copy is used in the contact section, the footer, the Google Maps search and Google business data.</li>
          <li>The footer company line is built from <code>company_name</code>, <code>cin</code> and <code>gstin</code> below.</li>
        </ul>
      </InfoCard>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-settings">
            <colgroup><col className="a-set-key" /><col /><col className="a-set-pub" /><col className="a-set-act" /></colgroup>
            <thead><tr><th>Setting</th><th>Value</th><th>Visibility</th><th /></tr></thead>
            {sections.map(([title, items]) => (
              <tbody key={title}>
                <tr className="a-group"><th colSpan={4}>{title}</th></tr>
                {items.map((s) => (
                  <Row key={s.setting_key} s={s} act={act} cards={cards} onSaved={list.reload}
                    value={valueOf(s.setting_key)} pending={s.setting_key in pending}
                    derivedFrom={DERIVED[s.setting_key] ? valueOf(DERIVED[s.setting_key]) : null}
                    onChange={(v) => setValue(s, v)} onSave={() => save(s)} onCancel={() => drop(s.setting_key)} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Loading>
    </section>
  );
}

function Row({ s, act, cards, onSaved, value: v, pending, derivedFrom, onChange: setV, onSave, onCancel }) {
  const picture = PICTURES[s.setting_key];
  const derived = DERIVED[s.setting_key];
  const { error } = checkSetting(s.setting_key, v);
  let control;
  if (picture) {
    control = <Picture s={s} cfg={picture} act={act} onSaved={onSaved} />;
  } else if (derived) {
    // computed from the WhatsApp display number (live while that one is being edited)
    const next = whatsappNumber(derivedFrom);
    control = (
      <>
        <input type="text" value={next || (s.setting_value || '')} readOnly disabled aria-label={s.setting_key} />
        <small className="a-muted">Follows {derived}: digits only, with 91 (used for the WhatsApp links).</small>
      </>
    );
  } else if (PRODUCT_PICKERS.includes(s.setting_key)) {
    control = (
      <>
        <span id={`set-${s.setting_key}-l`} className="a-sr">{s.setting_key}</span>
        <ProductSelect id={`set-${s.setting_key}`} labelledBy={`set-${s.setting_key}-l`} products={cards} value={v || null} allowEmpty={false}
          onChange={(x) => setV(x || '')} />
      </>
    );
  } else if (v.length > 60 || v.includes('\n')) {
    control = <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} aria-label={s.setting_key} aria-invalid={Boolean(error) || undefined} />;
  } else {
    control = <input type="text" value={v} onChange={(e) => setV(e.target.value)} aria-label={s.setting_key} aria-invalid={Boolean(error) || undefined} />;
  }
  return (
    <tr id={`setting-${s.setting_key}`} className={pending ? 'a-pending' : undefined}>
      <td><code>{s.setting_key}</code><br /><small className="a-muted">{s.description}</small></td>
      <td className="a-set-val">
        {control}
        {pending && error && <small className="a-bad" role="alert">{error}</small>}
        {s.updated_by && !pending && <small className="a-muted">Changed {fmtDate(s.updated_at)} by {s.updated_by}</small>}
        {s.setting_key === 'mail_logo_url' && <MailLogo value={v} act={act} />}
        {s.setting_key === 'gsheet_spreadsheet_id' && <SheetCheck value={v} />}
      </td>
      <td><span className={`a-status ${Number(s.is_public) ? 'a-status-pub' : 'a-status-off'}`}>{Number(s.is_public) ? 'Public' : 'Server only'}</span></td>
      <td>
        {pending && !picture && (
          <span className="a-pending-btns">
            <button type="button" className="a-btn a-btn-sm" onClick={onSave} disabled={act.busy || Boolean(error)}>Save</button>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={onCancel} disabled={act.busy}>Cancel</button>
          </span>
        )}
      </td>
    </tr>
  );
}

// The lead sheet: an "Open sheet" link and "Test connection", which only reads the sheet's title and tab names.
function SheetCheck({ value }) {
  const [state, setState] = useState(null); // { busy } | { info } | { error }
  const { value: id, error } = checkSetting('gsheet_spreadsheet_id', value);
  if (!id || error) return null;
  const test = () => {
    setState({ busy: true });
    api.get(`/settings/gsheet-check?id=${encodeURIComponent(id)}`).then((info) => setState({ info }), (err) => setState({ error: err.message }));
  };
  const info = state && state.info && state.info.id === id ? state.info : null;
  return (
    <div className="a-sheetcheck">
      <span className="a-row">
        <a className="a-btn a-btn-sm a-btn-ghost" href={`https://docs.google.com/spreadsheets/d/${id}/edit`} target="_blank" rel="noopener noreferrer">Open sheet</a>
        <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={test} disabled={state && state.busy}>{state && state.busy ? 'Testing...' : 'Test connection'}</button>
      </span>
      {info && (
        <small>
          <span className={`a-status ${info.kind === 'LIVE' ? 'a-status-on' : 'a-status-test'}`}>{info.kind}</span>{' '}
          <b>{info.title}</b> · tabs: {info.tabs.join(', ')} · sync {info.syncEnabled ? 'on' : 'off (GSHEET_ENABLED)'}
        </small>
      )}
      {state && state.error && <small className="a-bad" role="alert">{state.error}</small>}
    </div>
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
  const confirm = useConfirm();
  const remove = async () => {
    if (!(await confirm({ title: 'Remove this picture?', message: cfg.emptyText, action: 'Remove', danger: true }))) return;
    act.run(async () => { await api.send('PUT', `/settings/${s.setting_key}`, { value: '' }); onSaved(); }, `${s.setting_key} removed`);
  };
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
