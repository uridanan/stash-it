import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { saveArticleFromText, toArticleDTO } from "@/lib/articles";
import { parseCollections } from "@/lib/collection-names";
import { TextArticleError } from "@/lib/text-article";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Save an article from its text.
 *
 * For a piece that has no page — an email, a note, something an agent already
 * extracted. Nothing is fetched, and the article has no source link. Length
 * and language collections are assigned as they are for a URL, and summary
 * plus topic classification run afterwards. Names in `collections` are added
 * as well; they do not replace those.
 *
 * Sending the same text again returns the existing article and adds any new
 * collection names.
 */
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

  const record = body as {
    text?: unknown;
    title?: unknown;
    author?: unknown;
    collections?: unknown;
  };
  if (typeof record.text !== "string") {
    return jsonError("Missing required field: text", 400);
  }
  const collections = parseCollections(record.collections);
  if ("error" in collections) return jsonError(collections.error, 422);

  try {
    const saved = await saveArticleFromText(
      user.userId,
      { text: record.text, title: record.title, author: record.author },
      collections.names,
    );
    return NextResponse.json(
      { article: toArticleDTO(saved) },
      { status: saved.created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof TextArticleError) return jsonError(err.message, 422);
    throw err;
  }
}
