import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { E2E_BASE_URL, E2E_DATABASE_URL } from "./config";

declare global {
  interface Window {
    __spoken: string[];
    __rates: number[];
  }
}

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";
const SEEDED_SUMMARY = "THE NEWS\nA short seeded summary sentence.";
/** A distinctive phrase from the article body, absent from the summary. */
const ARTICLE_PHRASE = "third autoplay video";

test.describe.configure({ mode: "serial" });

let page: Page;

/**
 * Headless Chromium ships no speech voices, so the real Web Speech API can
 * never speak in CI. This fake reports two voices and finishes each utterance
 * after 80ms, and records what was spoken on `window.__spoken` so the tests
 * can assert which text was narrated.
 */
const FAKE_SPEECH = `
  (() => {
    const spoken = [];
    const rates = [];
    window.__spoken = spoken;
    window.__rates = rates;
    let current = null;
    let paused = false;

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.voice = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    const voices = [
      { name: "Test Female", lang: "en-US", voiceURI: "urn:test:female" },
      { name: "Test Male", lang: "en-US", voiceURI: "urn:test:male" },
    ];

    const finishLater = (utterance) => {
      setTimeout(() => {
        if (current !== utterance || paused) return;
        current = null;
        utterance.onend && utterance.onend();
      }, 80);
    };

    const synth = {
      get paused() { return paused; },
      getVoices: () => voices,
      speak(utterance) {
        current = utterance;
        spoken.push(utterance.text);
        rates.push(utterance.rate);
        finishLater(utterance);
      },
      cancel() { current = null; paused = false; },
      pause() { paused = true; },
      resume() {
        paused = false;
        if (current) finishLater(current);
      },
      addEventListener() {},
      removeEventListener() {},
    };

    Object.defineProperty(window, "speechSynthesis", { value: synth });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: FakeUtterance,
    });
  })();
`;

async function firstArticleId(p: Page): Promise<string> {
  const res = await p.request.get("/api/articles?state=unread&limit=1");
  const body = await res.json();
  return body.articles[0].id;
}

/**
 * Opens the saved article in the standalone reader.
 *
 * Waits on the Listen button rather than the article body: in the tabs layout
 * the Summary panel is active by default, so `reader-content` is legitimately
 * absent. The button also only appears once the client component has hydrated
 * and reported voices, which is exactly the readiness the tests need.
 */
async function openReader(p: Page): Promise<void> {
  await p.goto(`/article/${await firstArticleId(p)}`);
  await expect(p.getByTestId("listen-start")).toBeEnabled();
}

/** The settings route is PUT, and accepts a partial body. */
async function setSummaryView(p: Page, view: "card" | "tabs"): Promise<void> {
  const res = await p.request.put("/api/settings", {
    data: { summaryView: view },
  });
  expect(res.ok()).toBe(true);
}

/**
 * Seeds a summary directly. `PATCH /api/articles/[id]` only accepts `state`
 * and `starred`, and generating a real one would need a live AI key.
 */
async function seedSummary(id: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
  try {
    await prisma.article.update({
      where: { id },
      data: { summary: SEEDED_SUMMARY },
    });
  } finally {
    await prisma.$disconnect();
  }
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

const spokenCount = () => page.evaluate(() => window.__spoken.length);
const spokenText = async () =>
  (await page.evaluate(() => window.__spoken)).join(" ");

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(FAKE_SPEECH);
  await page.goto("/login");
  await page.getByTestId("dev-login").click();
  await page.waitForURL(/\/$/);
  await deleteAllArticles(page);

  await page.getByTestId("add-url-input").fill(ARTICLE_URL);
  await page.getByTestId("add-url-submit").click();
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE }),
  ).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await setSummaryView(page, "card");
  await deleteAllArticles(page);
  await page.close();
});

test("the Listen button appears once voices are available", async () => {
  await openReader(page);
  const listen = page.getByTestId("listen-start");
  await expect(listen).toBeVisible();
  await expect(listen).toBeEnabled();
  await expect(page.getByTestId("listen-player")).toBeHidden();
});

test("starting playback narrates the title first, then the article", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();

  await expect(page.getByTestId("listen-player")).toBeVisible();
  await expect.poll(spokenCount).toBeGreaterThan(1);

  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken[0]).toBe(ARTICLE_TITLE);
  expect(spoken.slice(1).join(" ").length).toBeGreaterThan(0);
});

test("the active sentence is highlighted", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect
    .poll(() => page.locator("[data-listen-chunk].listen-active").count())
    .toBeGreaterThan(0);
});

test("pause stops advancing and resume continues", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect.poll(spokenCount).toBeGreaterThan(1);

  await page.getByTestId("listen-toggle").click(); // pause
  const atPause = await spokenCount();
  await page.waitForTimeout(400);
  expect(await spokenCount()).toBe(atPause);

  await page.getByTestId("listen-toggle").click(); // resume
  await expect.poll(spokenCount).toBeGreaterThan(atPause);
});

test("stop hides the player and clears the highlight", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect(page.getByTestId("listen-player")).toBeVisible();

  await page.getByTestId("listen-stop").click();
  await expect(page.getByTestId("listen-player")).toBeHidden();
  await expect(page.locator("[data-listen-chunk].listen-active")).toHaveCount(0);
});

test("rewind moves the position back", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();

  // Let several chunks go by so there is somewhere to rewind to.
  await expect.poll(spokenCount).toBeGreaterThan(5);

  const position = async () =>
    Number(
      (await page.getByTestId("listen-position").innerText()).match(
        /(\d+)\//,
      )?.[1] ?? "0",
    );

  await page.getByTestId("listen-toggle").click(); // pause, so it holds still
  const before = await position();
  await page.getByTestId("listen-rewind").click();

  await expect.poll(position).toBeLessThan(before);
});

test("forward skips ahead", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect.poll(spokenCount).toBeGreaterThan(1);

  const position = async () =>
    Number(
      (await page.getByTestId("listen-position").innerText()).match(
        /(\d+)\//,
      )?.[1] ?? "0",
    );

  // Paused, so the reading below is not immediately stale. Seeking resumes
  // playback (as rewind does), which is why only the jump is asserted here —
  // coming back is covered by the rewind test above.
  await page.getByTestId("listen-toggle").click();
  const before = await position();

  await page.getByTestId("listen-forward").click();
  await expect.poll(position).toBeGreaterThan(before + 1);
});

test("the speed selection reaches the engine", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__rates)).length)
    .toBeGreaterThan(0);

  await page.getByTestId("listen-rate").selectOption("1.5");
  // Labels above 1x are compressed before reaching the engine, because the
  // engine's rate is perceptually exaggerated at the top of its range.
  await expect
    .poll(async () => {
      const rates = await page.evaluate(() => window.__rates);
      return rates[rates.length - 1];
    })
    .toBeCloseTo(1 + 0.5 / 3, 5);
});

test("the player stays docked at the bottom of the viewport while scrolling", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  const player = page.getByTestId("listen-player");
  await expect(player).toBeVisible();

  // Scroll into the middle of the article: sticky must keep the bar pinned to
  // the bottom of the scrollport, not leave it behind at the end of content.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));

  const viewport = page.viewportSize();
  const box = await player.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  if (!viewport || !box) return;

  // Bottom edge sits at (or just within) the bottom of the viewport.
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
  expect(box.y + box.height).toBeGreaterThan(viewport.height * 0.75);
});

test("with tabs enabled, only the active panel is narrated", async () => {
  await seedSummary(await firstArticleId(page));
  await setSummaryView(page, "tabs");

  await openReader(page);
  await expect(page.getByTestId("summary-tab-panel")).toBeVisible();

  await page.getByTestId("listen-start").click();

  // Wait for the whole session to finish — the player unmounts when narration
  // ends. Only then is "the article was never read" a meaningful assertion.
  await expect(page.getByTestId("listen-player")).toBeHidden({
    timeout: 15_000,
  });

  const spoken = await spokenText();
  expect(spoken).toContain("A short seeded summary sentence.");
  // The article body is not on screen, so it is never narrated.
  expect(spoken).not.toContain(ARTICLE_PHRASE);
});

test("switching tabs stops playback", async () => {
  await setSummaryView(page, "tabs");
  await openReader(page);

  await page.getByTestId("listen-start").click();
  await expect(page.getByTestId("listen-player")).toBeVisible();

  await page.getByRole("tab", { name: /Full article/ }).click();
  await expect(page.getByTestId("listen-player")).toBeHidden();
});

test("in the card layout, the summary is narrated before the article", async () => {
  await setSummaryView(page, "card");
  await openReader(page);
  await expect(page.getByTestId("summary-card")).toBeVisible();

  await page.getByTestId("listen-start").click();

  // Both sources are on screen here, so both get read — summary first.
  await expect.poll(spokenText).toContain(ARTICLE_PHRASE);

  const spoken = await page.evaluate(() => window.__spoken);
  const summaryAt = spoken.findIndex((t) =>
    t.includes("A short seeded summary sentence."),
  );
  const articleAt = spoken.findIndex((t) => t.includes(ARTICLE_PHRASE));
  expect(summaryAt).toBeGreaterThan(-1);
  expect(articleAt).toBeGreaterThan(summaryAt);
  // Chunk 0 is always the title.
  expect(spoken[0]).toBe(ARTICLE_TITLE);
});
