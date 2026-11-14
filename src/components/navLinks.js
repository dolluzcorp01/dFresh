// The site's menu links (header, phone menu, footer). Phase 24: they live in the database (Website > Brand and layout >
// Menu links) and come in the bootstrap (data.menuLinks): one list in one order, each with the menus it shows in and
// its name as a Translations text key. Section links point at the home page hash; HomePage scrolls to it.

/** the links of one menu ('header' | 'phone' | 'footer'), in order: [{ key, textKey, page | hash }] */
export function menuLinks(data, menu) {
  return ((data && data.menuLinks) || []).filter((l) => l[menu]).map((l) => ({ key: l.textKey, textKey: l.textKey, ...(l.page ? { page: l.page } : { hash: l.hash }) }));
}

export function linkTarget(lang, { page, hash }) {
  return page ? `/${lang}/${page}` : { pathname: `/${lang}`, hash: `#${hash}` };
}
