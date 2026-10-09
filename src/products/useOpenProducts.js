// openProducts({ filter: 'home' } | { category: 'napkins' } | {}, originEl?) from anywhere.
// Pushes /:lang/products?cat=... with the current page kept as the background (location.state.bg), so the
// drawer opens over it as an overlay and browser Back closes it (ProductsOverlay in PublicApp).
// originEl: the drawer's circle grows from its centre, and it gets focus back on close.
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import { rememberOpener } from './ProductsDrawer';

export function isProductsPath(pathname) {
  return /^\/[^/]+\/products\/?$/.test(pathname);
}

export function useOpenProducts() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback((opts = {}, originEl) => {
    const cat = opts.category || (opts.filter === 'home' ? 'home' : '');
    const search = cat ? `?cat=${encodeURIComponent(cat)}` : '';
    if (isProductsPath(window.location.pathname)) { // already open: just change the filter
      navigate({ pathname: `/${lang}/products`, search }, { replace: true, state: window.history.state && window.history.state.usr });
      return;
    }
    const r = originEl && originEl.getBoundingClientRect ? originEl.getBoundingClientRect() : null;
    rememberOpener(originEl);
    navigate({ pathname: `/${lang}/products`, search }, {
      state: {
        bg: { pathname: location.pathname, search: location.search, hash: location.hash },
        // kept inside the viewport, so the 150% circle always covers the screen
        origin: r ? {
          x: Math.round(Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth)),
          y: Math.round(Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight)),
        } : null,
        openId: Date.now(),
      },
    });
  }, [lang, navigate, location.pathname, location.search, location.hash]);
}
