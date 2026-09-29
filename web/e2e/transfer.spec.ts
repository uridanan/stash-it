import { gunzipSync, gzipSync } from "node:zlib";
import { test, expect, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "./config";

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";

test.describe.configure({ mode: "serial" });

let page: Page;
/** The backup taken in the first test, reused by the restore tests. */
let backup: Buffer;

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

function records(gz: Buffer): Record<string, unknown>[] {
  return gunzipSync(gz)
    .toString("utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
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

test("export is gzipped NDJSON, and carries no API key", async () => {
  const saved = await page.request.post("/api/articles", {
    data: { url: ARTICLE_URL },
  });
  expect(saved.ok()).toBe(true);
  const articleId = (await saved.json()).article.id;
  await page.request.post(`/api/articles/${articleId}/tags`, {
    data: { name: "Backup Set" },
  });
  // A key that must never leave in a backup.
  await page.request.put("/api/settings", {
    data: { apiKey: "secret-key-do-not-export" },
  });

  const res = await page.request.get("/api/export");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("gzip");
  expect(res.headers()["content-disposition"]).toMatch(
    /attachment; filename="stash-export-\d{4}-\d{2}-\d{2}\.ndjson\.gz"/,
  );

  backup = Buffer.from(await res.body());
  // Gzip magic bytes.
  expect(backup[0]).toBe(0x1f);
  expect(backup[1]).toBe(0x8b);

  const lines = records(backup);
  expect(lines[0].type).toBe("meta");
  expect(lines[0].app).toBe("stash");

  const article = lines.find((l) => l.type === "article");
  expect(article?.url).toBe(ARTICLE_URL);
  expect(String(article?.content)).toContain("autoplay");
  // Collection membership and its order travel with the article.
  expect(article?.tags).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "Backup Set" })]),
  );

  expect(lines.some((l) => l.type === "tag")).toBe(true);

  const raw = gunzipSync(backup).toString("utf8");
  expect(raw).not.toContain("secret-key-do-not-export");
  expect(raw).not.toContain("aiApiKey");
});

test("restoring into an empty account brings everything back", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);
  expect(await (await page.request.get("/api/articles")).json()).toMatchObject({
    articles: [],
  });

  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: backup,
  });
  expect(res.ok()).toBe(true);
  const summary = await res.json();
  expect(summary.articlesCreated).toBe(1);
  expect(summary.articlesSkipped).toBe(0);

  const { articles } = await (
    await page.request.get("/api/articles?state=unread")
  ).json();
  expect(articles).toHaveLength(1);
  expect(articles[0].url).toBe(ARTICLE_URL);
  expect(articles[0].title).toBe(ARTICLE_TITLE);

  // The collection came back with it.
  const { tags } = await (await page.request.get("/api/tags")).json();
  expect(tags.map((t: { name: string }) => t.name)).toContain("Backup Set");
});

test("restoring the same file twice adds nothing", async () => {
  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: backup,
  });
  expect(res.ok()).toBe(true);
  const summary = await res.json();
  expect(summary.articlesCreated).toBe(0);
  expect(summary.articlesSkipped).toBe(1);

  const { articles } = await (
    await page.request.get("/api/articles?state=unread")
  ).json();
  expect(articles).toHaveLength(1);
});

test("an uncompressed backup is accepted too", async () => {
  await deleteAllArticles(page);
  const plain = gunzipSync(backup);
  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: plain,
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).articlesCreated).toBe(1);
});

test("a file that is not a backup is rejected without writing", async () => {
  const before = (await (await page.request.get("/api/articles")).json())
    .articles.length;

  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.from('{"type":"article","url":"https://example.com/x"}\n'),
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/does not look like a Stash backup/i);

  const after = (await (await page.request.get("/api/articles")).json())
    .articles.length;
  expect(after).toBe(before);
});

test("Instapaper CSV imports with folders, stars and tags mapped", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);

  const csv = [
    "URL,Title,Selection,Folder,Timestamp,Tags",
    `${ARTICLE_URL},A read one,,Archive,1751000000,"[""product management""]"`,
    `${ARTICLE_URL}?b=1,An unread one,,Unread,1751000100,[]`,
    `${ARTICLE_URL}?c=1,A starred one,,Starred,1751000200,[]`,
    "www.example.com,Bare hostname,,Unread,1751000300,[]",
    "javascript:alert(1),Not a link,,Unread,1751000400,[]",
    "",
  ].join("\n");

  const res = await page.request.post("/api/import/instapaper", {
    headers: { "content-type": "text/csv" },
    data: csv,
  });
  expect(res.ok()).toBe(true);
  const summary = await res.json();
  expect(summary.articlesCreated).toBe(4); // the javascript: row is refused
  expect(summary.rowsSkipped).toBe(1);

  const unread = (
    await (await page.request.get("/api/articles?state=unread&limit=50")).json()
  ).articles;
  const read = (
    await (
      await page.request.get("/api/articles?state=archived&limit=50")
    ).json()
  ).articles;

  expect(read.map((a: { title: string }) => a.title)).toContain("A read one");
  expect(unread.map((a: { title: string }) => a.title)).toContain(
    "An unread one",
  );

  // Starred is a folder in Instapaper, so it says nothing about read state:
  // those rows arrive starred and unread.
  const starred = unread.find(
    (a: { title: string }) => a.title === "A starred one",
  );
  expect(starred.starred).toBe(true);

  // A bare hostname is recovered rather than dropped.
  expect(unread.map((a: { url: string }) => a.url)).toContain(
    "https://www.example.com",
  );

  // Tags became a collection.
  const { tags } = await (await page.request.get("/api/tags")).json();
  expect(tags.map((t: { name: string }) => t.name)).toContain(
    "product management",
  );
});

test("an imported article offers to fetch its text, then reads normally", async () => {
  const { articles } = await (
    await page.request.get("/api/articles?state=archived&limit=50")
  ).json();
  const stub = articles.find((a: { title: string }) => a.title === "A read one");
  expect(stub).toBeTruthy();

  await page.goto(`/article/${stub.id}`);
  // Imports carry no article text, so the reader offers to go and get it.
  await expect(page.getByTestId("fetch-text")).toBeVisible();

  await page.getByTestId("fetch-text-button").click();
  await expect(page.getByTestId("fetch-text")).toBeHidden({ timeout: 30_000 });

  const content = page.getByTestId("reader-content");
  await expect(content).toBeVisible();
  await expect(content).toContainText("autoplay");

  // Fetching also applies the automatic tags that had no content to run on.
  const { tags } = await (await page.request.get("/api/tags")).json();
  expect(tags.map((t: { name: string }) => t.name)).toContain("English");
});

test("script tags in a backup are stripped, not stored", async () => {
  await deleteAllArticles(page);

  // A hand-edited or third-party backup is untrusted input, and this content
  // is later rendered with dangerouslySetInnerHTML.
  const hostile = [
    JSON.stringify({
      type: "meta",
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "stash",
      counts: { articles: 1, tags: 0 },
    }),
    JSON.stringify({
      type: "article",
      url: "https://example.com/hostile",
      title: "Hostile",
      siteName: null,
      author: null,
      excerpt: null,
      content:
        '<p>ok</p><script>window.__pwned = 1;</script>' +
        '<img src=x onerror="window.__pwned = 2">' +
        '<a href="javascript:window.__pwned=3">link</a>',
      wordCount: 1,
      readingMinutes: 1,
      leadImageUrl: null,
      state: "UNREAD",
      starred: false,
      extractionFailed: false,
      summary: null,
      savedAt: new Date().toISOString(),
      readAt: null,
      publishedAt: null,
      lang: null,
      classifiedAt: null,
      tags: [],
    }),
    "",
  ].join("\n");

  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.from(hostile),
  });
  expect(res.ok()).toBe(true);

  const { articles } = await (
    await page.request.get("/api/articles?state=unread&limit=10")
  ).json();
  const stored = articles.find((a: { url: string }) =>
    a.url.includes("hostile"),
  );
  expect(stored).toBeTruthy();

  const detail = await (
    await page.request.get(`/api/articles/${stored.id}`)
  ).json();
  const content: string = detail.article.content;
  expect(content).toContain("ok");
  expect(content).not.toContain("<script");
  expect(content).not.toContain("onerror");
  expect(content).not.toContain("javascript:");

  // And nothing executes when the reader renders it.
  await page.goto(`/article/${stored.id}`);
  await expect(page.getByTestId("reader-content")).toBeVisible();
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("a gzip bomb is refused rather than expanded", async () => {
  // ~100MB of zeros in a few hundred KB of gzip: a legitimate backup never
  // has anything like this expansion ratio.
  const bomb = gzipSync(Buffer.alloc(100 * 1024 * 1024, 0x41), { level: 9 });
  expect(bomb.byteLength).toBeLessThan(1024 * 1024);

  const res = await page.request.post("/api/import", {
    headers: { "content-type": "application/octet-stream" },
    data: bomb,
  });
  // Refused for being unreadable or oversized — never quietly inflated.
  expect([413, 422]).toContain(res.status());
});

test("importing a CSV that is not from Instapaper is refused", async () => {
  const res = await page.request.post("/api/import/instapaper", {
    headers: { "content-type": "text/csv" },
    data: "name,age\nada,36\n",
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/URL/);
});
