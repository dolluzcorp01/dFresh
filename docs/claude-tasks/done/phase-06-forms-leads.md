# Phase 6 - Forms, leads, brochure, outboxes (SendGrid + Google Sheet)

Read first: docs/05_FEATURES_SPEC.md D, D1, D2; docs/06_API.md Leads; CLAUDE.md rules 7-9.

## Steps
1. `src/shared/rules.json` (regexes, lengths, rate limit) used by BOTH `src/forms/*` and `validation.js`.
2. Form components (FormModal + configs for brochure, quote, sample, distributor, contact), prefill from cards/kits,
   consent + privacy overlay, honeypot, errors, success, network-error retry keeping data.
3. `Leads_server.js`: validation, honeypot, rate limit (ip_hash with IP_HASH_SALT), normalisation, transaction,
   lead_ref generation (no duplicates under concurrency - prove with 20 parallel requests), outbox inserts.
4. `mailer.js` (Inside D style, dFresh branding: ink #121214 header, gold accent, inline CSS, text part mandatory)
   with templates: staff lead alert (English, all fields, lead_ref, link to admin), visitor brochure copy
   (visitor language from ui_text `mail_bro_*`).
5. `outbox-worker.js`: mail + gsheet processors, 15 s interval, single-flight lock, back-off 1/5/15/60 min, max 8 attempts.
   `MAIL_ENABLED=false` / `GSHEET_ENABLED=false` -> leave pending and log once.
6. `gsheet.js`: append to tab per form_type (create header row if the tab is empty).
7. `Brochure_server.js`: token verify, language fallback, stream from `private/brochures/`, 404 / 410 handling, `bro_pending` flow.

## Acceptance (real submissions)
- Each form: invalid -> translated errors; valid -> row in `leads` (show SELECT), `lead_products` for quote/sample,
  2 rows in `mail_outbox` for brochure / 1 for others, 1 row in `sync_outbox`.
- Honeypot filled -> 200 but no row. 6th submit in 10 min from same IP -> 429.
- 20 parallel quote submits -> 20 unique lead_refs.
- With a test PDF in private/brochures/en -> download starts with the right file name; Tamil request falls back to EN;
  expired token -> 410; no PDF -> `bro_pending` shown, lead saved.
- With MAIL_ENABLED=true and a test SendGrid key (or a mocked transport in dev) the alert e-mail renders (attach screenshot
  of the HTML and the plain-text part).

Commit: `phase 6: forms, leads, brochure, outboxes`. Move file to done/, STOP.
