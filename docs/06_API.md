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
| POST | `/admin/login` (email, password) -> e-mails a 6-digit code, sets the challenge cookie | - |
| POST | `/admin/login/verify` (code) -> sets the session cookie | - |
| POST | `/admin/login/resend` (challenge cookie) -> a new code (old one stops working); 30 s apart, max 3 per 15 min; 401 with `data.restart` when the sign-in must start again | - |
| POST | `/admin/logout` | any |
| GET | `/admin/me` | any |
| GET | `/admin/dashboard` | viewer+ |
| GET/PATCH | `/admin/leads?form&status&lang&from&to&q&ref&page`, `/admin/leads/:id` (status, assigned_to, staff_notes) | viewer read / editor write |
| GET | `/admin/assignees` (active admin users with names, for "assign") | viewer+ |
| GET | `/admin/leads/export.csv?filters` | editor+ |
| POST | `/admin/outbox/:type/:id/retry` | editor+ |
| GET/POST/PUT/DELETE | `/admin/products`, `/admin/products/:id` | viewer read / editor write |
| POST / DELETE / PUT | `/admin/products/:id/images` (multipart `file` + `position` 1-3), `/admin/products/:id/images/:position`, `/admin/products/:id/images/order` (`{order:[3,1,2]}`) | editor+ |
| GET | `/admin/products/export.xlsx` | editor+ |
| POST | `/admin/products/import?dryRun=1` (multipart xlsx) then `?dryRun=0` | admin |
| GET/PUT | `/admin/ui-text`, `/admin/ui-text/:key/:lang` (`{value}`; empty = delete, falls back) | viewer read / editor write |
| GET / POST | `/admin/ui-text/export.csv`, `/admin/ui-text/import?dryRun=1` then `?dryRun=0` (multipart csv) | editor+ |
| CRUD | `/admin/banners`, `/admin/kits`, `/admin/towns`, `/admin/categories`, `/admin/size-picker`, `/admin/form-options` (+ `POST /admin/<section>/reorder {order:[ids]}`; composite ids joined with `~`) | viewer read / editor write |
| POST | `/admin/banners/:id/image?kind=desktop\|mobile` (multipart; cropped to 1920x800 / 1080x1350 WebP) | editor+ |
| CRUD | `/admin/languages` (GET includes completeness % per language) | viewer read / admin write |
| GET/POST/DELETE | `/admin/brochures`, `/admin/brochures/:lang` (multipart pdf), `GET /admin/brochures/:lang/file` | viewer read / editor write |
| GET / PUT | `/admin/settings`, `/admin/settings/:key` (`{value}`; is_public is not editable) | admin |
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

## Site (production, or SERVE_BUILD=true) - server.js + seo.js
| Method | Path | Notes |
|---|---|---|
| GET | `/sitemap.xml` | every active language x home, products, each category filter, privacy, terms; hreflang alternates + x-default. `max-age=3600` |
| GET | `/robots.txt` | disallows /admin and /api/, lists the sitemap; `SEO_NOINDEX=true`: disallows everything |
| GET | `/static/*` | CRA build, `immutable` (nginx serves it from disk on the server) |
| GET | `/admin*` | the app shell with `noindex` |
| GET | any other path | index.html with the SEO head and the first-screen data for that URL (`no-cache`), or a 301 / 404 as the client router would (see 02 "SEO approach") |

