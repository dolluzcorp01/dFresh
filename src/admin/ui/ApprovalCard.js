// One approval request (v23 .rqc card): kind, godown, amount, summary, who raised it and when, who can sign (the
// ladder, smallest limit first: r.signers from the API, "for X" when someone signs as X's stand-in), the note when it
// counts together with other requests, then Approve (note optional) / Reject (a reason is required) / Withdraw (your
// own request). Approve reads "Approve for X" when you sign with the powers of X, who is on leave; a decided card names
// both people. Deciding is the page's job: onDecide(decision, note) resolves truthy once decided, onWithdraw() a
// promise; the card only holds the open note box.
// Phase 12b: the override of a waiting rule change (only when r.can_override: every other Admin is away) with its
// reason (10+ letters), a waiting override with who set it, why and a live countdown to when it applies (Cancel
// override for any Admin), a finished override's outcome, and "Send again" on your own expired request.
// onOverride(reason) resolves truthy once set, onCancelOverride() / onSendAgain() are the page's too.
import { useEffect, useState } from 'react';
import { Pill, money } from './blocks';

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad', expired: 'gray', withdrawn: 'gray' };
const letters = (s) => (String(s || '').match(/\p{L}/gu) || []).length; // as the server counts (approvals.js)

export default function ApprovalCard({ r, godown, signers, busy, onDecide, onWithdraw, onOverride, onCancelOverride, onSendAgain, fmtDate }) {
  const [open, setOpen] = useState(null); // 'approved' | 'rejected'
  const [note, setNote] = useState('');
  const go = async () => { if (await onDecide(open, note)) { setOpen(null); setNote(''); } }; // a failed decision keeps the note
  const where = godown || r.godown;
  const ladder = signers || r.signers || [];
  const approveText = r.via ? `Approve for ${r.via.name}` : 'Approve';
  const o = r.override;
  return (
    <div className={`a-rqc${r.mine ? ' mine' : ''}`}>
      <div className="a-rqc-top">
        <Pill tone="gold">{r.kind_label}</Pill>
        {where && <Pill tone="gray">{where}</Pill>}
        <Pill tone={STATUS_TONE[r.status] || 'gray'}>{r.status}</Pill>
        {o && o.status === 'waiting' && <Pill tone="warn">override waiting</Pill>}
        {r.amount !== null && r.amount !== undefined ? <span className="a-rqc-amt">{money(r.amount)}</span>
          : ['write_off', 'stock_count', 'restock'].includes(r.kind) && <span className="a-rqc-amt a-muted" title="Its value is a cost: See cost only">value hidden</span>}
      </div>
      <p className="a-rqc-sum">{r.summary}</p>
      <p className="a-muted a-rqc-by">
        Raised by {r.requested_by_name || r.requested_by}{r.mine ? ' (you)' : ''}, {fmtDate(r.requested_at)}
        {r.decided_by && <> - {r.status} by {r.decided_by_name || r.decided_by}{r.decided_via_name ? `${r.decided_via === 'override' ? ' through' : ' for'} ${r.decided_via_name}` : ''}, {fmtDate(r.decided_at)}</>}
        {r.note && <> - &quot;{r.note}&quot;</>}
        {r.resent_id && <> - sent again as request {r.resent_id}</>}
      </p>
      {r.split_note && <p className="a-rqc-split a-hint">{r.split_note}</p>}
      {r.status === 'pending' && (
        <div className="a-ladder">
          <span>Can sign:</span>
          {ladder.length ? ladder.map((s, i) => (
            <span key={typeof s === 'string' ? s : s.emp_id} className={`a-ladder-who${i === 0 ? ' next' : ''}`} title={typeof s === 'string' ? undefined : `signs up to ${s.limit}`}>
              {typeof s === 'string' ? s : s.name}{s.via ? ` (for ${s.via})` : ''}
            </span>
          )) : <span className="a-bad">nobody today: raise a limit or give a role Approve on this section.</span>}
          {!r.can_decide && !r.mine && r.why_not && <span className="a-ladder-why">Not you: {r.why_not}</span>}
          {r.kind === 'rule_change' && !r.can_decide && !r.can_override && !o && r.override_why_not && <span className="a-ladder-why">No override: {r.override_why_not}</span>}
        </div>
      )}
      {o && <OverrideLine o={o} busy={busy} canCancel={r.can_cancel_override && Boolean(onCancelOverride)} onCancel={onCancelOverride} />}
      {r.status === 'pending' && r.can_override && onOverride && !open && <OverrideForm busy={busy} onOverride={onOverride} />}
      {r.status === 'pending' && (open ? (
        <div className="a-rqc-decide">
          <label className="a-fld">
            <span className="a-fld-l">{open === 'rejected' ? <>Why is it rejected? <span className="a-req">*</span></> : 'Note (optional)'}</span>
            <textarea rows={2} value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="a-racts">
            <button type="button" className="a-btn a-btn-ghost" disabled={busy} onClick={() => { setOpen(null); setNote(''); }}>Cancel</button>
            <button type="button" className={`a-btn${open === 'rejected' ? ' a-btn-danger' : ''}`} disabled={busy || (open === 'rejected' && !note.trim())}
              onClick={go}>{open === 'rejected' ? 'Reject' : approveText}</button>
          </div>
        </div>
      ) : (
        <div className="a-racts">
          {r.mine && onWithdraw && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={onWithdraw}>Withdraw my request</button>}
          {r.can_decide && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={() => { setOpen('rejected'); setNote(''); }}>Reject</button>}
          {r.can_decide && <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={() => { setOpen('approved'); setNote(''); }}>{approveText}</button>}
        </div>
      ))}
      {r.status === 'expired' && r.can_send_again && onSendAgain && (
        <div className="a-racts">
          <span className="a-hint a-rqc-again">Nobody decided it in time. Send it again: a fresh request with the same details.</span>
          <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={onSendAgain}>Send again</button>
        </div>
      )}
    </div>
  );
}

/** The reason box of an override (every other Admin is away): 10+ letters, applies in 24 hours unless cancelled */
function OverrideForm({ busy, onOverride }) {
  const [why, setWhy] = useState('');
  const n = letters(why);
  const go = async () => { if (await onOverride(why.trim())) setWhy(''); };
  return (
    <div className="a-rqc-ovr">
      <label className="a-fld">
        <span className="a-fld-l">Reason for the override <span className="a-req">*</span></span>
        <textarea rows={2} value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} />
        <small className={n >= 10 ? 'a-hint' : 'a-hint a-rqc-short'}>{n} of at least 10 letters</small>
      </label>
      <p className="a-hint">Every other Admin is away. It applies 24 hours from now unless an Admin cancels it; every Admin is told now.</p>
      <div className="a-racts">
        <button type="button" className="a-btn a-btn-sm" disabled={busy || n < 10} onClick={go}>Override (applies in 24 hours)</button>
      </div>
    </div>
  );
}

/** time left until an ISO instant, refreshed every minute: "23 h 59 min" (or "any minute now") */
function useLeft(iso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return '';
  const min = Math.ceil((new Date(iso).getTime() - now) / 60000);
  if (Number.isNaN(min)) return '';
  if (min <= 0) return 'any minute now';
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

const ENDED = { applied: 'good', cancelled: 'gray', stopped: 'gray', failed: 'bad' };

/** a waiting override (who, why, countdown, Cancel override) or how a finished one ended */
function OverrideLine({ o, busy, canCancel, onCancel }) {
  const left = useLeft(o.status === 'waiting' ? o.apply_at_utc : null);
  if (o.status === 'waiting') {
    return (
      <div className="a-rqc-ovr">
        <p className="a-rqc-by"><b>Override by {o.set_by_name}</b>, {o.set_at} (India time): &quot;{o.reason}&quot;</p>
        <p className="a-rqc-by">Applies in <b>{left}</b>, at {o.apply_at} India time, unless an Admin cancels it.</p>
        {canCancel && (
          <div className="a-racts">
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={onCancel}>Cancel override</button>
          </div>
        )}
      </div>
    );
  }
  const text = o.status === 'applied' ? `applied at ${o.ended_at || o.apply_at}`
    : o.status === 'cancelled' ? `cancelled by ${o.ended_by_name || o.ended_by || 'an Admin'}${o.ended_at ? `, ${o.ended_at}` : ''}${o.why && o.why !== 'cancelled by an Admin' ? `: ${o.why}` : ''}`
      : `${o.status}${o.why ? `: ${o.why}` : ''}`;
  return (
    <p className="a-rqc-by a-rqc-ovrdone">
      <Pill tone={ENDED[o.status] || 'gray'}>override {o.status}</Pill> Set by {o.set_by_name} (&quot;{o.reason}&quot;), {text}.
    </p>
  );
}
