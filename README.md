# Stash — read-it-later

An Instapaper-style read-it-later app: save articles from anywhere (web, Android
share menu, Chrome extension, bookmarklet) and read them later in a clean,
distraction-free reader view.

**Stack:** Next.js 15 (App Router, TypeScript, Tailwind) · PostgreSQL + Prisma ·
Auth.js (next-auth v5) with Google Sign-In · `@mozilla/readability` + `jsdom` +
`sanitize-html` for article extraction · PWA with Web Share Target · Chrome MV3
extension · Docker / Cloud Run.

## Architecture

```
                 ┌───────────────────────────────────────────────┐
                 │                   Clients                     │
                 │                                               │
   Browser ──────┤  Web app (PWA, installable on Android)        │
   Android share ┤  /save  ← Web Share Target (Google app, etc.) │
   Chrome ext ───┤  POST /api/articles       (URL, Bearer token) │
   Agent ────────┤  POST /api/articles/text  (full text)         │
   Bookmarklet ──┤  /save?url=...                                │
                 └───────────────────┬───────────────────────────┘
                                     │ HTTPS
                                     ▼
                 ┌───────────────────────────────────────────────┐
                 │        Next.js 15 (Cloud Run / Docker)        │
                 │                                               │
                 │  Auth.js (Google OAuth, JWT sessions)         │
                 │  /api/articles  /api/tokens  /api/health      │
                 │  Extraction: fetch → Readability → sanitize   │
                 │  Prisma ORM  (migrate deploy on startup)      │
                 └───────────────────┬───────────────────────────┘
                                     │
                                     ▼
                 ┌───────────────────────────────────────────────┐
                 │   PostgreSQL  (Cloud SQL / docker compose)    │
                 │   User · Article · ApiToken                   │
                 └───────────────────────────────────────────────┘
```

Repo layout:

```
fable/
  web/                # Next.js app (Dockerfile inside)
  extension/          # Chrome MV3 extension (no build step)
  docker-compose.yml  # local: postgres + web
  cloudbuild.yaml     # GCP: Cloud Build → Artifact Registry → Cloud Run
```

## Local development

Prereqs: Node 22+, a local PostgreSQL (or use the compose `db` service alone:
`docker compose up db`).

```bash
cd web
cp .env.example .env          # fill in values; defaults match compose db
npm install
npx prisma migrate dev        # create/upgrade the local schema
npm run dev                   # http://localhost:3000
```

Dev login: with `AUTH_DEV_LOGIN=true` in `.env`, the login page shows a
credentials-based **dev login** so you can use the app (and run E2E tests)
without Google OAuth credentials. **Never enable this in production.**

Tests: `npx playwright test` (uses the dev server + dev login).
Before shipping, run `npm audit` and fix or document findings (company policy).

## Run the whole stack with Docker Compose

```bash
docker compose up --build
# app:    http://localhost:3000        (dev login enabled)
# health: http://localhost:3000/api/health
```

The web container applies Prisma migrations on startup (`prisma migrate deploy`)
and then starts the standalone Next.js server. Postgres data persists in the
`db-data` volume; `docker compose down -v` wipes it.

## Google OAuth setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and pick
   (or create) a project.
2. **APIs & Services → OAuth consent screen**: configure the consent screen
   (External, app name "Stash", your support email). Scopes: just the default
   `openid`, `email`, `profile`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: your app origin(s), e.g.
     `http://localhost:3000` and `https://stash.example.com`
   - Authorized redirect URIs: `<origin>/api/auth/callback/google`, e.g.
     `http://localhost:3000/api/auth/callback/google` and
     `https://stash.example.com/api/auth/callback/google`
4. Put the client ID/secret in `web/.env` (`AUTH_GOOGLE_ID`,
   `AUTH_GOOGLE_SECRET`) locally, and in Secret Manager for production
   (see deployment below). Never commit them.

## Chrome extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` directory.
3. In the app, go to **Settings → API tokens**, create a token
   (shown once, format `stash_<32 hex>`).
4. Open the extension's **Options** page: set the server URL
   (e.g. `http://localhost:3000` or your production URL) and paste the token.
5. Save pages via the toolbar popup or the right-click **Save to Stash**
   context menu.

## Adding articles from the API

Two calls, both for an agent or any other client. Create a token in
**Settings → Apps & tokens** (shown once, format `stash_<32 hex>`) and send it
as `Authorization: Bearer stash_…`. A signed-in browser session works too.

Set the server once, then reuse it:

```bash
export STASH_URL=http://localhost:3000
export STASH_TOKEN=stash_your_token_here
```

`collections` is optional on both calls. Each name is attached to the article,
and created if you do not already have that collection. The names are
**additive**: they do not replace the collections the app assigns itself
(length, language, and — after the background pass — topics). Up to 20 names,
each 60 characters or fewer. Matching is case-insensitive, so `"Reading"` and
`"reading"` are the same collection.

A new article responds **201**. Saving something already in the library
responds **200**, un-archives it, and adds any new collection names. The body
is `{ "article": { … } }` either way. The summary is often `null` in that
first response; it, and the topic collections, are filled in afterwards, the
same way as a save from the app.

### Save a URL

`POST /api/articles` fetches the page, extracts the article, and saves it.
This is the same save the app and the Chrome extension use. `url` must be
`http` or `https`.

```bash
curl -sS -X POST "$STASH_URL/api/articles" \
  -H "Authorization: Bearer $STASH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/story",
    "collections": ["Reading", "Work"]
  }'
```

```json
{
  "article": {
    "id": "cm...",
    "url": "https://example.com/story",
    "title": "The headline from the page",
    "state": "UNREAD",
    "summary": null
  }
}
```

Sending the same URL again returns that article (`200`) instead of a second
copy. If extraction fails, the article is still saved, with
`extractionFailed: true` and the hostname as the title.

### Save full text

`POST /api/articles/text` stores text you already have — an email, a note, a
page an agent extracted. Nothing is fetched, and the article has no source
link (`"url": null`). There is no "View original" in the reader.

`text` is required. `title` and `author` are optional; without a title, the
first line of the text is used. Plain text is stored as paragraphs. If the
text contains HTML tags, those tags are sanitized and kept as the body.
Title up to 300 characters, author up to 200, text up to 1,500,000 characters.

```bash
curl -sS -X POST "$STASH_URL/api/articles/text" \
  -H "Authorization: Bearer $STASH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Board update",
    "author": "Ada Lovelace",
    "text": "Revenue grew in the quarter.\n\nCosts did not. The board asked for a written plan.",
    "collections": ["From email", "Work"]
  }'
```

```json
{
  "article": {
    "id": "cm...",
    "url": null,
    "title": "Board update",
    "author": "Ada Lovelace",
    "state": "UNREAD",
    "summary": null
  }
}
```

Sending the **same text** again returns the existing article (`200`) and adds
any new collections. The title and body stay as they were on the first save.
A retry that only changes line endings still matches. Different text creates
a new article.

Posting `text` to `/api/articles` is refused. That call only accepts a URL;
full text goes to `/api/articles/text`.

### Errors

| Status | When |
| --- | --- |
| 401 | Missing or unknown token |
| 400 | Body is not JSON, or `url` / `text` is missing |
| 422 | URL is not http(s), text is empty or too long, or `collections` is not an array of short names |

The body is `{ "error": "…" }`.

## Send to Kindle

The reader's ⋯ menu can mail an article to a Kindle as an EPUB (which reflows on
the device, unlike a PDF). Two halves have to be in place:

1. **A mail transport**, from the environment — the credentials belong to
   whoever runs the app, not to a user account, so they are never stored in the
   database or included in a backup:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587            # 465 turns on implicit TLS automatically
   SMTP_USER=you@gmail.com
   SMTP_PASSWORD=an-app-password   # not your account password
   SMTP_FROM=you@gmail.com
   ```

   With these unset the feature is simply not offered.

2. **The Kindle address**, in **Settings → Kindle**. That page also shows the
   `SMTP_FROM` address, which you must add to Amazon's **Approved Personal
   Document E-mail List** (Manage Your Content and Devices → Preferences →
   Personal Document Settings) — Amazon silently drops mail from anywhere else.

The e2e suite runs with `SMTP_TRANSPORT=json`, which builds and addresses the
message but never delivers it.

## Collections

Every tag is a collection and every collection is a playlist. From a
collection's page you can rename it, merge it into another (the articles move,
the emptied collection is deleted), and download just that collection — as a
backup (`/api/export/archive?tag=<slug>`) or as Markdown
(`/api/export/markdown?tag=<slug>`). On any article list, tick several rows and
**Add to collection** files them together, into a new collection or an existing
one.

## PWA install (Android) & share target

- Visit the app in Chrome on Android, sign in, then use
  **⋮ → Add to Home screen / Install app**.
- Once installed, Stash registers as a **Web Share Target**: in the Google app
  (Discover), Chrome, or most apps, tap **Share → Stash** and the article is
  saved via the `/save` endpoint. Note: the Google app passes the URL in the
  `text` share field rather than `url` — the app handles both.
- A bookmarklet for desktop browsers is available on the Settings page.

## Deploying to Google Cloud (Cloud Run)

One-time setup — replace `$PROJECT_ID`, region, and names as needed (defaults
match `cloudbuild.yaml` substitutions: region `europe-west1`, repo `stash`,
service `stash`).

```bash
gcloud config set project $PROJECT_ID

# 1. Enable required APIs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com

# 2. Artifact Registry repository for the image
gcloud artifacts repositories create stash \
  --repository-format=docker --location=europe-west1

# 3. Cloud SQL (PostgreSQL) instance, database and user
gcloud sql instances create stash-db --database-version=POSTGRES_16 \
  --region=europe-west1 --tier=db-f1-micro
gcloud sql databases create stash --instance=stash-db
gcloud sql users create stash --instance=stash-db --password='<STRONG-PASSWORD>'

# 4. Secret Manager secrets (names must match cloudbuild.yaml)
#    DATABASE_URL uses the Cloud SQL unix socket — Prisma format:
#    postgresql://stash:<PASSWORD>@localhost/stash?host=/cloudsql/$PROJECT_ID:europe-west1:stash-db
printf '%s' 'postgresql://stash:<PASSWORD>@localhost/stash?host=/cloudsql/'"$PROJECT_ID"':europe-west1:stash-db' \
  | gcloud secrets create stash-database-url --data-file=-
openssl rand -base64 32 | gcloud secrets create stash-auth-secret --data-file=-
printf '%s' '<GOOGLE-CLIENT-ID>'     | gcloud secrets create stash-google-id --data-file=-
printf '%s' '<GOOGLE-CLIENT-SECRET>' | gcloud secrets create stash-google-secret --data-file=-

# 5. Grant the Cloud Build service account permission to deploy and read secrets
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CB_SA="$PROJECT_NUMBER@cloudbuild.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$CB_SA" --role=roles/run.admin
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$CB_SA" --role=roles/iam.serviceAccountUser
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$CB_SA" --role=roles/artifactregistry.writer
# Runtime SA (default compute) needs secret access + Cloud SQL client:
RT_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RT_SA" --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RT_SA" --role=roles/cloudsql.client
```

Build & deploy (from the `fable/` directory):

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions _AR_HOSTNAME=europe-west1-docker.pkg.dev,_AR_REPOSITORY=stash,_SERVICE_NAME=stash,_AUTH_URL=https://<your-domain>
```

Connect the service to Cloud SQL (once, after the first deploy — Cloud Build's
deploy step doesn't add it by default; alternatively add
`--add-cloudsql-instances` to the deploy step in `cloudbuild.yaml`):

```bash
gcloud run services update stash --region=europe-west1 \
  --add-cloudsql-instances=$PROJECT_ID:europe-west1:stash-db
```

With the instance attached, Cloud Run mounts the unix socket at
`/cloudsql/<PROJECT>:<REGION>:<INSTANCE>`, which is exactly what the
`?host=/cloudsql/...` form of the `DATABASE_URL` secret points Prisma at.

Finally, add `https://<your-domain>/api/auth/callback/google` to the OAuth
client's authorized redirect URIs (see OAuth setup above), and set `_AUTH_URL`
to the same origin.

Migrations run automatically on container startup (`prisma migrate deploy`).

## Security notes

- Per company policy, secrets live in **Secret Manager** (production) or local
  `.env` files (gitignored) — **never in code, images, or build configs**.
  `web/.env.example` contains placeholders only.
- Rotate credentials on schedule: **API keys every 90 days**, DB passwords and
  service accounts every 6 months. That includes the app's Google OAuth client
  secret, `AUTH_SECRET`, the Cloud SQL password, and any Stash API tokens you
  hand out.
- `AUTH_DEV_LOGIN` must never be set in production.
- Run `npm audit` (and fix or document) before deploying.
