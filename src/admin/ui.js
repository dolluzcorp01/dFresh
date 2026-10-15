// Small shared pieces for the admin screens (staff tool: plain layout, English labels).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

export function Drawer({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="a-drawer-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="a-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" className="a-x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="a-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>
  );
}

export const fmtDate = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
