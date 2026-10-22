import type { SystemSettings } from "@prisma/client";

import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import type { ImportOptions } from "@/lib/backup-archive";
import { prisma } from "@/lib/db";
import { BUILT_IN_TOPICS } from "@/lib/taxonomy";

const SYSTEM_ID = "system";

/**
 * The installation's settings. Created on first read if the migration's seed
 * row is missing, so a fresh database still has a default tag list.
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const existing = await prisma.systemSettings.findUnique({
    where: { id: SYSTEM_ID },
  });
  if (existing) return existing;

  try {
    return await prisma.systemSettings.create({
      data: { id: SYSTEM_ID, defaultTopics: [...BUILT_IN_TOPICS] },
    });
  } catch {
    return prisma.systemSettings.findUniqueOrThrow({ where: { id: SYSTEM_ID } });
  }
}

/** The signed-in account, when it is the admin. Checked against the database. */
export async function requireAdmin(): Promise<{ userId: string } | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!isAdminEmail(user?.email)) return null;
  return { userId };
}

export type TagsChoice = ImportOptions["tags"];
export type ContentChoice = ImportOptions["content"];
export type SummaryChoice = ImportOptions["summary"];

export function asTagsChoice(value: unknown): TagsChoice | null {
  return value === "assign" || value === "import" ? value : null;
}

export function asContentChoice(value: unknown): ContentChoice {
  return value === "refresh" ? "refresh" : "missing";
}

export function asSummaryChoice(value: unknown): SummaryChoice {
  return value === "missing" || value === "always" ? value : "ondemand";
}

/**
 * Import behavior for one account.
 *
 * Article text and summaries follow the system. Collections follow it too,
 * unless this request or this account says otherwise — the request wins, so
 * the choice on the import form is what that import does.
 */
export async function resolveImportOptions(
  userId: string,
  raw: { tags?: unknown },
): Promise<ImportOptions> {
  const [system, user] = await Promise.all([
    getSystemSettings(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { importTagsOverride: true },
    }),
  ]);
  const requested = asTagsChoice(raw.tags);
  const override = asTagsChoice(user?.importTagsOverride);
  return {
    tags: requested ?? override ?? asTagsChoice(system.importTags) ?? "assign",
    content: asContentChoice(system.importContent),
    summary: asSummaryChoice(system.importSummary),
  };
}
