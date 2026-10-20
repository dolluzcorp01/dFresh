-- dFresh Commerce (DEMO, database dfresh_commerce only): module B, returns on delivered orders. Number DFR-YYnnnn.
-- Each line is checked: OK -> Returned (R) stock, Damaged -> Damaged stock (stock_movements, move_type 'return').
-- Outcome: refund to wallet (wallet_entries), refund (demo, no money moves), or replacement (a new order at Rs 0).
-- Logic: src/backend_routes/commerce.js createReturn. Demo returns: scripts/commerce-seed.js.
USE dfresh_commerce;

CREATE TABLE IF NOT EXISTS return_counters (
  yr       SMALLINT NOT NULL,
  last_no  INT      NOT NULL,
  PRIMARY KEY (yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS returns (
  return_id     BIGINT        NOT NULL AUTO_INCREMENT,
  return_no     VARCHAR(20)   NOT NULL,
  order_id      BIGINT        NOT NULL,
  reason        VARCHAR(255)  NOT NULL,
  outcome       VARCHAR(20)   NOT NULL,              -- wallet | refund | replacement
  amount        DECIMAL(12,2) NOT NULL,              -- value of the returned goods incl. GST
  replacement_order_id BIGINT NULL,
  emp_id        VARCHAR(20)   NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (return_id),
  UNIQUE KEY uq_return_no (return_no),
  KEY idx_return_order (order_id),
  CONSTRAINT fk_return_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_items (
  return_id  BIGINT       NOT NULL,
  sku_code   VARCHAR(30)  NOT NULL,
  qty        INT          NOT NULL,
  item_check VARCHAR(10)  NOT NULL,                  -- ok | damaged
  PRIMARY KEY (return_id, sku_code, item_check),
  CONSTRAINT fk_ritem_return FOREIGN KEY (return_id) REFERENCES returns (return_id) ON DELETE CASCADE,
  CONSTRAINT fk_ritem_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
