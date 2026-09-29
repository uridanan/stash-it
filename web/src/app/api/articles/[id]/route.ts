import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import {
  deleteArticle,
  getArticle,
  parseArticleState,
  toArticleDTO,
  updateArticle,
  type UpdateArticleInput,
} from "@/lib/articles";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  const article = await getArticle(id, user.userId);
  if (!article) return jsonError("Article not found", 404);
  return NextResponse.json({ article: toArticleDTO(article) });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonError("Invalid JSON body", 400);
  }

  const { state, starred } = body as { state?: unknown; starred?: unknown };
  const input: UpdateArticleInput = {};

  if (state !== undefined) {
    const parsed = parseArticleState(state);
    if (!parsed) {
      return jsonError("Invalid state: expected 'unread' or 'archived'", 422);
    }
    input.state = parsed;
  }
  if (starred !== undefined) {
    if (typeof starred !== "boolean") {
      return jsonError("Invalid starred: expected a boolean", 422);
    }
    input.starred = starred;
  }
  if (input.state === undefined && input.starred === undefined) {
    return jsonError("Nothing to update: provide state and/or starred", 400);
  }

  const { id } = await ctx.params;
  const article = await updateArticle(id, user.userId, input);
  if (!article) return jsonError("Article not found", 404);
  return NextResponse.json({ article: toArticleDTO(article) });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  const deleted = await deleteArticle(id, user.userId);
  if (!deleted) return jsonError("Article not found", 404);
  return new Response(null, { status: 204 });
}
