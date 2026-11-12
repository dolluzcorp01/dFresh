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

### Sales: leads, customers, quotes and orders (phase 19, sales.js + sales-routes.js + customers.js + commerce.js; rights: the "Leads and customers" and "Quotes and orders" rows, Commerce on; a role with "Own customers only" sees its own customers and enquiries and new enquiries nobody has picked up)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/sales/options` | the form lists: customers and open enquiries you see, packs (with photo) and kits on sale, your godowns, the order switches, the reasons, rights |
| GET / POST | `/admin/sales/follow-ups`, `/admin/sales/calls` | today and overdue, coming up, samples, call log / Log a call on an enquiry or a customer (how, what was said, next call, a sample; the first call is the enquiry's first reply) |
| GET / POST | `/admin/sales/calls?lead=\|customer=`, `/admin/sales/samples/:id/:step`, `/admin/sales/leads/:id/close` | calls of one / sample sent, ordered or no / enquiry lost (a reason) or spam |
| GET | `/admin/sales/credit` | credit limits: limit, days, owes, used, overdue, a raise waiting, what an order today would do (raise and lower through PUT `/admin/commerce/customers/:id/credit`) |
| GET / POST / PUT | `/admin/sales/customer-types`, `/:key` | customer types and their price list; another list than the standard one is Accounts or an Admin and waits (rule cust_change) |
| PUT | `/admin/commerce/customers/:id/status` | active / hold / blocked with a reason: tighten at once; easing is Accounts or an Admin and waits (rule cust_change) |
| GET / POST / PUT | `/admin/sales/quotes`, `/admin/sales/quotes/:no`, `/admin/sales/quotes/preview` | quotes / one (lines with photo, totals, revisions, checks) / save (draft, or send: the checks it needs first) / the form as typed (the prices the save will use) |
| POST | `/admin/sales/quotes/:no/lost`, `/admin/sales/quotes/:no/order` | lost with a reason / Make order: a draft order at the quoted prices (an enquiry: make the customer first) |
| GET / POST / PUT | `/admin/sales/standing`, `/admin/sales/standing/:id`, `/admin/sales/standing/run` | standing orders / save one / make today's orders (draft or confirmed: switch) |
| GET / POST | `/admin/sales/back-orders`, `/hold`, `/drop` | what confirmed orders owe, oldest first / hold what is free now / drop what is owed (prices kept, wallet kept for it freed) |
| POST | `/admin/commerce/orders` (`draft`), PUT `/admin/commerce/orders/:no` (`confirm`), POST `/admin/commerce/orders/:no/hold-again` | an order saved as a draft / confirmed (asks or holds; short lines become back-orders) / held again after the hold time ended |

| POST | `/admin/sales/quotes/:no/mail`, `/admin/sales/customers/:id/mail-statement` | phase 20: the quotation / statement of account as a PDF, prepared in the Outbox (message templates quote_sent, statement in EN, TA, HI) |
| GET / POST | `/admin/sales/leads/:id/matches`, `/admin/sales/leads/:id/link` | phase 20: customers with the enquiry's phone or e-mail (that you see) / link the enquiry to one: Won, its calls, follow-ups and quotes move (refused when the enquiry is already a customer) |

### Packing and delivery (phase 20, fulfil.js + fulfil-routes.js + delivery.js; rights: the "Packing" and "Delivery" rows, Commerce on)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/fulfil/to-pick` | confirmed orders with packs held (first item with photo, packs held) and the pick lists; can create / edit / approve |
| POST / GET / PUT | `/admin/fulfil/pick-lists`, `/:id`, `/:id/packer` | a pick list (DFK/yy-yy/nnnn, one godown, Create on Packing): the batches are fixed oldest first and the orders are Packing / what to take, the orders, the packers offered / give it to a packer |
| GET | `/admin/fulfil/packing`, `/admin/fulfil/packing/:no`, `/admin/fulfil/packed` | being packed (progress) / one order: lines per batch with photo, the batches it can pack from (free after other packers' scans), the scans, what was packed, the balance order / packed, waiting (hours) |
| POST | `/admin/commerce/packing/:no/scan` `{ code, n, batch }`, `/undo` `{ scan_id }`, `/reset` | a scan (n of the label; batch = the row's batch when the label has none; another good batch counts as "not the picked batch") / one scan off / every scan off |
| POST | `/admin/commerce/packing/:no/packed` `{ cartons, weight_kg, short: { sku: notfound \| damaged \| expired } }` | Packing done: the scanned packs leave Good (exact batches); short or not the picked batch needs Approve on Packing; a batch expired or taken since the scan is refused; the rest goes to a balance order `<no>-2` (own invoice and stop) |
| GET / POST / DELETE | `/admin/commerce/delivery`, `/admin/commerce/trips`, `/admin/commerce/trips/:id`, `/:id/load`, DELETE `/:id` | the office list (load, cash due per trip) / a trip (one godown, within the vehicle's kg and boxes) / one (load, what is on board per stop) / load one more / delete a planned trip |
| POST | `/admin/commerce/trips/:id/start`, `/:id/end` `{ cash_handed, note }` | start (papers checked: insurance, fitness, licence; the invoices are made) / close: the office, never the trip's own driver; a difference needs a note and is flagged |
| POST | `/admin/commerce/stops/:id/delivered` `{ receiver_name, signed, otp, kept, short_reason }` (+ photo), `/refused` `{ reason }`, `/failed`, `/cash` `{ amount, why }` | delivered (a signed slip or a photo is required) or short (kept per pack: the rest to the Returned shelf with a credit note) / refused (all back, order Refused) / not delivered / cash (less than due needs a why) |
| POST | `/admin/commerce/orders/:no/courier`, `/courier-delivered`, `/courier-back`, `/picked-up` `{ receiver_name, phone, cash, signed }` | courier booked / delivered / came back (all to the Returned shelf, credit note, Refused) / collected at the godown (a phone not among the contacts is noted) |
| GET | `/admin/fulfil/pod`, `/admin/fulfil/failed`, `/admin/fulfil/cod` | proof of delivery (signed, photo) / failed, short, refused with the return and credit note / cash on delivery per trip |
| GET / POST / PUT | `/admin/fulfil/vehicles`, `/admin/fulfil/drivers/:id`, `/admin/fulfil/couriers`, `/admin/fulfil/areas` | vehicles (godown, kg, boxes, insurance, fitness, problems, Soon) and drivers (licence) / couriers (phone, per kg, minimum) / delivery areas (PIN codes unique, godown, days, charge, show on the website map); saving needs Create on Delivery |

### Invoicing, GST and payments (phase 21, billing.js + money.js + money-routes.js; rights: the new "Invoicing and GST" row and the "Payments" row, Commerce on; a role with "Own customers only" sees and collects from its own customers only; refunds, write-offs and waivers are for the office)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/billing/invoices` | To invoice (packed shipments with no invoice, first item with photo), Unpaid, Paid, Cancelled (state, papers missing, EWB / IRN), the company facts still missing, the e-way and e-invoice rules |
| GET / POST | `/admin/billing/to-invoice/:no?date=`, `/admin/billing/invoices` `{ order_no, date, note, ewb_no, ewb_valid, irn, ack_no }` | the invoice a packed order would get on that date (GST of that date, number, needs) / make it (one per shipment, month lock, papers checked, on account used) |
| GET | `/admin/billing/invoices/:no`, `/admin/billing/invoice-print/:no` | one invoice (lines, notes, papers, cancel waiting, why it cannot be cancelled) / the snapshot the print and PDF use |
| POST | `/admin/billing/invoices/:no/papers`, `/:no/cancel` `{ reason }`, `/:no/mail` | add the e-way bill / IRN; ask to cancel (Cancel right; approval cancel_invoice; refused when paid or credited, a debit note, a credit note waiting, the goods left; an exported month asks after_export) / mail with the PDF through the outbox |
| GET / POST | `/admin/billing/credit-notes`, `/admin/billing/credit-room/:no` | tabs To credit, Waiting, Made, Rejected / the room left on an invoice (returns still open hold theirs) and its GST rate; POST `{ invoice_no, why, amount, note }` a price correction (approval credit_no_return) |
| GET / POST | `/admin/billing/debit-notes` `{ invoice_no, why, amount, note }`, `/admin/billing/notes/:no` | sales debit notes DFS (invoice rate, due by the customer's days; refused on a cancelled invoice or one whose cancel waits) / the print of a credit or debit note |
| GET / POST | `/admin/billing/challans` `{ godown_id, why, to_name, to_address, lines }`, `/:no` | delivery challans DFT (with the transfers of the same series) / goods leave Good with no sale / the print |
| GET | `/admin/gst/month?month=`, `/admin/gst/month.csv` (Export right), `/admin/gst/papers` | GSTR-3B (output = invoices - credit notes + debit notes, input = the month's supplier bills plus the ITC on expenses, split in `gstr3b.input.parts.bills` / `.expenses`, with `itc_expenses` = each recorded expense with claimable GST; the CSV adds "3B input ITC on expense" rows and their total, phase 23; to pay) and the GSTR-1 registers / the CSV for the CA / e-way bill and e-invoice lists |
| GET / POST | `/admin/money/receipts`, `/admin/money/receipt-form?customer_id=`, `/admin/money/receipts` `{ customer_id, amount, received_on, mode, reference, cheque_no, cheque_bank, cheque_date, to }` | to collect (ageing, overdue, last reminder, 30 days late), receipts, credit balances / the open items of a customer / a receipt (D2: oldest first or the invoice named; the rest on account; month lock) |
| GET / POST | `/admin/money/receipts/:no`, `/admin/money/customers/:id/remind`, `/:id/write-off` | a receipt and its print / the overdue reminder now (outbox) / ask to write off the dues more than 30 days late (approval bad_debt; the customer is blocked) |
| GET / POST | `/admin/money/refunds`, `/admin/money/refund-form/:id`, `/admin/money/refunds` `{ customer_id, amount, mode, reference, why }` | refunds (credit balance and returns) / what can be refunded now / a refund of a credit balance DFRF (approval refund above the rule) |
| GET / POST | `/admin/money/cheques`, `/:id/deposit`, `/:id/clear`, `/:id/bounce` `{ why, charge }`, `/:id/waive` | the cheque register (a post-dated cheque waits for its date) / bounced: the receipt reversed, the bank charge added, the customer on hold; a lower charge or a waiver waits for approval waive_bounce |
| POST | `/admin/commerce/orders` + `{ delivery_charge, delivery_charge_why, advance, advance_mode, advance_ref }` | a typed delivery charge stays (at most delivery_charge_max, a reason when it differs from the area's); an advance is a receipt on account until the order's invoice |

### Returns, promotions and wallet (phase 22, returns.js + returns-routes.js + promotions.js; rights: the Returns and Promotions rows, Inventory edit to inspect, Commerce on; lists follow the godowns a person works at)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/sales/returns?tab=waiting\|to_collect\|to_inspect\|deciding\|closed` | Return requests: counts per tab, rows with the first pack's photo, the approvals each waits for; "Own customers only" sees its own customers' returns |
| GET | `/admin/sales/returns/orders` | delivered orders a new return can be made on (days since delivery) |
| GET | `/admin/sales/returns/inspection` | the Returned shelf per SKU and godown (photo), returns to inspect (also a resell that was not signed), inspected ones whose money decision waits, "back to Good" approvals waiting |
| POST | `/admin/commerce/orders/:no/returns` | as before; the same pack and batch on two lines counts together against what can still come back (a waiting return already holds its packs: v23 X9) |
| POST | `/admin/commerce/returns/:no/inspect` `{ lines: [{ line_id, resell, repack, damaged, scrap, expired, missing }], note }` | resell = Returned shelf, then "Returned stock back to Good" (approval restock; refused when Commerce setting returned_resell is off); repack and damaged = Damaged shelf; scrap = a write-off from the Returned shelf under the write-off rule ("ok" is still read as resell) -> `{ waiting, message }` |
| POST | `/admin/commerce/returns/:no/reinspect` `{ lines: [{ line_id, resell, repack, damaged, scrap }] }` | the resell packs whose "back to Good" was rejected, inspected again (v23 12.8) |
| GET | `/admin/commerce/promotions` | offers, coupons and cashback rules with `status` (draft, waiting, live, rejected, ended), `shown` (adds "scheduled" by dates), the approvals each waits for (cost masked "(hidden)" without See cost), offers' named customers, budget, given, free packs, with_coupon |
| POST / PUT | `/admin/commerce/offers`, `/admin/commerce/coupons`, `/admin/commerce/cashback-rules` (+ `/:id`) | a new one is sent for approval at once unless `draft: true` (promo_new; an offer or % coupon below cost also promo_below_cost; a rule cashback_rule); a live one changed to give more is signed again; `send: true` sends a draft; refused while waiting |
| POST | `/admin/commerce/{offers\|coupons\|cashback-rules}/:id/send`, `/:id/stop` | send a draft for approval / stop (ended; orders already made keep it) |
| POST | `/admin/commerce/orders` + `{ no_offers }` | "No offers on this order"; the wallet pays only for lines with no offer (at most the setting % of those lines) |
| GET | `/admin/marketing/wallets` | per customer: usable, pending (cashback still in the return window, at today's rule), running out in 30 days, kept for open orders; totals; `can.manual` |

### Alerts, reports, expenses and the accounting export (phase 23, alerts.js + reports23.js + expenses.js + tally.js + expenses-routes.js; rights: Reports, the new "Expenses and accounting export" row, and Returns "Inspect returns"; every list follows the person's godowns)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/alerts` | the person's alerts, worked out live (low stock, near expiry, packs with no cost, overdue, cheques to deposit, vehicle papers, supplier bills due, returns to inspect, approvals waiting and old ones, holds ending, repeating expenses due, petty cash) plus the Admins' stored events (override, someone left, leave for an Admin, a rule loosened); read and snoozed flags |
| POST | `/admin/alerts/mark` `{ key, read, snooze }`, `/admin/alerts/read-all` | mark read (Open does) or snooze until tomorrow, for this person only; read-all is the bell menu "Mark all alerts read" |
| GET / PUT | `/admin/alerts/settings` `{ role_id, off: [types] }` | Admins only: which alert types a role gets (no row = on); shown on Admin > Notifications (Events) |
| GET | `/admin/nav-counts` | adds `alerts` (unread, the bell; worked out at most every 30 s per person) |
| GET | `/admin/dashboard/home` | the v23 tiles (each with the page it opens), top 5 products this month, the newest alerts; cost tiles only with See cost |
| GET | `/admin/reports23/:page?tab=&per=&from=&to=&godown=` | `page` = sales, stock, money, gst; the stats, tabs, chart (bars, top 10) and table; gst also gives `input_expense` (claimable expense GST per month, row order) and `hint`; cost cells null for a person without See cost (shown "hidden"); godown outside the person's godowns: 403 |
| GET | `/admin/reports23/:page/export.csv` | the page's table as CSV (Export right on Reports); `/admin/commerce/reports/:key/export.xlsx` now needs the Export right too |
| GET | `/admin/money/expenses?tab=recorded\|waiting\|drafts\|closed`, `/admin/money/expense-form`, `/admin/money/expenses/:no` | the list with the month's figures and repeating expenses due / the form's payees, godowns with their free petty cash, POs for freight in, the money rule / one expense with its approvals |
| POST | `/admin/money/expenses` (multipart, `file` = bill photo) `{ date, godown_id, head_key, po_no, payee, new_payee, pan, gstin, amount, gst_rate, mode, reference, note }` | records it, or waits for "Expense above the limit" and "A new payee (approved once)"; a look-alike payee or a known PAN under another name is refused; a date in an exported or closed month is refused |
| POST | `/admin/money/expenses/:no/save`, `/:no/cancel` `{ reason }`, `/admin/money/expenses-drafts` | save a draft or sent-back expense again / cancel (Cancel right; an exported month asks "Change after export" first) / make the drafts of the repeating expenses that are due |
| GET / POST | `/admin/money/expense-repeats`, `/admin/money/expenses/:no/photo` | repeating expenses / the bill photo |
| GET / POST | `/admin/money/petty`, `/admin/money/petty/:godown/float` `{ float }` (Edit), `/topup` `{ amount }`, `/count` `{ counted }` | boxes per godown with their moves / the float (first time: the opening float) / a top-up (approval "Petty cash top-up") / the count against the book (a difference above Rs 100 is an alert) |
| GET | `/admin/money/accounting?month=` | the month's vouchers (journal + purchases, supplier payments, expenses, petty cash top-ups), the checks (running month, requests or expenses waiting, balance), the ledger names |
| POST | `/admin/money/accounting/:month/export` (Export right) | Tally XML and voucher CSV kept in the history, the month locked; again: only new, changed (Alter) or gone (Delete) vouchers |
| GET / PUT | `/admin/money/accounting/:month/xml`, `/csv`, `/admin/money/accounting/ledgers` | download a month's files again / the CA's ledger names (an empty one is refused) |
| GET | `/admin/money/accounting-history` | every export with who, when, files and totals; the changes allowed after export |
| GET | `/admin/marketing/wallets.csv` (Export on Promotions) | the customer wallets as CSV; `/admin/marketing/wallets` says `wallet_on` (Admin > Switches > Money "Customer wallet and cashback on") |
| PUT | `/admin/commerce-settings/credit_sales` | Admin > Switches > Money "Credit sales allowed" (v23; on as delivered). Off: `/admin/commerce/order-form` offers no "On credit" and a new order on credit is refused (400); an order already on credit keeps its terms. Turning it on waits for a second Admin (it loosens a control) |
| POST | `/admin/commerce/returns/:no/inspect`, `/reinspect` | now need Returns "Inspect returns" (Operations has it; Warehouse receives and scans only) |
| POST | `/admin/commerce/orders/:no/cancel` (after dispatch, once approved) | the invoice is cancelled with a credit note and the packs that left come back as a return (reason "Order cancelled after dispatch", status collecting, migration 23_05) instead of straight to the Good shelf; after receive + inspect it closes with no refund |
| POST | `/admin/commerce/trips/:id/start`, `/admin/commerce/orders/:no/courier`, `/admin/commerce/orders/:no/picked-up` | an order with no invoice: 409 "Not ready to leave. Make the invoice for DFO-... first" unless the switch `invoice_at_gate` (Delivery, off as delivered; on is a loosening) is on, which makes it at the gate as before (migration 23_06) |
| POST | `/admin/commerce/trips/:id/end` | cash short (handed in below recorded, plus stops that collected below what was due, `trip_stops.cash_due`) under the rule `cash_short` (on, above Rs 0): `{ status: 'cashwait', short, less, approval_id, message }`; approved -> ended, rejected -> back to `out`. `/admin/fulfil/cod` lists `cashwait` trips too |

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

