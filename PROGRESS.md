# PROGRESS.md

Task list for the Stash build. Statuses: `[ ]` todo, `[~]` in progress, `[x]` done.
Resume rule: find the first non-`[x]` task, re-read PLAN.md, continue.

## Phase 0 — Setup
- [x] Confirm requirements with user (PWA share target, Google Sign-In, Next.js+Postgres+Prisma, Cloud Run config)
- [x] Write PLAN.md
- [x] Write PROGRESS.md
- [x] Scaffold Next.js app in `web/` (TS, App Router, Tailwind, src dir) + install deps (prisma, next-auth@beta, readability, jsdom, sanitize-html)

## Phase 1 — Parallel build (Workflow: backend / frontend / pwa / extension / deploy agents)
<!-- workflow run wf_f89cf83e-bb4 (task w5fcw7elc) launched; local pg on :5434 (container stash-dev-db), web/.env written -->
- [x] Workflow launched with 5 agents (see labels build:*)
- [x] Backend: Prisma schema + migrations, auth (Google + dev login), extraction lib, all /api routes, bearer-token auth
- [x] Frontend: layout, list pages (/, /archive, /starred), reader (/article/[id]), /settings, /login, components
- [x] PWA: manifest.webmanifest with share_target, icons, sw.js, SW registration, /save page, /test-article.html fixture
- [x] Extension: MV3 popup + options + background service worker
- [x] Deploy: Dockerfile, .dockerignore, docker-compose.yml, cloudbuild.yaml, .env.example, README.md

## Phase 2 — Integration
- [x] `npm install`, generate Prisma client, create initial migration against local postgres
- [x] `npm run build` passes; fix type/lint/integration errors
- [x] Dev server boots; dev login works; manual smoke of save→list→read

## Phase 3 — Testing (definition of done)
- [x] `docker compose up` → web healthy against postgres (prisma migrate deploy on boot)
- [x] Playwright web E2E: login, save URL, list, reader, star/archive/delete, search, /save share-target flow, PWA manifest+SW
- [x] Chrome extension E2E: load unpacked in Playwright, configure server+token, save current tab, verify article created
- [x] `npm audit` run; vulnerabilities fixed or documented (org policy)

## Phase 4 — Wrap up
- [x] Final PROGRESS/README pass; deployment instructions verified for placeholders
- [x] Commit (branch stash-app)

## Outcome notes (2026-07-06)
- Full E2E suite (11 web + 4 extension tests) passes against BOTH `npm run dev` and the production Docker image.
- `npm audit`: 0 vulnerabilities after adding a package.json override pinning next's nested postcss to ^8.5.10 (GHSA-qx2v-qp2m-jg93); `npm audit fix --force` was NOT used.
- Dockerfile fix: prisma CLI installed as a self-contained layer (migrate-cli stage) because cherry-picked node_modules lacked transitive deps (`effect`).
- Compose: db published on host 5435 (5432 was taken locally); healthcheck uses 127.0.0.1 (busybox wget resolves localhost to ::1).
- Local dev DB: container `stash-dev-db` on :5434 (web/.env points there).

## Bugfix notes (2026-08-09)
- Extraction failed for Yahoo Finance links: Yahoo bounces non-browser clients through a cookie-gated consent redirect chain (finance → guce → consent.yahoo.com), and Node's fetch drops cookies between redirects. Fixed in `web/src/lib/extract.ts`: manual redirect-following with a per-request cookie jar, plus auto-submitting consent.yahoo.com's "agree" form when it still dead-ends there. Regression check: `web/scripts/repro-consent-redirect.ts` (run with `npx tsx`).
- Known gap: re-saving a URL whose article has `extractionFailed=true` does NOT retry extraction (delete + re-add is the workaround).
## AI summaries (2026-08-11)
- English summaries per article, "THE NEWS" + "KEY INSIGHTS" format; insights are the article's own stated conclusions (prompt forbids model inference). Video/thin pages summarized from available text, prefixed "Video:", no invention.
- BYO-key, user-configurable in Settings → AI summaries: enable toggle, model picker (Gemini 3.1 Pro default `gemini-3.1-pro-preview`, 3.6 Flash, 3.5 Flash-Lite; Claude Opus/Sonnet 5, Haiku 4.5; Grok 4.5, 4.3 — note Grok 4.1 Fast retired May 2026, redirects to 4.3), API key (write-only, masked hint), editable prompt (default in `web/src/lib/summarize.ts`), display choice card ⇄ tabs.
- Plumbing: `lib/summarize.ts` (Anthropic via @anthropic-ai/sdk; Gemini + Grok via REST), `GET/PUT /api/settings`, `POST /api/articles/:id/summary` (manual/regenerate), fire-and-forget generation on save (`articles.ts`), `Article.summary` + User AI columns (migration `ai-summaries`). Reader renders `SummaryCard` or `SummaryTabs` per setting; "Generate summary" button when missing.
- e2e: settings roundtrip + key masking + generate-button error path covered (runs with a bogus key, no real provider calls).
- Follow-ups (2026-08-11): enable checkbox → toggle switch (role=switch); video links — prompt instructs transcript extraction, and for YouTube URLs on Gemini models the video itself is attached via `file_data` so the model actually transcribes it (other providers use page text/captions); e2e suite now fully isolated — global setup drop/recreates a dedicated `stash_e2e` database (name-guarded, `migrate deploy`) and Playwright runs its own dev server on :3100, so dev data (articles, settings, keys) is never touched by test runs. Gemini keys: new `AQ.`-format keys work with `x-goog-api-key`; a 401 "Expected OAuth 2 access token" means the key itself is invalid (regenerate at aistudio.google.com/apikey).

## Desktop split view (2026-08-09)
- List pages (/, /archive, /starred) show a master–detail layout on lg+ screens: independently scrolling article list left, reader pane right. Selection is URL-driven (`?article=<id>`, coexists with `?q=`): `web/src/components/split-view.tsx` renders the pane server-side; `article-row.tsx` intercepts clicks at lg+ (matchMedia) and pushes the param, smaller screens still navigate to `/article/[id]` (kept for mobile/deep links/share flow). Reader markup extracted to `web/src/components/article-reader.tsx`, shared by both. Archive/delete inside the pane clears the selection instead of jumping to `/` (`exitReader` in reader-controls).
- Pane divider is draggable (`web/src/components/split-panes.tsx`, client): pointer-capture drag clamped to 280–720px, arrow keys, double-click resets to 416px, width persisted in localStorage (`stash:split-width`).

## Sidebar navigation (2026-08-09)
- Top header replaced by a collapsible sidebar: `web/src/components/app-shell.tsx` (server: auth + sign-out action + main column) wrapping `web/src/components/sidebar.tsx` (client). Desktop: full sidebar ⇄ icon rail, state in localStorage (`stash:sidebar-collapsed`); mobile: fixed top bar + overlay drawer. `header.tsx` deleted; pages render `<AppShell active=… q=…>` instead of `<Header/>` + `<main>`. Reader controls stick below the mobile bar (`top-12 md:top-0`).
- Note: running the Playwright suite deletes all of the dev user's articles (shared dev DB) — re-add test data after e2e runs.

## Palette change (2026-08-09)
- Re-skinned from warm (amber accent, neutral/stone grays, warm paper) to cool: violet leads (buttons, links, focus, callouts, PWA/extension icons + theme color, favicon), cyan accents (starred state, reader blockquote border), slate grays everywhere (`paper` #f8fafc, `ink` #1e293b). Red kept for destructive actions only. Icons/favicon are generated: `web/public/icons/generate.mjs`, `extension/icons/generate.mjs` (favicon PNG inside the ICO must be RGBA — Next's build rejects RGB).

- `npm audit`: back to 0 vulnerabilities — `npm audit fix`, next bumped 15.5.20 → ^15.5.23, and a package.json override pinning next's nested `sharp` to ^0.35.0.

