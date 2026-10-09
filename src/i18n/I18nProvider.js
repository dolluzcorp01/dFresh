// Loads /languages once, then the bootstrap for the URL's language (docs/04_I18N.md), and applies that
// language to the document: <html lang dir data-script>, the script font, the saved choice.
// Bootstraps are cached in memory per language, so switching back is instant.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getJSON } from '../utils/api';
import { initAnalytics, setTrackLanguage } from '../utils/track';
import { LoadingShell, LoadError } from '../components/LoadState';
import { fontVar, loadFont } from './fonts';
import { saveLang, swapLang } from './langRoutes';
import { I18nContext, LanguagesContext, useLanguages } from './useT';

let languagesRequest = null;
const bootRequests = new Map(); // lang -> Promise<bootstrap data>; a failed request is forgotten

function fetchLanguages() {
  if (!languagesRequest) {
    languagesRequest = getJSON('/api/dfresh/languages').catch((err) => {
      languagesRequest = null;
      throw err;
    });
  }
  return languagesRequest;
}

function fetchBootstrap(lang) {
  if (!bootRequests.has(lang)) {
    bootRequests.set(lang, getJSON(`/api/dfresh/bootstrap?lang=${encodeURIComponent(lang)}`).catch((err) => {
      bootRequests.delete(lang);
      throw err;
    }));
  }
  return bootRequests.get(lang);
}

// Called once at startup: /languages and the URL language's bootstrap start together instead of one
// after the other (the first screen waits for both). A guess that is not an active language only costs
// one unused request; LangGate still decides.
export function prefetchContent(pathname) {
  const first = pathname.split('/')[1] || '';
  if (first === 'admin') return;
  fetchLanguages().catch(() => {});
  if (/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(first)) fetchBootstrap(first).catch(() => {});
}

export function LanguagesProvider({ children }) {
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchLanguages().then(
      (data) => alive && setState({ status: 'ready', data }),
      () => alive && setState({ status: 'error' })
    );
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  if (state.status === 'loading') return <LoadingShell />;
  if (state.status === 'error') return <LoadError onRetry={retry} />;
  return <LanguagesContext.Provider value={state.data}>{children}</LanguagesContext.Provider>;
}

const warned = new Set();
function missingKey(key) {
  if (process.env.NODE_ENV === 'production') return '';
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[i18n] missing ui_text key "${key}"`);
  }
  return key; // visible in development so the gap gets noticed
}

function makeT(ui) {
  return (key, vars) => {
    const value = ui[key];
    if (value === undefined) return missingKey(key);
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (m, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
  };
}

// A script whose font differs from the default language's gets the "long script" type tuning.
function isLongScript(info, defaultInfo) {
  return Boolean(info.fontFamily && defaultInfo && info.fontFamily !== defaultInfo.fontFamily);
}

function applyLanguage(info, defaultInfo) {
  const root = document.documentElement;
  root.lang = info.htmlLang;
  root.dir = info.dir === 'rtl' ? 'rtl' : 'ltr';
  if (isLongScript(info, defaultInfo)) root.dataset.script = 'long';
  else delete root.dataset.script;
  const f = fontVar(info.fontFamily);
  if (f) root.style.setProperty('--f-lang', f);
  else root.style.removeProperty('--f-lang');
  loadFont(info.fontFamily);
}

// `lang` is an active language code (LangGate checked it). While another language loads, the
// current one stays on screen, so switching never flashes a skeleton.
export function I18nProvider({ lang, children }) {
  const { languages, default: defaultLang } = useLanguages();
  const location = useLocation();
  // `asked` = the lang whose request produced `data` (differs from `lang` while a switch is loading).
  const [state, setState] = useState({ status: 'loading', data: null, asked: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchBootstrap(lang).then(
      (data) => alive && setState({ status: 'ready', data, asked: lang }),
      () => alive && setState((s) => ({ ...s, status: 'error' }))
    );
    return () => { alive = false; };
  }, [lang, attempt]);

  const data = state.data;
  const info = data && languages.find((l) => l.code === data.lang);

  useEffect(() => {
    if (!info) return;
    applyLanguage(info, languages.find((l) => l.code === defaultLang) || info);
    saveLang(info.code);
    setTrackLanguage(info.code);
    initAnalytics(data.settings.ga4_measurement_id);
  }, [info, data, languages, defaultLang]);

  const value = useMemo(() => {
    if (!data || !info) return null;
    const longScript = isLongScript(info, languages.find((l) => l.code === defaultLang));
    return { lang: data.lang, info, data, settings: data.settings, t: makeT(data.ui), longScript };
  }, [data, info, languages, defaultLang]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    setAttempt((n) => n + 1);
  }, []);

  if (state.status === 'error') return <LoadError onRetry={retry} />;
  if (!value) return <LoadingShell />;
  // The server answers an unknown / just-deactivated language with the default one: follow it.
  if (state.status === 'ready' && state.asked === lang && data.lang !== lang) {
    return <Navigate to={{ ...location, pathname: swapLang(location.pathname, data.lang) }} replace />;
  }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

