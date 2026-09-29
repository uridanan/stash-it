---
title: Working context for Stash
purpose: >
  Carry-over notes for an assistant or developer picking this project up with
  no memory of previous sessions. Records the decisions that are not obvious
  from the code, the mistakes already made and paid for, and what is still
  open — so none of it has to be rediscovered.
audience: whoever works on this next, human or assistant
scope: >
  Decisions and their reasons, hard-won gotchas, current state, verification
  commands, open items. Deliberately NOT a feature list or an architecture
  tour — README.md covers what the app does, PLAN.md covers the original
  design, PROGRESS.md tracks the original build tasks.
read_also:
  - README.md      # what the app is and how to run it
  - PLAN.md        # original design decisions (2026-07-06)
  - PROGRESS.md    # original build task list
maintenance: >
  Update when a decision is made that future work could reasonably get wrong,
  or when a bug is found whose cause was non-obvious. Do not log routine
  changes — git history already has those.
updated: 2026-08-31
head_commit: c2cee83
---

# Working context

## Where things are

Everything lives under `ai-reader/fable/`. The app is `web/` (Next.js 15, App
Router, TypeScript, Tailwind, PostgreSQL + Prisma). `extension/` is the Chrome
extension. The git repo root is two levels up at `D:/Github/uri-playground`,
which is a shared playground — **other people commit unrelated work to
`level-funnel/` constantly**, so expect to rebase before nearly every push.
Nothing outside `ai-reader/fable/` is ours.

`data/` holds a real Instapaper export used to build the importer. It is
gitignored on purpose: it is thousands of genuine URLs and titles and has no
business in a shared repo.

**Four things the app needs are deliberately not in the repository**, so a
fresh clone runs but does less until they exist:

- `web/.env` — local `DATABASE_URL` and dev-login `AUTH_SECRET`.
- `email.env` — mail credentials as handed over, keyed `host/port/sender/pswd`.
  The app never reads it; it exists so `smtp.env` can be regenerated.
- `smtp.env` — the same credentials under the `SMTP_*` names `lib/mail.ts`
  reads. `docker-compose.yml` loads it with `required: false`, so a checkout
  without it starts fine and simply does not offer Send to Kindle.
- `data/`, above.

All four are gitignored (`.gitignore` in this directory). Moving to another
machine means copying them by hand over something private — and the *library*
does not travel with them: it lives in the `db-data` docker volume, and the
way across is the app's own backup, download on one side and restore on the
other. That is what it is for.

## Decisions that are easy to get wrong

**Article bodies are stored as sanitized HTML, and that is deliberate.**
Markdown was considered and rejected for storage: Readability emits HTML, the
reader renders HTML, and Markdown cannot express part of the sanitizer's
allowlist (`figure`/`figcaption`, `dl`, `sub`/`sup`, `abbr`, `time`, merged
table cells). Storing Markdown would move the sanitizer to the render path
rather than remove it, since Markdown permits raw HTML. Markdown is a
**derived, one-way export**. Measured: markup is ~31% of raw bytes and ~27.5%
after gzip, so the size argument for Markdown is real but was outweighed.

**Read/unread is the vocabulary; "archive" is gone from the UI.** The enum
value is still `ARCHIVED` and the route is still `/archive` — both deliberately
unchanged, because the Chrome extension and saved links depend on the API's
`state: unread|archived` values. Surface wording only.

**Two backup formats, on purpose.** `.ndjson.gz` (`/api/export`) is the
exact-fidelity stream. The `.tar.gz` archive (`/api/export/archive`) is
`stash.json` + `links.ndjson` + one HTML file per article. **Entry order in the
archive is load-bearing**: a restored row gets a new id, so the archive
filename (`<id>-<slug>.html`) is the only thing tying a body to its row, and
the link index must therefore be read before any body. Tar rather than zip
because zip's index sits at the end and needs random access, which would force
buffering the whole upload.

**Filenames lead with the article id.** Measured on the real 11.7k library: 238
titles reduce to an empty ASCII slug (Hebrew), 14 are blank, 24 collide. The
slug is decoration.

**Import never overwrites an article it already has.** Correcting one goes
through the reader's Refetch / Resummarize, or delete-then-import. This is why
those actions exist.

**Three independent axes**: fetch content / classify topics / summarise.
Classification reads an article's *content*, never its summary — they were
coupled only by control flow. Splitting them is what allows summaries to
default to on-demand without leaving collections empty, because classification
costs roughly a fifth of the input tokens.

**Three download formats, one loader.** Markdown, PDF and EPUB are all
derived, one-way exports of the same row, so they share
`loadExportArticle` (`lib/export-article.ts`). None of them fetches an
article's images: PDF prints `[image: alt]` and EPUB keeps the original URL
and declares `remote-resources`. An export that crawled every host an
article references would be a very different thing from a download.

**The PDF ships its own fonts, subset to Latin and Hebrew.**
`public/fonts/DejaVu*.ttf` is vendored because PDF's standard 14 fonts are
WinAnsi-only and a real library is full of Hebrew — the same reason the
renderer does its own line breaking for RTL text and reorders each finished
line with `bidi-js`. Wrapping must happen in logical order; reorder a whole
paragraph first and the *lines* come out in the wrong sequence.

The four faces are subsets (~630 KB, was ~2.4 MB) — see
`public/fonts/README.md` for the ranges and the exact `pyftsubset` command.
Note what this does *not* buy: PDFKit already embeds only the glyphs a given
document uses, so the PDFs were never larger for it. The win is the repository
and the container image, and only that. Greek and Cyrillic went with the rest,
so an article in either renders as boxes **in a PDF only**.

**Mail credentials are environment, not user data.** `SMTP_*` configures Send
to Kindle (`lib/mail.ts`). Putting them in the `User` row would mean either
exporting them in a backup or explaining why they are the one setting that is
not — and they belong to whoever runs the app, not to an account. The
*sender* address is read back out and shown in Settings on purpose: Amazon
silently drops mail from an address that is not on your Approved Personal
Document E-mail List, and you cannot approve one the app never tells you.
Kindle gets the EPUB, not the PDF, because Amazon reflows EPUB.

**A collection rename moves its URL.** The slug is re-derived from the new
name and nothing else references it, so a stale `/tags/old-name` 404s. A name
another collection already has is refused rather than suffixed — quietly
creating "reading-2" would hide exactly the situation merge exists for.

**Merge keeps the target's running order.** Incoming articles append after
what the target already holds rather than interleaving, an article in both
collapses to one row, and the source collection is deleted. A collection is a
playlist, so "which order survives" is a real question and the answer is: the
one you merged *into*.

**Filing articles resolves a collection by name, not by id.** `POST /api/tags`
takes `{name, articleIds}` and is the single endpoint behind both "add to an
existing collection" and "make a new one" — `ensureTags` already matches
case-insensitively, so typing the name of one that exists adds to it instead
of creating a near-duplicate. The picker offers a list and a text field
precisely because the server does not care which it was.

**A collection export filters the manifest, the link index and the bodies
together.** `?tag=<slug>` narrows `articleRows` once, inside
`backup-archive.ts`, rather than at each call site — an archive whose counts
disagreed with its contents would restore as a library full of stubs.

**The reader toolbar is icons only, and that was forced.** Ten actions
labelled in words did not fit the width of a split pane. Left half acts on the
view (close, full width, text size), right half on the article (star, read,
download, listen); fetch / summarize / delete sit in an overflow menu because
they are rare and one is irreversible. Every control carries `title` and
`aria-label`, which is the only reason this is not a regression.

**Text size drives a CSS variable, not a font-size.** `--reader-font-size` on
the wrapper is read by `.reader` and `.summary-text`, so A-/A+ resize the
article and its summary while the title, byline and tags stay at chrome size.
Setting `font-size` on the wrapper instead is what used to scale the title
with everything else. The summary reads at the *same* size as the body — it is
the article in fewer words, and a different size made switching tabs look like
the text had changed size.

**One reading font.** The serif/sans toggle is gone; `.reader` is sans. One
fewer decision, and nobody had ever moved it.

**Full width is owned by the panes, not the toolbar.** `SplitPanes` holds the
state (it is the list that has to disappear) and hands it to the toolbar
through `ReaderLayoutProvider`. The context is *absent* on the standalone
`/article/[id]` page, and the toolbar uses that absence to leave the button
out — there is no list there to hide. It only takes effect at `lg` and up.

**Settings is tabbed, and the tab is in the URL.** `?tab=kindle`, parsed on
the server, so the page renders one panel rather than five with four hidden.
That is the real gain, not the visual one: every panel fetches something or
talks to the browser (voices, tokens, settings), and the page used to do all
of it on every visit. Unknown values fall back to the first tab rather than
404ing. The Chrome extension and bookmarklet instructions live with API tokens
because step three of the extension setup needs one.

**Switches, not checkboxes, for settings.** `components/toggle.tsx`. Every
setting here applies the moment it is flipped — none sit in a form waiting for
Save — and a checkbox reads as "will be applied later". A checkbox is still
right for selecting *things*, which is why the article multi-select uses one.

**Confirmations are transient cards, not inline text.** `components/toast.tsx`
docks top-right and clears itself (4s, 8s for an error). Inline messages sat
in the toolbar row, competed with the icons for the same few pixels, and
pushed them sideways as the text changed length.

**Cost is expressed in tokens, never currency.** Provider prices change;
hardcoding them would go stale silently.

**The AI API key is never exported.** An e2e test asserts the string never
appears in a backup.

## Gotchas already paid for

Each of these cost real debugging time. They are all now covered by tests.

- **Turndown strips unknown tags by default.** It does *not* pass unknown HTML
  through. `x<sup>2</sup>` silently became `x2`; definition lists flattened.
  `markdown.ts` has an explicit `KEEP_AS_HTML` list. If you add a tag to the
  sanitizer allowlist, consider whether it belongs there too.
- **Do not gunzip twice.** The import route decompresses to sniff tar-vs-NDJSON
  (tar's `ustar` marker at offset 257), so `unpackArchive` takes **plain tar**.
  Gunzipping inside it threw `Z_DATA_ERROR` as an *uncaught exception* and took
  the server down.
- **A forced refetch cannot derive its own progress.** Job progress is derived
  from the articles (empty content / null `classifiedAt` / null `summary`) so
  jobs resume after a restart — but a refetched article still has content, so
  that query returns the same rows forever. Forced jobs walk by cursor; hence
  `BackgroundJob.force` and `.cursor`.
- **A failed forced refetch must not mark the article failed.** That would
  discard the copy the "fall back to the import" option exists to preserve.
- **`isProduct` / `hasEmbeddedMedia` are stored columns.** They come from
  JSON-LD, `og:type` and embedded players — none of which survive in the saved
  body, because the sanitizer strips embeds and meta tags were never part of
  the article. Without storing them, a restore that re-derives collections
  loses the Shopping and Visual content tags.
- **Reading DOM signals must happen before Readability runs.** It mutates the
  document. See the ordering in `extract.ts`'s `extractArticle`.
- **Emoji-presentation codepoints look wrong in this UI.** `↩` (U+21A9),
  `⏮`/`⏭`/`⏸` (U+23EE/23ED/23F8) render as coloured emoji in most browsers and
  came out cobalt blue in a violet player. Transport icons are inline SVG; the
  read tick uses `↺` (U+21BA), which has no emoji form.
- **PDFKit resolves to its browser build under vitest's jsdom environment**,
  where it can neither read a font file nor embed one ("Not a supported font
  format"). `pdf.test.ts` carries a `// @vitest-environment node` directive for
  exactly that. In Next it is listed in `serverExternalPackages` so the
  compiler leaves its runtime `require()`s alone.
- **A footer below the bottom margin makes PDFKit add a page.** Stamping page
  numbers at `page.height - margin + 18` silently doubled the page count until
  the stamping loop set `doc.page.margins.bottom = 0` first.
- **PDFKit calls `.valueOf()` on every value in `info`.** An article with no
  author *and* no site name made `Author: undefined`, which threw a TypeError
  from the file-identifier hash — a 500 on the PDF download that no test caught
  because the fixture always had both fields. Omit the key, never pass
  undefined.
- **A summary is not part of the body.** It used to travel only inside the
  per-article HTML file in an archive, which a light archive does not contain
  and a full archive skips for an article with no text — so restoring lost it.
  It rides on the link record now; `attachBody` only fills a gap so an older
  archive's body file cannot erase it. The test named for the summary never
  asserted it, which is how this shipped.
- **In the split view, the reader toolbar is the same component instance from
  one article to the next.** Only the server-rendered content beneath it
  changes, so its client state carries over — which is how a "Sent to …" note
  followed the user around the library. Anything stateful in that toolbar has
  to reset on `articleId`.
- **DejaVu Sans Mono has no Hebrew, and never has.** Not something subsetting
  removed. An RTL code block falls back to the proportional face in
  `drawBlock`; without that it printed a row of empty boxes.
- **A missing glyph does not throw.** It prints a box, in a PDF nobody opens
  until later. `fonts.test.ts` pins the subset's coverage (and a size ceiling)
  so a future re-subset fails the suite instead of shipping boxes.
- **fontkit is CommonJS with named exports and no default.** `import fontkit
  from "fontkit"` is `undefined` under vitest; use `createRequire`.
- **An import starts the fill-in job.** So asserting `content === ""` right
  after restoring a light archive is a race — the job fetches the missing text
  in the background. Assert what the archive carried, not what it lacked.
- **Do not race a real worker to assert a conflict.** The job double-start test
  started a forced job and expected the next start to 409, but over a
  one-article library the first job could finish first, so the conflict it
  asserted sometimes did not exist. It inserts a `RUNNING` row directly now.
  Three full suite runs were lost to this before it was fixed rather than
  re-run.
- **The e2e `beforeAll` pays for the first Turbopack compile.** Playwright
  starts its own dev server, so whichever test runs first pays for compiling
  the whole app on top of its own work. Three different spec files timed out
  there before the config timeout went from 60s to 120s — which file runs
  first is not a property of any of them, so per-file overrides were the wrong
  shape of fix.
- **An optimistic control writes after it moves.** The listening switch updates
  on screen and PUTs behind it, so reading `/api/settings` straight afterwards
  races the write, and clicking it twice in a row can land the second click on
  the control while it is disabled mid-save. Poll for the persisted value, and
  restore state over the API rather than by clicking back.
- **A drawn tick on top of an `sr-only` checkbox is not clickable.** The custom
  checkbox hid the real input and painted a box and a tick over it; every
  pointer click landed on the decoration. It is a plain native checkbox with
  `accent-color` now.
- **Clearing a selection unmounts the bar that reports what it did.** The
  "Added N to X" confirmation vanished instantly until the bar learned to stay
  up while a note is present.
- **`getByText("Saved")` is case-insensitive and matches "saved articles".**
  Settings has four such strings; assert on a testid.
- **`type="email"` hides your own validation.** The browser blocks submission
  with its own bubble, so the server's check never runs and the message does
  not match how the rest of the app reports a problem.
- **`ListenProvider` lives in `AppShell`, not the root layout.** Wrapping the
  root layout in a client boundary left React streaming placeholders in the DOM
  and duplicated elements that three spec files select on. AppShell remounts on
  navigation, which is fine: an in-flight playlist resumes from
  `sessionStorage`.
- **Client bundle leaks.** `sort.ts` and `lang.ts` exist because importing from
  `articles.ts` or `auto-tags.ts` in a client component dragged jsdom and the
  Anthropic SDK into the browser build and broke it. Keep client-safe helpers
  in their own modules.
- **Reading speed is scaled before it reaches the engine.** Web Speech `rate`
  is perceptually exaggerated above 1. `rate.ts` passes ≤1 through and
  compresses above it, calibrated by ear to two anchors: 1× = engine 1.0, 2× =
  engine 4/3. Don't "simplify" it back to linear.
- **`nodemailer` is pinned past next-auth's peer range, on purpose.** The
  advisory covering the `raw` message option is fixed in 9.0.5, but
  `next-auth@5.0.0-beta.32` declares `peerOptional nodemailer@^7 || ^8` — so
  plain `npm install` accepts 9.0.5 while `npm ci` (which the Docker build
  runs) refuses it with ERESOLVE. The `nodemailer: ^9.0.5` entry in
  `overrides` is what makes both agree. next-auth only wants it for its Email
  provider, which this app does not use.
- **`npm audit` has an override, not a fix.** `deepmerge-ts` is forced to `^8`
  in `package.json` overrides to clear three advisories reached via
  `@prisma/config`. It forces a **major bump past an exact pin** (`@prisma/config`
  wants `7.1.5` precisely). `npm audit fix --force` would instead downgrade
  Prisma to 6.12.0 — do not run it. If a future Prisma upgrade misbehaves, this
  override is the first thing to remove.

## Verification

Run from `web/`. All of these must be clean before a commit:

```
npm run test:unit        # 298 tests, 18 files (vitest)
npx playwright test      # 103 tests (needs: docker compose up -d db)
npx tsc --noEmit         # see known-noise below
npm run lint
npm run build
```

**Known noise, not regressions:**
- Two `Cannot find name 'chrome'` errors in `e2e/extension.spec.ts` — the
  Chrome extension global, pre-existing, unrelated.
- `Gemini: HTTP 400 — API key not valid` in e2e output — an intentional
  error-path test in `web.spec.ts`.
- `TypeError: controller[kState].transformAlgorithm is not a function` logged by
  the dev server on some imports. **Unexplained.** Isolated to the import
  request path; not caused by the teardown code (verified by removing and then
  narrowing it). Every request returns correctly and all tests pass, so it
  looks like Next dev-mode noise around a consumed request-body stream — but
  that is unproven. Worth a look if it ever appears in production logs.

E2E runs against a throwaway `stash_e2e` database that global setup drops and
rebuilds. **Do not point volume experiments at the dev database** — importing a
real library into the working app is the user's call, not an assistant's.

## Open items

1. **SSRF hardening** — the one thing explicitly discussed and not done.
   `assertHttpUrl` (`extract.ts:61`) checks the scheme only, and the redirect
   loop re-checks the scheme but never the address, which is the standard
   bypass. Reachable today: `db:5432` on the compose network; on Cloud Run
   (`cloudbuild.yaml` deploys there) the GCP metadata endpoint at
   `169.254.169.254`, which hands out service-account tokens. Needs: resolve
   and reject private/loopback/link-local/CGNAT ranges, apply it on **every**
   redirect hop, and pin the resolved IP against DNS rebinding.
   **The blocker is that the e2e suite fetches `http://localhost:3100` by
   design**, so it needs an env-gated allowance (`EXTRACT_ALLOW_PRIVATE=true`
   in `playwright.config.ts`'s `webServer.env` and in dev). Easy to get
   backwards, which is why it wants to be its own change. Mitigating: reaching
   any of it requires an authenticated session on a single-user app.
2. **Backfill scripts, never run against real data.**
   `scripts/backfill-metadata.ts` recovers `publishedAt`/`lang` for articles
   saved before those columns existed; `scripts/fetch-stubs.ts` fetches text
   for imported links. Both re-fetch every URL, so both are slow and will hit
   dead links. `--dry-run` first.
3. **Existing articles have no `publishedAt`**, so they sort last under
   published-date ordering until backfilled.
4. **Two signals only return after a refetch for pre-existing articles** —
   `isProduct`/`hasEmbeddedMedia` default to false on rows saved before the
   column existed.
5. **PDF cannot render Greek or Cyrillic** since the font subset. Everything
   else in the app renders them fine. Widening the ranges in
   `public/fonts/README.md` and re-running the command is the whole fix.
6. **PDF and EPUB do not fetch images.** PDF prints `[image: alt]` linked to
   the source; EPUB keeps the remote URL and declares `remote-resources`,
   which some strict EPUB validators reject. Embedding them would mean
   crawling every host an article references, which is a different feature.
7. **A collection export writes the user's whole tag list into the manifest**,
   not just the exported collection's. Harmless on restore (the definitions
   are tiny and the memberships are per-article) but it is more than the
   archive strictly needs.

## How the user likes to work

- Direct answers, with the reasoning that led to them. Recommendations, not
  option surveys.
- **Claims get checked.** Several statements of mine have not survived being
  probed — "nothing to do about the audit advisories", "Shopping and Visual
  tags don't survive a backup", and a PDF export that passed every test and
  500'd in the actual app. Each time the fix was to run an experiment instead
  of reasoning from the code. Prefer measuring.
- **Verify in the container, not just in dev.** The app the user looks at is
  `localhost:3000`, which is the docker image, not the dev server. A change
  that is only on disk is not a change they can see, and the PDF bug above was
  a 500 in the image while every dev-server test was green. Rebuild, then
  exercise the real endpoint.
- **Credentials arrive as local files and stay there.** Never commit them,
  never print them back, and do not attach them to a conversation — package
  them on disk and hand over a path instead.
- Tests should pin real behaviour. When a test disagrees with the code, work
  out which one is wrong before changing either — several genuine bugs this
  session were found exactly there, and loosening the assertion would have
  shipped them.
- Report honestly: if something is unverified, say so. If a gate fails, show
  it.
- Commit messages explain *why*, not what. Rebase onto the unrelated
  `level-funnel/` work rather than merging.
- Docker is rebuilt after each merged change so the running app matches
  `master`: `docker compose up --build -d`.
