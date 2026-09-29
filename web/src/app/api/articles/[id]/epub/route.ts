import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { buildEpub } from "@/lib/epub";
import { loadExportArticle } from "@/lib/export-article";
import { articleFilename } from "@/lib/markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** One article as an EPUB download, for reading on an e-reader. */
export async function GET(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const article = await loadExportArticle(id, user.userId);
  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const epub = await buildEpub(article);

  return new Response(new Uint8Array(epub), {
    headers: {
      "content-type": "application/epub+zip",
      "content-disposition": `attachment; filename="${articleFilename(article, "epub")}"`,
      "content-length": String(epub.length),
      "cache-control": "no-store",
    },
  });
}
