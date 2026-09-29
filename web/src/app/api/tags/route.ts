import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { addArticlesToTag, ensureTags, listTags } from "@/lib/tags";
import type { TagListResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tags = await listTags(user.userId);
  const body: TagListResponse = { tags };
  return NextResponse.json(body);
}

/**
 * Put articles in a collection, by name.
 *
 * Deliberately one endpoint for "an existing one" and "a new one": tags are
 * resolved by name case-insensitively everywhere else in the app, so the
 * caller does not have to know which case it is — which is exactly what the
 * "add to collection" picker needs, since it offers a list and a text field
 * side by side.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name, articleIds } = (body ?? {}) as {
    name?: unknown;
    articleIds?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "A collection needs a name" }, { status: 422 });
  }
  if (
    articleIds !== undefined &&
    (!Array.isArray(articleIds) || articleIds.some((id) => typeof id !== "string"))
  ) {
    return NextResponse.json(
      { error: "Invalid articleIds: expected an array of ids" },
      { status: 422 },
    );
  }

  const [tag] = await ensureTags(user.userId, [{ name, kind: "CUSTOM" }]);
  if (!tag) {
    return NextResponse.json({ error: "A collection needs a name" }, { status: 422 });
  }

  const { added } = await addArticlesToTag(
    user.userId,
    tag.id,
    (articleIds as string[] | undefined) ?? [],
  );

  const tags = await listTags(user.userId);
  const created = tags.find((row) => row.id === tag.id) ?? null;
  return NextResponse.json({ tag: created, added }, { status: 201 });
}
