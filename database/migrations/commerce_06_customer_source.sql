-- dFresh Commerce (DEMO, database dfresh_commerce only): customers added directly in the admin (phone / WhatsApp /
-- walk-in) get a business name and a source. Customers from a lead keep source NULL (their drawer shows the lead).
USE dfresh_commerce;

ALTER TABLE customers
  ADD COLUMN business_name VARCHAR(150) NULL AFTER name,
  ADD COLUMN source VARCHAR(20) NULL AFTER lead_id;
