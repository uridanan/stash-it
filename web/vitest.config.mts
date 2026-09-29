import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests only (colocated `src/**\/*.test.ts`). The e2e suite is Playwright
 * and lives in ./e2e — it boots a Next server and resets a database, which
 * pure-function tests have no business paying for.
 *
 * Paths are anchored to this file rather than `process.cwd()`, so the run works
 * from any directory (and on Windows, where a URL pathname would carry a
 * leading slash before the drive letter).
 */
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/", import.meta.url)) },
  },
});
