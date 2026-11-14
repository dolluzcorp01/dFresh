-- Stage 2, phase 24 / 01: Section 18 Website pages to the owner's field map (docs/claude-tasks/phase-24-field-map.md).
-- Everything the public site shows stays identical after this migration; only the owner's ticked rows add something.
-- a. Banners (rows 10, 11): show from / show until dates (India days, the banner starts and stops by itself) and a
--    photo description per language (the img alt; empty = as today, the photo is decorative).
-- b. Home doors (row 15): where each door goes, picked from the banner button list. Today's doors kept: For Home =
--    the products drawer with the "For Home" filter, For Business = the For Business section.
-- c. Form rules (rows 39 to 68): src/shared/rules.json moves here with the same values. Per form and field: the
--    order, type, list, longest text (read only: the database column), required (Admin edits; Phone locked on).
--    Spam limit (1 to 20 enquiries per 10 minutes) and most products in one quote in site_settings.
-- d. Where we deliver map (rows 70 to 75): one town list. The map fields move onto Masters > Delivery areas with its
--    "Show on map" tick; today's map towns are merged in: a town that is an area's name or in an area's town list
--    becomes that area (one area takes one town); a town in no area becomes a map-only area (not active for
--    delivery charges, so no order is priced differently). An area that was not on the map stays off it. Every name
--    (each language), pin, name position, base town, latitude, longitude and order is kept; then towns go.
-- e. Menu links (rows 76 to 80): the header, phone menu and footer links move from src/components/navLinks.js here.
--    One list in one order with a tick per menu, so each menu shows exactly what it shows today (the footer has
--    "Our range" and no Contact). Names stay the Translations texts (nav_*, f_range): one source.
-- f. Visit cards (rows 82 to 88): today's Office and Godown cards. Names and addresses stay the Translations texts
--    (c_office, c_office_a, c_godown, c_godown_a); the map search is today's (the default language's address);
--    phone and opening hours are new and empty (nothing new shows until filled).
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- a. banners
ALTER TABLE `banners`
  ADD COLUMN `show_from` date DEFAULT NULL AFTER `is_active`,
  ADD COLUMN `show_until` date DEFAULT NULL AFTER `show_from`;
ALTER TABLE `banner_translations`
  ADD COLUMN `alt_text` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `cta_label`;

-- ---------------------------------------------------------------- b. home doors
INSERT IGNORE INTO `site_settings` (`setting_key`, `setting_value`, `is_public`, `description`) VALUES
  ('door_home_action', 'products_home', 1, 'Home page, "For Home" door: what it opens (picked from the banner button list).'),
  ('door_home_target', '', 1, 'Home page, "For Home" door: the category, section or form it opens (when the action needs one).'),
  ('door_biz_action', 'section', 1, 'Home page, "For Business" door: what it opens (picked from the banner button list).'),
  ('door_biz_target', 'business', 1, 'Home page, "For Business" door: the category, section or form it opens (when the action needs one).');

-- ---------------------------------------------------------------- c. form rules
CREATE TABLE IF NOT EXISTS `form_fields` (
  `form_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL,
  `field_type` enum('text','email','tel','gst','select','pick','textarea') COLLATE utf8mb4_unicode_ci NOT NULL,
  `list_key` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_len` int DEFAULT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `locked` tinyint(1) NOT NULL DEFAULT '0',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`form_type`, `field_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `form_fields` (`form_type`, `field_name`, `sort_order`, `field_type`, `list_key`, `max_len`, `is_required`, `locked`) VALUES
  ('brochure', 'first_name', 1, 'text', NULL, 60, 1, 0),
  ('brochure', 'last_name', 2, 'text', NULL, 60, 1, 0),
  ('brochure', 'email', 3, 'email', NULL, 150, 1, 0),
  ('brochure', 'phone', 4, 'tel', NULL, 20, 1, 1),
  ('quote', 'full_name', 1, 'text', NULL, 120, 1, 0),
  ('quote', 'business_name', 2, 'text', NULL, 150, 1, 0),
  ('quote', 'business_type', 3, 'select', 'business_type', 80, 1, 0),
  ('quote', 'town', 4, 'text', NULL, 120, 1, 0),
  ('quote', 'phone', 5, 'tel', NULL, 20, 1, 1),
  ('quote', 'email', 6, 'email', NULL, 150, 1, 0),
  ('quote', 'products', 7, 'pick', NULL, NULL, 1, 0),
  ('quote', 'monthly_quantity', 8, 'text', NULL, 150, 0, 0),
  ('quote', 'message', 9, 'textarea', NULL, 2000, 0, 0),
  ('distributor', 'full_name', 1, 'text', NULL, 120, 1, 0),
  ('distributor', 'firm_name', 2, 'text', NULL, 150, 1, 0),
  ('distributor', 'gst_no', 3, 'gst', NULL, 15, 0, 0),
  ('distributor', 'areas', 4, 'text', NULL, 255, 1, 0),
  ('distributor', 'godown_vehicles', 5, 'select', 'yes_no', 80, 1, 0),
  ('distributor', 'brands', 6, 'text', NULL, 255, 0, 0),
  ('distributor', 'monthly_sales', 7, 'select', 'monthly_sales', 80, 1, 0),
  ('distributor', 'phone', 8, 'tel', NULL, 20, 1, 1),
  ('distributor', 'email', 9, 'email', NULL, 150, 1, 0),
  ('contact', 'full_name', 1, 'text', NULL, 120, 1, 0),
  ('contact', 'phone', 2, 'tel', NULL, 20, 1, 1),
  ('contact', 'email', 3, 'email', NULL, 150, 1, 0),
  ('contact', 'message', 4, 'textarea', NULL, 2000, 1, 0);
INSERT IGNORE INTO `site_settings` (`setting_key`, `setting_value`, `is_public`, `description`) VALUES
  ('lead_rate_max', '5', 0, 'Spam limit: at most this many enquiries from one visitor in 10 minutes (1 to 20). Website > Forms > Form rules.'),
  ('lead_max_products', '40', 1, 'Most products one quote may name. Website > Forms > Form rules.');

-- ---------------------------------------------------------------- d. one town list: the map on Delivery areas
ALTER TABLE `delivery_areas`
  ADD COLUMN `map_key` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `show_on_map`,
  ADD COLUMN `map_sort` int NOT NULL DEFAULT '0' AFTER `map_key`,
  ADD COLUMN `is_base` tinyint(1) NOT NULL DEFAULT '0' AFTER `map_sort`,
  ADD COLUMN `map_x` smallint DEFAULT NULL AFTER `is_base`,
  ADD COLUMN `map_y` smallint DEFAULT NULL AFTER `map_x`,
  ADD COLUMN `label_dx` smallint NOT NULL DEFAULT '0' AFTER `map_y`,
  ADD COLUMN `label_dy` smallint NOT NULL DEFAULT '-20' AFTER `label_dx`,
  ADD COLUMN `label_anchor` enum('start','middle','end') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'middle' AFTER `label_dy`,
  ADD COLUMN `lat` decimal(9,6) DEFAULT NULL AFTER `label_anchor`,
  ADD COLUMN `lng` decimal(9,6) DEFAULT NULL AFTER `lat`,
  ADD UNIQUE KEY `uq_area_map_key` (`map_key`);
CREATE TABLE IF NOT EXISTS `delivery_area_translations` (
  `area_id` int NOT NULL,
  `lang_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`area_id`, `lang_code`),
  KEY `fk_area_tr_lang` (`lang_code`),
  CONSTRAINT `fk_area_tr_area` FOREIGN KEY (`area_id`) REFERENCES `delivery_areas` (`area_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_area_tr_lang` FOREIGN KEY (`lang_code`) REFERENCES `languages` (`lang_code`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- which area each map town is: its default-language name is the area's label or one of the area's towns
DROP TEMPORARY TABLE IF EXISTS `tmp_town_area`;
CREATE TEMPORARY TABLE `tmp_town_area` (
  `town_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  `sort_order` int NOT NULL,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `area_id` int DEFAULT NULL
);
INSERT INTO `tmp_town_area` (`town_key`, `sort_order`, `name`, `area_id`)
SELECT t.`town_key`, t.`sort_order`, COALESCE(n.`name`, t.`town_key`),
  (SELECT MIN(a.`area_id`) FROM `delivery_areas` a
    WHERE LOWER(a.`label`) = LOWER(COALESCE(n.`name`, t.`town_key`))
       OR FIND_IN_SET(LOWER(COALESCE(n.`name`, t.`town_key`)), LOWER(REPLACE(a.`towns`, ', ', ','))) > 0)
  FROM `towns` t
  LEFT JOIN `town_translations` n ON n.`town_key` = t.`town_key`
   AND n.`lang_code` = (SELECT `lang_code` FROM `languages` WHERE `is_default` = 1 ORDER BY `sort_order` LIMIT 1);
-- one area takes one town: a later town (by its map order) matching the same area becomes its own map-only area
DROP TEMPORARY TABLE IF EXISTS `tmp_first`;
CREATE TEMPORARY TABLE `tmp_first` AS
  SELECT `area_id`, MIN(`sort_order`) AS `first_sort` FROM `tmp_town_area` WHERE `area_id` IS NOT NULL GROUP BY `area_id`;
UPDATE `tmp_town_area` x JOIN `tmp_first` f ON f.`area_id` = x.`area_id` SET x.`area_id` = NULL WHERE x.`sort_order` > f.`first_sort`;
-- areas that were not on today's map stay off it (today the map shows the towns list only)
UPDATE `delivery_areas` SET `show_on_map` = 0 WHERE `area_id` NOT IN (SELECT `area_id` FROM (SELECT `area_id` FROM `tmp_town_area` WHERE `area_id` IS NOT NULL) z);
-- a town in no area: a map-only area (inactive for delivery: charges and order matching do not change)
INSERT INTO `delivery_areas` (`label`, `godown_id`, `towns`, `charge`, `free_above`, `days`, `show_on_map`, `sort_order`, `is_active`)
SELECT x.`name`, NULL, x.`name`, 0, NULL, 'Mon,Tue,Wed,Thu,Fri,Sat', 1,
  (SELECT COALESCE(MAX(`sort_order`), 0) FROM `delivery_areas`) + x.`sort_order`, 0
  FROM `tmp_town_area` x WHERE x.`area_id` IS NULL ORDER BY x.`sort_order`;
UPDATE `tmp_town_area` x
  JOIN `delivery_areas` a ON a.`is_active` = 0 AND a.`label` = x.`name` AND a.`towns` = x.`name` AND a.`map_key` IS NULL
   SET x.`area_id` = a.`area_id` WHERE x.`area_id` IS NULL;
-- the map fields of each town onto its area (the key stays the town's key: the site's map is unchanged)
UPDATE `delivery_areas` a JOIN `tmp_town_area` x ON x.`area_id` = a.`area_id` JOIN `towns` t ON t.`town_key` = x.`town_key`
   SET a.`map_key` = t.`town_key`, a.`map_sort` = t.`sort_order`, a.`is_base` = t.`is_base`, a.`map_x` = t.`map_x`, a.`map_y` = t.`map_y`,
       a.`label_dx` = t.`label_dx`, a.`label_dy` = t.`label_dy`, a.`label_anchor` = t.`label_anchor`, a.`lat` = t.`lat`, a.`lng` = t.`lng`,
       a.`show_on_map` = t.`is_active`;
INSERT INTO `delivery_area_translations` (`area_id`, `lang_code`, `name`)
SELECT x.`area_id`, n.`lang_code`, n.`name` FROM `tmp_town_area` x JOIN `town_translations` n ON n.`town_key` = x.`town_key`;
DROP TEMPORARY TABLE IF EXISTS `tmp_first`;
DROP TEMPORARY TABLE IF EXISTS `tmp_town_area`;
DROP TABLE IF EXISTS `town_translations`;
DROP TABLE IF EXISTS `towns`;

-- ---------------------------------------------------------------- e. menu links
CREATE TABLE IF NOT EXISTS `menu_links` (
  `link_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `text_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_kind` enum('page','section') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `in_header` tinyint(1) NOT NULL DEFAULT '1',
  `in_phone` tinyint(1) NOT NULL DEFAULT '1',
  `in_footer` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`link_key`),
  KEY `fk_menu_text` (`text_key`),
  CONSTRAINT `fk_menu_text` FOREIGN KEY (`text_key`) REFERENCES `ui_text_keys` (`text_key`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `menu_links` (`link_key`, `text_key`, `target_kind`, `target`, `sort_order`, `in_header`, `in_phone`, `in_footer`, `is_active`) VALUES
  ('products', 'nav_products', 'page', 'products', 1, 1, 1, 1, 1),
  ('business', 'nav_business', 'section', 'business', 2, 1, 1, 1, 1),
  ('where', 'nav_where', 'section', 'where', 3, 1, 1, 1, 1),
  ('range', 'f_range', 'section', 'range', 4, 0, 0, 1, 1),
  ('about', 'nav_about', 'section', 'about', 5, 1, 1, 1, 1),
  ('contact', 'nav_contact', 'section', 'contact', 6, 1, 1, 0, 1);

-- ---------------------------------------------------------------- f. visit cards
CREATE TABLE IF NOT EXISTS `visit_cards` (
  `card_id` int NOT NULL AUTO_INCREMENT,
  `name_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hours_key` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `map_query` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `godown_id` int DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`card_id`),
  KEY `fk_vc_name` (`name_key`), KEY `fk_vc_addr` (`address_key`), KEY `fk_vc_hours` (`hours_key`),
  CONSTRAINT `fk_vc_name` FOREIGN KEY (`name_key`) REFERENCES `ui_text_keys` (`text_key`) ON UPDATE CASCADE,
  CONSTRAINT `fk_vc_addr` FOREIGN KEY (`address_key`) REFERENCES `ui_text_keys` (`text_key`) ON UPDATE CASCADE,
  CONSTRAINT `fk_vc_hours` FOREIGN KEY (`hours_key`) REFERENCES `ui_text_keys` (`text_key`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO `visit_cards` (`name_key`, `address_key`, `hours_key`, `map_query`, `phone`, `godown_id`, `sort_order`, `is_active`)
SELECT 'c_office', 'c_office_a', NULL,
  COALESCE((SELECT u.`value` FROM `ui_text` u WHERE u.`text_key` = 'c_office_a' AND u.`lang_code` = (SELECT `lang_code` FROM `languages` WHERE `is_default` = 1 ORDER BY `sort_order` LIMIT 1)), ''),
  NULL, NULL, 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `visit_cards`);
INSERT INTO `visit_cards` (`name_key`, `address_key`, `hours_key`, `map_query`, `phone`, `godown_id`, `sort_order`, `is_active`)
SELECT 'c_godown', 'c_godown_a', NULL,
  COALESCE((SELECT u.`value` FROM `ui_text` u WHERE u.`text_key` = 'c_godown_a' AND u.`lang_code` = (SELECT `lang_code` FROM `languages` WHERE `is_default` = 1 ORDER BY `sort_order` LIMIT 1)), ''),
  NULL, NULL, 2, 1 FROM DUAL WHERE (SELECT COUNT(*) FROM `visit_cards`) = 1;
-- the phone line's label on a card (shown only on a card with a phone)
INSERT IGNORE INTO `ui_text_keys` (`text_key`, `group_name`, `description`, `allows_html`, `max_chars`) VALUES
  ('c_phone_l', 'Contact details', 'Visit card: the label before a card''s phone number (Website > Brand and layout > Visit cards)', 0, 40);
INSERT IGNORE INTO `ui_text` (`text_key`, `lang_code`, `value`)
SELECT 'c_phone_l', l.`lang_code`, CASE l.`lang_code` WHEN 'ta' THEN 'தொலைபேசி' WHEN 'hi' THEN 'फ़ोन' ELSE 'Phone' END
  FROM `languages` l WHERE l.`lang_code` IN ('en', 'ta', 'hi');
