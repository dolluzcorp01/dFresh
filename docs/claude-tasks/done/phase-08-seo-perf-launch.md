# Phase 8 - SEO, performance, accessibility, QA, deployment

Read first: docs/02_ARCHITECTURE.md (SEO, performance, deployment), docs/05_FEATURES_SPEC.md G,
docs/07_ACCEPTANCE_AND_OPEN_ITEMS.md.

## Steps
1. `seo.js`: production HTML injection per route + language (title, description, canonical, hreflang incl. x-default,
   OG, JSON-LD Organization/LocalBusiness/ItemList without prices), `/sitemap.xml`, `/robots.txt`.
2. Performance pass to the budget in 02_ARCHITECTURE.md; preload hero font + first banner; check bundle sizes.
3. Accessibility pass: keyboard-only run, focus visible, contrast (gold text only on dark), alt texts, form labels,
   aria for carousels/drawer/modals. Fix everything found.
4. `visual-check.js` (puppeteer-core, like Inside D): screenshots of every section, 1440 + 390, EN/TA/HI,
   reduced-motion, into /visual-output.
5. Deployment notes + scripts: pm2 ecosystem file (`dfresh`), nginx server block (gzip/brotli, cache headers for /media,
   proxy /api, SPA fallback through server.js), backup of media + private/brochures + DB, build off-droplet option.
6. Walk the full acceptance checklist in docs/07 and report each item as pass / fail / blocked-by-open-item.

## Acceptance
- Lighthouse mobile >= 85 in all four categories on /en and /ta (attach numbers).
- Rich Results Test passes for the home page JSON-LD; sitemap lists 3 languages x pages.
- Checklist report with evidence for every line.

Commit: `phase 8: seo, performance, a11y, launch prep`. Move file to done/, STOP.
