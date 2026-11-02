-- Stage 2, phase 12a / 02: shelves. stock_movements.stock_kind (and write_offs.stock_kind) becomes the shelf the packs
-- are on, as v23: good, hold (QC hold), dmg (damaged), ret (returned), rej (rejected, to go back to the supplier),
-- disp (disputed: short on a transfer). Today's kinds map as: good -> good, returned -> ret, damaged -> dmg, and
-- expired (returned packs found expired at inspection) -> ret: expiry is a state of the batch, not a shelf, so those
-- packs stay blocked by their batch's date (they never go back to Good, and are written off from the Returned shelf).
-- No quantity changes: the same movements, renamed (stock_count_lines and reservations count Good only).
USE dfresh;
SET NAMES utf8mb4;

UPDATE `stock_movements` SET `stock_kind` = CASE `stock_kind` WHEN 'returned' THEN 'ret' WHEN 'damaged' THEN 'dmg' WHEN 'expired' THEN 'ret' ELSE `stock_kind` END
 WHERE `stock_kind` IN ('returned', 'damaged', 'expired');
UPDATE `write_offs` SET `stock_kind` = CASE `stock_kind` WHEN 'returned' THEN 'ret' WHEN 'damaged' THEN 'dmg' WHEN 'expired' THEN 'ret' ELSE `stock_kind` END
 WHERE `stock_kind` IN ('returned', 'damaged', 'expired');

ALTER TABLE `stock_movements` MODIFY `stock_kind` enum('good','hold','dmg','ret','rej','disp') COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE `write_offs` MODIFY `stock_kind` enum('good','hold','dmg','ret','rej','disp') COLLATE utf8mb4_unicode_ci NOT NULL;
