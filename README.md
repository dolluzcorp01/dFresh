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
5. `npm run dev` - API on http://localhost:4012 and React on http://localhost:3000.

## Commands
| Command | What |
|---|---|
| `npm run dev` | API (nodemon) + React dev server together |
| `npm run server` | API only |
| `npm start` | React dev server only |
| `npm run build` | Production React build |
| `npm run db:reset` | Local only: drop + create + schema + seed + app user |
| `npm run media:sync` | Copy `assets/` to `media/`, then `media:build` |
| `npm run media:build` | Generate product sizes and check every DB-referenced media file exists |

## Folders
- `assets/` - source of truth for logos, product photos and banners (committed)
- `media/` - served at `/media`, rebuilt from `assets/` (ignored by git; production media comes from the admin)
- `private/brochures/` - brochure PDFs, never public, never committed
- `database/` - schema, seed, and later `migrations/`
- `docs/` - spec, task phases, reference preview; `docs/kit/` has the kit's kickoff notes

Health check: `GET http://localhost:4012/api/dfresh/health`
