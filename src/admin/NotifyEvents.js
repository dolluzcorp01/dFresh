// Admin > Communications > Notifications (v23 "Who gets told about what"; API GET /notifications, the switches and numbers
// are Commerce settings saved with PUT /commerce-settings/:key, audited). Logic unchanged from phase 11 of commerce:
// - Channels: e-mail (notify_email); WhatsApp and SMS "provider not set up" (off, locked).
// - Events and channels: one row per customer and staff event, its e-mail switch (notify_ev_<event>), who gets it, what
//   is attached and whether it is a reminder or daily. The Admin alert is always sent and keeps a WhatsApp copy
//   "prepared" (no provider, never sent).
// - The reminder numbers and the daily hour; the daily mails, "Run daily mails now" and the last runs.
// View on Settings = everything read only; edit = switches, numbers, run now.
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, InfoTip, Pill, fmtDate, useAction, useCan } from './ui';
import { ATTACH, STATUS, Switch, goesTo } from './notifyShared';

export default function NotifyEvents({ d, reload }) {
  const canEdit = useCan('settings', 'edit');
  const act = useAction();
  const s = Object.fromEntries(d.settings.map((x) => [x.setting_key, x]));
  const put = (key, value, ok) => act.run(async () => { await api.send('PUT', `/commerce-settings/${key}`, { value }); reload(); }, ok);
  const mailOn = Boolean(s.notify_email && s.notify_email.value === '1');
  const [nums, setNums] = useState({});
  const [runs, setRuns] = useState(null);
  const numKeys = d.settings.filter((x) => x.value_type === 'int');
  const runNow = () => act.run(async () => { setRuns(await api.send('POST', '/notifications/run-daily', {})); reload(); }, 'Daily mails: done (each job runs once a day)');
  const label = (key) => (d.events.find((e) => e.key === key) || {}).label || key;

  const kind = (ev) => [ev.attach ? ATTACH[ev.attach] : null, ev.reminder ? 'reminder, the customer may opt out' : null, ev.daily ? 'daily' : null].filter(Boolean).join(' · ');
  const row = (ev) => {
    const set = ev.setting;
    const always = !set; // the Admin alert: no switch, always sent
    const on = always || set.value === '1';
    return (
      <tr key={ev.key} className={always || (on && mailOn) ? '' : 'a-off'}>
        <td>
          <b>{ev.label}</b>
          <small className="a-sub-l">{goesTo(ev)}{kind(ev) ? ` · ${kind(ev)}` : ''}</small>
          {set && set.help && <small className="a-sub-l">{set.help}</small>}
        </td>
        <td className="a-nt-c">
          {always ? <Pill tone="gold" title="Guards the company: sent whatever the switches say">Always on</Pill>
            : <Switch on={on} label={`${ev.label} by e-mail`} disabled={!canEdit || act.busy} onChange={(v) => put(set.setting_key, v ? '1' : '0', `${ev.label}: e-mail ${v ? 'on' : 'off'}`)} />}
        </td>
        <td className="a-nt-c">
          {ev.key === 'admin_alert' ? <Pill tone="info" title="Kept in the Outbox as Prepared; never sent until a WhatsApp provider is set up">Copy prepared</Pill>
            : <span className="a-muted" title="No WhatsApp provider is set up">-</span>}
        </td>
        <td className="a-nt-c"><span className="a-muted" title="No SMS provider is set up">-</span></td>
      </tr>
    );
  };
  const groups = [['customer', 'Customers'], ['staff', 'Staff']];
  return (
    <>
      {act.note}
      {!mailOn && <Alert tone="warn" title="E-mail is off.">No notification is sent, and none is written to the Outbox (only the Admin alert still goes).</Alert>}
      <div className="a-listcard">
        <div className="a-cardh"><h2>Channels</h2></div>
        <div className="a-cardb a-nt-channels">
          <div className="a-nt-chan">
            <b>E-mail</b>
            <Switch on={mailOn} label="E-mail" disabled={!canEdit || act.busy} onChange={(v) => put('notify_email', v ? '1' : '0', `E-mail notifications ${v ? 'on' : 'off'}`)} />
            <small className="a-sub-l">SendGrid, through the mail outbox (sender: Settings, mail_from)</small>
          </div>
          {['notify_whatsapp', 'notify_sms'].map((k) => (
            <div key={k} className="a-nt-chan">
              <b>{s[k] ? s[k].label : k}</b>
              <Switch on={false} label={s[k] ? s[k].label : k} disabled onChange={() => {}} />
              <small className="a-sub-l">Provider not set up</small>
            </div>
          ))}
        </div>
      </div>
      <div className="a-listcard">
        <div className="a-cardh"><h2>Events and channels</h2></div>
        <div className="a-tw a-scroll">
          <table className="a-table a-nt-ev">
            <thead><tr><th>Event</th><th className="a-nt-c">E-mail</th><th className="a-nt-c">WhatsApp</th><th className="a-nt-c">SMS</th></tr></thead>
            <tbody>
              {groups.map(([aud, name]) => (
                <Fragment key={aud}>
                  <tr className="a-nt-grp"><td colSpan={4}>{name}</td></tr>
                  {d.events.filter((e) => e.audience === aud).map(row)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="a-listcard">
        <div className="a-cardh"><h2>Reminder numbers and the daily time</h2></div>
        <div className="a-cardb a-grid2">
          {numKeys.map((x) => {
            const v = x.setting_key in nums ? nums[x.setting_key] : x.value;
            return (
              <label key={x.setting_key} className="a-field"><span>{x.label}{x.help && <InfoTip text={x.help} />}</span>
                <span className="a-inline">
                  <input type="number" min="0" value={v} disabled={!canEdit} aria-label={x.label} onChange={(e) => setNums((n) => ({ ...n, [x.setting_key]: e.target.value }))} />
                  {v !== x.value && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => put(x.setting_key, v, `${x.label}: ${v}`).then(() => setNums((n) => { const c = { ...n }; delete c[x.setting_key]; return c; }))}>Save</button>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="a-listcard">
        <div className="a-cardh"><h2>Daily mails</h2>
          {canEdit && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={runNow}>Run daily mails now</button>}
        </div>
        <div className="a-cardb">
          <p className="a-nt-p">Overdue reminders, wallet expiry, stock, follow-ups and the Admin summary go out once a day from {s.notify_daily_hour ? s.notify_daily_hour.value : 9}:00 India time.
            {d.week && <> Last 7 days: {['sent', 'queued', 'failed', 'skipped'].map((k) => `${d.week[k] || 0} ${STATUS[k].toLowerCase()}`).join(', ')}.</>}</p>
          {runs && <ul>{runs.map((r) => <li key={r.job}><b>{label(r.job)}</b>: {r.result}</li>)}</ul>}
        </div>
        {d.runs.length > 0 && (
          <div className="a-tw a-scroll"><table className="a-table">
            <thead><tr><th>Day</th><th>Job</th><th>Result</th><th>Ran at</th></tr></thead>
            <tbody>{d.runs.map((r) => <tr key={`${r.run_day}-${r.job_key}`}><td>{r.run_day}</td><td>{label(r.job_key)}</td><td>{r.result}</td><td>{fmtDate(r.ran_at)}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
      <p className="a-muted">Staff mails go to each user&apos;s notification e-mail (Admin &gt; Users and security &gt; <Link to="/admin/users">Staff</Link>; empty = their dAdmin e-mail).</p>
    </>
  );
}
