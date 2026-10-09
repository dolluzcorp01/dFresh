# Phase 4 - Products: flip cards, colour variants, featured rail, products drawer

Read first: docs/05_FEATURES_SPEC.md C1-C2, B5.

## Steps
1. `FlipCard` with ProductCarousel (3 photos + spec slide, staggered auto, pause rules, swipe, dots), chips,
   Swatches (variant rules exactly as C1), back face, one-flipped-at-a-time (context), focus management, a11y.
2. Variant choice store per product id (survives language switch). GA4 events.
3. FeaturedRail (B5) with snap + buttons.
4. ProductsDrawer as route `/:lang/products` AND as overlay (history-aware), filters with counts, `?cat=` deep links,
   search rules (ID with/without prefix, x == ×, current-language + English names, spec, keywords), empty state, grid breakpoints.
5. Wire all "open products" entry points from Phase 3 (hero, banners, doors, ring).

## Acceptance (real clicks, screenshots)
- Counts: All 25, For Home 10, 7/6/2/5/4/1. Search "30x30" -> DZIND-DF007; "df044" -> wet wipes; "zzz" -> empty message.
- DF008: pick Burgundy -> chip DZIND-DF008-BUR, name "... - Burgundy", Burgundy photos, WhatsApp text contains DZIND-DF008-BUR;
  switch to Tamil -> still Burgundy, Tamil text. Flip -> back shows Burgundy description.
- Only one card flipped at a time across rail + drawer. Keyboard: Tab to Know more, Enter flips, focus on Back.
- Images use srcset; network panel shows 400/800 sizes on mobile.

Commit: `phase 4: products, flip cards, variants, drawer`. Move file to done/, STOP.
