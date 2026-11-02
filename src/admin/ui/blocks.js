// Small v23 building blocks for every admin screen (docs/reference/dFresh_Back_Office_v23.html): the page head, rule
// chips, tabs with counts, pills, alert boxes and the money helpers. Look only: no data is loaded here.
import { Fragment } from 'react';
import LIcon from './LIcon';
import { useMenuEntry } from '../menuAccess';

/** Rs with Indian grouping and 2 decimals: money(150000) -> "Rs 1,50,000.00", money(-79) -> "Rs -79.00" (as every screen
 * printed it before); null / undefined / '' -> "-" (dash = nothing). */
export function money(n, { decimals = 2 } = {}) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '-';
  return `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** A cost for a user who may see costs, else "hidden" (never Rs 0: a hidden cost must not look like a free item). */
export function costText(n, seesCost) {
  return seesCost ? money(n) : 'hidden';
}

const TONES = { good: 'good', ok: 'good', bad: 'bad', error: 'bad', warn: 'warn', info: 'info', gray: 'gray', gold: 'gold' };

/** Status badge: <Pill tone="good">Paid</Pill>. Tones: good, bad, warn, info, gray, gold. */
export function Pill({ tone = 'gray', children, title, className = '' }) {
  return <span className={`a-pill a-pill-${TONES[tone] || 'gray'}${className ? ` ${className}` : ''}`} title={title}>{children}</span>;
}

/** The small tag next to a page title or menu item: NEW, UPGRADE, LIVE, LATER. */
export function Tag({ kind = 'new', children }) {
  return <span className={`a-tg a-tg-${kind}`}>{children}</span>;
}

/** Inline alert box (four tones), an optional bold title and a close button. */
export function Alert({ tone = 'info', title, children, onClose, className = '' }) {
  const t = TONES[tone] || 'info';
  const icon = { good: 'circle-check', bad: 'circle-x', warn: 'triangle-alert', info: 'info' }[t] || 'info';
  return (
    <div className={`a-alert a-alert-${t}${className ? ` ${className}` : ''}`} role={t === 'bad' ? 'alert' : 'status'}>
      <LIcon name={icon} />
      <div className="a-alert-tx">{title && <b>{title}</b>}{children}</div>
      {onClose && <button type="button" className="a-x" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

/** The short rule hints under a page title (one gray pill each). */
export function RuleChips({ rules }) {
  if (!rules || !rules.length) return null;
  return <div className="a-rchips">{rules.map((r) => <span key={r} className="a-pill a-pill-gray">{r}</span>)}</div>;
}

/**
 * Tabs with counts: <Tabs tabs={[{ key, label, count }]} value={tab} onChange={setTab} label="Inventory" />.
 * A count of 0 or undefined shows no badge; `bad: true` marks a tab whose part has an error.
 */
export function Tabs({ tabs, value, onChange, label, className = '' }) {
  return (
    <div className={`a-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={t.bad ? 'haserr' : undefined}
          onClick={() => onChange(t.key)}>
          {t.label}
          {t.count > 0 && <span className="a-ncount">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The head of every admin page: breadcrumb (from the menu entry of this address), title, one-line subtitle, the
 * NEW / UPGRADE tag, action buttons on the right, then the rule chips. title defaults to the menu entry's name.
 */
export function PageHead({ title, sub, tag, actions, rules, crumb }) {
  const at = useMenuEntry();
  const path = crumb || (at ? [at.group.label, at.sub && at.sub.label, at.entry !== at.group && at.entry.label].filter(Boolean) : []);
  const name = title || (at ? at.entry.label : '');
  return (
    <>
      {path.length > 0 && (
        <nav className="a-crumb" aria-label="Breadcrumb">
          {path.map((p, i) => (
            <Fragment key={`${p}-${i}`}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {i === path.length - 1 ? <b>{p}</b> : <span>{p}</span>}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="a-ph">
        <div className="a-ph-tt">
          <h1>{name}{tag && <> <Tag kind={tag.kind || 'new'}>{tag.label || tag}</Tag></>}</h1>
          {sub && <p>{sub}</p>}
        </div>
        <div className="a-ph-acts">{actions}</div>
      </div>
      <RuleChips rules={rules} />
    </>
  );
}

/** Empty state for a list or a page: icon in a circle, a title, a line and optional buttons. */
export function Empty({ icon = 'inbox', title, children, actions }) {
  return (
    <div className="a-empty">
      <div className="a-empty-ic"><LIcon name={icon} size="lg" /></div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {actions && <div className="a-empty-acts">{actions}</div>}
    </div>
  );
}
