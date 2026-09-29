import { gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { extract } from "tar-stream";
import { PrismaClient } from "@prisma/client";
import { test, expect, type Page } from "@playwright/test";

import { E2E_BASE_URL, E2E_DATABASE_URL } from "./config";

function db() {
  return new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
}

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";
/** Stands in for a generated summary, which would need a real AI key. */
const SEEDED_SUMMARY =
  "THE NEWS\nA seeded summary that must survive a backup.";

test.describe.configure({ mode: "serial" });

let page: Page;
/** The archive taken in the first test, reused by the restore tests. */
let archive: Buffer;

/** Reads a tar.gz into { entryName: body }. */
async function readArchive(gz: Buffer): Promise<Record<string, string>> {
  const tar = extract();
  const out: Record<string, string> = {};
  const done = (async () => {
    for await (const entry of tar) {
      const chunks: Buffer[] = [];
      for await (const chunk of entry) chunks.push(chunk as Buffer);
      out[entry.header.name] = Buffer.concat(chunks).toString("utf8");
    }
  })();
  Readable.from(gunzipSync(gz)).pipe(tar);
  await done;
  return out;
}

async function deleteAllArticles(p: Page) {
  for (const state of ["unread", "archived"]) {
    const res = await p.request.get(`/api/articles?state=${state}&limit=200`);
    if (!res.ok()) continue;
    const body = await res.json();
    for (const a of body.articles ?? []) {
      await p.request.delete(`/api/articles/${a.id}`);
    }
  }
}

async function deleteAllTags(p: Page) {
  const res = await p.request.get("/api/tags");
  if (!res.ok()) return;
  const { tags } = await res.json();
  for (const tag of tags ?? []) {
    await p.request.delete(`/api/tags/${tag.slug}`);
  }
}

async function firstArticle(p: Page) {
  const res = await p.request.get("/api/articles?state=unread&limit=1");
  return (await res.json()).articles[0];
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/login");
  await page.getByTestId("dev-login").click();
  await page.waitForURL(/\/$/);
  await deleteAllArticles(page);
  await deleteAllTags(page);
});

test.afterAll(async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);
  await page.close();
});

test("the archive holds a manifest, a link index and one file per article", async () => {
  const saved = await page.request.post("/api/articles", {
    data: { url: ARTICLE_URL },
  });
  expect(saved.ok()).toBe(true);
  const id = (await saved.json()).article.id;
  await page.request.post(`/api/articles/${id}/tags`, {
    data: { name: "Archive Set" },
  });
  await page.request.put("/api/settings", {
    data: { apiKey: "secret-key-do-not-export" },
  });

  // Seeded straight into the row: generating one needs a real AI key.
  const prisma = db();
  try {
    await prisma.article.update({
      where: { id },
      data: { summary: SEEDED_SUMMARY },
    });
  } finally {
    await prisma.$disconnect();
  }

  const res = await page.request.get("/api/export/archive");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-disposition"]).toMatch(
    /filename="stash-backup-full-\d{4}-\d{2}-\d{2}\.tar\.gz"/,
  );
  archive = Buffer.from(await res.body());

  const entries = await readArchive(archive);
  const names = Object.keys(entries);
  expect(names).toContain("stash.json");
  expect(names).toContain("links.ndjson");
  expect(names.filter((n) => n.startsWith("articles/"))).toHaveLength(1);

  const manifest = JSON.parse(entries["stash.json"]);
  expect(manifest.app).toBe("stash");
  expect(manifest.includesContent).toBe(true);
  expect(manifest.tags.map((t: { name: string }) => t.name)).toContain(
    "Archive Set",
  );

  const link = JSON.parse(entries["links.ndjson"].trim());
  expect(link.url).toBe(ARTICLE_URL);
  expect(link.id).toBeTruthy();
  // The summary rides on the link, not only inside the body file — a light
  // archive has no body files at all.
  expect(link.summary).toBe(SEEDED_SUMMARY);
  // Ordered by playlist position, so the automatic tags come first.
  expect(link.tags.map((t: { name: string }) => t.name)).toContain(
    "Archive Set",
  );
  expect(link.tags.every((t: { position: number }) => t.position > 0)).toBe(true);

  // The body file is named for the archive's own id, which is what lets a
  // restore match it back to the row.
  const bodyName = names.find((n) => n.startsWith("articles/"))!;
  expect(bodyName).toContain(link.id);
  expect(entries[bodyName]).toContain("autoplay");

  // The API key must never travel in a backup.
  const whole = Object.values(entries).join("\n");
  expect(whole).not.toContain("secret-key-do-not-export");
  expect(whole).not.toContain("aiApiKey");
});

test("restoring the archive brings back text, summary and collections", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);

  const res = await page.request.post("/api/import?tags=import", {
    headers: { "content-type": "application/octet-stream" },
    data: archive,
  });
  expect(res.ok()).toBe(true);
  const summary = await res.json();
  expect(summary.articlesCreated).toBe(1);
  expect(summary.bodiesAttached).toBe(1);

  const article = await firstArticle(page);
  expect(article.url).toBe(ARTICLE_URL);
  expect(article.title).toBe(ARTICLE_TITLE);

  const detail = await (
    await page.request.get(`/api/articles/${article.id}`)
  ).json();
  expect(detail.article.content).toContain("autoplay");
  expect(detail.article.summary).toBe(SEEDED_SUMMARY);

  const { tags } = await (await page.request.get("/api/tags")).json();
  expect(tags.map((t: { name: string }) => t.name)).toContain("Archive Set");
});

test("restoring the archive twice adds nothing", async () => {
  const res = await page.request.post("/api/import?tags=import", {
    headers: { "content-type": "application/octet-stream" },
    data: archive,
  });
  expect(res.ok()).toBe(true);
  const summary = await res.json();
  expect(summary.articlesCreated).toBe(0);
  expect(summary.articlesSkipped).toBe(1);
  // The body is already there, so nothing is re-attached either.
  expect(summary.bodiesAttached).toBe(0);
});

test("assigning collections ignores the ones in the file", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);

  const res = await page.request.post("/api/import?tags=assign", {
    headers: { "content-type": "application/octet-stream" },
    data: archive,
  });
  expect(res.ok()).toBe(true);

  const { tags } = await (await page.request.get("/api/tags")).json();
  const names = tags.map((t: { name: string }) => t.name);
  // The file's hand-made collection is not taken...
  expect(names).not.toContain("Archive Set");
  // ...but the deterministic ones are derived from the restored text.
  expect(names).toContain("English");
});

test("tags whose signals cannot be recomputed still survive a restore", async () => {
  // Shopping and Visual content come from signals read off the live page —
  // JSON-LD, og: tags, embedded players — none of which are in the saved body.
  // They are stored so that re-deriving collections on restore keeps them.
  await deleteAllArticles(page);
  await deleteAllTags(page);

  const saved = await page.request.post("/api/articles", {
    data: { url: ARTICLE_URL },
  });
  const id = (await saved.json()).article.id;

  const prisma = db();
  try {
    await prisma.article.update({
      where: { id },
      data: { isProduct: true, hasEmbeddedMedia: true },
    });
    for (const [name, kind] of [
      ["Shopping", "SHOPPING"],
      ["Visual content", "FORMAT"],
    ] as const) {
      const tag = await prisma.tag.create({
        data: {
          userId: (await prisma.article.findUniqueOrThrow({
            where: { id },
            select: { userId: true },
          })).userId,
          name,
          slug: name.toLowerCase().replace(/ /g, "-"),
          kind,
        },
      });
      await prisma.articleTag.create({
        data: { articleId: id, tagId: tag.id, position: 99, source: "AUTO" },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  const gz = Buffer.from(
    await (await page.request.get("/api/export/archive")).body(),
  );

  // Taking the file's collections keeps them, kinds and all.
  await deleteAllArticles(page);
  await deleteAllTags(page);
  await page.request.post("/api/import?tags=import", {
    headers: { "content-type": "application/octet-stream" },
    data: gz,
  });
  let names = (
    await (await page.request.get("/api/tags")).json()
  ).tags.map((t: { name: string }) => t.name);
  expect(names).toContain("Shopping");
  expect(names).toContain("Visual content");

  // And re-deriving them keeps them too, because the signals were stored.
  await deleteAllArticles(page);
  await deleteAllTags(page);
  await page.request.post("/api/import?tags=assign", {
    headers: { "content-type": "application/octet-stream" },
    data: gz,
  });
  names = (
    await (await page.request.get("/api/tags")).json()
  ).tags.map((t: { name: string }) => t.name);
  expect(names).toContain("Shopping");
  expect(names).toContain("Visual content");
});

test("the content-excluded export carries no article bodies", async () => {
  const res = await page.request.get("/api/export/archive?content=exclude");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-disposition"]).toMatch(
    /filename="stash-backup-light-\d{4}-\d{2}-\d{2}\.tar\.gz"/,
  );
  const entries = await readArchive(Buffer.from(await res.body()));
  const names = Object.keys(entries);

  expect(names).toContain("stash.json");
  expect(names).toContain("links.ndjson");
  expect(names.filter((n) => n.startsWith("articles/"))).toHaveLength(0);
  expect(JSON.parse(entries["stash.json"]).includesContent).toBe(false);
  // The link index is still complete, so the structure restores in full.
  expect(entries["links.ndjson"].trim().split("\n")).toHaveLength(1);
});

test("the Markdown export has frontmatter, a summary section and an index", async () => {
  const article = await firstArticle(page);
  // Seed a summary so the section has something to hold.
  await page.request.post(`/api/articles/${article.id}/tags`, {
    data: { name: "no" }, // a tag name YAML 1.1 would read as false
  });

  const res = await page.request.get("/api/export/markdown");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-disposition"]).toMatch(
    /filename="stash-markdown-\d{4}-\d{2}-\d{2}\.tar\.gz"/,
  );

  const entries = await readArchive(Buffer.from(await res.body()));
  expect(Object.keys(entries)).toContain("index.md");

  const md = Object.entries(entries).find(([n]) => n.endsWith(".md") && n !== "index.md");
  expect(md).toBeTruthy();
  const [, body] = md!;
  expect(body.startsWith("---\n")).toBe(true);
  expect(body).toContain(`title: "${ARTICLE_TITLE}"`);
  // The hazardous tag name is quoted, so another parser cannot coerce it.
  expect(body).toContain('"no"');
  expect(body).toContain("## Article");
  // Prose became Markdown rather than staying HTML.
  expect(body).not.toContain("<p>");

  expect(entries["index.md"]).toContain(ARTICLE_TITLE);
});

test("a single article downloads as Markdown", async () => {
  const article = await firstArticle(page);
  const res = await page.request.get(`/api/articles/${article.id}/markdown`);
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("text/markdown");
  expect(res.headers()["content-disposition"]).toContain(article.id);

  const body = await res.text();
  expect(body).toContain(`# ${ARTICLE_TITLE}`);
  expect(body).toContain("[Original]");
});

test("a single article downloads as PDF", async () => {
  const article = await firstArticle(page);
  const res = await page.request.get(`/api/articles/${article.id}/pdf`);
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect(res.headers()["content-disposition"]).toContain(`${article.id}`);
  expect(res.headers()["content-disposition"]).toContain(".pdf");

  const body = await res.body();
  expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  // The embedded font is what makes non-ASCII titles survive; a standard
  // PDF font would silently drop them.
  expect(body.toString("latin1")).toContain("FontFile2");
});

test("a single article downloads as EPUB", async () => {
  const article = await firstArticle(page);
  const res = await page.request.get(`/api/articles/${article.id}/epub`);
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("application/epub+zip");
  expect(res.headers()["content-disposition"]).toContain(".epub");

  const body = await res.body();
  // mimetype must be the first entry and stored uncompressed.
  expect(body.subarray(30, 38).toString("ascii")).toBe("mimetype");
  expect(body.subarray(38, 58).toString("ascii")).toBe("application/epub+zip");
});

test("downloading an article that is not yours is a 404", async () => {
  for (const format of ["markdown", "pdf", "epub"]) {
    const res = await page.request.get(`/api/articles/does-not-exist/${format}`);
    expect(res.status()).toBe(404);
  }
});

test("the reader's download menu offers all three formats", async () => {
  const article = await firstArticle(page);
  await page.goto(`/article/${article.id}`);

  await page.getByTestId("download-menu").click();
  await expect(page.getByTestId("download-markdown")).toHaveAttribute(
    "href",
    `/api/articles/${article.id}/markdown`,
  );
  await expect(page.getByTestId("download-pdf")).toHaveAttribute(
    "href",
    `/api/articles/${article.id}/pdf`,
  );
  await expect(page.getByTestId("download-epub")).toHaveAttribute(
    "href",
    `/api/articles/${article.id}/epub`,
  );

  // Escape closes the menu.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("download-markdown")).toHaveCount(0);
});

test("the reader hides refetch and summarize behind the overflow menu", async () => {
  const article = await firstArticle(page);
  await page.goto(`/article/${article.id}`);

  await expect(page.getByTestId("refetch-article")).toHaveCount(0);
  await page.getByTestId("article-actions").click();
  await expect(page.getByTestId("refetch-article")).toBeVisible();
  await expect(page.getByTestId("delete-article")).toBeVisible();

  // Refetch replaces the text in place and keeps the article readable.
  await page.getByTestId("refetch-article").click();
  await expect(page.getByTestId("reader-content")).toContainText("autoplay", {
    timeout: 30_000,
  });
});

test("the jobs endpoint reports what each axis has outstanding", async () => {
  const res = await page.request.get("/api/jobs");
  expect(res.ok()).toBe(true);
  const body = await res.json();

  expect(body.remaining).toHaveProperty("FETCH_CONTENT");
  expect(body.remaining).toHaveProperty("CLASSIFY");
  expect(body.remaining).toHaveProperty("SUMMARIZE");
  // The estimate is in tokens, and names the model so it can be priced.
  expect(body.summarizeEstimate).toHaveProperty("inputTokens");
  expect(body.summarizeEstimate).toHaveProperty("outputTokens");
  expect(body.summarizeEstimate.needsConfirmation).toBe(false); // one article
});

test("a job runs and can be cancelled", async () => {
  const start = await page.request.post("/api/jobs", {
    data: { type: "FETCH_CONTENT", force: true },
  });
  expect(start.status()).toBe(201);
  const { job } = await start.json();
  expect(job.type).toBe("FETCH_CONTENT");

  await page.request.post("/api/jobs", { data: { cancel: job.id } });
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/jobs");
        return (await res.json()).active;
      },
      { timeout: 30_000 },
    )
    .toBeNull();
});

test("a second job is refused while one is running", async () => {
  // The RUNNING row is inserted directly rather than by starting a real job:
  // over a one-article library a forced fetch can finish before the second
  // request even arrives, which made this assertion a coin toss.
  const prisma = db();
  try {
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    const running = await prisma.backgroundJob.create({
      data: { userId: user.id, type: "FETCH_CONTENT", status: "RUNNING", total: 99 },
      select: { id: true },
    });

    const res = await page.request.post("/api/jobs", { data: { type: "CLASSIFY" } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/already running/i);

    await prisma.backgroundJob.delete({ where: { id: running.id } });
  } finally {
    await prisma.$disconnect();
  }
});

test("the jobs endpoint rejects an unknown type", async () => {
  const res = await page.request.post("/api/jobs", {
    data: { type: "MAKE_TEA" },
  });
  expect(res.status()).toBe(422);
});

test("a tar that is not a Stash archive is refused", async () => {
  const { pack } = await import("tar-stream");
  const { gzipSync } = await import("node:zlib");
  const tar = pack();
  tar.entry({ name: "notes.txt" }, "nothing to see");
  tar.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of tar) chunks.push(chunk as Buffer);

  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: gzipSync(Buffer.concat(chunks)),
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/stash\.json/i);
});

test("a light archive restores the summary it has no body for", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);

  const saved = await page.request.post("/api/articles", {
    data: { url: ARTICLE_URL },
  });
  const id = (await saved.json()).article.id;
  const prisma = db();
  try {
    await prisma.article.update({
      where: { id },
      data: { summary: SEEDED_SUMMARY },
    });
  } finally {
    await prisma.$disconnect();
  }

  const light = Buffer.from(
    await (await page.request.get("/api/export/archive?content=exclude")).body(),
  );
  const entries = await readArchive(light);
  expect(Object.keys(entries).filter((n) => n.startsWith("articles/"))).toHaveLength(
    0,
  );

  await deleteAllArticles(page);
  await deleteAllTags(page);
  const res = await page.request.post("/api/import?tags=import", {
    headers: { "content-type": "application/octet-stream" },
    data: light,
  });
  expect(res.ok()).toBe(true);

  const article = await firstArticle(page);
  const detail = await (
    await page.request.get(`/api/articles/${article.id}`)
  ).json();
  // The archive carried no body for it, and the summary still came back.
  // (Article text is deliberately not asserted here: an import starts the
  // fill-in job, which fetches the missing text in the background.)
  expect(detail.article.summary).toBe(SEEDED_SUMMARY);
});
