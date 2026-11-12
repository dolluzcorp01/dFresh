-- Stage 2, phase 23 / 04: Admin > Switches > Money "Credit sales allowed" (v23 credit_sales, on as delivered).
-- Off: no new order on credit (commerce.js), the order form offers no "On credit"; orders already on credit keep
-- their terms. Turning it on is a loosening (second-admin.js LOOSEN). INSERT IGNORE: safe to run again.
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`, `sw_group`, `sw_unit`, `sw_example`, `sw_sort`)
VALUES ('credit_sales', 'Orders', 'Credit sales allowed', 'Off: every customer pays on delivery or before. Orders already on credit keep their terms.',
  '1', 'bool', NULL, 0, 6, 'Money', NULL,
  'Example: On: a hotel with a Rs 50,000 credit limit takes goods now and pays in 30 days. Off: every customer pays before or on delivery; nobody gets credit.', 5);
