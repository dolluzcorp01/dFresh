// One button per active language (spec A1). Switching keeps path, query and hash, and the scroll
// position (HomePage does not jump to the hash when state.keepScroll is set).
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n, useLanguages, useT } from '../i18n/useT';
import { swapLang } from '../i18n/langRoutes';
import { fontVar, labelFamily, loadLabelFont } from '../i18n/fonts';
import { track } from '../utils/track';

export default function LanguageSwitch() {
  const { languages } = useLanguages();
  const { lang } = useI18n();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    languages.forEach((l) => loadLabelFont(l.fontFamily, l.switchLabel));
  }, [languages]);

  const pick = (code) => {
    if (code === lang) return;
    track('language_change', { to: code });
    navigate(
      { pathname: swapLang(location.pathname, code), search: location.search, hash: location.hash },
      { state: { keepScroll: true }, preventScrollReset: true }
    );
  };

  return (
    <div className="langs" role="group" aria-label={t('lang_label')}>
      {languages.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.htmlLang}
          aria-pressed={l.code === lang}
          style={fontVar(l.fontFamily) ? { fontFamily: `"${labelFamily(l.fontFamily)}", ${fontVar(l.fontFamily)}, var(--f-body)` } : undefined}
          onClick={() => pick(l.code)}
        >
          {l.switchLabel}
        </button>
      ))}
    </div>
  );
}
