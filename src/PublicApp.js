// Public site: language-prefixed routes (docs/04_I18N.md) inside the global frame (header, footer,
// WhatsApp button, forms, content protection).
import { useEffect, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { I18nProvider, LanguagesProvider } from './i18n/I18nProvider';
import { useI18n, useLanguages } from './i18n/useT';
import { fixLangPath, pickStartLang, splitPath } from './i18n/langRoutes';
import { FormsProvider } from './forms/FormsProvider';
import { LegalProvider } from './legal/LegalProvider';
import { installProtection } from './utils/protect';
import Header from './components/Header';
import Footer from './components/Footer';
import WhatsAppFab from './components/WhatsAppFab';
import HomePage from './pages/HomePage';
import ProductsPage from './pages/ProductsPage';
import LegalPage from './pages/LegalPage';
import ProductsOverlay from './products/ProductsOverlay';
import { isProductsPath } from './products/useOpenProducts';
import { pageMeta } from './shared/pageMeta';

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
      <LegalProvider>
        <FormsProvider>
          <Layout />
        </FormsProvider>
      </LegalProvider>
    </I18nProvider>
  );
}

function Layout() {
  const { lang, data } = useI18n();
  const location = useLocation();
  // Products drawer opened from inside the site: the URL is /:lang/products, the page under it is state.bg.
  const bg = location.state && location.state.bg;
  const overlay = Boolean(bg) && isProductsPath(location.pathname);
  const page = overlay ? bg : location;
  const isHome = splitPath(page.pathname).rest.replace(/\/$/, '') === '';

  useEffect(() => installProtection(), []);

  // Tab title for the URL in the address bar (the server sent the first one, seo.js; same keys, pageMeta.js).
  useEffect(() => {
    const name = splitPath(location.pathname).rest.replace(/^\/+|\/+$/g, '');
    const cat = name === 'products' ? new URLSearchParams(location.search).get('cat') : null;
    const category = cat ? data.categories.find((c) => c.key === cat) : null;
    document.title = pageMeta(name, data.ui, category).title;
  }, [location.pathname, location.search, data]);

  // New page -> top. Not for a language switch (keepScroll), a #section link (HomePage scrolls to it), or
  // the products overlay opening / closing over the same page.
  useLayoutEffect(() => {
    if (!page.hash && !(location.state && location.state.keepScroll)) window.scrollTo(0, 0);
  }, [page.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Header overHero={isHome} />
      <main id="main">
        <Routes location={page}>
          <Route index element={<HomePage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="privacy" element={<LegalPage page="privacy" />} />
          <Route path="terms" element={<LegalPage page="terms" />} />
          <Route path="*" element={<Navigate to={`/${lang}`} replace />} />
        </Routes>
      </main>
      <Footer />
      <WhatsAppFab />
      <ProductsOverlay active={overlay} />
    </>
  );
}
