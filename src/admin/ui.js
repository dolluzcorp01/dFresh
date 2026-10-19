// Small shared pieces for the admin screens (staff tool: plain layout, English labels).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';

export const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

const RANK = { viewer: 1, editor: 2, admin: 3 };
/** true when the signed-in user has at least `role` (the API enforces it too; this only hides buttons). */
export function useCan(role) {
  const { me } = useAdmin();
  return (RANK[me && me.role] || 0) >= RANK[role];
}

/** Loads `path` (GET) and gives { data, error, loading, reload, setData }. */
// Data belongs to the path it was loaded for: when the path changes (another list in the same component), the
// old rows are never handed out, the new path starts as loading with no data.
export function useLoad(path) {
  const [state, setState] = useState({ path, data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => (s.path === path ? { ...s, loading: true } : { path, data: null, error: null, loading: true }));
    api.get(path).then(
      (data) => n === seq.current && setState({ path, data, error: null, loading: false }),
      (error) => n === seq.current && setState({ path, data: null, error, loading: false })
    );
  }, [path]);
  useEffect(reload, [reload]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  const own = state.path === path ? state : { path, data: null, error: null, loading: Boolean(path) };
  return { data: own.data, error: own.error, loading: own.loading, reload, setData };
}

export function Notice({ kind = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`a-note a-note-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onClose && <button type="button" className="a-x" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

/** The help / info card at the top of an admin page (one style everywhere): a heading and short text or a list. */
export function InfoCard({ title, children }) {
  return (
    <section className="a-infocard" aria-label={title || 'Help'}>
      {title && <h2 className="a-infocard-h">{title}</h2>}
      <div className="a-infocard-b">{children}</div>
    </section>
  );
}

/** A person's photo, or their initials in a circle. */
export function Avatar({ name, photo, size = 32 }) {
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return photo
    ? <img className="a-avatar" src={photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="a-avatar a-avatar-i" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{initials}</span>;
}

/** Runs async actions with a busy flag and a message line. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = useCallback(async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await fn();
      if (okText) setMsg({ kind: 'ok', text: okText });
      return out;
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const note = msg ? <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice> : null;
  return { busy, run, note, setMsg };
}

export function Loading({ state, children }) {
  if (state.error) return <Notice kind="error">{state.error.message}</Notice>;
  if (state.loading && !state.data) return <p className="a-muted">Loading...</p>;
  return children;
}

/**
 * A small (i) next to a label: the longer explanation, shown on hover or keyboard focus (and read by screen readers).
 * Hints stay at most 2 lines; the detail goes here. A click on it never reaches the control the label belongs to.
 */
// The bubble exists only while it is open and is placed in window coordinates (position: fixed), kept inside the
// window: a hidden tooltip must never widen a drawer or a table (it used to give the Towns drawer a sideways scroll).
export function InfoTip({ text }) {
  const ref = useRef(null);
  const [at, setAt] = useState(null); // { left, top } while open
  if (!text) return null;
  const show = () => {
    const r = ref.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - width - 8));
    const below = r.bottom + 8;
    setAt({ left, top: below, width });
  };
  return (
    <span ref={ref} className="a-info" tabIndex={0} role="note" aria-label={text}
      onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      i
      {at && <span className="a-tip" aria-hidden="true" style={{ left: at.left, top: at.top, maxWidth: at.width }}>{text}</span>}
    </span>
  );
}

/**
 * The number a new row gets in an Add drawer: the last one + 1 among the rows of its group (inGroup), in `field`.
 * '...' until the list has loaded (rows undefined / null), never a guess. Every Add drawer uses this; the server
 * assigns the final number on create anyway (positions.js, form options, languages).
 */
export function nextOrder(rows, inGroup = () => true, field = 'sort_order') {
  if (!rows) return '...';
  return rows.filter(inGroup).reduce((m, r) => Math.max(m, Number(r[field]) || 0), 0) + 1;
}

/** One form control. def: { name, label, type: text|textarea|number|bool|select|readonly, options, help, info, error } */
export function Field({ def, value, onChange, disabled }) {
  const id = `f-${def.name}`;
  const common = { id, disabled: disabled || def.type === 'readonly' || def.locked, name: def.name };
  let control;
  if (def.type === 'bool') {
    control = <input type="checkbox" {...common} checked={Boolean(Number(value))} onChange={(e) => onChange(e.target.checked ? 1 : 0)} />;
  } else if (def.type === 'select') {
    control = (
      <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        {def.allowEmpty !== false && <option value="">-</option>}
        {def.options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    );
  } else if (def.type === 'textarea') {
    control = <textarea {...common} rows={def.rows || 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = <input type={def.type === 'number' ? 'number' : 'text'} step={def.step || 'any'} min={def.min} max={def.max} {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <label className={`a-field${def.type === 'bool' ? ' a-check' : ''}${def.wide ? ' a-wide' : ''}`} htmlFor={id}>
      <span>{def.label || def.name}{def.required && ' *'}<InfoTip text={def.info} /></span>
      {control}
      {def.error ? <small className="a-bad" role="alert">{def.error}</small> : def.help && <small className="a-muted">{def.help}</small>}
    </label>
  );
}

/**
 * Per-language text side by side: one column per language, one row per field.
 * tr = { lang: { col: value } }; empty cells fall back to the default language on the site.
 */
// A field with override: true is an optional per-language replacement of a main (base) field: no box for the default
// language (the main field is its value), and in the others an empty box shows the main value as a grey placeholder.
// strict (after a save attempt): a required box is red when it is empty in the default language, or in another
// language whose row has other texts (a language is all or nothing). Otherwise an empty box is a normal box with a grey
// "uses default" placeholder: the site shows the default language there.
export function TrEditor({ fields, tr, onChange, disabled, main = {}, strict = false }) {
  const { languages } = useAdmin();
  const started = (lang) => Object.values(tr[lang] || {}).some((x) => String(x ?? '').trim() !== '');
  const set = (lang, col, v) => onChange({ ...tr, [lang]: { ...(tr[lang] || {}), [col]: v } });
  return (
    <div className="a-tr" style={{ '--cols': languages.length }}>
      <div className="a-tr-head" />
      {languages.map((l) => (
        <div key={l.lang_code} className="a-tr-head">
          {l.name_en} <code>{l.lang_code}</code>{Number(l.is_default) === 1 ? ' (default)' : ''}{Number(l.is_active) ? '' : ' - off'}
        </div>
      ))}
      {fields.map((f) => [
        <div key={`${f.name}-l`} className="a-tr-label">{f.label || f.name}{f.required && ' *'}<InfoTip text={f.info} />{f.help && <small className="a-muted a-tr-help">{f.help}</small>}</div>,
        ...languages.map((l) => {
          const isDefault = Number(l.is_default) === 1;
          if (f.override && isDefault) {
            return <div key={`${f.name}-${l.lang_code}`} className="a-tr-main a-muted">Uses the main {f.mainLabel || f.name} field</div>;
          }
          const v = tr[l.lang_code] ? tr[l.lang_code][f.name] ?? '' : '';
          const empty = String(v).trim() === '';
          const error = strict && empty && f.required && (isDefault || started(l.lang_code));
          const props = {
            value: v, disabled, 'aria-label': `${f.label || f.name} (${l.lang_code})`, dir: l.dir,
            className: error ? 'a-missing' : undefined, 'aria-invalid': error || undefined,
            placeholder: f.override ? main[f.name] || '' : empty && !isDefault ? 'uses default' : undefined,
            onChange: (e) => set(l.lang_code, f.name, e.target.value),
          };
          if (f.override) {
            return (
              <div key={`${f.name}-${l.lang_code}`} className="a-tr-over">
                <input type="text" {...props} />
                {v !== '' && !disabled && (
                  <button type="button" className="a-link" onClick={() => set(l.lang_code, f.name, '')}
                    aria-label={`Use main value for ${f.label || f.name} (${l.lang_code})`}>Use main value</button>
                )}
              </div>
            );
          }
          return f.long
            ? <textarea key={`${f.name}-${l.lang_code}`} rows={4} {...props} />
            : <input key={`${f.name}-${l.lang_code}`} type="text" {...props} />;
        }),
      ])}
    </div>
  );
}

/**
 * Required per-language texts that are empty, for every active language except the default one (the default is
 * required on save anyway). Languages come from Setup > Languages, so a new language is checked as soon as it is on.
 * fields: [{ name, label, required }]. Returns [{ lang, name, fields: [labels] }].
 */
export function missingTexts(tr, fields, languages) {
  const required = fields.filter((f) => f.required);
  const out = [];
  for (const l of languages) {
    if (Number(l.is_default) === 1 || Number(l.is_active) !== 1) continue;
    const t = (tr || {})[l.lang_code] || {};
    const empty = required.filter((f) => !String(t[f.name] ?? '').trim());
    if (empty.length) out.push({ lang: l.lang_code, name: l.name_en || l.lang_code, fields: empty.map((f) => f.label || f.name) });
  }
  return out;
}

/** "TA missing" badges for a list row (hover: which fields are empty). */
export function MissingBadges({ missing }) {
  return missing.map((m) => (
    <span key={m.lang} className="a-trmiss" title={`${m.name}: ${m.fields.join(', ')} ${m.fields.length === 1 ? 'is' : 'are'} empty`}>
      {m.lang.toUpperCase()} missing
    </span>
  ));
}

// ---------------------------------------------------------------------------------------------------------------
// In-app confirmations (never the browser's alert / confirm / prompt). confirm(opts) -> Promise: true (the action),
// 'alt' (a second action, e.g. "Discard"), false (Cancel, Esc, click outside).
// opts: { title, message, action = 'OK', cancel = 'Cancel', danger (red action button), alt }
const ConfirmContext = createContext(null);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null); // { opts, resolve }
  const confirm = useCallback((opts) => new Promise((resolve) => setReq({ opts, resolve })), []);
  const done = (value) => {
    if (req) req.resolve(value);
    setReq(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && <ConfirmDialog {...req.opts} onDone={done} />}
    </ConfirmContext.Provider>
  );
}

export function ConfirmDialog({ title, message, action = 'OK', cancel = 'Cancel', danger = false, alt = null, onDone }) {
  const boxRef = useRef(null);
  const actionRef = useRef(null);
  const cancelRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const before = document.activeElement;
    // a destructive action starts on the safe button, so Enter never deletes by reflex
    const first = danger ? cancelRef.current : actionRef.current;
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); // the drawer under it stays open
        doneRef.current(false);
      } else if (e.key === 'Tab') { // focus stays in the dialog
        const items = [...boxRef.current.querySelectorAll('button:not([disabled])')];
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before && before.focus && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="a-cd-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(false); }}>
      <div ref={boxRef} className="a-cd" role="alertdialog" aria-modal="true" aria-labelledby="a-cd-t" aria-describedby={message ? 'a-cd-m' : undefined}>
        <h2 id="a-cd-t">{title}</h2>
        {message && <p id="a-cd-m">{message}</p>}
        <div className="a-cd-btns">
          <button ref={actionRef} type="button" className={`a-btn${danger ? ' a-btn-danger' : ''}`} onClick={() => onDone(true)}>{action}</button>
          {alt && <button type="button" className="a-btn a-btn-ghost" onClick={() => onDone('alt')}>{alt}</button>}
          <button ref={cancelRef} type="button" className="a-btn a-btn-ghost" onClick={() => onDone(false)}>{cancel}</button>
        </div>
      </div>
    </div>
  );
}

export const DISCARD = { title: 'Discard unsaved changes?', message: 'Your changes have not been saved.', action: 'Discard', cancel: 'Keep editing', danger: true };
export const UPLOADING = { title: 'Upload in progress. Leave anyway?', message: 'The upload stops and the file is not saved if you leave now.', action: 'Leave', cancel: 'Stay', danger: true };

// ---------------------------------------------------------------------------------------------------------------
// Uploads (Brochures, product photos, banners, Settings pictures, Excel import, Translations CSV) all go through
// useUpload(): real progress from the upload, one at a time (no double submit), "Processing..." until the server
// answers. While any upload runs, leaving the page (admin link, drawer close, tab close) asks UPLOADING first; the
// app-wide <UploadGuard /> does it once, and the ordinary "unsaved changes" guards stand down meanwhile.
let activeUploads = 0;
const uploadListeners = new Set();
function countUpload(d) {
  activeUploads += d;
  uploadListeners.forEach((f) => f(activeUploads));
}
/** true while an upload is running anywhere in the admin */
export function useUploadsActive() {
  const [n, setN] = useState(activeUploads);
  useEffect(() => {
    uploadListeners.add(setN);
    return () => { uploadListeners.delete(setN); };
  }, []);
  return n > 0;
}

/** Once, in the admin shell: the leave guard for uploads. */
export function UploadGuard() {
  useLeaveGuard(useUploadsActive(), UPLOADING);
  return null;
}

/**
 * const up = useUpload(); ... up.send(key, path, file, fields) -> the server's data (throws like api calls).
 * up.state = { key, name, phase: 'uploading' | 'processing', pct } while it runs; up.is(key); up.busy.
 */
export function useUpload() {
  const [state, setState] = useState(null);
  const running = useRef(false);
  const send = useCallback(async (key, path, file, fields) => {
    if (running.current) return undefined; // a second click while one runs does nothing
    running.current = true;
    countUpload(1);
    setState({ key, name: file.name, phase: 'uploading', pct: 0 });
    try {
      return await api.upload(path, file, fields, { onProgress: (p) => setState((s) => (s ? { ...s, ...p } : s)) });
    } finally {
      running.current = false;
      countUpload(-1);
      setState(null);
    }
  }, []);
  return { state, busy: Boolean(state), is: (key) => Boolean(state && state.key === key), send };
}

/** Spinner + "Uploading... 45%" / "Processing..." + the file name. */
export function UploadProgress({ state }) {
  if (!state) return null;
  return (
    <span className="a-upload" role="status" aria-live="polite">
      <span className="a-spin" aria-hidden="true" />
      <span>{state.phase === 'processing' ? 'Processing...' : `Uploading... ${state.pct}%`}</span>
      <span className="a-upload-name" title={state.name}>{state.name}</span>
    </span>
  );
}

/** A file-picker button: picks a file -> onFile(file); while ITS upload runs it shows the progress instead. */
export function UploadButton({ label, accept, onFile, upload, uploadKey, disabled, className = 'a-btn a-btn-sm a-btn-ghost' }) {
  const active = upload.is(uploadKey);
  const off = Boolean(disabled || upload.busy);
  return (
    <label className={`${className} a-file${active ? ' a-uploading' : ''}${off && !active ? ' a-file-off' : ''}`}>
      {active ? <UploadProgress state={upload.state} /> : label}
      <input type="file" accept={accept} disabled={off} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
    </label>
  );
}

/**
 * While `dirty`: following an admin link asks `dialog` (default "Discard unsaved changes?") first, and closing /
 * reloading the tab gets the browser's own "Leave site?" warning (the only thing a browser allows there). Nothing
 * happens when not dirty. While an upload runs, only the upload guard asks (one dialog, not two).
 */
export function useLeaveGuard(dirty, dialog = DISCARD) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const uploading = useUploadsActive();
  const on = dialog === UPLOADING ? dirty : dirty && !uploading;
  useEffect(() => {
    if (!on) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname + url.search === window.location.pathname + window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      confirm(dialog).then((ok) => { if (ok) navigate(url.pathname + url.search + url.hash); });
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [on, dialog, confirm, navigate]);
}

// dirty: closing (X, Esc, click outside) asks "Discard unsaved changes?" first, and so does leaving the page.
// An upload running in it: closing asks "Upload in progress. Leave anyway?" instead.
export function Drawer({ title, onClose, children, footer, dirty = false }) {
  const confirm = useConfirm();
  const uploading = useUploadsActive();
  useLeaveGuard(dirty);
  const close = useCallback(() => {
    if (!dirty && !uploading) { onClose(); return; }
    confirm(uploading ? UPLOADING : DISCARD).then((ok) => { if (ok) onClose(); });
  }, [dirty, uploading, onClose, confirm]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="a-drawer-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="a-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2>{dirty && <span className="a-unsaved">Unsaved changes</span>}<button type="button" className="a-x" onClick={close} aria-label="Close">×</button></header>
        <div className="a-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>
  );
}

// Every time in the admin in India time, whatever zone the viewer's PC is in (the API sends UTC instants).
export const fmtDate = (v) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');
