// Two-step sign-in: dAdmin e-mail + password, then the 6-digit code from the e-mail (spec F).
// Code step: six digit boxes (type, paste or SMS/mail autofill of the whole code; auto-advance, Backspace goes
// back, it submits itself when the sixth digit is in), "Resend code" after a 30 s countdown. When the server
// says the code is gone (data.restart: expired, too many tries, timed out) the form goes back to step 1 with the
// e-mail kept and the server's message shown.
// Truthful: "We sent a code" only when the server says the mail really went out (data.mail === 'sent'). Outside
// production the server may open the code step without a mail (switched off or failed, data.mailNote); the
// screen then says so and points to the [dev] line in the API terminal. In production an unsent code is an
// error on step 1 (503), so the code step never opens without a mail.
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { Notice } from './ui';

const LOGO = '/media/logo/dfresh-logo-on-light.webp';
const DIGITS = 6;
const empty = () => Array(DIGITS).fill('');
const OFFLINE = 'Cannot reach the dFresh server. Check your connection and try again.';

// Server message, or a plain one when the request never reached the server.
const messageOf = (err) => (err && err.status ? err.message : OFFLINE);

// Development only: why no mail came, and where the code is instead.
const notSent = (data) => `${data.mailNote || 'No e-mail was sent'}, so no code was e-mailed to ${data.sentTo}. Development only: the code is printed in the API terminal ([dev] line).`;

function EyeIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  );
}

function CodeBoxes({ digits, setDigits, disabled, onComplete }) {
  const refs = useRef([]);
  const focus = (i) => { const el = refs.current[Math.max(0, Math.min(DIGITS - 1, i))]; if (el) { el.focus(); el.select(); } };

  // First box when the code step opens, and again whenever the boxes are cleared (wrong code, new code).
  const cleared = digits.every((d) => !d);
  useEffect(() => { if (cleared && !disabled) focus(0); }, [cleared, disabled, digits]);

  // Put a run of digits in from box i (one typed digit, or a pasted / autofilled code).
  const fill = (i, text) => {
    const add = text.replace(/\D/g, '').slice(0, DIGITS);
    if (!add) return;
    const next = [...digits];
    const from = add.length >= DIGITS ? 0 : i;
    [...add].forEach((d, k) => { if (from + k < DIGITS) next[from + k] = d; });
    setDigits(next);
    const gap = next.findIndex((d) => !d);
    if (gap === -1) { focus(DIGITS - 1); onComplete(next.join('')); } else focus(Math.max(gap, Math.min(from + add.length, DIGITS - 1)));
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (next[i]) next[i] = '';
      else if (i > 0) { next[i - 1] = ''; focus(i - 1); }
      setDigits(next);
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(i - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1); }
  };

  return (
    <div className="a-code" role="group" aria-labelledby="a-code-label">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          className={d ? 'filled' : undefined}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${DIGITS}`}
          maxLength={i === 0 ? DIGITS : 1}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) { const next = [...digits]; next[i] = ''; setDigits(next); return; }
            fill(i, v);
          }}
          onPaste={(e) => { e.preventDefault(); fill(i, e.clipboardData.getData('text')); }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export default function Login({ onSignedIn }) {
  const [step, setStep] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [digits, setDigits] = useState(empty);
  const [sent, setSent] = useState(null); // { sentTo, mail, mailNote } from the server
  const [wait, setWait] = useState(0); // seconds until "Resend code" works
  const [busy, setBusy] = useState(''); // '' | 'password' | 'code' | 'resend'
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [refocus, setRefocus] = useState(0); // bump to put focus back in step 1 once its fields are enabled
  const pwRef = useRef(null);
  const emailRef = useRef(null);

  useEffect(() => {
    if (refocus && !busy && step === 'password') (email ? pwRef.current : emailRef.current)?.focus();
  }, [refocus, busy, step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const restart = (message) => {
    setStep('password');
    setDigits(empty());
    setInfo(null);
    setError(message);
    setRefocus((n) => n + 1);
  };

  const signIn = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy('password');
    setError(null);
    try {
      const data = await api.send('POST', '/login', { email, password });
      setSent(data);
      setWait(data.resendAfter || 30);
      setPassword('');
      setShowPw(false);
      setDigits(empty());
      setInfo(null);
      setStep('code');
    } catch (err) {
      setError(messageOf(err));
      setPassword('');
      setRefocus((n) => n + 1);
    } finally {
      setBusy('');
    }
  };

  const verify = async (code) => {
    if (busy || code.length !== DIGITS) return;
    setBusy('code');
    setError(null);
    setInfo(null);
    try {
      await api.send('POST', '/login/verify', { code });
      onSignedIn();
    } catch (err) {
      if (err.data && err.data.data && err.data.data.restart) restart(err.message);
      else { setError(messageOf(err)); setDigits(empty()); }
    } finally {
      setBusy('');
    }
  };

  const resend = async () => {
    if (busy || wait > 0) return;
    setBusy('resend');
    setError(null);
    setInfo(null);
    try {
      const data = await api.send('POST', '/login/resend');
      setSent(data);
      setWait(data.resendAfter || 30);
      setDigits(empty());
      setInfo(data.mail === 'sent' ? `A new code was sent to ${data.sentTo}. The old code no longer works.` : null);
    } catch (err) {
      if (err.data && err.data.data && err.data.data.restart) restart(err.message);
      else {
        setError(messageOf(err));
        if (err.data && err.data.data && err.data.data.resendAfter) setWait(err.data.data.resendAfter);
      }
    } finally {
      setBusy('');
    }
  };

  const onPwKey = (e) => { if (e.getModifierState) setCaps(e.getModifierState('CapsLock')); };
  const spinner = <span className="a-spin" aria-hidden="true" />;

  return (
    <main className="adm a-login-page">
      <div className="a-login-wrap">
        <img className="a-login-logo" src={mediaUrl(LOGO)} alt="dFresh" width="900" height="498" />
        {step === 'password' ? (
          <form className="a-login" onSubmit={signIn} aria-busy={busy === 'password'}>
            <h1>Admin sign in</h1>
            <p className="a-muted">Use your dAdmin e-mail and password. We will e-mail you a 6-digit code next.</p>
            <label className="a-field"><span>E-mail</span>
              <input ref={emailRef} type="email" autoComplete="username" required value={email} disabled={!!busy}
                onChange={(e) => setEmail(e.target.value)} autoFocus={!email} />
            </label>
            <div className="a-field">
              <label htmlFor="a-pw"><span>Password</span></label>
              <div className="a-pw">
                <input id="a-pw" ref={pwRef} type={showPw ? 'text' : 'password'} autoComplete="current-password" required
                  value={password} disabled={!!busy} autoFocus={!!email} aria-describedby={caps ? 'a-caps' : undefined}
                  onChange={(e) => setPassword(e.target.value)} onKeyDown={onPwKey} onKeyUp={onPwKey} onBlur={() => setCaps(false)} />
                <button type="button" className="a-eye" onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw} aria-controls="a-pw">
                  <EyeIcon open={!showPw} />
                </button>
              </div>
              <p id="a-caps" className="a-caps" role="status" aria-live="polite">{caps ? 'Caps Lock is on.' : ''}</p>
            </div>
            <Notice kind="error">{error}</Notice>
            <button type="submit" className="a-btn a-btn-gold a-btn-block" disabled={!!busy}>
              {busy === 'password' ? <>{spinner} Checking...</> : 'Continue'}
            </button>
          </form>
        ) : (
          <form className="a-login" onSubmit={(e) => { e.preventDefault(); verify(digits.join('')); }} aria-busy={busy === 'code'}>
            <h1>Enter your code</h1>
            {sent && sent.mail === 'sent' ? (
              <p className="a-muted" id="a-code-label">We sent a 6-digit code to <strong>{sent.sentTo}</strong>. It works for 10 minutes.</p>
            ) : (
              <p className="a-muted" id="a-code-label">Type the 6-digit code. It works for 10 minutes.</p>
            )}
            {sent && sent.mail !== 'sent' && <Notice kind="warn">{notSent(sent)}</Notice>}
            <CodeBoxes digits={digits} setDigits={setDigits} disabled={busy === 'code'} onComplete={verify} />
            <Notice kind="error">{error}</Notice>
            <Notice kind="ok">{info}</Notice>
            <button type="submit" className="a-btn a-btn-gold a-btn-block" disabled={!!busy || digits.some((d) => !d)}>
              {busy === 'code' ? <>{spinner} Signing in...</> : 'Sign in'}
            </button>
            <div className="a-login-links">
              <button type="button" className="a-link" onClick={resend} disabled={!!busy || wait > 0}>
                {busy === 'resend' ? 'Sending...' : wait > 0 ? `Resend code in ${wait} s` : 'Resend code'}
              </button>
              <button type="button" className="a-link" disabled={!!busy} onClick={() => restart(null)}>Use a different account</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
