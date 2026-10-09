# dFresh kit - how to use it

1. Unzip this kit into your `dfresh` project folder (the one with `.git`, `public`, `src`, `package.json`).
   Merge folders when Windows asks. Nothing in the kit overwrites `package.json`, `public/` or `src/`.
2. Make sure local MySQL is running (Phase 0 will create the `dfresh` database from `database/`).
3. Open the folder in VS Code, start Claude Code in it.
4. Paste the text from `KICKOFF_PROMPT.md`. Claude reads everything and asks its questions. Answer, then say "go".
5. Each later session: "Do the next phase" - Claude takes the lowest-numbered file in `docs/claude-tasks/`
   that is not in `done/`. Review its report and screenshots, then start the next session.

| Phase | What you get |
|---|---|
| 0 | Server + database + media running, health check |
| 1 | Content API in any language with English fallback |
| 2 | Site frame: languages in the URL, header, mobile menu, footer, WhatsApp, protection |
| 3 | Hero (tissue sheet), stats, banner slider, doors, 3D range ring |
| 4 | Flip cards, colour variants, featured rail, products drawer with filters + search |
| 5 | Roll + napkin toys, business kits, delivery map, about, contact, legal pages |
| 6 | All forms, leads in MySQL, e-mail + Google Sheet via outbox, brochure download |
| 7 | Admin console: leads, products, Excel import/export, translations, languages, banners ... |
| 8 | SEO, Lighthouse >= 85, accessibility, visual QA, deployment |

Open items Dolluz still has to provide are listed in `docs/07_ACCEPTANCE_AND_OPEN_ITEMS.md`.
