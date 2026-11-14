// Where a banner button, a home door or a menu link may go (phase 24): ONE list for the API (checks), the admin (the
// pickers) and the site (the links). Picked, never typed, so a link can never break; no other website (owner, Stage 3).
// CommonJS: the server requires it, the admin and the site import it.

// Banner buttons and home doors: what they do (cta_action) and, when it needs one, its target
const ACTIONS = ['products', 'products_home', 'products_category', 'section', 'form'];
// home page sections a button, a door or a menu link may jump to ("products" = the Products link: the drawer)
const SECTIONS = ['business', 'where', 'about', 'contact', 'products', 'range'];
// forms a button or a door may open
const FORMS = ['sample', 'quote', 'distributor'];
// our pages a menu link may open (products = the products drawer over the page, as the Products link)
const PAGES = ['products', 'privacy', 'terms'];
// menu links: a page or a home page section only
const LINK_KINDS = ['page', 'section'];
const LINK_SECTIONS = ['moods', 'range', 'business', 'where', 'about', 'contact'];

/** '' when (action, target) is a valid pair (categories = the category keys), else why not */
function actionProblem(action, target, categories = []) {
  const t = target === null || target === undefined ? '' : String(target).trim();
  if (!ACTIONS.includes(action)) return `one of ${ACTIONS.join(', ')}`;
  if (action === 'products' || action === 'products_home') return '';
  if (action === 'products_category') return categories.includes(t) ? '' : 'pick one of the categories';
  if (action === 'section') return SECTIONS.includes(t) ? '' : `one of ${SECTIONS.join(', ')}`;
  return FORMS.includes(t) ? '' : `one of ${FORMS.join(', ')}`;
}
/** '' when a menu link (kind, target) is valid, else why not */
function linkProblem(kind, target) {
  if (kind === 'page') return PAGES.includes(target) ? '' : `a page: one of ${PAGES.join(', ')}`;
  if (kind === 'section') return LINK_SECTIONS.includes(target) ? '' : `a home page section: one of ${LINK_SECTIONS.join(', ')}`;
  return 'a page or a home page section';
}
/** the target an action keeps (none for products / products_home) */
const keptTarget = (action, target) => (action === 'products' || action === 'products_home' ? '' : String(target || '').trim());

module.exports = { ACTIONS, SECTIONS, FORMS, PAGES, LINK_KINDS, LINK_SECTIONS, actionProblem, linkProblem, keptTarget };
