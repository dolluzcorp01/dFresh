-- Admin coverage, group A (docs/ADMIN_COVERAGE.md): pictures an admin can change in Settings.
-- share_image: the picture WhatsApp / Facebook show for a shared link (uploaded in Settings, 1200x630; the value is
--   the JPG's path under /media, a WebP is made next to it). Empty = the logo file, as before.
-- about_image: now uploaded in Settings too (the value stays a path under /media; the seeded banner path keeps working).
-- door_home_product / door_biz_product: the product whose first photo each home "door" shows (were fixed in code).
USE dfresh;

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description) VALUES
  ('share_image', '', 1, 'Share picture: what WhatsApp, Facebook and others show when someone shares a dFresh link. Upload a JPG or PNG of 1200 x 630 pixels (a larger picture of the same shape is resized). Empty = the dFresh logo.'),
  ('door_home_product', 'DZIND-DF028', 1, 'Home page, "For Home" door: the product whose first photo the door shows. Change the photo itself in Products.'),
  ('door_biz_product', 'DZIND-DF037', 1, 'Home page, "For Business" door: the product whose first photo the door shows. Change the photo itself in Products.');

UPDATE site_settings
   SET description = 'About section photo on the home page. Upload a JPG, PNG or WebP; it is cropped to 1920 x 800, so keep the products in the middle and right. Empty = no photo.'
 WHERE setting_key = 'about_image';
