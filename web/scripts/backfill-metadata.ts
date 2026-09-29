/**
 * Backfills published date, language and automatic tags for articles saved
 * before collections existed.
 *
 * Re-fetches each article's original URL, so it is slow and network-bound by
 * design — run it once, by hand:
 *
 *   npx tsx scripts/backfill-metadata.ts            # every article missing data
 *   npx tsx scripts/backfill-metadata.ts --dry-run  # report only
 *   npx tsx scripts/backfill-metadata.ts --limit 20
 *
 * Existing content is never overwritten: only `publishedAt`, `lang` and tags
 * are touched, and a page that no longer resolves is left exactly as it is.
 */

import { PrismaClient } from "@prisma/client";

import { autoTagsFor } from "../src/lib/auto-tags";
import { extractArticle } from "../src/lib/extract";
import { applyAutoTags } from "../src/lib/tags";

const prisma = new PrismaClient();

/** Pause between fetches, so a backfill doesn't hammer any one site. */
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

  const articles = await prisma.article.findMany({
    where: {
      extractionFailed: false,
      // Only rows that predate the new columns.
      OR: [{ publishedAt: null }, { lang: null }],
    },
    select: { id: true, url: true, userId: true, title: true },
    orderBy: { savedAt: "desc" },
    ...(take ? { take } : {}),
  });

  console.log(
    `${articles.length} article(s) to backfill${dryRun ? " (dry run)" : ""}`,
  );

  let updated = 0;
  let failed = 0;

  for (const [i, article] of articles.entries()) {
    const label = `[${i + 1}/${articles.length}] ${article.title.slice(0, 60)}`;
    try {
      const { signals, ...extracted } = await extractArticle(article.url);

      if (dryRun) {
        console.log(
          `${label} — published=${extracted.publishedAt?.toISOString() ?? "none"} lang=${extracted.lang ?? "none"}`,
        );
      } else {
        await prisma.article.update({
          where: { id: article.id },
          data: {
            publishedAt: extracted.publishedAt,
            lang: extracted.lang,
          },
        });
        await applyAutoTags(
          article.userId,
          article.id,
          autoTagsFor({
            url: article.url,
            wordCount: extracted.wordCount,
            content: extracted.content,
            leadImageUrl: extracted.leadImageUrl,
            lang: extracted.lang,
            extractionFailed: false,
            ...signals,
          }),
        );
        console.log(`${label} — updated`);
      }
      updated += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      // A dead link is expected for old saves; keep going.
      console.warn(`${label} — skipped: ${message.slice(0, 120)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  console.log(`Done. ${updated} processed, ${failed} skipped.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
