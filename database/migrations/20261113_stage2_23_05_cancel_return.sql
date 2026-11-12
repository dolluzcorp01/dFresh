-- Stage 2, phase 23 / 05: an order cancelled after dispatch brings its goods back as a return (v23 retFromCancel,
-- docs/COMMERCE-SPEC.md "the goods come back as a delivery-failed receipt ... when the goods are back").
-- Before: the packs went straight back to the Good shelf at the approval, while they were still on the vehicle.
-- Now (returns.fromCancel): a return "Collecting" with the packs that left (SKU and batch); Receive and Inspect at the
-- godown put them on the Returned / Damaged shelf as any return; it then closes with no refund, because the invoice
-- was already cancelled with a credit note. This reason marks those returns; it is not offered on the request form.
USE dfresh;
SET NAMES utf8mb4;

INSERT INTO `return_reasons` (`label`, `needs_photo`, `sort_order`, `is_active`)
SELECT 'Order cancelled after dispatch', 0, 100, 0 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `return_reasons` WHERE `label` = 'Order cancelled after dispatch');
