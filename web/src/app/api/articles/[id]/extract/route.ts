import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { fillStub } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fetches the article text.
 *
 * Without `force` this only fills a stub — a row imported from a URL-only
 * source, which has metadata but no content. With it, the article is fetched
 * again even if it already has text, and the existing copy survives a failure.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // ?force=1 refetches an article that already has text, for the reader's
  // Refetch action. A failed forced fetch keeps the existing copy.
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await fillStub(id, user.userId, { force });
  if (!result.ok) {
    const status = result.reason === "not found" ? 404 : 502;
    return NextResponse.json(
      { error: result.reason ?? "Could not fetch that page" },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
