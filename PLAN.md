# PLAN.md — "Stash" (Instapaper clone)

Read-it-later app: save articles from anywhere, read them later in a clean reader view.
Decisions confirmed with user (2026-07-06):

- **Mobile**: PWA installable on Android, registered as a **Web Share Target** (saves from the Google app share menu). No native app.
- **Auth**: **Google Sign-In** via Auth.js (next-auth v5). A dev-only Credentials provider (`AUTH_DEV_LOGIN=true`) enables local/E2E testing without Google credentials.
- **Stack**: **Next.js 15 (App Router, TS, Tailwind) + PostgreSQL + Prisma**. Article extraction with `@mozilla/readability` + `jsdom`, sanitized with `sanitize-html`.
- **Deploy**: **Cloud Run deploy-ready** — Dockerfile + `cloudbuild.yaml` with placeholder substitutions; tested locally via Docker Compose. User runs the actual GCP deploy.
- Also: **Chrome extension (MV3)** to save the current tab, authenticated with API tokens.

## Repo layout

```
fable/
  PLAN.md, PROGRESS.md, README.md
  web/                  # Next.js app
    prisma/schema.prisma
    src/app/            # pages + /api routes
    src/lib/            # db, auth, extraction
    public/             # PWA manifest, sw.js, icons
    Dockerfile
  extension/            # Chrome MV3 extension (plain JS, no build step)
  docker-compose.yml    # local: postgres + web
  cloudbuild.yaml       # GCP Cloud Build -> Artifact Registry -> Cloud Run
```

## Data model (Prisma)

- `User` (id cuid, email unique, name?, image?, createdAt)
- `Article` (id cuid, userId FK, url, title, siteName?, author?, excerpt?, content Text /*sanitized HTML*/, wordCount Int, readingMinutes Int, leadImageUrl?, state enum UNREAD|ARCHIVED, starred Bool default false, extractionFailed Bool default false, savedAt, readAt?)
  - index (userId, state, savedAt desc); unique (userId, url) — re-saving an existing URL un-archives it and bumps savedAt.
- `ApiToken` (id cuid, userId FK, name, tokenHash unique /*sha256*/, createdAt, lastUsedAt?) — plaintext token shown once on creation, format `stash_<32 hex>`.

Auth.js uses JWT session strategy (no adapter tables); on Google sign-in we upsert `User` by email and put `user.id` in the JWT/session.

## API contract (all JSON; auth = session cookie OR `Authorization: Bearer <api token>`)

- `POST /api/articles` `{url}` → 201 `{article}` — fetches, extracts, sanitizes, saves. On extraction failure still saves with `extractionFailed: true`, title = hostname. Duplicate URL → 200 with existing (un-archived, savedAt bumped).
- `GET /api/articles?state=unread|archived&starred=1&q=<search>&cursor=<id>&limit=` → `{articles: [...], nextCursor}` (savedAt desc; q matches title/excerpt/siteName, case-insensitive)
- `GET /api/articles/:id` → `{article}` (includes content)
- `PATCH /api/articles/:id` `{state?, starred?}` → `{article}`
- `DELETE /api/articles/:id` → 204
- `GET/POST /api/tokens` (`POST {name}` → `{token: "stash_..."}` plaintext once), `DELETE /api/tokens/:id`
- `GET /api/health` → `{ok: true}` (no auth; used by Docker healthcheck)
- Errors: `{error: string}` with 400/401/404/422.

## Pages (Tailwind, Instapaper-like minimal design)

- `/` unread list, `/archive`, `/starred` — rows: title, site, excerpt, reading time; actions: star, archive/unarchive, delete. Header: search box, "Add URL" input, nav, user menu.
- `/article/[id]` reader: clean typography, font size controls + serif/sans toggle (localStorage), star/archive/delete, link to original.
- `/save?url=&text=&title=` — **share target + bookmarklet endpoint**: extracts first http(s) URL from `url` or `text` param (Google app puts it in `text`), saves, shows confirmation, redirects to `/`. Requires login.
- `/settings` — API tokens CRUD, extension setup instructions, bookmarklet.
- `/login` — Google button (+ dev login button when enabled).

## PWA

- `public/manifest.webmanifest`: name Stash, standalone, icons 192/512 (generated PNGs), `share_target: {action: "/save", method: "GET", params: {url: "url", text: "text", title: "title"}}`.
- `public/sw.js`: minimal — network-first for navigations with offline fallback page, cache-first for static assets. Registered from app layout.

## Chrome extension (MV3, `extension/`)

- Popup: shows current tab title/URL, Save button, status; Options page: server URL + API token (chrome.storage.sync).
- Background service worker: context-menu "Save to Stash". Saves via `POST {server}/api/articles` with Bearer token.
- Host permissions: `https://*/*`, `http://localhost/*`. No build step.

## Docker / GCP

- `web/Dockerfile`: multi-stage (deps → build → runtime), `output: "standalone"`, entrypoint runs `prisma migrate deploy` then `node server.js`. Runs as non-root.
- `docker-compose.yml`: `postgres:16-alpine` + `web` (port 3000), healthchecks.
- `cloudbuild.yaml`: build → push to Artifact Registry → deploy Cloud Run. Substitutions `_REGION/_REPO/_SERVICE` with placeholder defaults; secrets (DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID/SECRET) via Secret Manager refs documented in README. Migrations run on container start.

## Env vars

`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` (prod), `AUTH_DEV_LOGIN` (never in prod), `AUTH_TRUST_HOST=true`. `.env.example` committed; `.env` gitignored.

## File ownership for parallel agents (avoid conflicts)

- **backend**: `web/prisma/**`, `web/src/lib/**`, `web/src/app/api/**`, `web/src/auth.ts`, `web/src/middleware.ts`, `web/src/types.ts`
- **frontend**: `web/src/app/**` except `api/` and `save/`, `web/src/components/**`
- **pwa**: `web/public/**`, `web/src/app/save/**`, SW registration component `web/src/components/pwa/**`
- **extension**: `extension/**`
- **deploy**: `web/Dockerfile`, `.dockerignore`, `docker-compose.yml`, `cloudbuild.yaml`, `README.md`, `.env.example`

## Testing (definition of done — per PROMPT.md)

1. `docker compose up` works; health endpoint green.
2. Playwright (dev server + dev login): login → add URL (self-hosted test article at `/test-article.html`) → appears in list → reader renders content → star/archive/delete → search → share-target `/save?text=...` flow → manifest + SW present.
3. Chrome extension: Playwright persistent context with `--load-extension`; configure token via options page, save a page, verify via API it landed.
4. `npm audit` (org policy) — fix or document.
