// One approval request (v23 .rqc card): kind, godown, amount, summary, who raised it and when, who can sign (the
// ladder, smallest limit first: r.signers from the API, "for X" when someone signs as X's stand-in), the note when it
// counts together with other requests, then Approve (note optional) / Reject (a reason is required) / Withdraw (your
// own request). Approve reads "Approve for X" when you sign with the powers of X, who is on leave; a decided card names
// both people. Deciding is the page's job: onDecide(decision, note) resolves truthy once decided, onWithdraw() a
// promise; the card only holds the open note box.
import { useState } from 'react';
import { Pill, money } from './blocks';

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad', expired: 'gray', withdrawn: 'gray' };

export default function ApprovalCard({ r, godown, signers, busy, onDecide, onWithdraw, fmtDate }) {
  const [open, setOpen] = useState(null); // 'approved' | 'rejected'
  const [note, setNote] = useState('');
  const go = async () => { if (await onDecide(open, note)) { setOpen(null); setNote(''); } }; // a failed decision keeps the note
  const where = godown || r.godown;
  const ladder = signers || r.signers || [];
  const approveText = r.via ? `Approve for ${r.via.name}` : 'Approve';
  return (
    <div className={`a-rqc${r.mine ? ' mine' : ''}`}>
      <div className="a-rqc-top">
        <Pill tone="gold">{r.kind_label}</Pill>
        {where && <Pill tone="gray">{where}</Pill>}
        <Pill tone={STATUS_TONE[r.status] || 'gray'}>{r.status}</Pill>
        {r.amount !== null && r.amount !== undefined ? <span className="a-rqc-amt">{money(r.amount)}</span>
          : ['write_off', 'stock_count', 'restock'].includes(r.kind) && <span className="a-rqc-amt a-muted" title="Its value is a cost: See cost only">value hidden</span>}
      </div>
      <p className="a-rqc-sum">{r.summary}</p>
      <p className="a-muted a-rqc-by">
        Raised by {r.requested_by_name || r.requested_by}{r.mine ? ' (you)' : ''}, {fmtDate(r.requested_at)}
        {r.decided_by && <> - {r.status} by {r.decided_by_name || r.decided_by}{r.decided_via_name ? ` for ${r.decided_via_name}` : ''}, {fmtDate(r.decided_at)}</>}
        {r.note && <> - &quot;{r.note}&quot;</>}
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
        </div>
      )}
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
    </div>
  );
}
