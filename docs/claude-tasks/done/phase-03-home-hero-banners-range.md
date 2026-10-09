# Phase 3 - Home part 1: hero, stats, banner slider, doors, range ring

Read first: docs/05_FEATURES_SPEC.md B1-B4 and C-none; preview CODE-ONLY file (sections: hero sheet, petals,
springField, banner slider, ring). Port the behaviour faithfully, as React components with cleanup.

## Steps
1. Hero (B1): headline with SpringLetters, lede, buttons, TissueSheet (WebGL + 2D fallback + static fallback,
   lazy-loaded chunk, mobile mesh smaller, pauses off-screen / hidden tab), Petals canvas, desktop leaf trail,
   confetti burst. Stats from bootstrap.stats.
2. BannerSlider (B2) with all CTA actions wired (drawer can be a stub that logs until Phase 4).
3. Doors (B3), RangeRing (B4) with drag inertia, arrows, focus behaviour, drag-is-not-click.
4. Every effect: one rAF loop, stops when off-screen, removed on unmount (no leaks when switching language).

## Acceptance (screenshots 1440 / 390, EN + HI; reduced-motion run)
- Visual match with the preview for these sections (side-by-side screenshots).
- Switching language 10 times does not increase running rAF loops (log a counter in dev) or memory noticeably.
- Reduced motion: no auto-rotation, no auto-advance, sheet static, everything readable.
- Lighthouse mobile performance on Home (with only these sections) >= 85; report the number.

Commit: `phase 3: home hero, banners, doors, range`. Move file to done/, STOP.
