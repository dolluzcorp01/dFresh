// What a banner button or a home door does (phase 24: the doors take the banner button list, src/shared/siteTargets.js):
// products (the drawer), products_home (the drawer, "For Home"), products_category (the drawer, one category),
// section (a home page section; "products" = the Products link: the drawer) or form (a form). to() is the real URL
// (a new tab, a crawler); run() is what a plain click does instead (the drawer or the form), or nothing for a section.
import { useOpenForm } from '../forms/FormsProvider';
import { useOpenProducts } from '../products/useOpenProducts';
import { linkTarget } from './navLinks';

export function actionTo(lang, action, target) {
  if (action === 'products_home') return `/${lang}/products?cat=home`;
  if (action === 'products_category') return `/${lang}/products?cat=${encodeURIComponent(target || '')}`;
  if (action === 'section' && target !== 'products') return linkTarget(lang, { hash: target });
  if (action === 'form') return `/${lang}`;
  return `/${lang}/products`;
}

/** (e, action, target, ref) -> handles a plain click (prevents the navigation) or leaves it to the link */
export function useRunAction() {
  const openProducts = useOpenProducts();
  const openForm = useOpenForm();
  return (e, action, target, ref) => {
    if (action === 'section' && target !== 'products') return; // a plain link to the section
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { if (action !== 'form') return; } // a new tab keeps the URL
    e.preventDefault();
    if (action === 'form') openForm(target, ref ? { ref } : undefined);
    else if (action === 'products_home') openProducts({ filter: 'home' }, e.currentTarget);
    else if (action === 'products_category') openProducts({ category: target }, e.currentTarget);
    else openProducts({}, e.currentTarget);
  };
}
