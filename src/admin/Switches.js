// Admin > Settings > Switches (phase 13, v23 Switches page; API GET /switches in numbering-admin.js, saved through
// PUT /commerce-settings/:key): the company-wide yes / no rules and the few numbers that steer every section, in groups
// down the left like Company (Turn on, Stock, Orders, Delivery, Money, Wallet, Returns, Approvals, System). Each switch
// shows what it does and an example; a number shows its unit and the allowed min and max (the server refuses
// anything outside). A change that loosens a control waits for a second Admin (second-admin.js): nothing changes yet,
// a warn toast says so and the switch shows its waiting line until it is decided in Approvals. Only an Admin changes a
// switch; every change is audited. The other settings and the lists stay on Commerce settings.
// The address names the group: /admin/switches#money opens Money.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { LIcon, Loading, Notice, PageHead, Pill, fmtDate, useAction, useLoad, useToast } from './ui';

const ICON = { 'Turn on': 'circle-check', Stock: 'package', Orders: 'shopping-cart', Delivery: 'truck', Money: 'receipt', Wallet: 'wallet', Returns: 'inbox', Approvals: 'clipboard-check', System: 'settings' };
const slug = (g) => g.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const LOOSEN_WORDS = { up: 'Raising it', down: 'Lowering it', on: 'Switching it on', off: 'Switching it off' };

export default function Switches() {
  const data = useLoad('/switches');
  const act = useAction();
  const toast = useToast();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [typed, setTyped] = useState({}); // key -> number being typed
  const d = data.data;
  const fromHash = d ? d.groups.find((g) => slug(g) === decodeURIComponent(hash.slice(1))) : null;
  const [cur, setCur] = useState(null);
  useEffect(() => { if (fromHash) setCur(fromHash); }, [fromHash]);
  const group = d ? (d.groups.includes(cur) ? cur : d.groups[0]) : null;
  const ro = !d || !d.can_edit || act.busy;
  const tell = (tone, title, text) => (toast ? toast(tone, title, text) : act.setMsg({ kind: tone === 'good' ? 'ok' : 'error', text: `${title}: ${text}` }));
  const shown = (s, v) => (s.type === 'bool' ? (v === '1' ? 'on' : 'off') : s.type === 'select' ? ((s.options.find(([k]) => k === v) || [])[1] || v) : `${v}${s.unit ? ` ${s.unit}` : ''}`);

  const save = (s, value) => act.run(async () => {
    try {
      const out = await api.send('PUT', `/commerce-settings/${s.key}`, { value });
      if (out && out.waiting) tell('warn', 'Waiting for a second Admin', `${s.label}: ${out.waiting}`);
      else if (String(out.value) !== String(s.value)) {
        if (s.key === 'commerce_enabled') tell(value === '1' ? 'warn' : 'good', value === '1' ? 'Commerce is on' : 'Commerce is off', value === '1' ? 'Stage 2 menus appear for staff with the rights. dfresh.us itself does not change.' : 'Stage 2 menus are hidden again; nothing recorded is lost.');
        else tell('good', 'Saved', `${s.label}: ${shown(s, out.value)}.`);
      }
    } catch (e) {
      tell('bad', 'Not saved', `${s.label}: ${e.message}`);
    }
    setTyped((t) => { const n = { ...t }; delete n[s.key]; return n; });
    data.reload();
  });
  const commitNumber = (s) => {
    if (!(s.key in typed)) return;
    const v = String(typed[s.key]).trim();
    if (v === String(s.value)) { setTyped((t) => { const n = { ...t }; delete n[s.key]; return n; }); return; }
    save(s, v);
  };
  const pick = (g) => { setCur(g); navigate({ hash: slug(g) }, { replace: true }); };

  return (
    <section>
      <PageHead title="Switches" sub="Turn features on or off without a developer"
        rules={['Every change is logged with old and new value', 'Applies from now, never backwards', 'Loosening a control waits for a second Admin']} />
      <p className="a-lead">The yes or no rules and the few numbers that decide how the business runs. The rest of the settings and the lists stay in <Link to="/admin/commerce-settings">Commerce settings</Link>.</p>
      {act.note}
      {d && !d.can_edit && <Notice kind="info">View only: only an Admin changes the switches.</Notice>}
      <Loading state={data}>
        {d && (
          <div className="a-nsw-lay">
            <nav className="a-nsw-nav" aria-label="Groups">
              <div className="a-nsw-navh">Groups</div>
              {d.groups.map((g) => {
                const waits = d.switches.filter((s) => s.group === g && s.waiting).length;
                return (
                  <button key={g} type="button" aria-current={g === group} onClick={() => pick(g)}>
                    <LIcon name={ICON[g] || 'settings'} size="sm" /><span>{g}</span>{waits > 0 && <span className="a-ncount">{waits}<span className="a-sr"> waiting</span></span>}
                  </button>
                );
              })}
            </nav>
            <div className="a-card a-nsw-card">
              <h2>{group}</h2>
              {d.switches.filter((s) => s.group === group).map((s) => (
                <div key={s.key} className="a-nsw-row" id={`sw-${s.key}`}>
                  <div className="a-nsw-txt">
                    <b>{s.label}{s.tbc && <> <Pill tone="warn">To be confirmed</Pill></>}</b>
                    {s.about && <span>{s.about}</span>}
                    {s.example && <em>{s.example}</em>}
                    {s.loosens && <small className="a-muted">{Array.isArray(s.loosens) ? `Changing it to "${shown(s, s.loosens[1])}"` : LOOSEN_WORDS[s.loosens]} waits for a second Admin.</small>}
                    {s.waiting && <small className="a-nsw-wait">Waits for a second Admin: {s.waiting.summary} (request {s.waiting.approval_id})</small>}
                    {s.updated_by && <small className="a-muted">Changed {fmtDate(s.updated_at)} by {s.updated_by}</small>}
                  </div>
                  <div className="a-nsw-ctl">
                    {s.type === 'bool' && (
                      <span className="a-switch-row">
                        <button type="button" role="switch" aria-checked={s.value === '1'} aria-label={s.label} className="a-switch" disabled={ro}
                          onClick={() => save(s, s.value === '1' ? '0' : '1')}><span className="a-switch-knob" aria-hidden="true" /></button>
                        <strong>{s.value === '1' ? 'On' : 'Off'}</strong>
                      </span>
                    )}
                    {s.type === 'select' && (
                      <select value={s.value} aria-label={s.label} disabled={ro} onChange={(e) => save(s, e.target.value)}>
                        {s.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    )}
                    {(s.type === 'int' || s.type === 'decimal') && (
                      <>
                        <span className="a-above">
                          {s.unit === 'Rs' && <span>Rs</span>}
                          <input type="number" className="a-numin" min={s.min ?? 0} max={s.max ?? undefined} step={s.type === 'decimal' ? '0.01' : '1'} aria-label={s.label} disabled={ro}
                            value={s.key in typed ? typed[s.key] : s.value} onChange={(e) => setTyped((t) => ({ ...t, [s.key]: e.target.value }))}
                            onBlur={() => commitNumber(s)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                          {s.unit && s.unit !== 'Rs' && <span className="a-muted">{s.unit}</span>}
                        </span>
                        {s.min !== null && <small className="a-muted a-nsw-range">{s.unit === 'Rs' ? `Rs ${s.min} to Rs ${s.max}` : `${s.min} to ${s.max}${s.unit ? ` ${s.unit}` : ''}`}</small>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Loading>
    </section>
  );
}
