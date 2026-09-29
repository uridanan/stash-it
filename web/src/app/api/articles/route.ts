import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import {
  DEFAULT_LIST_LIMIT,
  listArticles,
  parseArticleState,
  parseOrder,
  parseSort,
  saveArticleFromUrl,
  toArticleDTO,
  toArticleListItemDTO,
} from "@/lib/articles";
import { ExtractionError } from "@/lib/extract";
import type { ArticleListResponse, ArticleState } from "@/types";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const params = new URL(req.url).searchParams;

  let state: ArticleState | undefined;
  const stateParam = params.get("state");
  if (stateParam !== null) {
    const parsed = parseArticleState(stateParam);
    if (!parsed) {
      return jsonError("Invalid state: expected 'unread' or 'archived'", 400);
    }
    state = parsed;
  }

  let starred: boolean | undefined;
  const starredParam = params.get("starred");
  if (starredParam !== null) {
    if (starredParam === "1" || starredParam === "true") starred = true;
    else if (starredParam === "0" || starredParam === "false") starred = false;
    else return jsonError("Invalid starred: expected 1 or 0", 400);
  }

  let limit = DEFAULT_LIST_LIMIT;
  const limitParam = params.get("limit");
  if (limitParam !== null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1) {
      return jsonError("Invalid limit: expected a positive integer", 400);
    }
  }

  const sortParam = params.get("sort");
  const sort = sortParam === null ? undefined : parseSort(sortParam);
  if (sort === null) {
    return jsonError("Invalid sort: expected 'added' or 'published'", 400);
  }

  const orderParam = params.get("order");
  const order = orderParam === null ? undefined : parseOrder(orderParam);
  if (order === null) {
    return jsonError("Invalid order: expected 'asc' or 'desc'", 400);
  }

  const { articles, nextCursor } = await listArticles({
    userId: user.userId,
    state,
    starred,
    q: params.get("q") ?? undefined,
    sort,
    order,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });

  const payload: ArticleListResponse = {
    articles: articles.map(toArticleListItemDTO),
    nextCursor,
  };
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
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

  const url = (body as { url?: unknown }).url;
  if (typeof url !== "string" || !url.trim()) {
    return jsonError("Missing required field: url", 400);
  }

  try {
    const saved = await saveArticleFromUrl(user.userId, url);
    return NextResponse.json(
      { article: toArticleDTO(saved) },
      { status: saved.created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof ExtractionError && err.code === "invalid-url") {
      return jsonError("url must be a valid http(s) URL", 422);
    }
    throw err;
  }
}
