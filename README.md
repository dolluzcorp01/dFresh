# dFresh website

Catalogue + lead website and admin console for dFresh ("Gentle, Like You"), the tissue and hygiene paper
brand of Dolluz Corporation (OPC) Pvt Ltd. Stack: React (CRA) + Express 5 + MySQL 8 + SendGrid.

Start with `CLAUDE.md` (standing rules) and `docs/01_PROJECT_BRIEF.md` to `docs/07_ACCEPTANCE_AND_OPEN_ITEMS.md`.
Phase task files are in `docs/claude-tasks/` (finished ones in `docs/claude-tasks/done/`).

## Requirements
- Node.js 22, npm 10
- MySQL 8 running locally (the client must use utf8mb4, or Tamil / Hindi text breaks)

## First-time setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in:
   - `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`: a MySQL login that can create databases and users (e.g. root).
     Used ONLY by `npm run db:reset`, never by the app.
   - `DB_USER` / `DB_PASSWORD`: the app login (`dfresh_app`). Pick a long random password;
     `db:reset` creates the user with it.
   - `IP_HASH_SALT`: a long random string.
3. `npm run db:reset` - drops and recreates `dfresh`, loads `database/01_schema.sql` + `02_seed.sql`,
   creates `dfresh_app` with SELECT/INSERT/UPDATE/DELETE on `dfresh.*`, and adds the `dadmin` grants when a
   local `dadmin` database exists. Refuses when `NODE_ENV=production`.
4. `npm run media:sync` - copies `assets/` into `media/` (not in git) and builds the 400 / 800 image sizes.
5. Start the two servers (Inside D pattern), in two terminals:
   - Backend: `node server.js` (or F5 in VS Code, "Run Backend" in `.vscode/launch.json`) - API on
     http://localhost:4012 (`PORT` in `.env`).
   - Frontend: `npm start` - React on http://localhost:3000. If 3000 is busy it moves to the next free port
     (3001, 3002 ...) by itself and prints the one it picked. It never takes the API port 4012.
   - Or both in one terminal: `npm run dev`.
   React always runs on 3000: if 3000 (or the API's 4012) is busy, it stops and prints the PID holding the port
  and the command that frees it. `npm run stop` frees both; `npm run dev:fresh` = stop, then dev.

## Commands
| Command | What |
|---|---|
| `npm run dev` | API (nodemon) + React dev server together |
| `npm run dev:fresh` | `npm run stop`, then `npm run dev` |
| `npm run stop` | Stop whatever listens on 4012 (API) and 3000 (React dev); prints what it stopped |
| `node server.js` | API only on 4012 (same as F5 "Run Backend" in VS Code) |
| `npm run server` | API only, restarts on change (nodemon) |
| `npm start` | React dev server only, always on 3000 (fails with the PID if 3000 is busy) |
| `npm run build` | Production React build |
| `npm run db:reset` | Local only: drop + create + schema + seed + app user |
| `npm run media:sync` | Copy `assets/` to `media/`, then `media:build` |
| `npm run media:build` | Generate product sizes and check every DB-referenced media file exists |
| `npm run test:api` | API tests against the local DB (files one at a time: some add and remove test rows) |
| `SERVE_BUILD=true PORT=4013 node server.js` | The production build with the SEO HTML, locally (e.g. for Lighthouse; build with `REACT_APP_API=` first) |
| `node scripts/visual-check/visual-check.js <out>` | Screenshots of every section, 1440 + 390, every language, motion + reduced motion (header has setup) |
| `node scripts/visual-check/keyboard.js [lang] [width]` | Keyboard-only run: focus rings, drawer / card / swatch / form, focus trap and return |
| `node scripts/visual-parity/measure.js <phase> <label> [shots]` | Preview vs ours parity measurements (header has setup) |

## Folders
- `assets/` - source of truth for logos, product photos and banners (committed)
- `media/` - served at `/media`, rebuilt from `assets/` (ignored by git; production media comes from the admin)
- `private/brochures/` - brochure PDFs, never public, never committed
- `database/` - schema, seed, and later `migrations/`
- `docs/` - spec, task phases, reference preview; `docs/kit/` has the kit's kickoff notes
- `deploy/` - droplet setup: `DEPLOY.md` (steps, server .env checklist, every `<DOMAIN>` placeholder), nginx, pm2, backup

Health check: `GET http://localhost:4012/api/dfresh/health`
