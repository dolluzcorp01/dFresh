-- dFresh Commerce (DEMO branch `commerce`, database dfresh_commerce only - never live):
-- module 1, SKU and barcode. One SKU per product / colour version and pack size, made from the product id and its
-- pack text: DZIND-DF037 "Pack of 150 sheets" -> DF037-M150, rolls -> R<n>, other counts -> M<n>, Box / Packet -> BOX / PKT.
-- The barcode is the SKU itself, printed as Code 128 (admin Commerce > SKUs and labels).
USE dfresh_commerce;

CREATE TABLE IF NOT EXISTS skus (
  sku_code    VARCHAR(30)  NOT NULL,
  product_id  VARCHAR(30)  NOT NULL,
  size_label  VARCHAR(120) NOT NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sku_code),
  KEY idx_sku_product (product_id),
  CONSTRAINT fk_sku_product FOREIGN KEY (product_id) REFERENCES products (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO skus (sku_code, product_id, size_label)
SELECT CONCAT(REPLACE(REPLACE(p.product_id, 'DZIND-', ''), '-', ''), '-',
         CASE WHEN p.pack LIKE '%roll%' THEN CONCAT('R', REGEXP_SUBSTR(p.pack, '[0-9]+'))
              WHEN REGEXP_SUBSTR(p.pack, '[0-9]+') IS NOT NULL THEN CONCAT('M', REGEXP_SUBSTR(p.pack, '[0-9]+'))
              WHEN p.pack LIKE 'Packet%' THEN 'PKT'
              ELSE 'BOX' END),
       p.product_id, p.pack
  FROM products p;
