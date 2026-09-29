import { test, expect, chromium, type BrowserContext, type Worker } from "@playwright/test";
import path from "path";

const EXTENSION_PATH = path.resolve(__dirname, "../../extension");
import { E2E_BASE_URL } from "./config";

const SERVER = E2E_BASE_URL;
const ARTICLE_URL = `${SERVER}/test-article.html`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let extensionId: string;
let sw: Worker;
let apiToken: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(sw.url()).host;

  // Log in and mint an API token through the real settings UI
  const page = await context.newPage();
  await page.goto(`${SERVER}/login`);
  await page.getByTestId("dev-login").click();
  await page.waitForURL(/\/$/);
  await page.goto(`${SERVER}/settings?tab=apps`);
  await page.getByLabel("Token name").fill("extension e2e");
  await page.getByRole("button", { name: "Create token" }).click();
  const tokenValue = page.getByTestId("token-value");
  await expect(tokenValue).toContainText(/stash_[0-9a-f]{32}/);
  apiToken = (await tokenValue.innerText()).trim();
  // Clear any leftover articles for a clean assertion later
  for (const state of ["unread", "archived"]) {
    const res = await page.request.get(`${SERVER}/api/articles?state=${state}&limit=100`);
    if (res.ok()) {
      for (const a of (await res.json()).articles ?? []) {
        await page.request.delete(`${SERVER}/api/articles/${a.id}`);
      }
    }
  }
  await page.close();
});

test.afterAll(async () => {
  await context?.close();
});

test("options page saves settings and test connection succeeds", async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.fill("#server-url", SERVER);
  await options.fill("#api-token", apiToken);
  await options.click("#save");
  await options.click("#test");
  await expect(options.locator("#message")).toHaveText(
    "Connected — token accepted.",
    { timeout: 15_000 }
  );
  await options.close();
});

test("popup renders and disables saving on non-http pages", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // opened as a tab, the "active tab" is the popup itself (chrome-extension://)
  await expect(popup.locator("#save-btn")).toBeDisabled();
  await expect(popup.locator("#status")).toContainText("cannot be saved");
  await popup.close();
});

test("context-menu save runs the real background handler end to end", async () => {
  // Fire the actual chrome.contextMenus.onClicked listener registered by
  // background.js (chrome.Event#dispatch invokes registered listeners).
  const dispatched = await sw.evaluate((url) => {
    const ev = chrome.contextMenus.onClicked as unknown as {
      dispatch?: (info: object, tab?: object) => void;
    };
    if (typeof ev.dispatch !== "function") return false;
    ev.dispatch({ menuItemId: "stash-save", pageUrl: url }, undefined);
    return true;
  }, ARTICLE_URL);
  expect(dispatched).toBe(true);

  // The handler flashes a green ✓ badge once the save round-trip succeeds.
  await expect
    .poll(() => sw.evaluate(() => chrome.action.getBadgeText({})), {
      timeout: 20_000,
    })
    .toBe("✓");

  // The article landed via the Bearer-token API the extension used.
  const page = await context.newPage();
  const res = await page.request.get(
    `${SERVER}/api/articles?q=Quiet%20Revival&limit=10`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.articles?.some((a: { url: string }) => a.url === ARTICLE_URL)).toBe(true);
  await page.close();
});

test("saved article is visible in the web app", async () => {
  const page = await context.newPage();
  await page.goto(`${SERVER}/`);
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE })
  ).toBeVisible();
  await page.close();
});
