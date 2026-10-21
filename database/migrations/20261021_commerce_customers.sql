-- Commerce phase 8 (docs/COMMERCE-SPEC.md 4.5): customers (CRM). Structure and defaults only: no customers (the demo
-- ones come from scripts/commerce-demo-seed.js). Replaces the demo customers table of the 20 Oct 2026 demo.
-- - customers: CUS-0001 (number series "CUS", never DFC: that is the credit note series), type (customer_types),
--   status active / on_hold (a new order waits for approval) / inactive (no new orders), sales owner (admin user),
--   price list of its own instead of the type's (through approval), credit terms, the lead it came from, merged_into.
-- - customer_addresses: billing addresses each with their own GSTIN and state (B2B branches) and shipping addresses
--   with contact person, phone and delivery area; one default of each kind.
-- - customer_contacts: people (role, phone, e-mail, WhatsApp, gets invoices).
-- - customer_activity (calls, WhatsApp, visits, mails, notes typed by hand), follow_ups (assignee, due date, done /
--   snooze), customer_tags (free tags), customer_segments (saved list filters).
-- - orders: the billing and shipping address chosen (the order keeps its own snapshot of both, as before).
USE dfresh;

CREATE TABLE IF NOT EXISTS customers (
  customer_id     INT           NOT NULL AUTO_INCREMENT,
  customer_no     VARCHAR(12)   NOT NULL,                      -- CUS-0001
  name            VARCHAR(120)  NOT NULL,                      -- the customer as we call them (person or business)
  business_name   VARCHAR(150)  NULL,
  type_key        VARCHAR(20)   NOT NULL,
  status          VARCHAR(10)   NOT NULL DEFAULT 'active',     -- active | on_hold | inactive
  hold_reason     VARCHAR(255)  NULL,
  phone           VARCHAR(20)   NOT NULL,                      -- +91 98765 43210
  phone_digits    CHAR(10)      NOT NULL,                      -- duplicate check
  email           VARCHAR(150)  NULL,
  source          VARCHAR(20)   NULL,
  owner_emp_id    VARCHAR(20)   NULL,                          -- sales owner (admin user)
  price_list      VARCHAR(20)   NULL,                          -- NULL = the type's list
  credit_days     INT           NOT NULL DEFAULT 0,
  credit_limit    DECIMAL(12,2) NOT NULL DEFAULT 0,
  lead_id         BIGINT        NULL,
  merged_into     INT           NULL,
  created_by      VARCHAR(20)   NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by      VARCHAR(20)   NULL,
  updated_at      DATETIME      NULL,
  PRIMARY KEY (customer_id),
  UNIQUE KEY uq_customer_no (customer_no),
  KEY idx_customer_phone (phone_digits),
  KEY idx_customer_email (email),
  KEY idx_customer_type (type_key, status),
  KEY idx_customer_owner (owner_emp_id),
  KEY idx_customer_lead (lead_id),
  CONSTRAINT fk_customer_type FOREIGN KEY (type_key) REFERENCES customer_types (type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_addresses (
  address_id        INT           NOT NULL AUTO_INCREMENT,
  customer_id       INT           NOT NULL,
  kind              VARCHAR(10)   NOT NULL,                    -- billing | shipping
  label             VARCHAR(80)   NULL,                        -- e.g. "Branch 2 - Anna Nagar"
  name              VARCHAR(150)  NOT NULL,                    -- on the invoice / the parcel
  gstin             VARCHAR(15)   NULL,                        -- billing: this branch's GSTIN (its state)
  contact_person    VARCHAR(120)  NULL,                        -- shipping
  phone             VARCHAR(20)   NULL,
  address           VARCHAR(255)  NULL,
  town              VARCHAR(80)   NULL,
  state_code        CHAR(2)       NOT NULL,
  pincode           VARCHAR(6)    NULL,
  delivery_area_id  INT           NULL,                        -- shipping: NULL = from the PIN code / town
  is_default        TINYINT(1)    NOT NULL DEFAULT 0,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (address_id),
  KEY idx_addr_customer (customer_id, kind),
  KEY idx_addr_gstin (gstin),
  CONSTRAINT fk_addr_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_contacts (
  contact_id     INT           NOT NULL AUTO_INCREMENT,
  customer_id    INT           NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  role           VARCHAR(80)   NULL,
  phone          VARCHAR(20)   NULL,
  email          VARCHAR(150)  NULL,
  whatsapp       TINYINT(1)    NOT NULL DEFAULT 0,
  gets_invoices  TINYINT(1)    NOT NULL DEFAULT 0,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id),
  KEY idx_contact_customer (customer_id),
  CONSTRAINT fk_contact_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_activity (
  activity_id  BIGINT        NOT NULL AUTO_INCREMENT,
  customer_id  INT           NOT NULL,
  kind         VARCHAR(10)   NOT NULL,                         -- call | whatsapp | visit | mail | note
  happened_at  DATETIME      NOT NULL,
  note         TEXT          NOT NULL,
  emp_id       VARCHAR(20)   NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id),
  KEY idx_activity_customer (customer_id, happened_at),
  CONSTRAINT fk_activity_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follow_ups (
  follow_up_id  BIGINT        NOT NULL AUTO_INCREMENT,
  customer_id   INT           NOT NULL,
  assignee      VARCHAR(20)   NOT NULL,                        -- admin user
  due_on        DATE          NOT NULL,
  note          VARCHAR(255)  NOT NULL,
  status        VARCHAR(10)   NOT NULL DEFAULT 'open',         -- open | done
  snoozes       INT           NOT NULL DEFAULT 0,
  done_at       DATETIME      NULL,
  done_by       VARCHAR(20)   NULL,
  done_note     VARCHAR(255)  NULL,
  created_by    VARCHAR(20)   NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follow_up_id),
  KEY idx_follow_assignee (assignee, status, due_on),
  KEY idx_follow_customer (customer_id, status),
  CONSTRAINT fk_follow_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_tags (
  customer_id  INT          NOT NULL,
  tag          VARCHAR(40)  NOT NULL,
  PRIMARY KEY (customer_id, tag),
  KEY idx_tag (tag),
  CONSTRAINT fk_tag_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_segments (
  segment_id  INT            NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)    NOT NULL,
  filters     VARCHAR(1000)  NOT NULL,                         -- JSON: the Customers list filters
  created_by  VARCHAR(20)    NOT NULL,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (segment_id),
  UNIQUE KEY uq_segment_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders
  ADD COLUMN bill_address_id INT NULL AFTER bill_phone,
  ADD COLUMN ship_address_id INT NULL AFTER ship_phone,
  ADD CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id);

INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('customer_prefix', 'Numbering', 'Customer prefix', 'CUS-0001 (never DFC: that is the credit note series).', 'CUS', 'text', NULL, 0, 60),
  ('own_customers_only', 'Customers', 'Sales sees only their own customers and orders', 'On: the roles below see only the customers they own (Sales owner) and those customers'' orders.', '0', 'bool', NULL, 0, 10),
  ('own_customers_role_ids', 'Customers', 'Roles limited to their own customers', 'Used when the setting above is on.', '[6]', 'roles', NULL, 0, 20),
  ('approve_price_list', 'Approvals', 'A customer''s own price list (not its type''s) needs approval', NULL, '1', 'bool', NULL, 0, 130);
