-- Commerce 02: Commerce settings and their lists (docs/COMMERCE-SPEC.md section 3).
-- commerce_settings: every value with its default, grouped as on the Commerce settings page; tbc = 1 marks the values
-- still "To be confirmed" (docs/SIR-DECISIONS.md). commerce_enabled = 0: Commerce stays OFF (menus hidden, its API
-- answers 404, no notification or job runs) until it is switched on at go-live (deploy/DEPLOY.md).
-- number_series: gap-free numbers per series and financial year (numbering.js). The lists: customer types, return
-- reasons, delivery methods (own vehicle / courier / customer pickup), delivery areas and charges, stock locations.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `commerce_settings` (
  `setting_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `grp` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `help` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `value` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `value_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `options` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tbc` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`setting_key`),
  KEY `idx_cs_group` (`grp`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('accounting_export', 'Accounting', 'Accounting export format', 'CSV journal (sales, receipts, credit notes) in Reports > Accounting export now; Tally and Zoho later. To be confirmed by sir.', 'csv', 'select', '[[\"csv\",\"CSV\"],[\"tally\",\"Tally (later)\"],[\"zoho\",\"Zoho Books (later)\"]]', 1, 10),
  ('approval_expiry_days', 'Approvals', 'A pending request expires after (days)', NULL, '7', 'int', NULL, 0, 20),
  ('approve_cancel_after_dispatch', 'Approvals', 'Cancelling an order after dispatch needs approval', NULL, '1', 'bool', NULL, 0, 60),
  ('approve_credit_order', 'Approvals', 'A new order for a customer over the credit limit or with overdue invoices needs approval', NULL, '1', 'bool', NULL, 0, 110),
  ('approve_credit_raise', 'Approvals', 'Raising a customer\'s credit limit needs approval', NULL, '1', 'bool', NULL, 0, 80),
  ('approve_discount_on', 'Approvals', 'Discounts on an order need approval', 'Offers + coupon + manual discount together, as a % of the goods value.', '1', 'bool', NULL, 0, 50),
  ('approve_discount_pct_above', 'Approvals', 'Total discount above (% of the goods value)', NULL, '10', 'decimal', NULL, 0, 51),
  ('approve_goodwill_credit', 'Approvals', 'Manual wallet credit or debit needs approval', NULL, '1', 'bool', NULL, 0, 70),
  ('approve_no_refund', 'Approvals', 'A \"No refund\" decision on a return needs approval', NULL, '1', 'bool', NULL, 0, 120),
  ('approve_over_available', 'Approvals', 'Ordering more than the available stock (override) needs approval', 'Only a role with \"approve\" on Orders can ask for the override; off = the override is saved at once.', '1', 'bool', NULL, 0, 100),
  ('approve_price_below_on', 'Approvals', 'A price below the price list needs approval', NULL, '1', 'bool', NULL, 0, 90),
  ('approve_price_below_pct', 'Approvals', 'Below the list by more than (%)', NULL, '5', 'decimal', NULL, 0, 91),
  ('approve_price_list', 'Approvals', 'A customer\'s own price list (not its type\'s) needs approval', NULL, '1', 'bool', NULL, 0, 130),
  ('approve_refund_above', 'Approvals', 'Refund above (Rs)', NULL, '2000', 'decimal', NULL, 0, 31),
  ('approve_refund_on', 'Approvals', 'Refunds need approval', NULL, '1', 'bool', NULL, 0, 30),
  ('approve_writeoff_on', 'Approvals', 'Stock write-offs need approval', NULL, '1', 'bool', NULL, 0, 40),
  ('approve_writeoff_qty_above', 'Approvals', 'or above (packs)', NULL, '20', 'int', NULL, 0, 42),
  ('approve_writeoff_value_above', 'Approvals', 'Write-off above (Rs value)', NULL, '1000', 'decimal', NULL, 0, 41),
  ('approver_role_ids', 'Approvals', 'Approver roles', 'Who may approve (they also need \"approve\" on the section). Nobody approves their own request.', '[1]', 'roles', NULL, 0, 10),
  ('cashback_credit_at', 'Promotions', 'Credit cashback', 'After the return window: a return never leaves extra cashback. On delivery: a later return takes it back.', 'after_window', 'select', '[[\"after_window\",\"once the return window has passed after delivery\"],[\"delivery\",\"on delivery\"]]', 0, 20),
  ('cashback_gst_treatment', 'GST and compliance', 'Cashback under GST', 'Discount (default): wallet credit from cashback or manual credit used on an order lowers its taxable value. Payment method: the wallet counts as a payment and the taxable value stays. A refund to the wallet is always a payment method. To be confirmed by sir with the accountant.', 'discount', 'select', '[[\"discount\",\"Discount on the next invoice\"],[\"payment\",\"Payment method\"]]', 1, 30),
  ('commerce_enabled', 'General', 'Commerce back office on', 'Off: the Commerce menus are hidden and their API answers 404. Turn on when sir approves the launch.', '0', 'bool', NULL, 0, 10),
  ('credit_note_prefix', 'Numbering', 'Credit note prefix', 'DFC/26-27/0001, per financial year.', 'DFC', 'text', NULL, 0, 20),
  ('customer_prefix', 'Numbering', 'Customer prefix', 'CUS-0001 (never DFC: that is the credit note series).', 'CUS', 'text', NULL, 0, 60),
  ('delivery_charge_gst_rate', 'Delivery', 'GST rate on delivery charges (%)', NULL, '18', 'decimal', NULL, 0, 10),
  ('delivery_otp', 'Delivery', 'Ask the customer for a delivery OTP', 'Off by default. On: each stop gets a 4-digit code when the trip starts (on the trip sheet until SMS / WhatsApp sending is chosen, Notifications); the driver types it to mark the stop delivered.', '0', 'bool', NULL, 0, 20),
  ('einvoice_mode', 'GST and compliance', 'E-invoicing (IRN / QR on B2B invoices)', 'Off = invoices are made here without an IRN. To be confirmed by sir (turnover limit).', 'off', 'select', '[[\"off\",\"Off - manual\"],[\"on\",\"On - generate IRN\"]]', 1, 10),
  ('eway_bill_above', 'GST and compliance', 'E-way bill needed above (Rs, invoice total)', 'Rs 50,000 is the usual GST limit.', '50000', 'decimal', NULL, 0, 40),
  ('eway_bill_required', 'GST and compliance', 'E-way bill number required for courier hand-over above the amount below', 'The number made on the portal is typed on the order before the courier takes it.', '1', 'bool', NULL, 0, 30),
  ('ewaybill_mode', 'GST and compliance', 'E-way bills', 'Off = made by hand on the portal. To be confirmed by sir.', 'off', 'select', '[[\"off\",\"Off - manual\"],[\"on\",\"On - generate from the admin\"]]', 1, 20),
  ('expiry_warn_days', 'Inventory', 'Near-expiry warning (days before the expiry date)', 'Batches expiring within these days are on the Near expiry list. Expired stock cannot be ordered.', '60', 'int', NULL, 0, 40),
  ('gst_rates', 'Orders and pricing', 'GST rates offered for a product (%)', 'Comma separated, e.g. 0, 5, 12, 18. A product can only have one of these.', '0, 5, 12, 18', 'text', NULL, 0, 50),
  ('invoice_bank_details', 'Invoice', 'Bank details printed on the invoice', 'Account name, number, IFSC. Empty = not printed.', '', 'text', NULL, 1, 50),
  ('invoice_issue_at', 'Invoice', 'Issue the tax invoice when', NULL, 'dispatch', 'select', '[[\"dispatch\",\"the order is dispatched\"],[\"confirm\",\"the order is confirmed\"]]', 0, 60),
  ('invoice_prefix', 'Numbering', 'Invoice prefix', 'Invoices are numbered per financial year: DFI/26-27/0001.', 'DFI', 'text', NULL, 0, 10),
  ('invoice_round_off', 'Invoice', 'Round the total to the rupee', 'Shown as a separate round-off line.', '1', 'bool', NULL, 0, 70),
  ('invoice_seller_address', 'Invoice', 'Seller address on the invoice', 'To be confirmed by sir.', 'Kanchipuram, Tamil Nadu', 'text', NULL, 1, 30),
  ('invoice_seller_gstin', 'Invoice', 'Seller GSTIN', 'While this is not a valid GSTIN, every invoice shows \"DEMO - not a tax invoice\". To be confirmed by sir.', 'TO-BE-CONFIRMED', 'text', NULL, 1, 20),
  ('invoice_seller_name', 'Invoice', 'Seller (legal entity) on the invoice', 'To be confirmed by sir.', 'Dolluz Corporation (OPC) Pvt Ltd', 'text', NULL, 1, 10),
  ('invoice_seller_state_code', 'Invoice', 'Seller state code', 'Tamil Nadu = 33. Same state as the buyer: CGST + SGST; another state: IGST.', '33', 'text', NULL, 0, 40),
  ('invoice_start_no', 'Numbering', 'First invoice number of a new financial year', NULL, '1', 'int', NULL, 0, 50),
  ('low_level_default', 'Inventory', 'Reorder level for a new SKU', 'Below it (available stock) the SKU is Low and on the Reorder list. Each SKU can have its own.', '20', 'int', NULL, 0, 20),
  ('manual_discount_allowed', 'Orders and pricing', 'Manual discount on an order allowed', 'Above the approval threshold it waits for approval.', '1', 'bool', NULL, 0, 30),
  ('notify_daily_hour', 'Notifications', 'Daily mails at (hour, India time)', 'Overdue reminders, wallet expiry, stock, follow-ups and the daily summary go out once a day from this hour (0 to 23).', '9', 'int', NULL, 0, 260),
  ('notify_email', 'Notifications', 'E-mail', 'Every notification below goes out by e-mail through the mail outbox (sender: Settings > mail_from). Off = no notification e-mail at all.', '1', 'bool', NULL, 0, 10),
  ('notify_ev_approval', 'Staff notifications', 'Approval waiting', 'To the users of the approver roles who may decide it (not the one who asked).', '1', 'bool', NULL, 0, 10),
  ('notify_ev_cash_difference', 'Staff notifications', 'Cash handover difference', 'When a trip ends with cash handed over different from cash collected. To the users who plan trips.', '1', 'bool', NULL, 0, 50),
  ('notify_ev_daily_summary', 'Staff notifications', 'Daily summary for Admin', 'Yesterday\'s orders, sales, payments, deliveries, returns and what waits. To the Admin users.', '1', 'bool', NULL, 0, 60),
  ('notify_ev_delivery_failed', 'Staff notifications', 'Failed delivery', 'To the users who plan trips (\"create\" on Delivery).', '1', 'bool', NULL, 0, 40),
  ('notify_ev_follow_ups', 'Staff notifications', 'Follow-ups due today (daily)', 'To each owner of follow-ups due today or overdue.', '1', 'bool', NULL, 0, 30),
  ('notify_ev_invoice', 'Notifications', 'Customer: invoice (PDF attached)', 'When the tax invoice is issued. To the contacts with \"gets invoices\" (else the customer\'s e-mail); an opt-out never stops it.', '1', 'bool', NULL, 0, 150),
  ('notify_ev_order_confirmed', 'Notifications', 'Customer: order confirmed', 'When an order is confirmed: at once, or when its last approval is given. An order waiting for approval sends nothing. To the order contact.', '1', 'bool', NULL, 0, 100),
  ('notify_ev_order_courier', 'Notifications', 'Customer: handed to the courier', 'With the AWB number and the tracking link. To the order contact.', '1', 'bool', NULL, 0, 130),
  ('notify_ev_order_delivered', 'Notifications', 'Customer: delivered', 'When the order is delivered (trip, courier or pickup at the godown). To the order contact.', '1', 'bool', NULL, 0, 140),
  ('notify_ev_order_out', 'Notifications', 'Customer: out for delivery', 'When the trip with the order starts (own vehicle). To the order contact.', '1', 'bool', NULL, 0, 120),
  ('notify_ev_order_packed', 'Notifications', 'Customer: order packed', 'When packing is done. To the order contact.', '1', 'bool', NULL, 0, 110),
  ('notify_ev_overdue', 'Notifications', 'Customer: overdue reminder (statement PDF attached)', 'Daily check: a customer with overdue invoices gets a reminder every N days, at most M times (below). To the invoice contacts; not to customers who opted out of reminders.', '1', 'bool', NULL, 0, 230),
  ('notify_ev_payment', 'Notifications', 'Customer: payment received (receipt)', 'Every payment recorded on an order, cash on delivery included. To the invoice contacts.', '1', 'bool', NULL, 0, 160),
  ('notify_ev_return_accepted', 'Notifications', 'Customer: return accepted', 'When a return is created inside the window, or approved outside it. To the order contact.', '1', 'bool', NULL, 0, 170),
  ('notify_ev_return_picked', 'Notifications', 'Customer: return picked up', 'When the driver picks the goods up, or they reach the godown (courier, brought in). To the order contact.', '1', 'bool', NULL, 0, 180),
  ('notify_ev_return_refunded', 'Notifications', 'Customer: refunded (credit note PDF attached)', 'When a refund is paid. To the invoice contacts.', '1', 'bool', NULL, 0, 190),
  ('notify_ev_stock_daily', 'Staff notifications', 'Low stock and near expiry (daily)', 'To the users with \"edit\" on Inventory, when something is low or near expiry.', '1', 'bool', NULL, 0, 20),
  ('notify_ev_wallet_credited', 'Notifications', 'Customer: wallet credited', 'Cashback and manual credits (a refund to the wallet is in the refund mail). To the customer\'s e-mail.', '1', 'bool', NULL, 0, 200),
  ('notify_ev_wallet_expiring', 'Notifications', 'Customer: wallet credit expiring', 'Once per credit, the number of days below before it expires (daily). A reminder: not to customers who opted out of reminders.', '1', 'bool', NULL, 0, 210),
  ('notify_overdue_every_days', 'Notifications', 'Overdue reminder: every N days', 'Days between two reminders to the same customer.', '7', 'int', NULL, 0, 240),
  ('notify_overdue_max', 'Notifications', 'Overdue reminder: at most M times', 'Reminders while invoices stay overdue; counted again once everything was paid.', '3', 'int', NULL, 0, 250),
  ('notify_sms', 'Notifications', 'SMS', 'Provider not set up: stays off until an SMS provider is chosen. To be confirmed by sir.', '0', 'bool', NULL, 1, 30),
  ('notify_wallet_expiry_days', 'Notifications', 'Wallet expiring: tell this many days before', 'Days before the expiry date.', '7', 'int', NULL, 0, 220),
  ('notify_whatsapp', 'Notifications', 'WhatsApp', 'Provider not set up: stays off until a WhatsApp provider is chosen. To be confirmed by sir.', '0', 'bool', NULL, 1, 20),
  ('offers_with_coupon', 'Promotions', 'Offers and a coupon can combine', 'Off: an order with an automatic offer (quantity slab, buy X get Y) cannot take a coupon.', '0', 'bool', NULL, 0, 10),
  ('order_min_value_default', 'Orders and pricing', 'Minimum order value (Rs), when the customer type has none', 'Customer types can set their own minimum (list below).', '0', 'decimal', NULL, 0, 20),
  ('order_prefix', 'Numbering', 'Order prefix', 'DFO-26nnnn, per calendar year.', 'DFO', 'text', NULL, 0, 30),
  ('order_sources', 'Orders and pricing', 'Order sources', 'Where an order came from, comma separated (New order and New customer offer these).', 'Phone, WhatsApp, Walk-in, Referral, B2B visit, Other', 'text', NULL, 0, 10),
  ('own_customers_only', 'Customers', 'Sales sees only their own customers and orders', 'On: the roles below see only the customers they own (Sales owner) and those customers\' orders.', '0', 'bool', NULL, 0, 10),
  ('own_customers_role_ids', 'Customers', 'Roles limited to their own customers', 'Used when the setting above is on.', '[6]', 'roles', NULL, 0, 20),
  ('payment_methods', 'Payments', 'Payment modes offered when recording a payment', 'Comma separated, from: Cash, UPI, Bank transfer, Cheque, Razorpay (manual). Credit is a payment term on the order, not a mode.', 'Cash, UPI, Bank transfer, Cheque, Razorpay (manual)', 'text', NULL, 0, 10),
  ('place_of_supply_rule', 'GST and compliance', 'Place of supply', 'B2B (the billing address has a GSTIN): the state of that GSTIN, even when shipped to another state. B2C: the shipping state. CGST + SGST only when the place of supply is the seller\'s state, else IGST. To be confirmed by the accountant.', 'gstin', 'select', '[[\"gstin\",\"B2B: the billing GSTIN\'s state; B2C: the shipping state\"],[\"ship\",\"Always the shipping state\"]]', 1, 25),
  ('prices_include_gst', 'Orders and pricing', 'Prices on the price lists', 'Shown on every price screen. Changing it does not convert the prices already entered: re-check them.', 'exclusive', 'select', '[[\"exclusive\",\"exclude GST (GST is added on the invoice)\"],[\"inclusive\",\"include GST (the invoice splits it out)\"]]', 0, 40),
  ('razorpay_payment_links', 'Payments', 'Razorpay payment links', 'Off = payments are entered by hand. To be confirmed by sir (needs a Razorpay account).', '0', 'bool', NULL, 1, 20),
  ('reorder_qty_default', 'Inventory', 'Reorder quantity for a new SKU', '0 = suggest from the reorder level (up to twice the level, in full cartons).', '0', 'int', NULL, 0, 30),
  ('return_outside_window', 'Returns', 'A return after the window', NULL, 'approval', 'select', '[[\"approval\",\"needs approval\"],[\"refuse\",\"is refused\"]]', 0, 20),
  ('return_prefix', 'Numbering', 'Return prefix', 'DFR-26nnnn, per calendar year.', 'DFR', 'text', NULL, 0, 40),
  ('return_window_days', 'Returns', 'Return window (days after delivery)', 'A later return needs approval or is refused (next setting).', '7', 'int', NULL, 0, 10),
  ('returned_resell', 'Returns', 'Returned stock can be sold again', 'Off: returned packs stay in Returned (R) stock until written off. On: a Recheck (with approval) moves them back to good stock.', '0', 'bool', NULL, 0, 30),
  ('slow_moving_days', 'Inventory', 'Slow-moving after (days without a sale)', 'Reports > Stock lists the SKUs with stock and no sale for this many days.', '60', 'int', NULL, 0, 50),
  ('stock_reserve_at', 'Inventory', 'Reserve stock when', 'Reserved stock is not available for other orders.', 'confirmed', 'select', '[[\"confirmed\",\"the order is confirmed\"],[\"packing\",\"packing starts\"]]', 0, 10),
  ('wallet_expiry_cashback_days', 'Promotions', 'Cashback in the wallet expires after (days)', '0 = never.', '365', 'int', NULL, 0, 40),
  ('wallet_expiry_manual_days', 'Promotions', 'Manual wallet credit expires after (days)', '0 = never.', '365', 'int', NULL, 0, 50),
  ('wallet_expiry_refund_days', 'Promotions', 'Refunds to the wallet expire after (days)', '0 = never (the customer\'s own money).', '0', 'int', NULL, 0, 60),
  ('wallet_max_use_pct', 'Promotions', 'Wallet use per order, at most (% of the order)', '100 = the whole order may be paid from the wallet.', '50', 'int', NULL, 0, 30);

CREATE TABLE IF NOT EXISTS `number_series` (
  `series_key` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,  -- e.g. DFO-26, DFI-2026-27
  `last_no` int NOT NULL,
  PRIMARY KEY (`series_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_types` (
  `type_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `min_order_value` decimal(10,2) NOT NULL DEFAULT '0.00',
  `default_credit_days` int NOT NULL DEFAULT '0',
  `default_credit_limit` decimal(12,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`type_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO customer_types (type_key, label, sort_order, min_order_value, default_credit_days, default_credit_limit, is_active) VALUES
  ('distributor', 'Distributor', 5, '0.00', 0, '0.00', 1),
  ('home', 'Home', 1, '0.00', 0, '0.00', 1),
  ('hospital', 'Hospital', 3, '0.00', 0, '0.00', 1),
  ('hotel', 'Hotel', 2, '0.00', 0, '0.00', 1),
  ('office', 'Office', 4, '0.00', 0, '0.00', 1);

CREATE TABLE IF NOT EXISTS `return_reasons` (
  `reason_id` int NOT NULL AUTO_INCREMENT,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `needs_photo` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`reason_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO return_reasons (reason_id, label, needs_photo, sort_order, is_active) VALUES
  (1, 'Wrong item', 0, 1, 1),
  (2, 'Damaged in transit', 1, 2, 1),
  (3, 'Quality issue', 1, 3, 1),
  (4, 'Ordered by mistake', 0, 4, 1),
  (5, 'Other', 0, 5, 1);

CREATE TABLE IF NOT EXISTS `delivery_methods` (
  `method_id` int NOT NULL AUTO_INCREMENT,
  `label` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'own',  -- own | courier | pickup
  `needs_tracking_no` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`method_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO delivery_methods (method_id, label, kind, needs_tracking_no, sort_order, is_active) VALUES
  (1, 'Own vehicle', 'own', 0, 1, 1),
  (2, 'Courier', 'courier', 1, 2, 1),
  (3, 'Pick-up at the godown', 'pickup', 0, 3, 1);

CREATE TABLE IF NOT EXISTS `delivery_areas` (
  `area_id` int NOT NULL AUTO_INCREMENT,
  `label` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `towns` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',  -- comma separated towns or pincodes
  `charge` decimal(10,2) NOT NULL DEFAULT '0.00',
  `free_above` decimal(10,2) DEFAULT NULL,  -- order value above which delivery is free; NULL = never free
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`area_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO delivery_areas (area_id, label, towns, charge, free_above, sort_order, is_active) VALUES
  (1, 'Kanchipuram town', 'Kanchipuram', '0.00', NULL, 1, 1);

CREATE TABLE IF NOT EXISTS `locations` (
  `location_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO locations (location_id, name, address, sort_order, is_active) VALUES
  (1, 'Kanchipuram godown', 'Kanchipuram, Tamil Nadu', 1, 1);
