-- About photo focus point: where the subject is in about_image (x% y% of the photo). The site keeps that point in the
-- middle of the cropped 5:4 About box (src/shared/photoFocus.js), so the products and the cup stay in view at every
-- width. Set it in Settings by clicking the about_image preview. Public: the site reads it.
USE dfresh;

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description)
VALUES ('about_image_focus', '70% 50%', 1, 'Where the subject is in the About photo (x% y%); set it by clicking the about_image preview.');
