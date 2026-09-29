import { describe, expect, it } from "vitest";

import {
  assertSupportedMeta,
  encodeLine,
  archiveFilename,
  exportFilename,
  parseLine,
  splitLines,
  TRANSFER_VERSION,
  TransferError,
  type MetaRecord,
} from "@/lib/transfer";

const meta: MetaRecord = {
  type: "meta",
  version: TRANSFER_VERSION,
  exportedAt: "2026-08-22T00:00:00.000Z",
  app: "stash",
  counts: { articles: 2, tags: 1 },
};

describe("encodeLine / parseLine", () => {
  it("round-trips a record", () => {
    const line = encodeLine(meta);
    expect(line.endsWith("\n")).toBe(true);
    expect(parseLine(line)).toEqual(meta);
  });

  it("ignores blank lines", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   \n")).toBeNull();
  });

  it("skips record types it does not know, for forward compatibility", () => {
    expect(parseLine('{"type":"somethingNew","x":1}')).toBeNull();
  });

  it("throws on a line that is not JSON", () => {
    expect(() => parseLine("{ oops")).toThrow(TransferError);
  });

  it("throws on a record with no type", () => {
    expect(() => parseLine('{"url":"x"}')).toThrow(TransferError);
  });

  it("survives content containing newlines and quotes", () => {
    const article = {
      type: "article" as const,
      url: "https://example.com/a",
      title: 'A "quoted" title',
      siteName: null,
      author: null,
      excerpt: null,
      content: "<p>line one</p>\n<p>line two</p>",
      wordCount: 4,
      readingMinutes: 1,
      leadImageUrl: null,
      state: "UNREAD" as const,
      starred: false,
      extractionFailed: false,
      summary: null,
      savedAt: "2026-01-01T00:00:00.000Z",
      readAt: null,
      publishedAt: null,
      lang: null,
      classifiedAt: null,
      tags: [],
    };
    const line = encodeLine(article);
    // The newline inside the content must be escaped, or it would split the
    // record across two lines and corrupt the file.
    expect(line.split("\n")).toHaveLength(2);
    expect(parseLine(line)).toEqual(article);
  });
});

describe("assertSupportedMeta", () => {
  it("accepts the current version", () => {
    expect(assertSupportedMeta(meta)).toEqual(meta);
  });

  it("rejects a file whose first line is not meta", () => {
    expect(() =>
      assertSupportedMeta({ type: "tag", name: "x", slug: "x", kind: "CUSTOM" }),
    ).toThrow(/does not look like a Stash backup/);
  });

  it("rejects a newer format version", () => {
    expect(() =>
      assertSupportedMeta({ ...meta, version: TRANSFER_VERSION + 1 }),
    ).toThrow(/newer than this app understands/);
  });

  it("rejects another app's export", () => {
    expect(() =>
      assertSupportedMeta({ ...meta, app: "pocket" } as unknown as MetaRecord),
    ).toThrow(/Unrecognized backup source/);
  });
});

describe("splitLines", () => {
  it("returns whole lines and keeps the tail", () => {
    expect(splitLines("a\nb\nc")).toEqual({ lines: ["a", "b"], rest: "c" });
  });

  it("returns an empty tail when the buffer ends on a break", () => {
    expect(splitLines("a\n")).toEqual({ lines: ["a"], rest: "" });
  });

  it("holds a partial line back", () => {
    expect(splitLines("partial")).toEqual({ lines: [], rest: "partial" });
  });
});

describe("exportFilename", () => {
  it("stamps the date and uses the format's suffix", () => {
    expect(exportFilename(new Date("2026-08-22T13:45:00Z"))).toBe(
      "stash-export-2026-08-22.ndjson.gz",
    );
  });
});

describe("archiveFilename", () => {
  const when = new Date("2026-08-22T13:45:00Z");

  it("says which of the two backups it is", () => {
    expect(archiveFilename(when, true)).toBe("stash-backup-full-2026-08-22.tar.gz");
    expect(archiveFilename(when, false)).toBe("stash-backup-light-2026-08-22.tar.gz");
  });
});
