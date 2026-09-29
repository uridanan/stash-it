import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { E2E_BASE_URL, E2E_DATABASE_URL } from "./config";

declare global {
  interface Window {
    __spoken: string[];
  }
}

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const SECOND_URL = `${E2E_BASE_URL}/test-article.html?second=1`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";

test.describe.configure({ mode: "serial" });

let page: Page;

/** Same fake as the listen suite: headless Chromium ships no voices. */
const FAKE_SPEECH = `
  (() => {
    const spoken = [];
    window.__spoken = spoken;
    let current = null;
    let paused = false;

    class FakeUtterance {
      constructor(text) {
        this.text = text; this.rate = 1; this.voice = null;
        this.onend = null; this.onerror = null;
      }
    }
    const voices = [
      { name: "Test English", lang: "en-US", voiceURI: "urn:test:en" },
    ];
    // Deliberately unhurried: at 40ms a whole article narrates in under two
    // seconds, and the queue finishes before any assertion can observe it.
    const finishLater = (u) => setTimeout(() => {
      if (current !== u || paused) return;
      current = null;
      u.onend && u.onend();
    }, 250);

    Object.defineProperty(window, "speechSynthesis", { value: {
      get paused() { return paused; },
      getVoices: () => voices,
      speak(u) { current = u; spoken.push(u.text); finishLater(u); },
      cancel() { current = null; paused = false; },
      pause() { paused = true; },
      resume() { paused = false; if (current) finishLater(current); },
      addEventListener() {}, removeEventListener() {},
    }});
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance });
  })();
`;

function db() {
  return new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
}

async function deleteAllArticles(p: Page) {
  for (const state of ["unread", "archived"]) {
    const res = await p.request.get(`/api/articles?state=${state}&limit=100`);
    if (!res.ok()) continue;
    const body = await res.json();
    for (const a of body.articles ?? []) {
      await p.request.delete(`/api/articles/${a.id}`);
    }
  }
}

async function save(p: Page, url: string) {
  const res = await p.request.post("/api/articles", { data: { url } });
  expect(res.ok()).toBe(true);
  return (await res.json()).article.id as string;
}

async function articleIds(p: Page): Promise<string[]> {
  const res = await p.request.get("/api/articles?state=unread&limit=100");
  const body = await res.json();
  return (body.articles ?? []).map((a: { id: string }) => a.id);
}

async function addTag(p: Page, articleId: string, name: string) {
  const res = await p.request.post(`/api/articles/${articleId}/tags`, {
    data: { name },
  });
  expect(res.ok()).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(FAKE_SPEECH);
  await page.goto("/login");
  await page.getByTestId("dev-login").click();
  await page.waitForURL(/\/$/);
  await deleteAllArticles(page);
});

test.afterAll(async () => {
  await deleteAllArticles(page);
  await page.close();
});

test("saving applies automatic tags", async () => {
  await save(page, ARTICLE_URL);
  const res = await page.request.get("/api/tags");
  const { tags } = await res.json();
  const names = tags.map((t: { name: string }) => t.name);

  // The fixture is a normal English essay: length and language, nothing else.
  expect(names).toContain("Quick read");
  expect(names).toContain("English");
  expect(names).not.toContain("Shopping");
  expect(names).not.toContain("Won't narrate");
});

test("automatic tags appear on the article row", async () => {
  await page.goto("/");
  const row = page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE });
  await expect(row.getByTestId("tag-chips")).toContainText("English");
});

test("a tag can be added and removed by hand from the reader", async () => {
  const [id] = await articleIds(page);
  await page.goto(`/article/${id}`);

  await page.getByTestId("tag-input").fill("Weekend");
  await page.getByTestId("tag-input").press("Enter");

  // Wait on the chip's remove button, not on the text: the suggestion list
  // shows Create "Weekend" immediately, so matching text alone would pass
  // before the request lands and let the next navigation cancel it.
  const chip = page.getByRole("button", { name: "Remove tag Weekend" });
  await expect(chip).toBeVisible();

  // It becomes a real collection.
  await page.goto("/tags");
  await expect(page.getByTestId("tag-list")).toContainText("Weekend");

  await page.goto(`/article/${id}`);
  await page.getByRole("button", { name: "Remove tag Weekend" }).click();
  await expect(
    page.getByRole("button", { name: "Remove tag Weekend" }),
  ).toBeHidden();
});

test("the collection page lists its articles in order", async () => {
  await save(page, SECOND_URL);
  const ids = await articleIds(page);
  expect(ids).toHaveLength(2);

  for (const id of ids) await addTag(page, id, "Queue");

  await page.goto("/tags/queue");
  await expect(page.getByTestId("collection-row")).toHaveCount(2);
});

/** Both fixtures share a title, so rows are identified by article id. */
async function collectionOrder(p: Page): Promise<string[]> {
  const res = await p.request.get("/api/tags/queue");
  return (await res.json()).articleIds as string[];
}

async function firstRowArticleId(p: Page): Promise<string> {
  const href = await p
    .getByTestId("collection-row")
    .first()
    .getByRole("link")
    .getAttribute("href");
  return (href ?? "").replace("/article/", "");
}

test("send to top reorders, and the order survives a reload", async () => {
  await page.goto("/tags/queue");
  const before = await collectionOrder(page);
  expect(before).toHaveLength(2);

  await page.getByTestId("collection-row").last().getByTestId("send-to-top").click();

  // The moved article leads, in the UI and in what the server persisted.
  await expect.poll(() => firstRowArticleId(page)).toBe(before[1]);
  await expect.poll(() => collectionOrder(page)).toEqual([before[1], before[0]]);

  await page.reload();
  expect(await firstRowArticleId(page)).toBe(before[1]);
});

/**
 * The test the provider hoist exists for: narration has to continue into the
 * next article, which means surviving a client-side navigation.
 */
test("Listen all plays through the collection, navigating between articles", async () => {
  await page.goto("/tags/queue");
  const order = await page.getByTestId("collection-row").allInnerTexts();

  await page.getByTestId("listen-all").click();

  // It opens the first article *within the collection*, so the running order
  // stays on screen beside what is playing.
  await page.waitForURL(/\/tags\/queue\?.*article=/);
  const firstUrl = page.url();
  await expect(page.getByTestId("listen-player")).toBeVisible();
  await expect(page.getByTestId("collection-list")).toBeVisible();
  await expect(page.getByTestId("listen-queue-position")).toContainText("1/2");

  const spokenOnFirst = await page.evaluate(() => window.__spoken.length);
  expect(spokenOnFirst).toBeGreaterThan(0);

  // ...then moves to the second on its own.
  await expect
    .poll(() => page.url(), { timeout: 60_000 })
    .not.toBe(firstUrl);
  await expect(page.getByTestId("listen-queue-position")).toContainText("2/2");

  // The record of what was spoken survived the hop, which is only possible if
  // the navigation was client-side — a full page load would reset it. That is
  // precisely what lets narration continue across articles.
  await expect
    .poll(async () => page.evaluate(() => window.__spoken.length), {
      timeout: 60_000,
    })
    .toBeGreaterThan(spokenOnFirst);
  expect(order).toHaveLength(2);
});

test("the player steps between articles with next and previous", async () => {
  await page.goto("/tags/queue");
  await page.getByTestId("listen-all").click();
  await page.waitForURL(/\/tags\/queue\?.*article=/);
  await expect(page.getByTestId("listen-queue-position")).toContainText("1/2");

  await page.getByTestId("listen-next").click();
  await expect(page.getByTestId("listen-queue-position")).toContainText("2/2");

  await page.getByTestId("listen-previous").click();
  // Previous restarts the current article first, mirroring a music player.
  await expect(page.getByTestId("listen-queue-position")).toContainText(/1\/2|2\/2/);

  await page.getByTestId("listen-stop").click();
  await expect(page.getByTestId("listen-player")).toBeHidden();
});

test("an article with nothing to narrate is skipped with a notice", async () => {
  // A stub article: extraction failed, so it carries "Won't narrate". The
  // original content is put back at the end — this file runs serially, and
  // leaving one of only two fixtures permanently empty makes every later test
  // depend on which one it was.
  const prisma = db();
  const [emptiedId] = await articleIds(page);
  let original = "";
  try {
    const before = await prisma.article.findUniqueOrThrow({
      where: { id: emptiedId },
      select: { content: true },
    });
    original = before.content;
    await prisma.article.update({
      where: { id: emptiedId },
      data: { content: "", extractionFailed: true },
    });
  } finally {
    await prisma.$disconnect();
  }

  await page.goto("/tags/queue");
  await page.getByTestId("listen-all").click();
  await page.waitForURL(/\/tags\/queue\?.*article=/);

  // The empty article is last in this collection, so the queue reaches it and
  // must report the skip rather than narrating a lone title into silence.
  await expect(page.getByTestId("listen-notice")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("listen-notice")).toContainText(/skipping/i);

  // Its body was never spoken — only the other article's text was.
  const spoken = await page.evaluate(() => window.__spoken.join(" "));
  expect(spoken).toContain("third autoplay video");

  const restore = db();
  try {
    await restore.article.update({
      where: { id: emptiedId },
      data: { content: original, extractionFailed: false },
    });
  } finally {
    await restore.$disconnect();
  }
});

test("sorting by added date honours both directions", async () => {
  const prisma = db();
  try {
    const ids = await articleIds(page);
    // Distinct, known timestamps so ordering is unambiguous.
    await prisma.article.update({
      where: { id: ids[0] },
      data: { savedAt: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.article.update({
      where: { id: ids[1] },
      data: { savedAt: new Date("2026-06-01T00:00:00Z") },
    });
  } finally {
    await prisma.$disconnect();
  }

  const newestFirst = await page.request.get(
    "/api/articles?state=unread&sort=added&order=desc",
  );
  const newest = (await newestFirst.json()).articles.map(
    (a: { savedAt: string }) => a.savedAt,
  );
  expect(new Date(newest[0]).getTime()).toBeGreaterThan(
    new Date(newest[1]).getTime(),
  );

  const oldestFirst = await page.request.get(
    "/api/articles?state=unread&sort=added&order=asc",
  );
  const oldest = (await oldestFirst.json()).articles.map(
    (a: { savedAt: string }) => a.savedAt,
  );
  expect(new Date(oldest[0]).getTime()).toBeLessThan(
    new Date(oldest[1]).getTime(),
  );
});

test("sorting by published date puts undated articles last, both ways", async () => {
  const prisma = db();
  try {
    const ids = await articleIds(page);
    await prisma.article.update({
      where: { id: ids[0] },
      data: { publishedAt: new Date("2025-03-01T00:00:00Z") },
    });
    await prisma.article.update({
      where: { id: ids[1] },
      data: { publishedAt: null },
    });
  } finally {
    await prisma.$disconnect();
  }

  for (const order of ["desc", "asc"]) {
    const res = await page.request.get(
      `/api/articles?state=unread&sort=published&order=${order}`,
    );
    const rows = (await res.json()).articles;
    expect(rows[0].publishedAt).not.toBeNull();
    expect(rows[rows.length - 1].publishedAt).toBeNull();
  }
});

test("the sort control writes its choice to the URL", async () => {
  await page.goto("/");
  await page.getByTestId("sort-by").selectOption("published");
  await expect.poll(() => page.url()).toContain("sort=published");

  await page.getByTestId("sort-order").selectOption("asc");
  await expect.poll(() => page.url()).toContain("order=asc");

  // Defaults are implied rather than spelled out.
  await page.getByTestId("sort-by").selectOption("added");
  await expect.poll(() => page.url()).not.toContain("sort=");
});

test("search matches article body text, not just the title", async () => {
  // "autoplay" appears in the fixture's first paragraph and nowhere in its
  // title, byline or excerpt.
  const res = await page.request.get("/api/articles?state=unread&q=autoplay");
  const { articles } = await res.json();
  expect(articles.length).toBeGreaterThan(0);
  expect(articles[0].title).not.toContain("autoplay");
});

test("search matches tag names", async () => {
  const res = await page.request.get("/api/articles?state=unread&q=Queue");
  const { articles } = await res.json();
  expect(articles.length).toBeGreaterThan(0);
});

test("search still returns nothing for a term that is genuinely absent", async () => {
  const res = await page.request.get(
    "/api/articles?state=unread&q=zzznotpresentzzz",
  );
  expect((await res.json()).articles).toHaveLength(0);
});

test("the sidebar lists collections and can collapse them", async () => {
  await page.goto("/");
  await expect(page.getByTestId("sidebar-collections")).toContainText("Queue");

  await page.getByTestId("collections-toggle").click();
  await expect(page.getByTestId("sidebar-collections")).toBeHidden();

  await page.getByTestId("collections-toggle").click();
  await expect(page.getByTestId("sidebar-collections")).toBeVisible();

  // A collection opens straight from the sidebar.
  await page.getByTestId("sidebar-collections").getByText("Queue").click();
  await page.waitForURL(/\/tags\/queue/);
});

test("a collection keeps its list beside the article on desktop", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tags/queue");

  await page.getByTestId("collection-row").first().getByRole("link").first().click();

  // Selection goes into the query string rather than navigating away, so the
  // running order stays on screen next to the reader.
  await page.waitForURL(/\/tags\/queue\?.*article=/);
  await expect(page.getByTestId("collection-list")).toBeVisible();
  await expect(page.getByTestId("reader-content")).toBeVisible();
});

async function setMarkReadOnListen(p: Page, on: boolean) {
  const res = await p.request.put("/api/settings", {
    data: { markReadOnListen: on },
  });
  expect(res.ok()).toBe(true);
}

async function setRead(p: Page, articleId: string, read: boolean) {
  const res = await p.request.patch(`/api/articles/${articleId}`, {
    data: { state: read ? "archived" : "unread" },
  });
  expect(res.ok()).toBe(true);
}

test("a collection can be filtered to unread only", async () => {
  const ids = await collectionOrder(page);
  expect(ids).toHaveLength(2);
  await setRead(page, ids[0], true);

  await page.goto("/tags/queue");
  await expect(page.getByTestId("collection-row")).toHaveCount(2);

  await page.getByTestId("unread-filter").click();
  await expect.poll(() => page.url()).toContain("unread=1");
  await expect(page.getByTestId("collection-row")).toHaveCount(1);
  // The toggle still reports the size of the whole collection.
  await expect(page.getByTestId("unread-filter")).toContainText("2 total");

  await page.getByTestId("unread-filter").click();
  await expect(page.getByTestId("collection-row")).toHaveCount(2);
  await setRead(page, ids[0], false);
});

test("Listen all narrates only the filtered articles", async () => {
  const ids = await collectionOrder(page);
  await setRead(page, ids[0], true);

  await page.goto("/tags/queue?unread=1");
  await expect(page.getByTestId("collection-row")).toHaveCount(1);

  await page.getByTestId("listen-all").click();
  await page.waitForURL(/\/tags\/queue\?.*article=/);
  const playingUrl = page.url();

  // A one-article queue: the filter decided what the playlist contains.
  await expect(page.getByTestId("listen-queue-position")).toContainText("1/1");
  // The filter survives starting a playlist.
  expect(playingUrl).toContain("unread=1");

  // It ends rather than reaching for the article the filter excluded. Asserting
  // on the queue readout rather than the whole player: one of these fixtures
  // was emptied by an earlier test, so the player may legitimately linger to
  // show the "nothing to read" notice.
  await expect(page.getByTestId("listen-queue-position")).toBeHidden({
    timeout: 90_000,
  });
  expect(page.url()).toBe(playingUrl);
  await setRead(page, ids[0], false);
});

test("finishing an article marks it read when the setting is on", async () => {
  await setMarkReadOnListen(page, true);
  const ids = await collectionOrder(page);
  await setRead(page, ids[0], false);

  await page.goto(`/article/${ids[0]}`);
  await page.getByTestId("listen-start").click();

  // Let it run to the end of the article, then check the state flipped.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/articles/${ids[0]}`);
        return (await res.json()).article.state;
      },
      { timeout: 90_000 },
    )
    .toBe("ARCHIVED");

  await setMarkReadOnListen(page, false);
  await setRead(page, ids[0], false);
});

test("finishing an article leaves it unread when the setting is off", async () => {
  await setMarkReadOnListen(page, false);
  const ids = await collectionOrder(page);
  await setRead(page, ids[0], false);

  await page.goto(`/article/${ids[0]}`);
  await page.getByTestId("listen-start").click();
  await expect(page.getByTestId("listen-player")).toBeVisible();
  // Wait for the player to finish and disappear, then confirm nothing changed.
  await expect(page.getByTestId("listen-player")).toBeHidden({
    timeout: 90_000,
  });

  const res = await page.request.get(`/api/articles/${ids[0]}`);
  expect((await res.json()).article.state).toBe("UNREAD");
});

test("the API rejects an unknown sort", async () => {
  const res = await page.request.get("/api/articles?sort=sideways");
  expect(res.status()).toBe(400);
});
