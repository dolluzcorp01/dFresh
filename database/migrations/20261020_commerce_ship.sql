-- Commerce phase 5 (docs/COMMERCE-SPEC.md 4.7, 5.3, 5.4): packing and delivery. Structure and defaults only.
-- (Named "ship" so it runs after _sales.sql and _settings.sql, whose orders, invoices and delivery lists it extends.)
-- Order status after Packed depends on the delivery method kind:
--   own vehicle: packed -> out_for_delivery (trip started) -> delivered | failed -> packed again (re-attempt) or cancelled
--   (returned to the godown); courier: packed -> with_courier (AWB) -> delivered; pickup: packed -> delivered.
-- The goods leave the godown (stock out, tax invoice) once: when the trip starts, the courier takes them or the customer
-- collects them (orders.dispatched_at marks it).
-- - order_picks: the SKUs and batches (earliest expiry first) picked for an order when packing starts; the pack check
--   and the stock out follow them.
-- - pack_scans: every scan at the packing table, right or wrong.
-- - delivery_trips / trip_stops: a vehicle and driver with packed orders in route order; per stop delivered (receiver,
--   photo, OTP if switched on), failed (reason) and cash collected.
USE dfresh;

ALTER TABLE skus ADD COLUMN bin_location VARCHAR(30) NULL AFTER sell_unit;

ALTER TABLE delivery_methods ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'own' AFTER label; -- own | courier | pickup
UPDATE delivery_methods SET kind = 'courier' WHERE method_id = 2;
UPDATE delivery_methods SET kind = 'pickup' WHERE method_id = 3;

CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_id  INT          NOT NULL AUTO_INCREMENT,
  number      VARCHAR(20)  NOT NULL,
  type        VARCHAR(40)  NOT NULL DEFAULT '',
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drivers (
  driver_id   INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  phone       VARCHAR(20)  NOT NULL DEFAULT '',
  emp_id      VARCHAR(20)  NULL,                            -- the admin user who sees this driver's trips (My trips)
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (driver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS couriers (
  courier_id    INT           NOT NULL AUTO_INCREMENT,
  name          VARCHAR(80)   NOT NULL,
  tracking_url  VARCHAR(255)  NOT NULL DEFAULT '',           -- with {awb}, e.g. https://example.com/track?awb={awb}
  sort_order    INT           NOT NULL DEFAULT 0,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (courier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders
  ADD COLUMN delivery_method_id INT NULL AFTER credit_days,
  ADD COLUMN delivery_kind VARCHAR(10) NOT NULL DEFAULT 'own' AFTER delivery_method_id,
  ADD COLUMN delivery_area_id INT NULL AFTER delivery_kind,
  ADD COLUMN delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER discount,
  ADD COLUMN delivery_gst DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER delivery_charge,
  ADD COLUMN courier_id INT NULL AFTER delivery_area_id,
  ADD COLUMN awb_no VARCHAR(40) NULL AFTER courier_id,
  ADD COLUMN eway_bill_no VARCHAR(20) NULL AFTER awb_no,
  ADD COLUMN cartons INT NULL AFTER eway_bill_no,
  ADD COLUMN weight_kg DECIMAL(8,2) NULL AFTER cartons,
  ADD COLUMN packed_by VARCHAR(20) NULL AFTER weight_kg,
  ADD COLUMN pack_override VARCHAR(255) NULL AFTER packed_by,
  ADD COLUMN received_by VARCHAR(120) NULL AFTER pack_override,
  ADD COLUMN failed_reason VARCHAR(255) NULL AFTER received_by,
  ADD COLUMN delivery_attempts INT NOT NULL DEFAULT 0 AFTER failed_reason,
  ADD COLUMN packing_at DATETIME NULL AFTER confirmed_at,
  ADD COLUMN out_at DATETIME NULL AFTER dispatched_at,
  ADD COLUMN courier_at DATETIME NULL AFTER out_at,
  ADD COLUMN failed_at DATETIME NULL AFTER courier_at;

ALTER TABLE invoices
  ADD COLUMN delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER taxable,
  ADD COLUMN delivery_gst DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER delivery_charge;

CREATE TABLE IF NOT EXISTS order_picks (
  pick_id   BIGINT       NOT NULL AUTO_INCREMENT,
  order_id  BIGINT       NOT NULL,
  sku_code  VARCHAR(30)  NOT NULL,
  batch_id  BIGINT       NULL,
  qty       INT          NOT NULL,
  PRIMARY KEY (pick_id),
  KEY idx_pick_order (order_id),
  CONSTRAINT fk_pick_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
  CONSTRAINT fk_pick_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pack_scans (
  scan_id     BIGINT        NOT NULL AUTO_INCREMENT,
  order_id    BIGINT        NOT NULL,
  code        VARCHAR(60)   NOT NULL,                       -- what was scanned: SKU, SKU/BATCH, SKU#C (one carton)
  sku_code    VARCHAR(30)   NULL,
  batch_id    BIGINT        NULL,
  qty         INT           NOT NULL DEFAULT 0,             -- packs counted (0 for a refused scan)
  result      VARCHAR(12)   NOT NULL,                       -- ok | wrong_sku | wrong_batch | too_many | unknown
  message     VARCHAR(255)  NULL,
  emp_id      VARCHAR(20)   NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scan_id),
  KEY idx_scan_order (order_id),
  CONSTRAINT fk_scan_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_trips (
  trip_id         BIGINT        NOT NULL AUTO_INCREMENT,
  trip_date       DATE          NOT NULL,
  area_id         INT           NULL,
  vehicle_id      INT           NOT NULL,
  driver_id       INT           NOT NULL,
  status          VARCHAR(10)   NOT NULL DEFAULT 'planned',  -- planned | out | ended
  cash_expected   DECIMAL(12,2) NULL,                        -- pay-on-delivery amounts due when the trip started
  cash_collected  DECIMAL(12,2) NULL,
  cash_handed     DECIMAL(12,2) NULL,
  end_note        VARCHAR(255)  NULL,
  created_by      VARCHAR(20)   NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_by      VARCHAR(20)   NULL,
  started_at      DATETIME      NULL,
  ended_by        VARCHAR(20)   NULL,
  ended_at        DATETIME      NULL,
  PRIMARY KEY (trip_id),
  KEY idx_trip_status (status, trip_date),
  CONSTRAINT fk_trip_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (vehicle_id),
  CONSTRAINT fk_trip_driver FOREIGN KEY (driver_id) REFERENCES drivers (driver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_stops (
  stop_id         BIGINT        NOT NULL AUTO_INCREMENT,
  trip_id         BIGINT        NOT NULL,
  order_id        BIGINT        NOT NULL,
  seq             INT           NOT NULL,
  status          VARCHAR(10)   NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  otp             CHAR(4)       NULL,
  receiver_name   VARCHAR(120)  NULL,
  photo           MEDIUMBLOB    NULL,
  photo_type      VARCHAR(30)   NULL,
  failed_reason   VARCHAR(255)  NULL,
  cash_collected  DECIMAL(12,2) NOT NULL DEFAULT 0,
  done_by         VARCHAR(20)   NULL,
  done_at         DATETIME      NULL,
  PRIMARY KEY (stop_id),
  UNIQUE KEY uq_trip_order (trip_id, order_id),
  KEY idx_stop_order (order_id),
  CONSTRAINT fk_stop_trip FOREIGN KEY (trip_id) REFERENCES delivery_trips (trip_id),
  CONSTRAINT fk_stop_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- an example role for drivers: Delivery (My trips only); editable like the other default roles
INSERT IGNORE INTO roles (role_id, name, description, is_builtin, created_by) VALUES
  (7, 'Delivery', 'Drivers: My trips only - mark stops delivered or failed, record cash collected.', 0, 'system');
INSERT IGNORE INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_delete) VALUES
  (7, 'delivery', 1, 0, 1, 0, 0);
