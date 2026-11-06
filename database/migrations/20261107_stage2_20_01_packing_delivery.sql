-- Stage 2, phase 20 / 01: sections 8 and 9 Packing and delivery, to the v23 working file (docs/claude-tasks/phase-20).
-- 1. Stock goes down at Packed (D1): the scanned packs leave Good when the order is packed; dispatch no longer moves stock.
--    orders.stock_out_at records it. Orders packed but not yet dispatched today: their picked packs leave Good now, in the
--    batches picked for them, and their holds are used up, so nothing is lost or counted twice (free stock is unchanged:
--    those packs were held for them already).
-- 2. Part shipments: what is not packed (short or still owed) moves to a balance order linked to its parent
--    (orders.parent_id); each shipment has its own invoice and trip stop. Pick lists (DFK) group orders for one walk.
-- 3. Delivery: a stop keeps what the customer kept (short delivery) or refused; the packs not kept come back on the
--    Returned shelf through a closed return with its credit note (returns.collection 'delivery'). Order status 'refused'.
-- 4. Masters: vehicles (godown, capacity, insurance and fitness dates, notes), drivers (licence and its date), couriers
--    (phone, charge per kg and minimum), delivery areas (godown, days, shown on the website map: information only, the
--    live map stays on Website > Towns).
-- 5. The return reason "Not taken at delivery"; the message template "quote sent" (EN, TA, HI) and its switch.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. stock down at Packed
ALTER TABLE `orders`
  ADD COLUMN `stock_out_at` datetime DEFAULT NULL AFTER `packed_at`,
  ADD COLUMN `parent_id` bigint DEFAULT NULL AFTER `standing_id`,
  ADD COLUMN `pick_id` int DEFAULT NULL AFTER `parent_id`,
  ADD KEY `idx_order_parent` (`parent_id`);

-- dated when the order was packed (orders.packed_at is UTC; stock_movements.created_at is the server's local time, as its default)
INSERT INTO stock_movements (sku_code, location_id, stock_kind, move_type, delta, batch_id, unit_cost, ref_type, ref_id, note, emp_id, created_at)
SELECT pk.sku_code, o.godown_id, 'good', 'out', -pk.qty, pk.batch_id, COALESCE(s.avg_cost, s.std_cost), 'order', o.order_no,
       CONCAT('Packed ', o.order_no, ': stock leaves at Packed (phase 20)'), 'system',
       COALESCE(o.packed_at + INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, NOW())
  FROM orders o JOIN order_picks pk ON pk.order_id = o.order_id JOIN skus s ON s.sku_code = pk.sku_code
 WHERE o.status = 'packed' AND o.dispatched_at IS NULL AND pk.qty > 0
 ORDER BY o.order_id, pk.pick_id;
UPDATE stock_reservations r JOIN orders o ON o.order_id = r.order_id
   SET r.status = 'consumed', r.closed_at = UTC_TIMESTAMP()
 WHERE o.status = 'packed' AND o.dispatched_at IS NULL AND r.status = 'active';
UPDATE orders SET stock_out_at = COALESCE(packed_at, UTC_TIMESTAMP()) WHERE status = 'packed' AND dispatched_at IS NULL;
UPDATE orders SET stock_out_at = dispatched_at WHERE dispatched_at IS NOT NULL AND stock_out_at IS NULL;

-- ---------------------------------------------------------------- 2. pick lists
CREATE TABLE IF NOT EXISTS `pick_lists` (
  `pick_id` int NOT NULL AUTO_INCREMENT,
  `pick_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `packer` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pick_id`),
  UNIQUE KEY `uq_pick_no` (`pick_no`),
  CONSTRAINT `fk_pick_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO document_series (doc_key, label, prefix, fmt, per_godown, fy_reset, digits, max_len, gst, built, live, section_no, start_no, sort_order)
VALUES ('pick', 'Pick list', 'DFK', 'slash', 1, 1, 4, 20, 0, 0, 1, 8, 1, 115);

-- ---------------------------------------------------------------- 3. short and refused deliveries
ALTER TABLE `trip_stops`
  ADD COLUMN `kept_json` json DEFAULT NULL AFTER `failed_reason`,
  ADD COLUMN `return_back_id` bigint DEFAULT NULL AFTER `kept_json`;
ALTER TABLE `trip_stops` ADD COLUMN `signed` tinyint(1) NOT NULL DEFAULT '0' AFTER `receiver_name`; -- v23: signed the packing slip (proof of delivery)
ALTER TABLE `order_items` ADD COLUMN `short_why` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `free_why`;
-- v23: a pack scanned from a batch other than the oldest (or beyond the plan): the supervisor finishes the packing
ALTER TABLE `pack_scans` ADD COLUMN `off_plan` tinyint(1) NOT NULL DEFAULT '0' AFTER `emp_id`;
INSERT INTO return_reasons (label, sort_order, is_active)
SELECT 'Not taken at delivery', 99, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM return_reasons WHERE label = 'Not taken at delivery');

-- ---------------------------------------------------------------- 4. masters
ALTER TABLE `vehicles`
  ADD COLUMN `godown_id` int DEFAULT NULL AFTER `type`,
  ADD COLUMN `max_kg` decimal(8,1) DEFAULT NULL AFTER `godown_id`,
  ADD COLUMN `max_boxes` int DEFAULT NULL AFTER `max_kg`,
  ADD COLUMN `insurance_until` date DEFAULT NULL AFTER `max_boxes`,
  ADD COLUMN `fitness_until` date DEFAULT NULL AFTER `insurance_until`,
  ADD COLUMN `notes` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `fitness_until`;
ALTER TABLE `drivers`
  ADD COLUMN `licence_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `emp_id`,
  ADD COLUMN `licence_until` date DEFAULT NULL AFTER `licence_no`;
ALTER TABLE `couriers`
  ADD COLUMN `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `name`,
  ADD COLUMN `per_kg` decimal(8,2) DEFAULT NULL AFTER `tracking_url`,
  ADD COLUMN `min_charge` decimal(8,2) DEFAULT NULL AFTER `per_kg`;
ALTER TABLE `delivery_areas`
  ADD COLUMN `godown_id` int DEFAULT NULL AFTER `label`,
  ADD COLUMN `days` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat' AFTER `free_above`,
  ADD COLUMN `show_on_map` tinyint(1) NOT NULL DEFAULT '1' AFTER `days`;

-- ---------------------------------------------------------------- 5. the quote mail
INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('notify_ev_quote_sent', 'Customer notifications', 'Quote sent', 'The quotation as a PDF, to the customer or the enquiry.', '1', 'bool', NULL, 0, 15);
INSERT IGNORE INTO notification_templates (event_key, lang_code, subject, body) VALUES
  ('quote_sent', 'en', 'Quotation {quote_no} from dFresh', 'Dear {contact},\n\nPlease find our quotation {quote_no} for {customer}, valid until {valid_until}. Total: Rs {total}.\n\n{notes}\n\nThank you,\ndFresh'),
  ('quote_sent', 'ta', 'dFresh விலைப்புள்ளி {quote_no}', 'அன்புள்ள {contact},\n\n{customer} க்கான எங்கள் விலைப்புள்ளி {quote_no} இணைக்கப்பட்டுள்ளது. {valid_until} வரை செல்லும். மொத்தம்: Rs {total}.\n\n{notes}\n\nநன்றி,\ndFresh'),
  ('quote_sent', 'hi', 'dFresh कोटेशन {quote_no}', 'प्रिय {contact},\n\n{customer} के लिए हमारा कोटेशन {quote_no} संलग्न है, {valid_until} तक मान्य। कुल: Rs {total}.\n\n{notes}\n\nधन्यवाद,\ndFresh');
UPDATE notification_templates SET needs_review = 1 WHERE event_key = 'quote_sent' AND lang_code IN ('ta', 'hi');
-- phase 20: Customer ledger, Mail statement (the statement of account as a PDF, through the Outbox)
INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('notify_ev_statement', 'Customer notifications', 'Statement of account', 'The statement as a PDF, sent from the customer ledger.', '1', 'bool', NULL, 0, 16);
INSERT IGNORE INTO notification_templates (event_key, lang_code, subject, body) VALUES
  ('statement', 'en', 'Statement of account from dFresh', 'Dear {contact},\n\nPlease find the statement of account for {customer}. Outstanding today: Rs {outstanding}.\n\nPlease send the payment reference with every payment.\n\nThank you,\ndFresh'),
  ('statement', 'ta', 'dFresh கணக்கு அறிக்கை', 'அன்புள்ள {contact},\n\n{customer} க்கான கணக்கு அறிக்கை இணைக்கப்பட்டுள்ளது. இன்று நிலுவை: Rs {outstanding}.\n\nஒவ்வொரு கட்டணத்துடனும் கட்டண எண்ணை அனுப்பவும்.\n\nநன்றி,\ndFresh'),
  ('statement', 'hi', 'dFresh खाता विवरण', 'प्रिय {contact},\n\n{customer} का खाता विवरण संलग्न है। आज बकाया: Rs {outstanding}.\n\nकृपया हर भुगतान के साथ भुगतान संदर्भ भेजें।\n\nधन्यवाद,\ndFresh');
UPDATE notification_templates SET needs_review = 1 WHERE event_key = 'statement' AND lang_code IN ('ta', 'hi');
