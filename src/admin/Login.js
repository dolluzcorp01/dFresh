// Two-step sign-in: dAdmin e-mail + password, then the 6-digit code from the e-mail (spec F).
import { useState } from 'react';
import { api } from './adminApi';
import { Notice } from './ui';

export default function Login({ onSignedIn }) {
  const [step, setStep] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'password') {
        const data = await api.send('POST', '/login', { email, password });
        setSentTo(data.sentTo);
        setPassword('');
        setStep('code');
      } else {
        await api.send('POST', '/login/verify', { code });
        onSignedIn();
      }
    } catch (err) {
      setError(err.message);
      if (step === 'code' && /sign in again/i.test(err.message)) { setStep('password'); setCode(''); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="adm a-center">
      <form className="a-card a-login" onSubmit={submit}>
        <h1>dFresh admin</h1>
        {step === 'password' ? (
          <>
            <p className="a-muted">Sign in with your dAdmin e-mail and password.</p>
            <label className="a-field"><span>E-mail</span>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="a-field"><span>Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p className="a-muted">We sent a 6-digit code to {sentTo}. It is valid for 10 minutes.</p>
            <label className="a-field"><span>Code</span>
              <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </label>
          </>
        )}
        <Notice kind="error">{error}</Notice>
        <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Please wait...' : step === 'password' ? 'Continue' : 'Sign in'}</button>
        {step === 'code' && <button type="button" className="a-btn a-btn-ghost" onClick={() => { setStep('password'); setCode(''); setError(null); }}>Start again</button>}
      </form>
    </main>
  );
}
