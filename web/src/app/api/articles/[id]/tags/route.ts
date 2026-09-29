import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { attachTags, detachTag, ensureTags, tagsForArticles } from "@/lib/tags";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Confirms the article belongs to the caller before any tag write. */
async function ownedArticle(articleId: string, userId: string) {
  return prisma.article.findFirst({
    where: { id: articleId, userId },
    select: { id: true },
  });
}

export async function GET(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  if (!(await ownedArticle(id, user.userId))) {
    return jsonError("Not found", 404);
  }

  const byArticle = await tagsForArticles([id]);
  return NextResponse.json({ tags: byArticle.get(id) ?? [] });
}

/** Attach a tag by name, creating it if the user doesn't have it yet. */
export async function POST(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  if (!(await ownedArticle(id, user.userId))) {
    return jsonError("Not found", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const name =
    typeof body === "object" && body !== null
      ? (body as { name?: unknown }).name
      : undefined;
  if (typeof name !== "string" || !name.trim()) {
    return jsonError("Invalid name: expected a non-empty string", 422);
  }

  const [tag] = await ensureTags(user.userId, [
    { name: name.trim(), kind: "CUSTOM" },
  ]);
  if (!tag) return jsonError("Could not create the tag", 500);

  await attachTags(id, [tag.id], "MANUAL");

  const byArticle = await tagsForArticles([id]);
  return NextResponse.json({ tags: byArticle.get(id) ?? [] }, { status: 201 });
}

/** Detach a tag. The tag itself survives — it may be on other articles. */
export async function DELETE(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  if (!(await ownedArticle(id, user.userId))) {
    return jsonError("Not found", 404);
  }

  const tagId = new URL(req.url).searchParams.get("tagId");
  if (!tagId) return jsonError("Missing tagId", 400);

  // Scope the tag to the caller so an id from another account is a no-op.
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, userId: user.userId },
    select: { id: true },
  });
  if (!tag) return jsonError("Not found", 404);

  await detachTag(id, tag.id);
  const byArticle = await tagsForArticles([id]);
  return NextResponse.json({ tags: byArticle.get(id) ?? [] });
}
