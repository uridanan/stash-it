import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { extract } from "tar-stream";
import { test, expect, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "./config";

/**
 * Managing collections rather than reading them: rename, merge, filing a
 * multi-article selection, downloading one collection, and Send to Kindle.
 *
 * Kindle runs against `SMTP_TRANSPORT=json` (set in playwright.config.ts), so
 * the message is built, addressed and attached to for real and then thrown
 * away instead of delivered.
 */

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const SECOND_URL = `${E2E_BASE_URL}/test-article.html?second=1`;

test.describe.configure({ mode: "serial" });

let page: Page;

async function deleteAllArticles(p: Page) {
  for (const state of ["unread", "archived"]) {
    const res = await p.request.get(`/api/articles?state=${state}&limit=100`);
    if (!res.ok()) continue;
    const body = await res.json();
    for (const article of body.articles ?? []) {
      await p.request.delete(`/api/articles/${article.id}`);
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

async function save(p: Page, url: string): Promise<string> {
  const res = await p.request.post("/api/articles", { data: { url } });
  expect(res.ok()).toBe(true);
  return (await res.json()).article.id as string;
}

async function addTag(p: Page, articleId: string, name: string) {
  const res = await p.request.post(`/api/articles/${articleId}/tags`, {
    data: { name },
  });
  expect(res.ok()).toBe(true);
}

async function articleIds(p: Page): Promise<string[]> {
  const res = await p.request.get("/api/articles?state=unread&limit=100");
  const body = await res.json();
  return (body.articles ?? []).map((article: { id: string }) => article.id);
}

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
  await page.request.put("/api/settings", { data: { kindleEmail: "" } });
  await page.close();
});

test("a collection can be renamed, and its URL follows the new name", async () => {
  const id = await save(page, ARTICLE_URL);
  await addTag(page, id, "Weekly Reading");

  await page.goto("/tags/weekly-reading");
  await page.getByTestId("collection-actions").click();
  await page.getByTestId("collection-rename").click();
  await page.getByTestId("collection-rename-input").fill("Monday Reading");
  await page.getByTestId("collection-rename-save").click();

  await page.waitForURL(/\/tags\/monday-reading/);
  await expect(
    page.getByRole("heading", { name: "Monday Reading" }),
  ).toBeVisible();

  // The old address is gone, not silently aliased.
  expect((await page.request.get("/api/tags/weekly-reading")).status()).toBe(404);
});

test("renaming onto a name already in use is refused", async () => {
  const ids = await articleIds(page);
  await addTag(page, ids[0], "Later");

  const res = await page.request.patch("/api/tags/later", {
    data: { name: "Monday Reading" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/already have a collection/i);
});

test("an empty name is refused", async () => {
  const res = await page.request.patch("/api/tags/later", {
    data: { name: "   " },
  });
  expect(res.status()).toBe(422);
});

test("merging moves the articles, keeps the target's order, and deletes the source", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);
  const first = await save(page, ARTICLE_URL);
  const second = await save(page, SECOND_URL);
  await addTag(page, first, "Keep");
  await addTag(page, second, "Fold In");

  const res = await page.request.patch("/api/tags/fold-in", {
    data: { mergeInto: "keep" },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).moved).toBe(1);

  // The source is gone...
  expect((await page.request.get("/api/tags/fold-in")).status()).toBe(404);
  // ...and the target holds both, the incoming one appended after what it had.
  const keep = await (await page.request.get("/api/tags/keep")).json();
  expect(keep.articleIds).toEqual([first, second]);
});

test("merging does not duplicate an article both collections hold", async () => {
  const ids = await articleIds(page);
  await addTag(page, ids[0], "Overlap A");
  await addTag(page, ids[0], "Overlap B");

  const res = await page.request.patch("/api/tags/overlap-a", {
    data: { mergeInto: "overlap-b" },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).moved).toBe(0);

  const target = await (await page.request.get("/api/tags/overlap-b")).json();
  expect(target.articleIds).toEqual([ids[0]]);
});

test("a collection cannot be merged into itself or into thin air", async () => {
  const self = await page.request.patch("/api/tags/overlap-b", {
    data: { mergeInto: "overlap-b" },
  });
  expect(self.status()).toBe(422);

  const nowhere = await page.request.patch("/api/tags/overlap-b", {
    data: { mergeInto: "no-such-collection" },
  });
  expect(nowhere.status()).toBe(422);
});

test("merging from the collection page lands on the collection it went into", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);
  const first = await save(page, ARTICLE_URL);
  const second = await save(page, SECOND_URL);
  await addTag(page, first, "Target");
  await addTag(page, second, "Source");

  await page.goto("/tags/source");
  await page.getByTestId("collection-actions").click();
  await page.getByTestId("collection-merge").click();
  await page
    .getByTestId("collection-merge-target")
    .selectOption({ label: "Target" });
  await page.getByTestId("collection-merge-save").click();

  await page.waitForURL(/\/tags\/target/);
  await expect(page.getByTestId("collection-list")).toHaveCount(1);
  expect((await page.request.get("/api/tags/source")).status()).toBe(404);
});

test("several articles can be selected from a list and filed together", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);
  const first = await save(page, ARTICLE_URL);
  const second = await save(page, SECOND_URL);

  await page.goto("/");
  // No bar until something is ticked.
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);

  await page.getByTestId(`select-article-${first}`).check();
  await page.getByTestId(`select-article-${second}`).check();
  await expect(page.getByTestId("selection-bar")).toContainText("2 selected");

  await page.getByTestId("selection-add-to-collection").click();
  await page.getByTestId("selection-add-new").click();
  await page.getByTestId("selection-new-collection").fill("Reading Pile");
  await page.getByTestId("selection-new-collection-save").click();

  await expect(page.getByTestId("selection-note")).toContainText("Added 2");

  const pile = await (await page.request.get("/api/tags/reading-pile")).json();
  // Filed in the order they were picked.
  expect(pile.articleIds).toEqual([first, second]);
});

test("filing a selection that overlaps says how many were already there", async () => {
  const ids = await articleIds(page);
  await page.goto("/");
  await page.getByTestId(`select-article-${ids[0]}`).check();

  await page.getByTestId("selection-add-to-collection").click();
  await page.getByTestId("selection-add-reading-pile").click();

  await expect(page.getByTestId("selection-note")).toContainText("already there");
});

test("filing by a name that already exists in another case reuses it", async () => {
  const ids = await articleIds(page);
  const res = await page.request.post("/api/tags", {
    data: { name: "reading PILE", articleIds: [ids[0]] },
  });
  expect(res.status()).toBe(201);
  expect((await res.json()).tag.slug).toBe("reading-pile");

  const { tags } = await (await page.request.get("/api/tags")).json();
  const matches = tags.filter(
    (tag: { name: string }) => tag.name.toLowerCase() === "reading pile",
  );
  expect(matches).toHaveLength(1);
});

test("a selection can be made from inside a collection too", async () => {
  const ids = await articleIds(page);
  await page.goto("/tags/reading-pile");
  await page.getByTestId(`select-article-${ids[0]}`).check();
  await expect(page.getByTestId("selection-bar")).toContainText("1 selected");
  await page.getByTestId("selection-clear").click();
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
});

test("filing rejects an articleIds that is not a list of ids", async () => {
  const res = await page.request.post("/api/tags", {
    data: { name: "Bad Input", articleIds: "not-a-list" },
  });
  expect(res.status()).toBe(422);
});

test("a collection downloads as a backup and as Markdown, holding only its own articles", async () => {
  await deleteAllArticles(page);
  await deleteAllTags(page);
  const inside = await save(page, ARTICLE_URL);
  const outside = await save(page, SECOND_URL);
  await addTag(page, inside, "Just This");

  const backup = await page.request.get("/api/export/archive?tag=just-this");
  expect(backup.ok()).toBe(true);
  expect(backup.headers()["content-disposition"]).toMatch(
    /filename="stash-backup-full-just-this-\d{4}-\d{2}-\d{2}\.tar\.gz"/,
  );

  const md = await page.request.get("/api/export/markdown?tag=just-this");
  expect(md.ok()).toBe(true);
  expect(md.headers()["content-disposition"]).toMatch(
    /filename="stash-markdown-just-this-\d{4}-\d{2}-\d{2}\.tar\.gz"/,
  );

  // The scoped backup carries one link, not the whole library.
  const entries = await readArchive(Buffer.from(await backup.body()));
  const links = entries["links.ndjson"].trim().split("\n");
  expect(links).toHaveLength(1);
  expect(JSON.parse(links[0]).id).toBe(inside);
  expect(entries["links.ndjson"]).not.toContain(outside);
  expect(JSON.parse(entries["stash.json"]).counts.articles).toBe(1);
  expect(Object.keys(entries).filter((n) => n.startsWith("articles/"))).toHaveLength(
    1,
  );

  // And the Markdown export is scoped the same way.
  const mdEntries = await readArchive(Buffer.from(await md.body()));
  expect(
    Object.keys(mdEntries).filter((n) => n.startsWith("articles/")),
  ).toHaveLength(1);
});

test("the collection page links to both downloads", async () => {
  await page.goto("/tags/just-this");
  await page.getByTestId("collection-download").click();
  await expect(page.getByTestId("collection-download-backup")).toHaveAttribute(
    "href",
    "/api/export/archive?tag=just-this",
  );
  await expect(page.getByTestId("collection-download-markdown")).toHaveAttribute(
    "href",
    "/api/export/markdown?tag=just-this",
  );
});

test("downloading a collection that does not exist is a 404", async () => {
  expect((await page.request.get("/api/export/archive?tag=nope")).status()).toBe(
    404,
  );
  expect((await page.request.get("/api/export/markdown?tag=nope")).status()).toBe(
    404,
  );
});

test("Send to Kindle needs an address before it will send", async () => {
  await page.request.put("/api/settings", { data: { kindleEmail: "" } });
  const [id] = await articleIds(page);
  const res = await page.request.post(`/api/articles/${id}/kindle`);
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/Kindle address/i);
});

test("settings shows the sender to approve with Amazon, and validates the destination", async () => {
  await page.goto("/settings?tab=kindle");
  await expect(page.getByTestId("kindle-sender")).toHaveText(
    "stash-e2e@example.com",
  );

  await page.getByTestId("kindle-email").fill("not-an-address");
  await page.getByTestId("kindle-save").click();
  await expect(page.getByTestId("kindle-error")).toContainText(/email address/i);

  await page.getByTestId("kindle-email").fill("reader@kindle.com");
  await page.getByTestId("kindle-save").click();
  await expect(page.getByTestId("kindle-saved")).toBeVisible();
  await expect(page.getByTestId("kindle-error")).toHaveCount(0);
});

test("Send to Kindle mails the article as an EPUB", async () => {
  const [id] = await articleIds(page);
  const res = await page.request.post(`/api/articles/${id}/kindle`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.to).toBe("reader@kindle.com");
  expect(body.filename).toContain(".epub");
  expect(body.bytes).toBeGreaterThan(0);
});

test("the reader offers Send to Kindle once it is configured", async () => {
  const [id] = await articleIds(page);
  await page.goto(`/article/${id}`);
  await page.getByTestId("article-actions").click();
  await page.getByTestId("send-to-kindle").click();
  await expect(page.getByTestId("article-action-note")).toContainText(
    "reader@kindle.com",
  );

  // And it goes away on its own: it reports something already finished, and
  // in the split view this toolbar is the same instance from one article to
  // the next, so a sticky note followed you around the library.
  await expect(page.getByTestId("article-action-note")).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("sending an article that is not yours is a 404", async () => {
  const res = await page.request.post("/api/articles/does-not-exist/kindle");
  expect(res.status()).toBe(404);
});
