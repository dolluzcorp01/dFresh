# dFresh - deployment (DigitalOcean droplet, nginx, pm2)

Prepared in Phase 8. Nothing here has been run on the droplet yet: deploy only after the go-ahead.
The domain is still open (open item 1): every place that needs it says `<DOMAIN>`, listed in section 1.

Layout on the droplet (example paths, keep them consistent):

| What | Where |
|---|---|
| Repo checkout | `/var/www/dfresh` (= `<APP_DIR>`) |
| React build | `/var/www/dfresh/build` (built off the droplet, see 4) |
| Public images | `/var/www/dfresh/media` (not in git; uploads via admin) |
| Brochure PDFs | `/var/www/dfresh/private/brochures` (not in git, never public) |
| Google key | `/var/www/dfresh/private/google-service-account.json` (chmod 600) |
| Logs | `/var/log/dfresh/` (pm2) |
| Backups | `/var/backups/dfresh/<date>/` (+ a copy off the droplet) |

Request flow: browser -> nginx (443) -> `/static`, `/media` from disk; everything else -> node `127.0.0.1:4012`
(pm2 `dfresh`), which answers `/api/dfresh/*`, `/sitemap.xml`, `/robots.txt` and every page with the SEO HTML.
Site and API are ONE origin, so the React build is made with `REACT_APP_API` empty.

## 1. Domain placeholders - every place `<DOMAIN>` must be filled in

| # | Where | Value |
|---|---|---|
| 1 | Server `.env` `PUBLIC_SITE_URL` | `https://<DOMAIN>` |
| 2 | Server `.env` `PUBLIC_API_URL` | `https://<DOMAIN>` (same origin) |
| 3 | `deploy/nginx/dfresh.conf` `server_name` (3 blocks) and the 2 `return 301` lines | `<DOMAIN>`, `www.<DOMAIN>` |
| 4 | `deploy/nginx/dfresh.conf` `ssl_certificate` / `ssl_certificate_key` (2 blocks) | `/etc/letsencrypt/live/<DOMAIN>/...` |
| 5 | certbot (step 5) | `-d <DOMAIN> -d www.<DOMAIN>` |
| 6 | DNS at the registrar | A records `<DOMAIN>` and `www.<DOMAIN>` -> droplet IP |
| 7 | Admin -> Settings `site_url` | `https://<DOMAIN>` (seeded as `https://dfresh.in` "TO CONFIRM"; no code reads it today, keep it true) |
| 8 | Google Search Console | property `https://<DOMAIN>`, submit `https://<DOMAIN>/sitemap.xml` (open item 5) |
| 9 | GA4 web stream | URL `https://<DOMAIN>`, then admin -> Settings `ga4_measurement_id` (open item 5) |

Filled in automatically from `PUBLIC_SITE_URL` (nothing to edit): canonical, hreflang, Open Graph and JSON-LD
URLs, `sitemap.xml`, the `Sitemap:` line in `robots.txt`, the CORS allow-list, the admin link in staff alerts,
the "back to the site" link on the brochure error page. `PUBLIC_API_URL` builds the brochure download link in
e-mails. In production the API refuses to start if either is missing, http or localhost.

Staging before the domain is final: use the staging https URL as `<DOMAIN>` and set `SEO_NOINDEX=true` so
nothing gets indexed (every page `noindex`, `robots.txt` disallows all). Remove it on the real domain.

## 2. Server `.env` checklist (never committed; `chmod 600 .env`)

| Key | Production value | Note |
|---|---|---|
| `NODE_ENV` | `production` | also set by pm2 |
| `PORT` | `4012` | open item 15: confirm free on the droplet (`ss -ltnp \| grep 4012`) |
| `PUBLIC_SITE_URL` | `https://<DOMAIN>` | https, not localhost, or the API will not start |
| `PUBLIC_API_URL` | `https://<DOMAIN>` | same |
| `SEO_NOINDEX` | `true` on staging, absent on the live domain | |
| `DB_HOST` / `DB_NAME` / `DADMIN_DB_NAME` | `localhost` / `dfresh` / `dadmin` | |
| `DB_USER` / `DB_PASSWORD` | the limited `dfresh_app` user | never root (database/README.md) |
| `JWT_SECRET` | the SAME value dAdmin uses on this server | |
| `ADMIN_APP_KEY` / `ADMIN_COOKIE_NAME` | `dFresh` / `dfresh_admin_token` | |
| `SENDGRID_API_KEY` | production key | open item 7 |
| `MAIL_ENABLED` | `true` once the sender is verified | until then mail waits in the outbox |
| `MAIL_TEST_TO` | **absent** | must never be on the server |
| `GSHEET_ENABLED` | `true` once the LIVE sheet is shared | until then rows wait in sync_outbox |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `./private/google-service-account.json` | |
| `IP_HASH_SALT` | new random 64 chars (`openssl rand -hex 32`) | not the dev value |
| `BROCHURE_TOKEN_TTL_MIN` / `LEAD_RATE_LIMIT_PER_10MIN` | `15` / `5` | |
| `SERVE_BUILD` | absent | production serves the build anyway; this is for local testing |

Database settings (admin -> Settings, after the first sign-in):
- `gsheet_spreadsheet_id` = LIVE sheet `1iv8X5AOv5VZ3KlZiRwYjX9-oc5LV16GuomGfDRDa1V4` (the TEST sheet is local only).
  Share it with the service account's e-mail as Editor. Tabs and row-1 headers as in `gsheet.js` HEADERS.
- `lead_email` (info@dolluzcorp.com), `mail_from` (connect@dolluzcorp.com, verified in SendGrid), `site_url`.

X-Forwarded-For: nginx sets it to `$remote_addr` (overwrite, not append) and `server.js` trusts only loopback,
so `req.ip` is the visitor (lead rate limit, ip_hash) and a visitor cannot fake it. If a CDN / Cloudflare is put
in front later, this must change (real_ip module), or every visitor shares the CDN's address.

## 3. One-time droplet setup

```bash
# app user, folders, logs
sudo mkdir -p /var/www/dfresh /var/log/dfresh /var/backups/dfresh && sudo chown -R $USER /var/www/dfresh /var/log/dfresh /var/backups/dfresh
git clone <repo> /var/www/dfresh && cd /var/www/dfresh
npm ci --omit=dev            # server dependencies only; the React build comes from step 4
mkdir -p private/brochures media && chmod 700 private

# database: follow database/README.md (schema, seed, every migration in name order, utf8mb4),
# then the limited app user with the grants listed there. db:reset refuses in production on purpose.

# dAdmin (Pavithran, open item 8): optional rows so dFresh shows in dAdmin's screens - not needed to sign in.
#   INSERT INTO dadmin.login_app_config (app_key, rotate_seconds, two_factor_enabled, trust_days, panel_stats, edited_by)
#   VALUES ('dFresh', 3, 1, 14, NULL, '<emp_id>');
#   INSERT INTO dadmin.app_visibility (app_name, mode, updated_by, maintenance) VALUES ('dFresh', 'employees', '<emp_id>', 0);

cp .env.example .env && nano .env && chmod 600 .env   # section 2
```

## 4. Build (off the droplet - a 1 GB droplet runs out of memory building CRA)

On a dev machine with the repo at the same commit:
```bash
REACT_APP_API= npm run build          # empty = same origin; prebuild refreshes src/i18n/fallbackText.json from the DB
rsync -az --delete build/ <user>@<droplet>:/var/www/dfresh/build/
```
`media/` (originals + sizes): first time `rsync -az media/ <user>@<droplet>:/var/www/dfresh/media/`; later
uploads happen in the admin on the server. Brochure PDFs are uploaded in the admin.

## 5. nginx + https

```bash
sudo cp deploy/nginx/dfresh.conf /etc/nginx/sites-available/dfresh.conf
sudo sed -i 's#<DOMAIN>#<the real domain>#g; s#<APP_DIR>#/var/www/dfresh#g' /etc/nginx/sites-available/dfresh.conf
# first certificate: temporarily comment the two 443 blocks, enable, reload, then
sudo certbot certonly --webroot -w /var/www/letsencrypt -d <DOMAIN> -d www.<DOMAIN>
sudo ln -s /etc/nginx/sites-available/dfresh.conf /etc/nginx/sites-enabled/dfresh.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Start with pm2

```bash
cd /var/www/dfresh
pm2 start deploy/ecosystem.config.js && pm2 save
pm2 logs dfresh --lines 50     # expect "dFresh API listening", outbox lines, no "refuses to start"
curl -s http://127.0.0.1:4012/api/dfresh/health
```
`pm2 startup` once (if not already done for the other dApps) so it comes back after a reboot.

## 7. After every deploy: checks

- `https://<DOMAIN>/api/dfresh/health` -> `db: ok`, 25 products, 3 languages.
- `curl -sI https://<DOMAIN>/en` -> 200, `cache-control: no-cache`; `/static/js/main.*.js` -> `immutable`, gzip.
- View source of `/ta`: `<html lang="ta-IN">`, Tamil title, canonical, 3 hreflang + x-default, JSON-LD.
- `/sitemap.xml` lists 30 URLs (3 languages x 10); `/robots.txt` disallows /admin and /api (or everything on staging).
- PageSpeed Insights (mobile) on `/en`, `/en/products`, `/ta`: target 85+ in all four (open item 16).
- Rich Results Test on `/en` (code or URL); Schema validator on the same.
- One real lead from a phone (WhatsApp link) -> row in the admin, staff alert, visitor e-mail, LIVE sheet row.
- Admin sign-in with a real dAdmin account (password + e-mailed code).

## 8. Backups

`deploy/backup.sh` (database + media + brochures, 14 days). Cron as the app user, after `~/.my.cnf` (chmod 600):
```
15 2 * * * APP_DIR=/var/www/dfresh /var/www/dfresh/deploy/backup.sh >> /var/log/dfresh/backup.log 2>&1
```
Also copy `/var/backups/dfresh` off the droplet (DigitalOcean backups or a scheduled rsync to another machine).
Restore: `gunzip -c dfresh.sql.gz | mysql --default-character-set=utf8mb4 dfresh`, untar media / brochures in `<APP_DIR>`.

## 9. Update / rollback

Update: `git pull`, `npm ci --omit=dev`, apply new `database/migrations/*` in name order, rsync the new build,
`pm2 reload dfresh`. Rollback: previous commit + previous build folder (keep the last one as `build.prev`),
`pm2 reload dfresh`. Migrations are additive; restore the DB backup only if one changed data.
