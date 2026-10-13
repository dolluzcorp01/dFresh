// Page <title> and meta description per page, built from ui_text keys only (docs/02 SEO, spec G).
// Shared by the server (seo.js, the first HTML a crawler or visitor gets) and the client (document.title on
// in-app navigation and language switches). CommonJS so Node can require it; CRA bundles it as well.
// "dFresh" is the brand name (like the logo artwork), not translatable copy.
const BRAND = 'dFresh';

// Page segment after /:lang -> page name ('' = home). Anything else is not a page.
const PAGES = ['', 'products', 'privacy', 'terms'];

// Each page has its own title / description texts (Translations group "Google and sharing", migration
// 20261013_seo_text.sql): seo_home, seo_products, seo_privacy, seo_terms, seo_cat_<category key>, each with _t / _d.
// A page without them (e.g. a text deleted by hand) falls back to the old pattern built from visible texts.
const seoKey = (page, category) => {
  if (page === 'products') return category ? `seo_cat_${category.key}` : 'seo_products';
  return page ? `seo_${page}` : 'seo_home';
};

/** { title, description } for page ('' | 'products' | 'privacy' | 'terms'), ui = the language's ui_text map,
 *  category = { key, name } when /products?cat=<key> names an active category. */
function pageMeta(page, ui, category) {
  const t = (k) => (ui && ui[k]) || '';
  const key = seoKey(page, category);
  let title = t(`${key}_t`);
  if (!title) {
    if (page === 'products') title = `${category ? category.name : t('all_h')} | ${BRAND}`;
    else if (page === 'privacy') title = `${t('lg_priv_s')} | ${BRAND}`;
    else if (page === 'terms') title = `${t('lg_terms_h')} | ${BRAND}`;
    else title = `${BRAND} - ${t('tagline')} | ${t('eyebrow')}`;
  }
  return { title, description: t(`${key}_d`) || t('lede') };
}

module.exports = { BRAND, PAGES, pageMeta };
