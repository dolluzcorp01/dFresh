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
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    api.get(path).then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error) => n === seq.current && setState({ data: null, error, loading: false })
    );
  }, [path]);
  useEffect(reload, [reload]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
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

/** One form control. def: { name, label, type: text|textarea|number|bool|select|readonly, options, help } */
export function Field({ def, value, onChange, disabled }) {
  const id = `f-${def.name}`;
  const common = { id, disabled: disabled || def.type === 'readonly', name: def.name };
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
    control = <input type={def.type === 'number' ? 'number' : 'text'} step={def.step || 'any'} {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <label className={`a-field${def.type === 'bool' ? ' a-check' : ''}${def.wide ? ' a-wide' : ''}`} htmlFor={id}>
      <span>{def.label || def.name}{def.required && ' *'}</span>
      {control}
      {def.help && <small className="a-muted">{def.help}</small>}
    </label>
  );
}

/**
 * Per-language text side by side: one column per language, one row per field.
 * tr = { lang: { col: value } }; empty cells fall back to the default language on the site.
 */
export function TrEditor({ fields, tr, onChange, disabled }) {
  const { languages } = useAdmin();
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
        <div key={`${f.name}-l`} className="a-tr-label">{f.label || f.name}{f.required && ' *'}</div>,
        ...languages.map((l) => {
          const v = tr[l.lang_code] ? tr[l.lang_code][f.name] ?? '' : '';
          const missing = !v && f.required && Number(l.is_default) !== 1;
          const props = {
            value: v, disabled, 'aria-label': `${f.label || f.name} (${l.lang_code})`, dir: l.dir,
            className: missing ? 'a-missing' : undefined, placeholder: missing ? 'uses default' : undefined,
            onChange: (e) => set(l.lang_code, f.name, e.target.value),
          };
          return f.long
            ? <textarea key={`${f.name}-${l.lang_code}`} rows={4} {...props} />
            : <input key={`${f.name}-${l.lang_code}`} type="text" {...props} />;
        }),
      ])}
    </div>
  );
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
