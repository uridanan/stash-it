import type { Prisma, TagKind, TagSource } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AutoTag } from "@/lib/auto-tags";
import {
  REBALANCE_STEP,
  needsRebalance,
  positionBetween,
  positionForAppend,
  positionForTop,
  rebalancedPositions,
  uniqueSlug,
} from "@/lib/tag-order";

/**
 * Tag queries. Tags double as playlists, so every read of a tag's articles is
 * ordered by `ArticleTag.position` rather than by save date.
 */

export interface TagRow {
  id: string;
  name: string;
  slug: string;
  kind: TagKind;
  articleCount: number;
}

export interface ArticleTagRow {
  id: string;
  name: string;
  slug: string;
  kind: TagKind;
  source: TagSource;
}

/** All of a user's tags with their article counts, most-used first. */
export async function listTags(userId: string): Promise<TagRow[]> {
  const tags = await prisma.tag.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      _count: { select: { articles: true } },
    },
    orderBy: [{ name: "asc" }],
  });
  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    kind: tag.kind,
    articleCount: tag._count.articles,
  }));
}

export async function getTagBySlug(userId: string, slug: string) {
  return prisma.tag.findUnique({
    where: { userId_slug: { userId, slug } },
    select: { id: true, name: true, slug: true, kind: true },
  });
}

/** Tags attached to a set of articles, for rendering chips on a list. */
export async function tagsForArticles(
  articleIds: readonly string[],
): Promise<Map<string, ArticleTagRow[]>> {
  const byArticle = new Map<string, ArticleTagRow[]>();
  if (articleIds.length === 0) return byArticle;

  const rows = await prisma.articleTag.findMany({
    where: { articleId: { in: [...articleIds] } },
    select: {
      articleId: true,
      source: true,
      tag: { select: { id: true, name: true, slug: true, kind: true } },
    },
    orderBy: [{ tag: { kind: "asc" } }, { tag: { name: "asc" } }],
  });

  for (const row of rows) {
    const list = byArticle.get(row.articleId) ?? [];
    list.push({ ...row.tag, source: row.source });
    byArticle.set(row.articleId, list);
  }
  return byArticle;
}

/**
 * Finds or creates tags by name, case-insensitively.
 *
 * Matching on name rather than slug means "long read" and "Long Read" land on
 * the same tag instead of creating a near-duplicate collection.
 */
export async function ensureTags(
  userId: string,
  wanted: readonly { name: string; kind: TagKind }[],
): Promise<{ id: string; name: string }[]> {
  if (wanted.length === 0) return [];

  const existing = await prisma.tag.findMany({
    where: { userId },
    select: { id: true, name: true, slug: true },
  });
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
  const takenSlugs = new Set(existing.map((t) => t.slug));

  const result: { id: string; name: string }[] = [];
  for (const { name, kind } of wanted) {
    const trimmed = name.trim();
    if (!trimmed) continue;

    const hit = byName.get(trimmed.toLowerCase());
    if (hit) {
      result.push({ id: hit.id, name: hit.name });
      continue;
    }

    const slug = uniqueSlug(trimmed, takenSlugs);
    takenSlugs.add(slug);
    try {
      const created = await prisma.tag.create({
        data: { userId, name: trimmed, slug, kind },
        select: { id: true, name: true, slug: true },
      });
      byName.set(created.name.toLowerCase(), created);
      result.push({ id: created.id, name: created.name });
    } catch {
      // Lost a race with a concurrent save creating the same tag.
      const raced = await prisma.tag.findUnique({
        where: { userId_slug: { userId, slug } },
        select: { id: true, name: true },
      });
      if (raced) result.push(raced);
    }
  }
  return result;
}

/** Current positions within a tag, ascending. */
async function positionsFor(tagId: string): Promise<number[]> {
  const rows = await prisma.articleTag.findMany({
    where: { tagId },
    select: { position: true },
    orderBy: { position: "asc" },
  });
  return rows.map((r) => r.position);
}

/**
 * Attaches tags to an article, appending each to the end of its playlist.
 * Already-attached tags are left untouched, so re-tagging never reorders.
 */
export async function attachTags(
  articleId: string,
  tagIds: readonly string[],
  source: TagSource,
): Promise<void> {
  for (const tagId of tagIds) {
    const existing = await prisma.articleTag.findUnique({
      where: { articleId_tagId: { articleId, tagId } },
      select: { articleId: true },
    });
    if (existing) continue;

    await prisma.articleTag.create({
      data: {
        articleId,
        tagId,
        source,
        position: positionForAppend(await positionsFor(tagId)),
      },
    });
  }
}

/** Convenience for the save path: resolve names, then attach. */
export async function applyAutoTags(
  userId: string,
  articleId: string,
  tags: readonly AutoTag[],
): Promise<void> {
  const ensured = await ensureTags(userId, tags);
  await attachTags(
    articleId,
    ensured.map((t) => t.id),
    "AUTO",
  );
}

/** The longest a collection name may be. Long enough for a sentence-ish name. */
export const MAX_TAG_NAME = 60;

export class TagNameError extends Error {}

/**
 * Renames a collection, re-deriving its slug.
 *
 * The slug follows the name because it is the URL and nothing else references
 * it — a stale `/tags/old-name` link breaking is a smaller cost than a
 * collection whose address says something it is no longer called.
 *
 * A name another collection already uses is refused rather than silently
 * suffixed: two collections called the same thing is exactly the situation
 * merge exists for, and quietly creating "Reading" and "reading-2" would hide
 * that from the user.
 */
export async function renameTag(
  userId: string,
  tagId: string,
  rawName: string,
): Promise<{ id: string; name: string; slug: string }> {
  const name = rawName.trim().slice(0, MAX_TAG_NAME);
  if (!name) throw new TagNameError("A collection needs a name");

  const others = await prisma.tag.findMany({
    where: { userId, NOT: { id: tagId } },
    select: { name: true, slug: true },
  });
  if (others.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
    throw new TagNameError(`You already have a collection called “${name}”`);
  }

  return prisma.tag.update({
    where: { id: tagId },
    data: { name, slug: uniqueSlug(name, others.map((tag) => tag.slug)) },
    select: { id: true, name: true, slug: true },
  });
}

/**
 * Merges one collection into another and deletes the source.
 *
 * Articles the target already holds keep the position they have there — the
 * target's running order is the one being kept, so the incoming ones are
 * appended after it rather than interleaved. An article in both collections
 * is not duplicated; its source row simply goes when the source tag does.
 */
export async function mergeTags(
  userId: string,
  sourceId: string,
  targetId: string,
): Promise<{ moved: number }> {
  if (sourceId === targetId) return { moved: 0 };

  const [sourceRows, targetRows] = await Promise.all([
    prisma.articleTag.findMany({
      where: { tagId: sourceId, article: { userId } },
      orderBy: { position: "asc" },
      select: { articleId: true, source: true },
    }),
    prisma.articleTag.findMany({
      where: { tagId: targetId },
      select: { articleId: true, position: true },
    }),
  ]);

  const alreadyThere = new Set(targetRows.map((row) => row.articleId));
  const incoming = sourceRows.filter((row) => !alreadyThere.has(row.articleId));

  let next = positionForAppend(targetRows.map((row) => row.position));
  const created = incoming.map((row) => {
    const position = next;
    next += REBALANCE_STEP;
    return {
      articleId: row.articleId,
      tagId: targetId,
      position,
      source: row.source,
    };
  });

  await prisma.$transaction([
    ...(created.length
      ? [prisma.articleTag.createMany({ data: created, skipDuplicates: true })]
      : []),
    // Cascades to the source's memberships.
    prisma.tag.delete({ where: { id: sourceId } }),
  ]);

  return { moved: created.length };
}

/**
 * Adds many articles to one collection at once, in the order given.
 *
 * Articles already in it are left where they are, so re-adding a selection
 * that overlaps does not shuffle the playlist.
 */
export async function addArticlesToTag(
  userId: string,
  tagId: string,
  articleIds: readonly string[],
  source: TagSource = "MANUAL",
): Promise<{ added: number }> {
  if (articleIds.length === 0) return { added: 0 };

  const [owned, existing, positions] = await Promise.all([
    prisma.article.findMany({
      where: { userId, id: { in: [...articleIds] } },
      select: { id: true },
    }),
    prisma.articleTag.findMany({
      where: { tagId, articleId: { in: [...articleIds] } },
      select: { articleId: true },
    }),
    positionsFor(tagId),
  ]);

  const ownedIds = new Set(owned.map((row) => row.id));
  const alreadyThere = new Set(existing.map((row) => row.articleId));
  // The caller's order is the order they join the playlist in.
  const wanted = articleIds.filter(
    (id) => ownedIds.has(id) && !alreadyThere.has(id),
  );
  if (wanted.length === 0) return { added: 0 };

  let next = positionForAppend(positions);
  const created = wanted.map((articleId) => {
    const position = next;
    next += REBALANCE_STEP;
    return { articleId, tagId, position, source };
  });

  const { count } = await prisma.articleTag.createMany({
    data: created,
    skipDuplicates: true,
  });
  return { added: count };
}

export async function detachTag(
  articleId: string,
  tagId: string,
): Promise<void> {
  await prisma.articleTag.deleteMany({ where: { articleId, tagId } });
}

/**
 * Articles in a tag, in playlist order.
 *
 * `unreadOnly` narrows a collection to what is still outstanding, which is
 * also what the listen queue is seeded from — so filtering the view filters
 * what gets narrated.
 */
export async function listTagArticles(
  userId: string,
  tagId: string,
  select: Prisma.ArticleSelect,
  unreadOnly = false,
) {
  const rows = await prisma.articleTag.findMany({
    where: {
      tagId,
      article: { userId, ...(unreadOnly ? { state: "UNREAD" as const } : {}) },
    },
    orderBy: { position: "asc" },
    select: { position: true, article: { select: select } },
  });
  return rows.map((row) => row.article);
}

/** Just the ordered article ids — what the listen queue needs. */
export async function tagArticleIds(
  userId: string,
  tagId: string,
  unreadOnly = false,
): Promise<string[]> {
  const rows = await prisma.articleTag.findMany({
    where: {
      tagId,
      article: { userId, ...(unreadOnly ? { state: "UNREAD" as const } : {}) },
    },
    orderBy: { position: "asc" },
    select: { articleId: true },
  });
  return rows.map((r) => r.articleId);
}

/**
 * Renumbers a tag to whole integers.
 *
 * Called when midpointing has crowded two positions closer than floats can
 * safely split — the one failure mode of fractional ordering.
 */
async function rebalance(tagId: string): Promise<void> {
  const rows = await prisma.articleTag.findMany({
    where: { tagId },
    orderBy: { position: "asc" },
    select: { articleId: true },
  });
  const positions = rebalancedPositions(rows.length);
  await prisma.$transaction(
    rows.map((row, i) =>
      prisma.articleTag.update({
        where: { articleId_tagId: { articleId: row.articleId, tagId } },
        data: { position: positions[i] },
      }),
    ),
  );
}

/**
 * Moves an article within a tag's playlist.
 *
 * `afterId` is the article it should follow; null means the top. Only the
 * moved row is written — that is the point of fractional positions.
 */
export async function moveArticleInTag(
  userId: string,
  tagId: string,
  articleId: string,
  afterId: string | null,
): Promise<void> {
  const rows = await prisma.articleTag.findMany({
    where: { tagId, article: { userId } },
    orderBy: { position: "asc" },
    select: { articleId: true, position: true },
  });

  const others = rows.filter((r) => r.articleId !== articleId);
  let position: number;

  if (afterId === null) {
    position = positionForTop(others.map((r) => r.position));
  } else {
    const at = others.findIndex((r) => r.articleId === afterId);
    if (at === -1) return; // Anchor is not in this tag — nothing sensible to do.
    position = positionBetween(others[at].position, others[at + 1]?.position);
  }

  await prisma.articleTag.update({
    where: { articleId_tagId: { articleId, tagId } },
    data: { position },
  });

  const updated = others.map((r) => r.position).concat(position);
  if (needsRebalance(updated)) await rebalance(tagId);
}
