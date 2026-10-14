// Products drawer filter + search (spec C2), pure so it can be unit-tested.
// Filter: 'all', 'home' (show_for_home) or a category key (from ?cat=).
// Search matches the product ID (with or without "DZIND-"), the English and current-language name, the
// spec and the keywords, and the same fields of its colour variants; "x" and "×" are the same
// (so "30x30" finds "30×30"). Case-insensitive; surrounding spaces ignored.

const norm = (s) => String(s || '').toLowerCase().replace(/x/g, '×');

function haystack(p) {
  const rows = [p, ...(p.variants || [])];
  return norm(rows.map((r) => [r.id, r.nameEn, r.name, r.spec, (r.keywords || []).join(' ')].join(' ')).join(' '));
}

export function filterKey(cat, categories) {
  if (cat === 'home') return 'home';
  return categories.some((c) => c.key === cat) ? cat : 'all';
}

// Admin order (the API sends products in it; kept explicit so every list, filter and search shows the same order):
// the category's position, then the product's position in its category (sort), then product ID. A product without a
// sort value keeps its place. Colour versions stay inside their card (p.variants) in their own order.
export function adminOrder(categories = []) {
  const rank = new Map(categories.map((c, i) => [c.key, i]));
  const r = (p) => (rank.has(p.category) ? rank.get(p.category) : null);
  return (a, b) => {
    const ra = r(a);
    const rb = r(b);
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    const sa = Number.isFinite(a.sort) ? a.sort : null;
    const sb = Number.isFinite(b.sort) ? b.sort : null;
    if (sa === null || sb === null) return 0;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export function filterProducts(products, filter, query, categories = []) {
  const q = norm(query).trim();
  return products.filter((p) => (filter === 'all' || (filter === 'home' ? p.forHome : p.category === filter))
    && (!q || haystack(p).includes(q))).sort(adminOrder(categories));
}

// [{ key, label, count }] for the chips: All, For Home, then each category in order.
export function filterChips(products, categories, t) {
  return [
    { key: 'all', label: t('all'), count: products.length },
    { key: 'home', label: t('home_only'), count: products.filter((p) => p.forHome).length },
    ...categories.map((c) => ({ key: c.key, label: c.name, count: c.count })),
  ];
}
