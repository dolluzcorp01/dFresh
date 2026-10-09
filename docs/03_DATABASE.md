# 03 - Database (`dfresh`, MySQL 8)

Files: `database/01_schema.sql` (structure) and `database/02_seed.sql` (data).
Both were run and checked on a real MariaDB 10.11 before handover; they are MySQL 8 compatible.

## The translation model (why it scales to any number of languages)
Every customer-facing entity has a base table (lang-neutral data) and a `*_translations` table
with primary key `(entity_key, lang_code)`. Read with English fallback:

```sql
SELECT p.product_id,
       COALESCE(t.name, e.name) AS name
FROM products p
JOIN product_translations e ON e.product_id = p.product_id AND e.lang_code = 'en'      -- always exists
LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = ?    -- may be missing
WHERE p.is_active = 1 AND p.variant_of IS NULL
ORDER BY p.sort_order;
```
Put this pattern in ONE helper (`src/backend_routes/i18n-sql.js`) and reuse it. Never duplicate it per route.

## Tables
| Table | Purpose | Key facts |
|---|---|---|
| `languages` | Active languages | `lang_code` = URL prefix; `html_lang` for `<html lang>`/hreflang; `dir` (ltr/rtl); `font_family`; exactly one `is_default` |
| `ui_text_keys` | Registry of every page/UI text key | `group_name` for the admin grid; `allows_html` (0 = plain text) |
| `ui_text` | Value of each key per language | PK `(text_key, lang_code)`; 154 keys: EN 154, TA 152, HI 152 (the two legal bodies are English-only and fall back) |
| `categories` / `category_translations` | 6 categories | `rep_product_id` = photo on the range ring |
| `products` | 25 cards + 3 colour variants | `variant_of` NULL = card; set = colour of that card. `sort_order` DECIMAL (5.1, 5.2 ...). `swatch_hex` on parent and variants. `show_for_home` drives the "For Home" chip. `spec_status` is INTERNAL |
| `product_translations` | Name, one-liner, keywords, description, best for, colour name, optional spec/pack override, alt text, WhatsApp message | alt + WhatsApp only in English today -> fallback |
| `product_images` | 3 photos per product incl. variants (84 rows) | `file_name` under `/media/products/` |
| `size_picker` | "Pick a size" napkin widget | 5 sizes, 30x30 is default |
| `banners` / `banner_translations` | 11 "dFresh moods" slides | text-free images; headline + CTA translated; `cta_action` + `cta_target`; funky/neon/rainbow seeded **inactive** pending Director approval |
| `kits` / `kit_translations` / `kit_products` | 4 business kits | `business_type` prefills the quote form |
| `towns` / `town_translations` | 6 delivery towns | `is_base` = Kanchipuram; `map_x/map_y` for the illustrated map; lat/lng for later real maps |
| `form_options` / `form_option_translations` | Drop-downs (business type, monthly sales, yes/no) | leads store the English `option_value` |
| `site_settings` | Phones, e-mails, company, CIN, GSTIN, addresses, GA4 id, sheet id | `is_public = 1` rows only go to the browser |
| `brochures` | One PDF per language | file in `private/brochures/`; English fallback |
| `leads` + `lead_products` | Every form submission | one table, `form_type` enum; distributor extras in `details_json`; status workflow; `staff_notes`, `ip_hash` INTERNAL |
| `mail_outbox` | E-mails waiting to be sent | worker retries with back-off; never lose a lead e-mail |
| `sync_outbox` | Google Sheet rows waiting | same retry model |
| `admin_users` | Who may use the admin + role | `emp_id` VARCHAR(20); seeded DZIND002 + DZIND148 as admin |
| `audit_log` | Every admin change | before/after JSON |

## Lead reference
`lead_ref` = `DFL-` + 2-digit year + 4-digit running number per year, e.g. `DFL-260001`. Generate inside a
transaction (`SELECT ... FOR UPDATE` on a counter row or `MAX()` within the year) so two requests never clash.

## Seed numbers (verified)
25 product cards + 3 variants, 84 translations rows, 84 images, 6 categories (7/6/2/5/4/1), 5 featured
(DF007, DF017, DF028, DF037, DF044), 10 "For Home" products, 11 banners (8 active), 4 kits, 6 towns,
13 form options, 154 UI keys (EN 154 rows, TA 152, HI 152 - only `legal_privacy_body` and `legal_terms_body` fall back to English; `lg_en` is intentionally empty in English), 2 admin users.

## Rules
- Never edit `02_seed.sql` by hand after Phase 0. Content changes go through the admin or the Excel import.
- Every schema change = `database/migrations/YYYYMMDD_short_name.sql` + update this file.
- `01_schema.sql` is for a fresh database only (it adds one FK with ALTER at the end).
- The dAdmin database (`dadmin`) is read-only from dFresh except `login_otp` rows for app_key `dFresh`.
