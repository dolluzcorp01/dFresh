# CLAUDE.md - dFresh website (standing rules)

Read this file at the start of EVERY session. It survives context compaction; your memory does not.

## What this is
dFresh ("Gentle, Like You") is the tissue and hygiene paper brand of **Dolluz Corporation (OPC) Pvt Ltd**, Kanchipuram.
This repo is the dFresh **catalogue + lead website** (Phase 1: no prices, no online payment) and its **admin console**.
Owner: Shoban (DZIND002). Developer: Pavithran (DZIND148). Approvals: Ashwini Kumar, Director.

## Read before any work
1. `docs/01_PROJECT_BRIEF.md` - what we are building and why
2. `docs/02_ARCHITECTURE.md` - folders, stack, conventions (mirrors Inside D)
3. `docs/03_DATABASE.md` - every table and the translation model
4. `docs/04_I18N.md` - how languages work (EN/TA/HI now, more later)
5. `docs/05_FEATURES_SPEC.md` - every section, every interaction, every rule
6. `docs/06_API.md` - every endpoint
7. `docs/07_ACCEPTANCE_AND_OPEN_ITEMS.md` - go-live checklist and what is still missing
8. The current phase file in `docs/claude-tasks/` (the lowest-numbered file NOT in `docs/claude-tasks/done/`)

Visual + behaviour reference: `docs/reference/dfresh-preview-v3.html` (open in a browser) and
`docs/reference/dfresh-preview-v3-CODE-ONLY.html` (same file, images stripped, readable).
The approved look, copy, animations and interactions come from that preview. Match it; do not redesign it.

## How we work (phases)
- Work ONE phase file at a time. Do only what that file asks. Do not start the next phase.
- At the end of a phase: run the acceptance checks in the file, show real output (not "tests pass"),
  commit with the given message, move the phase file into `docs/claude-tasks/done/`, then STOP and report.
- If something in a phase conflicts with these rules or the docs, STOP and ask. Do not guess.
- "Be careful" standard: check end to end before and after. Never state a count or result without
  re-checking it against the actual file, DB row or screen. A check that could not run is "not verified", never "pass".

## Non-negotiable rules
1. **No hard-coded customer text.** Every word a visitor sees comes from the DB (ui_text, *_translations,
   site_settings). Components take keys, not sentences. The only exception is legal body text (English, see spec).
2. **Languages are data, not code.** Never write `if (lang === 'ta')`. Never add columns like `name_ta`.
   A new language must work by inserting rows only (see docs/04_I18N.md). English is the fallback.
3. **Fonts per script come from `languages.font_family`**, not from CSS hard-coded per language.
4. **emp_id is VARCHAR(20)** (e.g. `DZIND148`). Never `Number()` / `parseInt` it.
5. **Internal fields never reach the browser**: `products.spec_status`, `leads.staff_notes`, `leads.ip_hash`,
   non-public `site_settings`. Public SQL selects named columns only, never `SELECT *`.
6. **All SQL is parameterised** (`?` placeholders). No string-built SQL with user input.
7. **All e-mail goes through `mailer.js` + the `mail_outbox` table** (outbox pattern). Never call SendGrid from a route.
   Every e-mail has a plain-text part. Inline CSS only.
8. **Every lead is saved to MySQL first**, then e-mail + Google Sheet happen from outboxes. A SendGrid or
   Google outage must never lose a lead or show the visitor an error.
9. **Secrets live in `.env` only** (never committed). `.env.example` lists every key with a dummy value.
10. **House style: never use the long dash characters (en dash, em dash)** in code, comments, copy, e-mails or docs. Use "-".
11. **No prices anywhere** on the public site in Phase 1.
12. **Gold text only on dark backgrounds** (accessibility). On white/beige, gold is a fill, text is ink.
13. **Respect `prefers-reduced-motion`**: every animation has a still fallback.
14. **Content protection** (brief): right click, copy, image drag/save blocked site-wide except inside form fields.
15. **No claims** we cannot prove: no "medical grade", "100% eco-friendly", "bamboo range", certifications,
    client logos or testimonials until Dolluz confirms in writing. "Marketed by", not "Manufactured by".
16. Keep the stack (React CRA + Express 5 + MySQL + SendGrid + JWT). Do not add a framework, ORM or CSS
    library without asking. Small focused packages are fine if the phase file allows them.
17. Mobile first: the main audience opens links from WhatsApp on a phone. Every screen must work at 360px wide
    with no sideways scroll.

## Commands (after Phase 0)
- `npm run dev` - API (nodemon server.js) + React dev server together
- `npm run server` / `npm start` - API only / React only
- `npm run db:reset` - drop + create + schema + seed on LOCAL dev DB only (refuses when NODE_ENV=production)
- `npm run build` - production React build
- `npm run media:build` - regenerate responsive image sizes from /media originals

## Brand tokens (from the logo kit)
Gold #E5BF24 · Gold light #F4CF2C · Gold deep #C79714 · Ink #121214 · Fresh white #FCFBF6 · warm beige for hero/backgrounds.
Fonts: Saira (display), Open Sans (body), Noto Sans Tamil, Noto Sans Devanagari (Google Fonts).
Tagline "Gentle, Like You" uses the tagline ARTWORK, never retyped in a script font.
