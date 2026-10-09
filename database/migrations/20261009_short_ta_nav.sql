-- =====================================================================
-- Shorter Tamil header labels so the desktop nav fits inline at >= 1280px (the header still switches to the
-- menu button by measurement when it does not fit). nav_about "எங்களைப் பற்றி" and nav_contact "தொடர்பு"
-- already have the wanted text. Drafts for native review (open item 9); editable in the admin later.
-- Data only. Each UPDATE matches the seed value too, so a value already edited in the admin is never
-- overwritten and re-running is a no-op.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

UPDATE ui_text SET value = 'பொருட்கள்'
 WHERE text_key = 'nav_products' AND lang_code = 'ta' AND value = 'தயாரிப்புகள்';
UPDATE ui_text SET value = 'வணிகம்'
 WHERE text_key = 'nav_business' AND lang_code = 'ta' AND value = 'வணிகங்களுக்கு';
UPDATE ui_text SET value = 'வாங்க'
 WHERE text_key = 'nav_where' AND lang_code = 'ta' AND value = 'எங்கே வாங்குவது';
