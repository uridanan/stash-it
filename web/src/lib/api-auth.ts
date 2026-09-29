import crypto from "crypto";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

const TOKEN_PREFIX = "stash_";

/** Hex-encoded SHA-256 of the input. Used to store/lookup API tokens. */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Generate a new API token: "stash_" + 32 hex chars. Shown to the user once. */
export function generateToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(16).toString("hex");
}

export interface AuthedUser {
  userId: string;
}

/**
 * Resolve the authenticated user for an API request.
 *
 * 1. `Authorization: Bearer stash_...` — look up the ApiToken by sha256 hash.
 *    An invalid/unknown token fails the request (no session fallback).
 * 2. Otherwise fall back to the Auth.js session cookie.
 *
 * Returns null when unauthenticated; callers respond 401.
 */
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.get("authorization");
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    const raw = match?.[1]?.trim();
    if (raw && raw.startsWith(TOKEN_PREFIX)) {
      const token = await prisma.apiToken.findUnique({
        where: { tokenHash: sha256(raw) },
        select: { id: true, userId: true },
      });
      if (!token) return null;
      // Fire-and-forget usage timestamp; never block or fail the request on it.
      void prisma.apiToken
        .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
      return { userId: token.userId };
    }
    // A malformed/foreign Authorization header falls through to the session.
  }

  const session = await auth();
  const userId = session?.user?.id;
  return userId ? { userId } : null;
}
