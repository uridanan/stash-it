/**
 * Fetches article text for stubs — rows imported from a URL-only source such
 * as Instapaper, which arrive with metadata but no content.
 *
 * Network-bound and deliberately unhurried, so run it yourself rather than
 * from a request:
 *
 *   npx tsx scripts/fetch-stubs.ts --limit 50     # try a batch first
 *   npx tsx scripts/fetch-stubs.ts                # everything outstanding
 *   npx tsx scripts/fetch-stubs.ts --dry-run
 *
 * A page that no longer resolves is marked as a failed extraction so the
 * reader stops offering to fetch it, and the run continues. Expect a fair
 * number of those on a library that goes back years.
 */

import { PrismaClient } from "@prisma/client";

import { fillStub } from "../src/lib/backup";

const prisma = new PrismaClient();

/** Pause between fetches, so one site is never hammered. */
const DELAY_MS = 400;

function arg(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = arg("--limit");
  const take = limitArg ? Number(limitArg) : undefined;
  if (take !== undefined && (!Number.isInteger(take) || take < 1)) {
    throw new Error("--limit expects a positive integer");
  }

  const stubs = await prisma.article.findMany({
    where: { content: "", extractionFailed: false },
    select: { id: true, url: true, userId: true, title: true },
    orderBy: { savedAt: "desc" },
    ...(take ? { take } : {}),
  });

  console.log(
    `${stubs.length} stub(s) to fetch${dryRun ? " (dry run — nothing written)" : ""}`,
  );
  if (dryRun) {
    for (const stub of stubs.slice(0, 20)) console.log(`  ${stub.url}`);
    if (stubs.length > 20) console.log(`  … and ${stubs.length - 20} more`);
    return;
  }

  let filled = 0;
  let failed = 0;
  for (const [i, stub] of stubs.entries()) {
    const label = `[${i + 1}/${stubs.length}] ${stub.title.slice(0, 60)}`;
    const result = await fillStub(stub.id, stub.userId);
    if (result.ok) {
      filled += 1;
      console.log(`${label} — ok`);
    } else {
      failed += 1;
      console.warn(`${label} — ${result.reason?.slice(0, 100) ?? "failed"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  console.log(`Done. ${filled} fetched, ${failed} unreachable.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
