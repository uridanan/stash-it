import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { loadExportArticle } from "@/lib/export-article";
import { articleFilename, articleToMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** One article as a Markdown download, for reading or filing elsewhere. */
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

  const markdown = articleToMarkdown(article);

  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${articleFilename(article, "md")}"`,
      "cache-control": "no-store",
    },
  });
}
