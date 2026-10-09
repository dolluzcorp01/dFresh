# Phase 5 - Home part 2: try-it toys, business kits, map, about, contact band, legal pages

Read first: docs/05_FEATURES_SPEC.md B6-B10, E.

## Steps
1. TryIt: RollToy (full physics as in preview: spin both ways, inertia, thinning roll, paper drape and pile,
   travelling labels, pull tab, tap, auto-unroll once) and NapkinSizer (size_picker data, unfold animation, counter, auto-cycle).
2. BusinessKits accordion (hover intent desktop, tap mobile, keyboard), kit WhatsApp (`wa_kit`), "free sample" opens
   the Quote form in sample mode with kit products + business type (form can be a stub until Phase 6, but pass the data).
3. WhereMap (SVG from towns, route drawing, van animation, translated names, distributor button).
4. About section, ContactBand with the two map cards (lazy iframes, placeholder, Maps links from settings).
5. Legal pages (`/:lang/privacy`, `/:lang/terms`) + overlay mode for consent links; footer spring letters.

## Acceptance
- Visual match with the preview for every section at 1440 / 390 (screenshots side by side).
- Kit WhatsApp message for Hotels contains all 4 product IDs and names.
- Tamil: map town names, roll labels, kit names, about, contact cards all Tamil. Legal page shows `lg_en` note + English body.
- Reduced motion: toys still usable by tap/buttons, no auto animation.

Commit: `phase 5: try-it, kits, map, about, contact, legal`. Move file to done/, STOP.
