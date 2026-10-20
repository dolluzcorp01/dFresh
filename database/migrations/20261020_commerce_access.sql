-- Commerce phase 1 (docs/COMMERCE-SPEC.md section 1): roles and permissions. Structure and reference defaults only.
-- Built-in roles (not editable; their rights are defined in src/shared/permissions.js, not in role_permissions):
--   1 Admin (everything), 2 Sub-admin (everything except Roles and users and Settings).
-- Default custom roles (editable, deletable when nobody has them): 3 Viewer (read only), 4 Operations, 5 Warehouse,
-- 6 Sales. Existing admin users keep their access: admin -> Admin, editor -> Sub-admin, viewer -> Viewer (read only).
-- admin_users.role (old ENUM) stays until every server reads role_id; a later migration drops it.
USE dfresh;

CREATE TABLE IF NOT EXISTS roles (
  role_id      INT          NOT NULL AUTO_INCREMENT,
  name         VARCHAR(60)  NOT NULL,
  description  VARCHAR(255) NULL,
  is_builtin   TINYINT(1)   NOT NULL DEFAULT 0,
  created_by   VARCHAR(20)  NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by   VARCHAR(20)  NULL,
  updated_at   DATETIME     NULL,
  PRIMARY KEY (role_id),
  UNIQUE KEY uq_role_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id      INT          NOT NULL,
  section      VARCHAR(30)  NOT NULL,
  can_view     TINYINT(1)   NOT NULL DEFAULT 0,
  can_create   TINYINT(1)   NOT NULL DEFAULT 0,
  can_edit     TINYINT(1)   NOT NULL DEFAULT 0,
  can_approve  TINYINT(1)   NOT NULL DEFAULT 0,
  can_delete   TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, section),
  CONSTRAINT fk_perm_role FOREIGN KEY (role_id) REFERENCES roles (role_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO roles (role_id, name, description, is_builtin, created_by) VALUES
  (1, 'Admin', 'Everything, in every section. Built in.', 1, 'system'),
  (2, 'Sub-admin', 'Everything except Roles and users and Settings. Built in.', 1, 'system'),
  (3, 'Viewer (read only)', 'Sees every section except Roles and users, Settings and the Audit log; changes nothing.', 0, 'system'),
  (4, 'Operations', 'Runs orders end to end: orders, packing, delivery, stock, returns, customers.', 0, 'system'),
  (5, 'Warehouse', 'Stock and packing in the godown.', 0, 'system'),
  (6, 'Sales', 'Leads, customers and orders.', 0, 'system');

-- (role_id, section, view, create, edit, approve, delete)
INSERT IGNORE INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_delete) VALUES
  (3, 'leads', 1, 0, 0, 0, 0), (3, 'orders', 1, 0, 0, 0, 0), (3, 'packing', 1, 0, 0, 0, 0), (3, 'delivery', 1, 0, 0, 0, 0),
  (3, 'inventory', 1, 0, 0, 0, 0), (3, 'returns', 1, 0, 0, 0, 0), (3, 'customers', 1, 0, 0, 0, 0), (3, 'promotions', 1, 0, 0, 0, 0),
  (3, 'products', 1, 0, 0, 0, 0), (3, 'reports', 1, 0, 0, 0, 0), (3, 'content', 1, 0, 0, 0, 0),
  (4, 'leads', 1, 0, 0, 0, 0), (4, 'orders', 1, 1, 1, 0, 0), (4, 'packing', 1, 1, 1, 0, 0), (4, 'delivery', 1, 1, 1, 0, 0),
  (4, 'inventory', 1, 1, 1, 0, 0), (4, 'returns', 1, 1, 1, 0, 0), (4, 'customers', 1, 1, 1, 0, 0), (4, 'reports', 1, 0, 0, 0, 0),
  (5, 'inventory', 1, 1, 1, 0, 0), (5, 'packing', 1, 1, 1, 0, 0),
  (6, 'leads', 1, 0, 1, 0, 0), (6, 'customers', 1, 1, 1, 0, 0), (6, 'orders', 1, 1, 1, 0, 0), (6, 'promotions', 1, 0, 0, 0, 0);

ALTER TABLE admin_users
  ADD COLUMN role_id INT NULL AFTER role,
  ADD KEY idx_admin_role (role_id),
  ADD CONSTRAINT fk_admin_role FOREIGN KEY (role_id) REFERENCES roles (role_id);

UPDATE admin_users SET role_id = CASE role WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END WHERE role_id IS NULL;
