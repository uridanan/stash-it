import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateToken, requireUser, sha256 } from "@/lib/api-auth";
import type { TokenCreateResponse, TokenListResponse } from "@/types";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const tokens = await prisma.apiToken.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });

  const payload: TokenListResponse = {
    tokens: tokens.map((t: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    })),
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

  const name = (body as { name?: unknown }).name;
  if (typeof name !== "string" || !name.trim()) {
    return jsonError("Missing required field: name", 400);
  }
  if (name.trim().length > 100) {
    return jsonError("name must be 100 characters or fewer", 422);
  }

  // Plaintext token is returned exactly once; only its hash is stored.
  const token = generateToken();
  const created = await prisma.apiToken.create({
    data: {
      userId: user.userId,
      name: name.trim(),
      tokenHash: sha256(token),
    },
    select: { id: true, name: true, createdAt: true },
  });

  const payload: TokenCreateResponse = {
    id: created.id,
    name: created.name,
    token,
    createdAt: created.createdAt.toISOString(),
  };
  return NextResponse.json(payload, { status: 201 });
}
