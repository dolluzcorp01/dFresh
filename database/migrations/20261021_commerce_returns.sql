-- Commerce phase 6 (docs/COMMERCE-SPEC.md 4.8, 5.5, 6.2): returns, inspection, refunds, credit notes. Structure and
-- defaults only, no returns.
-- Status: requested (an approval may be pending when it is outside the return window) -> collecting (the customer
-- brings it, a pickup stop on a trip, or a courier reverse pickup with AWB) -> received (at the godown, packs scanned)
-- -> inspected (per line OK -> Returned (R) stock, Damaged -> damaged, Expired -> expired (blocked), Not received;
-- the batch is kept) -> refunded / replaced / closed (rejected when the window approval is refused).
-- Outcome per line: refund (wallet, the original payment by hand, or less to pay on a credit order), replacement (a
-- Rs 0 order through the normal pick-pack-deliver flow), or no refund (reason, through approval). A credit note
-- (DFC/26-27/nnnn, credit_note_lines at the invoice's own tax) is issued before any refund.
USE dfresh;

CREATE TABLE IF NOT EXISTS returns (
  return_id             BIGINT        NOT NULL AUTO_INCREMENT,
  return_no             VARCHAR(20)   NOT NULL,                  -- DFR-26nnnn
  order_id              BIGINT        NOT NULL,
  status                VARCHAR(12)   NOT NULL DEFAULT 'requested',
  reason_id             INT           NOT NULL,
  reason_note           VARCHAR(255)  NULL,
  delivered_on          DATE          NOT NULL,
  window_days           INT           NOT NULL,
  outside_window        TINYINT(1)    NOT NULL DEFAULT 0,
  collection            VARCHAR(10)   NOT NULL,                  -- bring | trip | courier
  courier_id            INT           NULL,
  awb_no                VARCHAR(40)   NULL,
  picked_up_at          DATETIME      NULL,
  picked_up_by          VARCHAR(20)   NULL,
  received_at           DATETIME      NULL,
  received_by           VARCHAR(20)   NULL,
  inspected_at          DATETIME      NULL,
  inspected_by          VARCHAR(20)   NULL,
  inspect_note          VARCHAR(255)  NULL,
  refund_method         VARCHAR(10)   NULL,                      -- wallet | original | balance
  no_refund_reason      VARCHAR(255)  NULL,
  replacement_order_id  BIGINT        NULL,
  requested_by          VARCHAR(20)   NOT NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at             DATETIME      NULL,
  version               INT           NOT NULL DEFAULT 1,
  PRIMARY KEY (return_id),
  UNIQUE KEY uq_return_no (return_no),
  KEY idx_return_order (order_id),
  KEY idx_return_status (status, created_at),
  CONSTRAINT fk_return_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_items (
  line_id       BIGINT       NOT NULL AUTO_INCREMENT,
  return_id     BIGINT       NOT NULL,
  sku_code      VARCHAR(30)  NOT NULL,
  batch_id      BIGINT       NULL,                               -- the batch it left in (batch-tracked products)
  qty           INT          NOT NULL,                           -- packs the customer returns
  qty_received  INT          NOT NULL DEFAULT 0,                 -- scanned at the godown
  qty_ok        INT          NULL,                               -- inspection (NULL until inspected)
  qty_damaged   INT          NULL,
  qty_expired   INT          NULL,
  qty_missing   INT          NULL,                               -- not received
  refund_qty    INT          NULL,                               -- outcome (NULL until decided)
  replace_qty   INT          NULL,
  none_qty      INT          NULL,
  PRIMARY KEY (line_id),
  KEY idx_ritem_return (return_id),
  CONSTRAINT fk_ritem_return FOREIGN KEY (return_id) REFERENCES returns (return_id) ON DELETE CASCADE,
  CONSTRAINT fk_ritem_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code),
  CONSTRAINT fk_ritem_batch FOREIGN KEY (batch_id) REFERENCES batches (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_photos (
  photo_id    BIGINT       NOT NULL AUTO_INCREMENT,
  return_id   BIGINT       NOT NULL,
  kind        VARCHAR(10)  NOT NULL,                             -- request | pickup | inspect
  photo       MEDIUMBLOB   NOT NULL,
  photo_type  VARCHAR(30)  NOT NULL,
  emp_id      VARCHAR(20)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id),
  KEY idx_rphoto_return (return_id),
  CONSTRAINT fk_rphoto_return FOREIGN KEY (return_id) REFERENCES returns (return_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_scans (
  scan_id     BIGINT        NOT NULL AUTO_INCREMENT,
  return_id   BIGINT        NOT NULL,
  code        VARCHAR(60)   NOT NULL,
  sku_code    VARCHAR(30)   NULL,
  batch_id    BIGINT        NULL,
  qty         INT           NOT NULL DEFAULT 0,
  result      VARCHAR(12)   NOT NULL,                            -- ok | wrong_sku | wrong_batch | too_many | unknown
  message     VARCHAR(255)  NULL,
  emp_id      VARCHAR(20)   NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scan_id),
  KEY idx_rscan_return (return_id),
  CONSTRAINT fk_rscan_return FOREIGN KEY (return_id) REFERENCES returns (return_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_history (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  return_id   BIGINT       NOT NULL,
  status      VARCHAR(20)  NOT NULL,                             -- a status or a step (photo, scan reset, decided ...)
  note        VARCHAR(255) NULL,
  emp_id      VARCHAR(20)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rhist_return (return_id),
  CONSTRAINT fk_rhist_return FOREIGN KEY (return_id) REFERENCES returns (return_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refunds (
  refund_id        BIGINT        NOT NULL AUTO_INCREMENT,
  return_id        BIGINT        NOT NULL,
  order_id         BIGINT        NOT NULL,
  method           VARCHAR(10)   NOT NULL,                       -- wallet | original | balance
  mode             VARCHAR(20)   NULL,                           -- original: cash | upi | bank | cheque | razorpay
  reference        VARCHAR(60)   NULL,
  amount           DECIMAL(12,2) NOT NULL,                       -- the credit note total
  status           VARCHAR(10)   NOT NULL,                       -- approval | paid | rejected
  approval_id      BIGINT        NULL,
  credit_note_id   BIGINT        NULL,
  payment_id       BIGINT        NULL,
  emp_id           VARCHAR(20)   NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at          DATETIME      NULL,
  PRIMARY KEY (refund_id),
  KEY idx_refund_order (order_id),
  KEY idx_refund_return (return_id),
  CONSTRAINT fk_refund_return FOREIGN KEY (return_id) REFERENCES returns (return_id),
  CONSTRAINT fk_refund_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_note_lines (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  credit_note_id  BIGINT        NOT NULL,
  sku_code        VARCHAR(30)   NOT NULL,
  hsn             VARCHAR(8)    NOT NULL,
  gst_rate        DECIMAL(5,2)  NOT NULL,
  qty             INT           NOT NULL,
  taxable         DECIMAL(12,2) NOT NULL,
  cgst            DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst            DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst            DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total      DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cnline_cn (credit_note_id),
  CONSTRAINT fk_cnline_cn FOREIGN KEY (credit_note_id) REFERENCES credit_notes (credit_note_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- payment status "part_refunded" (some returned packs refunded)
ALTER TABLE orders MODIFY COLUMN payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid';  -- unpaid | partly_paid | paid | refunded | part_refunded

-- a trip stop can be a return pickup
ALTER TABLE trip_stops
  ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'delivery' AFTER order_id,     -- delivery | pickup
  ADD COLUMN return_id BIGINT NULL AFTER kind,
  DROP INDEX uq_trip_order,
  ADD UNIQUE KEY uq_trip_stop (trip_id, order_id, kind);

-- Warehouse receives and inspects returns (receiving needs edit on Inventory; refunds stay with Returns edit)
INSERT IGNORE INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_delete) VALUES (5, 'returns', 1, 0, 0, 0, 0);
