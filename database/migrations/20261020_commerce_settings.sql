-- Commerce phase 1 (docs/COMMERCE-SPEC.md section 3): Commerce settings and their lists. Structure and defaults only.
-- commerce_settings: one row per value, grouped like the site Settings page (admin Settings > Commerce settings).
-- value_type: bool | int | decimal | text | select (options = JSON [[value, label], ...]) | roles (JSON array of role ids).
-- tbc = 1: "To be confirmed" by sir (the 6 open questions of the spec); a placeholder default until then.
-- Lists: customer_types, return_reasons, delivery_methods, delivery_areas, locations; number_series is filled on use.
-- Commerce stays OFF (commerce_enabled = 0) until sir approves launch.
USE dfresh;

CREATE TABLE IF NOT EXISTS commerce_settings (
  setting_key  VARCHAR(60)   NOT NULL,
  grp          VARCHAR(40)   NOT NULL,
  label        VARCHAR(120)  NOT NULL,
  help         VARCHAR(500)  NULL,
  value        VARCHAR(1000) NOT NULL DEFAULT '',
  value_type   VARCHAR(10)   NOT NULL,
  options      VARCHAR(1000) NULL,
  tbc          TINYINT(1)    NOT NULL DEFAULT 0,
  sort_order   INT           NOT NULL DEFAULT 0,
  updated_by   VARCHAR(20)   NULL,
  updated_at   DATETIME      NULL,
  PRIMARY KEY (setting_key),
  KEY idx_cs_group (grp, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('commerce_enabled', 'General', 'Commerce back office on', 'Off: the Commerce menus are hidden and their API answers 404. Turn on when sir approves the launch.', '0', 'bool', NULL, 0, 10),
  ('order_sources', 'Orders and pricing', 'Order sources', 'Where an order came from, comma separated (New order and New customer offer these).', 'Phone, WhatsApp, Walk-in, Referral, B2B visit, Other', 'text', NULL, 0, 10),
  ('order_min_value_default', 'Orders and pricing', 'Minimum order value (Rs), when the customer type has none', 'Customer types can set their own minimum (list below).', '0', 'decimal', NULL, 0, 20),
  ('manual_discount_allowed', 'Orders and pricing', 'Manual discount on an order allowed', 'Above the approval threshold it waits for approval.', '1', 'bool', NULL, 0, 30),
  ('stock_reserve_at', 'Inventory', 'Reserve stock when', 'Reserved stock is not available for other orders.', 'confirmed', 'select', '[["confirmed","the order is confirmed"],["packing","packing starts"]]', 0, 10),
  ('low_level_default', 'Inventory', 'Low-stock level for a new SKU', 'Below it the SKU gets a red Low badge. Each SKU can have its own.', '20', 'int', NULL, 0, 20),
  ('reorder_qty_default', 'Inventory', 'Reorder quantity for a new SKU', '0 = not set.', '0', 'int', NULL, 0, 30),
  ('return_window_days', 'Returns', 'Return window (days after delivery)', 'A later return needs approval or is refused (next setting).', '7', 'int', NULL, 0, 10),
  ('return_outside_window', 'Returns', 'A return after the window', NULL, 'approval', 'select', '[["approval","needs approval"],["refuse","is refused"]]', 0, 20),
  ('delivery_charge_gst_rate', 'Delivery', 'GST rate on delivery charges (%)', NULL, '18', 'decimal', NULL, 0, 10),
  ('invoice_seller_name', 'Invoice', 'Seller (legal entity) on the invoice', 'To be confirmed by sir.', 'Dolluz Corporation (OPC) Pvt Ltd', 'text', NULL, 1, 10),
  ('invoice_seller_gstin', 'Invoice', 'Seller GSTIN', 'While this is not a valid GSTIN, every invoice shows "DEMO - not a tax invoice". To be confirmed by sir.', 'TO-BE-CONFIRMED', 'text', NULL, 1, 20),
  ('invoice_seller_address', 'Invoice', 'Seller address on the invoice', 'To be confirmed by sir.', 'Kanchipuram, Tamil Nadu', 'text', NULL, 1, 30),
  ('invoice_seller_state_code', 'Invoice', 'Seller state code', 'Tamil Nadu = 33. Same state as the buyer: CGST + SGST; another state: IGST.', '33', 'text', NULL, 0, 40),
  ('invoice_bank_details', 'Invoice', 'Bank details printed on the invoice', 'Account name, number, IFSC. Empty = not printed.', '', 'text', NULL, 1, 50),
  ('invoice_issue_at', 'Invoice', 'Issue the tax invoice when', NULL, 'dispatch', 'select', '[["dispatch","the order is dispatched"],["confirm","the order is confirmed"]]', 0, 60),
  ('invoice_round_off', 'Invoice', 'Round the total to the rupee', 'Shown as a separate round-off line.', '1', 'bool', NULL, 0, 70),
  ('invoice_prefix', 'Numbering', 'Invoice prefix', 'Invoices are numbered per financial year: DFI/26-27/0001.', 'DFI', 'text', NULL, 0, 10),
  ('credit_note_prefix', 'Numbering', 'Credit note prefix', 'DFC/26-27/0001, per financial year.', 'DFC', 'text', NULL, 0, 20),
  ('order_prefix', 'Numbering', 'Order prefix', 'DFO-26nnnn, per calendar year.', 'DFO', 'text', NULL, 0, 30),
  ('return_prefix', 'Numbering', 'Return prefix', 'DFR-26nnnn, per calendar year.', 'DFR', 'text', NULL, 0, 40),
  ('invoice_start_no', 'Numbering', 'First invoice number of a new financial year', NULL, '1', 'int', NULL, 0, 50),
  ('einvoice_mode', 'GST and compliance', 'E-invoicing (IRN / QR on B2B invoices)', 'Off = invoices are made here without an IRN. To be confirmed by sir (turnover limit).', 'off', 'select', '[["off","Off - manual"],["on","On - generate IRN"]]', 1, 10),
  ('ewaybill_mode', 'GST and compliance', 'E-way bills', 'Off = made by hand on the portal. To be confirmed by sir.', 'off', 'select', '[["off","Off - manual"],["on","On - generate from the admin"]]', 1, 20),
  ('cashback_gst_treatment', 'GST and compliance', 'Cashback under GST', 'Changes the taxable value of the next invoice. To be confirmed by sir with the accountant.', 'discount', 'select', '[["discount","Discount on the next invoice"],["payment","Payment method"]]', 1, 30),
  ('payment_methods', 'Payments', 'Payment methods offered', 'Comma separated.', 'Cash, UPI, Bank transfer, Cheque, Credit', 'text', NULL, 0, 10),
  ('razorpay_payment_links', 'Payments', 'Razorpay payment links', 'Off = payments are entered by hand. To be confirmed by sir (needs a Razorpay account).', '0', 'bool', NULL, 1, 20),
  ('notify_email', 'Notifications', 'E-mail customers (order confirmed, dispatched, delivered)', 'Through the mail outbox, in the customer''s language.', '1', 'bool', NULL, 0, 10),
  ('notify_whatsapp', 'Notifications', 'WhatsApp messages', 'For later: needs a provider. To be confirmed by sir.', '0', 'bool', NULL, 1, 20),
  ('notify_sms', 'Notifications', 'SMS messages', 'For later: needs a provider. To be confirmed by sir.', '0', 'bool', NULL, 1, 30),
  ('accounting_export', 'Accounting', 'Accounting export format', 'CSV now; Tally and Zoho for later. To be confirmed by sir.', 'csv', 'select', '[["csv","CSV"],["tally","Tally (later)"],["zoho","Zoho Books (later)"]]', 1, 10),
  ('approver_role_ids', 'Approvals', 'Approver roles', 'Who may approve (they also need "approve" on the section). Nobody approves their own request.', '[1]', 'roles', NULL, 0, 10),
  ('approval_expiry_days', 'Approvals', 'A pending request expires after (days)', NULL, '7', 'int', NULL, 0, 20),
  ('approve_refund_on', 'Approvals', 'Refunds need approval', NULL, '1', 'bool', NULL, 0, 30),
  ('approve_refund_above', 'Approvals', 'Refund above (Rs)', NULL, '2000', 'decimal', NULL, 0, 31),
  ('approve_writeoff_on', 'Approvals', 'Stock write-offs need approval', NULL, '1', 'bool', NULL, 0, 40),
  ('approve_writeoff_value_above', 'Approvals', 'Write-off above (Rs value)', NULL, '1000', 'decimal', NULL, 0, 41),
  ('approve_writeoff_qty_above', 'Approvals', 'or above (packs)', NULL, '20', 'int', NULL, 0, 42),
  ('approve_discount_on', 'Approvals', 'Manual discounts need approval', NULL, '1', 'bool', NULL, 0, 50),
  ('approve_discount_pct_above', 'Approvals', 'Manual discount above (% of the subtotal)', NULL, '10', 'decimal', NULL, 0, 51),
  ('approve_cancel_after_dispatch', 'Approvals', 'Cancelling an order after dispatch needs approval', NULL, '1', 'bool', NULL, 0, 60),
  ('approve_goodwill_credit', 'Approvals', 'Manual (goodwill) wallet credit needs approval', NULL, '1', 'bool', NULL, 0, 70),
  ('approve_credit_raise', 'Approvals', 'Raising a customer''s credit limit needs approval', NULL, '1', 'bool', NULL, 0, 80),
  ('approve_price_below_on', 'Approvals', 'A price below the price list needs approval', NULL, '1', 'bool', NULL, 0, 90),
  ('approve_price_below_pct', 'Approvals', 'Below the list by more than (%)', NULL, '5', 'decimal', NULL, 0, 91);

CREATE TABLE IF NOT EXISTS customer_types (
  type_key              VARCHAR(20)   NOT NULL,
  label                 VARCHAR(60)   NOT NULL,
  sort_order            INT           NOT NULL DEFAULT 0,
  min_order_value       DECIMAL(10,2) NOT NULL DEFAULT 0,
  default_credit_days   INT           NOT NULL DEFAULT 0,
  default_credit_limit  DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active             TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO customer_types (type_key, label, sort_order) VALUES
  ('home', 'Home', 1), ('hotel', 'Hotel', 2), ('hospital', 'Hospital', 3), ('office', 'Office', 4), ('distributor', 'Distributor', 5);

CREATE TABLE IF NOT EXISTS return_reasons (
  reason_id    INT          NOT NULL AUTO_INCREMENT,
  label        VARCHAR(100) NOT NULL,
  needs_photo  TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order   INT          NOT NULL DEFAULT 0,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (reason_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO return_reasons (reason_id, label, needs_photo, sort_order) VALUES
  (1, 'Wrong item', 0, 1), (2, 'Damaged in transit', 1, 2), (3, 'Quality issue', 1, 3), (4, 'Ordered by mistake', 0, 4), (5, 'Other', 0, 5);

CREATE TABLE IF NOT EXISTS delivery_methods (
  method_id          INT          NOT NULL AUTO_INCREMENT,
  label              VARCHAR(80)  NOT NULL,
  needs_tracking_no  TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order         INT          NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (method_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO delivery_methods (method_id, label, needs_tracking_no, sort_order) VALUES
  (1, 'Own vehicle', 0, 1), (2, 'Courier', 1, 2), (3, 'Pick-up at the godown', 0, 3);

CREATE TABLE IF NOT EXISTS delivery_areas (
  area_id     INT           NOT NULL AUTO_INCREMENT,
  label       VARCHAR(80)   NOT NULL,
  towns       VARCHAR(1000) NOT NULL DEFAULT '',     -- comma separated towns or pincodes
  charge      DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_above  DECIMAL(10,2) NULL,                    -- order value above which delivery is free; NULL = never free
  sort_order  INT           NOT NULL DEFAULT 0,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO delivery_areas (area_id, label, towns, charge, free_above, sort_order) VALUES
  (1, 'Kanchipuram town', 'Kanchipuram', 0, NULL, 1);

CREATE TABLE IF NOT EXISTS locations (
  location_id  INT          NOT NULL AUTO_INCREMENT,
  name         VARCHAR(80)  NOT NULL,
  address      VARCHAR(255) NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO locations (location_id, name, address, sort_order) VALUES (1, 'Kanchipuram godown', 'Kanchipuram, Tamil Nadu', 1);

CREATE TABLE IF NOT EXISTS number_series (
  series_key  VARCHAR(30)  NOT NULL,                 -- e.g. DFO-26, DFI-2026-27
  last_no     INT          NOT NULL,
  PRIMARY KEY (series_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
