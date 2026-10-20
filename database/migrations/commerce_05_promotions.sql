-- dFresh Commerce (DEMO, database dfresh_commerce only): module D, promotions. Coupons are in commerce_03_orders.sql
-- (WELCOME10, HOTEL500, FRESH5); here the cashback rule: when an order is Delivered, pct % of its value after the
-- coupon discount (before GST) goes to the customer's wallet (commerce.js advanceOrder). One rule, on / off.
-- The orders delivered before this rule existed get their cashback now (once).
USE dfresh_commerce;

CREATE TABLE IF NOT EXISTS cashback_rule (
  rule_id    TINYINT       NOT NULL,
  pct        DECIMAL(5,2)  NOT NULL,
  min_order  DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active  TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO cashback_rule (rule_id, pct, min_order, is_active) VALUES (1, 5, 0, 1);

INSERT INTO wallet_entries (customer_id, amount, reason, order_id, emp_id, created_at)
SELECT o.customer_id, ROUND((o.subtotal - o.discount) * 0.05, 2), CONCAT('Cashback 5% on ', o.order_no), o.order_id, o.emp_id, COALESCE(o.delivered_at, UTC_TIMESTAMP())
  FROM orders o
 WHERE o.status = 'delivered' AND o.subtotal - o.discount > 0
   AND NOT EXISTS (SELECT 1 FROM wallet_entries w WHERE w.order_id = o.order_id AND w.reason LIKE 'Cashback%');
