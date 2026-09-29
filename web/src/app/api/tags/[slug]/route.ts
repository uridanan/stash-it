import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import {
  TagNameError,
  addArticlesToTag,
  getTagBySlug,
  mergeTags,
  moveArticleInTag,
  renameTag,
  tagArticleIds,
} from "@/lib/tags";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The tag's articles in playlist order — what seeds the listen queue. */
export async function GET(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const tag = await getTagBySlug(user.userId, slug);
  if (!tag) return jsonError("Not found", 404);

  return NextResponse.json({
    tag,
    articleIds: await tagArticleIds(user.userId, tag.id),
  });
}

/**
 * The three ways a collection changes, told apart by which key the body has:
 *
 * - `name`      — rename it (the slug follows, so the response carries it)
 * - `mergeInto` — pour it into another collection and delete this one
 * - `articleId` — move one article within the playlist
 *
 * One route because they are all "change this collection", and a body can only
 * mean one of them.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const tag = await getTagBySlug(user.userId, slug);
  if (!tag) return jsonError("Not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonError("Invalid JSON body", 400);
  }
  const { articleId, afterId, name, mergeInto } = body as {
    articleId?: unknown;
    afterId?: unknown;
    name?: unknown;
    mergeInto?: unknown;
  };

  if (typeof name === "string") {
    try {
      return NextResponse.json({ tag: await renameTag(user.userId, tag.id, name) });
    } catch (err) {
      if (err instanceof TagNameError) return jsonError(err.message, 422);
      throw err;
    }
  }

  if (typeof mergeInto === "string") {
    const target = await getTagBySlug(user.userId, mergeInto);
    if (!target) return jsonError("No such collection to merge into", 422);
    if (target.id === tag.id) {
      return jsonError("A collection cannot be merged into itself", 422);
    }
    const { moved } = await mergeTags(user.userId, tag.id, target.id);
    return NextResponse.json({ moved, tag: target });
  }

  if (typeof articleId !== "string" || !articleId) {
    return jsonError("Invalid articleId", 422);
  }
  if (afterId !== null && typeof afterId !== "string") {
    return jsonError("Invalid afterId: expected a string or null", 422);
  }

  await moveArticleInTag(user.userId, tag.id, articleId, afterId ?? null);
  return NextResponse.json({
    articleIds: await tagArticleIds(user.userId, tag.id),
  });
}

/** Add articles to this collection, appended in the order they are given. */
export async function POST(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const tag = await getTagBySlug(user.userId, slug);
  if (!tag) return jsonError("Not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { articleIds } = (body ?? {}) as { articleIds?: unknown };
  if (!Array.isArray(articleIds) || articleIds.some((id) => typeof id !== "string")) {
    return jsonError("Invalid articleIds: expected an array of ids", 422);
  }

  const { added } = await addArticlesToTag(
    user.userId,
    tag.id,
    articleIds as string[],
  );
  return NextResponse.json({ added, tag });
}

/** Delete a whole collection. The articles themselves are untouched. */
export async function DELETE(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const tag = await getTagBySlug(user.userId, slug);
  if (!tag) return jsonError("Not found", 404);

  await prisma.tag.delete({ where: { id: tag.id } });
  return NextResponse.json({ ok: true });
}
