import { prisma } from "@/lib/db";
import { autoTagsFor } from "@/lib/auto-tags";
import type { InstapaperRow } from "@/lib/instapaper";
import { mapFolder } from "@/lib/instapaper";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { htmlToText } from "@/lib/summarize";
import { applyAutoTags } from "@/lib/tags";
import {
  encodeLine,
  TRANSFER_VERSION,
  type ArticleRecord,
  type LinkRecord,
  type MetaRecord,
  type SettingsRecord,
  type TagRecord,
  type TransferRecord,
} from "@/lib/transfer";

/**
 * Reading and writing whole accounts.
 *
 * Both directions work in batches rather than all at once: an account with
 * 10k+ articles carries tens of megabytes of HTML, and neither the export nor
 * the import should need all of it resident to make progress.
 */

/** Articles per database round trip. Large enough to be quick, small enough to stream. */
const BATCH = 400;

/**
 * An article whose text has never been fetched — an Instapaper import, or any
 * other URL-only source.
 *
 * Derived rather than stored: a successful extraction always yields non-empty
 * content, and a failed one sets `extractionFailed`, so empty-and-not-failed
 * is unambiguous and needs no extra column.
 */
export function isStub(article: {
  content: string;
  extractionFailed: boolean;
}): boolean {
  return article.content.length === 0 && !article.extractionFailed;
}

const ARTICLE_SELECT = {
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
    select: {
      position: true,
      source: true,
      tag: { select: { name: true } },
    },
    orderBy: { position: "asc" as const },
  },
} as const;

/**
 * Streams an account as NDJSON records, meta line first.
 *
 * An async generator so the caller can pipe straight into gzip and out to the
 * response without buffering the whole export.
 */
export async function* exportRecords(
  userId: string,
  now: Date,
): AsyncGenerator<string> {
  const [articles, tags] = await Promise.all([
    prisma.article.count({ where: { userId } }),
    prisma.tag.count({ where: { userId } }),
  ]);

  const meta: MetaRecord = {
    type: "meta",
    version: TRANSFER_VERSION,
    exportedAt: now.toISOString(),
    app: "stash",
    counts: { articles, tags },
  };
  yield encodeLine(meta);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      aiSummariesEnabled: true,
      aiModel: true,
      aiPrompt: true,
      summaryView: true,
      customTopics: true,
      markReadOnListen: true,
    },
  });
  if (user) {
    // Note the absence of aiApiKey: a backup is a file that gets copied
    // around, and a credential has no business travelling with it.
    const settings: SettingsRecord = { type: "settings", ...user };
    yield encodeLine(settings);
  }

  // Tags first, so an importer can create empty collections too.
  for (const tag of await prisma.tag.findMany({
    where: { userId },
    select: { name: true, slug: true, kind: true },
    orderBy: { name: "asc" },
  })) {
    const record: TagRecord = { type: "tag", ...tag };
    yield encodeLine(record);
  }

  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.article.findMany({
      where: { userId },
      select: { id: true, ...ARTICLE_SELECT },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const row of page) {
      const { tags: memberships, ...rest } = row;
      delete (rest as { id?: string }).id;
      const record: ArticleRecord = {
        type: "article",
        ...rest,
        savedAt: rest.savedAt.toISOString(),
        readAt: rest.readAt?.toISOString() ?? null,
        publishedAt: rest.publishedAt?.toISOString() ?? null,
        classifiedAt: rest.classifiedAt?.toISOString() ?? null,
        tags: memberships.map((m) => ({
          name: m.tag.name,
          position: m.position,
          source: m.source,
        })),
      };
      yield encodeLine(record);
    }
  }
}

export interface ImportSummary {
  articlesCreated: number;
  articlesSkipped: number;
  tagsCreated: number;
  settingsApplied: boolean;
  /** Article bodies matched back to their row from an archive. */
  bodiesAttached: number;
  /** Lines that could not be read, capped for reporting. */
  problems: string[];
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Applies records to an account.
 *
 * Existing URLs are left untouched rather than overwritten, which makes a
 * restore safe to re-run and stops a stale backup from clobbering newer
 * reading state. Tags are matched by name, so a restore rejoins the
 * collections already present instead of duplicating them.
 */
export class Importer {
  private readonly summary: ImportSummary = {
    articlesCreated: 0,
    articlesSkipped: 0,
    tagsCreated: 0,
    settingsApplied: false,
    bodiesAttached: 0,
    problems: [],
  };

  /** url -> already in the account. Loaded once; kept current as we insert. */
  private existingUrls = new Set<string>();
  /** lowercased tag name -> tag id */
  private tagIds = new Map<string, string>();
  private pending: {
    record: ArticleRecord;
  }[] = [];

  constructor(
    private readonly userId: string,
    /**
     * Absent for the NDJSON path, which has no options and always takes the
     * file's collections.
     */
    private readonly options: {
      tags: "import" | "assign";
    } = { tags: "import" },
  ) {}

  /**
   * Queues a link-index row from an archive.
   *
   * Bodies arrive later as separate entries, so this creates the row with
   * whatever the index knows and leaves content empty — which makes it a stub
   * until `attachBody` fills it, or until a fetch job does.
   */
  async addLink(link: LinkRecord): Promise<void> {
    await this.queueArticle({
      type: "article",
      url: link.url,
      title: link.title,
      siteName: link.siteName,
      author: link.author,
      excerpt: link.excerpt,
      content: "",
      wordCount: link.wordCount,
      readingMinutes: link.readingMinutes,
      leadImageUrl: link.leadImageUrl,
      state: link.state,
      starred: link.starred,
      extractionFailed: link.extractionFailed,
      // Archives written before the link record carried a summary leave this
      // null and hand it over with the body file instead; see attachBody.
      summary: link.summary ?? null,
      savedAt: link.savedAt,
      readAt: link.readAt,
      publishedAt: link.publishedAt,
      lang: link.lang,
      classifiedAt: link.classifiedAt,
      isProduct: link.isProduct,
      hasEmbeddedMedia: link.hasEmbeddedMedia,
      tags: link.tags ?? [],
    });
  }

  /**
   * Attaches a body to a row the link index already created.
   *
   * Only ever fills a gap: an article that already has text is left alone, so
   * re-running an import cannot overwrite a copy that has since been refetched.
   */
  async attachBody(
    url: string,
    content: string,
    summary: string | null,
  ): Promise<void> {
    const article = await prisma.article.findUnique({
      where: { userId_url: { userId: this.userId, url } },
      // lang and leadImageUrl came in on the link record, and the automatic
      // tags need them: without lang, English falls through to script
      // detection, which only recognizes non-Latin alphabets, and the language
      // collection would silently go missing on every restore.
      select: {
        id: true,
        content: true,
        extractionFailed: true,
        lang: true,
        leadImageUrl: true,
        isProduct: true,
        hasEmbeddedMedia: true,
      },
    });
    if (!article || !isStub(article)) return;

    // Sanitized again: an archive is a file, and this is later rendered with
    // dangerouslySetInnerHTML.
    const clean = content ? sanitizeArticleHtml(content) : "";
    const text = htmlToText(clean);
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;

    await prisma.article.update({
      where: { id: article.id },
      data: {
        content: clean,
        // Only ever fills a gap. The link record now carries the summary, so
        // a body file without one — an older archive, or an article whose
        // summary was written after the export — must not erase it.
        ...(summary ? { summary } : {}),
        wordCount: words,
        readingMinutes: Math.max(1, Math.ceil(words / 225)),
      },
    });
    this.summary.bodiesAttached += 1;

    // Deterministic tags need content, so they could not run until now.
    if (this.options.tags === "assign" && clean) {
      await applyAutoTags(
        this.userId,
        article.id,
        autoTagsFor({
          url,
          wordCount: words,
          content: clean,
          leadImageUrl: article.leadImageUrl,
          lang: article.lang,
          extractionFailed: false,
          // Stored columns, restored from the link index, so re-deriving
          // collections keeps Shopping and Visual content.
          isProduct: article.isProduct,
          hasEmbeddedMedia: article.hasEmbeddedMedia,
        }),
      );
    }
  }


  async load(): Promise<void> {
    const [urls, tags] = await Promise.all([
      prisma.article.findMany({
        where: { userId: this.userId },
        select: { url: true },
      }),
      prisma.tag.findMany({
        where: { userId: this.userId },
        select: { id: true, name: true },
      }),
    ]);
    this.existingUrls = new Set(urls.map((u) => u.url));
    this.tagIds = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  }

  note(problem: string): void {
    if (this.summary.problems.length < 20) this.summary.problems.push(problem);
  }

  async add(record: TransferRecord): Promise<void> {
    switch (record.type) {
      case "meta":
        return;
      case "settings":
        await this.applySettings(record);
        return;
      case "tag":
        await this.ensureTag(record.name, record.kind);
        return;
      case "article":
        await this.queueArticle(record);
        return;
    }
  }

  private async applySettings(record: SettingsRecord): Promise<void> {
    await prisma.user.update({
      where: { id: this.userId },
      data: {
        aiSummariesEnabled: record.aiSummariesEnabled,
        aiModel: record.aiModel,
        aiPrompt: record.aiPrompt,
        summaryView: record.summaryView,
        customTopics: record.customTopics ?? [],
        markReadOnListen: record.markReadOnListen ?? false,
      },
    });
    this.summary.settingsApplied = true;
  }

  async ensureTag(name: string, kind: TagRecord["kind"]): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    const known = this.tagIds.get(key);
    if (known) return known;

    // uniqueSlug needs the slugs already taken; read them lazily and rarely.
    const { uniqueSlug } = await import("@/lib/tag-order");
    const taken = await prisma.tag.findMany({
      where: { userId: this.userId },
      select: { slug: true },
    });
    const slug = uniqueSlug(
      trimmed,
      taken.map((t) => t.slug),
    );
    try {
      const created = await prisma.tag.create({
        data: { userId: this.userId, name: trimmed, slug, kind },
        select: { id: true },
      });
      this.tagIds.set(key, created.id);
      this.summary.tagsCreated += 1;
      return created.id;
    } catch {
      const raced = await prisma.tag.findUnique({
        where: { userId_slug: { userId: this.userId, slug } },
        select: { id: true },
      });
      if (raced) this.tagIds.set(key, raced.id);
      return raced?.id ?? null;
    }
  }

  private async queueArticle(record: ArticleRecord): Promise<void> {
    if (!record.url || typeof record.url !== "string") {
      this.note("article record with no url");
      return;
    }
    if (this.existingUrls.has(record.url)) {
      this.summary.articlesSkipped += 1;
      return;
    }
    this.existingUrls.add(record.url);
    this.pending.push({ record });
    if (this.pending.length >= BATCH) await this.flush();
  }

  /** Writes the queued articles and their collection memberships. */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];

    await prisma.article.createMany({
      data: batch.map(({ record }) => ({
        userId: this.userId,
        url: record.url,
        title: record.title || record.url,
        siteName: record.siteName ?? null,
        author: record.author ?? null,
        excerpt: record.excerpt ?? null,
        // Re-sanitized, never trusted. A backup is a file that can be
        // hand-edited or handed over by someone else, and this content is
        // later rendered with dangerouslySetInnerHTML — the extraction path
        // sanitizes for exactly this reason and the import path must too.
        content: record.content ? sanitizeArticleHtml(record.content) : "",
        wordCount: record.wordCount ?? 0,
        readingMinutes: record.readingMinutes ?? 0,
        leadImageUrl: record.leadImageUrl ?? null,
        state: record.state === "ARCHIVED" ? "ARCHIVED" : "UNREAD",
        starred: Boolean(record.starred),
        extractionFailed: Boolean(record.extractionFailed),
        summary: record.summary ?? null,
        savedAt: parseDate(record.savedAt) ?? new Date(),
        readAt: parseDate(record.readAt),
        publishedAt: parseDate(record.publishedAt),
        lang: record.lang ?? null,
        classifiedAt: parseDate(record.classifiedAt),
        isProduct: Boolean(record.isProduct),
        hasEmbeddedMedia: Boolean(record.hasEmbeddedMedia),
      })),
      skipDuplicates: true,
    });
    this.summary.articlesCreated += batch.length;

    // Map the URLs back to ids so memberships can be written in one go.
    const created = await prisma.article.findMany({
      where: {
        userId: this.userId,
        url: { in: batch.map(({ record }) => record.url) },
      },
      select: { id: true, url: true },
    });
    const idByUrl = new Map(created.map((a) => [a.url, a.id]));

    const memberships: {
      articleId: string;
      tagId: string;
      position: number;
      source: "MANUAL" | "AUTO";
    }[] = [];
    for (const { record } of batch) {
      const articleId = idByUrl.get(record.url);
      if (!articleId || !Array.isArray(record.tags)) continue;
      for (const [index, ref] of record.tags.entries()) {
        const tagId = await this.ensureTag(ref.name, "CUSTOM");
        if (!tagId) continue;
        memberships.push({
          articleId,
          tagId,
          position: Number.isFinite(ref.position) ? ref.position : index + 1,
          source: ref.source === "AUTO" ? "AUTO" : "MANUAL",
        });
      }
    }
    if (memberships.length > 0) {
      await prisma.articleTag.createMany({
        data: memberships,
        skipDuplicates: true,
      });
    }
  }

  async finish(): Promise<ImportSummary> {
    await this.flush();
    return this.summary;
  }
}

/**
 * Turns Instapaper rows into article records.
 *
 * Content is left empty on purpose: the export has none, and fetching 11k
 * pages inline would take hours and fail often. They arrive as stubs and the
 * text is filled in later, per article or in bulk.
 */
export function instapaperToRecords(rows: InstapaperRow[]): ArticleRecord[] {
  return rows.map((row) => {
    const { state, starred } = mapFolder(row.folder);
    return {
      type: "article",
      url: row.url,
      title: row.title,
      siteName: null,
      author: null,
      excerpt: row.selection,
      content: "",
      wordCount: 0,
      readingMinutes: 0,
      leadImageUrl: null,
      state,
      starred,
      extractionFailed: false,
      summary: null,
      savedAt: row.savedAt.toISOString(),
      // Instapaper's Archive folder records no date, so the save time is the
      // best available stand-in for when it was read.
      readAt: state === "ARCHIVED" ? row.savedAt.toISOString() : null,
      publishedAt: null,
      lang: null,
      classifiedAt: null,
      isProduct: false,
      hasEmbeddedMedia: false,
      tags: row.tags.map((name, index) => ({
        name,
        position: index + 1,
        source: "MANUAL" as const,
      })),
    };
  });
}

/**
 * Fetches and stores the text for a stub, then applies the automatic tags that
 * were skipped at import time for want of content.
 */
export async function fillStub(
  articleId: string,
  userId: string,
  /**
   * Re-fetch even when the article already has text. Used by the per-article
   * Refetch action and by the "fetch first" import option, which prefers the
   * live page and keeps the imported copy only as a fallback.
   */
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const article = await prisma.article.findFirst({
    where: { id: articleId, userId },
    select: { id: true, url: true, content: true, extractionFailed: true },
  });
  if (!article) return { ok: false, reason: "not found" };
  if (!options.force && !isStub(article)) return { ok: true };

  const { extractArticle } = await import("@/lib/extract");
  try {
    const { signals, ...extracted } = await extractArticle(article.url);
    await prisma.article.update({
      where: { id: article.id },
      data: { ...extracted, extractionFailed: false, ...signals },
    });
    await applyAutoTags(
      userId,
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
    return { ok: true };
  } catch (err) {
    // A forced refetch that fails must leave the existing copy intact — the
    // point of "fetch first, fall back to the import" is that the fallback
    // survives. Only a stub, which has nothing to lose, is marked failed so
    // the reader stops offering to try forever.
    if (isStub(article)) {
      await prisma.article.update({
        where: { id: article.id },
        data: { extractionFailed: true },
      });
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "extraction failed",
    };
  }
}
