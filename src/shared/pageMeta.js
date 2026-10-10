// Page <title> and meta description per page, built from ui_text keys only (docs/02 SEO, spec G).
// Shared by the server (seo.js, the first HTML a crawler or visitor gets) and the client (document.title on
// in-app navigation and language switches). CommonJS so Node can require it; CRA bundles it as well.
// "dFresh" is the brand name (like the logo artwork), not translatable copy.
const BRAND = 'dFresh';

// Page segment after /:lang -> page name ('' = home). Anything else is not a page.
const PAGES = ['', 'products', 'privacy', 'terms'];

/** { title, description } for page ('' | 'products' | 'privacy' | 'terms'), ui = the language's ui_text map,
 *  category = { name } when /products?cat=<key> names an active category. */
function pageMeta(page, ui, category) {
  const t = (k) => (ui && ui[k]) || '';
  let title;
  if (page === 'products') title = `${category ? category.name : t('all_h')} | ${BRAND}`;
  else if (page === 'privacy') title = `${t('lg_priv_s')} | ${BRAND}`;
  else if (page === 'terms') title = `${t('lg_terms_h')} | ${BRAND}`;
  else title = `${BRAND} - ${t('tagline')} | ${t('eyebrow')}`;
  return { title, description: t('lede') };
}

module.exports = { BRAND, PAGES, pageMeta };
