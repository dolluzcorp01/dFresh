-- Stage 2, phase 13 / 02: the Numbering page and the Switches page (v23 Foundation).
-- document_series: one row per document (v23 D.series): prefix, format (slash DFI/26-27/0001, year DFO-260001,
--   plain CUS-0001), the godown code in the number (per_godown), restart each financial year (fy_reset), digits, the
--   longest number allowed (GST documents 16, or the width of the column the number is stored in), GST document,
--   built (already issued on stage2: its pattern is kept exactly), live (issued by today's code; the others are used
--   from the section named in section_no) and the first number of a new year for the un-coded run (start_no).
--   The counters stay in number_series, untouched: every running series issues exactly the numbers it issued before.
--   The six "Numbering" Commerce settings move here (their values are copied) and go; commerce-settings.js read()
--   still gives invoice_prefix, credit_note_prefix, order_prefix, return_prefix, customer_prefix and invoice_start_no,
--   read from this table, so every reader keeps working.
-- commerce_settings: switch metadata (sw_group = the group on the Switches page, NULL = not a switch, stays on Commerce
--   settings; sw_unit, sw_example, sw_sort). Keys and values do not change. The allowed min and max of each number
--   switch live with the loosening rules in src/backend_routes/second-admin.js (RANGE).
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `document_series` (
  `doc_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prefix` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fmt` enum('slash','year','plain') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'slash',
  `per_godown` tinyint(1) NOT NULL DEFAULT '0',
  `fy_reset` tinyint(1) NOT NULL DEFAULT '1',
  `digits` tinyint NOT NULL DEFAULT '4',
  `max_len` tinyint NOT NULL DEFAULT '16',
  `gst` tinyint(1) NOT NULL DEFAULT '0',
  `built` tinyint(1) NOT NULL DEFAULT '0',
  `live` tinyint(1) NOT NULL DEFAULT '0',
  `section_no` tinyint DEFAULT NULL,
  `start_no` int NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`doc_key`),
  UNIQUE KEY `uq_series_prefix` (`prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- the five running series keep today's prefixes (copied from the settings) and patterns
INSERT IGNORE INTO `document_series` (`doc_key`, `label`, `prefix`, `fmt`, `per_godown`, `fy_reset`, `digits`, `max_len`, `gst`, `built`, `live`, `section_no`, `start_no`, `sort_order`)
SELECT 'order', 'Order', COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'order_prefix'), 'DFO'), 'year', 0, 0, 4, 20, 0, 1, 1, 7, 1, 10
UNION ALL SELECT 'quote', 'Quote', 'DFQ', 'slash', 0, 1, 4, 20, 0, 0, 0, 7, 1, 20
UNION ALL SELECT 'invoice', 'Tax invoice', COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'invoice_prefix'), 'DFI'), 'slash', 1, 1, 4, 16, 1, 1, 1, 10,
  GREATEST(1, CAST(COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'invoice_start_no'), '1') AS UNSIGNED)), 30
UNION ALL SELECT 'credit', 'Credit note', COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'credit_note_prefix'), 'DFC'), 'slash', 1, 1, 4, 16, 1, 1, 1, 10, 1, 40
UNION ALL SELECT 'debit', 'Debit note', 'DFD', 'slash', 1, 1, 4, 16, 1, 0, 0, 10, 1, 50
UNION ALL SELECT 'challan', 'Delivery challan', 'DFT', 'slash', 1, 1, 4, 16, 1, 0, 0, 10, 1, 60
UNION ALL SELECT 'indent', 'Indent', 'DFN', 'slash', 1, 1, 4, 20, 0, 0, 0, 3, 1, 70
UNION ALL SELECT 'po', 'Purchase order', 'DFP', 'slash', 1, 1, 4, 20, 0, 0, 0, 3, 1, 80
UNION ALL SELECT 'grn', 'Goods in', 'DFG', 'slash', 1, 1, 4, 20, 0, 0, 0, 3, 1, 90
UNION ALL SELECT 'pbill', 'Supplier bill (our record)', 'DFB', 'slash', 0, 1, 4, 20, 0, 0, 0, 3, 1, 100
UNION ALL SELECT 'production', 'Production run', 'DFM', 'slash', 1, 1, 4, 20, 0, 0, 0, 4, 1, 110
UNION ALL SELECT 'receipt', 'Receipt', 'DFRC', 'slash', 0, 1, 4, 20, 0, 0, 0, 11, 1, 120
UNION ALL SELECT 'return', 'Return', COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'return_prefix'), 'DFR'), 'year', 0, 0, 4, 20, 0, 1, 1, 12, 1, 130
UNION ALL SELECT 'customer', 'Customer code', COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'customer_prefix'), 'CUS'), 'plain', 0, 0, 4, 12, 0, 1, 1, 6, 1, 140
UNION ALL SELECT 'supplier', 'Supplier code', 'SUP', 'plain', 0, 0, 4, 12, 0, 0, 0, 3, 1, 150;

DELETE FROM `commerce_settings` WHERE `setting_key` IN ('invoice_prefix', 'credit_note_prefix', 'order_prefix', 'return_prefix', 'invoice_start_no', 'customer_prefix');

-- the switches: same keys, same values; a group, a unit and an example each
ALTER TABLE `commerce_settings`
  ADD COLUMN `sw_group` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `sort_order`,
  ADD COLUMN `sw_unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `sw_group`,
  ADD COLUMN `sw_example` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `sw_unit`,
  ADD COLUMN `sw_sort` int NOT NULL DEFAULT '0' AFTER `sw_example`;

UPDATE `commerce_settings` s JOIN (
  SELECT 'commerce_enabled' AS k, 'Turn on' AS g, NULL AS u, 10 AS o, 'Example: while sir is still checking, this stays Off and staff see only the live admin as it is now. Turn it On, and Orders, Stock, Packing and the rest appear for the people whose role allows them.' AS e
  UNION ALL SELECT 'stock_reserve_at', 'Stock', NULL, 10, 'Example: "the order is confirmed": an order for 40 packs takes them out of free stock the moment it is confirmed, so nobody else can sell them.'
  UNION ALL SELECT 'expiry_warn_days', 'Stock', 'days', 20, 'Example: set to 60. A batch of wet wipes expiring on 31 December shows on the Near expiry list from 1 November.'
  UNION ALL SELECT 'slow_moving_days', 'Stock', 'days', 30, 'Example: set to 60. A SKU with stock and no sale since early September is listed as slow-moving in Reports > Stock.'
  UNION ALL SELECT 'manual_discount_allowed', 'Orders', NULL, 10, 'Example: On: the order screen has a discount box; a discount above the approval rule waits for approval. Off: no discount can be typed on an order.'
  UNION ALL SELECT 'order_min_value_default', 'Orders', 'Rs', 20, 'Example: set to 500. A shop order of Rs 420 cannot be confirmed until something is added. A customer type can set its own minimum.'
  UNION ALL SELECT 'offers_with_coupon', 'Orders', NULL, 30, 'Example: Off: an order that already gets a quantity slab offer cannot also take a coupon. On: both apply.'
  UNION ALL SELECT 'delivery_otp', 'Delivery', NULL, 10, 'Example: On: the driver asks the customer for the 4-digit code on the trip sheet before marking the stop delivered.'
  UNION ALL SELECT 'ewaybill_mode', 'Delivery', NULL, 20, 'Example: Off - manual: the e-way bill is made by hand on the GST portal and its number typed on the order.'
  UNION ALL SELECT 'eway_bill_required', 'Delivery', NULL, 30, 'Example: On: a courier order above the limit below cannot be handed over until its e-way bill number is typed.'
  UNION ALL SELECT 'eway_bill_above', 'Delivery', 'Rs', 40, 'Example: set to 50,000. An invoice of Rs 62,000 going by courier needs an e-way bill; one of Rs 40,000 does not.'
  UNION ALL SELECT 'einvoice_mode', 'Money', NULL, 10, 'Example: Off - manual: invoices are made here without an IRN. On (when the turnover needs it): every B2B invoice gets an IRN and QR code.'
  UNION ALL SELECT 'razorpay_payment_links', 'Money', NULL, 20, 'Example: Off: payments are typed in by hand when they arrive. On (needs a Razorpay account): a payment link can be sent with the invoice.'
  UNION ALL SELECT 'wallet_max_use_pct', 'Wallet', '%', 10, 'Example: set to 50. On a Rs 2,000 order at most Rs 1,000 comes from the wallet; the rest is paid.'
  UNION ALL SELECT 'cashback_credit_at', 'Wallet', NULL, 20, 'Example: "once the return window has passed": cashback on an order delivered on the 1st reaches the wallet after the return window, so a return never leaves extra cashback.'
  UNION ALL SELECT 'return_window_days', 'Returns', 'days', 10, 'Example: set to 7. Goods delivered on the 1st can be returned until the 8th. On the 9th a return needs approval or is refused (next switch).'
  UNION ALL SELECT 'return_outside_window', 'Returns', NULL, 20, 'Example: "needs approval": a return asked for on the 9th day goes to Approvals; "is refused": it cannot be made.'
  UNION ALL SELECT 'returned_resell', 'Returns', NULL, 30, 'Example: Off: returned packs stay on the Returned shelf until written off. On: a recheck (with approval) can move them back to good stock.'
  UNION ALL SELECT 'approval_expiry_days', 'Approvals', 'days', 10, 'Example: set to 7. A write-off request that nobody signs for 7 days goes back to the person who raised it, so nothing waits forever.'
  UNION ALL SELECT 'split_days', 'Approvals', 'days', 20, 'Example: set to 3. Three refunds of Rs 1,500 to one customer in 3 days count as Rs 4,500 against a Rs 2,000 refund limit.'
  UNION ALL SELECT 'notify_email', 'System', NULL, 10, 'Example: On: order, invoice and return messages go to the customer by e-mail through the mail outbox. Off: no notification e-mail at all.'
  UNION ALL SELECT 'notify_whatsapp', 'System', NULL, 20, 'Example: stays Off until a WhatsApp provider is chosen; messages are prepared but never sent.'
  UNION ALL SELECT 'notify_sms', 'System', NULL, 30, 'Example: stays Off until an SMS provider is chosen.'
) m ON m.k = s.`setting_key`
SET s.`sw_group` = m.g, s.`sw_unit` = m.u, s.`sw_example` = m.e, s.`sw_sort` = m.o;
