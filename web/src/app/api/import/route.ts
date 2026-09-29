import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { ArchiveTooLargeError } from "@/lib/archive";
import { Importer } from "@/lib/backup";
import {
  importArchive,
  parseImportOptions,
  type ImportOptions,
} from "@/lib/backup-archive";
import { startJob } from "@/lib/jobs";
import {
  assertSupportedMeta,
  parseLine,
  splitLines,
  TransferError,
} from "@/lib/transfer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Decompression limits.
 *
 * A few kilobytes of gzip can expand to gigabytes, so a stream bounded only by
 * the client's upload size is a denial of service waiting to happen. A real
 * backup of ~12k articles is a few hundred megabytes uncompressed and
 * compresses around 6x, so these are generous for a genuine file and nowhere
 * near a bomb.
 */
const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1GB
const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024; // 256MB
/** Ratio at which a file stops looking like text and starts looking like a bomb. */
const MAX_RATIO = 200;
/** Enough for any single article; a longer line is malformed or hostile. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;

class TooLargeError extends Error {}

/** Gzip's magic bytes, so a plain .ndjson works as well as a .ndjson.gz. */
function looksGzipped(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * Tar's `ustar` marker sits at offset 257 of the first header block.
 *
 * Both accepted formats are gzipped, so the container tells us nothing — the
 * decompressed head has to be inspected to know whether this is an archive of
 * files or a single NDJSON stream.
 */
function looksTar(head: Buffer): boolean {
  return (
    head.length >= 262 && head.subarray(257, 262).toString("latin1") === "ustar"
  );
}

/** Buffers the first bytes of a stream, returning them plus an intact stream. */
async function peek(
  stream: Readable,
  bytes: number,
): Promise<{ head: Buffer; rest: Readable }> {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let size = 0;
  while (size < bytes) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = next.value as Buffer;
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const head = Buffer.concat(chunks);
  const rest = Readable.from(
    (async function* () {
      if (head.byteLength > 0) yield head;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    })(),
  );
  return { head, rest };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Starts the follow-up work the options ask for.
 *
 * Only the content job — the free one — starts on its own. Classification and
 * summaries are offered in the UI with their counts, and summarising behind a
 * cost confirmation: spending money should be a deliberate click, not a side
 * effect of uploading a file.
 */
async function startFollowUp(
  userId: string,
  options: ImportOptions,
): Promise<string | null> {
  try {
    const job = await startJob(userId, "FETCH_CONTENT", {
      force: options.content === "refresh",
    });
    return job.id;
  } catch {
    // A job was already running. Not worth failing the import over.
    return null;
  }
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);
  if (!req.body) return jsonError("Expected a request body", 400);

  const params = new URL(req.url).searchParams;
  const options = parseImportOptions({
    tags: params.get("tags"),
    content: params.get("content"),
    summary: params.get("summary"),
  });

  const reader = req.body.getReader();
  const first = await reader.read();
  if (first.done || !first.value?.length) {
    return jsonError("The file is empty", 400);
  }

  let compressedBytes = 0;
  let uploadTooLarge = false;
  const source = Readable.from(
    (async function* () {
      compressedBytes += first.value.byteLength;
      yield first.value;
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        if (!next.value) continue;
        compressedBytes += next.value.byteLength;
        if (compressedBytes > MAX_COMPRESSED_BYTES) {
          // Stop feeding rather than throwing: an error raised inside the
          // generator tears the gunzip transform down mid-flight and surfaces
          // as an unrelated-looking TypeError.
          uploadTooLarge = true;
          await reader.cancel().catch(() => {});
          return;
        }
        yield next.value;
      }
    })(),
  );

  const decompressed = looksGzipped(first.value)
    ? source.pipe(createGunzip())
    : source;

  try {
    // One tar header block is enough to tell the two formats apart.
    const { head, rest } = await peek(decompressed, 512);
    if (uploadTooLarge) {
      return jsonError("upload is larger than this import supports", 413);
    }

    const summary = looksTar(head)
      ? await importArchive(rest, user.userId, options)
      : await importNdjson(rest, user.userId, compressedBytes);

    const jobId = await startFollowUp(user.userId, options);
    return NextResponse.json({ ...summary, options, jobId });
  } catch (err) {
    if (err instanceof TooLargeError || err instanceof ArchiveTooLargeError) {
      return jsonError(err.message, 413);
    }
    if (err instanceof TransferError) return jsonError(err.message, 422);
    if (
      err instanceof Error &&
      /incorrect header check|unexpected end|invalid tar|unexpected file/i.test(
        err.message,
      )
    ) {
      return jsonError("The file is corrupt or not a supported archive", 422);
    }
    console.error("Import failed:", err);
    return jsonError("Import failed", 500);
  }
}

/** The single-stream NDJSON path: still the exact-fidelity restore format. */
async function importNdjson(
  stream: Readable,
  userId: string,
  compressedBytes: number,
) {
  const importer = new Importer(userId);
  await importer.load();

  const decoder = new TextDecoder();
  let decompressedBytes = 0;
  let buffer = "";
  let sawMeta = false;
  let lineNumber = 0;

  const handle = async (line: string) => {
    lineNumber += 1;
    let record;
    try {
      record = parseLine(line);
    } catch (err) {
      // One unreadable line costs one record, not the whole restore.
      importer.note(
        `line ${lineNumber}: ${err instanceof Error ? err.message : "unreadable"}`,
      );
      return;
    }
    if (!record) return;
    if (!sawMeta) {
      assertSupportedMeta(record);
      sawMeta = true;
      return;
    }
    await importer.add(record);
  };

  for await (const chunk of stream) {
    decompressedBytes += (chunk as Buffer).byteLength;
    if (decompressedBytes > MAX_DECOMPRESSED_BYTES) {
      throw new TooLargeError("the file expands to more than this import allows");
    }
    if (
      decompressedBytes > 64 * 1024 * 1024 &&
      decompressedBytes / Math.max(compressedBytes, 1) > MAX_RATIO
    ) {
      throw new TooLargeError("the file expands far more than a backup should");
    }

    buffer += decoder.decode(chunk as Buffer, { stream: true });
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      throw new TooLargeError("a single record is larger than this import allows");
    }
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) await handle(line);
  }

  const tail = buffer.trim();
  if (tail) await handle(tail);

  if (!sawMeta) {
    throw new TransferError(
      "This does not look like a Stash backup: no meta record found",
    );
  }
  return importer.finish();
}
