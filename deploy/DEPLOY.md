# dFresh - LIVE deployment runbook (dfresh.us)

Copy-paste steps for the first live deployment, then updates, rollback and backups. Run them in order. Every
command block says WHERE it runs: **[PC]** = Pavithran's Windows PC (PowerShell, in the repo folder), **[server]** =
an SSH session on the droplet. Lines starting with `#` are notes. `<...>` = fill in by hand; never paste a real
secret into a chat, ticket or this file. `<user>` = the Linux user that runs pm2 for the other dApps.

| Fact | Value |
|---|---|
| Server | DigitalOcean droplet `64.227.135.222`: 1 vCPU, 1 GB RAM, ~2.4 GB disk free, 14 other pm2 apps, nginx, certbot, MySQL |
| Node | system node **v18.19.1 stays** (the other apps); dFresh runs on its own **`/opt/node22/bin/node`** |
| Domain | `dfresh.us` (main) and `www.dfresh.us` (301 to the main one); DNS A records -> `64.227.135.222` |
| App folder | `/var/www/dfresh` (live) + `/var/www/dfresh.prev` (the release before, for rollback) |
| Uploads | `/var/www/dfresh-upload/` (release archives from the PC, last 2 kept) |
| Build | on the PC only (`npm run release:pack`); the server never builds and has no dev dependencies |
| Node process | pm2 `dfresh-api`, `127.0.0.1:4012`, ONE instance, `--interpreter /opt/node22/bin/node` |
| Database | MySQL `dfresh`, app user `dfresh_app` (least privilege), backup user `dfresh_backup` |
| Logs / backups | `/var/log/dfresh/` / `/var/backups/dfresh/<date>/` (7 days) + a copy off the droplet |

Request flow: browser -> nginx 443 -> `/static`, `/media` from disk; everything else -> node `127.0.0.1:4012`,
which answers `/api/dfresh/*`, `/admin`, `/sitemap.xml`, `/robots.txt` and every page with its SEO HTML.
Site and API are ONE origin. `private/` (brochures, Google key), `.env`, `build-ssr/` and the code are never served.

**Node 22 on the server, every time** (never change the system node, never `export PATH` for the whole session):
```bash
n22() { PATH=/opt/node22/bin:$PATH "$@"; }      # paste once per SSH session; it changes PATH for ONE command only
n22 /opt/node22/bin/npm -v                      # npm itself also runs on node 22 (its scripts call `node`)
```
`/opt/node22/bin/npm` alone starts with `#!/usr/bin/env node` and would run on the system node v18, so it is
always called through `n22`. pm2 commands are NOT run through `n22`: the pm2 daemon and the other 14 apps stay
on the system node; only `dfresh-api` gets node 22, through `--interpreter`.

## Disk use (expected)

| What | Size |
|---|---|
| Release archive (upload, gzip) | ~7 MB each (last 2 kept in `/var/www/dfresh-upload`) |
| Release unpacked (server code, React build, pre-rendered pages, fonts, migrations, media sources) | ~10 MB |
| `node_modules`, production only (`npm ci --omit=dev`) | ~120-130 MB |
| = one release folder | ~140 MB |
| `/var/www/dfresh.prev` (rollback copy) | ~140 MB |
| `media/` (images, script fonts, admin uploads) | ~8 MB at launch, grows with uploads |
| `private/` (brochure PDFs, font state) | < 20 MB |
| MySQL `dfresh` | ~10-20 MB |
| Backups, 7 days (database + media + brochures) | ~60-100 MB |
| **Steady total** | **~0.4 GB** (peak ~0.55 GB for a few minutes during an update) |

Kept small on purpose: no dev dependencies (no react-scripts / webpack / babel / eslint / jest), no source maps,
no npm cache left behind (`--cache` in /tmp, removed), the Sheets API package alone (not all of `googleapis`).

---

## 1. Pre-checks (change nothing yet) [server]

```bash
ssh <user>@64.227.135.222
n22() { PATH=/opt/node22/bin:$PATH "$@"; }

sudo ss -ltnp | grep -E ':4012\b'            # port 4012 free: no output
node -v                                      # v18.19.1 (system, stays)
/opt/node22/bin/node -v                      # v22.x (dFresh)
n22 /opt/node22/bin/npm -v                   # 10.x
pm2 -v; pm2 ls | head -20                    # pm2 present, the 14 apps online
df -h / /var/lib/mysql                       # >= 1 GB free (dFresh needs ~0.55 GB at peak)
free -m                                      # nothing builds here, so no swap is needed for dFresh

sudo mysql -e "SELECT VERSION(); SHOW DATABASES LIKE 'dfresh'; SHOW DATABASES LIKE 'dadmin';"
#   a version (local dev: MySQL 8.0.32), NO dfresh row, a dadmin row
sudo mysql -e "SELECT COUNT(*) AS cols_10 FROM information_schema.columns WHERE table_schema='dadmin' AND table_name='employee'
  AND column_name IN ('emp_id','emp_first_name','emp_last_name','emp_mail_id','emp_profile_img','job_position','emp_department','account_pass','active','deleted_time');"
sudo mysql -e "SHOW TABLES IN dadmin WHERE Tables_in_dadmin IN ('login_otp','login_session_revoke','job_position_config','department_config');"
#   cols_10 = 10; 4 tables (the two *_config tables are optional: job title / department in Admin users)
sudo mysql -e "SELECT emp_id, active, deleted_time IS NULL AS not_deleted, emp_mail_id <> '' AS has_mail FROM dadmin.employee WHERE emp_id IN ('DZIND002','DZIND148');"
#   both rows: 1 / 1 / 1 (the two seeded dFresh admins)

sudo nginx -t && nginx -v                    # healthy before we touch it
ls /etc/nginx/sites-enabled/                 # nothing for dfresh.us yet
certbot --version
dig +short dfresh.us; dig +short www.dfresh.us     # both 64.227.135.222
```
If anything is not as expected, stop and ask.

---

## 2. Build and pack on the PC [PC, PowerShell]

The local MySQL must be running (the build reads it: fallback texts, pre-rendered pages; on the server a page whose
content differs from the local copy is simply rendered again on its first request).
```powershell
cd C:\Users\91638\Desktop\Dolluzcorp\dFresh\dfresh
git switch main; git pull
git status                      # "nothing to commit, working tree clean" (the packer refuses otherwise)
npm ci                          # only when package-lock.json changed since the last time
npm run release:pack
```
What `release:pack` does (`scripts/release-pack.js`):
- production build with `REACT_APP_API` empty (same origin) and `GENERATE_SOURCEMAP=false`, then the pre-render;
- refuses if a source map, a `localhost` URL or the pre-rendered pages are wrong or missing;
- packs from git (`git archive`: Linux line endings, nothing untracked, never `.env`, `private/`, `media/`,
  `node_modules`, React sources, docs or tests) + `build/` + `build-ssr/` + `RELEASE.txt` (commit, time);
- writes `release\dfresh-<date>-<time UTC>-<commit>.tar.gz` and `.sha256`, and prints the size and the scp line.

Expected end of the output:
```
release   release\dfresh-YYYYMMDD-HHMM-xxxxxxxx.tar.gz
sha256    <64 hex>
size      6.6 MB packed, 9.7 MB unpacked, 238 files, 30 pre-rendered pages
```
Contents: `server.js`, `package.json`, `package-lock.json`, `.env.example`, `config/`, `src/backend_routes/`,
`src/shared/`, `fonts/`, `database/` (schema, seed, migrations), `deploy/`, `maintenance/`, `assets/` (image
sources for the first install), `scripts/media-*.js`, `build/`, `build-ssr/`, `RELEASE.txt`.

Check the checksum on the PC and upload both files:
```powershell
$f = Get-ChildItem release\*.tar.gz | Sort-Object LastWriteTime | Select-Object -Last 1
(Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower(); Get-Content "$($f.FullName).sha256"    # same hash
scp $f.FullName "$($f.FullName).sha256" <user>@64.227.135.222:/var/www/dfresh-upload/
```
(First time only: the folder must exist, step 3.1.)

---

## 3. First install: unpack and install [server]

3.1 Folders (once):
```bash
sudo mkdir -p /var/www/dfresh /var/www/dfresh-upload /var/log/dfresh /var/backups/dfresh /var/www/letsencrypt
sudo chown -R $USER: /var/www/dfresh /var/www/dfresh-upload /var/log/dfresh /var/backups/dfresh
```
Now upload from the PC (end of step 2), then:

3.2 Check, unpack, install production dependencies:
```bash
n22() { PATH=/opt/node22/bin:$PATH "$@"; }
cd /var/www/dfresh-upload
REL=$(ls -t dfresh-*.tar.gz | head -1); echo "$REL"
sha256sum -c "$REL.sha256"                                  # "<file>: OK" - stop if not
tar -xzf "$REL" -C /var/www/dfresh --no-same-owner --no-same-permissions --warning=no-unknown-keyword
cd /var/www/dfresh && cat RELEASE.txt                       # release, commit, build time, 30 pages
n22 /opt/node22/bin/npm ci --omit=dev --no-audit --no-fund --cache /tmp/dfresh-npm-cache && rm -rf /tmp/dfresh-npm-cache
du -sh node_modules                                          # ~120-130 MB
ls node_modules | grep -cE '^(react-scripts|webpack|eslint|jest|googleapis)$'   # 0
mkdir -p media private/brochures private/fonts && chmod 700 private private/brochures private/fonts
```
`--no-same-permissions` applies the server's umask (files 644, folders 755) whatever Windows wrote in the archive.

---

## 4. MySQL: database, users, migrations [server]

Everything as the MySQL admin (`sudo mysql`; if root has a password: `mysql -u root -p`). Always
`--default-character-set=utf8mb4`, or Tamil / Hindi turns into `????`. Always name the database (`dfresh`):
five migration files have no `USE` line.

```bash
cd /var/www/dfresh            # database/ (schema, seed, migrations) came with the release
# 4.1 schema (creates the dfresh database) and seed (launch content: 3 languages, 25 products + 3 colour versions,
#     categories, banners, kits, towns, form options, texts, settings, the 2 admin users DZIND002 / DZIND148;
#     NO leads, NO test data)
sudo mysql --default-character-set=utf8mb4 < database/01_schema.sql
sudo mysql --default-character-set=utf8mb4 dfresh < database/02_seed.sql

# 4.2 every migration, in name order (stops at the first error)
for f in $(ls database/migrations/*.sql | sort); do
  echo "== $f"; sudo mysql --default-character-set=utf8mb4 dfresh < "$f" || { echo "FAILED: $f"; break; }
done
```
The 37 migrations, in the order they must run (tick each; a later update applies only the new ones):

- [ ] `20261009_phase3_home_ui_text.sql`
- [ ] `20261009_phase4_products_ui_text.sql`
- [ ] `20261009_shell_ui_text.sql`
- [ ] `20261009_short_ta_nav.sql`
- [ ] `20261010_about_image.sql`
- [ ] `20261010_phase5_home_rest.sql`
- [ ] `20261010_phase6_forms_leads.sql`
- [ ] `20261010_phase6b_outbox_fk.sql`
- [ ] `20261010_phase6b_visitor_ack.sql`
- [ ] `20261012_card_photo_of.sql`
- [ ] `20261012_form_close_confirm.sql`
- [ ] `20261012_mail_logo_url.sql`
- [ ] `20261012_tissue_pickup_text.sql`
- [ ] `20261013_admin_images.sql`
- [ ] `20261013_all_banners_active.sql`
- [ ] `20261013_forms_staff_mail_text.sql`
- [ ] `20261013_seo_text.sql`
- [ ] `20261013_single_source_text.sql`
- [ ] `20261014_no_default_overrides.sql`
- [ ] `20261014_positions.sql`
- [ ] `20261015_banner_count.sql`
- [ ] `20261015_size_picker.sql`
- [ ] `20261016_about_focus.sql` - setting `about_image_focus` (About photo focus point)
- [ ] `20261016_lg_en_text.sql`
- [ ] `20261016_setting_hints.sql`
- [ ] `20261017_two_step_login.sql` - setting `two_step_login` = on (password + e-mailed code)
- [ ] `20261019_brochure_download.sql` - setting `brochure_download_enabled` = on, texts `bro_off`, `ma_bro_off`
- [ ] `20261019_site_indexing.sql` - setting `site_indexing` = **off** (soft launch: not indexed, see step 11)
- [ ] `20261019_times_to_utc.sql` - every stored time becomes UTC (shifts the existing rows once by this MySQL's
      default offset; a marker row makes a second run a no-op). On a NEW install it simply runs in order. On a
      database that is already LIVE: only with the app stopped, see "One-off: times to UTC" in step 12.
- [ ] `20261020_commerce_access.sql` - roles and their permissions (Admin, Sub-admin built in; Viewer, Operations,
      Warehouse, Sales); every admin user gets a role (admin -> Admin, editor -> Sub-admin, viewer -> Viewer)
- [ ] `20261020_commerce_approvals.sql` - the approvals table (empty)
- [ ] `20261020_commerce_pricing.sql` - products get `hsn_code` (4818) and `gst_rate` (18); tables `skus`, `sku_prices`
      (per list and effective date) and `price_changes` (history); no SKUs, no prices
- [ ] `20261020_commerce_sales.sql` - orders, order lines (tax snapshot), status history, stock reservations,
      payments, invoices and credit notes (numbers come from `number_series` per financial year); no orders
- [ ] `20261020_commerce_settings.sql` - Commerce settings with their defaults and lists; `commerce_enabled` = **off**
      (the commerce screens stay hidden until it is switched on)

- [ ] `20261020_commerce_ship.sql` - packing and delivery: SKU bin, delivery method kind, vehicles, drivers, couriers,
      order delivery fields (method, area, charge, AWB, e-way bill, cartons, weight), picks, pack scans, trips and stops,
      the example role Delivery; no trips
- [ ] `20261020_commerce_stock.sql` - inventory: stock movements, reorder levels, suppliers, batches (products get
      `track_batches`, on for wet wipes), stock-ins, write-offs, stock counts, SKU average cost; no stock
- [ ] `20261021_commerce_returns.sql` - returns and refunds: returns, return lines, photos, scans, history, refunds,
      credit note lines, return pickups as trip stops, payment status "part refunded", Warehouse may view returns; no returns

This exact sequence (schema, seed, 37 migrations) was run on an empty database on 21 Oct 2026 without an error.
`database/demo/` is never applied here: it is demo data for the `dfresh_commerce` copy only.

```bash
# 4.3 live settings that are not content (the LIVE lead sheet; everything else is edited in the admin)
sudo mysql dfresh -e "UPDATE site_settings SET setting_value = '1iv8X5AOv5VZ3KlZiRwYjX9-oc5LV16GuomGfDRDa1V4' WHERE setting_key = 'gsheet_spreadsheet_id';"

# 4.4 check: no leads, 25 products, 3 languages, the soft-launch switches
sudo mysql dfresh -e "SELECT (SELECT COUNT(*) FROM leads) leads, (SELECT COUNT(*) FROM products WHERE variant_of IS NULL AND is_active=1) products,
  (SELECT COUNT(*) FROM languages WHERE is_active=1) langs, (SELECT COUNT(*) FROM admin_users) admins;
  SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN
  ('site_indexing','two_step_login','brochure_download_enabled','gsheet_spreadsheet_id','lead_email','mail_from','public_email');"
#   expect 0 / 25 / 3 / 2; site_indexing off, two_step_login on, brochure_download_enabled on, the LIVE sheet id,
#   lead_email info@dolluzcorp.com, mail_from connect@dolluzcorp.com
```

4.5 The app user (least privilege) and the backup user. Make two strong passwords first and keep them for
step 5 / step 13 (they are not printed anywhere else):
```bash
openssl rand -base64 30 | tr -d '/+=' | cut -c1-32     # -> DFRESH_APP_PASSWORD   (fill by hand below)
openssl rand -base64 30 | tr -d '/+=' | cut -c1-32     # -> DFRESH_BACKUP_PASSWORD
sudo mysql
```
```sql
-- dfresh: data only (no CREATE / DROP / ALTER; migrations run as the MySQL admin)
CREATE USER 'dfresh_app'@'localhost' IDENTIFIED BY '<DFRESH_APP_PASSWORD>';
GRANT SELECT, INSERT, UPDATE, DELETE ON dfresh.* TO 'dfresh_app'@'localhost';
-- dAdmin, read only except the sign-in code table. dadmin.employee: ONLY the 10 columns dFresh reads (never bank
-- details, Aadhaar, PAN or the rest of the row). account_pass = the bcrypt hash, needed to check the password.
GRANT SELECT (emp_id, emp_first_name, emp_last_name, emp_mail_id, emp_profile_img, job_position, emp_department,
              account_pass, active, deleted_time) ON dadmin.employee TO 'dfresh_app'@'localhost';
GRANT SELECT ON dadmin.login_session_revoke TO 'dfresh_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON dadmin.login_otp TO 'dfresh_app'@'localhost';
GRANT SELECT ON dadmin.job_position_config TO 'dfresh_app'@'localhost';   -- optional (skip if 1.4 had no such table)
GRANT SELECT ON dadmin.department_config TO 'dfresh_app'@'localhost';     -- optional
-- nightly dump (step 13)
CREATE USER 'dfresh_backup'@'localhost' IDENTIFIED BY '<DFRESH_BACKUP_PASSWORD>';
GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER ON dfresh.* TO 'dfresh_backup'@'localhost';
EXIT;
```
These grants were proven on 19 Oct 2026 with every query dFresh runs (sign-in, session, revoke check, code row,
Admin users, picker): all allowed; `SELECT *` on dadmin.employee and any other dAdmin table: denied.
```bash
mysql -u dfresh_app -p -h localhost dfresh -e "SELECT COUNT(*) FROM products;"    # asks the password; expect 28
```
If that login fails over TCP while the socket works, the server matches `127.0.0.1` separately: repeat the
CREATE USER / GRANT lines for `'dfresh_app'@'127.0.0.1'` (same password).

Optional (Pavithran, dAdmin screens only; sign-in does not need it):
```sql
INSERT INTO dadmin.login_app_config (app_key, rotate_seconds, two_factor_enabled, trust_days, panel_stats, edited_by)
VALUES ('dFresh', 3, 1, 14, NULL, '<emp_id>');
INSERT INTO dadmin.app_visibility (app_name, mode, updated_by, maintenance) VALUES ('dFresh', 'employees', '<emp_id>', 0);
```

---

## 5. Production `.env` [server]

```bash
cd /var/www/dfresh
cp .env.example .env && chmod 600 .env && nano .env
```
Make it exactly this (delete every other line; `<fill by hand>` = type the secret, never copy it anywhere else):
```ini
# --- server ---
PORT=4012
NODE_ENV=production
PUBLIC_SITE_URL=https://dfresh.us
PUBLIC_API_URL=https://dfresh.us
# --- database ---
DB_HOST=localhost
DB_USER=dfresh_app
DB_PASSWORD=<fill by hand: DFRESH_APP_PASSWORD from 4.5>
DB_NAME=dfresh
DADMIN_DB_NAME=dadmin
# --- auth: dFresh's own secret (it never reads a dAdmin token). Make it with: openssl rand -hex 48 ---
JWT_SECRET=<fill by hand: new random, 96 hex characters>
ADMIN_APP_KEY=dFresh
ADMIN_COOKIE_NAME=dfresh_admin_token
# --- mail: the sender is admin Settings mail_from, not here. NO MAIL_TEST_TO line on the server. ---
SENDGRID_API_KEY=<fill by hand: production key, Mail Send (full) + Sender Authentication (read)>
MAIL_ENABLED=true
# --- LIVE Google Sheet (the id is admin Settings gsheet_spreadsheet_id, set in 4.3) ---
GSHEET_ENABLED=true
GOOGLE_SERVICE_ACCOUNT_JSON=./private/google-service-account.json
# --- security ---
IP_HASH_SALT=<fill by hand: openssl rand -hex 32>
BROCHURE_TOKEN_TTL_MIN=15
LEAD_RATE_LIMIT_PER_10MIN=5
```
| Key | Live value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Secure + httpOnly + SameSite=Strict admin cookies (auth.js), serves the build, refuses non-https URLs |
| `PORT` | `4012` | nginx proxies to it (step 1: free) |
| `PUBLIC_SITE_URL` / `PUBLIC_API_URL` | `https://dfresh.us` both | canonical, hreflang, sitemap, CORS, e-mail links; the API will not start with http or localhost |
| `DB_*` | `dfresh_app` + its password | never root |
| `JWT_SECRET` | NEW random | signs the admin session; changing it later signs every admin out |
| `SENDGRID_API_KEY` | production key | Sender Authentication read = Settings can check `mail_from` before saving |
| `MAIL_ENABLED` | `true` | real e-mail |
| `MAIL_TEST_TO` | **absent** | would send every mail to one test inbox |
| `GSHEET_ENABLED` | `true` | leads to the LIVE sheet |
| `IP_HASH_SALT` | NEW random | not the dev value |
| `SEO_NOINDEX`, `SERVE_BUILD`, `DB_ADMIN_*`, `APP_DB_*`, `REACT_APP_API` | **absent** | indexing is the admin switch `site_indexing` (step 11); the React build is made on the PC (step 2); the rest is local only |

Check without printing a secret:
```bash
sed -E 's/^([A-Z_]+)=.+$/\1=<set>/' .env                        # every key, values hidden
grep -c '^MAIL_TEST_TO' .env                                     # 0
grep -E '^(NODE_ENV|MAIL_ENABLED|GSHEET_ENABLED|PUBLIC_SITE_URL)=' .env
ls -l .env                                                       # -rw------- (600)
```

---

## 6. Google key, media, permissions

6.1 Google service account key (the same key as local; git-ignored, never in a release). **[PC]**:
```powershell
scp C:\Users\91638\Desktop\Dolluzcorp\dFresh\dfresh\private\google-service-account.json <user>@64.227.135.222:/var/www/dfresh/private/
```
**[server]**:
```bash
cd /var/www/dfresh
chmod 600 private/google-service-account.json
grep -o '"client_email": *"[^"]*"' private/google-service-account.json
```
Share the LIVE sheet (`1iv8X5AOv5VZ3KlZiRwYjX9-oc5LV16GuomGfDRDa1V4`) with that `client_email` as **Editor**.
Its tabs and row-1 headers must match `src/backend_routes/gsheet.js` (Quote, Sample, Distributor, Contact, Brochure).

6.2 Public images, once (from `assets/` in the release; needs the database and `.env`) **[server]**:
```bash
n22() { PATH=/opt/node22/bin:$PATH "$@"; }
cd /var/www/dfresh
n22 /opt/node22/bin/npm run media:sync            # "copied ... files" x4, then the sizes per image
du -sh media                                       # ~5-8 MB
```
6.3 Permissions:
```bash
cd /var/www/dfresh
chmod 600 .env private/google-service-account.json
chmod 700 private private/brochures private/fonts    # node only; nginx never serves private/
find media maintenance build -type d -exec chmod 755 {} + && find media maintenance build -type f -exec chmod 644 {} +
ls -ld private media maintenance build               # owner = the pm2 user; nginx (www-data) READS media, maintenance, build
```
- `media/` = public images and every admin upload (product photos, banners, share / About picture, script fonts).
- `private/brochures/` = brochure PDFs, uploaded in the admin after launch (step 10).
- `media/` and `private/` are NOT in a release: an update moves them (and `.env`) to the new folder (step 12).

---

## 7. nginx + https [server]

7.1 Plain http first (no certificate exists yet):
```bash
cd /var/www/dfresh
sudo cp deploy/nginx/dfresh-http-only.conf /etc/nginx/sites-available/dfresh.us.conf
sudo ln -s /etc/nginx/sites-available/dfresh.us.conf /etc/nginx/sites-enabled/dfresh.us.conf
sudo nginx -t && sudo systemctl reload nginx
```
7.2 Certificate for both names (renewals then run by certbot's timer, nginx reloaded after each):
```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt -d dfresh.us -d www.dfresh.us \
     --deploy-hook "systemctl reload nginx"
sudo ls /etc/letsencrypt/live/dfresh.us/              # fullchain.pem, privkey.pem
```
7.3 The final config (`deploy/nginx/dfresh.conf`): http -> https, www -> dfresh.us, `/static` cached a year,
`/media` 30 days, `/media/mail` a year, gzip, security headers, 10 MB uploads, everything else (API, `/admin`,
pages, sitemap, robots) -> node 4012, and dFresh's own maintenance page (step 12):
```bash
sudo cp deploy/nginx/dfresh.conf /etc/nginx/sites-available/dfresh.us.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run                          # "Congratulations, all simulated renewals succeeded"
```
Until step 8 starts node, every page shows the maintenance page (node not there = 503 + the page).
If `nginx -t` warns that `listen ... http2` is deprecated (nginx 1.25.1+): harmless; to silence it, write
`listen 443 ssl;` + `http2 on;` like the other dApps' configs.

---

## 8. pm2 [server]

```bash
cd /var/www/dfresh
pm2 start deploy/ecosystem.config.js --interpreter /opt/node22/bin/node    # name dfresh-api, ONE instance
pm2 describe dfresh-api | grep -iE 'interpreter |status|exec cwd'          # /opt/node22/bin/node, online, /var/www/dfresh
pm2 logs dfresh-api --lines 60 --nostream
#   expect: "dFresh API listening on http://localhost:4012", [fonts] lines, outbox worker lines;
#   no "refuses to start", no "pre-rendering off", no DB / Google errors
curl -s http://127.0.0.1:4012/api/dfresh/health      # "db":"ok", products 25, variants 3, languages 3
node -v                                              # still v18.19.1 (system node untouched)
pm2 save                                             # dfresh-api (with its interpreter) in the saved list

systemctl list-unit-files | grep -i pm2              # pm2-<user>.service ... enabled (set up for the other apps)
#   none: `pm2 startup`, run the sudo line it prints, `pm2 save` again
```
A real reboot test restarts the other 14 apps too: only in a quiet window (`sudo reboot`, then `pm2 ls` shows
dfresh-api online and the health line works). Never a second copy (`-i 2`, cluster): every e-mail would go twice.

---

## 9. Post-deploy checks (soft launch: the site is up but NOT indexed)

**[PC or server]**, every line must pass:
```bash
curl -s https://dfresh.us/api/dfresh/health                                    # "db":"ok", products 25
curl -sI http://dfresh.us/en       | grep -iE '^(HTTP|location)'                # 301 -> https://dfresh.us/en
curl -sI https://www.dfresh.us/en  | grep -iE '^(HTTP|location)'                # 301 -> https://dfresh.us/en
curl -sI http://www.dfresh.us/     | grep -iE '^(HTTP|location)'                # 301 -> https://dfresh.us/
for p in /en /ta /hi /en/products /ta/products /hi/privacy; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://dfresh.us$p)"; done   # all 200
curl -s https://dfresh.us/ta | grep -o '<html[^>]*>'                            # lang="ta-IN"
curl -sI https://dfresh.us/static/js/$(curl -s https://dfresh.us/en | grep -o 'main\.[0-9a-f]*\.js' | head -1) | grep -i cache-control   # immutable
# soft launch = not indexed (site_indexing off):
curl -s https://dfresh.us/robots.txt                                           # User-agent: * / Disallow: /
curl -s -o /dev/null -w '%{http_code}\n' https://dfresh.us/sitemap.xml          # 404
curl -s https://dfresh.us/en | grep -o '<meta name="robots"[^>]*>'             # noindex, nofollow
curl -sI https://dfresh.us/en | grep -i x-robots-tag                           # noindex, nofollow
# fonts (Tamil / Hindi script fonts are built by the server into media/fonts):
f=$(curl -s https://dfresh.us/ta | grep -o '/media/fonts/[^")]*\.woff2' | head -1); echo "$f"; curl -sI "https://dfresh.us$f" | grep -iE '^(HTTP|content-type)'   # 200 font/woff2
# nothing private is reachable:
for p in /.env /private/google-service-account.json /build-ssr/ssr.js /package.json; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://dfresh.us$p)"; done   # all 404
```
In a browser (phone and PC):
- [ ] `/en`, `/ta`, `/hi` look right (Tamil / Hindi fonts, banners, products, About photo); open the products page
      and a category; open a product card.
- [ ] Admin `https://dfresh.us/admin`: sign in with a real dAdmin account, password then the e-mailed code
      (it arrives at the person's real dAdmin e-mail). DevTools -> Application -> Cookies: `dfresh_admin_token`
      Secure, HttpOnly, SameSite Strict.
- [ ] Admin -> Settings: `mail_from` Save (SendGrid check), `gsheet_spreadsheet_id` -> "Test connection" (LIVE sheet
      title and tabs), mail logo "Send test mail" (goes to the signed-in admin).
- [ ] One real test lead from the live site on a phone (Contact form; name "TEST", your own e-mail): admin Leads
      shows it; the staff alert reaches `lead_email` (info@dolluzcorp.com); the visitor confirmation reaches you;
      a row appears in the LIVE sheet (Contact tab). Then delete it as in step 11.3.
- [ ] Brochure button: with no PDF uploaded yet the form says the brochure is being finalised (step 10 uploads it).
- [ ] `cat /var/www/dfresh/RELEASE.txt` = the release you uploaded (commit, build time).
- [ ] Maintenance page: `touch /var/www/dfresh/MAINTENANCE` -> `/en` shows the black / gold dFresh page, title
      "dFresh - Back shortly" (`curl -sI https://dfresh.us/en` -> 503 + `retry-after: 300`), `/admin` still opens;
      `rm /var/www/dfresh/MAINTENANCE` -> site back.

---

## 10. After launch, in the admin (https://dfresh.us/admin)

- [ ] **Brochures**: upload the EN PDF (<= 5 MB). TA / HI optional (visitors fall back to EN). Live at once.
- [ ] **Settings > Company**: `gstin` when Dolluz confirms it (format checked), `cin`, `company_name`.
- [ ] **Settings > Contact**: `public_email`, `office_phone`, `whatsapp_display` (the wa.me number follows).
- [ ] **Translations > Contact details**: office and godown names and addresses (`c_office`, `c_office_a`,
      `c_godown`, `c_godown_a`) in EN / TA / HI: footer, contact section, maps.
- [ ] **Settings > E-mail**: `lead_email`, `mail_from` (verified sender), `mail_from_name`; optional `mail_logo_url`
      (host `media/mail/dfresh-mail-logo.png`, then paste `https://dfresh.us/media/mail/dfresh-mail-logo.png`).
- [ ] **Settings > Sharing and SEO**: share picture (1200 x 630), `ga4_measurement_id` once the GA4 stream exists.
- [ ] **Settings > Security**: `two_step_login` stays On. **Brochure**: `brochure_download_enabled` On.
- [ ] Content edited in the LOCAL admin is not on live (live starts from the seed): redo any such edit here.

---

## 11. Soft launch and launch day

11.1 Soft launch (now): `site_indexing` is **Off** (migration default). Search engines are told to stay away:
robots.txt `Disallow: /`, no sitemap, `noindex` on every page and in the `X-Robots-Tag` header. People with the
link can use the site normally.

11.2 Test leads are REAL on live: they land in the LIVE Google Sheet, send real staff alerts to `lead_email` and
real e-mails to whatever address the tester typed. Testers: name "TEST ...", their own e-mail and phone.

11.3 Before launch day, remove every test lead. A few: Admin -> Leads -> open the lead -> **Delete lead** (admins
only) -> confirm (the lead, its e-mail history and sheet-queue row go; the audit log keeps "deleted DFL-xxxxxx").
All of them at once: "Clear test data before launch" below.
- The rows already written to the LIVE sheet stay there either way: in the sheet, open each form's tab, find the
  Lead Ref (column B), right-click the row number -> Delete row (or delete all rows under the header row 1).
- Lead numbers are never reused: the first real lead continues the count (e.g. DFL-260019). That is intended.

#### Clear test data before launch (`deploy/clear-test-data.sql`)

Removes ONLY the leads and what belongs to them: `leads`, `lead_products`, the lead e-mails in `mail_outbox`
(staff alerts, visitor confirmations, brochure copy links), `sync_outbox` (sheet queue), and the lead history in
`audit_log` (lead changes, deletes, lead exports, outbox retries of lead mails). Everything else stays: products,
texts, translations, banners, kits, towns, settings, brochures, admin users, other audit history (settings, content,
logins), sign-in code mails, `media/`, `private/`. `lead_counters` is kept on purpose, so a lead number is never given
twice; it uses DELETE, not TRUNCATE, so a lead id is never reused either. MySQL 8 (the script reads a MySQL 8 setting
first; on any error the mysql client stops before deleting anything).

**[PC]** upload the script (it is also in every release from now on, under `deploy/`):
```powershell
scp C:\Users\91638\Desktop\Dolluzcorp\dFresh\dfresh\deploy\clear-test-data.sql <user>@64.227.135.222:/var/www/dfresh-upload/
```
**[server]**:
```bash
# 0. look first (read only): these are the leads that will be deleted - all of them must be tests
sudo mysql dfresh -e "SELECT lead_ref, form_type, full_name, email, CONVERT_TZ(created_at, '+00:00', '+05:30') AS ist FROM leads ORDER BY lead_id;"
# 1. backup
KEEP_DAYS=7 APP_DIR=/var/www/dfresh sh /var/www/dfresh/deploy/backup.sh
ls -l /var/backups/dfresh/$(date +%F)/dfresh.sql.gz
# 2. maintenance on, app stopped (no lead can arrive while the script runs)
touch /var/www/dfresh/MAINTENANCE
pm2 stop dfresh-api
# 3. the script, as MySQL root: prints BEFORE, KEPT, AFTER, KEPT, NEXT
sudo mysql --default-character-set=utf8mb4 --table dfresh < /var/www/dfresh-upload/clear-test-data.sql
#   AFTER: leads 0, lead_products 0, lead_mails 0, sheet_queue 0, lead_audit 0, outbox_retry_audit 0
#   KEPT: the same numbers before and after; NEXT: next_lead_ref = the first real lead's number
# 4. app on, maintenance off
pm2 restart dfresh-api
sleep 3; curl -s http://127.0.0.1:4012/api/dfresh/health
rm /var/www/dfresh/MAINTENANCE
# 5. optional: the pm2 log still has "[mail] ... to <address>" lines of the test mails
pm2 flush dfresh-api
```
Then: Admin -> Leads is empty, the dashboard shows 0 leads, and the LIVE sheet rows are deleted by hand (above).
If something looks wrong: maintenance on, `pm2 stop dfresh-api`, restore `dfresh.sql.gz` from step 1 (step 13),
`pm2 restart dfresh-api`, maintenance off.

11.4 Launch day (in this order):
- [ ] Test leads deleted (11.3, or "Clear test data before launch"); sheet rows gone.
- [ ] Admin -> Settings -> Sharing and SEO -> `site_indexing` -> **On** (applies at once).
- [ ] `curl -s https://dfresh.us/robots.txt` -> `Disallow: /admin`, `Disallow: /api/`, `Sitemap: https://dfresh.us/sitemap.xml`;
      `curl -s -o /dev/null -w '%{http_code}' https://dfresh.us/sitemap.xml` -> 200 (30 URLs);
      `curl -s https://dfresh.us/en | grep -c 'name="robots"'` -> 0.
- [ ] Google Search Console: property `https://dfresh.us`, submit `https://dfresh.us/sitemap.xml`.
- [ ] GA4 web stream for `https://dfresh.us`, its id in Settings `ga4_measurement_id`.
- [ ] About a week later, with https proven on both names: uncomment the `Strict-Transport-Security` line in
      `/etc/nginx/sites-available/dfresh.us.conf`, `sudo nginx -t && sudo systemctl reload nginx`.

---

## 12. Maintenance page, updates, rollback [server]

### Maintenance page: on / off

dFresh's own page, `/var/www/dfresh/maintenance/maintenance.html` (in git, folder `maintenance/` with its logo and
favicons in `maintenance/assets/`). Black / gold, title "dFresh - Back shortly", EN then Tamil and Hindi, the WhatsApp number
for urgent orders, reloads itself every 60 s. Self-contained: no API, database or Google Fonts.

```bash
touch /var/www/dfresh/MAINTENANCE        # ON: every public page -> 503 + Retry-After: 300 + the page (no reload)
rm /var/www/dfresh/MAINTENANCE           # OFF: site back at once
ls -l /var/www/dfresh/MAINTENANCE        # is it on? ("No such file" = off)
curl -sI https://dfresh.us/en | grep -iE '^(HTTP|retry-after)'     # ON: 503 + retry-after: 300; OFF: 200
curl -s http://127.0.0.1:4012/en | head -c 200                     # node itself, while the page is up
```
- Same mechanism as dAssist: `error_page 403 404 500 503 /maintenance.html` (internal), the switch file
  (`if (-f /var/www/dfresh/MAINTENANCE) { return 503; }`), and the page shows by itself while node is down
  (502 / 504 are sent as 503, so search engines keep the old pages and do not index this one).
- `/admin` and `/api/` are not switched off: staff can sign in and check before reopening, leads still save.
- The file `MAINTENANCE` is never part of a release (git-ignored); an update sets and clears it itself.
- WhatsApp number on the page = a fixed copy of Settings `whatsapp_display` (+91 93302 59330). If that setting
  changes: edit `maintenance/maintenance.html` (link and text), commit, then a new release (step 2 + Update).

### Update (build on the PC, upload, swap folders, restart)

**[PC]** step 2 again (`npm run release:pack`, check the hash, scp). Then **[server]**:
```bash
n22() { PATH=/opt/node22/bin:$PATH "$@"; }
cd /var/www/dfresh-upload
REL=$(ls -t dfresh-*.tar.gz | head -1); echo "$REL"; sha256sum -c "$REL.sha256"    # OK - stop if not
ls -t dfresh-*.tar.gz | tail -n +3 | xargs -r -I{} rm -f {} {}.sha256              # keep the last 2 archives

# 1. the release before last goes (frees ~140 MB); the live site keeps running all along
rm -rf /var/www/dfresh.prev
mkdir /var/www/dfresh.next
tar -xzf "$REL" -C /var/www/dfresh.next --no-same-owner --no-same-permissions --warning=no-unknown-keyword
cd /var/www/dfresh.next && cat RELEASE.txt
n22 /opt/node22/bin/npm ci --omit=dev --no-audit --no-fund --cache /tmp/dfresh-npm-cache && rm -rf /tmp/dfresh-npm-cache

# 2. new migrations: the files the live release does not have (empty output = none)
#    20261019_times_to_utc.sql in the list? Do NOT run it here: follow "One-off: times to UTC" below instead.
comm -13 <(ls /var/www/dfresh/database/migrations) <(ls /var/www/dfresh.next/database/migrations)
#   each one, in name order:  sudo mysql --default-character-set=utf8mb4 dfresh < database/migrations/<file>
#   (migrations only add things, so the live release keeps working on the newer database)

# 3. swap (a few seconds; the public pages show the maintenance page meanwhile)
touch /var/www/dfresh/MAINTENANCE /var/www/dfresh.next/MAINTENANCE
mv /var/www/dfresh/.env /var/www/dfresh/media /var/www/dfresh/private /var/www/dfresh.next/
mv /var/www/dfresh /var/www/dfresh.prev && mv /var/www/dfresh.next /var/www/dfresh
pm2 restart dfresh-api                                # same path, new code (the interpreter is kept)
sleep 3; curl -s http://127.0.0.1:4012/api/dfresh/health
pm2 logs dfresh-api --lines 30 --nostream             # no errors
cat /var/www/dfresh/RELEASE.txt
rm /var/www/dfresh/MAINTENANCE                        # site back
```
Then the quick checks of step 9 (home, a product page, admin sign-in).

### One-off: times to UTC (the release that brings `20261019_times_to_utc.sql`)

Until this release, times were stored in the live MySQL's default zone (IST) and read as UTC, so the admin added
5:30 twice (an upload at 17:22 showed 10:52 pm). From this release every time is stored in UTC and shown in India
time everywhere. The existing rows are shifted once, while the app is STOPPED (rows written by the old release after
the shift, or by the new one before it, would be 5:30 off).
```bash
# 1. read only: the zone the live MySQL writes in (offset_min 330 = IST: the rows will be shifted; 0 = no-op)
sudo mysql -e "SELECT @@global.time_zone, @@system_time_zone, NOW(), UTC_TIMESTAMP(), TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS offset_min;"
# 2. a backup first (step 13)
KEEP_DAYS=7 APP_DIR=/var/www/dfresh sh /var/www/dfresh/deploy/backup.sh
# 3. the Update steps up to and including `npm ci` in /var/www/dfresh.next; then, instead of steps 2 and 3:
touch /var/www/dfresh/MAINTENANCE /var/www/dfresh.next/MAINTENANCE
pm2 stop dfresh-api                                   # nothing writes to the database now
sudo mysql --default-character-set=utf8mb4 dfresh < /var/www/dfresh.next/database/migrations/20261019_times_to_utc.sql
#   prints: session_zone SYSTEM (or +05:30), minutes_shifted_back 330, state shifting
#   any OTHER new migration from the comm list: now, the same way
mv /var/www/dfresh/.env /var/www/dfresh/media /var/www/dfresh/private /var/www/dfresh.next/
mv /var/www/dfresh /var/www/dfresh.prev && mv /var/www/dfresh.next /var/www/dfresh
pm2 restart dfresh-api                                # starts the new release (UTC sessions)
sleep 3; curl -s http://127.0.0.1:4012/api/dfresh/health
rm /var/www/dfresh/MAINTENANCE
# 4. check: Admin -> Brochures / Audit log / a lead: the times are India time (an upload now shows now)
sudo mysql dfresh -e "SELECT meta_value FROM dfresh_meta WHERE meta_key = 'times_utc';"   # stored as UTC; ... shifted back 330 minutes
```
Rolling back after this needs the database too: the previous release reads UTC as if it were IST again. Restore the
backup from 2. (or shift forward: `+ INTERVAL 330 MINUTE` on the same columns and delete the `times_utc` marker).

### Rollback to the previous release

```bash
touch /var/www/dfresh/MAINTENANCE
mv /var/www/dfresh/.env /var/www/dfresh/media /var/www/dfresh/private /var/www/dfresh.prev/
mv /var/www/dfresh /var/www/dfresh.bad && mv /var/www/dfresh.prev /var/www/dfresh
pm2 restart dfresh-api
sleep 3; curl -s http://127.0.0.1:4012/api/dfresh/health && cat /var/www/dfresh/RELEASE.txt
rm -f /var/www/dfresh/MAINTENANCE
# later, once the cause is known: rm -rf /var/www/dfresh.bad (there is no .prev until the next update)
```
Restore the database backup (step 13) only if a migration changed or removed data, and take a fresh dump first.

---

## 13. Backups [server]

`deploy/backup.sh` (in every release) dumps the dfresh database and archives `media/` (all uploads) and
`private/brochures/` into `/var/backups/dfresh/<date>/`, keeping 7 days (~60-100 MB: the disk is small).
```bash
cat > ~/.my.cnf <<'EOF'
[mysqldump]
user=dfresh_backup
password=<fill by hand: DFRESH_BACKUP_PASSWORD from 4.5>
EOF
chmod 600 ~/.my.cnf
KEEP_DAYS=7 APP_DIR=/var/www/dfresh sh /var/www/dfresh/deploy/backup.sh     # by hand once: "dfresh backup <date>: <size>"
ls -l /var/backups/dfresh/$(date +%F)/                                      # dfresh.sql.gz, media.tar.gz, brochures.tar.gz
crontab -e
#   add: 15 2 * * * KEEP_DAYS=7 APP_DIR=/var/www/dfresh sh /var/www/dfresh/deploy/backup.sh >> /var/log/dfresh/backup.log 2>&1
```
(`sh ...` so the job never depends on the file's execute bit.) Off the droplet, e.g. weekly **[PC]**:
```powershell
scp -r <user>@64.227.135.222:/var/backups/dfresh/<date> D:\dfresh-backups\
```
Restore: `gunzip -c dfresh.sql.gz | sudo mysql --default-character-set=utf8mb4 dfresh`; untar `media.tar.gz` /
`brochures.tar.gz` in `/var/www/dfresh`; `pm2 restart dfresh-api`.

---

## How dFresh differs from the other dApps on this server

- Own Node 22 (`/opt/node22/bin/node`) through pm2 `--interpreter`; the system node v18 and the other apps are
  untouched. npm for dFresh always through `n22` (top of this file).
- Built on the PC, never on the server (1 GB RAM): the server gets a checked archive and installs production
  dependencies only. No git checkout on the server.
- Releases are swapped as folders (`dfresh`, `dfresh.prev`); `.env`, `media/`, `private/` move with the live one.
- Own domain (`dfresh.us` + `www`), its own nginx file `dfresh.us.conf` and certificate. Port 4012, pm2 `dfresh-api`.
- Node serves the public PAGES too (per-URL SEO HTML, `robots.txt`, `sitemap.xml`), not only an API; nginx serves
  only `/static`, `/media` and the maintenance page from disk.
- Exactly ONE pm2 instance: the same process runs the e-mail and Google Sheet outbox worker.
- The server writes to `media/` (admin uploads, script fonts built at run time) and `private/` (brochures, font state).
- Its own `JWT_SECRET`: dFresh never reads a dAdmin token; changing it signs out dFresh admins only.
- dAdmin access is column-limited (10 columns of `dadmin.employee`) plus write access to `dadmin.login_otp` only.
- Search engine indexing is an admin switch (`site_indexing`), not an env variable.
- Maintenance: the same nginx mechanism as dAssist (error_page + switch file `MAINTENANCE`), with dFresh's own
  page in `/var/www/dfresh/maintenance/`; the switch closes the public pages only (`/admin`, `/api/` stay up).
