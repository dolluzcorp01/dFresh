// Public site: language-prefixed routes (docs/04_I18N.md) inside the global frame (header, footer,
// WhatsApp button, forms, content protection).
import { useEffect, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { I18nProvider, LanguagesProvider } from './i18n/I18nProvider';
import { useI18n, useLanguages } from './i18n/useT';
import { fixLangPath, pickStartLang, splitPath } from './i18n/langRoutes';
import { FormsProvider } from './forms/FormsProvider';
import { installProtection } from './utils/protect';
import Header from './components/Header';
import Footer from './components/Footer';
import WhatsAppFab from './components/WhatsAppFab';
import HomePage from './pages/HomePage';
import ProductsPage from './pages/ProductsPage';
import LegalPage from './pages/LegalPage';

export default function PublicApp() {
  return (
    <LanguagesProvider>
      <Routes>
        <Route index element={<StartRedirect />} />
        <Route path=":lang/*" element={<LangGate />} />
      </Routes>
    </LanguagesProvider>
  );
}

// `/` -> saved language, else browser language, else default.
function StartRedirect() {
  const { languages, default: defaultLang } = useLanguages();
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: `/${pickStartLang(languages, defaultLang)}`, search, hash }} replace />;
}

// Unknown or inactive prefix -> the same path in the default language.
function LangGate() {
  const { lang } = useParams();
  const { languages, default: defaultLang } = useLanguages();
  const location = useLocation();
  if (!languages.some((l) => l.code === lang)) {
    const pathname = fixLangPath(location.pathname, languages, defaultLang);
    return <Navigate to={{ pathname, search: location.search, hash: location.hash }} replace />;
  }
  return (
    <I18nProvider lang={lang}>
      <FormsProvider>
        <Layout />
      </FormsProvider>
    </I18nProvider>
  );
}

function Layout() {
  const { lang } = useI18n();
  const location = useLocation();
  const isHome = splitPath(location.pathname).rest.replace(/\/$/, '') === '';

  useEffect(() => installProtection(), []);

  // New page -> top. Not for a language switch (keepScroll) or a #section link (HomePage scrolls to it).
  useLayoutEffect(() => {
    if (!location.hash && !(location.state && location.state.keepScroll)) window.scrollTo(0, 0);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Header overHero={isHome} />
      <main id="main">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="privacy" element={<LegalPage page="privacy" />} />
          <Route path="terms" element={<LegalPage page="terms" />} />
          <Route path="*" element={<Navigate to={`/${lang}`} replace />} />
        </Routes>
      </main>
      <Footer />
      <WhatsAppFab />
    </>
  );
}
