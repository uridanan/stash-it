import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getArticle } from "@/lib/articles";
import { generateSummary, SummaryError } from "@/lib/summarize";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Generate (or regenerate) the AI summary for an article. */
export async function POST(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  const article = await getArticle(id, user.userId);
  if (!article) return jsonError("Article not found", 404);

  const settings = await prisma.user.findUniqueOrThrow({
    where: { id: user.userId },
    select: { aiSummariesEnabled: true, aiModel: true, aiApiKey: true, aiPrompt: true },
  });
  if (!settings.aiSummariesEnabled) {
    return jsonError("AI summaries are disabled — enable them in Settings", 400);
  }
  if (!settings.aiApiKey) {
    return jsonError("No API key configured — add one in Settings", 400);
  }

  try {
    const summary = await generateSummary(
      {
        title: article.title,
        url: article.url,
        siteName: article.siteName,
        content: article.content,
      },
      {
        model: settings.aiModel,
        apiKey: settings.aiApiKey,
        prompt: settings.aiPrompt,
      },
    );
    await prisma.article.update({ where: { id: article.id }, data: { summary } });
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof SummaryError) return jsonError(err.message, 502);
    throw err;
  }
}
