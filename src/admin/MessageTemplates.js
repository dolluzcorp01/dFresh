// Admin > Communications > Message templates (v23 "templates": one row per event and channel, a column per language;
// API GET /notifications, PUT /notifications/templates/:event/:lang, POST /notifications/preview and /notifications/test).
// Logic unchanged: per event and language a subject and a text with {placeholders}; an empty non-default language uses
// the default language's text; a default Tamil / Hindi text carries "Check the wording" until someone saves it once.
// A click on a row opens the drawer: the language tabs, subject and text (click a placeholder to insert it), a live
// preview with real demo data (the dFresh mail look), who it would go to, Save, "Use <default> instead", "Send test to me"
// (to the signed-in person only; the mail goes through the outbox like every other).
// View on Settings = read only; edit = save, remove a language, send a test.
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Drawer, Notice, Pill, Table, fmtDate, useAction, useCan, useConfirm } from './ui';
import { ATTACH, CHANNEL, goesTo } from './notifyShared';

/** the state of one event in one language: written, check the wording, or uses the default language */
function LangPill({ t, isDefault, defName }) {
  if (!t) return isDefault ? <Pill tone="bad">Missing</Pill> : <Pill tone="gray" title={`Customers with this language get the ${defName} text`}>{defName}</Pill>;
  if (t.needs_review) return <Pill tone="warn" title="A default translation: check it with Dolluz, then save it once">Check the wording</Pill>;
  return <Pill tone="good">Written</Pill>;
}

export default function MessageTemplates({ d, reload }) {
  const [open, setOpen] = useState(null); // event key
  const def = d.languages.find((l) => Number(l.is_default) === 1) || d.languages[0];
  const others = d.languages.filter((l) => l.lang_code !== def.lang_code);
  const review = d.events.reduce((n, e) => n + Object.values(e.templates).filter((t) => t.needs_review).length, 0);
  const columns = [
    { key: 'label', label: 'Event', render: (e) => <><b>{e.label}</b><small className="a-sub-l">{goesTo(e)}{e.attach ? ` · ${ATTACH[e.attach]}` : ''}</small></> },
    { key: 'channel', label: 'Channel', render: () => CHANNEL.email },
    { key: 'def', label: def.name_en, hideSm: true, className: 'a-mt-snip', render: (e) => (e.templates[def.lang_code] ? <small>{e.templates[def.lang_code].subject}</small> : <LangPill t={null} isDefault defName={def.name_en} />) },
    ...others.map((l) => ({ key: `l-${l.lang_code}`, label: l.name_en, render: (e) => <LangPill t={e.templates[l.lang_code]} defName={def.name_en} /> })),
  ];
  return (
    <>
      {review > 0 && <Notice kind="warn">{review} text{review === 1 ? '' : 's'} marked &quot;Check the wording&quot;: default translations nobody has saved yet. Open the event, check the wording with Dolluz, then Save.</Notice>}
      {[['customer', 'Customer messages'], ['staff', 'Staff messages']].map(([aud, title]) => (
        <div key={aud} className="a-listcard">
          <div className="a-cardh"><h2>{title}</h2></div>
          <Table label={title} rows={d.events.filter((e) => e.audience === aud)} rowKey={(e) => e.key} onRowClick={(e) => setOpen(e.key)} columns={columns} />
        </div>
      ))}
      {open && <TemplateDrawer d={d} eventKey={open} onClose={() => setOpen(null)} reload={reload} />}
    </>
  );
}

function TemplateDrawer({ d, eventKey, onClose, reload }) {
  const canEdit = useCan('settings', 'edit');
  const act = useAction();
  const confirm = useConfirm();
  const def = d.languages.find((l) => Number(l.is_default) === 1) || d.languages[0];
  const ev = d.events.find((e) => e.key === eventKey);
  const [lang, setLang] = useState(def.lang_code);
  const saved = ev.templates[lang] || null;
  const [draft, setDraft] = useState({ subject: saved ? saved.subject : '', body: saved ? saved.body : '' });
  const dirty = draft.subject !== (saved ? saved.subject : '') || draft.body !== (saved ? saved.body : '');
  const bodyRef = useRef(null);
  const [prev, setPrev] = useState({ data: null, error: null });
  const [test, setTest] = useState(null);

  // after a save the reloaded text is the saved one
  const savedKey = saved ? `${saved.subject}\u0000${saved.body}` : '';
  useEffect(() => { setDraft({ subject: saved ? saved.subject : '', body: saved ? saved.body : '' }); }, [lang, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (next) => {
    if (next === lang) return;
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'This text has changes that are not saved.', action: 'Discard', cancel: 'Keep editing', danger: true }))) return;
    setLang(next); setTest(null);
  };
  // live preview with real demo data, 400 ms after the last key
  useEffect(() => {
    const t = setTimeout(() => {
      const empty = !draft.subject && !draft.body;
      api.send('POST', '/notifications/preview', { event: eventKey, lang: empty ? def.lang_code : lang, ...(empty ? {} : draft) })
        .then((p) => setPrev({ data: p, error: null }), (e) => setPrev({ data: null, error: e.message }));
    }, 400);
    return () => clearTimeout(t);
  }, [eventKey, lang, draft, def.lang_code]);

  const insert = (v) => {
    const el = bodyRef.current;
    const tag = `{${v}}`;
    if (!el) { setDraft((x) => ({ ...x, body: x.body + tag })); return; }
    const a = el.selectionStart; const b = el.selectionEnd;
    const body = draft.body.slice(0, a) + tag + draft.body.slice(b);
    setDraft((x) => ({ ...x, body }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const save = () => act.run(async () => { await api.send('PUT', `/notifications/templates/${eventKey}/${lang}`, draft); reload(); }, `${ev.label} (${lang.toUpperCase()}): saved`);
  const useDefault = async () => {
    if (!(await confirm({ title: `Use ${def.name_en} for ${ev.label}?`, message: `The ${lang.toUpperCase()} text is removed; customers with this language get the ${def.name_en} mail.`, action: 'Remove', danger: true }))) return;
    act.run(async () => { await api.send('PUT', `/notifications/templates/${eventKey}/${lang}`, { subject: '', body: '' }); setDraft({ subject: '', body: '' }); reload(); }, `${lang.toUpperCase()} removed: ${def.name_en} is used`);
  };
  const sendTest = () => act.run(async () => {
    setTest(await api.send('POST', '/notifications/test', { event: eventKey, lang, ...(draft.subject || draft.body ? draft : {}) }));
  }, null);
  const isDefault = lang === def.lang_code;
  const lt = d.languages.find((l) => l.lang_code === lang);

  const footer = (
    <>
      {canEdit && <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>Save</button>}
      {canEdit && dirty && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => setDraft({ subject: saved ? saved.subject : '', body: saved ? saved.body : '' })}>Undo changes</button>}
      {canEdit && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={sendTest}>Send test to me</button>}
      {canEdit && !isDefault && saved && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={useDefault}>Use {def.name_en} instead</button>}
      {!canEdit && <button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>}
    </>
  );
  return (
    <Drawer title={ev.label} sub={`${CHANNEL.email} · ${goesTo(ev)}`} onClose={onClose} dirty={dirty} wide footer={footer}>
      {act.note}
      <div className="a-chips a-mt-langs" role="tablist" aria-label="Language">
        {d.languages.map((l) => {
          const t = ev.templates[l.lang_code];
          return (
            <button key={l.lang_code} type="button" role="tab" aria-selected={lang === l.lang_code} className={`a-chip${lang === l.lang_code ? ' on' : ''}`} onClick={() => choose(l.lang_code)}>
              {l.name_en}{!t ? ` (uses ${def.name_en})` : t.needs_review ? ' - check the wording' : ''}
            </button>
          );
        })}
      </div>
      <div className="a-tpl">
        <div className="a-tpl-edit">
          {saved && saved.needs_review && <Notice kind="warn">Check the wording: a default {lt ? lt.name_en : lang} translation. Check it with Dolluz, then Save (the mark goes away).</Notice>}
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
          {saved && saved.updated_by && <p className="a-muted">Last saved by {saved.updated_by}, {fmtDate(saved.updated_at)}</p>}
          {test && (
            <Notice kind={test.outcome === 'sent' ? 'ok' : test.outcome === 'failed' ? 'error' : 'warn'} onClose={() => setTest(null)}>
              Test &quot;{test.subject}&quot; to {test.to}{test.attach ? ` with the ${ATTACH[test.attach.kind]}` : ''}: {test.outcome === 'sent' ? 'sent' : test.outcome === 'off' ? `queued (${test.reason})` : `${test.outcome}${test.reason ? ` - ${test.reason}` : ''}`}
            </Notice>
          )}
        </div>
        <div className="a-tpl-prev">
          <h3 className="a-mt-h">Preview with real demo data</h3>
          {prev.error && <Notice kind="error">{prev.error}</Notice>}
          {prev.data && (
            <>
              <p className="a-muted">{prev.data.sample}{prev.data.customer ? `: ${prev.data.customer}` : ''}.
                {ev.audience === 'customer' && <> Would go to: {prev.data.recipients.length ? prev.data.recipients.map((r) => `${r.name} <${r.email}>`).join(', ') : 'nobody (no e-mail address)'}.</>}
                {prev.data.attach && <> Attached: {ATTACH[prev.data.attach.kind]}.</>}</p>
              <p className="a-mailsubj"><b>{prev.data.subject}</b></p>
              <iframe className="a-mailprev" title="Mail preview" srcDoc={prev.data.html} sandbox="" />
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
