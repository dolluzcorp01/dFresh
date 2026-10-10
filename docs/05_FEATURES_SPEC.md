# 05 - Features and logic (the complete spec)

Approved reference: `docs/reference/dfresh-preview-v3.html`. Where this file and the preview disagree, this
file wins (it adds the brief's rules the preview could not show: real data, real leads, SEO, admin).
Text keys in `code` are rows in `ui_text` (see `database/02_seed.sql`). Never type the English into JSX.

---------------------------------------------------------------------------------------------------
## A. Global (every screen)

### A1. Header (sticky; transparent over hero, solid after 10px scroll)
- Logo (`/media/logo/dfresh-logo-on-light.webp`) -> scroll to top / home.
- Desktop nav: `nav_products` (opens Products drawer), `nav_business` (#business), `nav_where` (#where),
  `nav_about` (#about), `nav_contact` (#contact).
- Language switch: one button per ACTIVE language (`languages.switch_label`), `aria-pressed` on the current.
- Brochure button (`brochure`) -> Brochure form.
- <= 900px: nav hidden; round brochure icon button + menu button (hamburger -> X) that opens a floating sheet
  with: Products, For Business, Where to buy, About, Contact, `request_quote`, `become_distributor`.
  Closes on link tap, outside tap, Esc, resize above 900px.

### A2. WhatsApp everywhere
- Floating green button bottom-right on every screen (`wa_float`), above safe-area.
- Link format: `https://wa.me/<site_settings.whatsapp_number>?text=<encodeURIComponent(message)>`.
- Messages: general = `wa_general` (per language); product card = that product's `whatsapp_message`
  (English today, fallback); kit = `wa_kit` with `{kit}` and `{items}` (product IDs + names).
- Every click -> GA4 `whatsapp_click` with `{ product_id | kit | 'general', location }`.

### A3. Footer (dark)
- Logo on dark, tagline artwork, `brand_line`.
- Column `f_shop`: Products, For Business, Where to buy, Our range (#range), About.
- Column `f_work`: Request a quote, Become a distributor, Download brochure (open the forms).
- Column `f_visit`: WhatsApp number, `lbl_office` + office phone, public e-mail, `f_addr`.
- Legal line: `legal1` (company, CIN, GSTIN - show `gstin` setting when filled, else the "to be confirmed" text),
  (c) year + `lg_priv` link + `lg_terms` link.
- Big "dFresh" letters at the bottom that lift softly near the pointer (spring physics, see C1).

### A4. Content protection (brief)
Capture-phase listeners on `document` for `contextmenu`, `copy`, `cut`, `dragstart`, `selectstart` and
Ctrl/Cmd + S / U / C -> `preventDefault()` UNLESS the target is inside `input, textarea, select, [contenteditable]`.
CSS: `user-select: none` on body, `text` on form fields, `-webkit-user-drag: none` on images.
(This is a deterrent, not real protection. Do not promise more.)

### A5. Motion
- Sections fade/slide in once when 8% visible (IntersectionObserver). Content is visible without JS.
- `prefers-reduced-motion: reduce` -> no auto-play, no parallax, no physics; everything static and readable.
- Every animation loop pauses when its element is off-screen or the tab is hidden.

### A6. Analytics (GA4, silent if `ga4_measurement_id` is empty)
Events: `whatsapp_click`, `card_flip {product_id}`, `variant_pick {product_id}`, `banner_click {banner}`,
`filter_use {filter}`, `search {query_length}`, `form_open {form}`, `form_submit {form}`,
`brochure_download {lang}`, `language_change {to}`, `roll_play`, `size_pick {size}`.
All go through ONE helper `track(name, params)` which also adds `language`.

---------------------------------------------------------------------------------------------------
## B. Home page sections (in this order)

### B1. Hero (`#top`)
- Eyebrow `eyebrow`; headline two lines `hero_l1` / `hero_l2` (line 2 lighter weight).
  Letters (EN) or words (other scripts) rise in on load; near the pointer they lift with spring physics and tint gold.
- `lede` paragraph; buttons: WhatsApp (`whatsapp_us`, general message) and `see_all_products` (Products drawer).
- **Tissue sheet** (right; on mobile above the text): WebGL sheet of paper with the dFresh leaf-hand icon
  printed in the centre, embossed dot texture, gently billowing; pointer move / tap creates ripples;
  random soft auto-ripples; hint pill `touch` hides after first touch. 2D canvas fallback without WebGL;
  static image with reduced motion. Mobile: smaller mesh (e.g. 40x30) for performance.
- Falling tissue petals (canvas, ~16 pieces, 30 fps) behind the hero; leaf-icon trail following the mouse
  on hover devices only; small paper confetti burst on sheet tap.
- **Stats strip**: products count (cards, not variants), categories count, active towns count, active
  languages count - computed from data, labels `st_p`, `st_c`, `st_t`, `st_l`.

### B2. "dFresh moods" banner slider (`#moods`)
- Active banners from `banners` ordered by `sort_order`. `<picture>`: mobile file <= 700px, desktop file above.
  First image eager + high priority; the rest lazy.
- Overlay (HTML text): eyebrow `bn_k`, headline, CTA button. Dark theme = gold button, light = ink button.
- CTA actions: `products` (drawer, All), `products_home` (drawer, For Home), `products_category`
  (drawer filtered to `cta_target`), `section` (scroll to `#cta_target`), `form` (open form `cta_target`;
  `sample` = quote form in sample mode).
- Auto-advance every 6 s with cross-fade + slow zoom; pause on hover/focus/touch; dots with progress bars;
  prev/next arrows (hidden on mobile); swipe left/right. GA4 `banner_click`.

### B3. Who it's for - doors
`doors_k`, `doors_h`. Two large cards:
- For Home (`for_home`, `dh_h`, `dh_p`, `dh_go`) photo of DZIND-DF028 -> drawer with "For Home" filter.
- For Business (`for_business`, `db_h`, `db_p`, `db_go`) photo of DZIND-DF037 -> scroll to #business.

### B4. Spin the range - 3D category ring (`#range`)
`range_k`, `range_h`, `range_p`. Six tiles (category rep photo, name, `n_products`/`n_product` count) on a 3D ring:
slow auto-rotation, drag to spin with inertia, prev/next buttons (`ring_hint`), front tile clickable, focusable
tiles rotate to the front on focus. Click -> drawer filtered to that category. A drag never counts as a click.

### B5. Bestsellers - featured rail (`#featured`)
`feat_k`, `feat_h`, `feat_p`. The `is_featured` products in `featured_order` as **Flip cards** (C1) in a
horizontal snap rail with prev/next buttons.

### B6. Try it - two toys (`#play`)
- **The roll** (`ur_k`, `ur_h`, `ur_p`, `tryit`): grab and spin the roll in either direction; one direction
  unrolls paper, the other winds it back; flick = momentum with natural slow-down; the roll gets thinner as
  paper comes off; paper runs along a shelf, drapes over the edge and piles in soft folds; perforation lines and
  labels `rl_ply rl_soft rl_pulls rl_perf rl_tear rl_fits` travel with the paper; pull tab at the paper end;
  tap = quick roll out/back; auto-unrolls once when first seen. GA4 `roll_play` (once per visit).
  Labels are translated; a label wider than one sheet (122 px) wraps onto two lines (the preview never
  translated them). Screen-reader label `roll_aria`. Physics steps at a fixed 60 Hz (same constants as the
  preview), so it behaves the same on 120 Hz screens. Reduced motion: no inertia or sway; tap and auto-unroll
  jump straight to the end state.
- **The napkin** (`fo_k`, `fo_h`, `fo_p`): buttons from `size_picker`; picking a size unfolds the napkin
  (fold animation), the size counter animates to the new number, and the matching product name shows
  (translated). Auto-cycles every 2.6 s until the visitor touches it (paused off screen). Unit `unit_cm`,
  group label `size_aria`. GA4 `size_pick`.

### B7. For Business - kits accordion (`#business`)
`for_business`, `biz_h`, `biz_p`. Four cards from `kits` (01-04). One is open at a time: desktop opens on hover
(with a short intent delay so it does not flicker), mobile/keyboard opens on tap/Enter. Open card shows:
number, rep product photo, name, tagline, list of kit products (translated names),
`kit_cta` -> WhatsApp with `wa_kit` message, and `sample` -> Quote form in **sample** mode with the kit's
products pre-ticked and business type pre-selected.
Hover intent: the kit under the mouse opens after 70 ms, never sooner than 300 ms after the last change.
Each kit name is a heading holding the expand button (accordion pattern); closed panels are `inert`.
Kit colours follow position (gold, ink, beige, white, repeating). `wa_kit` uses the current language's kit and
product names, with the product IDs. Long scripts (desktop): a closed kit's vertical name wraps into a second
column instead of running off the card (the preview clips it).

### B8. Where we deliver (`#where`)
`where_k`, `where_h`, `where_p`. Illustrated SVG map (600x360) with pins at `towns.map_x/map_y`, the base
(Kanchipuram) marked with a star; curved routes draw in when visible; a small dFresh van drives each route in
turn. Town names translated. Town chips list below the text. Button `become_distributor` -> Distributor form.
Each name sits at `towns.label_dx / label_dy / label_anchor` from its pin (default: centred above). Routes draw
when 30% of the map is visible (0.5 s each, staggered 0.22 s); the van starts 1.5 s later, drives 1.7 s per route
(ease-in-out) with a 0.45 s stop, and pauses off screen. Map description for screen readers: `map_aria`.

### B9. About (`#about`)
`ab_k`, `ab_h`, `ab_p` + a photo (object-position right so the product shows) +
three points (`ab1_*`, `ab2_*`, `ab3_*`). Photo alt `ab_alt`. The photo is site setting `about_image`
(a path under `/media`, default `banners/desktop/dFresh_Banner_about_1920x800.webp`), independent of the
`about` banner, so that banner can be switched off without losing the photo. Empty setting = no photo.

### B10. Contact band (`#contact`)
Big headline `band_h`, `band_p`, soft animated yellow blob; buttons: `sample` (Quote form, sample mode),
WhatsApp, `download_brochure`, `msg_btn` (Contact form). Numbers line (WhatsApp, `lbl_office`, e-mail).
Two visit cards: `c_office` / `c_office_a` and `c_godown` / `c_godown_a`, each with an embedded Google map
(lazy iframe, `map_load` placeholder underneath) and `c_map` link (opens Google Maps in a new tab).
Map place = `site_settings.office_map_query` / `godown_map_query`; iframe title `map_frame`. The numbers are
links (wa.me, tel:, mailto:).

---------------------------------------------------------------------------------------------------
## C. Products

### C1. Flip card (used in the featured rail and the drawer)
Front:
- Carousel: the product's 3 photos + a 4th dark "spec slide" (logo, name, first 4 parts of the spec).
  Auto-advance ~3 s (staggered per card so a grid does not tick together), pause on hover / touch / when the
  card is flipped / off-screen, swipe on touch, dots to jump. Images lazy, `srcset`, alt text.
- Product ID chip (dark chip, gold text), name, one-liner, first 3 keyword chips.
- Colour swatches when the product has variants (`colour` label + dots from `swatch_hex`; White dot has a border).
- Button `know_more` with a turn icon -> flip.
Back:
- ID chip, name, description, definition list: `specifications` (spec), `pack`, `best_for`.
- Buttons: WhatsApp (product message), `request_quote` (Quote form with this product ticked), `back`.
Rules:
- 3D flip on click/tap and Enter/Space; only ONE card flipped at a time (page-wide); focus moves to Back when
  flipped and returns to Know more when unflipped; hidden face is `aria-hidden` and its buttons untabbable.
- **Colour variants** (Excel v0.2 Read_Me): picking a swatch swaps photos (soft fade), ID chip, name,
  one-liner, keywords, description, spec, pack, best for, alt text and WhatsApp message to that variant's row.
  White = the parent row. The choice is remembered per product while the page is open, including across a
  language switch. GA4 `variant_pick`.
- No prices. If `pack`/`spec` contains "to be confirmed", show it as is (it is the truth).
- Long scripts (Tamil, Hindi): on the back, each spec row shows its label above its value, because a long label
  beside the value left too little room (approved deviation from the preview).

### C2. Products drawer (route `/:lang/products`, also opened as an overlay from anywhere)
- Opens with a growing circle animation from the clicked element; body scroll locked; Esc / X closes and
  returns focus; browser Back closes it.
- Sticky head: `all_h`, search box (`search` placeholder), close button (on mobile: title + X on row 1, search row 2).
- Filter chips with counts: `all` (25), `home_only` (For Home = `show_for_home`), then each category
  (translated name + count). Query param `?cat=napkins` / `?cat=home` deep-links a filter.
- Search: matches product ID (with or without "DZIND-"), English name, current-language name, spec and keywords;
  "x" and "×" are treated the same (so "30x30" finds "30×30"). Empty result -> `none` message.
- Grid: 4 columns desktop, 3 at <= 1100px, 2 at <= 900px, 1 at <= 560px (the preview goes to 1 column at
  620px; approved: 2 columns stay usable down to 561px). Cards = C1.
- The search box gets focus on open only where there is a mouse; on touch devices the dialog itself takes focus,
  so the phone keyboard does not cover the grid (approved deviation from the preview).

---------------------------------------------------------------------------------------------------
## D. Forms (modal; one component, five configs)

Common to all forms:
- Logo, title, subtitle, fields, consent checkbox (`consent` + `lg_priv_s` link that opens the Privacy policy
  ON TOP of the form without losing the typed data), hidden honeypot field, submit button.
- Validation on blur and on submit using `src/shared/rules.json` (same file the server uses):
  e-mail `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`; Indian mobile `^(\+?91[\s-]?)?[6-9]\d{4}\s?\d{5}$`
  (stored normalised as 10 digits); GST `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (case-insensitive, stored upper);
  required text; at least one product where required. Messages: `e_fill e_choose e_email e_tel e_gst e_pick`.
  First invalid field gets focus. Labels marked `(optional)` with `optional`.
- Submit -> `POST /api/dfresh/leads`. Button shows `sending`, disabled. On success: tick animation,
  `thanks_name` (`{name}` = first name), `ok_bro` / `bro_pending` / `ok_other`, WhatsApp button. On network or
  server error: keep the data, show `e_net` above the button (never lose what they typed); 429 shows `e_rate`.
- The first field takes focus on open where there is a mouse; on touch devices the dialog does (phone keyboard).
- Esc / X / backdrop closes; focus is trapped inside and returned to the opener.

| Form | Title / sub | Fields (required unless marked) | form_type |
|---|---|---|---|
| Brochure | `m_brochure` / `m_brochure_s` | `first_name`, `last_name`, `email`, `mobile` | brochure |
| Quote | `m_quote` / `m_quote_s` | `fl_name`, `fl_biz`, `fl_type` (form_options business_type), `fl_town`, `fl_phone`, `email`, `fl_prod` (chips of all 25 cards, pre-ticked when opened from a card or kit), `fl_qty` (optional), `fl_msg` (optional) | quote, or **sample** when opened from a "free sample" button |
| Distributor | `m_dist` / `m_dist_s` | `fl_name`, `fl_firm`, `fl_gst` (optional), `fl_area`, `fl_gd` (yes_no), `fl_brands` (optional), `fl_sales` (monthly_sales), `fl_phone`, `email` | distributor |
| Contact | `m_contact` / `m_contact_s` | `fl_name`, `fl_phone`, `email`, `fl_msg` | contact |

### D1. Brochure delivery (gated)
- On a valid brochure submit the API returns a short-lived signed token (JWT, purpose `brochure`, 15 min).
- The browser immediately navigates a hidden link to `GET /api/dfresh/brochure/download?token=...` which
  streams the PDF for the visitor's language (fallback English) from `private/brochures/` with
  `Content-Disposition: attachment; filename="dFresh_Brochure_<LANG>.pdf"`.
- A copy link (7-day token) is e-mailed to the visitor (`mail_bro_subject`, `mail_bro_intro`) via the outbox.
- If no brochure is uploaded yet: still save the lead, show `bro_pending` instead of downloading. No visitor
  e-mail is queued then (there is nothing to link to); the staff alert says the brochure is still to be sent.
- GA4 `brochure_download`.

### D2. What happens to a lead (server)
1. Validate (rules.json), reject honeypot silently (respond success, save nothing), rate-limit by `ip_hash`
   (e.g. 5 submissions / 10 min / IP) -> 429 with `e_` style message.
2. Normalise: trim, phone to 10 digits, GST upper, e-mail lower.
3. In ONE transaction: insert `leads` (+ `lead_products`), generate `lead_ref`, enqueue `mail_outbox`
   (staff alert to `lead_email` with every field, product IDs+names, language, page; brochure copy if
   brochure; for quote, sample, distributor and contact a short visitor confirmation `lead_ack` in the
   visitor's language, English fallback: `thanks_name`, `mail_ack_intro`, the lead_ref under `mail_ack_ref`,
   `mail_ack_next_h` + `ok_other` + `mail_ack_keep`, WhatsApp button `whatsapp_us`) and `sync_outbox`
   (Google Sheet from Dolluz's template, tabs Quote / Sample / Distributor / Contact / Brochure, appended under the
   existing row-1 header in its exact column order, see `gsheet.js` HEADERS; the Overview tab is never touched;
   a header that does not match keeps the row pending with the error logged; values RAW as text, date
   "YYYY-MM-DD HH:MM" IST, products "ID Name" joined with ", ", Brochure Sent = language code actually served).
   Every e-mail is sent FROM `site_settings.mail_from` (`connect@dolluzcorp.com`, the verified SendGrid sender);
   staff alerts go TO `site_settings.lead_email` (`info@dolluzcorp.com`). `MAIL_TEST_TO` (local only, never on the
   server) redirects every mail to one test inbox; outside production a real send is refused without it.
4. Respond `{ success, data: { lead_ref, brochure_token? } }`.
5. Workers (every 15 s inside server.js, guarded so only one run at a time) send pending rows; on failure
   `attempts + 1`, `next_attempt_at` back-off 1, 5, 15, 60 min, give up after 8 -> status `failed` (visible in admin).
   Outbox rows are deleted with their lead (FK cascade); a pending row whose lead is missing is marked
   `cancelled` and never sent.

---------------------------------------------------------------------------------------------------
## E. Legal pages
Routes `/:lang/privacy` and `/:lang/terms` (also openable as an overlay from form consent links).
Title `lg_priv` / `lg_terms_h`; body `legal_privacy_body` / `legal_terms_body` (HTML, English;
other languages show `lg_en` note + English body). Marked "Draft for review by Dolluz" in admin until approved.
Footer links go to the pages; consent links use the overlay (`useOpenLegal()`), which stacks over the form.
Both fetch `GET /legal/:page` (cached in memory per page and language).

---------------------------------------------------------------------------------------------------
## F. Admin console (`/admin`, lazy chunk, noindex)
Login: e-mail + password checked against `dadmin.employee` (bcrypt `account_pass`, not deleted), then an
e-mailed 6-digit code stored hashed in `dadmin.login_otp` with `app_key = 'dFresh'` (attempt limit, expiry),
exactly like Inside D. Only emp_ids in `dfresh.admin_users` (active) may enter. Cookie `dfresh_admin_token`
(httpOnly, Secure + SameSite in prod). Roles: `admin` (everything), `editor` (content, not users/settings),
`viewer` (read-only, leads read). Every write -> `audit_log` and busts the content cache.

Screens:
1. **Dashboard** - leads today / 7 days / by form, outbox health (pending / failed), missing translations per language.
2. **Leads** - table with filters (form, status, date, language, search), detail drawer, status change,
   assign, staff notes, CSV export, retry failed e-mail / sheet sync.
3. **Products** - list with category/variant tree; edit base fields + per-language text side by side;
   images: upload (auto-convert to 1200x1200 WebP <= 150 KB, generate sizes), reorder 1-3; featured order;
   active toggle; add colour variant.
4. **Excel import / export** - export in EXACTLY the Product List v0.2 layout (columns `_EN/_TA/_HI`, plus a
   column set per extra active language); import shows a dry-run diff (added / changed / removed rows) and
   applies only on confirm. Unknown columns are reported, not ignored silently.
5. **Translations** - grid of all `ui_text` keys x active languages, grouped, missing cells highlighted,
   inline edit, filter "missing only", export / import CSV for translators.
6. **Banners** - upload desktop + mobile images, headline + CTA per language, CTA action, theme, order (drag),
   active toggle, note.
7. **Kits, Towns, Categories, Size picker, Form options** - simple CRUD with translations.
8. **Languages** - add / edit / activate / deactivate / reorder; cannot deactivate the default; shows
   completeness % before activation.
9. **Brochures** - upload a PDF per language (<= 5 MB, PDF magic bytes checked), replace, download.
10. **Settings** - site_settings with descriptions; public flag shown.
11. **Admin users** (admin role) - add emp_id + role, deactivate.
12. **Audit log** - who changed what, with before/after.

---------------------------------------------------------------------------------------------------
## G. SEO and performance (brief)
- Per language: `<title>`, meta description, canonical, hreflang (all active + x-default), OG tags.
- JSON-LD: Organization + LocalBusiness (address, phone, geo from towns base) + ItemList of Products
  (name, image, sku = product_id, brand dFresh; NO price/offers in Phase 1).
- `/sitemap.xml` (every language x home/products/privacy/terms + category filter URLs), `/robots.txt`
  (disallow /admin, /api).
- Mobile load < 3 s on 4G, Lighthouse >= 85 (performance, accessibility, best practices, SEO) on mobile.
- Phase 8 changes against the preview, for accessibility (4.5:1 text contrast, rule 12) - not layout:
  `--ink-3` #7A766C -> #6F6B62 (4.37:1 -> 5.1:1 on paper); WhatsApp buttons WITH text use `--wa-d` #15803D
  (white on the brand green #1FA855 is 3.1:1; the round icon-only button keeps #1FA855); range ring labels ink-2
  (the ring fades back items); filter-chip counts opacity .55 -> .68; footer column headings are h3 (were h4
  after an h2), same look; a focused Google map shows an ink ring.
- Form success view: the preview's grey "Preview only: nothing is sent..." line is, on the live site, the
  visitor's reference: "{mail_ack_ref}: DFL-xxxxxx. {mail_ack_keep}" (same size, same place, parity 0 px).
