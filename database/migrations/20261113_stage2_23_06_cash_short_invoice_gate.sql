-- Stage 2, phase 23 / 06: two v23 rules the full regression found (decided by the owner on 2026-11-12).
-- a. Cash short at trip close (v23 9.7, rule cash_short, on, above Rs 0): cash handed in below the cash recorded,
--    plus what stops collected below what was due, goes to a second person; the trip waits in "Cash short,
--    waiting" (delivery_trips.status 'cashwait') until approved (then ended) or rejected (back on the road, count again).
--    trip_stops keeps what was due when the cash was taken and why it was less (stopCash).
-- b. No goods leave without an invoice (v23 10.1): starting a trip, handing to a courier or a customer pickup is
--    refused while the order has no invoice. The switch "Invoice made at the gate" (Delivery, off as delivered) lets
--    an Admin choose the earlier way: the invoice is made when the goods leave. Turning it on is a loosening.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- a. cash short
ALTER TABLE `trip_stops`
  ADD COLUMN `cash_due` decimal(12,2) DEFAULT NULL AFTER `cash_collected`,
  ADD COLUMN `cash_less_why` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `cash_due`;

INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`)
VALUES ('cash_short', 'Cash short at trip close', 'delivery', 1, 'Rs', 0.00, NULL, 0, 85);

-- ---------------------------------------------------------------- b. invoice at the gate
INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`, `sw_group`, `sw_unit`, `sw_example`, `sw_sort`)
VALUES ('invoice_at_gate', 'Delivery', 'Invoice made at the gate',
  'On: an order that leaves with no invoice gets one when the trip starts, the courier takes it or the customer picks it up. Off: the goods wait until someone makes the invoice (Money > Billing > Invoices).',
  '0', 'bool', NULL, 0, 25, 'Delivery', NULL,
  'Example: Off (as delivered): DFO-260033 is packed with no invoice; Start trip says "Make the invoice for DFO-260033 first". On: the trip starts and invoice DFI/26-27/0015 is made at the gate. Turning it on needs a second Admin.', 15);
