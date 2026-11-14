# Phase 24 field map: how each row was checked

Rows from `docs/claude-tasks/done/phase-24-field-map.md` (owner ticked, 12 Nov 2026). "Scenario 18.x" = `scripts/scenarios/section-18.js`.

| No | Page | Field | Choice | How it was checked |
|---|---|---|---|---|
| 1 | Banners | Desktop photo | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 2 | Banners | Mobile photo | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 3 | Banners | Headline (per language) | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 4 | Banners | Button label (per language) | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 5 | Banners | Theme (light / dark) | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 6 | Banners | Button action and target | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 7 | Banners | Order (drag) | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 8 | Banners | Active | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 9 | Banners | Key and internal note | Admin edits | unchanged entity API + Banners page renders (admin layout 1440/390); public pages identical after migration |
| 10 | Banners | Show from / show until dates | Add it | scenario 18.1: hidden before Show from, shown on its day, gone after Show until; until < from refused (400) |
| 11 | Banners | Photo description (per language) | Add it | scenario 18.1: alt text saved and served as `alt` in bootstrap |
| 12 | Home doors | "For Home" picture | Admin edits | Home doors page: product picker with photos (screenshot); PUT /website/doors product checked against product cards |
| 13 | Home doors | "For Business" picture | Admin edits | Home doors page: product picker with photos (screenshot); PUT /website/doors product checked against product cards |
| 14 | Home doors | Door headings and texts (per language) | Admin edits | Home doors page shows the 10 door texts per language, saving writes ui_text (same rows as Translations) |
| 15 | Home doors | Where each door goes | Admin edits | scenario 18.2: door re-pointed to a category (bootstrap settings), a target off the list refused (400) |
| 16 | Most loved | Which products | Admin edits | Most loved page (tick, drag, Save -> PUT /website/most-loved); unchanged featured order in bootstrap snapshot |
| 17 | Most loved | Order | Admin edits | Most loved page (tick, drag, Save -> PUT /website/most-loved); unchanged featured order in bootstrap snapshot |
| 18 | Most loved | How many show | Not needed | no limit: PUT accepts any number of ticked cards; hint on the page |
| 19 | Most loved | Section heading (per language) | Admin edits | Most loved page shows the featured texts per language (ui_text) |
| 20 | Size picker | Product per size | Admin edits | Size picker page as before (entity API), renders at 1440/390 |
| 21 | Size picker | Size label | Admin edits | Size picker page as before (entity API), renders at 1440/390 |
| 22 | Size picker | Drawing scale | Admin edits | Size picker page as before (entity API), renders at 1440/390 |
| 23 | Size picker | Selected first | Admin edits | Size picker page as before (entity API), renders at 1440/390 |
| 24 | Size picker | Order and Active | Admin edits | Size picker page as before (entity API), renders at 1440/390 |
| 25 | Size picker | "Roll it out" card | Read only | read only: hint "Roll it out is fixed" on Size picker |
| 26 | Kits on the site | Name and tagline (per language) | Admin edits | Kits page as before, renders at 1440/390 |
| 27 | Kits on the site | Business type | Admin edits | Kits page as before, renders at 1440/390 |
| 28 | Kits on the site | Photo from product | Admin edits | Kits page as before, renders at 1440/390 |
| 29 | Kits on the site | Products in the kit and their order | Admin edits | Kits page as before, renders at 1440/390 |
| 30 | Kits on the site | Order and Active | Admin edits | Kits page as before, renders at 1440/390 |
| 31 | Brochures | PDF per language | Admin edits | Brochures upload as before (test:api brochure tests pass) |
| 32 | Brochures | Brochure download on / off | Admin edits | switch on the Brochures page (SettingsTable brochure_download_enabled); removed from the old Settings page |
| 33 | Brochures | File name, size, uploaded by and date | Read only | read only columns in the Brochures table |
| 34 | Form options | Business type choices | Admin edits | Form options page as before; scenario sections 0-17 pass |
| 35 | Form options | Monthly sales choices | Admin edits | Form options page as before; scenario sections 0-17 pass |
| 36 | Form options | Yes / No choices | Admin edits | Form options page as before; scenario sections 0-17 pass |
| 37 | Form options | Label (per language), order, Active | Admin edits | Form options page as before; scenario sections 0-17 pass |
| 38 | Form options | Stored value | Admin edits | Form options page as before; scenario sections 0-17 pass |
| 39 | Form rules | Brochure form: First name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 40 | Form rules | Brochure form: Last name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 41 | Form rules | Brochure form: E-mail - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 42 | Form rules | Brochure form: Phone - required? | Read only | scenario 18.3: PUT phone required=false -> 409, still required; the form shows it greyed "Always required (read only)" |
| 43 | Form rules | Quote form (also Sample): Full name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 44 | Form rules | Quote form (also Sample): Business name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 45 | Form rules | Quote form (also Sample): Business type - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 46 | Form rules | Quote form (also Sample): Town - required? | Admin edits | scenario 18.3: Town made optional, a quote without a town accepted (201), the site form shows it optional (bootstrap formRules) |
| 47 | Form rules | Quote form (also Sample): Phone - required? | Read only | scenario 18.3: PUT phone required=false -> 409, still required; the form shows it greyed "Always required (read only)" |
| 48 | Form rules | Quote form (also Sample): E-mail - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 49 | Form rules | Quote form (also Sample): Products - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 50 | Form rules | Quote form (also Sample): Monthly quantity - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 51 | Form rules | Quote form (also Sample): Message - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 52 | Form rules | Distributor form: Full name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 53 | Form rules | Distributor form: Firm name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 54 | Form rules | Distributor form: GST number - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 55 | Form rules | Distributor form: Areas - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 56 | Form rules | Distributor form: Godown and vehicles - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 57 | Form rules | Distributor form: Brands - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 58 | Form rules | Distributor form: Monthly sales - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 59 | Form rules | Distributor form: Phone - required? | Read only | scenario 18.3: PUT phone required=false -> 409, still required; the form shows it greyed "Always required (read only)" |
| 60 | Form rules | Distributor form: E-mail - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 61 | Form rules | Contact form: Full name - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 62 | Form rules | Contact form: Phone - required? | Read only | scenario 18.3: PUT phone required=false -> 409, still required; the form shows it greyed "Always required (read only)" |
| 63 | Form rules | Contact form: E-mail - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 64 | Form rules | Contact form: Message - required? | Admin edits | Form rules page: Required tick per form and field (PUT /website/form-rules/field), read by the API and the site forms (form_fields); same as 18.3 |
| 65 | Form rules | Longest text per field | Read only | read only on Form rules: Longest text from form_fields.max_len, with note |
| 66 | Form rules | Checks: e-mail, Indian mobile, GST number format | Read only | read only on Form rules: the 3 checks from src/shared/formChecks.js, with note |
| 67 | Form rules | Spam limit | Admin edits | scenario 18.4: 21 refused, limit 2 saved, third enquiry from one visitor 429, another visitor 201 |
| 68 | Form rules | Most products in one quote | Admin edits | Form rules Limits: 1 to 100, saved in lead_max_products, used by API and site (bootstrap formRules.maxProducts) |
| 69 | Form rules | Error messages (per language) | Admin edits | Form rules page shows the 7 error texts per language (ui_text) |
| 70 | Where we deliver map | Town name (per language) | Admin edits | Where we deliver map page: names per language, drag pin/name, base, lat/lng, order (PUT /website/map, /website/map-order); 18.5 checks names and pin on the site |
| 71 | Where we deliver map | Pin position and name position | Admin edits | Where we deliver map page: names per language, drag pin/name, base, lat/lng, order (PUT /website/map, /website/map-order); 18.5 checks names and pin on the site |
| 72 | Where we deliver map | Godown base town | Admin edits | Where we deliver map page: names per language, drag pin/name, base, lat/lng, order (PUT /website/map, /website/map-order); 18.5 checks names and pin on the site |
| 73 | Where we deliver map | Latitude and longitude | Admin edits | Where we deliver map page: names per language, drag pin/name, base, lat/lng, order (PUT /website/map, /website/map-order); 18.5 checks names and pin on the site |
| 74 | Where we deliver map | Order and Active | Admin edits | Where we deliver map page: names per language, drag pin/name, base, lat/lng, order (PUT /website/map, /website/map-order); 18.5 checks names and pin on the site |
| 75 | Where we deliver map | One list with Delivery areas | Add it | scenario 18.5: a new Delivery area ticked Show on map appears in bootstrap towns (EN + TA name); migration kept all 6 towns (fresh install + dev compare) |
| 76 | Menu links | Link names (per language) | Admin edits | Menu links drawer: names per language = the nav_ ui_text rows; 18.10 shows a 4th language name |
| 77 | Menu links | Order | Admin edits | scenario 18.6: About hidden and Where moved first in header, phone menu and footer |
| 78 | Menu links | Show / hide each link | Admin edits | scenario 18.6: About hidden and Where moved first in header, phone menu and footer |
| 79 | Menu links | Where a link goes | Admin edits | picked from siteTargets (pages / sections only), linkProblem checked on the server |
| 80 | Menu links | Show in header / phone menu / footer | Admin edits | scenario 18.6: About hidden and Where moved first in header, phone menu and footer |
| 81 | Menu links | Links to other websites | Not needed | scenario 18.6: a link to another website refused (400); no URL box in the drawer |
| 82 | Visit cards | Card name (per language) | Admin edits | Visit cards drawer: name and address per language (ui_text); 18.10 shows the 4th language card name |
| 83 | Visit cards | Address (per language) | Admin edits | Visit cards drawer: name and address per language (ui_text); 18.10 shows the 4th language card name |
| 84 | Visit cards | Map location | Admin edits | map location field + "Check on the map" preview (Google embed as on the site); bootstrap visitCards.query |
| 85 | Visit cards | Add more cards | Admin edits | scenario 18.7: third card filled from a godown, shown on the site (EN, TA falls back) |
| 86 | Visit cards | Order and Active | Admin edits | Visit cards order (drag, PUT /website/visit-cards-order) and Shown tick; only active cards in bootstrap |
| 87 | Visit cards | Fill from a godown | Add it | scenario 18.7: third card filled from a godown, shown on the site (EN, TA falls back) |
| 88 | Visit cards | Phone and opening hours | Add it | scenario 18.7: godown phone and hours copied; ContactBand shows the phone (c_phone_l) and hours lines when set |
| 89 | Google and sharing | Page titles and descriptions (per page, per language) | Admin edits | Google and sharing page lists the group "Google and sharing" texts per page and language (ui_text) |
| 90 | Google and sharing | Share picture | Admin edits | share_image upload as before (SettingsTable) |
| 91 | Google and sharing | Show in Google (indexing on / off) | Admin edits | indexing switch asks "Hide the site from Google?" before turning off |
| 92 | Google and sharing | Google Analytics ID | Admin edits | ga4_measurement_id as before; dashboard link goes to Google and sharing |
| 93 | Google and sharing | Website address | Read only | read only Website address from the server (/website/facts site_url) |
| 94 | Site settings | Company name, CIN, GSTIN | Read only | Site settings: read only boxes from Admin > Company with links; PUT of a company key refused (409, unchanged) |
| 95 | Site settings | Phone, e-mail, WhatsApp number | Read only | Site settings: read only boxes from Admin > Company with links; PUT of a company key refused (409, unchanged) |
| 96 | Site settings | About section photo | Admin edits | about_image upload + focus as before |
| 97 | Site settings | Where enquiry e-mails go | Admin edits | scenario 18.8: change waits (value unchanged), asker cannot sign (403), another Admin signs -> changed |
| 98 | Site settings | Mail sender name and address | Admin edits | mail_from picked from verified SendGrid senders (GET /website/senders), mail_from_name typed |
| 99 | Site settings | Mail logo | Admin edits | mail_logo_url preview and test mail as before (test:api passes) |
| 100 | Site settings | Google sheet for leads | Admin edits | gsheet_spreadsheet_id goes through the same second-Admin request as 97 (SECOND_ADMIN_SETTINGS) |
| 101 | Site settings | Two-step sign-in | Read only | scenario 18.9: two-step off waits for a second Admin, typed PUT refused; switch on Users and security, read only on Site settings |
| 102 | Site settings | WhatsApp button greeting (per language) | Admin edits | Site settings shows wa_general per language; 18.10 shows the Telugu greeting |
