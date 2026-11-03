// Admin > Organisation > Numbering (phase 13, v23 Numbering page; API /numbering in numbering-admin.js): one row per
// document with its prefix, the godown code in the number (per godown), restart each year, the next number of every run
// (per godown where per godown) and the length of its longest number. Series already running on stage2 (Built, kept)
// keep their pattern: the prefix box is locked and the switches are refused "kept as built". A prefix whose longest
// number passes 16 characters (GST) is refused with that number; a next number can only go up. Only an Admin changes
// it; every change is audited. "Test: use next number" (v23 test tool) exists outside the live admin only.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, Field, Loading, Notice, PageHead, Pill, useAction, useLoad, useToast } from './ui';

export default function Numbering() {
  const data = useLoad('/numbering');
  const act = useAction();
  const toast = useToast();
  const [typed, setTyped] = useState({}); // doc_key -> prefix being typed
  const [setNext, setSetNext] = useState(null); // series whose next number is being set
  const d = data.data;
  const ro = !d || !d.can_edit || act.busy;
  const tell = (tone, title, text) => (toast ? toast(tone, title, text) : act.setMsg({ kind: tone === 'good' ? 'ok' : 'error', text: `${title}: ${text}` }));

  const save = (s, body) => act.run(async () => {
    try {
      const out = await api.send('PUT', `/numbering/${s.doc_key}`, body);
      if (out && out.saved) tell('good', 'Saved', out.message);
    } catch (e) {
      tell('bad', e.status === 409 && /^Kept as built/.test(e.message) ? 'Kept as built' : 'Not saved', e.message.replace(/^Kept as built\. /, ''));
    }
    setTyped((t) => { const n = { ...t }; delete n[s.doc_key]; return n; });
    data.reload();
  });
  const commitPrefix = (s) => {
    if (!(s.doc_key in typed)) return;
    const v = typed[s.doc_key].trim().toUpperCase();
    if (v === s.prefix) { setTyped((t) => { const n = { ...t }; delete n[s.doc_key]; return n; }); return; }
    save(s, { prefix: v });
  };
  const issue = (s) => act.run(async () => {
    try {
      const out = await api.send('POST', `/numbering/${s.doc_key}/issue`, s.runs[0].godown_id ? { godown_id: s.runs[0].godown_id } : {});
      tell('good', `${out.issued} issued`, out.message.replace(/^\S+ issued\. /, ''));
    } catch (e) {
      tell('bad', 'Not issued', e.message.replace(/^Not issued\. /, ''));
    }
    data.reload();
  });

  const first = d && d.godowns[0];
  const later = d && d.godowns.find((g) => g.in_number);
  const sample = (k, code) => {
    const s = d && d.series.find((x) => x.doc_key === k);
    const r = s && s.runs.find((x) => (code ? x.code === code : true));
    return r ? r.no : '';
  };
  return (
    <section>
      <PageHead title="Numbering" sub="How invoice, order and return numbers look"
        rules={['GST: an invoice number is at most 16 characters', 'Built series are kept as they are', 'A number is never reused, even when the document is cancelled']} />
      <p className="a-lead">Every document gets the next number in its own series. Tax documents run per godown and restart each financial year, so the books of each godown stay continuous. Series already running on stage2 keep their exact pattern.</p>
      {act.note}
      {d && !d.can_edit && <Notice kind="info">View only: only an Admin changes numbering.</Notice>}
      <Loading state={data}>
        {d && (
          <div className="a-listcard">
            <div className="a-scroll">
              <table className="a-table a-numtab">
                <thead>
                  <tr><th>Document</th><th className="a-nsw-hide">On stage2</th><th>Prefix</th><th className="a-nsw-c">Per godown</th><th className="a-nsw-c">Restart each year</th>
                    <th>Next number</th><th className="a-num">Length</th><th aria-label="Actions" /></tr>
                </thead>
                <tbody>
                  {d.series.map((s) => (
                    <tr key={s.doc_key}>
                      <td><b>{s.label}</b>
                        {s.gst && <small className="a-nsw-sub">GST document</small>}</td>
                      <td className="a-nsw-hide">{s.built ? <Pill tone="good">Built, kept</Pill> : <Pill tone="info" title={!s.live && s.section_no ? `Used from section ${s.section_no}` : undefined}>New</Pill>}</td>
                      <td>
                        <input className="a-numin a-nsw-prefix" value={s.doc_key in typed ? typed[s.doc_key] : s.prefix} maxLength={6} aria-label={`${s.label} prefix`}
                          disabled={ro || s.built} title={s.built ? 'Already running on stage2' : undefined}
                          onChange={(e) => setTyped((t) => ({ ...t, [s.doc_key]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                          onBlur={() => commitPrefix(s)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setTyped((t) => { const n = { ...t }; delete n[s.doc_key]; return n; }); }} />
                      </td>
                      <td className="a-nsw-c">
                        {s.fmt === 'slash' ? <Toggle on={s.per_godown} label={`${s.label}: per godown`} disabled={ro} onClick={() => save(s, { per_godown: s.per_godown ? 0 : 1 })} />
                          : <span className="a-muted">no</span>}
                      </td>
                      <td className="a-nsw-c">
                        {s.fmt === 'year' ? <span className="a-muted">each calendar year</span> : s.fmt === 'plain' ? <span className="a-muted">never</span>
                          : <Toggle on={s.fy_reset} label={`${s.label}: restarts each financial year`} disabled={ro} onClick={() => save(s, { fy_reset: s.fy_reset ? 0 : 1 })} />}
                      </td>
                      <td className="a-nsw-runs">
                        {s.runs.map((r) => (
                          <span key={r.key}><code>{r.no}</code>{r.name && s.runs.length > 1 && <small className="a-muted"> {r.name.replace(/ godown.*$/, '')}</small>}</span>
                        ))}
                      </td>
                      <td className="a-num">{s.too_long ? <Pill tone="bad" title={s.too_long}>{s.length} - too long</Pill> : <span className="a-muted">{s.length}</span>}</td>
                      <td className="a-nsw-acts">{d.can_edit && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => setSetNext(s)}>Set next</button>}
                        {d.can_edit && d.test_tool && (
                          <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} title="Test only: pretend one was just made" onClick={() => issue(s)}>Test: use next number</button>
                        )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {d && first && (
          <div className="a-card a-nsw-how">
            <h2>How to read a number</h2>
            <p><code>{sample('invoice', first.code)}</code> = <b>{d.series.find((x) => x.doc_key === 'invoice').prefix}</b> dFresh invoice · <b>{d.fy.short}</b> the financial year April to March · then the running number of that year from {first.name.replace(/ godown.*$/, '')}. On 1 April it starts again at 0001.</p>
            {later && <p><code>{sample('invoice', later.code)}</code> = the same, but <b>{later.code}</b> says it came from {later.name}, which keeps its own count. The first godown has no letter, so the numbers running today do not change.</p>}
            <p><code>{sample('order')}</code> (orders) and <code>{sample('return')}</code> (returns) = prefix, the calendar year, then the running number. <code>{sample('customer')}</code> customer codes never restart.</p>
            <p>Two godowns making invoices on the same day would race for one shared number, so each godown keeps its own unbroken run. A number is taken inside the same save as its document, so two people never get the same one.</p>
          </div>
        )}
      </Loading>
      {setNext && <NextDrawer s={setNext} onClose={() => setSetNext(null)} onSaved={(m) => { setSetNext(null); tell('good', 'Saved', m); data.reload(); }} />}
    </section>
  );
}

function Toggle({ on, label, disabled, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={Boolean(on)} aria-label={label} className="a-switch" disabled={disabled} onClick={onClick}>
      <span className="a-switch-knob" aria-hidden="true" />
    </button>
  );
}

function NextDrawer({ s, onClose, onSaved }) {
  const act = useAction();
  const [godown, setGodown] = useState(s.runs[0].godown_id ? String(s.runs[0].godown_id) : '');
  const run = s.runs.find((r) => String(r.godown_id || '') === godown) || s.runs[0];
  const [next, setNextNo] = useState(String(run.next));
  const save = () => act.run(async () => {
    const out = await api.send('PUT', `/numbering/${s.doc_key}/next`, { godown_id: run.godown_id, next });
    if (out && out.saved) onSaved(out.message); else onClose();
  });
  const godownDef = { name: 'nx-godown', label: 'Godown', type: 'select', allowEmpty: false, options: s.runs.map((r) => ({ value: String(r.godown_id), label: r.name })) };
  const nextDef = { name: 'nx-next', label: 'Next number', type: 'number',
    info: 'Only up: a number already used is never issued again. Raising it leaves the numbers in between unused for good.' };
  return (
    <Drawer title={`${s.label}: next number`} onClose={onClose} dirty={next !== String(run.next)}
      footer={<button type="button" className="a-btn" disabled={act.busy} onClick={save}>Save</button>}>
      {act.note}
      <div className="a-grid2">
        {s.runs.length > 1 && <Field def={godownDef} value={godown} onChange={(v) => { setGodown(v); const r = s.runs.find((x) => String(x.godown_id) === v); if (r) setNextNo(String(r.next)); }} />}
        <Field def={nextDef} value={next} onChange={(v) => setNextNo(String(v).replace(/\D/g, ''))} />
      </div>
      <p className="a-muted">{run.last ? <>Last used: <code>{run.no.replace(/\d+$/, String(run.last).padStart(s.digits, '0'))}</code>. </> : 'None used yet this period. '}
        Today the next is <code>{run.no}</code>.</p>
    </Drawer>
  );
}
