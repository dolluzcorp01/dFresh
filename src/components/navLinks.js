// The site's main links (header, mobile menu, footer). Section links point at the home page hash;
// HomePage scrolls to it.
export const MAIN_LINKS = [
  { key: 'nav_products', page: 'products' },
  { key: 'nav_business', hash: 'business' },
  { key: 'nav_where', hash: 'where' },
  { key: 'nav_about', hash: 'about' },
  { key: 'nav_contact', hash: 'contact' },
];

export function linkTarget(lang, { page, hash }) {
  return page ? `/${lang}/${page}` : { pathname: `/${lang}`, hash: `#${hash}` };
}
