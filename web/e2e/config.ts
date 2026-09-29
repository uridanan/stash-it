/** Shared constants for the e2e suite (throwaway server + database). */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * Separate database on the docker-compose postgres (host port 5435).
 * `docker compose up -d db` must be running.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://stash:stash@localhost:5435/stash_e2e";
