-- Commerce 01: Roles and permissions (docs/COMMERCE-SPEC.md section 1).
-- Built-in roles (rights in src/shared/permissions.js, not editable): 1 Admin (everything), 2 Sub-admin (everything except
-- Roles and users and Settings). Default custom roles (editable, deletable when nobody has them): 3 Viewer (read only),
-- 4 Operations, 5 Warehouse, 6 Sales, 7 Delivery (drivers: My trips).
-- admin_users: role_id (the existing users keep their access: admin -> Admin, editor -> Sub-admin, viewer -> Viewer)
-- and notify_email (staff notification mails; empty = the dAdmin e-mail). The old role column stays until no code reads it.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `roles` (
  `role_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_builtin` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `uq_role_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO roles (role_id, name, description, is_builtin, created_by, updated_by) VALUES
  (1, 'Admin', 'Everything, in every section. Built in.', 1, 'system', NULL),
  (2, 'Sub-admin', 'Everything except Roles and users and Settings. Built in.', 1, 'system', NULL),
  (3, 'Viewer (read only)', 'Sees every section except Roles and users, Settings and the Audit log; changes nothing.', 0, 'system', NULL),
  (4, 'Operations', 'Runs orders end to end: orders, packing, delivery, stock, returns, customers.', 0, 'system', NULL),
  (5, 'Warehouse', 'Stock and packing in the godown.', 0, 'system', NULL),
  (6, 'Sales', 'Leads, customers and orders.', 0, 'system', NULL),
  (7, 'Delivery', 'Drivers: My trips only - mark stops delivered or failed, record cash collected.', 0, 'system', NULL);

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` int NOT NULL,
  `section` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `can_view` tinyint(1) NOT NULL DEFAULT '0',
  `can_create` tinyint(1) NOT NULL DEFAULT '0',
  `can_edit` tinyint(1) NOT NULL DEFAULT '0',
  `can_approve` tinyint(1) NOT NULL DEFAULT '0',
  `can_delete` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`role_id`,`section`),
  CONSTRAINT `fk_perm_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_delete) VALUES
  (3, 'content', 1, 0, 0, 0, 0),
  (3, 'customers', 1, 0, 0, 0, 0),
  (3, 'delivery', 1, 0, 0, 0, 0),
  (3, 'inventory', 1, 0, 0, 0, 0),
  (3, 'leads', 1, 0, 0, 0, 0),
  (3, 'orders', 1, 0, 0, 0, 0),
  (3, 'packing', 1, 0, 0, 0, 0),
  (3, 'products', 1, 0, 0, 0, 0),
  (3, 'promotions', 1, 0, 0, 0, 0),
  (3, 'reports', 1, 0, 0, 0, 0),
  (3, 'returns', 1, 0, 0, 0, 0),
  (4, 'customers', 1, 1, 1, 0, 0),
  (4, 'delivery', 1, 1, 1, 0, 0),
  (4, 'inventory', 1, 1, 1, 0, 0),
  (4, 'leads', 1, 0, 0, 0, 0),
  (4, 'orders', 1, 1, 1, 0, 0),
  (4, 'packing', 1, 1, 1, 0, 0),
  (4, 'reports', 1, 0, 0, 0, 0),
  (4, 'returns', 1, 1, 1, 0, 0),
  (5, 'inventory', 1, 1, 1, 0, 0),
  (5, 'packing', 1, 1, 1, 0, 0),
  (5, 'returns', 1, 0, 0, 0, 0),
  (6, 'customers', 1, 1, 1, 0, 0),
  (6, 'leads', 1, 0, 1, 0, 0),
  (6, 'orders', 1, 1, 1, 0, 0),
  (6, 'promotions', 1, 0, 0, 0, 0),
  (7, 'delivery', 1, 0, 1, 0, 0);

-- live table
ALTER TABLE admin_users
  ADD COLUMN role_id INT NULL AFTER role,
  ADD COLUMN notify_email VARCHAR(150) NULL AFTER role_id,           -- staff notification mails; NULL = the dAdmin e-mail
  ADD KEY idx_admin_role (role_id),
  ADD CONSTRAINT fk_admin_role FOREIGN KEY (role_id) REFERENCES roles (role_id);

-- the existing users keep their access
UPDATE admin_users SET role_id = CASE role WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END WHERE role_id IS NULL;
