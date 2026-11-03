// Admin > Communications > Outbox (v23 "outbox": status tabs with counts, one row per message, a click opens it; API
// GET /notifications/log (+ counts), GET /notifications/log/:id, POST /notifications/log/:id/retry).
// Every customer and staff message is here, sent or not: Queued (in the mail outbox, goes within a minute), Sent, Failed
// (SendGrid refused it: "Send again" puts the same e-mail back in the outbox), Not sent (skipped, with the reason, e.g.
// no e-mail address or the customer opted out of reminders) and Prepared (the WhatsApp copy of an Admin alert: no
// provider, never sent). Filters: event, customers or staff, channel, search, test mails. Logic unchanged.
// View on Settings = read; edit = Send again.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Loading, Table, Tabs, fmtDate, useAction, useCan, useLoad } from './ui';
import { ATTACH, CHANNEL, NoteStatus, STATUS } from './notifyShared';

const TAB_ORDER = ['queued', 'failed', 'sent', 'skipped', 'prepared', 'cancelled'];

export default function Outbox({ d }) {
  const [f, setF] = useState({ status: '', event: '', audience: '', channel: '', q: '', tests: false });
  const [open, setOpen] = useState(null);
  const qs = new URLSearchParams(Object.entries({ ...f, tests: f.tests ? '1' : '' }).filter(([, v]) => v)).toString();
  const list = useLoad(`/notifications/log${qs ? `?${qs}` : ''}`);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const counts = (list.data && list.data.counts) || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabs = [{ key: '', label: 'All', count: all },
    ...TAB_ORDER.filter((k) => k !== 'cancelled' || counts.cancelled).map((k) => ({ key: k, label: STATUS[k], count: counts[k] || 0, bad: k === 'failed' && counts.failed > 0 }))];
  return (
    <>
      <Tabs tabs={tabs} value={f.status} onChange={(v) => set('status', v)} label="Message status" />
      <div className="a-listcard">
        <div className="a-filters a-ob-filters">
          <label>Event <select value={f.event} onChange={(e) => set('event', e.target.value)}><option value="">All</option>{d.events.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
          <label>To <select value={f.audience} onChange={(e) => set('audience', e.target.value)}><option value="">Customers and staff</option><option value="customer">Customers</option><option value="staff">Staff</option></select></label>
          <label>Channel <select value={f.channel} onChange={(e) => set('channel', e.target.value)}><option value="">All</option><option value="email">{CHANNEL.email}</option><option value="whatsapp">{CHANNEL.whatsapp}</option></select></label>
          <label className="a-ob-q">Search <input type="search" value={f.q} placeholder="e-mail, subject, invoice no." onChange={(e) => set('q', e.target.value)} /></label>
          <label><input type="checkbox" checked={f.tests} onChange={(e) => set('tests', e.target.checked)} /> Show test mails</label>
        </div>
        <Loading state={list}>
          {list.data && (
            <>
              <div className="a-countline"><b>{list.data.rows.length}</b> message{list.data.rows.length === 1 ? '' : 's'}{list.data.rows.length >= 300 ? ' (the newest 300; narrow the filters)' : ''} · click a row to open it</div>
              <Table className="a-nlog" label="Outbox" rows={list.data.rows} rowKey={(r) => r.log_id} onRowClick={(r) => setOpen(r.log_id)}
                empty={{ icon: 'inbox', title: 'Nothing here', text: 'No message matches.' }}
                columns={[
                  { key: 'log_id', label: 'Message', render: (r) => <><b>#{r.log_id}</b>{r.is_test && <span className="a-muted"> test</span>}<small className="a-sub-l">{fmtDate(r.created_at)} · {CHANNEL[r.channel] || r.channel}{r.lang_code ? ` · ${r.lang_code.toUpperCase()}` : ''}</small></> },
                  { key: 'to', label: 'To', render: (r) => <><b>{r.recipient_name || '-'}</b><small className="a-sub-l">{r.recipient || '(no address)'}</small></> },
                  { key: 'event', label: 'What', hideSm: true, render: (r) => <>{r.event_label}<small className="a-sub-l">{r.subject || '-'}{r.attachments.length ? ` · ${r.attachments.map((a) => ATTACH[a]).join(', ')}` : ''}</small></> },
                  { key: 'status', label: 'Status', render: (r) => <><NoteStatus row={r} />{['skipped', 'prepared'].includes(r.status) && r.skip_reason && <small className="a-sub-l">{r.skip_reason}</small>}
                    {r.status === 'failed' && r.last_error && <small className="a-sub-l a-bad">{r.last_error}</small>}</> },
                  { key: 'about', label: 'About', hideSm: true, render: (r) => <>{r.order_no && <span>{r.order_no}</span>}{r.customer_no && <small className="a-sub-l">{r.customer_no} {r.customer}</small>}{r.ref && !r.order_no && <small className="a-sub-l">{r.ref}</small>}</> },
                ]} />
            </>
          )}
        </Loading>
      </div>
      {open && <MessageDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}

function MessageDrawer({ id, onClose, onChanged }) {
  const canEdit = useCan('settings', 'edit');
  const one = useLoad(`/notifications/log/${id}`);
  const act = useAction();
  const m = one.data;
  const retry = () => act.run(async () => { await api.send('POST', `/notifications/log/${id}/retry`, {}); one.reload(); onChanged(); }, `#${id}: back in the outbox, it goes within a minute`);
  const canRetry = canEdit && m && m.status === 'failed' && m.mail_id && m.channel === 'email';
  return (
    <Drawer title={`Message #${id}`} sub={m ? `${CHANNEL[m.channel] || m.channel} · ${m.event_label}` : undefined} onClose={onClose}
      status={m && <><NoteStatus row={m} />{m.is_test && <span className="a-muted">test mail</span>}</>}
      footer={(
        <>
          {canRetry && <button type="button" className="a-btn" disabled={act.busy} onClick={retry}>Send again</button>}
          <button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        </>
      )}>
      {act.note}
      <Loading state={one}>
        {m && (
          <>
            {m.status === 'failed' && <Alert tone="bad" title="Why it failed.">{` ${m.last_error || 'SendGrid did not take it.'}`}</Alert>}
            {['skipped', 'prepared'].includes(m.status) && m.skip_reason && <Alert tone="info" title={m.status === 'prepared' ? 'Prepared, not sent.' : 'Not sent.'}>{` ${m.skip_reason}`}</Alert>}
            <dl className="a-dl a-ob-dl">
              <div><dt>To</dt><dd>{m.recipient_name || '-'} · {m.recipient || '(no address)'}</dd></div>
              <div><dt>Channel</dt><dd>{CHANNEL[m.channel] || m.channel}{m.lang_code ? ` · ${m.lang_code.toUpperCase()}` : ''}</dd></div>
              <div><dt>Event</dt><dd>{m.event_label}{m.order_no ? ` · ${m.order_no}` : ''}{m.ref && !m.order_no ? ` · ${m.ref}` : ''}</dd></div>
              {m.customer_no && <div><dt>Customer</dt><dd>{m.customer_no} {m.customer}</dd></div>}
              <div><dt>Made</dt><dd>{fmtDate(m.created_at)} by {m.created_by_name || 'the system'}</dd></div>
              {m.mail_id && <div><dt>Mail</dt><dd>#{m.mail_id}, {m.attempts || 0} attempt{Number(m.attempts) === 1 ? '' : 's'}{m.sent_at ? `, sent ${fmtDate(m.sent_at)}` : ''}</dd></div>}
              {m.attachments.length > 0 && <div><dt>Attached</dt><dd>{m.attachments.map((a) => ATTACH[a] || a).join(', ')}</dd></div>}
            </dl>
            <div className="a-ob-msg">
              {m.subject && <p><b>{m.subject}</b></p>}
              <p className="a-ob-body">{m.text_body || '(no text kept for this message)'}</p>
            </div>
          </>
        )}
      </Loading>
    </Drawer>
  );
}
