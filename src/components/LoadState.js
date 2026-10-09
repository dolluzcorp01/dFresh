// Loading skeleton (same header height as the real one, so nothing jumps) and the "did not load" screen.
// The error screen shows exactly when the API is unreachable, so its words come from fallbackText.json,
// a snapshot generated from the DB by scripts/i18n-fallback.js (runs before every build).
import fallback from '../i18n/fallbackText.json';
import { mediaUrl } from '../utils/api';
import { readSavedLang, splitPath } from '../i18n/langRoutes';
import { waHref } from '../utils/whatsapp';
import { RetryIcon, WhatsAppIcon } from './Icons';
import './LoadState.css';

const LOGO = '/media/logo/dfresh-logo-on-light.webp';

export function LoadingShell() {
  return (
    <div className="ls" aria-busy="true">
      <div className="ls-top">
        <div className="wrap">
          <img className="ls-logo" src={mediaUrl(LOGO)} alt="" width="900" height="498" />
          <i className="ls-pill ls-pill-l" />
          <i className="ls-pill ls-pill-s" />
        </div>
      </div>
      <div className="ls-hero">
        <div className="wrap">
          <i className="ls-bar" style={{ width: '38%' }} />
          <i className="ls-bar ls-bar-h" style={{ width: '72%' }} />
          <i className="ls-bar ls-bar-h" style={{ width: '54%' }} />
          <i className="ls-bar" style={{ width: '62%' }} />
        </div>
      </div>
    </div>
  );
}

function errorLanguage() {
  const known = (code) => fallback.languages.find((l) => l.code === code);
  const fromUrl = splitPath(window.location.pathname).first.toLowerCase();
  return known(fromUrl) || known(readSavedLang()) || known(fallback.default) || fallback.languages[0];
}

export function LoadError({ onRetry }) {
  const lang = errorLanguage();
  const text = { ...fallback.text[fallback.default], ...pickNonEmpty(fallback.text[lang.code]) };
  return (
    <div className="ls-err" lang={lang.htmlLang} dir={lang.dir} role="alert">
      <img className="ls-err-logo" src={mediaUrl(LOGO)} alt="dFresh" width="900" height="498" />
      <h1>{text.load_err_h}</h1>
      <p>{text.load_err_p}</p>
      <div className="ls-err-ctas">
        <button type="button" className="btn b-ink" onClick={onRetry}>
          <RetryIcon />
          {text.retry}
        </button>
        <a className="btn b-wa" href={waHref(fallback.whatsappNumber, text.wa_general)} target="_blank" rel="noopener noreferrer">
          <WhatsAppIcon />
          {text.whatsapp_us}
        </a>
      </div>
    </div>
  );
}

function pickNonEmpty(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v));
}
