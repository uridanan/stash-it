import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { extract, pack, type Pack } from "tar-stream";

/**
 * tar.gz reading and writing.
 *
 * Tar rather than zip because tar streams sequentially in both directions: a
 * restore can process entries as they arrive instead of buffering the whole
 * upload, since zip keeps its index at the end of the file and needs random
 * access to read anything.
 *
 * Callers must write the manifest entries before `articles/`, so an importer
 * knows the shape of the archive before the bodies show up.
 */

export const MANIFEST_ENTRY = "stash.json";
export const LINKS_ENTRY = "links.ndjson";
export const ARTICLES_DIR = "articles/";
export const INDEX_ENTRY = "index.md";

export interface ArchiveEntry {
  name: string;
  body: string;
}

/**
 * Streams entries out as a gzipped tar.
 *
 * Takes a generator so the caller can pull articles from the database in
 * batches; nothing accumulates in memory beyond the entry being written.
 */
export function packArchive(
  entries: AsyncIterable<ArchiveEntry>,
  onError?: (err: unknown) => void,
): Readable {
  const tar: Pack = pack();
  const gzip = createGzip();
  tar.pipe(gzip);

  void (async () => {
    try {
      for await (const entry of entries) {
        const body = Buffer.from(entry.body, "utf8");
        await new Promise<void>((resolve, reject) => {
          tar.entry({ name: entry.name, size: body.byteLength }, body, (err) =>
            err ? reject(err) : resolve(),
          );
        });
      }
      tar.finalize();
    } catch (err) {
      onError?.(err);
      tar.destroy(err instanceof Error ? err : new Error("archive failed"));
      gzip.destroy(err instanceof Error ? err : new Error("archive failed"));
    }
  })();

  return gzip;
}

export interface ReadEntry {
  name: string;
  text(): Promise<string>;
}

/**
 * Reads a **plain tar** stream, yielding one entry at a time.
 *
 * Decompression is the caller's job on purpose: the import route has to gunzip
 * first anyway, to inspect the decompressed head and tell a tar archive from a
 * single NDJSON stream. Gunzipping again in here would hand zlib data that is
 * no longer gzip and fail with "incorrect header check".
 *
 * Each entry must be consumed (or skipped) before the next arrives, which is
 * what keeps memory flat — the caller decides whether to read a body or drop
 * it on the floor.
 */
export async function* unpackArchive(
  source: Readable,
  limits: { maxEntryBytes: number; maxTotalBytes: number },
): AsyncGenerator<ReadEntry> {
  const tar = extract();
  source.pipe(tar);

  let total = 0;

  for await (const entry of tar) {
    const header = entry.header;
    const size = header.size ?? 0;

    total += size;
    if (size > limits.maxEntryBytes || total > limits.maxTotalBytes) {
      entry.resume();
      tar.destroy();
      throw new ArchiveTooLargeError(
        "the archive is larger than this import allows",
      );
    }

    // Directories and anything that is not a plain file carry no body.
    if (header.type !== "file") {
      entry.resume();
      continue;
    }

    let consumed = false;
    yield {
      name: normalizeEntryName(header.name),
      async text() {
        consumed = true;
        const chunks: Buffer[] = [];
        for await (const chunk of entry) chunks.push(chunk as Buffer);
        return Buffer.concat(chunks).toString("utf8");
      },
    };
    // The consumer skipped this one; drain it so the stream can advance.
    if (!consumed) entry.resume();
  }
}

export class ArchiveTooLargeError extends Error {}

/**
 * Strips path traversal and leading slashes from a tar entry name.
 *
 * Entry names come from the uploaded file, so they are untrusted: a crafted
 * archive can name an entry `../../etc/passwd`. Nothing here writes to disk
 * today, but the names are used to route entries and must not be trusted to
 * be well-formed.
 */
export function normalizeEntryName(name: string): string {
  return name
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .join("/");
}

/** True when an entry is an article body in the expected place. */
export function isArticleEntry(name: string): boolean {
  return name.startsWith(ARTICLES_DIR) && name.length > ARTICLES_DIR.length;
}
