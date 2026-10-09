// Page-wide product card state (spec C1), kept outside React so it survives a language switch and is
// shared by every card instance (featured rail + drawer):
// - the colour variant picked per product id ('' = the parent row, White), for as long as the page is open
// - which ONE card instance is flipped (a card key from useId; a rail card and a drawer card of the same
//   product are different instances)
import { useSyncExternalStore } from 'react';

function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      subs.forEach((cb) => cb());
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const variants = createStore({}); // { 'DZIND-DF008': 'DZIND-DF008-BUR' }
const flipped = createStore(null); // card key or null

export function useVariantChoice(productId) {
  const map = useSyncExternalStore(variants.subscribe, variants.get);
  return map[productId] || '';
}

export function setVariantChoice(productId, variantId) {
  variants.set({ ...variants.get(), [productId]: variantId });
}

export function useFlipped(cardKey) {
  return useSyncExternalStore(flipped.subscribe, () => flipped.get() === cardKey);
}

export function setFlipped(cardKey, on) {
  if (on) flipped.set(cardKey);
  else if (flipped.get() === cardKey) flipped.set(null);
}
