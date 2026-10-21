-- Commerce phase 9 (docs/COMMERCE-SPEC.md 10): reports and the accounting export. No tables: the reports read the
-- order, invoice, stock, delivery, return and wallet tables. Settings only:
-- - place_of_supply_rule: B2B (billing GSTIN) = the state of that GSTIN, B2C = the shipping state (GST place of supply
--   for bill-to / ship-to); "To be confirmed by the accountant".
-- - slow_moving_days: a SKU with no sale for this many days is slow-moving (Reports > Stock).
USE dfresh;

INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('place_of_supply_rule', 'GST and compliance', 'Place of supply', 'B2B (the billing address has a GSTIN): the state of that GSTIN, even when shipped to another state. B2C: the shipping state. CGST + SGST only when the place of supply is the seller''s state, else IGST. To be confirmed by the accountant.',
   'gstin', 'select', '[["gstin","B2B: the billing GSTIN''s state; B2C: the shipping state"],["ship","Always the shipping state"]]', 1, 25),
  ('slow_moving_days', 'Inventory', 'Slow-moving after (days without a sale)', 'Reports > Stock lists the SKUs with stock and no sale for this many days.', '60', 'int', NULL, 0, 50);
UPDATE commerce_settings SET help = 'CSV journal (sales, receipts, credit notes) in Reports > Accounting export now; Tally and Zoho later. To be confirmed by sir.' WHERE setting_key = 'accounting_export';
