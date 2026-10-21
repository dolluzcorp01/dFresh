// Setup > Notifications (docs/COMMERCE-SPEC.md 5.5f; API /notifications, logic in src/backend_routes/notifications.js).
// Tabs:
// - Events and channels: e-mail on / off, WhatsApp and SMS "provider not set up" (off, locked); each customer and staff
//   event on / off with who gets it and what is attached; the reminder numbers; the daily mails and "Run daily mails now".
//   The switches and numbers are Commerce settings (saved at once, audited).
// - Templates: per event and language, subject and text with {placeholders} (click one to insert it), a live preview with
//   real demo data (the dFresh mail look), who it would go to, and "Send test to me". An empty non-default language
//   uses the default language's text. Default Tamil / Hindi texts carry "Check the wording" until saved once.
// - Log: every message with event, recipient, status (queued / sent / failed / not sent), the order or customer it
//   belongs to; a failed mail can be sent again.
// View on Settings = everything read only; edit = switches, templates, test mail, retry, run now.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLeaveGuard, useLoad } from './ui';

const TABS = [['events', 'Events and channels'], ['templates', 'Templates'], ['log', 'Log']];
const TO = { order: 'The order contact', invoice: 'Contacts with "gets invoices"', customer: "The customer's e-mail" };
const STAFF_TO = { approval: 'Approvers who may decide it', stock_daily: 'Users with edit on Inventory', follow_ups: 'Each follow-up owner',
  delivery_failed: 'Users who plan trips', cash_difference: 'Users who plan trips', daily_summary: 'Admin users' };
const ATTACH = { invoice: 'Invoice PDF', credit_note: 'Credit note PDF', statement: 'Statement PDF' };
const STATUS = { queued: 'Queued', sent: 'Sent', failed: 'Failed', skipped: 'Not sent', cancelled: 'Cancelled' };
const STATUS_CLASS = { queued: 'a-status-test', sent: 'a-status-on', failed: 'a-status-bad', skipped: 'a-status-off', cancelled: 'a-status-off' };

export function NoteStatus({ row }) {
  return (
    <span className={`a-status ${STATUS_CLASS[row.status] || ''}`} title={row.status === 'skipped' ? row.skip_reason : row.last_error || undefined}>
      {STATUS[row.status] || row.status}
    </span>
  );
}

export default function Notifications() {
  const data = useLoad('/notifications');
  const [tab, setTab] = useState('events');
  const d = data.data;
  return (
    <section>
      <h1>Notifications</h1>
      <InfoCard title="What customers and staff are told, and how">
        <ul>
          <li>Every message is an e-mail from the mail outbox (sender: Settings &gt; mail_from). It is saved with the change that caused it and sent within a minute; a SendGrid outage only delays it.</li>
          <li>Customers get their mails in their language (Customers &gt; the customer &gt; Mails in); an empty template uses English. Invoices, statements and credit notes are attached as PDF.</li>
          <li>A customer can opt out of reminders and offers, never of invoices. An order waiting for approval sends nothing until it is confirmed.</li>
          {d && d.week && <li>Last 7 days: {['sent', 'queued', 'failed', 'skipped'].map((k) => `${d.week[k] || 0} ${STATUS[k].toLowerCase()}`).join(', ')}.</li>}
        </ul>
      </InfoCard>
      <div className="a-chips a-tabs" role="tablist" aria-label="Notifications">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`a-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <Loading state={data}>
        {d && tab === 'events' && <Events d={d} reload={data.reload} />}
        {d && tab === 'templates' && <Templates d={d} reload={data.reload} />}
        {d && tab === 'log' && <Log d={d} />}
      </Loading>
    </section>
  );
}

// ---------------------------------------------------------------- events and channels
function Switch({ on, label, disabled, onChange }) {
  return (
    <span className="a-switch-row">
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="a-switch" disabled={disabled} onClick={() => onChange(!on)}>
        <span className="a-switch-knob" aria-hidden="true" />
      </button>
      <span>{on ? 'On' : 'Off'}</span>
    </span>
  );
}

function Events({ d, reload }) {
  const canEdit = useCan('settings', 'edit');
  const act = useAction();
  const s = Object.fromEntries(d.settings.map((x) => [x.setting_key, x]));
  const put = (key, value, ok) => act.run(async () => { await api.send('PUT', `/commerce-settings/${key}`, { value }); reload(); }, ok);
  const mailOn = s.notify_email && s.notify_email.value === '1';
  const [nums, setNums] = useState({});
  const [runs, setRuns] = useState(null);
  const numKeys = d.settings.filter((x) => x.value_type === 'int');
  const runNow = () => act.run(async () => { setRuns(await api.send('POST', '/notifications/run-daily', {})); reload(); }, 'Daily mails: done (each job runs once a day)');
  const row = (ev) => {
    const set = ev.setting;
    const on = set && set.value === '1';
    return (
      <tr key={ev.key} className={on ? '' : 'a-off'}>
        <td><b>{ev.label}</b>{set && <small className="a-muted a-person-sub">{set.help}</small>}</td>
        <td>{ev.audience === 'staff' ? STAFF_TO[ev.key] : TO[ev.to]}</td>
        {ev.audience === 'customer' && <td>{ev.attach ? ATTACH[ev.attach] : '-'}</td>}
        {ev.audience === 'customer' && <td>{[ev.reminder ? 'Reminder (opt-out)' : null, ev.daily ? 'Daily' : null].filter(Boolean).join(', ') || '-'}</td>}
        {ev.audience === 'staff' && <td>{ev.daily ? 'Daily' : 'At once'}</td>}
        <td>{set && <Switch on={on} label={ev.label} disabled={!canEdit || act.busy} onChange={(v) => put(set.setting_key, v ? '1' : '0', `${ev.label}: ${v ? 'on' : 'off'}`)} />}</td>
      </tr>
    );
  };
  return (
    <>
      {act.note}
      <h2>Channels</h2>
      <div className="a-tiles a-channels">
        <div className="a-tile"><span className="a-tile-l">E-mail</span><Switch on={mailOn} label="E-mail" disabled={!canEdit || act.busy} onChange={(v) => put('notify_email', v ? '1' : '0', `E-mail notifications ${v ? 'on' : 'off'}`)} />
          <small className="a-muted">SendGrid, through the mail outbox</small></div>
        {['notify_whatsapp', 'notify_sms'].map((k) => (
          <div key={k} className="a-tile"><span className="a-tile-l">{s[k] ? s[k].label : k}</span><Switch on={false} label={s[k] ? s[k].label : k} disabled onChange={() => {}} />
            <small className="a-muted">Provider not set up</small></div>
        ))}
      </div>
      {!mailOn && <Notice kind="warn">E-mail is off: no notification is sent (they are not even logged).</Notice>}
      <h2>Customer messages</h2>
      <div className="a-scroll"><table className="a-table a-events">
        <thead><tr><th>Event</th><th>Goes to</th><th>Attached</th><th>Kind</th><th>On</th></tr></thead>
        <tbody>{d.events.filter((e) => e.audience === 'customer').map(row)}</tbody>
      </table></div>
      <h2>Reminder numbers and the daily time</h2>
      <div className="a-grid2">
        {numKeys.map((x) => {
          const v = x.setting_key in nums ? nums[x.setting_key] : x.value;
          return (
            <label key={x.setting_key} className="a-field"><span>{x.label}</span>
              <span className="a-inline">
                <input type="number" min="0" value={v} disabled={!canEdit} aria-label={x.label} onChange={(e) => setNums((n) => ({ ...n, [x.setting_key]: e.target.value }))} />
                {v !== x.value && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => put(x.setting_key, v, `${x.label}: ${v}`).then(() => setNums((n) => { const c = { ...n }; delete c[x.setting_key]; return c; }))}>Save</button>}
              </span>
              <small className="a-muted">{x.help}</small>
            </label>
          );
        })}
      </div>
      <h2>Staff messages</h2>
      <div className="a-scroll"><table className="a-table a-events">
        <thead><tr><th>Event</th><th>Goes to</th><th>When</th><th>On</th></tr></thead>
        <tbody>{d.events.filter((e) => e.audience === 'staff').map(row)}</tbody>
      </table></div>
      <p className="a-muted">Staff mails go to each user&apos;s notification e-mail (Setup &gt; <Link to="/admin/users">Admin users</Link>; empty = their dAdmin e-mail).</p>
      <h2>Daily mails</h2>
      <p>Overdue reminders, wallet expiry, stock, follow-ups and the Admin summary go out once a day from {s.notify_daily_hour ? s.notify_daily_hour.value : 9}:00 India time.
        {canEdit && <> <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={runNow}>Run daily mails now</button></>}</p>
      {runs && <ul>{runs.map((r) => <li key={r.job}><b>{(d.events.find((e) => e.key === r.job) || {}).label || r.job}</b>: {r.result}</li>)}</ul>}
      {d.runs.length > 0 && (
        <div className="a-scroll"><table className="a-table">
          <thead><tr><th>Day</th><th>Job</th><th>Result</th><th>Ran at</th></tr></thead>
          <tbody>{d.runs.map((r) => <tr key={`${r.run_day}-${r.job_key}`}><td>{r.run_day}</td><td>{(d.events.find((e) => e.key === r.job_key) || {}).label || r.job_key}</td><td>{r.result}</td><td>{fmtDate(r.ran_at)}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- templates
function Templates({ d, reload }) {
  const canEdit = useCan('settings', 'edit');
  const act = useAction();
  const confirm = useConfirm();
  const def = d.languages.find((l) => Number(l.is_default) === 1) || d.languages[0];
  const [event, setEvent] = useState(d.events[0].key);
  const [lang, setLang] = useState(def.lang_code);
  const ev = d.events.find((e) => e.key === event);
  const saved = ev.templates[lang] || null;
  const [draft, setDraft] = useState({ subject: saved ? saved.subject : '', body: saved ? saved.body : '' });
  const dirty = draft.subject !== (saved ? saved.subject : '') || draft.body !== (saved ? saved.body : '');
  useLeaveGuard(dirty);
  const bodyRef = useRef(null);
  const [prev, setPrev] = useState({ data: null, error: null });
  const [test, setTest] = useState(null);

  // a new event or language: its saved text (asks first when the current one has unsaved changes)
  const choose = async (nextEvent, nextLang) => {
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'This template has changes that are not saved.', action: 'Discard', cancel: 'Keep editing', danger: true }))) return;
    const e = d.events.find((x) => x.key === nextEvent);
    const t = e.templates[nextLang] || null;
    setEvent(nextEvent); setLang(nextLang); setTest(null);
    setDraft({ subject: t ? t.subject : '', body: t ? t.body : '' });
  };
  // live preview with real demo data, 400 ms after the last key
  useEffect(() => {
    const t = setTimeout(() => {
      const empty = !draft.subject && !draft.body;
      api.send('POST', '/notifications/preview', { event, lang: empty ? def.lang_code : lang, ...(empty ? {} : draft) })
        .then((p) => setPrev({ data: p, error: null }), (e) => setPrev({ data: null, error: e.message }));
    }, 400);
    return () => clearTimeout(t);
  }, [event, lang, draft, def.lang_code]);

  const insert = (v) => {
    const el = bodyRef.current;
    const tag = `{${v}}`;
    if (!el) { setDraft((x) => ({ ...x, body: x.body + tag })); return; }
    const a = el.selectionStart; const b = el.selectionEnd;
    const body = draft.body.slice(0, a) + tag + draft.body.slice(b);
    setDraft((x) => ({ ...x, body }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const save = () => act.run(async () => {
    await api.send('PUT', `/notifications/templates/${event}/${lang}`, draft);
    reload();
  }, `${ev.label} (${lang.toUpperCase()}): saved`);
  const useDefault = async () => {
    if (!(await confirm({ title: `Use ${def.name_en} for ${ev.label}?`, message: `The ${lang.toUpperCase()} text is removed; customers with this language get the ${def.name_en} mail.`, action: 'Remove', danger: true }))) return;
    act.run(async () => { await api.send('PUT', `/notifications/templates/${event}/${lang}`, { subject: '', body: '' }); setDraft({ subject: '', body: '' }); reload(); }, `${lang.toUpperCase()} removed: ${def.name_en} is used`);
  };
  const sendTest = () => act.run(async () => {
    const r = await api.send('POST', '/notifications/test', { event, lang, ...(draft.subject || draft.body ? draft : {}) });
    setTest(r);
  }, null);
  const isDefault = lang === def.lang_code;
  const lt = d.languages.find((l) => l.lang_code === lang);

  return (
    <>
      {act.note}
      <div className="a-toolbar">
        <label className="a-field"><span>Event</span>
          <select value={event} aria-label="Event" onChange={(e) => choose(e.target.value, lang)}>
            <optgroup label="Customers">{d.events.filter((e) => e.audience === 'customer').map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</optgroup>
            <optgroup label="Staff">{d.events.filter((e) => e.audience === 'staff').map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</optgroup>
          </select>
        </label>
        <div className="a-chips" role="tablist" aria-label="Language">
          {d.languages.map((l) => {
            const t = ev.templates[l.lang_code];
            return (
              <button key={l.lang_code} type="button" role="tab" aria-selected={lang === l.lang_code} className={`a-chip${lang === l.lang_code ? ' on' : ''}`} onClick={() => choose(event, l.lang_code)}>
                {l.name_en}{!t ? ' (uses default)' : t.needs_review ? ' - check' : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div className="a-tpl">
        <div className="a-tpl-edit">
          {saved && saved.needs_review && <Notice kind="warn">A default {lt ? lt.name_en : lang} translation: check the wording with Dolluz, then Save (the mark goes away).</Notice>}
          {!saved && !isDefault && <Notice kind="info">No {lt ? lt.name_en : lang} text: these customers get the {def.name_en} mail. Type a subject and text to add one.</Notice>}
          <fieldset className="a-plainset" disabled={!canEdit}>
            <label className="a-field"><span>Subject</span>
              <input type="text" value={draft.subject} maxLength={200} aria-label="Subject" lang={lang} onChange={(e) => setDraft((x) => ({ ...x, subject: e.target.value }))} />
            </label>
            <label className="a-field"><span>Text (a blank line starts a new paragraph)</span>
              <textarea ref={bodyRef} rows={14} value={draft.body} maxLength={5000} aria-label="Text" lang={lang} onChange={(e) => setDraft((x) => ({ ...x, body: e.target.value }))} />
            </label>
            <div className="a-field"><span>Placeholders (click to insert)</span>
              <div className="a-chips">{ev.vars.map((v) => <button key={v} type="button" className="a-chip" onClick={() => insert(v)}>{`{${v}}`}</button>)}</div>
            </div>
          </fieldset>
          <div className="a-toolbar">
            {canEdit && <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>Save</button>}
            {canEdit && dirty && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setDraft({ subject: saved ? saved.subject : '', body: saved ? saved.body : '' })}>Cancel</button>}
            {canEdit && !isDefault && saved && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={useDefault}>Use {def.name_en} instead</button>}
            {canEdit && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={sendTest}>Send test to me</button>}
          </div>
          {saved && saved.updated_by && <p className="a-muted">Last saved by {saved.updated_by}, {fmtDate(saved.updated_at)}</p>}
          {test && (
            <Notice kind={test.outcome === 'sent' ? 'ok' : test.outcome === 'failed' ? 'error' : 'warn'} onClose={() => setTest(null)}>
              Test &quot;{test.subject}&quot; to {test.to}{test.attach ? ` with the ${ATTACH[test.attach.kind]}` : ''}: {test.outcome === 'sent' ? 'sent' : test.outcome === 'off' ? `queued (${test.reason})` : `${test.outcome}${test.reason ? ` - ${test.reason}` : ''}`}
            </Notice>
          )}
        </div>
        <div className="a-tpl-prev">
          {prev.error && <Notice kind="error">{prev.error}</Notice>}
          {prev.data && (
            <>
              <p className="a-muted">Preview with real demo data ({prev.data.sample}){prev.data.customer ? `: ${prev.data.customer}` : ''}.
                {ev.audience === 'customer' && <> Would go to: {prev.data.recipients.length ? prev.data.recipients.map((r) => `${r.name} <${r.email}>`).join(', ') : 'nobody (no e-mail address)'}.</>}
                {prev.data.attach && <> Attached: {ATTACH[prev.data.attach.kind]}.</>}</p>
              <p className="a-mailsubj"><b>{prev.data.subject}</b></p>
              <iframe className="a-mailprev" title="Mail preview" srcDoc={prev.data.html} sandbox="" />
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- log
function Log({ d }) {
  const canEdit = useCan('settings', 'edit');
  const [f, setF] = useState({ event: '', status: '', audience: '', q: '', tests: false });
  const qs = new URLSearchParams(Object.entries({ ...f, tests: f.tests ? '1' : '' }).filter(([, v]) => v)).toString();
  const list = useLoad(`/notifications/log${qs ? `?${qs}` : ''}`);
  const act = useAction();
  const retry = (r) => act.run(async () => { await api.send('POST', `/notifications/log/${r.log_id}/retry`, {}); list.reload(); }, `#${r.log_id} queued again`);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      {act.note}
      <div className="a-filters">
        <label>Event <select value={f.event} onChange={(e) => set('event', e.target.value)}><option value="">All</option>{d.events.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
        <label>Status <select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>To <select value={f.audience} onChange={(e) => set('audience', e.target.value)}><option value="">Customers and staff</option><option value="customer">Customers</option><option value="staff">Staff</option></select></label>
        <label>Search <input type="search" value={f.q} placeholder="e-mail, subject, invoice no." onChange={(e) => set('q', e.target.value)} /></label>
        <label><input type="checkbox" checked={f.tests} onChange={(e) => set('tests', e.target.checked)} /> Show test mails</label>
      </div>
      <Loading state={list}>
        {list.data && (list.data.rows.length ? (
          <div className="a-scroll"><table className="a-table a-nlog">
            <thead><tr><th>When</th><th>Event</th><th>To</th><th>Subject</th><th>Status</th><th>About</th><th /></tr></thead>
            <tbody>{list.data.rows.map((r) => (
              <tr key={r.log_id}>
                <td>{fmtDate(r.created_at)}<small className="a-muted a-person-sub">#{r.log_id}{r.is_test ? ' test' : ''}</small></td>
                <td>{r.event_label}<small className="a-muted a-person-sub">{r.audience}{r.lang_code ? `, ${r.lang_code.toUpperCase()}` : ''}{r.attachments.length ? `, ${r.attachments.map((a) => ATTACH[a]).join(', ')}` : ''}</small></td>
                <td>{r.recipient_name}<small className="a-muted a-person-sub">{r.recipient || '(no address)'}</small></td>
                <td>{r.subject || '-'}</td>
                <td><NoteStatus row={r} />{r.status === 'skipped' && <small className="a-muted a-person-sub">{r.skip_reason}</small>}
                  {r.status === 'failed' && <small className="a-bad a-person-sub">{r.last_error}</small>}
                  {r.mail_id && <small className="a-muted a-person-sub">mail #{r.mail_id}, {r.attempts || 0} attempt(s){r.sent_at ? `, sent ${fmtDate(r.sent_at)}` : ''}</small>}</td>
                <td>{r.order_no && <span>{r.order_no}</span>}{r.customer_no && <small className="a-muted a-person-sub">{r.customer_no} {r.customer}</small>}{r.ref && !r.order_no && <small className="a-muted a-person-sub">{r.ref}</small>}</td>
                <td>{canEdit && r.status === 'failed' && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => retry(r)}>Send again</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="a-muted">No messages match.</p>)}
      </Loading>
    </>
  );
}
