import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "./config";

/**
 * Reset the throwaway e2e database before every run: drop + recreate the
 * dedicated `stash_e2e` database, then apply all migrations. Tests never
 * touch the dev database.
 */
export default async function globalSetup() {
  const url = new URL(E2E_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  // Safety rail: this setup wipes the database — only ever a *_e2e one.
  if (!dbName.endsWith("_e2e")) {
    throw new Error(
      `Refusing to reset "${dbName}" — the e2e database name must end with "_e2e"`,
    );
  }

  const adminUrl = new URL(E2E_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });
}
