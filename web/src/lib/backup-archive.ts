import type { Readable } from "node:stream";

import { prisma } from "@/lib/db";
import {
  ARTICLES_DIR,
  INDEX_ENTRY,
  LINKS_ENTRY,
  MANIFEST_ENTRY,
  isArticleEntry,
  unpackArchive,
  type ArchiveEntry,
} from "@/lib/archive";
import { buildArticleFile, parseArticleFile } from "@/lib/article-file";
import { Importer, type ImportSummary } from "@/lib/backup";
import {
  articleFilename,
  articleToMarkdown,
  indexToMarkdown,
} from "@/lib/markdown";
import {
  assertSupportedManifest,
  encodeLine,
  parseLinkLine,
  TRANSFER_VERSION,
  TransferError,
  type ArchiveManifest,
  type LinkRecord,
  type TransferRecord,
} from "@/lib/transfer";

/**
 * The multi-file backup archive, and the one-way Markdown export.
 *
 * Kept apart from `backup.ts` (which owns the single-stream NDJSON format and
 * the shared `Importer`) so neither file has to know how the other is laid out.
 */

/** Articles per database round trip. */
const BATCH = 200;

const ARCHIVE_SELECT = {
  id: true,
  url: true,
  title: true,
  siteName: true,
  author: true,
  excerpt: true,
  content: true,
  wordCount: true,
  readingMinutes: true,
  leadImageUrl: true,
  state: true,
  starred: true,
  extractionFailed: true,
  summary: true,
  savedAt: true,
  readAt: true,
  publishedAt: true,
  lang: true,
  classifiedAt: true,
  isProduct: true,
  hasEmbeddedMedia: true,
  tags: {
    select: { position: true, source: true, tag: { select: { name: true } } },
    orderBy: { position: "asc" as const },
  },
} as const;

/**
 * Every article, or just one collection's.
 *
 * Filtering here rather than in the callers keeps the manifest, the link index
 * and the bodies looking at the same set — a collection export that disagreed
 * with itself would restore as a library full of stubs.
 */
async function* articleRows(userId: string, tagId?: string) {
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.article.findMany({
      where: { userId, ...(tagId ? { tags: { some: { tagId } } } : {}) },
      select: ARCHIVE_SELECT,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) return;
    cursor = page[page.length - 1].id;
    for (const row of page) yield row;
  }
}

/**
 * Streams a full backup as archive entries.
 *
 * Order matters: the manifest and the link index come first so a restore knows
 * the shape — and the archive-id-to-url mapping — before any body arrives. Tar
 * is read sequentially, so a body that arrived first would have nothing to
 * attach itself to.
 *
 * The link index is accumulated in memory (a few hundred bytes per article,
 * so single-digit megabytes even for a large library) while bodies are written
 * straight through, which is where the actual bulk is.
 */
export async function* exportArchiveEntries(
  userId: string,
  now: Date,
  options: { includeContent: boolean; tagId?: string },
): AsyncGenerator<ArchiveEntry> {
  const scope = options.tagId
    ? { userId, tags: { some: { tagId: options.tagId } } }
    : { userId };
  const [articles, tags, user, tagRows] = await Promise.all([
    prisma.article.count({ where: scope }),
    prisma.tag.count({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiSummariesEnabled: true,
        aiModel: true,
        aiPrompt: true,
        summaryView: true,
        customTopics: true,
        markReadOnListen: true,
      },
    }),
    prisma.tag.findMany({
      where: { userId },
      select: { name: true, slug: true, kind: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const manifest: ArchiveManifest = {
    version: TRANSFER_VERSION,
    app: "stash",
    exportedAt: now.toISOString(),
    includesContent: options.includeContent,
    counts: { articles, tags },
    // aiApiKey is absent by construction: it is not in the select above.
    settings: user ?? null,
    tags: tagRows,
  };
  yield { name: MANIFEST_ENTRY, body: `${JSON.stringify(manifest, null, 2)}\n` };

  const bodies: ArchiveEntry[] = [];
  let links = "";

  for await (const row of articleRows(userId, options.tagId)) {
    const link: LinkRecord = {
      type: "link",
      id: row.id,
      url: row.url,
      title: row.title,
      siteName: row.siteName,
      author: row.author,
      excerpt: row.excerpt,
      wordCount: row.wordCount,
      readingMinutes: row.readingMinutes,
      leadImageUrl: row.leadImageUrl,
      state: row.state,
      starred: row.starred,
      extractionFailed: row.extractionFailed,
      summary: row.summary,
      savedAt: row.savedAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      lang: row.lang,
      classifiedAt: row.classifiedAt?.toISOString() ?? null,
      isProduct: row.isProduct,
      hasEmbeddedMedia: row.hasEmbeddedMedia,
      tags: row.tags.map((m) => ({
        name: m.tag.name,
        position: m.position,
        source: m.source,
      })),
    };
    links += encodeLine(link as unknown as TransferRecord);

    if (options.includeContent && row.content) {
      bodies.push({
        name: `${ARTICLES_DIR}${articleFilename(row, "html")}`,
        body: buildArticleFile({
          title: row.title,
          url: row.url,
          lang: row.lang,
          summary: row.summary,
          content: row.content,
        }),
      });
    }
  }

  yield { name: LINKS_ENTRY, body: links };
  for (const body of bodies) yield body;
}

/**
 * Streams the one-way Markdown export: an index plus a file per article.
 *
 * Never re-imported, which is what lets these be ordinary Markdown instead of
 * Markdown wrapped around preserved HTML.
 */
export async function* exportMarkdownEntries(
  userId: string,
  now: Date,
  options: { tagId?: string } = {},
): AsyncGenerator<ArchiveEntry> {
  const rows: Parameters<typeof articleToMarkdown>[0][] = [];

  for await (const row of articleRows(userId, options.tagId)) {
    rows.push({
      id: row.id,
      url: row.url,
      title: row.title,
      siteName: row.siteName,
      author: row.author,
      excerpt: row.excerpt,
      content: row.content,
      summary: row.summary,
      state: String(row.state),
      starred: row.starred,
      savedAt: row.savedAt,
      publishedAt: row.publishedAt,
      lang: row.lang,
      readingMinutes: row.readingMinutes,
      tags: row.tags.map((m) => m.tag.name),
    });
  }

  yield { name: INDEX_ENTRY, body: indexToMarkdown(rows, now) };
  for (const row of rows) {
    yield {
      name: `${ARTICLES_DIR}${articleFilename(row, "md")}`,
      body: articleToMarkdown(row),
    };
  }
}

export interface ImportOptions {
  /** Take the file's collections, or re-derive them from the article itself. */
  tags: "import" | "assign";
  /** Keep what the file has, or prefer the live page and fall back to it. */
  content: "missing" | "refresh";
  summary: "missing" | "always" | "ondemand";
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  tags: "assign",
  content: "missing",
  summary: "ondemand",
};

/** Reads options off a request, falling back to the defaults field by field. */
export function parseImportOptions(raw: unknown): ImportOptions {
  const given = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as Partial<ImportOptions>;
  return {
    tags: given.tags === "import" ? "import" : "assign",
    content: given.content === "refresh" ? "refresh" : "missing",
    summary:
      given.summary === "missing" || given.summary === "always"
        ? given.summary
        : "ondemand",
  };
}

const ARCHIVE_LIMITS = {
  /** One article body. Generous, but not unbounded. */
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

/** Recovers the archive's own article id from `articles/<id>-<slug>.html`. */
export function idFromEntryName(name: string): string {
  return name
    .slice(ARTICLES_DIR.length)
    .replace(/\.html?$/i, "")
    .split("-")[0];
}

/**
 * Restores a tar.gz archive.
 *
 * Entries are handled in the order they were written: the manifest brings
 * settings and collections, the link index creates the rows, and each body is
 * matched to its row through the archive's own id — the row's real id is new,
 * so the filename is the only thing connecting them.
 */
export async function importArchive(
  source: Readable,
  userId: string,
  options: ImportOptions,
): Promise<ImportSummary> {
  const importer = new Importer(userId, { tags: options.tags });
  await importer.load();

  const urlById = new Map<string, string>();
  let sawManifest = false;

  for await (const entry of unpackArchive(source, ARCHIVE_LIMITS)) {
    if (entry.name === MANIFEST_ENTRY) {
      const manifest = assertSupportedManifest(await entry.text());
      sawManifest = true;
      if (manifest.settings) {
        await importer.add({ type: "settings", ...manifest.settings });
      }
      // Collections are created up front so empty ones survive a restore, and
      // so the ids exist before any article references them.
      if (options.tags === "import") {
        for (const tag of manifest.tags ?? []) {
          await importer.add({ type: "tag", ...tag });
        }
      }
      continue;
    }

    if (entry.name === LINKS_ENTRY) {
      if (!sawManifest) {
        throw new TransferError(
          "This archive lists links before stash.json, so it cannot be read in order",
        );
      }
      const text = await entry.text();
      let lineNumber = 0;
      for (const line of text.split("\n")) {
        lineNumber += 1;
        let link: LinkRecord | null;
        try {
          link = parseLinkLine(line);
        } catch (err) {
          importer.note(
            `${LINKS_ENTRY} line ${lineNumber}: ${
              err instanceof Error ? err.message : "unreadable"
            }`,
          );
          continue;
        }
        if (!link) continue;
        urlById.set(link.id, link.url);
        await importer.addLink(
          options.tags === "assign" ? { ...link, tags: [] } : link,
        );
      }
      // The rows have to exist before a body can attach to one.
      await importer.flush();
      continue;
    }

    if (isArticleEntry(entry.name)) {
      const url = urlById.get(idFromEntryName(entry.name));
      if (!url) {
        importer.note(`${entry.name}: no matching entry in the link index`);
        continue;
      }
      const parsed = parseArticleFile(await entry.text());
      if (!parsed) {
        importer.note(`${entry.name}: not a Stash article file`);
        continue;
      }
      await importer.attachBody(url, parsed.content, parsed.summary);
      continue;
    }
  }

  if (!sawManifest) {
    throw new TransferError(
      "This does not look like a Stash archive: it contains no stash.json",
    );
  }
  return importer.finish();
}
