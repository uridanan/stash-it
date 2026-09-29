import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  ArchiveTooLargeError,
  isArticleEntry,
  normalizeEntryName,
  packArchive,
  unpackArchive,
  type ArchiveEntry,
} from "@/lib/archive";

async function* entries(list: ArchiveEntry[]): AsyncGenerator<ArchiveEntry> {
  for (const entry of list) yield entry;
}

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const GENEROUS = { maxEntryBytes: 1 << 20, maxTotalBytes: 1 << 24 };

async function readAll(
  gz: Buffer,
  limits = GENEROUS,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // unpackArchive takes plain tar; the caller owns decompression.
  for await (const entry of unpackArchive(Readable.from(gunzipSync(gz)), limits)) {
    out[entry.name] = await entry.text();
  }
  return out;
}

describe("packArchive / unpackArchive", () => {
  it("round-trips entries", async () => {
    const gz = await toBuffer(
      packArchive(
        entries([
          { name: "stash.json", body: '{"a":1}' },
          { name: "articles/one.html", body: "<p>hi</p>" },
        ]),
      ),
    );
    expect(gz[0]).toBe(0x1f); // gzip magic
    expect(gz[1]).toBe(0x8b);

    expect(await readAll(gz)).toEqual({
      "stash.json": '{"a":1}',
      "articles/one.html": "<p>hi</p>",
    });
  });

  it("preserves entry order, so the manifest can be read first", async () => {
    const gz = await toBuffer(
      packArchive(
        entries([
          { name: "stash.json", body: "{}" },
          { name: "links.ndjson", body: "{}\n" },
          { name: "articles/a.html", body: "a" },
          { name: "articles/b.html", body: "b" },
        ]),
      ),
    );
    const seen: string[] = [];
    for await (const entry of unpackArchive(Readable.from(gunzipSync(gz)), GENEROUS)) {
      seen.push(entry.name);
      await entry.text();
    }
    expect(seen).toEqual([
      "stash.json",
      "links.ndjson",
      "articles/a.html",
      "articles/b.html",
    ]);
  });

  it("survives bodies containing newlines, quotes and non-Latin text", async () => {
    const body = '<p>line one</p>\n<p>"quoted"</p>\n<p>עברית</p>';
    const gz = await toBuffer(
      packArchive(entries([{ name: "articles/x.html", body }])),
    );
    expect((await readAll(gz))["articles/x.html"]).toBe(body);
  });

  it("lets the consumer skip a body without stalling the stream", async () => {
    const gz = await toBuffer(
      packArchive(
        entries([
          { name: "stash.json", body: "{}" },
          { name: "articles/skipped.html", body: "x".repeat(5000) },
          { name: "articles/read.html", body: "wanted" },
        ]),
      ),
    );
    const read: Record<string, string> = {};
    for await (const entry of unpackArchive(Readable.from(gunzipSync(gz)), GENEROUS)) {
      // Deliberately do not call text() for the middle entry.
      if (entry.name !== "articles/skipped.html") {
        read[entry.name] = await entry.text();
      }
    }
    expect(Object.keys(read)).toEqual(["stash.json", "articles/read.html"]);
    expect(read["articles/read.html"]).toBe("wanted");
  });

  it("handles an empty archive", async () => {
    const gz = await toBuffer(packArchive(entries([])));
    expect(await readAll(gz)).toEqual({});
  });

  it("refuses an entry larger than the limit", async () => {
    const gz = await toBuffer(
      packArchive(entries([{ name: "articles/big.html", body: "x".repeat(2000) }])),
    );
    await expect(
      readAll(gz, { maxEntryBytes: 500, maxTotalBytes: 1 << 20 }),
    ).rejects.toThrow(ArchiveTooLargeError);
  });

  it("refuses an archive whose total exceeds the limit", async () => {
    const gz = await toBuffer(
      packArchive(
        entries([
          { name: "articles/a.html", body: "x".repeat(400) },
          { name: "articles/b.html", body: "x".repeat(400) },
        ]),
      ),
    );
    await expect(
      readAll(gz, { maxEntryBytes: 1000, maxTotalBytes: 500 }),
    ).rejects.toThrow(ArchiveTooLargeError);
  });
});

describe("normalizeEntryName", () => {
  it("leaves a normal name alone", () => {
    expect(normalizeEntryName("articles/one.html")).toBe("articles/one.html");
  });

  it("strips path traversal from an untrusted archive", () => {
    expect(normalizeEntryName("../../etc/passwd")).toBe("etc/passwd");
    expect(normalizeEntryName("articles/../../secret")).toBe("articles/secret");
  });

  it("strips leading slashes and dot segments", () => {
    expect(normalizeEntryName("/articles/a.html")).toBe("articles/a.html");
    expect(normalizeEntryName("./articles/a.html")).toBe("articles/a.html");
  });

  it("normalizes backslashes, which Windows-made archives contain", () => {
    expect(normalizeEntryName("articles\\a.html")).toBe("articles/a.html");
  });
});

describe("isArticleEntry", () => {
  it("recognizes article bodies", () => {
    expect(isArticleEntry("articles/one.html")).toBe(true);
  });

  it("rejects the manifest, the directory itself and stray files", () => {
    expect(isArticleEntry("stash.json")).toBe(false);
    expect(isArticleEntry("articles/")).toBe(false);
    expect(isArticleEntry("notes/one.html")).toBe(false);
  });
});
