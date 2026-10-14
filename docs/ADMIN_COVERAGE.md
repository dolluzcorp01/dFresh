# Admin coverage - what a dFresh admin can change without a developer

Audit of everything a visitor sees on the public site, the e-mails, and what Google / WhatsApp share previews show.
For each item: can a dFresh admin change it from the admin console (`/admin`) on their own?

Checked against the code and the local database on 13 Oct 2026 (commit `4b951aa`). Updated the same day after the
small fixes it listed were built (commits `019df81` pictures, `1d122bb` Google and sharing texts, `af1d28e` live
numbers / addresses / company line, `026fc67` towns, form texts, staff e-mails).

## How to read this

| Answer | Meaning |
|---|---|
| **Yes** | Fully changeable in the admin. The screen and field are named. |
| **Text only** | The words can be changed, but something visible about it cannot (the image, the link, the number of items, the layout). |
| **No** | Hard-coded. Needs a developer. The last column says what it would take. |

Effort to make a "No" editable: **small** = under 1 day, **medium** = 1 to 3 days, **large** = more than 3 days.

"Translations > `key`" means: admin sidebar **Translations**, search for that key, edit the cell (one column per language).

**Roles.** Leads, Products, Translations, Banners, Business kits, Towns, Categories, Size picker, Form options and Brochures need the
**editor** role. **Settings**, **Languages** and **Excel import** need the **admin** role.

**When edits show.** Every admin save clears the site's content cache and the pre-rendered pages are rebuilt on the next
visit, so a change is live on the next page load. No build or restart is needed. The one exception is noted in section 1
(the offline error screen).

## Things to know before the tables

1. **Numbers in text follow the site.** In any Translations text, `{products}`, `{categories}`, `{towns}` and
   `{languages}` show the current count in digits; add `_word` (e.g. `{towns_word}`) for the word, taken from the
   `num_words` text of that language. "All 25 products", "six towns" and "Six ways to soft" (and TA/HI) use them now.
   The Translations screen lists the placeholders at the top.
2. **Each address has one home:** Translations, group Contact details (`c_office`, `c_office_a`, `c_godown`,
   `c_godown_a`), one text per language. The contact cards, the footer, the Google Maps search (the English text)
   and Google's business data all read it. The old Settings copies and the footer's own copy are gone.
3. **The footer company line is built from Settings** `company_name`, `cin` and `gstin` ("CIN" / "GSTIN" words:
   Translations `legal_cin`, `legal_gstin`); the GSTIN part is hidden while `gstin` is empty. The company name is
   the same (English legal name) in every language.
4. **Every setting does something.** The unused `site_url` and `recaptcha_site_key` were removed; the site address
   lives in the server's `.env` (`PUBLIC_SITE_URL`).
5. **Translations edits existing text slots only.** An admin cannot add a new text slot (key). Any "No" below that says
   "add a text key" means a developer adds the slot once; after that the admin edits it.
6. **Many texts are shared.** For example `sample` is the label on three different buttons and `ok_other` is both the
   form success message and a line in the confirmation e-mail. Changing one changes all of them.

---

## 1. Whole site (every page)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Header logo | No | Image file in code (`/media/logo/dfresh-logo-on-light.webp`). Replace the file on the server. A "Brand images" upload screen: medium. |
| Header menu labels (Products, For Business, Where to buy, About, Contact) | Text only | Translations > `nav_products`, `nav_business`, `nav_where`, `nav_about`, `nav_contact`. Which links exist, their order and where they go: No, small (a menu table). |
| Language switcher (labels, which languages, order) | Yes | Languages: Switcher label, Order, Switch on / off, Add language. Font and direction follow the Script picked there. |
| Header "Brochure" button label | Yes | Translations > `brochure` |
| Mobile menu (links + "Request a quote", "Become a distributor") | Text only | Translations > nav keys, `request_quote`, `become_distributor`, `menu`. The set of items: No, small. |
| Floating WhatsApp button: number | Yes | Settings > `whatsapp_number` (digits only, e.g. 919330259330) |
| Floating WhatsApp button: pre-filled message | Yes | Translations > `wa_general` (shared with every general WhatsApp button) |
| Floating WhatsApp button: screen-reader label | Yes | Translations > `wa_float` |
| Floating WhatsApp button: icon, colour, position | No | Design. Not planned to be editable. |
| Loading skeleton (grey bars while the page loads) | No | Design. No text in it. |
| Offline error screen ("This page did not load", Try again, WhatsApp us) | Text only, after a build | Translations > `load_err_h`, `load_err_p`, `retry`, `whatsapp_us`, `wa_general`; WhatsApp number from Settings. These are copied into the site at build time (it must work when the API is down), so an edit shows only after the next `npm run build`. Making it live: medium. |
| Gold section eyebrows' leaf icon | No | Image file in code. Brand artwork. |
| Copy / right-click / image-save protection | No | Rule 14 of the brief. Not text. |

## 2. Home - Hero (top of the page)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Eyebrow "Tissue & hygiene paper · Kanchipuram" | Yes | Translations > `eyebrow` |
| Headline "Gentle, / like you." (2 lines) | Yes | Translations > `hero_l1`, `hero_l2` |
| Headline animation (gold rise-in, letters lifting near the pointer) | No | Design. |
| Lede paragraph | Yes | Translations > `lede` |
| "WhatsApp us" button: label / number / message | Yes | Translations > `whatsapp_us`, `wa_general`; Settings > `whatsapp_number` |
| "See all products" button label | Yes | Translations > `see_all_products` |
| Tissue sheet (the soft sheet you can touch and pick up) | No | Design. The icon printed on it is a fixed image file. Its screen-reader label: Translations > `sheet_label`. |
| Falling petals, leaf trail behind the pointer | No | Design. |
| Stats strip numbers (products, categories, towns served, languages) | Yes, automatic | Counted live from active products (cards, not colours), categories, towns and languages. Change the data, the numbers follow. |
| Stats strip labels | Yes | Translations > `st_p`, `st_c`, `st_t`, `st_l` |

## 3. Home - Banner slider ("dFresh moods")

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Which banners show, and their order | Yes | Banners: Active, drag rows to reorder |
| Add a new banner / delete one | Yes | Banners > Add (create first, then upload both photos, then switch on) / Delete |
| Desktop photo (1920x800) and mobile photo (1080x1350) | Yes | Banners > open a banner > Photos > Upload (JPG / PNG / WebP, cropped to size automatically) |
| Headline on each banner | Yes | Banners > Text per language > Headline |
| Button label | Yes | Banners > Text per language > Button label |
| What the button does | Yes | Banners > Button action (all products, For Home products, one category, scroll to a section, open a form) + Button target |
| Light / dark style (ink or gold button) | Yes | Banners > Theme |
| Small eyebrow above every headline "dFresh moods" | Text only | Translations > `bn_k`. One text for all banners; a different eyebrow per banner: small. |
| Slide timing (6 seconds), fade and zoom | No | Design. Timing as a setting: small. |
| Arrows and dot labels for screen readers | Yes | Translations > `bn_prev`, `bn_next`, `bn_goto`, `bn_label` |

## 4. Home - "Who it's for" doors (For Home / For Business)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Section eyebrow and heading | Yes | Translations > `doors_k`, `doors_h` |
| Door texts (label, heading, paragraph, link text) | Yes | Translations > `for_home`, `dh_h`, `dh_p`, `dh_go`; `for_business`, `db_h`, `db_p`, `db_go` |
| Door photos | Yes | Settings > `door_home_product`, `door_biz_product` (product dropdown; the door shows that product's first photo, changed in Products) |
| Where the doors lead (For Home products / Business kits section) | No | Fixed in code. Small. |

## 5. Home - Range ring ("Spin the range")

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Eyebrow, heading, paragraph, "Drag to spin" hint | Yes | Translations > `range_k`, `range_h` (`{categories_word}` = the number of categories, see note 1), `range_p`, `ring_hint` |
| Which categories are on the ring, names, order | Yes | Categories: Name per language, Active, drag to reorder, Add |
| Photo on each category tile | Yes | Categories > Photo from product (uses that product's first photo; change the photo itself in Products) |
| "N products" under each tile | Yes, automatic | Counted live; wording: Translations > `n_product`, `n_products` |
| Spin speed, 3D look | No | Design. |

## 6. Home - Featured products rail ("Bestsellers / Most loved")

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Eyebrow, heading, paragraph | Yes | Translations > `feat_k`, `feat_h`, `feat_p` |
| Which products are featured and their order | Yes | Products > "Most loved" card (same title as the home section, photo cards, drag to order) + drawer "In "Most loved" on the home page" / "Most loved" order |
| The cards themselves | Yes | Same cards as the products drawer, see section 12 |
| Arrow labels | Yes | Translations > `feat_prev`, `feat_next` |

## 7. Home - Try it (toilet roll + napkin sizer)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| "Try it" hint | Yes | Translations > `tryit` |
| Roll tile: eyebrow, heading, paragraph | Yes | Translations > `ur_k`, `ur_h`, `ur_p` |
| Six words printed on the paper sheets (2-PLY, SOFT, ~300 PULLS...) | Text only | Translations > `rl_ply`, `rl_soft`, `rl_pulls`, `rl_perf`, `rl_tear`, `rl_fits`. Always exactly six; more or fewer: small. |
| Roll drawing and behaviour | No | Design. |
| Napkin tile: eyebrow, heading, paragraph, "cm" | Yes | Translations > `fo_k`, `fo_h`, `fo_p`, `unit_cm` |
| Size buttons, the product each size shows, napkin drawing size, which size is picked first | Yes | Size picker: Size label, Product, Drawing scale, Selected first, Add / delete rows |
| Logo stamp on the napkin | No | Fixed image file. Brand artwork. |

## 8. Home - For Business kits

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Eyebrow, heading, paragraph | Yes | Translations > `for_business`, `biz_h`, `biz_p` |
| Which kits, order, name, tagline | Yes | Business kits: Active, drag to reorder, Name, Tagline, Add |
| Products listed in each kit | Yes | Business kits > Products (in order): tick rows with photos (filter, colour versions under their product), drag the "Selected (in order)" list |
| Kit photo | Yes | Business kits > Photo from product (searchable photo picker, kit's own products first, larger preview) |
| Business type the "free sample" form is pre-filled with | Yes | Business kits > Business type |
| "Request this kit" WhatsApp message | Yes | Translations > `wa_kit` ({kit} and {items} are filled in) and `kit_cta` for the label |
| "Get a free sample" label | Yes | Translations > `sample` (shared, see note 6) |
| Kit numbers 01, 02... and button colours | No | Automatic from the order. Design. |

## 9. Home - Where we deliver (map)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Eyebrow, heading, paragraph | Yes | Translations > `where_k`, `where_h`, `where_p` (`{towns_word}` = the number of towns, see note 1) |
| Towns: names, order, which is the godown base, on / off | Yes | Towns: Name, Order, Godown base, Active, Add |
| Pin position on the map | Yes | Towns > Map x (0-600), Map y (0-360) |
| Position of each town's name next to its pin | Yes | Towns > Name: move right / left, Name: move down / up, Name: which part sits at that point (live map preview in the editor) |
| The land shape of the map | No | Fixed drawing. Medium (an upload or editor for the map). |
| "Become a distributor" button | Yes | Translations > `become_distributor` (opens the distributor form) |
| Map description for screen readers | Yes | Translations > `map_aria` |

## 10. Home - About

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Eyebrow, heading, paragraph | Yes | Translations > `ab_k`, `ab_h`, `ab_p` |
| Photo | Yes | Settings > `about_image`: preview, Upload (JPG / PNG / WebP, cropped to 1920 x 800), Remove |
| Photo description for screen readers | Yes | Translations > `ab_alt` |
| Three points (Our promise, Kanchipuram godown, Quality check) | Text only | Translations > `ab1_h`, `ab1_p`, `ab2_h`, `ab2_p`, `ab3_h`, `ab3_p`. Always three; the icons (leaf, box, tick) are fixed. Small. |

## 11. Home - Contact band

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Heading "Let's talk fresh." and paragraph | Yes | Translations > `band_h`, `band_p` |
| Four buttons (free sample, WhatsApp, brochure, message) | Text only | Translations > `sample`, `whatsapp_us`, `download_brochure`, `msg_btn`. Which buttons and what they open: No, small. |
| WhatsApp number shown, office phone, e-mail | Yes | Settings > `whatsapp_display` (the number as shown), `whatsapp_number` (the link), `office_phone`, `public_email`. Labels: Translations > `lbl_whatsapp`, `lbl_office` |
| Visit cards: names and addresses | Yes | Translations > Contact details: `c_office`, `c_office_a`, `c_godown`, `c_godown_a` (the only copy, see note 2) |
| Google maps in the cards and "Open in Google Maps" | Yes | Follow the English address in Translations > `c_office_a`, `c_godown_a`; labels Translations > `c_map`, `map_load` |
| Exactly two visit cards (office + godown) | No | A third location: small to medium. |
| Yellow blob, confetti | No | Design. |

## 12. Products drawer, /products page and product cards

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Drawer title "All products", search placeholder, "no match" message | Yes | Translations > `all_h`, `search`, `search_label`, `none` |
| Filter chips (All, For Home, each category) | Yes | Labels: Translations > `all`, `home_only`; categories from Categories; which products are "For Home": Products > In "For Home" filter |
| Which products show, and their order | Yes | Products > Active, Sort order (also Excel import / export for bulk changes) |
| Add a new product / add a colour of a product | Yes | Products > Add product / Add colour variant |
| Card front: product ID | Yes, at creation | Products > Product ID (fixed once created) |
| Card front: name, one-liner, first 3 keywords | Yes | Products > Text per language > Name, One-liner, Keywords |
| Card front: 1 to 3 photos and their order | Yes | Products > Photos (upload, move, remove; made 1200x1200 WebP automatically) |
| Photo descriptions for screen readers | Yes | Products > Photo alt text; Translations > `card_photo`, `card_photo_of` |
| Colour dots and colour names | Yes | Each colour variant: Swatch colour (#RRGGBB), Colour name; label Translations > `colour` |
| Card with no photo (logo + name + spec drawn automatically) | Yes, automatic | Follows name and specification. |
| "Know more" | Yes | Translations > `know_more` |
| Card back: description, specification, pack, best for | Yes | Products > Description, Specification, Pack, Best for (Specification and Pack "this language only" boxes for the other languages; empty = the main value) |
| Card back headings (Specifications, Pack, Best for) | Yes | Translations > `specifications`, `pack`, `best_for` |
| Card back WhatsApp button: message | Yes | Products > WhatsApp message (per product); label Translations > `lbl_whatsapp` |
| "Request a quote" and "Back" | Yes | Translations > `request_quote`, `back` |
| What search matches (name, English name, ID, specification, keywords) | Text only | The keywords are editable (Products > Keywords); the matching rules are code. |
| Internal "Spec status" | Never shown | Products > Spec status is internal and never reaches the site (correct, rule 5). |

## 13. Page titles, Google descriptions and share previews

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Home page title | Yes | Translations > Google and sharing > `seo_home_t` (counter: 60 characters). Changes no text on the page. |
| Products page title, and each category's page title | Yes | Translations > Google and sharing > `seo_products_t`, `seo_cat_<category>_t` (a new category gets its own pair when it is created) |
| Privacy / Terms page titles | Yes | Translations > Google and sharing > `seo_privacy_t`, `seo_terms_t` |
| Google description and share description | Yes | Translations > Google and sharing > `seo_home_d`, `seo_products_d`, `seo_privacy_d`, `seo_terms_d`, `seo_cat_<category>_d` (counter: 160 characters) |
| Share image (WhatsApp / Facebook preview picture) | Yes | Settings > `share_image`: Upload a JPG / PNG of 1200 x 630 (checked; a larger picture of the same shape is resized), Remove = the logo again |
| Share card type (Twitter / X) | Yes, automatic | Large picture card while a share picture is set, small card with the logo otherwise. |
| Hidden Google business data (company name, phone, e-mail, address, product list) | Yes | Settings > `company_name`, `office_phone`, `public_email`; addresses Translations > `c_office_a`, `c_godown_a`; godown map pin: Towns > Latitude / Longitude of the base town; products from Products |
| Language versions for Google (hreflang), sitemap | Yes, automatic | Follow the active languages and products. |
| Browser tab icon (favicon), phone home-screen icon and name | No | Fixed files (`public/favicon*`, `manifest.json`). Brand artwork. |
| Google Analytics | Yes | Settings > `ga4_measurement_id` (not visible to visitors) |

## 14. The five forms (Brochure, Quote, Free sample, Distributor, Contact)

The free sample form is the quote form in "sample" mode, so it has the quote form's title and fields.

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Form titles and subtitles | Yes | Translations > `m_brochure`, `m_brochure_s`, `m_quote`, `m_quote_s`, `m_dist`, `m_dist_s`, `m_contact`, `m_contact_s` |
| Free sample form's own title | Yes | Translations > `m_sample` (starts as the quote title) |
| Field labels | Yes | Translations > `first_name`, `last_name`, `email`, `mobile`, `fl_name`, `fl_biz`, `fl_type`, `fl_town`, `fl_phone`, `fl_prod`, `fl_qty`, `fl_msg`, `fl_firm`, `fl_gst`, `fl_area`, `fl_gd`, `fl_brands`, `fl_sales`; "(optional)": `optional`; "Choose...": `choose` |
| Dropdown choices (business type, monthly sales, yes / no) | Yes | Form options: Label per language, Order, Active, Add. (Never change a Stored value once used.) |
| Product tick list in the quote form | Yes | The active products from Products. |
| Which fields a form has, their order, required or optional, maximum length | No | One shared rules file used by the site AND the server (`src/shared/rules.json`) plus the lead columns in the database. A form builder: large. Making one existing field optional / required from the admin: medium. |
| Example text inside the boxes (98765 43210, name@company.com) | Yes | Translations > `ph_tel`, `ph_email` |
| Error messages | Yes | Translations > `e_fill`, `e_choose`, `e_pick`, `e_email`, `e_tel`, `e_gst`, `e_net`, `e_rate` |
| Phone / e-mail / GST checks (Indian 10-digit mobile only) | No | Rules in code. Medium. |
| Consent line and its privacy link | Yes | Translations > `consent`, `lg_priv_s` |
| Buttons (Download brochure, Send request, Submit, Sending...) | Yes | Translations > `download_brochure`, `send`, `submit`, `sending` |
| "Close without sending?" box | Yes | Translations > `close_confirm`, `keep_editing`, `close` |
| Logo at the top of every form | No | Fixed image file. |
| Spam limit (5 sends per 10 minutes) | No | Code. Small. |

### Form success screens

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| "Thank you, {name}!" | Yes | Translations > `thanks_name` |
| Brochure form: "Your brochure is downloading now..." | Yes | Translations > `ok_bro` |
| Brochure form when no brochure is uploaded yet | Yes | Translations > `bro_pending` |
| Quote, sample, distributor, contact: "Our team will contact you on WhatsApp." | Text only | Translations > `ok_other`. One message for all four forms (also in the confirmation e-mail); a message per form: small. |
| Reference number line | Yes | Translations > `mail_ack_ref`, `mail_ack_keep` (the number itself is automatic) |
| WhatsApp button | Yes | Translations > `whatsapp_us`, `wa_general`; Settings > `whatsapp_number` |
| Gold tick | No | Design. |

### Brochure file and download link

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| The brochure PDF (one per language, English used when a language has none) | Yes | Brochures: Upload / Replace / Delete per language (PDF up to 5 MB) |
| Page shown when a brochure link has expired or no brochure exists | Text only | Translations > `bro_expired`, `bro_pending`, `home_link` (button). The page design is fixed. |

## 15. Privacy policy and Terms pages

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Page headings | Yes | Translations > `lg_priv`, `lg_terms_h` |
| Policy text (English) | Yes | Translations > `legal_privacy_body`, `legal_terms_body`. It is HTML typed into a text box (allowed: paragraphs, h3, h4, lists, bold, italic, line breaks). A proper text editor for it: medium. Any change must be approved by the Director first. |
| Note shown when the text is the English version in another language | Yes | Translations > `lg_en` (currently empty) |
| A translated policy | Yes | Fill the other language's column of the same keys; English is shown until then. |

## 16. Footer

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| dFresh logo and "Gentle, Like You" tagline artwork | No | Fixed image files (the tagline is artwork by brand rule). Its screen-reader text: Translations > `tagline`. |
| Brand line "dFresh is a brand of Dolluz Corporation..." | Yes | Translations > `brand_line` |
| Column headings (Shop, Work with us, Visit) | Yes | Translations > `f_shop`, `f_work`, `f_visit` |
| Shop links (Products, For Business, Where to buy, Our range, About) | Text only | Translations > nav keys and `f_range`. The set of links: No, small. |
| Work with us links (quote, distributor, brochure) | Text only | Translations > `request_quote`, `become_distributor`, `download_brochure`. The set: No, small. |
| WhatsApp, office phone, e-mail | Yes | Settings > `whatsapp_display`, `whatsapp_number`, `office_phone`, `public_email` |
| Address line "Padur office · Kanchipuram godown" | Yes | Built from Translations > Contact details `c_office` and `c_godown` (see note 2) |
| Company line (company, CIN, GSTIN) | Yes | Settings > `company_name`, `cin`, `gstin` (each part hidden while empty); words "CIN" / "GSTIN": Translations > `legal_cin`, `legal_gstin` (see note 3) |
| "© 2026 dFresh" (the year is automatic) | Yes | Translations > `copyright` |
| Privacy / Terms link texts | Yes | Translations > `lg_priv`, `lg_terms` |
| Large "dFresh" letters at the bottom | No | Decorative artwork in code. |

## 17. E-mails

All e-mails share one design (ink header with the logo, gold rule, beige footer). The design itself is fixed (No, medium
to make colours or layout editable).

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Sender address and name (every e-mail) | Yes | Settings > `mail_from` (must be a verified SendGrid sender), `mail_from_name` |
| Logo in the e-mail header | Yes | Settings > `mail_logo_url` (checked before saving, with a preview and "Send test mail"); empty = the built-in logo |
| Who receives new-lead alerts | Yes | Settings > `lead_email` |

### Visitor e-mails (in the visitor's language)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| Confirmation after quote / sample / distributor / contact: subject | Yes | Translations > `mail_ack_subject` ({ref} = the reference number) |
| Confirmation: heading, intro, reference box, "What happens next", next-step line, keep-this-reference line | Yes | Translations > `thanks_name`, `mail_ack_intro`, `mail_ack_ref`, `mail_ack_next_h`, `ok_other` (shared with the success screen), `mail_ack_keep` |
| Confirmation: WhatsApp button | Yes | Translations > `whatsapp_us`, `wa_general`; Settings > `whatsapp_number`, `whatsapp_display` |
| Brochure e-mail (copy link): subject, greeting, button | Yes | Translations > `mail_bro_subject`, `mail_bro_intro` ({name}), `download_brochure` |
| Footer of visitor e-mails (company name, e-mail) | Yes | Settings > `company_name`, `public_email` |
| Brochure lead when no brochure is uploaded | Nothing is sent | The visitor sees `bro_pending` on screen; staff see "No brochure uploaded yet" in the lead alert. |

### Staff e-mails (English, internal)

| Item | Admin can change? | Where in the admin / what it would take |
|---|---|---|
| New lead alert: subject, row labels (Lead ref, Form, Name...), form names, button, footer | Yes | Translations > Staff e-mails (`ma_*`, English only; the values come from the lead) |
| Admin sign-in code e-mail | Yes | Translations > Staff e-mails (`mc_*`, English only) |
| "Send test mail" e-mail (from Settings) | No | English text in code. Staff only, a test tool. |

---

## Summary of the gaps

Built on 13 Oct 2026 (all "small" items of the first audit): share picture, About photo upload, door photos, page
titles and descriptions per page, live numbers in text, one source for addresses, company line from Settings,
settings that did nothing removed, town name positions, form example text, the free sample title, staff e-mail
texts.

Visitor-facing items that still need a developer:

| Gap | Effort |
|---|---|
| Menu / footer link lists, contact band buttons, About points count, roll words count | small each |
| A success message per form (today `ok_other` for four forms), an eyebrow per banner, where the doors lead, slide timing, the spam limit | small each |
| A third visit card (another location) | small to medium |
| Offline error screen text live without a build | medium |
| Section order / hiding a whole home section | medium |
| A text editor for the privacy and terms text (today raw HTML) | medium |
| Brand images (logos, tagline artwork, favicon, icon) from the admin | medium |
| Which fields each form has / required or optional | medium to large |
| Map land shape | medium |

Copy to review (not code): with today's texts the home page title is over the 60-character counter (EN 64, TA 76) and
the Tamil descriptions over 160 (177); Google may cut them short. Tamil / Hindi number words in `num_words` are drafts
for native review.

Animations, colours, fonts and layout are deliberately not editable: they follow the approved preview
(`docs/reference/dfresh-preview-v3.html`).
