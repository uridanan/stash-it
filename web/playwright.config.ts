import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT } from "./e2e/config";

/**
 * The e2e suite is fully self-contained: global setup resets a throwaway
 * `stash_e2e` database (on the docker-compose postgres), and Playwright
 * starts its own dev server on port 3100 pointed at it. Dev data on port
 * 3000 is never touched.
 */
export default defineConfig({
  testDir: "./e2e",
  // 60s was not enough for the *first* hook in a spec file: Playwright starts
  // its own dev server, so whichever test runs first pays for Turbopack
  // compiling the whole app on top of its own work. Three different spec files
  // have timed out there. Raised globally rather than per file, since which
  // file goes first is not a property of any of them.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --turbopack -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Merge, don't replace — the command still needs PATH etc.
      ...(process.env as Record<string, string>),
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_SECRET: "e2e-test-secret",
      AUTH_DEV_LOGIN: "true",
      AUTH_TRUST_HOST: "true",
      // Send to Kindle builds and addresses a real message but never delivers
      // it, so the whole path is covered without a mail server.
      SMTP_TRANSPORT: "json",
      SMTP_FROM: "stash-e2e@example.com",
    },
  },
});
