// Site settings rows (spec F 10, admin). Phase 24 (the owner's field map) split the old Settings page into the Website
// pages that use them: SettingsTable shows a chosen set of site_settings rows (Home doors, Google and sharing, Site
// settings, Brochures) with their description; the public flag is a badge, not editable here (a secret must never become
// public by a click). Typed values are pending until Save (Save / Cancel on the row), checked with the API's own rules
// (shared/settingRules.js). The lead sheet ID gets "Open sheet" and a read-only "Test connection". share_image /
// about_image: preview + Upload / Remove (typed values are refused by the server). mail_logo_url also gets a live
// preview on the e-mail's ink header, the server's last check of the saved URL, and "Send test mail".
// Phase 24: the leads e-mail and the lead sheet wait for a second Admin (the row shows what waits); the mail sender is
// picked from the verified SendGrid senders, never typed; indexing off asks first; two-step sign-in is switched on
// Admin > Users and security (TwoStepSwitch) and shown read only elsewhere.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { API_BASE, mediaUrl } from '../utils/api';
import { Loading, Pill, UploadButton, fmtDate, useAction, useConfirm, useHashScroll, useLeaveGuard, useLoad, useUpload } from './ui';
import { ProductSelect } from './ProductSelect';
import { DERIVED, checkSetting, whatsappNumber } from '../shared/settingRules';
import { ABOUT, DEFAULT_FOCUS, formatFocus, parseFocus, visibleWindow } from '../shared/photoFocus';

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const BUILTIN = `${API_BASE}/api/dfresh/admin/mail-logo/builtin.png`;
const CHECK_TEXT = { ok: 'Checked: works, mails use it.', failing: 'Not reachable: mails use the built-in logo.', unchecked: 'Not checked yet.', off: 'Empty: mails use the built-in logo.' };
// Picture settings: upload + preview instead of a typed path. empty = what the site shows without one.
const PICTURES = {
  share_image: { accept: 'image/jpeg,image/png', button: 'Upload JPG / PNG (1200 x 630)', width: 240, height: 126, empty: '/media/logo/dfresh-logo-tagline-on-light.png', emptyText: 'Empty: links show the dFresh logo.' },
  about_image: { accept: 'image/jpeg,image/png,image/webp', button: 'Upload JPG / PNG / WebP', width: 240, height: 100, empty: null, emptyText: 'Empty: the About section shows no photo.' },
};
const PRODUCT_PICKERS = ['door_home_product', 'door_biz_product'];
// phase 24: changes that wait for a second Admin (Admin_server.js SECOND_ADMIN_SETTINGS)
const SECOND_ADMIN = ['lead_email', 'gsheet_spreadsheet_id', 'two_step_login'];

/**
 * The given site_settings rows in sections: sections = [[title, [keys]]]. A row the server does not have is left out.
 * twoStep: 'switch' (Users and security) or 'show' (read only, with a link there).
 */
export function SettingsTable({ sections: wanted, twoStep = 'show' }) {
  const list = useLoad('/settings');
  const products = useLoad(wanted.some(([, keys]) => keys.some((k) => PRODUCT_PICKERS.includes(k))) ? '/products' : null);
  const act = useAction();
  const cards = (products.data || []).filter((p) => !p.variant_of);
  // #setting-<key> (dashboard links): scroll there once the list is there
  useHashScroll(Boolean(list.data));
  // typed values are pending (row highlighted, Save / Cancel on the row) until saved; leaving the page asks first
  const [pending, setPending] = useState({}); // key -> typed value
  const setValue = (s, v) => setPending((p) => {
    const n = { ...p };
    if (v === (s.setting_value || '')) delete n[s.setting_key]; else n[s.setting_key] = v;
    return n;
  });
  const drop = (key) => setPending((p) => { const n = { ...p }; delete n[key]; return n; });
  useLeaveGuard(Object.keys(pending).length > 0);
  const confirm = useConfirm();
  // mail_from: the server asks SendGrid first. When SendGrid cannot be reached it answers code 'sender_unchecked'
  // with the warning; saving then needs a yes in the dialog (sent again with confirmUnverified).
  const save = (s) => {
    const { value } = checkSetting(s.setting_key, pending[s.setting_key]);
    return act.run(async () => {
      let r;
      try {
        r = await api.send('PUT', `/settings/${s.setting_key}`, { value });
      } catch (err) {
        if (!(err.data && err.data.code === 'sender_unchecked')) throw err;
        const yes = await confirm({ title: 'Save an unchecked sender?', message: err.message, action: 'Save anyway', danger: true });
        if (!yes) return; // still pending, nothing saved
        r = await api.send('PUT', `/settings/${s.setting_key}`, { value, confirmUnverified: true });
      }
      drop(s.setting_key);
      list.reload();
      if (r && r.waiting) act.setMsg({ kind: 'info', text: r.message });
      else act.setMsg({ kind: 'ok', text: `${s.setting_key} saved` });
    });
  };

  const rows = list.data || [];
  const byKey = new Map(rows.map((r) => [r.setting_key, r]));
  const sections = wanted.map(([title, keys]) => [title, keys.map((k) => byKey.get(k)).filter(Boolean)]).filter(([, items]) => items.length);
  const valueOf = (key) => (key in pending ? pending[key] : ((byKey.get(key) || {}).setting_value || ''));

  return (
    <>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-settings">
            <colgroup><col className="a-set-key" /><col /><col className="a-set-pub" /><col className="a-set-act" /></colgroup>
            <thead><tr><th>Setting</th><th>Value</th><th>Visibility</th><th /></tr></thead>
            {sections.map(([title, items]) => (
              <tbody key={title} id={`cs-s-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                {sections.length > 1 && <tr className="a-group"><th colSpan={4}>{title}</th></tr>}
                {items.map((s) => (
                  <Row key={s.setting_key} s={s} act={act} cards={cards} onSaved={list.reload} twoStep={twoStep}
                    focus={FOCUS_OF[s.setting_key] && byKey.get(FOCUS_OF[s.setting_key]) ? {
                      value: valueOf(FOCUS_OF[s.setting_key]), pending: FOCUS_OF[s.setting_key] in pending,
                      onChange: (v) => setValue(byKey.get(FOCUS_OF[s.setting_key]), v),
                      onSave: () => save(byKey.get(FOCUS_OF[s.setting_key])), onCancel: () => drop(FOCUS_OF[s.setting_key]),
                    } : null}
                    value={valueOf(s.setting_key)} pending={s.setting_key in pending}
                    derivedFrom={DERIVED[s.setting_key] ? valueOf(DERIVED[s.setting_key]) : null}
                    onChange={(v) => setValue(s, v)} onSave={() => save(s)} onCancel={() => drop(s.setting_key)} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Loading>
    </>
  );
}

function Row({ s, act, cards, onSaved, value: v, pending, derivedFrom, onChange: setV, onSave, onCancel, focus, twoStep }) {
  const picture = PICTURES[s.setting_key];
  const derived = DERIVED[s.setting_key];
  const { error } = checkSetting(s.setting_key, v);
  let control;
  if (picture) {
    control = <Picture s={s} cfg={picture} act={act} onSaved={onSaved} focus={focus} />;
  } else if (s.setting_key === 'two_step_login') {
    control = twoStep === 'switch' ? <TwoStepSwitch s={s} act={act} onSaved={onSaved} /> : (
      <span className="a-switch-row">
        <strong>{String(s.setting_value || 'on').trim().toLowerCase() !== 'off' ? 'On' : 'Off'}</strong>
        <small className="a-muted">Read only here. Switched on <Link to="/admin/users#two-step">Admin &gt; Users and security</Link>; turning it off waits for a second Admin.</small>
      </span>
    );
  } else if (s.setting_key === 'brochure_download_enabled') {
    control = <OnOffSwitch s={s} act={act} onSaved={onSaved} label="Brochure download" />;
  } else if (s.setting_key === 'site_indexing') {
    // owner's note (field map row 91): a warning when turning it off
    control = <OnOffSwitch s={s} act={act} onSaved={onSaved} label="Show in Google (indexing)"
      offWarning={{ title: 'Hide the site from Google?', message: 'Google and other search engines are asked not to list dfresh.us. Pages already listed drop out over the next days, and new visitors cannot find the site by searching until you turn it back on.', action: 'Hide from Google' }} />;
  } else if (s.setting_key === 'mail_from') {
    control = <SenderPick value={v} saved={s.setting_value || ''} onChange={setV} />;
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
      <td><code>{s.setting_key}</code><br /><Hint text={s.description} empty={!(s.setting_value || '').trim()} /></td>
      <td className="a-set-val">
        {control}
        {pending && error && <small className="a-bad" role="alert">{error}</small>}
        {s.updated_by && !pending && <small className="a-muted">Changed {fmtDate(s.updated_at)} by {s.updated_by}</small>}
        {s.waiting && (
          <small className="a-waitline"><Pill tone="warn">Waiting for a second Admin</Pill>{' '}
            {s.setting_key === 'two_step_login' ? `Turn ${s.waiting.value}` : `New value: ${s.waiting.value || 'empty'}`} (asked by {s.waiting.by}). <Link to="/admin/approvals">Approvals</Link></small>
        )}
        {!s.waiting && SECOND_ADMIN.includes(s.setting_key) && s.setting_key !== 'two_step_login' && <small className="a-muted">A change waits for a second Admin before it is made.</small>}
        {s.setting_key === 'mail_logo_url' && <LogoHowTo />}
        {s.setting_key === 'mail_logo_url' && <MailLogo value={v} act={act} />}
        {s.setting_key === 'gsheet_spreadsheet_id' && <SheetCheck value={v} />}
      </td>
      <td><Pill tone={Number(s.is_public) ? 'info' : 'gray'}>{Number(s.is_public) ? 'Public' : 'Server only'}</Pill></td>
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

// A plain on / off setting: one click saves (PUT, admin only, audited by the server).
export function OnOffSwitch({ s, act, onSaved, label, offWarning }) {
  const confirm = useConfirm();
  const on = String(s.setting_value || 'on').trim().toLowerCase() !== 'off';
  const flip = async () => {
    if (on && offWarning && !(await confirm({ ...offWarning, cancel: 'Cancel', danger: true }))) return;
    run();
  };
  const run = () => act.run(async () => {
    await api.send('PUT', `/settings/${s.setting_key}`, { value: on ? 'off' : 'on' });
    onSaved();
    act.setMsg({ kind: 'ok', text: `${label} is ${on ? 'off' : 'on'}.` });
  });
  return (
    <span className="a-switch-row">
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="a-switch" onClick={flip} disabled={act.busy || Boolean(s.fixed_from)}>
        <span className="a-switch-knob" aria-hidden="true" />
      </button>
      <strong>{on ? 'On' : 'Off'}</strong>
      {s.fixed_from && <small className="a-muted">Read only. {s.fixed_from}.</small>}
    </span>
  );
}

// two_step_login: a switch, never a typed value. Off: asks first (danger), then saves. On: the server e-mails a code
// to the signed-in admin and the setting only changes once that code is typed here (Turn on); Cancel or no code =
// it stays off. The server reads the setting at the next sign-in; open sessions are not affected.
export function TwoStepSwitch({ s, act, onSaved }) {
  const confirm = useConfirm();
  const on = String(s.setting_value || 'on').trim().toLowerCase() !== 'off';
  const [sent, setSent] = useState(null); // { sentTo, minutes } while a code is waiting
  const [code, setCode] = useState('');
  useLeaveGuard(Boolean(sent));

  const turnOff = async () => {
    const yes = await confirm({
      title: 'Turn off two-step sign-in?',
      message: 'Sign in will need only the password. Anyone with a password can get into leads and settings. A second Admin must approve it before it goes off.',
      action: 'Ask to turn off', cancel: 'Cancel', danger: true,
    });
    if (!yes) return;
    act.run(async () => {
      const r = await api.send('POST', '/settings/two-step-login/off');
      onSaved();
      // phase 24 (field map row 101): turning it off waits for a second Admin
      if (r && r.waiting) act.setMsg({ kind: 'info', text: r.message });
      else act.setMsg({ kind: 'ok', text: 'Two-step sign-in is off: the next sign-in needs only the password.' });
    });
  };
  const askCode = () => act.run(async () => {
    const d = await api.send('POST', '/settings/two-step-login/on');
    setCode('');
    setSent(d);
  });
  const turnOn = (e) => {
    e.preventDefault();
    act.run(async () => {
      try {
        await api.send('POST', '/settings/two-step-login/on/confirm', { code });
      } catch (err) {
        setCode('');
        if (err.data && err.data.code === 'code_restart') setSent(null);
        throw err;
      }
      setSent(null);
      onSaved();
      act.setMsg({ kind: 'ok', text: 'Two-step sign-in is on: the next sign-in needs the e-mailed code.' });
    });
  };
  const cancel = () => { setSent(null); setCode(''); };

  return (
    <div className="a-twostep">
      <span className="a-switch-row">
        <button type="button" role="switch" aria-checked={on} aria-label="Two-step sign-in" className="a-switch"
          onClick={on ? turnOff : askCode} disabled={act.busy || Boolean(sent) || Boolean(s.waiting)}>
          <span className="a-switch-knob" aria-hidden="true" />
        </button>
        <strong>{on ? 'On' : 'Off'}</strong>
      </span>
      {s.waiting && <small className="a-waitline"><Pill tone="warn">Waiting for a second Admin</Pill> Turn {s.waiting.value} (asked by {s.waiting.by}). <Link to="/admin/approvals">Approvals</Link></small>}
      {sent && (
        <form className="a-twostep-code" onSubmit={turnOn}>
          <label htmlFor="two-step-code">We e-mailed a code to {sent.sentTo} (valid {sent.minutes} minutes). Type it to turn two-step sign-in on.</label>
          <span className="a-pending-btns">
            <input id="two-step-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
            <button type="submit" className="a-btn a-btn-sm" disabled={act.busy || code.length !== 6}>Turn on</button>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={cancel} disabled={act.busy}>Cancel</button>
          </span>
        </form>
      )}
    </div>
  );
}

// Photos with a focus point (the setting that holds it).
const FOCUS_OF = { about_image: 'about_image_focus' };

function FocusPreview({ src, alt, focus, act }) {
  const f = parseFocus(focus.value) || DEFAULT_FOCUS;
  const win = visibleWindow(f, ABOUT.imgAspect, ABOUT.boxAspect);
  const { error } = checkSetting('about_image_focus', focus.value);
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    focus.onChange(formatFocus({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }));
  };
  const nudge = (e) => { // keyboard: arrows move the point by 2 %
    const d = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[e.key];
    if (!d) return;
    e.preventDefault();
    focus.onChange(formatFocus({ x: Math.min(100, Math.max(0, f.x + d[0])), y: Math.min(100, Math.max(0, f.y + d[1])) }));
  };
  return (
    <div className="a-focusbox">
      <div className="a-focus" role="button" tabIndex={0} aria-label={`Focus point ${Math.round(f.x)}% across, ${Math.round(f.y)}% down. Click the photo or use the arrow keys.`}
        onClick={pick} onKeyDown={nudge}>
        <img src={src} alt={alt} draggable="false" />
        <span className="a-focus-win" style={{ left: `${win.left}%`, top: `${win.top}%`, width: `${win.width}%`, height: `${win.height}%` }} aria-hidden="true" />
        <span className="a-focus-dot" style={{ left: `${f.x}%`, top: `${f.y}%` }} aria-hidden="true" />
      </div>
      <small className="a-muted">Focus {Math.round(f.x)}% / {Math.round(f.y)}%: click where the products are. The frame is what the site&apos;s About box shows.</small>
      {focus.pending && (
        <span className="a-pending-btns">
          <button type="button" className="a-btn a-btn-sm" onClick={focus.onSave} disabled={act.busy || Boolean(error)}>Save focus</button>
          <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={focus.onCancel} disabled={act.busy}>Cancel</button>
        </span>
      )}
    </div>
  );
}

// A setting's hint. "TO BE PROVIDED" at the start of a description is a marker: shown (as a badge) only while the
// saved value is empty, otherwise just the hint after it.
const TO_BE_PROVIDED = /^TO BE PROVIDED\s*[-,:]?\s*/i;
function Hint({ text, empty }) {
  const marked = TO_BE_PROVIDED.test(text || '');
  const hint = marked ? text.replace(TO_BE_PROVIDED, '') : text;
  return (
    <small className="a-muted">
      {marked && empty && <Pill tone="warn" className="a-tbp">To be provided</Pill>}
      {hint}
    </small>
  );
}

// mail_logo_url: how to get a hosted logo URL from SendGrid (collapsed until opened). Menu names checked against
// SendGrid's own help on 16 Oct 2026 ("Design Library > Your Images", "choose images to upload", "copy the image URL").
function LogoHowTo() {
  return (
    <details className="a-howto-toggle">
      <summary>How to get this URL</summary>
      <ol>
        <li>Prepare the logo as a transparent PNG, 124 x 68 px.</li>
        <li>Sign in to SendGrid (app.sendgrid.com) and open Design Library &gt; Your Images in the left menu.</li>
        <li>Drop the PNG on the page, or click &quot;choose images to upload&quot; and pick it.</li>
        <li>Click the uploaded image and choose &quot;copy the image URL&quot; (it starts with https://cdn.mcauto-images-production.sendgrid.net/...).</li>
        <li>Paste it here, check the preview below, Save, then click &quot;Send test mail&quot;.</li>
      </ol>
      <p>The URL must start with https:// and stay public, or the logo will not show in e-mails.</p>
    </details>
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
          <Pill tone={info.kind === 'LIVE' ? 'good' : 'warn'}>{info.kind}</Pill>{' '}
          <b>{info.title}</b> · tabs: {info.tabs.join(', ')} · sync {info.syncEnabled ? 'on' : 'off (GSHEET_ENABLED)'}
        </small>
      )}
      {state && state.error && <small className="a-bad" role="alert">{state.error}</small>}
    </div>
  );
}

// Preview of the saved picture (or what the site shows without one), Upload, Remove. With `focus` (about_image): click
// the preview where the subject is; a dot marks the point and a frame shows the part the site's 5:4 box will show.
function Picture({ s, cfg, act, onSaved, focus }) {
  const value = s.setting_value || '';
  const src = value ? `/media/${value}` : cfg.empty;
  const up = useUpload();
  const upload = (file) => act.run(async () => {
    const r = await up.send(s.setting_key, `/settings/${s.setting_key}/image`, file);
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
      {src && focus ? <FocusPreview src={mediaUrl(src)} alt={`${s.setting_key} preview`} focus={focus} act={act} />
        : src
          ? <img src={mediaUrl(src)} alt={`${s.setting_key} preview`} width={cfg.width} height={cfg.height} />
          : <span className="a-picture-none">No photo</span>}
      <small className="a-muted">{value ? <code>{value}</code> : cfg.emptyText}</small>
      <span className="a-row">
        <UploadButton upload={up} uploadKey={s.setting_key} label={cfg.button} accept={cfg.accept} disabled={act.busy} onFile={upload} />
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

// mail_from (owner's note, field map row 98): picked only from the senders verified in SendGrid, never typed. When the
// list cannot be read, the saved sender stays and nothing else can be picked.
function SenderPick({ value, saved, onChange }) {
  const [st, setSt] = useState(null); // { ok, reason, senders }
  useEffect(() => { api.get('/website/senders').then(setSt, (e) => setSt({ ok: false, reason: e.message, senders: [] })); }, []);
  const list = (st && st.senders) || [];
  const known = list.some((x) => x.email === value);
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="mail_from" disabled={!st || !list.length}>
        {!known && <option value={value}>{value || '(none)'}{value === saved ? ' (saved)' : ''}</option>}
        {list.map((x) => <option key={x.email} value={x.email}>{x.email}{x.name ? ` (${x.name})` : ''}</option>)}
      </select>
      <small className="a-muted">
        {!st ? 'Reading the verified senders from SendGrid...'
          : st.ok ? `${list.length} verified sender(s) in SendGrid. Add one there (Settings > Sender authentication) to pick it here.`
            : `Could not read the verified senders (${st.reason}): the saved sender stays.`}
      </small>
    </>
  );
}
