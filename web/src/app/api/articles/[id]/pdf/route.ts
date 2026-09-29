import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { loadExportArticle } from "@/lib/export-article";
import { articleFilename } from "@/lib/markdown";
import { buildPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** One article as a PDF download, laid out by `lib/pdf.ts`. */
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

  const pdf = await buildPdf(article);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${articleFilename(article, "pdf")}"`,
      "content-length": String(pdf.length),
      "cache-control": "no-store",
    },
  });
}
