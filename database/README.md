# dFresh database

| File | What |
|---|---|
| `01_schema.sql` | Creates database `dfresh` and all tables (fresh install only) |
| `02_seed.sql` | All launch content: 3 languages, 154 UI texts, 6 categories, 25 products + 3 colour variants, 84 images, 11 banners, 4 kits, 6 towns, form options, settings, 2 admin users |
| `migrations/` | Every later change, named `YYYYMMDD_short_name.sql`, applied in name order. `20261009_shell_ui_text.sql`: 9 UI keys for the site frame (EN + TA/HI drafts). `20261020_commerce_*`: roles and permissions, approvals, pricing (SKUs, price lists with effective dates, price history, product HSN / GST), sales (orders, payments, invoices, credit notes, stock reservations), Commerce settings, ship (packing, trips, couriers, delivery charges), stock (movements, batches, stock-ins, suppliers, write-offs, counts). `20261021_commerce_customers.sql`: customers, addresses, contacts, activity, follow-ups, tags, segments. `20261021_commerce_reports.sql`: report settings (place of supply rule, slow-moving days). `20261021_commerce_returns.sql`: returns, inspection, refunds, credit note lines, return pickups on trips. `20261021_commerce_wallet_promotions.sql`: coupons, offers, cashback rules, the wallet, order discount columns (structure and defaults only, commerce off). `20261022_commerce_notifications.sql`: notification settings, templates (EN / TA / HI), log, daily runs, customer language and opt-outs, order contact, staff notification e-mail, outbox attachments |
| `demo/` | Commerce DEMO only: sample data (SKUs, reorder levels; the interim tables are gone, every table is a migration now), applied by `node scripts/commerce-demo-seed.js`, which refuses any database except `dfresh_commerce`. Never on live |

Both files were executed and verified on MariaDB 10.11 (MySQL 8 compatible) before handover.

## Local setup
```bash
mysql -u root -p < database/01_schema.sql
mysql -u root -p --default-character-set=utf8mb4 < database/02_seed.sql
```
Always use `--default-character-set=utf8mb4` or Tamil / Hindi text turns into `????`.

Then apply every file in `migrations/` in name order (same `--default-character-set=utf8mb4`).

Or run `npm run db:reset`, which does all of it (local only, refuses when `NODE_ENV=production`).

Create an app user. Production MUST use this limited user, never root. Locally,
`npm run db:reset -- --create-app-user` runs the same steps (user from `APP_DB_USER` / `APP_DB_PASSWORD`,
`dadmin` grants only when that database and table exist):
```sql
CREATE USER 'dfresh_app'@'localhost' IDENTIFIED BY '<strong password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON dfresh.* TO 'dfresh_app'@'localhost';
-- dadmin.employee: only the columns dFresh reads (never bank details, Aadhaar, PAN or the rest of the row)
GRANT SELECT (emp_id, emp_first_name, emp_last_name, emp_mail_id, emp_profile_img, job_position, emp_department,
              account_pass, active, deleted_time) ON dadmin.employee TO 'dfresh_app'@'localhost';
GRANT SELECT ON dadmin.login_session_revoke TO 'dfresh_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON dadmin.login_otp TO 'dfresh_app'@'localhost';
GRANT SELECT ON dadmin.job_position_config TO 'dfresh_app'@'localhost';  -- Admin users: job title (optional)
GRANT SELECT ON dadmin.department_config TO 'dfresh_app'@'localhost';    -- Admin users: department (optional)
```

## Source of truth
Seed content was generated from `docs/reference/dFresh_Website_Product_List_v0.2.xlsx` and the approved
preview v3. Long dashes were converted to "-". After Phase 0, change content through the admin or the
Excel import, never by editing `02_seed.sql`.
