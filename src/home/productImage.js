// First photo of a product card from bootstrap.products, for section art (doors, ring tiles).
export function productImage(products, id) {
  const p = products.find((x) => x.id === id);
  return p && p.images && p.images[0] ? { ...p.images[0], alt: p.alt || p.name } : null;
}
