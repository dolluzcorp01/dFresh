// One approval request (v23 .rqc card): kind, godown, amount, summary, who raised it and when, who can sign, then
// Approve (note optional) / Reject (a reason is required) / Withdraw (your own request). Deciding is the page's job:
// onDecide(decision, note) resolves truthy once decided, onWithdraw() a promise; the card only holds the open note box.
import { useState } from 'react';
import { Pill, money } from './blocks';

const STATUS_TONE = { pending: 'warn', approved: 'good', rejected: 'bad', expired: 'gray', withdrawn: 'gray' };

export default function ApprovalCard({ r, godown, signers, busy, onDecide, onWithdraw, fmtDate }) {
  const [open, setOpen] = useState(null); // 'approved' | 'rejected'
  const [note, setNote] = useState('');
  const go = async () => { if (await onDecide(open, note)) { setOpen(null); setNote(''); } }; // a failed decision keeps the note
  return (
    <div className={`a-rqc${r.mine ? ' mine' : ''}`}>
      <div className="a-rqc-top">
        <Pill tone="gold">{r.kind_label}</Pill>
        {godown && <Pill tone="gray">{godown}</Pill>}
        <Pill tone={STATUS_TONE[r.status] || 'gray'}>{r.status}</Pill>
        {r.amount !== null && r.amount !== undefined && <span className="a-rqc-amt">{money(r.amount)}</span>}
      </div>
      <p className="a-rqc-sum">{r.summary}</p>
      <p className="a-muted a-rqc-by">
        Raised by <code>{r.requested_by}</code>{r.mine ? ' (you)' : ''}, {fmtDate(r.requested_at)}
        {r.decided_by && <> - {r.status} by <code>{r.decided_by}</code>, {fmtDate(r.decided_at)}</>}
        {r.note && <> - &quot;{r.note}&quot;</>}
      </p>
      {r.status === 'pending' && (
        <div className="a-ladder">
          <span>Can sign:</span>
          {signers && signers.length ? signers.map((s) => <span key={s} className="a-ladder-who">{s}</span>)
            : r.can_decide ? <span className="a-ladder-who next">You</span> : <span>not you - {r.why_not}</span>}
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
              onClick={go}>{open === 'rejected' ? 'Reject' : 'Approve'}</button>
          </div>
        </div>
      ) : (
        <div className="a-racts">
          {r.mine && onWithdraw && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={onWithdraw}>Withdraw my request</button>}
          {r.can_decide && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={() => { setOpen('rejected'); setNote(''); }}>Reject</button>}
          {r.can_decide && <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={() => { setOpen('approved'); setNote(''); }}>Approve</button>}
        </div>
      ))}
    </div>
  );
}
