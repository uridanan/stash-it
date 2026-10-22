import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { classifyArticle } from "@/lib/ai-tasks";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Assign topic tags for one article, on demand. */
export async function POST(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  const result = await classifyArticle(id, user.userId);
  if (result.ok) return NextResponse.json({ ok: true });

  const reason = result.reason ?? "Could not tag this article";
  const status =
    reason === "AI is not configured" || reason.startsWith("no article")
      ? 400
      : 502;
  return jsonError(reason, status);
}
