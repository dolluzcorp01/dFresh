-- =====================================================================
-- dFresh website - database schema (MySQL 8)
-- Dolluz Corporation (OPC) Pvt Ltd
--
-- Design rules (read docs/03_DATABASE.md before changing anything):
--  1. Every customer-facing text lives in a *_translations table keyed by
--     lang_code. Adding a language = INSERT into `languages` + translation
--     rows. No column is ever named name_en / name_ta.
--  2. English (is_default = 1) is the fallback for any missing translation.
--  3. Lang-neutral data (IDs, sizes, sort order, files) stays on the base table.
--  4. emp_id is VARCHAR(20) (e.g. DZIND148). Never cast it to a number.
--  5. Internal-only columns (spec_status, notes, ip_hash) are NEVER returned
--     by public API endpoints.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS dfresh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dfresh;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- LANGUAGES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS languages (
  lang_code     VARCHAR(10)  NOT NULL,              -- 'en', 'ta', 'hi' (also the URL prefix /en /ta /hi)
  name_en       VARCHAR(50)  NOT NULL,              -- 'Tamil'
  native_name   VARCHAR(50)  NOT NULL,              -- 'தமிழ்'
  switch_label  VARCHAR(20)  NOT NULL,              -- label on the header switcher: 'EN', 'தமிழ்', 'हिंदी'
  html_lang     VARCHAR(20)  NOT NULL,              -- <html lang> and hreflang: 'en-IN', 'ta-IN', 'hi-IN'
  dir           ENUM('ltr','rtl') NOT NULL DEFAULT 'ltr',  -- 'rtl' ready for Arabic later
  font_family   VARCHAR(120) NULL,                  -- Google Font for this script, e.g. 'Noto Sans Tamil'
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,    -- exactly one row = 1 (English)
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,    -- 0 = being translated, hidden from the site
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (lang_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- UI / PAGE TEXT (buttons, headings, form labels, errors ...)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ui_text_keys (
  text_key      VARCHAR(80)  NOT NULL,
  group_name    VARCHAR(40)  NOT NULL,              -- 'nav', 'home', 'forms', 'errors' ... (admin grouping)
  description   VARCHAR(255) NULL,                  -- where it appears, for translators
  allows_html   TINYINT(1)   NOT NULL DEFAULT 0,    -- 0 = render as plain text only
  PRIMARY KEY (text_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ui_text (
  text_key      VARCHAR(80)  NOT NULL,
  lang_code     VARCHAR(10)  NOT NULL,
  value         TEXT         NOT NULL,
  updated_by    VARCHAR(20)  NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (text_key, lang_code),
  CONSTRAINT fk_ui_text_key  FOREIGN KEY (text_key)  REFERENCES ui_text_keys(text_key) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ui_text_lang FOREIGN KEY (lang_code) REFERENCES languages(lang_code)   ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- CATEGORIES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  category_key    VARCHAR(30)  NOT NULL,            -- 'napkins', 'rolls', 'kitchen', 'facial', 'towels', 'wipes'
  sort_order      INT          NOT NULL DEFAULT 0,
  rep_product_id  VARCHAR(30)  NULL,                -- product whose photo represents the category (range ring)
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS category_translations (
  category_key  VARCHAR(30)  NOT NULL,
  lang_code     VARCHAR(10)  NOT NULL,
  name          VARCHAR(100) NOT NULL,
  PRIMARY KEY (category_key, lang_code),
  CONSTRAINT fk_cat_tr_cat  FOREIGN KEY (category_key) REFERENCES categories(category_key) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cat_tr_lang FOREIGN KEY (lang_code)    REFERENCES languages(lang_code)     ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- PRODUCTS (+ colour variants as child rows)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  product_id      VARCHAR(30)   NOT NULL,           -- 'DZIND-DF007', variants 'DZIND-DF008-BLK'
  category_key    VARCHAR(30)   NOT NULL,
  variant_of      VARCHAR(30)   NULL,               -- NULL = a product card; set = colour of that product (not its own card)
  sort_order      DECIMAL(6,2)  NOT NULL DEFAULT 0, -- 5.1, 5.2 keep variants next to their parent
  is_featured     TINYINT(1)    NOT NULL DEFAULT 0, -- Home "Most loved" rail
  featured_order  INT           NULL,
  show_for_home   TINYINT(1)    NOT NULL DEFAULT 0, -- "For Home" filter chip
  swatch_hex      CHAR(7)       NULL,               -- colour dot; set on the parent too ('#FFFFFF' = White)
  specification   VARCHAR(255)  NOT NULL,           -- 'ply · GSM · size · count' (lang-neutral fallback)
  pack            VARCHAR(120)  NOT NULL,
  spec_status     VARCHAR(255)  NULL,               -- INTERNAL ONLY. Never in a public API response.
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by      VARCHAR(20)   NULL,
  PRIMARY KEY (product_id),
  KEY idx_products_cat (category_key, sort_order),
  KEY idx_products_variant (variant_of),
  CONSTRAINT fk_prod_cat     FOREIGN KEY (category_key) REFERENCES categories(category_key) ON UPDATE CASCADE,
  CONSTRAINT fk_prod_variant FOREIGN KEY (variant_of)   REFERENCES products(product_id)     ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_translations (
  product_id       VARCHAR(30)  NOT NULL,
  lang_code        VARCHAR(10)  NOT NULL,
  name             VARCHAR(150) NOT NULL,
  one_liner        VARCHAR(255) NOT NULL,
  keywords         VARCHAR(255) NOT NULL,           -- comma separated -> chips (first 3 shown on the card)
  description      TEXT         NOT NULL,
  best_for         VARCHAR(255) NOT NULL,
  colour_name      VARCHAR(50)  NULL,               -- 'White', 'Black' ... (swatch label)
  specification    VARCHAR(255) NULL,               -- optional translated override of products.specification
  pack             VARCHAR(120) NULL,               -- optional translated override of products.pack
  alt_text         VARCHAR(255) NULL,               -- image alt text (falls back to English)
  whatsapp_message VARCHAR(500) NULL,               -- prefilled WhatsApp text (falls back to English)
  updated_by       VARCHAR(20)  NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, lang_code),
  CONSTRAINT fk_prod_tr_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_prod_tr_lang FOREIGN KEY (lang_code)  REFERENCES languages(lang_code) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_images (
  image_id     INT          NOT NULL AUTO_INCREMENT,
  product_id   VARCHAR(30)  NOT NULL,
  position     TINYINT      NOT NULL,               -- 1, 2, 3 (carousel order)
  file_name    VARCHAR(150) NOT NULL,               -- 'DZIND-DF007_1.webp' (served from /media/products/)
  width        INT          NULL,
  height       INT          NULL,
  PRIMARY KEY (image_id),
  UNIQUE KEY uq_prod_img (product_id, position),
  CONSTRAINT fk_img_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Pick a size" napkin widget on Home (Try it section)
CREATE TABLE IF NOT EXISTS size_picker (
  position     TINYINT      NOT NULL,
  product_id   VARCHAR(30)  NOT NULL,
  size_label   VARCHAR(20)  NOT NULL,               -- '30×30'
  scale        DECIMAL(4,2) NOT NULL,               -- drawing scale 0-1
  is_default   TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (position),
  CONSTRAINT fk_size_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- BANNERS ("dFresh moods" slider)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banners (
  banner_key    VARCHAR(40)  NOT NULL,              -- 'home', 'forhome', 'colours' ...
  sort_order    INT          NOT NULL DEFAULT 0,
  theme         ENUM('light','dark') NOT NULL DEFAULT 'light',  -- dark = gold button on dark photo
  cta_action    ENUM('products','products_home','products_category','section','form') NOT NULL DEFAULT 'products',
  cta_target    VARCHAR(60)  NULL,                  -- category key, section id or form type
  desktop_file  VARCHAR(150) NOT NULL,              -- 1920x800 webp, text-free
  mobile_file   VARCHAR(150) NOT NULL,              -- 1080x1350 webp, text-free
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  note          VARCHAR(255) NULL,                  -- internal (e.g. 'needs Director approval')
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(20)  NULL,
  PRIMARY KEY (banner_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS banner_translations (
  banner_key    VARCHAR(40)  NOT NULL,
  lang_code     VARCHAR(10)  NOT NULL,
  headline      VARCHAR(200) NOT NULL,              -- HTML text over the image (never baked in)
  cta_label     VARCHAR(80)  NOT NULL,
  PRIMARY KEY (banner_key, lang_code),
  CONSTRAINT fk_ban_tr_ban  FOREIGN KEY (banner_key) REFERENCES banners(banner_key)  ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ban_tr_lang FOREIGN KEY (lang_code)  REFERENCES languages(lang_code) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- BUSINESS KITS (For Business section)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kits (
  kit_key         VARCHAR(40)  NOT NULL,            -- 'hotels', 'restaurants', 'offices', 'hospitals'
  sort_order      INT          NOT NULL DEFAULT 0,
  business_type   VARCHAR(40)  NOT NULL,            -- prefills the quote form (form_options 'business_type')
  rep_product_id  VARCHAR(30)  NULL,                -- photo on the card
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (kit_key),
  CONSTRAINT fk_kit_rep FOREIGN KEY (rep_product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kit_translations (
  kit_key    VARCHAR(40)  NOT NULL,
  lang_code  VARCHAR(10)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  tagline    VARCHAR(255) NOT NULL,
  PRIMARY KEY (kit_key, lang_code),
  CONSTRAINT fk_kit_tr_kit  FOREIGN KEY (kit_key)   REFERENCES kits(kit_key)        ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_kit_tr_lang FOREIGN KEY (lang_code) REFERENCES languages(lang_code) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kit_products (
  kit_key     VARCHAR(40) NOT NULL,
  product_id  VARCHAR(30) NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (kit_key, product_id),
  CONSTRAINT fk_kitp_kit  FOREIGN KEY (kit_key)    REFERENCES kits(kit_key)       ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_kitp_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- TOWNS (Where we deliver map + Where to buy)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS towns (
  town_key    VARCHAR(40)   NOT NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  is_base     TINYINT(1)    NOT NULL DEFAULT 0,     -- Kanchipuram godown = 1
  map_x       SMALLINT      NULL,                   -- position on the illustrated 600x360 map
  map_y       SMALLINT      NULL,
  lat         DECIMAL(9,6)  NULL,
  lng         DECIMAL(9,6)  NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (town_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS town_translations (
  town_key   VARCHAR(40)  NOT NULL,
  lang_code  VARCHAR(10)  NOT NULL,
  name       VARCHAR(80)  NOT NULL,
  PRIMARY KEY (town_key, lang_code),
  CONSTRAINT fk_town_tr_town FOREIGN KEY (town_key)  REFERENCES towns(town_key)      ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_town_tr_lang FOREIGN KEY (lang_code) REFERENCES languages(lang_code) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- FORM DROP-DOWN OPTIONS (business type, monthly sales, yes/no)
-- Stored value is the English option_value; the label is translated.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_options (
  list_key      VARCHAR(40)  NOT NULL,              -- 'business_type', 'monthly_sales', 'yes_no'
  option_value  VARCHAR(80)  NOT NULL,              -- stored in leads: 'hotel', 'under_50k', 'yes'
  sort_order    INT          NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (list_key, option_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS form_option_translations (
  list_key      VARCHAR(40)  NOT NULL,
  option_value  VARCHAR(80)  NOT NULL,
  lang_code     VARCHAR(10)  NOT NULL,
  label         VARCHAR(120) NOT NULL,
  PRIMARY KEY (list_key, option_value, lang_code),
  CONSTRAINT fk_fo_tr_opt  FOREIGN KEY (list_key, option_value) REFERENCES form_options(list_key, option_value) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_fo_tr_lang FOREIGN KEY (lang_code) REFERENCES languages(lang_code) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- SITE SETTINGS (phones, e-mails, company details, GA4 id ...)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_settings (
  setting_key    VARCHAR(60)   NOT NULL,
  setting_value  TEXT          NULL,
  is_public      TINYINT(1)    NOT NULL DEFAULT 0,  -- 1 = returned by GET /api/dfresh/site (never secrets)
  description    VARCHAR(255)  NULL,
  updated_by     VARCHAR(20)   NULL,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- BROCHURES (one PDF per language; English is the fallback)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brochures (
  brochure_id   INT          NOT NULL AUTO_INCREMENT,
  lang_code     VARCHAR(10)  NOT NULL,
  file_name     VARCHAR(150) NOT NULL,              -- stored outside the public web root
  file_size_kb  INT          NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  uploaded_by   VARCHAR(20)  NULL,
  uploaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (brochure_id),
  UNIQUE KEY uq_brochure_lang (lang_code),
  CONSTRAINT fk_bro_lang FOREIGN KEY (lang_code) REFERENCES languages(lang_code) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- LEADS (brochure, quote, sample, distributor, contact) - one table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  lead_id           BIGINT       NOT NULL AUTO_INCREMENT,
  lead_ref          VARCHAR(20)  NOT NULL,          -- 'DFL-260001' shown to staff and in e-mails
  form_type         ENUM('brochure','quote','sample','distributor','contact') NOT NULL,
  full_name         VARCHAR(120) NULL,
  first_name        VARCHAR(60)  NULL,
  last_name         VARCHAR(60)  NULL,
  business_name     VARCHAR(150) NULL,
  business_type     VARCHAR(80)  NULL,              -- form_options.option_value
  town              VARCHAR(120) NULL,
  phone             VARCHAR(15)  NOT NULL,          -- normalised: 10 digits, no +91
  email             VARCHAR(150) NOT NULL,
  monthly_quantity  VARCHAR(150) NULL,
  message           TEXT         NULL,
  details_json      JSON         NULL,              -- distributor: firm_name, gst_no, areas, godown_vehicles, brands, monthly_sales
  lang_code         VARCHAR(10)  NOT NULL DEFAULT 'en',
  source_page       VARCHAR(150) NULL,              -- path/section the form was opened from
  source_ref        VARCHAR(60)  NULL,              -- product_id or kit_key that opened it
  consent_given     TINYINT(1)   NOT NULL DEFAULT 0,
  consent_text      VARCHAR(500) NULL,              -- exact consent sentence shown, in the visitor's language
  consent_at        DATETIME     NULL,
  status            ENUM('new','contacted','qualified','won','lost','spam') NOT NULL DEFAULT 'new',
  assigned_to       VARCHAR(20)  NULL,              -- emp_id
  staff_notes       TEXT         NULL,              -- INTERNAL
  ip_hash           CHAR(64)     NULL,              -- SHA-256 of IP + secret salt (rate limiting, abuse) - INTERNAL
  user_agent        VARCHAR(255) NULL,
  sheet_synced_at   DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (lead_id),
  UNIQUE KEY uq_lead_ref (lead_ref),
  KEY idx_leads_type_date (form_type, created_at),
  KEY idx_leads_status (status),
  KEY idx_leads_phone (phone),
  KEY idx_leads_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_products (
  lead_id     BIGINT      NOT NULL,
  product_id  VARCHAR(30) NOT NULL,
  PRIMARY KEY (lead_id, product_id),
  CONSTRAINT fk_lp_lead FOREIGN KEY (lead_id)    REFERENCES leads(lead_id)       ON DELETE CASCADE,
  CONSTRAINT fk_lp_prod FOREIGN KEY (product_id) REFERENCES products(product_id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- OUTBOXES (never lose a lead e-mail or a Google Sheet row)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_outbox (
  mail_id          BIGINT        NOT NULL AUTO_INCREMENT,
  to_email         VARCHAR(255)  NOT NULL,
  subject          VARCHAR(255)  NOT NULL,
  html_body        MEDIUMTEXT    NOT NULL,
  text_body        MEDIUMTEXT    NOT NULL,          -- plain-text alternative is mandatory
  purpose          VARCHAR(40)   NOT NULL,          -- 'lead_alert', 'brochure_copy', 'lead_ack'
  lead_id          BIGINT        NULL,
  status           ENUM('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts         TINYINT       NOT NULL DEFAULT 0,
  last_error       VARCHAR(500)  NULL,
  next_attempt_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at          DATETIME      NULL,
  PRIMARY KEY (mail_id),
  KEY idx_mail_due (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_outbox (
  sync_id          BIGINT        NOT NULL AUTO_INCREMENT,
  target           ENUM('gsheet') NOT NULL DEFAULT 'gsheet',
  lead_id          BIGINT        NOT NULL,
  status           ENUM('pending','sending','done','failed') NOT NULL DEFAULT 'pending',
  attempts         TINYINT       NOT NULL DEFAULT 0,
  last_error       VARCHAR(500)  NULL,
  next_attempt_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_at          DATETIME      NULL,
  PRIMARY KEY (sync_id),
  KEY idx_sync_due (status, next_attempt_at),
  CONSTRAINT fk_sync_lead FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ADMIN (identity = dadmin.employee + shared JWT_SECRET; role lives here)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  emp_id      VARCHAR(20)  NOT NULL,                -- e.g. 'DZIND148' - VARCHAR, never a number
  role        ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by  VARCHAR(20)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (emp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id     BIGINT       NOT NULL AUTO_INCREMENT,
  emp_id       VARCHAR(20)  NOT NULL,
  action       VARCHAR(40)  NOT NULL,               -- 'create', 'update', 'delete', 'import', 'export', 'login'
  entity_type  VARCHAR(40)  NOT NULL,               -- 'product', 'ui_text', 'banner', 'lead' ...
  entity_id    VARCHAR(80)  NULL,
  before_json  JSON         NULL,
  after_json   JSON         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_emp (emp_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- categories.rep_product_id -> products (added after products exists)
ALTER TABLE categories
  ADD CONSTRAINT fk_cat_rep FOREIGN KEY (rep_product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;
