import type { ArticleState, TagKind, TagSource } from "@prisma/client";

/**
 * Backup format: gzipped NDJSON — one JSON record per line.
 *
 * Chosen over a single JSON document because both ends stream. An export of
 * 11k articles carries tens of megabytes of article HTML; as one array it has
 * to be held in memory whole at both ends, whereas line-at-a-time needs only
 * the current record. Gzip does the heavy lifting on size (article markup
 * compresses roughly 6x), and a truncated or corrupt line costs one article
 * rather than the whole file.
 *
 * It stays legible too: `zcat backup.ndjson.gz | head` shows real records, and
 * `grep` finds an article by URL without any tooling.
 *
 * The first line is always a `meta` record, so an import can check the version
 * and report what it is about to do before writing anything.
 */

export const TRANSFER_VERSION = 1;
export const TRANSFER_FILE_SUFFIX = ".ndjson.gz";

export interface MetaRecord {
  type: "meta";
  version: number;
  exportedAt: string;
  app: "stash";
  counts: { articles: number; tags: number };
}

/** User preferences. The AI API key is deliberately never exported. */
export interface SettingsRecord {
  type: "settings";
  aiSummariesEnabled: boolean;
  aiModel: string;
  aiPrompt: string | null;
  summaryView: string;
  customTopics: string[];
  markReadOnListen: boolean;
}

export interface TagRecord {
  type: "tag";
  name: string;
  slug: string;
  kind: TagKind;
}

export interface ArticleTagRef {
  name: string;
  position: number;
  source: TagSource;
}

export interface ArticleRecord {
  type: "article";
  url: string;
  title: string;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  content: string;
  wordCount: number;
  readingMinutes: number;
  leadImageUrl: string | null;
  state: ArticleState;
  starred: boolean;
  extractionFailed: boolean;
  summary: string | null;
  savedAt: string;
  readAt: string | null;
  publishedAt: string | null;
  lang: string | null;
  classifiedAt: string | null;
  /**
   * Extraction signals behind the Shopping and Visual content tags. Optional
   * so a backup written before they were stored still reads.
   */
  isProduct?: boolean;
  hasEmbeddedMedia?: boolean;
  /** Collection memberships, carrying playlist order so it survives a restore. */
  tags: ArticleTagRef[];
}

export type TransferRecord =
  | MetaRecord
  | SettingsRecord
  | TagRecord
  | ArticleRecord;

/** One NDJSON line, newline included. */
export function encodeLine(record: TransferRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export class TransferError extends Error {}

/**
 * Parses one line into a record, or returns null for a blank line.
 *
 * Throws only on a line that is unusable *and* not skippable — an unknown
 * `type` is ignored on purpose, so a backup written by a newer version can
 * still be read for the parts this version understands.
 */
export function parseLine(line: string): TransferRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new TransferError("Line is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TransferError("Line is not a JSON object");
  }

  const record = parsed as { type?: unknown };
  if (typeof record.type !== "string") {
    throw new TransferError("Record has no type");
  }
  switch (record.type) {
    case "meta":
    case "settings":
    case "tag":
    case "article":
      return parsed as TransferRecord;
    default:
      return null; // forward compatibility: skip records we do not know
  }
}

export function isMeta(record: TransferRecord): record is MetaRecord {
  return record.type === "meta";
}

/** Validates the header, so a wrong file is rejected before anything is written. */
export function assertSupportedMeta(record: TransferRecord): MetaRecord {
  if (!isMeta(record)) {
    throw new TransferError(
      "This does not look like a Stash backup: the first line is not a meta record",
    );
  }
  if (record.app !== "stash") {
    throw new TransferError(`Unrecognized backup source: ${String(record.app)}`);
  }
  if (typeof record.version !== "number" || record.version > TRANSFER_VERSION) {
    throw new TransferError(
      `Backup version ${String(record.version)} is newer than this app understands (${TRANSFER_VERSION})`,
    );
  }
  return record;
}

/** Splits a growing buffer into whole lines, returning the unterminated tail. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

export function exportFilename(now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return `stash-export-${stamp}${TRANSFER_FILE_SUFFIX}`;
}

/* ------------------------------------------------------------------ */
/* Archive format (tar.gz): stash.json + links.ndjson + articles/*.html */
/* ------------------------------------------------------------------ */

/**
 * One line of `links.ndjson`.
 *
 * Carries the original `id` so an article body can be matched back to its row:
 * filenames are `<id>-<slug>.html`, and on restore the row gets a brand new id,
 * so the archive's own id is the only link between the two. This is also why
 * the index is written before `articles/` — the mapping has to exist before the
 * bodies arrive.
 */
export interface LinkRecord {
  type: "link";
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  wordCount: number;
  readingMinutes: number;
  leadImageUrl: string | null;
  state: ArticleState;
  starred: boolean;
  extractionFailed: boolean;
  /**
   * The AI summary.
   *
   * It lives on the link record, not only inside the body file, because a
   * summary is not part of the body: a light archive has no `articles/`
   * entries at all, and even a full one skips the file for an article whose
   * text was never fetched. Optional so an archive written before this still
   * reads — those carry the summary in the body file instead.
   */
  summary?: string | null;
  savedAt: string;
  readAt: string | null;
  publishedAt: string | null;
  lang: string | null;
  classifiedAt: string | null;
  isProduct?: boolean;
  hasEmbeddedMedia?: boolean;
  tags: ArticleTagRef[];
}

export interface ArchiveManifest {
  version: number;
  app: "stash";
  exportedAt: string;
  /** False for a structure-only export, which has no `articles/` entries. */
  includesContent: boolean;
  counts: { articles: number; tags: number };
  settings: Omit<SettingsRecord, "type"> | null;
  tags: Omit<TagRecord, "type">[];
}

export function parseLinkLine(line: string): LinkRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new TransferError("Link line is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TransferError("Link line is not a JSON object");
  }
  const record = parsed as LinkRecord;
  if (typeof record.url !== "string" || !record.url) {
    throw new TransferError("Link record has no url");
  }
  return record;
}

export function assertSupportedManifest(raw: string): ArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TransferError("stash.json is not valid JSON");
  }
  const manifest = parsed as ArchiveManifest;
  if (!manifest || manifest.app !== "stash") {
    throw new TransferError(
      "This does not look like a Stash archive: stash.json is missing or foreign",
    );
  }
  if (typeof manifest.version !== "number" || manifest.version > TRANSFER_VERSION) {
    throw new TransferError(
      `Archive version ${String(manifest.version)} is newer than this app understands (${TRANSFER_VERSION})`,
    );
  }
  return manifest;
}

/**
 * Names the archive after what is in it.
 *
 * The two backups restore the same library but are wildly different sizes, and
 * once a few are sitting in a downloads folder the date alone does not say
 * which one has the article text in it.
 */
export function archiveFilename(
  now: Date,
  includesContent: boolean,
  scope?: string | null,
): string {
  const kind = includesContent ? "full" : "light";
  const where = scope ? `-${scope}` : "";
  return `stash-backup-${kind}${where}-${now.toISOString().slice(0, 10)}.tar.gz`;
}

export function markdownFilename(now: Date, scope?: string | null): string {
  const where = scope ? `-${scope}` : "";
  return `stash-markdown${where}-${now.toISOString().slice(0, 10)}.tar.gz`;
}
