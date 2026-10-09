// openProducts({ filter: 'home' } | { category: 'napkins' } | {}, originEl?) from anywhere.
// Phase 3 stub: logs and goes to the /:lang/products page; Phase 4 replaces it with the drawer overlay
// (which opens from originEl, the preview's circle reveal).
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/useT';

export function useOpenProducts() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  return useCallback((opts = {}) => {
    if (process.env.NODE_ENV !== 'production') console.info('[openProducts stub]', opts);
    const cat = opts.category || (opts.filter === 'home' ? 'home' : '');
    navigate({ pathname: `/${lang}/products`, search: cat ? `?cat=${encodeURIComponent(cat)}` : '' });
  }, [lang, navigate]);
}
