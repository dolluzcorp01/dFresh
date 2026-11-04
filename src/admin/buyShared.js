// Section 3 Suppliers and buying (phase 16): the pieces every buying screen shares (v23 "SECTION 3 ... PAGES AND
// PANELS"): purchase rates and values shown only to See cost or Buying Edit (the API sends null, shown as "hidden"),
// the totals box, an item or supplier cell, an input with its error, the view-only notice, and ?open= to open a record
// from another page.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, LIcon, money } from './ui';

/** a cost or value: "hidden" when the API sent null for this role */
export const bm = (v) => (v === null || v === undefined ? <span className="a-muted">hidden</span> : money(v));
/** Rs with Indian grouping, no decimals (limits and PO values) */
export const rs0 = (v) => `Rs ${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const at = (v) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');

export function ViewOnlyB({ me, what }) {
  return <Alert tone="info" title="View only.">{me && me.role_name ? `${me.role_name} can` : 'Your role can'} see {what} but not change it. Rights come from the role in Foundation.</Alert>;
}

/** an item: name, then its code (raw materials show the package icon) */
export function ItemCell({ name, code, sub }) {
  return (
    <span className="a-p16-item"><span className="a-p16-ic" aria-hidden="true"><LIcon name="package" size="sm" /></span>
      <span><b>{name || code}</b><small className="a-muted a-p15-sub">{code}{sub ? ` · ${sub}` : ''}</small></span></span>
  );
}
export function SupCell({ s }) {
  if (!s) return null;
  return <><b>{s.name}</b><small className="a-muted a-p15-sub">{s.code}{s.status && s.status !== 'active' ? ` · ${s.status === 'hold' ? 'On hold' : 'Blocked'}` : ''}</small></>;
}

/** value without GST, freight, CGST + SGST or IGST, round off, total (v23 totalsBox) */
export function TotalsBox({ t, seeBuy = true }) {
  if (!seeBuy || !t) return <p className="a-hint-s">Values are hidden: your role has no See cost.</p>;
  return (
    <dl className="a-kv a-p16-tot">
      <dt>Value without GST</dt><dd>{money(t.taxable)}</dd>
      {Number(t.freight) > 0 && <><dt>Freight</dt><dd>{money(t.freight)}</dd></>}
      {t.inter ? <><dt>IGST</dt><dd>{money(t.igst)}</dd></> : <><dt>CGST</dt><dd>{money(t.cgst)}</dd><dt>SGST</dt><dd>{money(t.sgst)}</dd></>}
      {Number(t.round) !== 0 && <><dt>Round off</dt><dd>{money(t.round)}</dd></>}
      <dt><b>Total</b></dt><dd><b>{money(t.total)}</b></dd>
    </dl>
  );
}

/** one small input with its label and error (the line rows of the buying forms) */
export function In({ label, error, hint, wide, children, ...props }) {
  return (
    <label className={`a-field${error ? ' a-err' : ''}${wide ? ' a-wide' : ''}`}>
      <span>{label}</span>
      {children || <input {...props} />}
      {error ? <small className="a-emsg" role="alert">{error}</small> : hint ? <small className="a-hint">{hint}</small> : null}
    </label>
  );
}

/** ?open=<id> on the address opens that record once the page has loaded (links from other pages) */
export function useOpenParam(ready, open) {
  const loc = useLocation();
  const nav = useNavigate();
  const id = new URLSearchParams(loc.search).get('open');
  useEffect(() => {
    if (!ready || !id) return;
    open(id);
    nav(loc.pathname, { replace: true });
  }, [ready, id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** a field error from the API (e.data.fields) for a key like lines.0.qty */
export const fe = (err, k) => (err && err[k]) || null;
export const fieldsOf = (e) => (e && e.data && e.data.fields) || {};
