// Home > Alerts (phase 23, v23 viewAlerts; API /alerts, rules in src/backend_routes/alerts.js).
// Alerts are worked out live from the data, for your sections and godowns; Admins also see the events kept for them
// (an override used, someone marked as left, leave for an Admin, a rule loosened). Open goes to the record and marks it
// read (unread ones are bold); Snooze hides it for you until tomorrow. As v23 the page is the list only: which alert types
// each role gets is set by an Admin on Admin > Notifications (AlertSettings below, shown there), where v23 sets who is told.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, LIcon, Loading, PageHead, Table, useAction, useLoad, useToast } from './ui';

export default function Alerts() {
  const data = useLoad('/alerts');
  const act = useAction();
  const navigate = useNavigate();
  const d = data.data;
  const open = (a) => act.run(async () => { await api.send('POST', '/alerts/mark', { key: a.key, read: true }); navigate(a.link); });
  const snooze = (a) => act.run(async () => { await api.send('POST', '/alerts/mark', { key: a.key, snooze: true }); data.reload(); });
  const list = d ? d.alerts : [];
  const cols = [
    { key: 'title', label: 'Alert', render: (a) => (
      <span className={`a-p23-al ${a.read ? 'a-p23-read' : 'a-p23-unread'}`}>
        <span className={`a-p23-ic a-tone-${a.tone}`}><LIcon name={a.icon} size="sm" /></span>
        <span><b>{a.title}</b><small className="a-muted a-p15-sub">{a.text}{a.at ? ` · ${a.at}` : ''}</small></span>
      </span>) },
    { key: 'section_label', label: 'Section', hideSm: true },
    { key: 'act', label: '', render: (a) => <span className="a-p21-nowrap"><button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => open(a)}>Open</button>
      {a.type !== 'approvals' && <> <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => snooze(a)}>Snooze 1 day</button></>}</span> },
  ];
  return (
    <section>
      <PageHead sub="Low stock, near expiry, unpaid bills" rules={['Worked out live from the data', 'Only your sections and godowns', 'Snooze hides one for a day, for you only']} />
      {act.note}
      <Loading state={data}>{d && <>
        <div className="a-listcard a-p23-full"><Table columns={cols} rows={list} rowKey={(a) => a.key} label="Alerts"
          empty={{ icon: 'bell', title: 'All clear', text: 'Nothing needs you right now.' }} /></div>
      </>}</Loading>
    </section>
  );
}

/** an Admin switches alert types off for a role (shown on Admin > Notifications, Events tab) */
export function AlertSettings() {
  const s = useLoad('/alerts/settings');
  const act = useAction();
  const toast = useToast();
  const [roleId, setRoleId] = useState('');
  const [off, setOff] = useState([]);
  const d = s.data;
  useEffect(() => { if (d && !roleId && d.roles[0]) setRoleId(String(d.roles[0].role_id)); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d && roleId) setOff(d.off[roleId] || []); }, [d, roleId]);
  const save = () => act.run(async () => { await api.send('PUT', '/alerts/settings', { role_id: Number(roleId), off }); toast('good', 'Saved', 'The alerts of this role are set.'); s.reload(); });
  return (
    <Loading state={s}>{d && (
      <div className="a-card a-card-flush">
        <div className="a-card-h"><div><h2>Alerts each role gets</h2><p>Home &gt; Alerts: a type switched off here is not shown to that role</p></div><span className="a-sp" />
          <button type="button" className="a-btn a-btn-ghost" disabled={act.busy || !roleId} onClick={save}>Save</button></div>
        <div className="a-card-b">
        {act.note}
        <Alert tone="info" title="Which alerts a role gets.">A person sees an alert only for the sections their role may view; here an Admin can switch types off for a role. WhatsApp and SMS stay off (no provider).</Alert>
        <label className="a-field"><span>Role</span><select value={roleId} aria-label="Role" onChange={(e) => setRoleId(e.target.value)}>{d.roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}</select></label>
        <div className="a-grid3">
          {d.types.map((t) => (
            <label key={t.key} className="a-inline"><input type="checkbox" checked={!off.includes(t.key)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== t.key) : [...off, t.key])} /> {t.label}</label>
          ))}
        </div>
        </div>
      </div>
    )}</Loading>
  );
}
