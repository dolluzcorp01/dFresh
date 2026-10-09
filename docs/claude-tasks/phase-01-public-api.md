# Phase 1 - Public content API

Read first: docs/03_DATABASE.md, docs/04_I18N.md, docs/06_API.md.

## Goal
`GET /api/dfresh/languages`, `GET /api/dfresh/bootstrap?lang=xx`, `GET /api/dfresh/legal/:page?lang=xx`,
fully driven by the DB with English fallback, cached and versioned.

## Steps
1. `src/backend_routes/i18n-sql.js`: one helper that builds "base table + translation with English fallback"
   queries for any entity (products, categories, banners, kits, towns, form options, ui_text). Named columns only.
2. `src/backend_routes/content-cache.js`: per-language cache, `contentVersion` counter, `bust()`.
3. `Public_server.js`: the endpoints above. Products: cards (variant_of NULL) with nested `variants[]`, each with
   images (src + srcset 400/800/1200). Keywords split into an array. Stats computed from data.
   Settings: only `is_public = 1`. Never include spec_status.
4. Unknown / inactive lang -> respond for the default language with `lang` set to the default (client redirects).
5. ETag + Cache-Control as in 06_API.md. Add request logging only in development.
6. Tests (jest via react-scripts or node:test) for: fallback when a translation row is missing, inactive language,
   variant nesting, spec_status never present (search the JSON string).

## Acceptance (show real output)
- `curl /api/dfresh/bootstrap?lang=ta` -> 25 products, DF008 has 3 variants, ui map has 152 keys
  (154 minus the 2 `legal_*` bodies, which are served by /legal), Tamil name for DZIND-DF007 shown.
- Insert a fake language `xx` (active) with NO translations -> bootstrap?lang=xx returns full English content. Remove it after.
- `grep -c spec_status` on the bootstrap JSON = 0.
- Second request returns 304 with the ETag.

Commit: `phase 1: public content api with fallback + cache`. Move file to done/, STOP.
