import { prisma } from "@/lib/db";
import {
  DEFAULT_ORDER,
  DEFAULT_SORT,
  type ArticleSort,
  type SortOrder,
} from "@/lib/sort";
import { autoTagsFor } from "@/lib/auto-tags";
import { ExtractionError, extractArticle } from "@/lib/extract";
import { applyAutoTags } from "@/lib/tags";
import { runAiTasksOnSave } from "@/lib/ai-tasks";
export {
  DEFAULT_ORDER,
  DEFAULT_SORT,
  parseOrder,
  parseSort,
  type ArticleSort,
  type SortOrder,
} from "@/lib/sort";

import type {
  ArticleDTO,
  ArticleListItemDTO,
  ArticleState,
} from "@/types";

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

/**
 * Parse an article state from API input. Accepts "unread"/"archived"
 * (the documented contract) as well as "UNREAD"/"ARCHIVED".
 */
export function parseArticleState(value: unknown): ArticleState | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase();
  return normalized === "UNREAD" || normalized === "ARCHIVED"
    ? normalized
    : null;
}

/**
 * Structural shape of an Article row as returned by the query helpers
 * (list queries omit `content`). Dates are Date objects; API routes
 * serialize them to ISO strings via the DTO helpers below.
 */
export interface ArticleListRow {
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  wordCount: number;
  readingMinutes: number;
  leadImageUrl: string | null;
  state: ArticleState;
  starred: boolean;
  extractionFailed: boolean;
  savedAt: Date;
  readAt: Date | null;
  publishedAt: Date | null;
  lang: string | null;
}

export interface ArticleRow extends ArticleListRow {
  content: string;
  summary: string | null;
}

const LIST_SELECT = {
  id: true,
  url: true,
  title: true,
  siteName: true,
  author: true,
  excerpt: true,
  wordCount: true,
  readingMinutes: true,
  leadImageUrl: true,
  state: true,
  starred: true,
  extractionFailed: true,
  savedAt: true,
  readAt: true,
  publishedAt: true,
  lang: true,
} as const;

export function toArticleListItemDTO(row: ArticleListRow): ArticleListItemDTO {
  return {
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
    savedAt: row.savedAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    lang: row.lang,
  };
}

export function toArticleDTO(row: ArticleRow): ArticleDTO {
  return { ...toArticleListItemDTO(row), content: row.content, summary: row.summary };
}

export interface ListArticlesParams {
  userId: string;
  state?: ArticleState;
  starred?: boolean;
  q?: string;
  /** Restrict to articles carrying this tag id. */
  tagId?: string;
  sort?: ArticleSort;
  order?: SortOrder;
  cursor?: string;
  limit?: number;
}

export interface ListArticlesResult {
  articles: ArticleListRow[];
  nextCursor: string | null;
}

/**
 * List a user's articles with keyset pagination (cursor = id of the last item
 * of the previous page). q matches title/excerpt/siteName, case-insensitive.
 *
 * Sorted by save date (default) or published date, in either direction. The
 * trailing `id` tiebreaker is what keeps the cursor correct under every
 * ordering — without a unique last key, keyset pagination can skip or repeat
 * rows that share a timestamp.
 */
export async function listArticles({
  userId,
  state,
  starred,
  q,
  tagId,
  sort = DEFAULT_SORT,
  order = DEFAULT_ORDER,
  cursor,
  limit = DEFAULT_LIST_LIMIT,
}: ListArticlesParams): Promise<ListArticlesResult> {
  const take = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);

  const rows = await prisma.article.findMany({
    where: {
      userId,
      ...(state !== undefined ? { state } : {}),
      ...(starred !== undefined ? { starred } : {}),
      ...(tagId !== undefined ? { tags: { some: { tagId } } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { excerpt: { contains: q, mode: "insensitive" } },
              { siteName: { contains: q, mode: "insensitive" } },
              // Full text and tags too, so "that piece about ospreys" is
              // findable when the word never made it into the title.
              { content: { contains: q, mode: "insensitive" } },
              {
                tags: {
                  some: {
                    tag: { name: { contains: q, mode: "insensitive" } },
                  },
                },
              },
            ],
          }
        : {}),
    },
    orderBy:
      sort === "published"
        ? // Most saved pages declare no published date; they belong at the end
          // under either direction rather than crowding out the ones that do.
          [{ publishedAt: { sort: order, nulls: "last" } }, { id: "desc" }]
        : [{ savedAt: order }, { id: "desc" }],
    select: LIST_SELECT,
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    articles: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/** Fetch a single article (with content), scoped to the owning user. */
export async function getArticle(
  id: string,
  userId: string,
): Promise<ArticleRow | null> {
  return prisma.article.findFirst({ where: { id, userId } });
}

export interface UpdateArticleInput {
  state?: ArticleState;
  starred?: boolean;
}

/** Update state/starred, scoped to the owning user. Returns null if not found. */
export async function updateArticle(
  id: string,
  userId: string,
  input: UpdateArticleInput,
): Promise<ArticleRow | null> {
  const existing = await prisma.article.findFirst({
    where: { id, userId },
    select: { id: true, readAt: true },
  });
  if (!existing) return null;

  return prisma.article.update({
    where: { id: existing.id },
    data: {
      ...(input.state !== undefined
        ? {
            state: input.state,
            // Track first archive time as readAt; clear it on unarchive.
            readAt:
              input.state === "ARCHIVED"
                ? (existing.readAt ?? new Date())
                : null,
          }
        : {}),
      ...(input.starred !== undefined ? { starred: input.starred } : {}),
    },
  });
}

/** Delete an article, scoped to the owning user. Returns false if not found. */
export async function deleteArticle(id: string, userId: string): Promise<boolean> {
  const { count } = await prisma.article.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** The saved article, plus whether it was newly created (vs. a re-save). */
export type SavedArticle = ArticleRow & { created: boolean };

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

async function resaveExisting(
  userId: string,
  url: string,
): Promise<ArticleRow | null> {
  const existing = await prisma.article.findUnique({
    where: { userId_url: { userId, url } },
    select: { id: true },
  });
  if (!existing) return null;
  return prisma.article.update({
    where: { id: existing.id },
    data: { state: "UNREAD", savedAt: new Date(), readAt: null },
  });
}

/**
 * Save a URL for a user: extract + create. If the URL was already saved,
 * un-archive it and bump savedAt instead (no re-extraction; created=false).
 * On extraction failure, save a stub with extractionFailed=true and
 * title = hostname.
 *
 * Throws ExtractionError("invalid-url") if the URL is not http(s).
 */
export async function saveArticleFromUrl(
  userId: string,
  url: string,
): Promise<SavedArticle> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ExtractionError("invalid-url", `Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ExtractionError("invalid-url", `Unsupported scheme: ${parsed.protocol}`);
  }
  const normalizedUrl = parsed.toString();

  const resaved = await resaveExisting(userId, normalizedUrl);
  if (resaved) return { ...resaved, created: false };

  let data: {
    title: string;
    siteName: string | null;
    author: string | null;
    excerpt: string | null;
    content: string;
    wordCount: number;
    readingMinutes: number;
    leadImageUrl: string | null;
    publishedAt: Date | null;
    lang: string | null;
    extractionFailed: boolean;
    isProduct: boolean;
    hasEmbeddedMedia: boolean;
  };
  /** Signals only visible during extraction; absent when extraction failed. */
  let signals = { isProduct: false, hasEmbeddedMedia: false };

  try {
    const { signals: extractedSignals, ...extracted } =
      await extractArticle(normalizedUrl);
    data = { ...extracted, extractionFailed: false, ...extractedSignals };
    signals = extractedSignals;
  } catch {
    data = {
      title: parsed.hostname,
      siteName: null,
      author: null,
      excerpt: null,
      content: "",
      wordCount: 0,
      readingMinutes: 0,
      leadImageUrl: null,
      publishedAt: null,
      lang: null,
      extractionFailed: true,
      isProduct: false,
      hasEmbeddedMedia: false,
    };
  }

  try {
    const row = await prisma.article.create({
      data: { userId, url: normalizedUrl, ...data },
    });

    // Deterministic tags are cheap and awaited, so the article is already
    // categorized by the time the save returns.
    await applyAutoTags(
      userId,
      row.id,
      autoTagsFor({
        url: normalizedUrl,
        wordCount: data.wordCount,
        content: data.content,
        leadImageUrl: data.leadImageUrl,
        lang: data.lang,
        extractionFailed: data.extractionFailed,
        ...signals,
      }),
    );

    // Fire-and-forget: don't hold up the save on the AI provider.
    void runAiTasksOnSave(row.id, userId);
    return { ...row, created: true };
  } catch (err) {
    // Lost a race with a concurrent save of the same URL: fall back to re-save.
    if (isUniqueConstraintError(err)) {
      const raced = await resaveExisting(userId, normalizedUrl);
      if (raced) return { ...raced, created: false };
    }
    throw err;
  }
}
