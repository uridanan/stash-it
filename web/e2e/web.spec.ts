import { test, expect, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "./config";

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";

test.describe.configure({ mode: "serial" });

let page: Page;

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

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/login");
  await page.getByTestId("dev-login").click();
  await page.waitForURL(/\/$/);
  await deleteAllArticles(page);
});

test.afterAll(async () => {
  await page.close();
});

test("dev login lands on the unread list", async () => {
  await page.goto("/");
  await expect(page.getByTestId("add-url-input")).toBeVisible();
  await expect(page.getByTestId("article-row")).toHaveCount(0);
});

test("saving a URL extracts the article into the unread list", async () => {
  await page.getByTestId("add-url-input").fill(ARTICLE_URL);
  await page.getByTestId("add-url-submit").click();
  const row = page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/min/);
});

test("reader view renders extracted content with controls", async () => {
  // Desktop viewport: clicking a row selects it into the split-view pane.
  await page
    .getByTestId("article-row")
    .filter({ hasText: ARTICLE_TITLE })
    .getByRole("link", { name: ARTICLE_TITLE })
    .click();
  await page.waitForURL(/\?(?:.*&)?article=/);
  const content = page.getByTestId("reader-content");
  await expect(content).toBeVisible();
  await expect(content.locator("p").first()).toBeVisible();
  await expect(content.locator("blockquote")).toHaveCount(1);
  // The text-size controls resize the article body, not the title.
  const bodySize = () =>
    content.evaluate((el) => window.getComputedStyle(el).fontSize);
  const titleSize = () =>
    page
      .getByRole("heading", { name: ARTICLE_TITLE })
      .evaluate((el) => window.getComputedStyle(el).fontSize);
  const before = await bodySize();
  const titleBefore = await titleSize();
  await page.getByTestId("font-larger").click();
  await expect.poll(bodySize).not.toBe(before);
  expect(await titleSize()).toBe(titleBefore);
  await page.getByTestId("font-smaller").click();
  await expect.poll(bodySize).toBe(before);
  await expect(page.getByRole("link", { name: /view original/i })).toHaveAttribute(
    "href",
    ARTICLE_URL
  );

  // The standalone /article/[id] route (mobile + deep links) still renders.
  const articleId = new URL(page.url()).searchParams.get("article");
  await page.goto(`/article/${articleId}`);
  await expect(page.getByTestId("reader-content")).toBeVisible();
  await expect(
    page.getByTestId("reader-content").locator("blockquote")
  ).toHaveCount(1);
  await page.goto("/");
});

test("the reader toolbar can go full width, come back, and close", async () => {
  await page.goto("/");
  await page
    .getByTestId("article-row")
    .filter({ hasText: ARTICLE_TITLE })
    .getByRole("link", { name: ARTICLE_TITLE })
    .click();
  await page.waitForURL(/\?(?:.*&)?article=/);

  const list = page.getByTestId("article-row").first();
  await expect(list).toBeVisible();

  await page.getByTestId("reader-full-width").click();
  await expect(list).toBeHidden();
  await expect(page.getByTestId("reader-content")).toBeVisible();

  // The choice survives a reload, like the pane width does.
  await page.reload();
  await expect(page.getByTestId("article-row").first()).toBeHidden();

  await page.getByTestId("reader-full-width").click();
  await expect(page.getByTestId("article-row").first()).toBeVisible();

  // Close drops the selection but keeps the list.
  await page.getByTestId("reader-close").click();
  await expect(page).not.toHaveURL(/article=/);
  await expect(page.getByTestId("reader-content")).toHaveCount(0);
  await expect(page.getByTestId("article-row").first()).toBeVisible();
});

test("the text size is kept across articles and reloads", async () => {
  await page.goto("/");
  await page
    .getByTestId("article-row")
    .filter({ hasText: ARTICLE_TITLE })
    .getByRole("link", { name: ARTICLE_TITLE })
    .click();
  await page.waitForURL(/\?(?:.*&)?article=/);

  const size = () =>
    page
      .getByTestId("reader-content")
      .evaluate((el) => window.getComputedStyle(el).fontSize);

  const start = await size();
  await page.getByTestId("font-larger").click();
  await page.getByTestId("font-larger").click();
  const bigger = await size();
  expect(bigger).not.toBe(start);

  // Same size on a reload, on the standalone page, and back on the list.
  const articleId = new URL(page.url()).searchParams.get("article");
  await page.reload();
  await expect.poll(size).toBe(bigger);
  await page.goto(`/article/${articleId}`);
  await expect.poll(size).toBe(bigger);

  // Put it back so the rest of the suite sees the default.
  await page.getByTestId("font-smaller").click();
  await page.getByTestId("font-smaller").click();
  await expect.poll(size).toBe(start);
});

test("the reader has no serif toggle — the reader is always sans", async () => {
  await page.goto("/");
  await page
    .getByTestId("article-row")
    .filter({ hasText: ARTICLE_TITLE })
    .getByRole("link", { name: ARTICLE_TITLE })
    .click();
  await page.waitForURL(/\?(?:.*&)?article=/);
  await expect(page.getByRole("button", { name: /serif/i })).toHaveCount(0);
  const family = await page
    .getByTestId("reader-content")
    .evaluate((el) => window.getComputedStyle(el).fontFamily);
  expect(family).not.toMatch(/georgia|times/i);
});

test("star and unstar from the list", async () => {
  await page.goto("/");
  const row = page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE });
  await row.hover();
  await row.getByRole("button", { name: "Star", exact: true }).click();
  // wait for the PATCH + router.refresh() round-trip before navigating
  await expect(row.getByRole("button", { name: "Unstar" })).toBeVisible();
  await page.goto("/starred");
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE })
  ).toBeVisible();
});

test("archive moves the article out of unread", async () => {
  await page.goto("/");
  const row = page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE });
  await row.hover();
  await row.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(0);
  await page.goto("/archive");
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE })
  ).toBeVisible();
});

test("unarchive returns the article to unread", async () => {
  await page.goto("/archive");
  const row = page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE });
  await row.hover();
  await row.getByRole("button", { name: "Mark as unread" }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE })
  ).toBeVisible();
});

test("search filters by title", async () => {
  await page.goto("/?q=Quiet+Revival");
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE })
  ).toBeVisible();
  await page.goto("/?q=zzz-no-such-article");
  await expect(page.getByTestId("article-row")).toHaveCount(0);
});

test("share target /save?text=... saves the shared URL (Google app format)", async () => {
  await deleteAllArticles(page);
  await page.goto(
    `/save?text=${encodeURIComponent(`Worth a read: ${ARTICLE_URL}`)}`
  );
  await expect(page.getByTestId("save-confirmation")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("save-confirmation")).toContainText(
    ARTICLE_TITLE
  );
  await page.goto("/");
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE })
  ).toBeVisible();
});

test("delete removes the article", async () => {
  await page.goto("/");
  const row = page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE });
  page.once("dialog", (d) => d.accept());
  await row.hover();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(0);
});

test("settings is tabbed, and the open tab lives in the URL", async () => {
  await page.goto("/settings");
  // Defaults to the first tab, and shows only that panel.
  await expect(page.getByTestId("settings-tab-ai")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("ai-settings")).toBeVisible();
  await expect(page.getByTestId("kindle-email")).toHaveCount(0);
  await expect(page.getByLabel("Token name")).toHaveCount(0);

  await page.getByTestId("settings-tab-kindle").click();
  await expect(page).toHaveURL(/\/settings\?tab=kindle/);
  await expect(page.getByTestId("kindle-email")).toBeVisible();
  await expect(page.getByTestId("ai-settings")).toHaveCount(0);

  // The tab survives a reload, which is the point of keeping it in the URL.
  await page.reload();
  await expect(page.getByTestId("kindle-email")).toBeVisible();

  // An unknown tab falls back rather than erroring.
  await page.goto("/settings?tab=nonsense");
  await expect(page.getByTestId("ai-settings")).toBeVisible();
});

test("settings uses switches, not checkboxes", async () => {
  await page.goto("/settings?tab=ai");
  await expect(page.getByTestId("ai-enabled-toggle")).toHaveAttribute(
    "role",
    "switch",
  );

  await page.goto("/settings?tab=listening");
  const markRead = page.getByTestId("mark-read-on-listen");
  await expect(markRead).toHaveAttribute("role", "switch");

  const before = (await markRead.getAttribute("aria-checked")) === "true";
  await markRead.click();
  await expect(markRead).toHaveAttribute("aria-checked", String(!before));

  // It writes through, rather than only moving on screen. Polled because the
  // switch updates optimistically and the PUT lands just after.
  await expect
    .poll(async () => (await (await page.request.get("/api/settings")).json())
      .markReadOnListen)
    .toBe(!before);

  // Restored over the API, not by clicking again: the switch disables itself
  // while saving, so a second click can land on a disabled control.
  await page.request.put("/api/settings", { data: { markReadOnListen: before } });
});

test("API token lifecycle in settings", async () => {
  await page.goto("/settings?tab=apps");
  await page.getByLabel("Token name").fill("e2e test token");
  await page.getByRole("button", { name: "Create token" }).click();
  const tokenValue = page.getByTestId("token-value");
  await expect(tokenValue).toBeVisible();
  await expect(tokenValue).toContainText(/stash_[0-9a-f]{32}/);
  // token authenticates against the API
  const token = (await tokenValue.innerText()).trim();
  const res = await page.request.get("/api/articles?limit=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete" })
    .first()
    .click();
  await expect(page.getByText("e2e test token")).toHaveCount(0);
});

test("AI summary settings roundtrip and generate button error path", async () => {
  // Configure AI summaries with a bogus key
  await page.goto("/settings?tab=ai");
  const section = page.getByTestId("ai-settings");
  await expect(section).toBeVisible();
  const toggle = section.getByTestId("ai-enabled-toggle");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await section.getByLabel("Model").selectOption("gemini-3.1-pro-preview");
  await section.getByLabel("API key").fill("e2e-bogus-key-1234");
  await section.getByTestId("ai-settings-save").click();
  await expect(section.getByTestId("ai-settings-status")).toHaveText("Saved");

  // Settings persist; the key is masked, never echoed back
  await page.reload();
  const reloaded = page.getByTestId("ai-settings");
  await expect(reloaded.getByTestId("ai-enabled-toggle")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(reloaded.getByLabel("API key")).toHaveValue("");
  await expect(reloaded.getByLabel("API key")).toHaveAttribute(
    "placeholder",
    /…1234/,
  );

  // Reader offers "Summarize"; a bogus key surfaces a provider error
  await page.goto("/");
  await page.getByTestId("add-url-input").fill(ARTICLE_URL);
  await page.getByTestId("add-url-submit").click();
  await page
    .getByTestId("article-row")
    .filter({ hasText: ARTICLE_TITLE })
    .getByRole("link", { name: ARTICLE_TITLE })
    .click();
  const generate = page.getByRole("button", { name: /summarize/i });
  await expect(generate).toBeVisible({ timeout: 20_000 });
  await generate.click();
  await expect(page.getByText(/Gemini: HTTP \d+/)).toBeVisible({
    timeout: 30_000,
  });
  // No cleanup needed — the suite runs against a throwaway database.
});

test("PWA manifest, share_target, icons and service worker are served", async () => {
  const manifestRes = await page.request.get("/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);
  const manifest = await manifestRes.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.share_target.action).toBe("/save");
  expect(manifest.share_target.params.text).toBe("text");
  for (const icon of manifest.icons) {
    const iconRes = await page.request.get(icon.src);
    expect(iconRes.status()).toBe(200);
    const buf = await iconRes.body();
    // PNG signature
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }
  const swRes = await page.request.get("/sw.js");
  expect(swRes.status()).toBe(200);
  expect(await swRes.text()).toContain("addEventListener");
  // the app registers the service worker in the browser
  await page.goto("/");
  await page.waitForFunction(
    () => navigator.serviceWorker?.getRegistrations().then((r) => r.length > 0),
    undefined,
    { timeout: 15_000 }
  );
});
