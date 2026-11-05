# 06 - API (base `/api/dfresh`)

All responses: `{ success: true, data }` or `{ success: false, message }`. JSON only. Parameterised SQL only.
Public endpoints never return internal columns (`spec_status`, `staff_notes`, `ip_hash`, non-public settings).

## Public (no auth, cached)
| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ db: 'ok', counts: { products, variants, languages }, version }` (no secrets) |
| GET | `/languages` | `{ languages: [{ code, nativeName, switchLabel, htmlLang, dir, fontFamily, isDefault }], default }` (active only, ordered by sort_order; `default` is the default language code) |
| GET | `/bootstrap?lang=xx` | ONE payload for the site in that language (English fallback applied): `{ lang, ui: {key: value}, settings: {public keys}, categories[], products[] (cards with variants[], images[]), banners[], kits[], towns[], formOptions: {list_key: [{value,label}]}, sizePicker[], places: {office, godown}, stats: {products, categories, towns, languages}, contentVersion }`. `ui` has {products} / {towns_word} ... already filled in from `stats` (src/shared/countText.js) and never holds the "Staff e-mails" group; `places` = the default language's office / godown address (Google Maps search) |
| GET | `/legal/:page?lang=xx` | `{ title, html, isEnglishFallback }` for `privacy` / `terms` |

Town shape: `{ key, isBase, mapX, mapY, label: { dx, dy, anchor }, lat, lng, name }` (label = where the name sits
on the illustrated map, relative to the pin).
Category shape: `{ key, sort, repProductId, name, count }` where `count` = active product cards in that category
(variants not counted). Image `width` / `height` are pixels from `product_images`, `null` when unknown.

Caching: build bootstrap once per language, keep in memory with `contentVersion`; send `ETag` and
`Cache-Control: no-cache` (the browser revalidates every load; unchanged = a small 304 by ETag, so an admin save
shows on the next normal reload). Any admin write increments `contentVersion`
and clears the cache. Safety TTL: an entry older than 5 minutes is rebuilt on the next request, so DB changes
made outside the admin show up without a restart (if that rebuild fails, the expired copy is served).
Local dev: `npm run cache:bust` clears the cache now (calls `POST /dev/cache-bust`, which exists only when
NODE_ENV is not production and answers loopback callers only).

Product shape (card):
```json
{ "id": "DZIND-DF008", "category": "napkins", "sort": 5, "featured": false, "featuredOrder": null,
  "forHome": true, "swatch": "#FFFFFF", "spec": "...", "pack": "...",
  "name": "...", "nameEn": "... (default-language name, for search)", "oneLiner": "...", "keywords": ["2-ply","29×30 cm","Quarter-fold"], "description": "...",
  "bestFor": "...", "colourName": "White", "alt": "...", "whatsapp": "...",
  "images": [{ "pos": 1, "src": "/media/products/1200/DZIND-DF008_1.webp",
               "srcset": "/media/products/400/DZIND-DF008_1.webp 400w, ... 800w, ... 1200w",
               "width": 1200, "height": 1200 }],
  "variants": [ { "id": "DZIND-DF008-BLK", "swatch": "#1B1B1D", "colourName": "Black", "...same text fields...", "images": [] } ] }
```

## Leads
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/leads` | `{ form_type, lang, source_page, source_ref, consent: true, website: '' (honeypot), ...fields }` | 201 `{ lead_ref, brochure_available?, brochure_delivery?, brochure_token? }` (brochure only: `brochure_delivery` 'download' / 'pending' (no PDF) / 'off' (Settings `brochure_download_enabled` off); `brochure_token` only with 'download') |
| GET | `/brochure/download?token=` | - | PDF stream (`attachment; filename="dFresh_Brochure_<LANG>.pdf"`), 400 bad token, 410 expired, 404 none uploaded, 404 for every link while Settings `brochure_download_enabled` is off (page text `bro_off`). The first download sets the lead's `details_json.brochure_downloaded_at`. JSON `{message}`; a browser (Accept: text/html) gets a small page with `bro_expired` / `bro_pending` in the token's language |

Field names per form_type:
- brochure: `first_name, last_name, email, phone`
- quote / sample: `full_name, business_name, business_type, town, phone, email, products[] (product ids), monthly_quantity?, message?`
- distributor: `full_name, firm_name, gst_no?, areas, godown_vehicles (yes/no), brands?, monthly_sales, phone, email`
- contact: `full_name, phone, email, message`
Status codes: 400 validation (with `fields: {name: errorKey}`; `consent` appears there too), 429 rate limit
(`errorKey: 'e_rate'`; 5 per 10 min per `ip_hash`, from `rules.json`, env `LEAD_RATE_LIMIT_PER_10MIN` overrides),
500 never leaks details. Honeypot filled: 200 `{ lead_ref: null }`, nothing saved.
Queued with the lead (mail_outbox): staff alert; visitor brochure copy (brochure, when a PDF exists) or visitor
confirmation `lead_ack` with the lead_ref (quote, sample, distributor, contact), in the visitor's language.
Tokens: JWT (purpose `brochure`, HS256) signed with a key derived from `JWT_SECRET`, so they can never pass as an
admin session; 15 min (`BROCHURE_TOKEN_TTL_MIN`) for the in-page download, 7 days for the e-mailed link.
The client IP is `req.ip` with `trust proxy = loopback` (nginx on the same host must set `X-Forwarded-For`).

## Admin (cookie `dfresh_admin_token`, role-checked)
| Method | Path | Role |
|---|---|---|
| POST | `/admin/login` (email, password) -> Settings `two_step_login` on (default): e-mails a 6-digit code, sets the challenge cookie; off: `data.signedIn` + the session cookie at once, no code, no mail. 5 wrong passwords for one account in 15 min lock it for 15 min (429, also with the right password), 20 per IP likewise; failed and blocked tries go to audit_log (`entity_type` admin_login) | - |
| POST | `/admin/login/verify` (code) -> sets the session cookie | - |
| POST | `/admin/login/resend` (challenge cookie) -> a new code (old one stops working); 30 s apart, max 3 per 15 min; 401 with `data.restart` when the sign-in must start again | - |
| POST | `/admin/logout` | any |
| GET | `/admin/me` | any |
| GET | `/admin/dashboard` | viewer+ |
| GET/PATCH | `/admin/leads?form&status&lang&from&to&q&ref&page`, `/admin/leads/:id` (status, assigned_to, staff_notes) | viewer read / editor write |
| GET | `/admin/assignees` (active admin users with names, for "assign") | viewer+ |
| GET | `/admin/leads/export.csv?filters`, `/admin/leads/export.xlsx?filters` (same filters; branded Excel, excel-theme.js) | editor+ |
| POST | `/admin/outbox/:type/:id/retry` | editor+ |
| GET/POST/PUT/DELETE | `/admin/products`, `/admin/products/:id` | viewer read / editor write |
| POST / DELETE / PUT | `/admin/products/:id/images` (multipart `file` + `position` 1-3), `/admin/products/:id/images/:position`, `/admin/products/:id/images/order` (`{order:[3,1,2]}`) | editor+ |
| GET | `/admin/products/export.xlsx` (branded: logo + title rows 1-3, header row 4; the import finds the header by its column names, so the old plain layout imports too) | editor+ |
| POST | `/admin/products/import?dryRun=1` (multipart xlsx) then `?dryRun=0` | admin |
| GET/PUT | `/admin/ui-text`, `/admin/ui-text/:key/:lang` (`{value}`; empty = delete, falls back) | viewer read / editor write |
| GET / POST | `/admin/ui-text/export.csv`, `/admin/ui-text/export.xlsx` (branded, for reading; the import stays CSV), `/admin/ui-text/import?dryRun=1` then `?dryRun=0` (multipart csv) | editor+ |
| CRUD | `/admin/banners`, `/admin/kits`, `/admin/towns`, `/admin/categories`, `/admin/size-picker`, `/admin/form-options` (+ `POST /admin/<section>/reorder {order:[ids]}`; composite ids joined with `~`) | viewer read / editor write |
| POST | `/admin/banners/:id/image?kind=desktop\|mobile` (multipart; cropped to 1920x800 / 1080x1350 WebP) | editor+ |
| CRUD | `/admin/languages` (GET includes completeness % per language) | viewer read / admin write |
| GET/POST/DELETE | `/admin/brochures`, `/admin/brochures/:lang` (multipart pdf), `GET /admin/brochures/:lang/file` | viewer read / editor write |
| GET / PUT | `/admin/settings`, `/admin/settings/:key` (`{value}`; is_public is not editable; `share_image` / `about_image` accept only `""` = remove; `door_home_product` / `door_biz_product` must name a product card) | admin |
| POST | `/admin/settings/two-step-login/off` (the page asks first); `/admin/settings/two-step-login/on` e-mails a code to the signed-in admin (503 and still off when the mail fails); `/admin/settings/two-step-login/on/confirm` (`{code}`) switches it on. `PUT /admin/settings/two_step_login` is refused | admin |
| POST | `/admin/settings/:key/image` (multipart `file`, <= 8 MB): `share_image` = JPG / PNG of 1200x630 or larger in that shape -> `share/share-<hash>.jpg` + `.webp`; `about_image` = JPG / PNG / WebP -> `about/about-<hash>.webp` (1920x800, <= 250 KB) + `about/960/`. The previous generated file is deleted | admin |
| GET / POST / PUT | `/admin/users`, `/admin/users/:empId` (role, is_active; never your own admin access) | admin |
| GET | `/admin/audit?entity&emp&id&action&page` | admin |

Every admin route is registered with a role (route() in Admin_server.js); the API answers 401 without a valid
session and 403 below the role, whatever the UI shows. Sessions: JWT (JWT_SECRET, `app: dFresh`, `stage: session`,
8 h) in the httpOnly SameSite=Strict cookie; the role is re-read from `admin_users` on every request.
Writes record `audit_log` (before / after) in the same transaction; content writes bust the content cache.
Excel import: dry run returns `{ summary, added, changed[{product, diffs[{field, before, after}]}], removed,
categories, readOnly, unknownColumns, unknownSheets, errors }`; removed products are deactivated, never deleted.

Upload limits: images 8 MB in (converted to WebP), PDF 5 MB. Check magic bytes, never trust the extension.
File names are generated by the server (`<product_id>_<pos>-<hash>.webp`, `<banner_key>-<kind>-<hash>.webp`,
`dFresh_Brochure_<LANG>-<hash>.pdf`), never taken from the upload; the content hash makes every upload a new URL
(/media is cached immutable). Only such hashed files are deleted when replaced; seed originals are never touched.

### Catalogue (phase 14, catalogue.js; rights: the Products row, Standard cost needs See cost)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/catalogue/products` | products (status, stock per godown, low, language gaps) and finished SKUs |
| GET / PUT | `/admin/catalogue/products/:id` | one product with its words per language, photos, packs, history / save Basics, Website words, Label (field errors `fields`) |
| POST | `/admin/catalogue/products` | create as a Draft with the first pack (SKU code from the pack) |
| POST | `/admin/catalogue/products/:id/status` | `{ to }`: active, hidden, discontinued, archived, draft; discontinued -> active waits for a second Admin |
| POST | `/admin/catalogue/products-bulk/web`, `/admin/catalogue/nightly` | hide / show several; archive discontinued products with no stock (also once a night) |
| POST | `/admin/catalogue/products/:id/skus` | add a pack (409 when its code exists) |
| GET / PUT | `/admin/catalogue/skus/:code` | one SKU / save (MRP, standard cost, cartons, steps, weight, shelf life, HSN, substitutes, reorder, units) |
| POST / DELETE | `/admin/catalogue/skus/:code/barcodes[/:barcode]` | supplier EAN (check digit) or carton code; one barcode one SKU |
| POST | `/admin/catalogue/scan` | any barcode -> the SKU; unknown ones noted for the office |
| GET / POST | `/admin/catalogue/barcodes`, `/admin/catalogue/barcodes/link` | every barcode and the unknown list / link one |
| GET / POST | `/admin/catalogue/raw` | raw materials (RM-...) |
| GET / POST / DELETE | `/admin/catalogue/units[/:code]` | units of measure (a unit in use cannot go) |
| GET / POST / PUT | `/admin/catalogue/kits[/:key]` | kits: parts, price, sold, on the website (kit_products follows the parts) |
| GET / POST / PUT | `/admin/catalogue/categories[/:key]`, `.../order`, `.../:key/active` | categories; a category with active products stays shown |
| GET | `/admin/catalogue/labels` | label data and the label words per language |

### Prices and tax (phase 15, prices.js + pricing.js + tax.js; rights: the "Prices and tax" row, Commerce on; cost and margin need See cost)
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/admin/prices/lists` | every list (typed, rounding, default, status, types, priced, slabs, waiting) / a new list, optionally copied from another moved by a % (packs that break a rule are skipped and counted) |
| GET / PUT | `/admin/prices/lists/:key` | one list: every pack today (typed, without / with GST, carton, margin, lowest allowed, next change or waiting) / settings (name, who it is for, typed, rounding, customer types, default, status) |
| GET / PUT | `/admin/prices/lists/:key/skus/:sku` | the price panel: history, waiting change, bands / a new price from a date, the lowest allowed price (Admin; lowering waits for a second Admin), own bands. Below cost plus the margin floor = a waiting change PC-nnn (approval margin_floor) |
| POST | `/admin/prices/lists/:key/bulk` | change many prices: preview (`apply` false) with the skipped packs, then apply |
| GET / POST | `/admin/prices/lists/:key/export.xlsx`, `/admin/prices/lists/:key/import?dryRun=1` / `?dryRun=0&hash=` | one file per list (list, sku, product, price, from, typed, gst_rate, price_without_gst, price_with_gst) |
| GET | `/admin/prices/lists/:key/rate-card` | the rate card data |
| GET / PUT | `/admin/prices/slabs/:key` | a list's slabs / save (top slab checked for every pack without bands; below cost plus margin waits) |
| GET / POST | `/admin/prices/specials`, `/admin/prices/specials/now` | special prices (SP-nnn), what a customer pays now / a new one (waits: over the allowed %, raised without Approve, or below cost plus margin) |
| POST | `/admin/prices/specials/:no/end` | end an active special today (Cancel right) |
| GET | `/admin/prices/check?customer=&type=&sku=&qty=&date=&pos=`, `/admin/prices/check-options` | Check a price, step by step (list, slab or band, special, GST, CGST + SGST or IGST) |
| GET / POST / PUT | `/admin/prices/hsn[/:code]` | HSN codes with today's rate, next change, waiting change, packs / add a code / change its description or a new rate from a date (waits for a second Admin) |
| POST / DELETE | `/admin/prices/gst-rates[/:rate]` | the GST rate list (a rate in use cannot go) |

### Suppliers and buying (phase 16, buying.js + buying-routes.js; rights: the "Suppliers and buying" row, Commerce on; purchase rates and values only with See cost or Buying Edit, else null)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/buying/options` | the forms' lists: my godowns, what can be bought (raw materials, packs set as Bought or Both), suppliers, kinds, QC reasons, switches, the PO and tolerance rules, my rights |
| GET | `/admin/buying/find?q=` | suppliers, purchase orders and goods in matching the text (the menu's Find a page, v23 Ctrl K) |
| GET / POST | `/admin/buying/suppliers?tab=active\|blocked&q=` | the list (what we owe, a credit shown as credit, on-time and rejected %, bank change waiting) / a new supplier (code SUP-nnnn; a bank account waits for a second Admin, kind supplier_bank) |
| GET / PUT | `/admin/buying/suppliers/:id` | one supplier (contacts, items, approved bank masked, the bank waiting, record) / save (a changed bank account waits for a second Admin; payments go only to the approved one) |
| GET | `/admin/buying/suppliers-export` | CSV (Export right; no bank accounts) |
| GET / POST | `/admin/buying/indents?tab=`, `/admin/buying/indents/:id` | indents / ask for items (Create) |
| POST | `/admin/buying/indents/:id/approve`, `/reject` | Edit, never your own; a reject needs a reason |
| GET | `/admin/buying/indents/:id/po-draft` | an approved indent as a new PO (cheapest active supplier, last prices) |
| POST | `/admin/buying/indents/reorder-check` | indents for what is below its reorder level (stock, QC hold, open orders and indents count) |
| GET / POST | `/admin/buying/pos?tab=`, `/admin/buying/pos` | purchase orders / save a draft (`action: draft`, no number) or raise it (numbered; above the "Purchase order" rule, orders to one supplier counting together, it waits, kind po) |
| GET / DELETE | `/admin/buying/pos/:id` | one order (lines ordered / in / open, totals, goods in, claims, revisions, rejected amendments, the amendment waiting) / delete a draft |
| POST | `/admin/buying/pos/check`, `GET /admin/buying/last-price` | the live box while typing (last price, up %, minimum order, GST, totals, needs approval) |
| POST | `/admin/buying/pos/:id/amend` | a new revision; a higher value (with the supplier's other orders) or a higher rate or a new line waits; goods in and bills use the approved revision |
| POST | `/admin/buying/pos/:id/end` | `kind: cancel` (nothing came in) or `close` (close short), a reason (Cancel right) |
| GET | `/admin/buying/pos/:id/print`, `/pdf`; POST `/mail` | the printable order, its PDF, mail it to the supplier's contact through the outbox |
| GET | `/admin/buying/pos-export` | CSV, one row per line (Export right) |
| GET / POST | `/admin/buying/goods-in?tab=`, `/admin/buying/goods-in-form?po=`, `/admin/buying/goods-in` | goods in / the open lines of a PO / take in (to QC hold; beyond the tolerance or with no PO it waits, kinds excess_in, no_po_in; QC hold switched off: passed at once) |
| POST | `/admin/buying/scan` | a scanned code: carton (adds a carton) or a pack |
| GET | `/admin/buying/goods-in/:id` | one goods in (lines, batch, accepted, rejected, landed cost; days left to claim) |
| GET / POST | `/admin/buying/qc`, `/admin/buying/goods-in/:id/qc` | waiting and lately checked / the check (accepted + rejected = received; reason; GSM against the supplier's spec): accepted to Good at landed cost (average moves), rejected to the Rejected shelf and a claim |
| POST | `/admin/buying/goods-in/:id/late-claim` | faulty goods found after QC, within the claim days: never more than accepted, the same batch, on Good and not held |
| GET / POST | `/admin/buying/bills?tab=`, `/admin/buying/bill-form?supplier=`, `/admin/buying/bills/check`, `/admin/buying/bills` | supplier bills (MSME due within 7 days) / what can be billed at the approved PO rate / the live totals / save (billed never more than accepted; a different rate, or freight on goods with no PO, waits, kind bill_diff; the total within Rs 1; freight once per PO; due date by terms, MSME at most 45 days) |
| GET | `/admin/buying/bills/:id` | one bill (lines, PO rate, totals, what settled it, the average cost it moved) |
| GET | `/admin/buying/claims?tab=open\|settled`, `/admin/buying/claims/:id` | claims |
| POST | `/admin/buying/claims/:id/issue`, `/returned`, `/settle`, `/credit` | debit note (replacement or credit note), goods sent back (return challan), settled by a replacement on the same PO, or by their credit note (equal to the debit note; set against their bills, the rest kept as credit) |

### Supplier payments (phase 16, supplier-pay.js; rights: the "Payments" row, Commerce on; not for a role limited to its own customers)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/money/supplier-payments` | to pay (by supplier, oldest due first, MSME past 45 days), waiting for approval, paid |
| GET | `/admin/money/supplier-payments/form/:supplier` | the approved bank account (masked), a change waiting, the open bills with what can still be asked for |
| POST | `/admin/money/supplier-payments` | pay bills (matched or approved only) to the approved account only; above the "Pay a supplier" rule (payments to one supplier counting together) a second person signs, kind supplier_pay; the date checks the month lock |

### Production (phase 17, production.js + production-routes.js; rights: the "Production" row, Commerce on; made cost, material value and losses only with See cost, else null)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/production/options` | the godowns you work at, machines, made packs with a recipe today, operators (Production Create, by godown), shifts, wastage reasons, QC hold switch |
| GET | `/admin/production/recipes`, `/admin/production/recipes/:sku` | made packs with and without a recipe (version in use, next, waiting; made cost) / one recipe (versions, the made cost = materials at average cost with the wastage + labour + power, packs to copy from) |
| POST | `/admin/production/recipes/:sku` | a new version: one batch in whole cartons, from today (first) or tomorrow at the earliest (a change), wastage 0 to 30%, the reel (kg) first; a change waits for approval (kind recipe) |
| POST | `/admin/production/recipes/:sku/use-cost` | the made cost as the standard cost (See cost and Products Edit); a lower one waits for a second Admin (stdcost) |
| GET / POST / PUT | `/admin/production/machines`, `/admin/production/machines/:id` | machines / add / change (Edit): godown, what it makes, packs per hour, working or stopped with why (not while a run is going on it) |
| GET | `/admin/production/runs?tab=planned\|started\|done`, `/admin/production/runs/:id` | runs (counts per tab, machines) / one run (needs or issued, used against the standard, wastage and its approval, QC losses, Check again, labels) |
| GET | `/admin/production/run-calc?sku=&qty=&godown=&machine=&date=` | what a run needs against usable stock (QC hold does not count), whole cartons, hours on the machine |
| POST | `/admin/production/runs`, `/admin/production/runs/plan-low` | plan a run (machine at the godown, working, making the category; operator working there; today or later; a recipe in force) / tomorrow's runs for made packs below their reorder level (twice the level less what is there or coming, in whole batches) |
| POST | `/admin/production/runs/:id/start` | issue the need from Good (never expired, never below zero; month lock); batch M<machine>-yymmdd |
| POST | `/admin/production/runs/:id/finish` | packs made (at most 110%), material used (more taken, less returned), reason; above the recipe by more than the rule's % or nothing made: approval (prod_scrap); less material than the recipe: waits, nothing moves until signed |
| POST | `/admin/production/runs/:id/qc`, `/recheck` | production QC (Edit): passed + rejected = made; normal loss (within the recipe %) written off at Rs 0, abnormal at cost with approval (write_off); a loss not approved comes back to QC hold to Check again |
| POST | `/admin/production/runs/:id/cancel` | planned runs only, with a reason (Cancel right) |
| GET | `/admin/production/qc`, `/admin/production/wastage` | runs waiting for production QC, to Check again, checked lately (Purchase > Quality check) / wastage per run on the reel, trim kept, loss per machine |
| POST | `/admin/commerce/stock-ins` | refused (410) from phase 17: made packs come in through a production run, bought goods through Goods in; GET lists the stock-ins of before |

### Inventory (phase 18, inventory.js + inventory-routes.js + stock.js; rights: the "Inventory" row, Commerce on; values and costs only with See cost, else null)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/sku-images` | every pack's first photo (`{ sku: file }`): the item cell on every admin page shows it (any signed-in person) |
| GET | `/admin/inventory/options` | your godowns, all godowns, items, categories, shelves, write-off reasons (with what happens next), the e-way bill rule, rights |
| GET | `/admin/inventory/stock?kind=pack\|raw`, `/admin/inventory/stock/:sku` | stock status summed over the godowns in view (good, held, free to sell, expired, near expiry, QC hold, damaged, returned, rejected, disputed, on the road, in production, value) / one item: its lots per godown and shelf, and the last moves |
| GET | `/admin/inventory/batches?tab=expired\|near\|ok\|all` | batches with an expiry on Good and QC hold, earliest first |
| GET / POST | `/admin/inventory/transfers?tab=transit\|received`, `/admin/inventory/transfers` | transfers / dispatch one (free stock only, never expired, never packs a packer scanned; Good to On the road; e-way bill above the limit; DFT with the godown's code) |
| GET | `/admin/inventory/transfers/:id`, `/admin/inventory/free?godown=&sku=` | one transfer (lines, batches, short, loss, Found / Lost) / what can go from a godown |
| POST | `/admin/inventory/transfers/:id/receive` | counted in at the receiving godown by somebody other than the sender; a short goes to Disputed and waits (rule transit_loss; the sender and the receiver never sign it) |
| POST | `/admin/inventory/transfers/:id/found`, `/lost` | after a rejected loss: back to Good (rule restock) or a write-off; never the sender or the receiver; one decision at a time |
| GET / POST | `/admin/inventory/takes`, `/admin/inventory/takes/:id` | stock takes / one count sheet (book figure hidden while counting; scanned and packed packs listed; repeat shortage flagged) / start one (Edit: freezes that Good shelf) |
| PUT / POST | `/admin/inventory/takes/:id`, `/submit`, `/cancel` | save counts / submit (every line counted; differences to approval, posted at average cost) / cancel (Edit) |
| GET / POST | `/admin/inventory/write-offs`, `/admin/inventory/write-offs/:id` | write-offs and shelf moves, what waits on Damaged and Returned / one / write off (never from QC hold, Disputed or On the road; held packs protected; room per batch; the packs rule counts the person's day) |
| POST | `/admin/inventory/moves` | a shelf move inside a godown (Good, Damaged, Returned); Damaged or Returned back to Good waits (rule restock) |
| GET | `/admin/inventory/reorder` | below the reorder level per godown, on free stock plus what is coming; make (a run) or buy (an indent) |
| GET | `/admin/inventory/ledger?q=&shelf=&from=&sku=`, `/admin/inventory/ledger.csv` | every move, newest first (200 shown) / the CSV (Export) |

### Logo and brand images (phase 15, brand.js; rights: the Content row)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/brand` | the square logo, wide logo and favicon in use (an upload or the files of today), the favicon sizes |
| POST / DELETE | `/admin/brand/:kind` | `square`, `wide`, `favicon`: upload (PNG, JPG or WebP up to 1 MB; the favicon makes 16, 32, 180, 192 and 512) / remove (back to the files of today) |

## Site (production, or SERVE_BUILD=true) - server.js + seo.js
| Method | Path | Notes |
| GET | `/favicon.ico`, `/favicon-{16,32,180,192,512}.png`, `/manifest.json` | an uploaded favicon (Logo and brand images) when there is one; else the build's own files |
|---|---|---|
| GET | `/sitemap.xml` | every active language x home, products, each category filter, privacy, terms; hreflang alternates + x-default. `max-age=3600` |
| GET | `/robots.txt` | disallows /admin and /api/, lists the sitemap; `SEO_NOINDEX=true`: disallows everything |
| GET | `/static/*` | CRA build, `immutable` (nginx serves it from disk on the server) |
| GET | `/admin*` | the app shell with `noindex` |
| GET | any other path | index.html with the SEO head and the first-screen data for that URL (`no-cache`), or a 301 / 404 as the client router would (see 02 "SEO approach") |

