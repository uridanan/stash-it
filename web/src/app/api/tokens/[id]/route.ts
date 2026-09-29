import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { count } = await prisma.apiToken.deleteMany({
    where: { id, userId: user.userId },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
