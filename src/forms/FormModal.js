// One form component, five configs (spec D). Validation on blur and on submit with the shared rules; the
// first invalid field gets focus. Submit -> POST /api/dfresh/leads. A network / server error or the rate
// limit keeps everything typed and shows a message above the button, so the visitor can simply retry.
// Success: tick, "Thank you, <name>!", ok_bro / bro_pending / ok_other, WhatsApp button; a brochure lead
// with a PDF starts the download in a hidden frame (an error page there stays invisible).
// Typed data is never lost by accident: a click on the backdrop does nothing (closeOnScrim false); X or Esc on
// a form with typed values first asks "Close without sending?" inside the modal (Esc there = keep editing).
// A draft of the fields (never the honeypot, never the consent tick) is kept in sessionStorage per form type
// while typing, restored when the same form opens again in the same tab, and removed after a successful send.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Modal from '../components/Modal';
import { WhatsAppIcon } from '../components/Icons';
import { useI18n } from '../i18n/useT';
import { useOpenLegal } from '../legal/LegalProvider';
import { API_BASE, apiFetch, mediaUrl } from '../utils/api';
import { track } from '../utils/track';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import { formConfig } from './formConfig';
import { checkField } from './validate';
import './Forms.css';

// Example text inside the phone / e-mail boxes (Translations ph_tel / ph_email).
const PLACEHOLDER = { tel: 'ph_tel', email: 'ph_email' };

function startDownload(token) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'download';
  frame.src = `${API_BASE}/api/dfresh/brochure/download?token=${encodeURIComponent(token)}`;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 60000);
}

// Product chips: every card, plus a prefilled colour variant right after its card (it is what they picked).
function productChoices(products, prefill) {
  const list = [];
  for (const p of products) {
    list.push({ id: p.id, name: p.name });
    for (const v of p.variants) {
      if (prefill.includes(v.id)) list.push({ id: v.id, name: v.name === p.name ? `${v.name} (${v.colourName})` : v.name });
    }
  }
  return list;
}

// What the form shows when nothing was typed: empty fields plus what the opener prefilled (a card's product,
// a kit's business type). "Typed" = any difference from this.
function baseValues(cfg, prefill) {
  const values = {};
  for (const f of cfg.fields) values[f.name] = f.type === 'pick' ? [] : '';
  if (prefill && Array.isArray(prefill.products)) values.products = [...prefill.products];
  if (prefill && prefill.businessType && 'business_type' in values) values.business_type = prefill.businessType;
  return values;
}

// Drafts: sessionStorage (this tab only), one per form type. Storage can be missing or throw (private
// mode, blocked site data): then there is simply no draft.
const draftKey = (type) => `dfresh:form-draft:${type}`;

function readDraft(type, cfg) {
  try {
    const d = JSON.parse(window.sessionStorage.getItem(draftKey(type)) || 'null');
    if (!d || typeof d !== 'object') return null;
    const out = {};
    for (const f of cfg.fields) {
      const v = d[f.name];
      if (f.type === 'pick' && Array.isArray(v)) out[f.name] = v.filter((x) => typeof x === 'string').slice(0, 100);
      else if (f.type !== 'pick' && typeof v === 'string') out[f.name] = v.slice(0, f.max || 2000);
    }
    return out;
  } catch {
    return null;
  }
}

function writeDraft(type, values) {
  try {
    window.sessionStorage.setItem(draftKey(type), JSON.stringify(values));
  } catch {
    // no storage: no draft
  }
}

function clearDraft(type) {
  try {
    window.sessionStorage.removeItem(draftKey(type));
  } catch {
    // no storage: nothing to clear
  }
}

// Draft first, then the opener's prefill on top (a card's product is added to the drafted ones).
function initialValues(type, cfg, prefill) {
  const values = { ...baseValues(cfg, prefill), ...(readDraft(type, cfg) || {}) };
  if (prefill && Array.isArray(prefill.products) && Array.isArray(values.products)) {
    values.products = [...new Set([...values.products, ...prefill.products])];
  }
  if (prefill && prefill.businessType && 'business_type' in values) values.business_type = prefill.businessType;
  return values;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Field({ field, uid, value, error, options, choices, onChange, onBlur, t, autoFocus }) {
  const id = `${uid}-${field.name}`;
  const errId = `${id}-e`;
  const opt = field.required ? null : <> <span className="opt">({t('optional')})</span></>;
  const common = {
    id, name: field.name, 'data-autofocus': autoFocus || undefined, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? errId : undefined,
  };
  let control;
  if (field.type === 'pick') {
    control = (
      <div className="pick" role="group" aria-labelledby={`${id}-l`} aria-describedby={error ? errId : undefined}>
        {choices.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              value={p.id}
              checked={value.includes(p.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id), true)}
            />
            <span>{p.name}</span>
          </label>
        ))}
      </div>
    );
  } else if (field.type === 'select') {
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value, true)} onBlur={onBlur}>
        <option value="">{t('choose')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (field.type === 'textarea') {
    control = <textarea {...common} value={value} maxLength={field.max} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
  } else {
    const htmlType = field.type === 'email' || field.type === 'tel' ? field.type : 'text';
    control = (
      <input
        {...common}
        type={htmlType}
        value={value}
        maxLength={field.max}
        autoComplete={field.autoComplete || 'off'}
        inputMode={field.type === 'tel' ? 'tel' : undefined}
        autoCapitalize={field.type === 'gst' ? 'characters' : undefined}
        placeholder={PLACEHOLDER[field.type] ? t(PLACEHOLDER[field.type]) : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    );
  }
  return (
    <div className={`f${field.full ? ' full' : ''}${error ? ' bad' : ''}`}>
      {field.type === 'pick'
        ? <span className="lb" id={`${id}-l`}>{t(field.label)}{opt}</span>
        : <label htmlFor={id}>{t(field.label)}{opt}</label>}
      {control}
      <span className="err" id={errId} aria-live="polite">{error ? t(error) : ''}</span>
    </div>
  );
}

export default function FormModal({ type, prefill, source, onClose }) {
  const { t, lang, data, settings } = useI18n();
  const openLegal = useOpenLegal();
  const uid = useId();
  const cfg = useMemo(() => formConfig(type), [type]);
  const base = useMemo(() => baseValues(cfg, prefill), [cfg, prefill]);
  const [values, setValues] = useState(() => initialValues(type, cfg, prefill));
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef(null);
  const backTo = useRef(null); // where focus was when the close question opened
  const [errors, setErrors] = useState({});
  const [consent, setConsent] = useState(false);
  const [consentBad, setConsentBad] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | sending | net | rate | done
  const [result, setResult] = useState(null);
  const formRef = useRef(null);
  const honeypot = useRef(null);
  const doneRef = useRef(null);

  const choices = useMemo(
    () => productChoices(data.products, (prefill && prefill.products) || []),
    [data.products, prefill]
  );
  // The first field takes focus where there is a mouse; on touch the dialog does, so the phone keyboard
  // does not cover the form the moment it opens (same rule as the products drawer search).
  const [focusFirst] = useState(() => window.matchMedia('(hover: hover)').matches);
  const optionsFor = (f) => (f.list && data.formOptions[f.list]) || [];

  const check = (f, v = values[f.name]) => {
    const err = checkField(f, v, optionsFor(f));
    setErrors((e) => (e[f.name] === err ? e : { ...e, [f.name]: err }));
    return err;
  };

  const focusFirstBad = (bad) => {
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;
      const name = cfg.fields.map((f) => f.name).find((n) => bad[n]);
      const el = name ? form.querySelector(`[name="${name}"], [aria-labelledby="${uid}-${name}-l"] input`) : form.querySelector('.consent input');
      if (el) el.focus();
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (status === 'sending') return;
    const bad = {};
    for (const f of cfg.fields) {
      const err = checkField(f, values[f.name], optionsFor(f));
      if (err) bad[f.name] = err;
    }
    setErrors(bad);
    setConsentBad(!consent);
    if (Object.keys(bad).length || !consent) {
      focusFirstBad(bad);
      return;
    }

    setStatus('sending');
    const payload = {
      form_type: type, lang, source_page: source.page, source_ref: source.ref, consent: true,
      website: honeypot.current ? honeypot.current.value : '', ...values,
    };
    let res;
    let json = null;
    try {
      res = await apiFetch('/api/dfresh/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      json = await res.json().catch(() => null);
    } catch {
      setStatus('net');
      return;
    }
    if (res.ok && json && json.success) {
      const d = json.data;
      track('form_submit', { form: type });
      if (type === 'brochure' && d.brochure_token) {
        startDownload(d.brochure_token);
        track('brochure_download', { lang });
      }
      setResult(d);
      setStatus('done');
      requestAnimationFrame(() => {
        const x = doneRef.current && doneRef.current.closest('.modal').querySelector('.xbtn');
        if (x) x.focus();
      });
    } else if (res.status === 400 && json && json.fields && Object.keys(json.fields).length) {
      const { consent: c, ...fields } = json.fields;
      setErrors(fields);
      setConsentBad(Boolean(c));
      setStatus('idle');
      focusFirstBad(fields);
    } else {
      setStatus(res.status === 429 ? 'rate' : 'net');
    }
  };

  const done = status === 'done';
  const typed = !done && !same(values, base);

  // The draft follows every change; nothing typed = no draft. After a successful send it is gone for good.
  useEffect(() => {
    if (done) clearDraft(type);
    else if (typed) writeDraft(type, values);
    else clearDraft(type);
  }, [values, done, typed, type]);

  // X / Esc. Untyped or sent: close. Typed: ask first; Esc while asking = back to editing.
  const requestClose = (reason) => {
    if (!typed) return onClose();
    if (confirming) {
      if (reason === 'esc') keepEditing();
      return undefined;
    }
    backTo.current = document.activeElement;
    setConfirming(true);
    return undefined;
  };
  const keepEditing = () => {
    setConfirming(false);
    requestAnimationFrame(() => {
      const el = backTo.current;
      if (el && document.contains(el) && !el.classList.contains('xbtn')) el.focus();
      else if (formRef.current) {
        const first = formRef.current.querySelector('input:not([type="hidden"]), select, textarea');
        if (first) first.focus();
      }
    });
  };
  useEffect(() => {
    if (confirming && keepRef.current) keepRef.current.focus();
  }, [confirming]);

  const firstName = (values.first_name || values.full_name || '').trim().split(/\s+/)[0];
  const doneMsg = type !== 'brochure' ? 'ok_other' : result && result.brochure_available ? 'ok_bro' : 'bro_pending';
  const logo = <img className="mlogo" src={mediaUrl('/media/logo/dfresh-logo-on-light.webp')} alt="dFresh" width="900" height="498" />;

  return (
    <Modal open onClose={requestClose} closeOnScrim={false} title={t(cfg.title)} before={logo} labelledBy={done ? `${uid}-done` : null}
      className={done ? 'm-done' : undefined}>
      {done ? (
        <div className="done" ref={doneRef}>
          <div className="tick" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17 19 7.5" /></svg>
          </div>
          <h3 id={`${uid}-done`}>{t('thanks_name', { name: firstName })}</h3>
          <p className="sub">{t(doneMsg)}</p>
          {result && result.lead_ref && (
            // The preview's note slot (there: "preview only"); on the live site the visitor's reference.
            <p className="note">{t('mail_ack_ref')}: <strong>{result.lead_ref}</strong>. {t('mail_ack_keep')}</p>
          )}
          <a className="btn b-wa" href={waHref(settings.whatsapp_number, t('wa_general'))} target="_blank" rel="noopener noreferrer"
            onClick={() => trackWhatsApp('general', `form_${type}`)}>
            <WhatsAppIcon /><span>{t('whatsapp_us')}</span>
          </a>
        </div>
      ) : (
        <>
          <p className="sub">{t(cfg.sub)}</p>
          <form className="form" ref={formRef} noValidate onSubmit={submit}>
            {cfg.fields.map((f, i) => (
              <Field
                key={f.name}
                autoFocus={focusFirst && i === 0}
                field={f}
                uid={uid}
                t={t}
                value={values[f.name]}
                error={errors[f.name]}
                options={optionsFor(f)}
                choices={choices}
                onChange={(v, validateNow) => {
                  setValues((s) => ({ ...s, [f.name]: v }));
                  if (validateNow || errors[f.name]) check(f, v);
                }}
                onBlur={() => check(f)}
              />
            ))}
            <label className="hp" aria-hidden="true">
              <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
            <div className={`consent${consentBad ? ' bad' : ''}`}>
              <input
                type="checkbox"
                id={`${uid}-consent`}
                checked={consent}
                aria-invalid={consentBad ? 'true' : undefined}
                onChange={(e) => { setConsent(e.target.checked); if (e.target.checked) setConsentBad(false); }}
              />
              <span>
                <label htmlFor={`${uid}-consent`}>{t('consent')}</label>{' '}
                <button type="button" className="lnk" onClick={() => openLegal('privacy')}>{t('lg_priv_s')}</button>
              </span>
            </div>
            {(status === 'net' || status === 'rate') && (
              <p className="ferr" role="alert">{t(status === 'rate' ? 'e_rate' : 'e_net')}</p>
            )}
            <button className="btn b-ink" type="submit" disabled={status === 'sending'} aria-busy={status === 'sending'}>
              {t(status === 'sending' ? 'sending' : cfg.button)}
            </button>
          </form>
          {confirming && (
            <div className="mconfirm" role="alertdialog" aria-labelledby={`${uid}-cq`}>
              <p id={`${uid}-cq`}>{t('close_confirm')}</p>
              <div className="mconfirm-b">
                <button ref={keepRef} type="button" className="btn b-ink b-sm" onClick={keepEditing}>{t('keep_editing')}</button>
                <button type="button" className="btn b-line b-sm" onClick={() => onClose()}>{t('close')}</button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
