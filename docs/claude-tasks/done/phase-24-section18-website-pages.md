# Phase 24 - Section 18 Website pages: complete to the owner's field map

Branch: `stage2` only. Needs phases 11 to 23. Read first: `CLAUDE.md` (all non-negotiable rules; this phase changes
public files, so the public parity rule applies), `docs/05_FEATURES_SPEC.md`, `docs/04_I18N.md`, the preview
`docs/reference/dfresh-preview-v3.html`, and `docs/claude-tasks/phase-24-field-map.md` (the same table as `phase-24-field-map.xlsx`, sheet "Field map").

The field map is the spec for this phase. v23 has only a one-line menu description for these pages, so where the
field map and v23 differ, the field map wins. Column "Your choice" is the owner's decision for each of the 102 fields;
column "Your note" adds conditions. Build every row as ticked. Logo, Translations and Languages are already done.

Everything the public site shows today stays identical unless a row below changes it: same banners, doors, products,
kits, sizes, towns, menu, cards, forms and texts after the migration, checked against a snapshot.

## Steps
0. Carry-over: open item 22 (home page at 390 with reduced motion, 2 pixels at the edge of the menu button change).
   Find the cause in the header and fix it. Close the item in `docs/07_ACCEPTANCE_AND_OPEN_ITEMS.md` with the proof.
1. Shared rule for every page: values that come from the server or another page are shown read only, with a note
   saying where they come from and a link there. Texts per language that live in Translations are also shown and
   editable on the page that uses them (Home doors texts, Most loved heading, form error messages, page titles and
   descriptions, WhatsApp greeting), writing the same rows. One source, two ways in.
2. Home page pages:
   - Banners: as today, plus "Show from / show until" dates (the banner starts and stops by itself) and a photo
     description per language (alt text, read by screen readers and Google).
   - Home doors (owner's note, row 15): where each door goes becomes editable, picked from the same list as the
     banner buttons (products, a category, a section, a form), so it never breaks.
   - Most loved: as today; no "how many" limit (the row scrolls).
   - Size picker and Kits on the site: as today, on the shared blocks.
3. Brochures: the "Brochure download on / off" switch moves onto this page from Settings.
4. Forms:
   - Form options: as today.
   - Form rules (new): the rules in `src/shared/rules.json` move to the database with the same values as defaults, and
     both the React forms and the API read them from there (one source). Per form (Brochure, Quote and Sample,
     Distributor, Contact) the Admin sets which fields are required. Phone stays required on every form, locked.
     Spam limit editable from 1 to 20 enquiries per 10 minutes. Most products in one quote is editable. The longest
     text per field and the e-mail, mobile and GST checks are read only, with a note.
5. Where we deliver map (owner: one town list): the map uses Masters > Delivery areas with a "Show on map" tick. The
   map fields (names per language, pin and name position, base town, latitude and longitude, order) move onto the
   Delivery areas record. The migration merges today's map towns into Delivery areas without losing a town, a name
   or a position; a town on both lists becomes one. The map page shows the ticked towns and edits their map fields.
6. Brand and layout:
   - Menu links (new): the five links move from `src/components/navLinks.js` to the database. Name per language,
     order (drag), show or hide, where it goes (picked from our pages and home page sections only), and in which menus
     it shows (header, phone menu, footer). No links to other websites (owner: revisit in Stage 3).
   - Visit cards (new): today's Office and Godown cards move to the database. Name and address per language, map
     location with a map preview, order, show or hide, add more cards. "Fill from a godown" copies a godown's address
     from Admin > Godowns, then it can be edited freely. Phone and opening hours per card.
7. Google and sharing: page titles and descriptions per page and per language on this page; share picture; Google
   Analytics ID; indexing on / off, with a warning when turning it off (owner's note). The website address is read
   only: always https://dfresh.us from the server.
8. Site settings (owner's notes):
   - Company name, CIN, GSTIN, phone, e-mail and WhatsApp number: read only here, changed only on Admin > Company.
   - Where enquiry e-mails go: a change waits for a second Admin.
   - Google sheet for leads: a change waits for a second Admin.
   - Mail sender name: Admin edits. Mail sender address: picked only from verified SendGrid senders, never typed.
   - Two-step sign-in moves to Admin > Users and security. It shows here read only. Turning it off waits for a
     second Admin.
   - About photo and mail logo: as today.
9. Screens on the shared blocks, v23 admin layout, product photo on every product line.

## Acceptance (real output)
- Every row of the field map built as ticked: paste a table with row number, field, choice and how you checked it.
- Existing public site identical after the migration (snapshot of every public page in EN, TA and HI), except the
  rows the owner changed.
- One flow by script: a dated banner appears and goes on its dates; a door re-pointed to a category; a quote form
  with "Town" made optional accepts a lead without a town and Phone cannot be made optional; the spam limit set to 2
  refuses the third enquiry; a town ticked "Show on map" in Delivery areas appears on the map; a menu link hidden
  and reordered in all three menus; a third visit card filled from a godown; the leads e-mail change waits for a
  second Admin; two-step sign-in off waits for a second Admin.
- No hard-coded customer text added (rule 1); languages stay data (rule 2): adding a fourth language row shows its
  texts on every new page with no code change.
- Public parity check (this phase changes public files): preview vs our /en at 1920, 1440 and 390 for every section
  touched; "after" table. Admin layout at 1440 and 390 on the 13 pages; "after" table.
- Last phase before go-live, so run all scenarios 0 to 17 (parallel on 3 fresh copies), engines, test:api, menu and
  nav checks, a fresh install, long dash and public checks. Every row must pass; paste the real output.
- Write `docs/tests/SECTION-18-CLICK-TEST.md`.

Commit: `phase 24: section 18 complete - website pages to the owner's field map`.
Move this file and both field map files to `docs/claude-tasks/done/`, push stage2, STOP and report.
