# dFresh - LIVE deployment runbook (dfresh.us)

Copy-paste steps for the first live deployment, then updates, rollback and backups. Run them in order. Every
command block says WHERE it runs: **[server]** = an SSH session on the droplet, **[PC]** = Pavithran's Windows PC
(Git Bash or PowerShell). Lines starting with `#` are notes. `<...>` = fill in by hand, never paste a real secret
into a chat, ticket or this file.

| Fact | Value |
|---|---|
| Server | DigitalOcean droplet `64.227.135.222` (shared with the other dApps: nginx, pm2, certbot, MySQL) |
| Domain | `dfresh.us` (main) and `www.dfresh.us` (301 to the main one); DNS A records -> `64.227.135.222` |
| App folder | `/var/www/dfresh` (NOT `/var/www/dolluzcorp.com`) |
| Repo / branch | `github.com/dolluzcorp01/dFresh`, `main` |
| Node process | pm2 `dfresh-api`, `127.0.0.1:4012`, ONE instance |
| Database | MySQL `dfresh`, app user `dfresh_app` (least privilege), backup user `dfresh_backup` |
| Logs | `/var/log/dfresh/` (pm2 out / error, backup) |
| Backups | `/var/backups/dfresh/<date>/` (14 days) + a copy off the droplet |

Request flow: browser -> nginx 443 -> `/static`, `/media` from disk; everything else -> node `127.0.0.1:4012`,
which answers `/api/dfresh/*`, `/admin`, `/sitemap.xml`, `/robots.txt` and every page with its SEO HTML.
Site and API are ONE origin (`REACT_APP_API` empty). `private/` (brochures, Google key), `.env`, `build-ssr/` and
the sources are never served.

---

## 1. Pre-checks (change nothing yet) [server]

```bash
ssh <user>@64.227.135.222          # the same Linux user that runs pm2 for the other dApps

# 1.1 port 4012 must be free (no output = free)
sudo ss -ltnp | grep -E ':4012\b'

# 1.2 node / npm / pm2 / git. Local dev is node v22.14.0, npm 10.9.2.
node -v; npm -v; pm2 -v; git --version
#   node v22.x: fine. v20.9+: works. Older: STOP - do not upgrade the global node (the other apps use it);
#   see "Node older than 20.9" at the end of this file.

# 1.3 MySQL reachable, its version (local dev: MySQL 8.0.32), and no dfresh database yet
sudo mysql -e "SELECT VERSION(); SHOW DATABASES LIKE 'dfresh'; SHOW DATABASES LIKE 'dadmin';"
#   expect: a version, NO dfresh row, a dadmin row

# 1.4 dAdmin has what dFresh needs (sign-in reads dadmin.employee, writes dadmin.login_otp)
sudo mysql -e "SELECT COUNT(*) AS cols_10 FROM information_schema.columns WHERE table_schema='dadmin' AND table_name='employee'
  AND column_name IN ('emp_id','emp_first_name','emp_last_name','emp_mail_id','emp_profile_img','job_position','emp_department','account_pass','active','deleted_time');"
sudo mysql -e "SHOW TABLES IN dadmin WHERE Tables_in_dadmin IN ('login_otp','login_session_revoke','job_position_config','department_config');"
#   expect cols_10 = 10 and 4 tables (the two *_config tables are optional: job title / department in Admin users)
sudo mysql -e "SELECT emp_id, active, deleted_time IS NULL AS not_deleted, emp_mail_id <> '' AS has_mail FROM dadmin.employee WHERE emp_id IN ('DZIND002','DZIND148');"
#   expect both rows: active 1, not_deleted 1, has_mail 1 (the two seeded dFresh admins)

# 1.5 disk and memory
df -h / /var/lib/mysql      # need >= 3 GB free on / (node_modules ~600 MB, build, media ~150 MB)
free -m; swapon --show      # RAM total and swap (step 6 builds React on this server)

# 1.6 nginx / certbot healthy BEFORE we touch them, nothing for dfresh.us yet, DNS points here
sudo nginx -t && nginx -v
ls /etc/nginx/sites-enabled/
certbot --version
dig +short dfresh.us; dig +short www.dfresh.us     # both: 64.227.135.222
```
Write down: node version, MySQL version, free RAM, swap. If anything above is not as expected, stop and ask.

---

## 2. Clone and install [server]

The repo is private: give the droplet a read-only deploy key (skip if the other dApps already clone this org's
repos with a key or token that can read `dolluzcorp01/dFresh`; then use that).
```bash
ssh-keygen -t ed25519 -C "dfresh deploy 64.227.135.222" -f ~/.ssh/dfresh_deploy -N ""
cat ~/.ssh/dfresh_deploy.pub
#   GitHub -> dolluzcorp01/dFresh -> Settings -> Deploy keys -> Add deploy key, paste, "Allow write access" OFF
cat >> ~/.ssh/config <<'EOF'
Host github-dfresh
  HostName github.com
  User git
  IdentityFile ~/.ssh/dfresh_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github-dfresh            # "Hi dolluzcorp01/dFresh! You've successfully authenticated..."
```
Folders, clone, install:
```bash
sudo mkdir -p /var/www/dfresh /var/log/dfresh /var/backups/dfresh /var/www/letsencrypt
sudo chown -R $USER: /var/www/dfresh /var/log/dfresh /var/backups/dfresh
git clone -b main git@github-dfresh:dolluzcorp01/dFresh.git /var/www/dfresh
cd /var/www/dfresh
git log --oneline -1               # the commit going live: note it
npm ci                             # all packages (the build needs react-scripts); ~3-5 min
mkdir -p private/brochures private/fonts media
chmod 700 private
npm run media:sync                 # product / banner / logo images from assets/ (in git) -> media/, all sizes
```
The React build comes in step 6: it reads the database (texts for the error screen, pre-rendered pages).

---

## 3. MySQL: database, users, migrations [server]

Everything as the MySQL admin (`sudo mysql`; if root has a password: `mysql -u root -p`). Always
`--default-character-set=utf8mb4`, or Tamil / Hindi turns into `????`. Always name the database (`dfresh`):
five migration files have no `USE` line.

```bash
cd /var/www/dfresh
# 3.1 schema (creates the dfresh database) and seed (launch content: 3 languages, 25 products + 3 colour versions,
#     categories, banners, kits, towns, form options, texts, settings, the 2 admin users DZIND002 / DZIND148;
#     NO leads, NO test data)
sudo mysql --default-character-set=utf8mb4 < database/01_schema.sql
sudo mysql --default-character-set=utf8mb4 dfresh < database/02_seed.sql

# 3.2 every migration, in name order (stops at the first error)
for f in $(ls database/migrations/*.sql | sort); do
  echo "== $f"; sudo mysql --default-character-set=utf8mb4 dfresh < "$f" || { echo "FAILED: $f"; break; }
done
```
The 28 migrations, in the order they must run (tick each; a later update applies only the new ones):

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

This exact sequence (schema, seed, 28 migrations) was run on an empty database on 19 Oct 2026 without an error.

```bash
# 3.3 live settings that are not content (the LIVE lead sheet; everything else is edited in the admin)
sudo mysql dfresh -e "UPDATE site_settings SET setting_value = '1iv8X5AOv5VZ3KlZiRwYjX9-oc5LV16GuomGfDRDa1V4' WHERE setting_key = 'gsheet_spreadsheet_id';"

# 3.4 check: no leads, 25 products, 3 languages, the soft-launch switches
sudo mysql dfresh -e "SELECT (SELECT COUNT(*) FROM leads) leads, (SELECT COUNT(*) FROM products WHERE variant_of IS NULL AND is_active=1) products,
  (SELECT COUNT(*) FROM languages WHERE is_active=1) langs, (SELECT COUNT(*) FROM admin_users) admins;
  SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN
  ('site_indexing','two_step_login','brochure_download_enabled','gsheet_spreadsheet_id','lead_email','mail_from','public_email');"
#   expect 0 / 25 / 3 / 2; site_indexing off, two_step_login on, brochure_download_enabled on, the LIVE sheet id,
#   lead_email info@dolluzcorp.com, mail_from connect@dolluzcorp.com
```

3.5 The app user (least privilege) and the backup user. Make two strong passwords first and keep them for
step 4 / step 13 (they are not printed anywhere else):
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

## 4. Production `.env` [server]

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
DB_PASSWORD=<fill by hand: DFRESH_APP_PASSWORD from 3.5>
DB_NAME=dfresh
DADMIN_DB_NAME=dadmin
# --- auth: dFresh's own secret (it never reads a dAdmin token). Make it with: openssl rand -hex 48 ---
JWT_SECRET=<fill by hand: new random, 96 hex characters>
ADMIN_APP_KEY=dFresh
ADMIN_COOKIE_NAME=dfresh_admin_token
# --- mail: the sender is admin Settings mail_from, not here. NO MAIL_TEST_TO line on the server. ---
SENDGRID_API_KEY=<fill by hand: production key, Mail Send (full) + Sender Authentication (read)>
MAIL_ENABLED=true
# --- LIVE Google Sheet (the id is admin Settings gsheet_spreadsheet_id, set in 3.3) ---
GSHEET_ENABLED=true
GOOGLE_SERVICE_ACCOUNT_JSON=./private/google-service-account.json
# --- security ---
IP_HASH_SALT=<fill by hand: openssl rand -hex 32>
BROCHURE_TOKEN_TTL_MIN=15
LEAD_RATE_LIMIT_PER_10MIN=5
# --- React build: EMPTY = the site's own origin ---
REACT_APP_API=
```
| Key | Live value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Secure + httpOnly + SameSite=Strict admin cookies (auth.js), serves the build, refuses non-https URLs |
| `PORT` | `4012` | nginx proxies to it (step 1.1: free) |
| `PUBLIC_SITE_URL` / `PUBLIC_API_URL` | `https://dfresh.us` both | canonical, hreflang, sitemap, CORS, e-mail links; the API will not start with http or localhost |
| `DB_*` | `dfresh_app` + its password | never root |
| `JWT_SECRET` | NEW random | signs the admin session; changing it later signs every admin out |
| `SENDGRID_API_KEY` | production key | Sender Authentication read = Settings can check `mail_from` before saving |
| `MAIL_ENABLED` | `true` | real e-mail |
| `MAIL_TEST_TO` | **absent** | would send every mail to one test inbox |
| `GSHEET_ENABLED` | `true` | leads to the LIVE sheet |
| `IP_HASH_SALT` | NEW random | not the dev value |
| `SEO_NOINDEX`, `SERVE_BUILD`, `DB_ADMIN_*`, `APP_DB_*` | **absent** | indexing is the admin switch `site_indexing` (step 11); the rest is local only |

Check without printing a secret:
```bash
sed -E 's/^([A-Z_]+)=.+$/\1=<set>/' .env                        # every key, values hidden
grep -c '^MAIL_TEST_TO' .env                                     # 0
grep -E '^(NODE_ENV|MAIL_ENABLED|GSHEET_ENABLED|PUBLIC_SITE_URL)=' .env
ls -l .env                                                       # -rw------- (600)
```

---

## 5. Private files and folders

5.1 Google service account key (the same key as local; it is git-ignored). **[PC]**, Git Bash or PowerShell:
```bash
scp "C:/Users/91638/Desktop/Dolluzcorp/dFresh/dfresh/private/google-service-account.json" <user>@64.227.135.222:/var/www/dfresh/private/
```
**[server]**:
```bash
cd /var/www/dfresh
chmod 600 private/google-service-account.json
git check-ignore -v private/google-service-account.json   # must print a .gitignore rule (never committed)
grep -o '"client_email": *"[^"]*"' private/google-service-account.json
```
Share the LIVE sheet (`1iv8X5AOv5VZ3KlZiRwYjX9-oc5LV16GuomGfDRDa1V4`) with that `client_email` as **Editor**.
Its tabs and row-1 headers must match `src/backend_routes/gsheet.js` (Quote, Sample, Distributor, Contact, Brochure).

5.2 Folders and permissions **[server]**:
```bash
cd /var/www/dfresh
chmod 700 private private/brochures private/fonts    # node only; nginx never serves private/
chmod 755 media && find media -type d -exec chmod 755 {} + && find media -type f -exec chmod 644 {} +
ls -ld private private/* media                        # owner = the pm2 user; nginx (www-data) must READ media
```
- `media/` = the public images (and every admin upload: product photos, banners, share / About picture, script
  fonts). Built by `npm run media:sync` in step 2; nothing to copy from the PC.
- `private/brochures/` = brochure PDFs, uploaded in the admin after launch (step 10); nothing to copy.
- `private/fonts/` = the font manager's state.

---

## 6. Build: React + pre-render [server]

The build needs the database (step 3) and `.env` (step 4). On a small droplet the CRA build needs extra memory:
```bash
free -m; swapon --show
# ONLY if total RAM < 2000 MB and there is no swap: a 2 GB swap file (helps the build; the other apps are unaffected)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

cd /var/www/dfresh
NODE_OPTIONS=--max-old-space-size=1536 npm run build
#   prebuild: "i18n:fallback wrote src/i18n/fallbackText.json (en, ta, hi)"
#   build:    "Compiled successfully" (5-10 min on 1 vCPU)
#   postbuild: "prerender: 30 page(s) written to build-ssr/pages.json"
ls build/index.html build-ssr/ssr.js build-ssr/pages.json
git status --short          # only src/i18n/fallbackText.json may show as changed (see step 12 for updates)
```
If the build is killed (`Killed` / out of memory) even with swap: build on the PC instead (same commit,
`.env` pointing at a copy of the live content) and copy `build/` and `build-ssr/` up with scp.

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
pages, sitemap, robots) -> node 4012, and the maintenance page (step 12):
```bash
sudo cp deploy/nginx/dfresh.conf /etc/nginx/sites-available/dfresh.us.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run                          # "Congratulations, all simulated renewals succeeded"
```
Until step 8 starts node, every page shows the maintenance page (nginx answers 503 when node is not there).
If `nginx -t` warns that `listen ... http2` is deprecated (nginx 1.25.1+): harmless; to silence it, write
`listen 443 ssl;` + `http2 on;` like the other dApps' configs.

---

## 8. pm2 [server]

```bash
cd /var/www/dfresh
pm2 start deploy/ecosystem.config.js                 # name dfresh-api, ONE instance (fork mode)
pm2 logs dfresh-api --lines 60 --nostream
#   expect: "dFresh API listening on http://localhost:4012", [fonts] lines, outbox worker lines;
#   no "refuses to start", no "pre-rendering off", no DB / Google errors
curl -s http://127.0.0.1:4012/api/dfresh/health      # "db":"ok", products 25, variants 3, languages 3
pm2 save                                             # dfresh-api is now in the saved process list

# survives a reboot? (pm2 startup is normally already set up for the other dApps)
systemctl list-unit-files | grep -i pm2              # pm2-<user>.service ... enabled
#   none: run `pm2 startup`, then the sudo line it prints, then `pm2 save` again
```
A real reboot test restarts the other apps too: do it only in a quiet window
(`sudo reboot`, then `pm2 ls` shows dfresh-api online and `curl -s http://127.0.0.1:4012/api/dfresh/health` works).
Never start a second copy (`-i 2`, cluster): the outbox worker would send every e-mail twice.

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
- [ ] Maintenance page: `touch /var/www/dfresh/maintenance.on` -> `/en` shows it (503); `rm` it -> site back.

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

11.3 Before launch day, remove every test lead:
- Admin -> Leads -> open the lead -> **Delete lead** (admins only) -> confirm. The lead, its e-mail history and its
  sheet-queue row are removed; the audit log keeps "deleted DFL-xxxxxx" (no personal data).
- The row already written to the LIVE sheet is NOT removed by the admin: in the sheet, open the form's tab, find
  the Lead Ref (column B), right-click the row number -> Delete row. The admin's confirm dialog names the Lead Ref.
- Lead numbers are not reused: after deleting tests the first real lead may be e.g. DFL-260007. That is fine.

11.4 Launch day (in this order):
- [ ] Test leads deleted (11.3); sheet rows gone.
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

Maintenance page (`deploy/maintenance/index.html`, EN / TA / HI; no reload needed):
```bash
touch /var/www/dfresh/maintenance.on     # site + API answer 503 with the page (Retry-After 600)
rm /var/www/dfresh/maintenance.on        # back
curl -s http://127.0.0.1:4012/en | head -c 200   # check node directly while the page is up
```

Update to a new commit:
```bash
cd /var/www/dfresh
git rev-parse HEAD > ~/dfresh-prev-commit           # for a rollback
rm -rf build.prev build-ssr.prev && cp -a build build.prev && cp -a build-ssr build-ssr.prev
touch maintenance.on
git checkout -- src/i18n/fallbackText.json          # the build rewrites it; drop the server's copy before pulling
git pull --ff-only origin main
npm ci
# new migrations only (compare with the ticked list in step 3), each:
#   sudo mysql --default-character-set=utf8mb4 dfresh < database/migrations/<file>
NODE_OPTIONS=--max-old-space-size=1536 npm run build
pm2 reload dfresh-api && pm2 logs dfresh-api --lines 30 --nostream
curl -s http://127.0.0.1:4012/api/dfresh/health
rm maintenance.on
```
Rollback to the previous commit:
```bash
cd /var/www/dfresh
touch maintenance.on
git checkout -- src/i18n/fallbackText.json
git checkout $(cat ~/dfresh-prev-commit)            # detached at the old commit
npm ci
rm -rf build build-ssr && mv build.prev build && mv build-ssr.prev build-ssr
pm2 reload dfresh-api && curl -s http://127.0.0.1:4012/api/dfresh/health
rm maintenance.on
# later, to follow main again: git checkout main && the update steps above
```
Migrations only add things, so the old code runs on the newer database. Restore the database backup (step 13)
only if a migration changed or removed data, and then take a fresh dump first.

---

## 13. Backups [server]

`deploy/backup.sh` dumps the dfresh database and archives `media/` (all uploads) and `private/brochures/` into
`/var/backups/dfresh/<date>/`, keeping 14 days.
```bash
cat > ~/.my.cnf <<'EOF'
[mysqldump]
user=dfresh_backup
password=<fill by hand: DFRESH_BACKUP_PASSWORD from 3.5>
EOF
chmod 600 ~/.my.cnf
APP_DIR=/var/www/dfresh /var/www/dfresh/deploy/backup.sh     # first run by hand: "dfresh backup <date>: <size>"
ls -l /var/backups/dfresh/$(date +%F)/                       # dfresh.sql.gz, media.tar.gz, brochures.tar.gz
crontab -e
#   add: 15 2 * * * APP_DIR=/var/www/dfresh /var/www/dfresh/deploy/backup.sh >> /var/log/dfresh/backup.log 2>&1
```
Off the droplet (a backup on the same disk does not survive the disk), e.g. weekly from the PC **[PC]**:
```bash
scp -r <user>@64.227.135.222:/var/backups/dfresh/<date> "D:/dfresh-backups/"
```
Restore: `gunzip -c dfresh.sql.gz | sudo mysql --default-character-set=utf8mb4 dfresh`; untar `media.tar.gz` /
`brochures.tar.gz` in `/var/www/dfresh`; `pm2 reload dfresh-api`.

---

## Node older than 20.9 on the server

Do not change the global node (the other dApps run on it). Give dFresh its own node 22 with nvm, as the pm2 user:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && . ~/.nvm/nvm.sh
nvm install 22 && nvm use 22         # this shell only; `node -v` elsewhere stays the old one
cd /var/www/dfresh && npm ci && NODE_OPTIONS=--max-old-space-size=1536 npm run build
pm2 start deploy/ecosystem.config.js --interpreter "$(nvm which 22)" && pm2 save
```
Every later `npm ci` / `npm run build` for dFresh: `nvm use 22` first.

## How dFresh differs from the other dApps on this server

- Own domain (`dfresh.us` + `www`), not a `*.dolluzcorp.com` subdomain; its own nginx file `dfresh.us.conf` and
  certificate. Port 4012, pm2 `dfresh-api`.
- Node serves the public PAGES too (per-URL SEO HTML, `robots.txt`, `sitemap.xml`), not only an API; nginx serves
  only `/static` and `/media` from disk. The build also pre-renders pages (`build-ssr/`), and the build reads the
  database, so it runs after the database is set up.
- Exactly ONE pm2 instance: the same process runs the e-mail and Google Sheet outbox worker.
- The server writes to `media/` (admin uploads, script fonts built at run time) and `private/` (brochures, font state).
- Its own `JWT_SECRET`: dFresh never reads a dAdmin token; changing it signs out dFresh admins only.
- dAdmin access is column-limited (10 columns of `dadmin.employee`) plus write access to `dadmin.login_otp` only
  (the e-mailed sign-in code).
- Search engine indexing is an admin switch (`site_indexing`), not an env variable.
- The build rewrites the tracked `src/i18n/fallbackText.json`: reset it before every `git pull` (step 12).
- Maintenance page by a flag file (`maintenance.on`) in nginx, also shown while node is down. Compare with the
  other apps' pattern and align if theirs differs (e.g. dAdmin `app_visibility.maintenance`, which dFresh does not
  read).
