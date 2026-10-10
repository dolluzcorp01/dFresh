-- =====================================================================
-- About photo as its own setting (spec B9). Until now the About section showed the "about" banner's
-- desktop file and only while that banner was active, so switching the banner off removed the photo.
-- `about_image` = a path under /media (default: the same file); the banner can now be switched off on its own.
-- Empty value = no photo. INSERT IGNORE: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description) VALUES
  ('about_image', 'banners/desktop/dFresh_Banner_about_1920x800.webp', 1,
   'About section photo: path under /media (default the about banner desktop file); empty = no photo');
