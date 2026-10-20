-- Commerce phase 3 (docs/COMMERCE-SPEC.md 4.4, 4.6, 5.1, 5.2, 6): orders, their lines with a tax snapshot, status
-- history, stock reservations, payments, invoices and credit notes. Structure only, no orders.
-- (Named "sales" so it runs after 20261020_commerce_pricing.sql, whose skus table the lines refer to.)
-- - orders.status: approval (waiting for an approval) | new (confirmed) | packed | dispatched | delivered | cancelled.
--   orders.version is the optimistic lock: an edit sends the version it read; another one in between -> "reload".
-- - bill_* / ship_*: the addresses copied from the customer, editable on the order. place_of_supply = ship state;
--   gst_type intra (CGST + SGST) when it is the seller's state (Commerce setting invoice_seller_state_code), else
--   inter (IGST).
-- - Money: subtotal - discount = taxable; + cgst + sgst + igst + round_off = total (the invoice total). Wallet credit
--   used counts as paid. amount_due = total - wallet_used - payments + refunds.
-- - stock_reservations: active while the order holds stock (Available = good stock - active reservations); consumed at
--   dispatch, released on cancel or edit.
-- - invoices: one live invoice per order (live_order_id = order_id while issued, NULL once cancelled); numbers come
--   from number_series per financial year (DFI/26-27/0001) inside the transaction that issues it, so a number is
--   never skipped or used twice. A cancelled invoice stays, marked cancelled, with a credit note (DFC/26-27/0001).
USE dfresh;

CREATE TABLE IF NOT EXISTS orders (
  order_id          BIGINT        NOT NULL AUTO_INCREMENT,
  order_no          VARCHAR(20)   NOT NULL,
  customer_id       INT           NOT NULL,
  price_list        VARCHAR(20)   NULL,
  status            VARCHAR(20)   NOT NULL DEFAULT 'new',
  payment_terms     VARCHAR(10)   NOT NULL DEFAULT 'cod',     -- cod | advance | credit
  credit_days       INT           NOT NULL DEFAULT 0,         -- the customer's credit days on the order day
  payment_status    VARCHAR(12)   NOT NULL DEFAULT 'unpaid',  -- unpaid | partly_paid | paid | refunded
  bill_name         VARCHAR(150)  NOT NULL,
  bill_gstin        VARCHAR(15)   NULL,
  bill_address      VARCHAR(255)  NULL,
  bill_town         VARCHAR(80)   NULL,
  bill_state_code   CHAR(2)       NOT NULL,
  bill_pincode      VARCHAR(6)    NULL,
  bill_phone        VARCHAR(20)   NULL,
  ship_name         VARCHAR(150)  NOT NULL,
  ship_address      VARCHAR(255)  NULL,
  ship_town         VARCHAR(80)   NULL,
  ship_state_code   CHAR(2)       NOT NULL,
  ship_pincode      VARCHAR(6)    NULL,
  ship_phone        VARCHAR(20)   NULL,
  place_of_supply   CHAR(2)       NOT NULL,
  gst_type          VARCHAR(5)    NOT NULL,                   -- intra | inter
  coupon_code       VARCHAR(20)   NULL,
  subtotal          DECIMAL(12,2) NOT NULL,
  discount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  taxable           DECIMAL(12,2) NOT NULL,
  cgst              DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst              DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst              DECIMAL(12,2) NOT NULL DEFAULT 0,
  gst               DECIMAL(12,2) NOT NULL,                   -- cgst + sgst + igst
  round_off         DECIMAL(6,2)  NOT NULL DEFAULT 0,
  total             DECIMAL(12,2) NOT NULL,
  wallet_used       DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid       DECIMAL(12,2) NOT NULL DEFAULT 0,         -- payments - refunds (wallet not included)
  amount_due        DECIMAL(12,2) NOT NULL,
  note              VARCHAR(255)  NULL,
  version           INT           NOT NULL DEFAULT 1,
  emp_id            VARCHAR(20)   NOT NULL,                   -- created by
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at      DATETIME      NULL,
  packed_at         DATETIME      NULL,
  dispatched_at     DATETIME      NULL,
  delivered_at      DATETIME      NULL,
  cancelled_at      DATETIME      NULL,
  cancel_reason     VARCHAR(255)  NULL,
  updated_by        VARCHAR(20)   NULL,
  updated_at        DATETIME      NULL,
  PRIMARY KEY (order_id),
  UNIQUE KEY uq_order_no (order_no),
  KEY idx_order_status (status, created_at),
  KEY idx_order_customer (customer_id),
  KEY idx_order_payment (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  line_id     BIGINT        NOT NULL AUTO_INCREMENT,
  order_id    BIGINT        NOT NULL,
  sku_code    VARCHAR(30)   NOT NULL,
  qty         INT           NOT NULL,                         -- packs
  price       DECIMAL(10,2) NOT NULL,                         -- per pack before GST
  list_price  DECIMAL(10,2) NULL,                             -- the list price that day, as on the list
  hsn         VARCHAR(8)    NOT NULL,
  gst_rate    DECIMAL(5,2)  NOT NULL,
  taxable     DECIMAL(12,2) NOT NULL,                         -- qty x price less its share of the discount
  cgst        DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst        DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst        DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total  DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (line_id),
  UNIQUE KEY uq_order_sku (order_id, sku_code),
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_history (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  order_id     BIGINT       NOT NULL,
  from_status  VARCHAR(20)  NULL,
  to_status    VARCHAR(20)  NOT NULL,                         -- a status, or 'edited'
  note         VARCHAR(255) NULL,
  emp_id       VARCHAR(20)  NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_history_order (order_id),
  CONSTRAINT fk_history_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_reservations (
  reservation_id  BIGINT       NOT NULL AUTO_INCREMENT,
  order_id        BIGINT       NOT NULL,
  sku_code        VARCHAR(30)  NOT NULL,
  location_id     INT          NOT NULL DEFAULT 1,
  qty             INT          NOT NULL,
  status          VARCHAR(10)  NOT NULL DEFAULT 'active',     -- active | consumed | released
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at       DATETIME     NULL,
  PRIMARY KEY (reservation_id),
  KEY idx_res_sku (sku_code, location_id, status),
  KEY idx_res_order (order_id),
  CONSTRAINT fk_res_order FOREIGN KEY (order_id) REFERENCES orders (order_id),
  CONSTRAINT fk_res_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  payment_id   BIGINT        NOT NULL AUTO_INCREMENT,
  order_id     BIGINT        NOT NULL,
  kind         VARCHAR(10)   NOT NULL DEFAULT 'payment',      -- payment | refund
  mode         VARCHAR(20)   NOT NULL,                        -- cash | upi | bank | cheque | razorpay
  amount       DECIMAL(12,2) NOT NULL,                        -- always above 0; kind says which way
  received_on  DATE          NOT NULL,
  reference    VARCHAR(60)   NULL,
  note         VARCHAR(255)  NULL,
  emp_id       VARCHAR(20)   NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id),
  KEY idx_payment_order (order_id),
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id         BIGINT        NOT NULL AUTO_INCREMENT,
  invoice_no         VARCHAR(16)   NOT NULL,                  -- DFI/26-27/0001 (GST allows 16 characters)
  fy                 CHAR(7)       NOT NULL,                  -- 2026-27
  seq                INT           NOT NULL,
  order_id           BIGINT        NOT NULL,
  live_order_id      BIGINT        NULL,                      -- = order_id while issued, NULL once cancelled
  status             VARCHAR(10)   NOT NULL DEFAULT 'issued', -- issued | cancelled
  issued_at          DATETIME      NOT NULL,
  due_on             DATE          NOT NULL,
  place_of_supply    CHAR(2)       NOT NULL,
  gst_type           VARCHAR(5)    NOT NULL,
  taxable            DECIMAL(12,2) NOT NULL,
  cgst               DECIMAL(12,2) NOT NULL,
  sgst               DECIMAL(12,2) NOT NULL,
  igst               DECIMAL(12,2) NOT NULL,
  round_off          DECIMAL(6,2)  NOT NULL,
  total              DECIMAL(12,2) NOT NULL,
  seller_name        VARCHAR(150)  NOT NULL,
  seller_gstin       VARCHAR(20)   NOT NULL,
  seller_address     VARCHAR(255)  NULL,
  seller_state_code  CHAR(2)       NOT NULL,
  buyer_json         JSON          NOT NULL,                  -- bill / ship snapshot
  is_demo            TINYINT(1)    NOT NULL DEFAULT 0,        -- issued while the seller GSTIN was a placeholder
  emp_id             VARCHAR(20)   NOT NULL,
  cancelled_at       DATETIME      NULL,
  cancel_reason      VARCHAR(255)  NULL,
  cancelled_by       VARCHAR(20)   NULL,
  PRIMARY KEY (invoice_id),
  UNIQUE KEY uq_invoice_no (invoice_no),
  UNIQUE KEY uq_invoice_live (live_order_id),
  KEY idx_invoice_order (order_id),
  KEY idx_invoice_due (status, due_on),
  CONSTRAINT fk_invoice_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_notes (
  credit_note_id  BIGINT        NOT NULL AUTO_INCREMENT,
  credit_note_no  VARCHAR(16)   NOT NULL,                     -- DFC/26-27/0001
  fy              CHAR(7)       NOT NULL,
  seq             INT           NOT NULL,
  invoice_id      BIGINT        NOT NULL,
  return_id       BIGINT        NULL,
  reason          VARCHAR(255)  NOT NULL,
  taxable         DECIMAL(12,2) NOT NULL,
  cgst            DECIMAL(12,2) NOT NULL,
  sgst            DECIMAL(12,2) NOT NULL,
  igst            DECIMAL(12,2) NOT NULL,
  round_off       DECIMAL(6,2)  NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL,
  issued_at       DATETIME      NOT NULL,
  emp_id          VARCHAR(20)   NOT NULL,
  PRIMARY KEY (credit_note_id),
  UNIQUE KEY uq_credit_note_no (credit_note_no),
  KEY idx_cn_invoice (invoice_id),
  CONSTRAINT fk_cn_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
