# 06 - API (base `/api/dfresh`)

All responses: `{ success: true, data }` or `{ success: false, message }`. JSON only. Parameterised SQL only.
Public endpoints never return internal columns (`spec_status`, `staff_notes`, `ip_hash`, non-public settings).

## Public (no auth, cached)
| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ db: 'ok', counts: { products, variants, languages }, version }` (no secrets) |
| GET | `/languages` | `{ languages: [{ code, nativeName, switchLabel, htmlLang, dir, fontFamily, isDefault }], default }` (active only, ordered by sort_order; `default` is the default language code) |
| GET | `/bootstrap?lang=xx` | ONE payload for the site in that language (English fallback applied): `{ lang, ui: {key: value}, settings: {public keys}, categories[], products[] (cards with variants[], images[]), banners[], kits[], towns[], formOptions: {list_key: [{value,label}]}, sizePicker[], stats: {products, categories, towns, languages}, contentVersion }` |
| GET | `/legal/:page?lang=xx` | `{ title, html, isEnglishFallback }` for `privacy` / `terms` |

Town shape: `{ key, isBase, mapX, mapY, label: { dx, dy, anchor }, lat, lng, name }` (label = where the name sits
on the illustrated map, relative to the pin).
Category shape: `{ key, sort, repProductId, name, count }` where `count` = active product cards in that category
(variants not counted). Image `width` / `height` are pixels from `product_images`, `null` when unknown.

Caching: build bootstrap once per language, keep in memory with `contentVersion`; send `ETag` and
`Cache-Control: public, max-age=60, stale-while-revalidate=600`. Any admin write increments `contentVersion`
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
| POST | `/leads` | `{ form_type, lang, source_page, source_ref, consent: true, website: '' (honeypot), ...fields }` | 201 `{ lead_ref, brochure_available?, brochure_token? }` (brochure only: `brochure_token` when a PDF exists) |
| GET | `/brochure/download?token=` | - | PDF stream (`attachment; filename="dFresh_Brochure_<LANG>.pdf"`), 400 bad token, 410 expired, 404 none uploaded. JSON `{message}`; a browser (Accept: text/html) gets a small page with `bro_expired` / `bro_pending` in the token's language |

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
| POST | `/admin/login` (email, password) -> sends code | - |
| POST | `/admin/login/verify` (code) -> sets cookie | - |
| POST | `/admin/logout` | any |
| GET | `/admin/me` | any |
| GET | `/admin/dashboard` | viewer+ |
| GET/PATCH | `/admin/leads`, `/admin/leads/:id` (status, assigned_to, staff_notes) | viewer read / editor write |
| GET | `/admin/leads/export.csv?filters` | editor+ |
| POST | `/admin/outbox/:type/:id/retry` | editor+ |
| GET/POST/PUT/DELETE | `/admin/products`, `/admin/products/:id`, `/admin/products/:id/images` (multipart) | editor+ |
| GET | `/admin/products/export.xlsx` | editor+ |
| POST | `/admin/products/import?dryRun=1` (multipart xlsx) then `?dryRun=0` | admin |
| GET/PUT | `/admin/ui-text`, `/admin/ui-text/:key/:lang` ; GET/POST `/admin/ui-text/export.csv` / `import` | editor+ |
| CRUD | `/admin/banners`, `/admin/kits`, `/admin/towns`, `/admin/categories`, `/admin/size-picker`, `/admin/form-options` | editor+ |
| CRUD | `/admin/languages` | admin |
| GET/POST/DELETE | `/admin/brochures` (multipart pdf) | editor+ |
| GET/PUT | `/admin/settings` | admin |
| CRUD | `/admin/users` | admin |
| GET | `/admin/audit` | admin |

Upload limits: images 8 MB in (converted to WebP), PDF 5 MB. Check magic bytes, never trust the extension.
File names are generated by the server (`<product_id>_<pos>.webp`), never taken from the upload.
