import { describe, expect, it } from "vitest";

import {
  mapFolder,
  normalizeUrl,
  parseCsv,
  parseInstapaperCsv,
  parseTags,
} from "@/lib/instapaper";

describe("parseCsv", () => {
  it("reads a simple table", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('a,b\n"one, two",3\n')).toEqual([
      ["a", "b"],
      ["one, two", "3"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('t\n"He said ""hi"""\n')).toEqual([["t"], ['He said "hi"']]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('t,u\n"line one\nline two",x\n')).toEqual([
      ["t", "u"],
      ["line one\nline two", "x"],
    ]);
  });

  it("handles CRLF as a single break", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("normalizeUrl", () => {
  it("passes through http and https", () => {
    expect(normalizeUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(normalizeUrl("http://a.com")).toBe("http://a.com");
  });

  it("assumes https for a bare hostname", () => {
    expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
  });

  it("refuses other schemes rather than mangling them", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses empty input", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("parseTags", () => {
  it("reads a JSON array", () => {
    expect(parseTags('["coding","e-bike"]')).toEqual(["coding", "e-bike"]);
  });

  it("treats the empty array as no tags", () => {
    expect(parseTags("[]")).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });

  it("collapses case-duplicate tags", () => {
    expect(parseTags('["Coding","coding"]')).toEqual(["Coding"]);
  });

  it("falls back to a comma-separated list", () => {
    expect(parseTags("coding, e-bike")).toEqual(["coding", "e-bike"]);
  });

  it("ignores non-string entries", () => {
    expect(parseTags('["coding",7,null]')).toEqual(["coding"]);
  });
});

describe("mapFolder", () => {
  it("maps Archive to read", () => {
    expect(mapFolder("Archive")).toEqual({ state: "ARCHIVED", starred: false });
  });

  it("maps Unread to unread", () => {
    expect(mapFolder("Unread")).toEqual({ state: "UNREAD", starred: false });
  });

  it("maps Starred to starred and unread, since the folder implies no read state", () => {
    expect(mapFolder("Starred")).toEqual({ state: "UNREAD", starred: true });
  });

  it("treats an unknown folder as unread rather than hiding it", () => {
    expect(mapFolder("Reading list")).toEqual({
      state: "UNREAD",
      starred: false,
    });
  });
});

describe("parseInstapaperCsv", () => {
  const header = "URL,Title,Selection,Folder,Timestamp,Tags\n";

  it("maps a row", () => {
    const { rows } = parseInstapaperCsv(
      // Tag cells are quoted CSV in a real export: "[""coding""]".
      header +
        'https://example.com/a,Title A,,Archive,1783091650,"[""coding""]"\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://example.com/a");
    expect(rows[0].title).toBe("Title A");
    expect(rows[0].tags).toEqual(["coding"]);
    expect(rows[0].savedAt.toISOString()).toBe("2026-07-03T15:14:10.000Z");
  });

  it("falls back to the hostname when the title is blank", () => {
    const { rows } = parseInstapaperCsv(
      header + "https://example.com/a,,,Unread,1783091650,[]\n",
    );
    expect(rows[0].title).toBe("example.com");
  });

  it("keeps a highlight as the excerpt source", () => {
    const { rows } = parseInstapaperCsv(
      header + 'https://example.com/a,T,"a quoted highlight",Unread,1,[]\n',
    );
    expect(rows[0].selection).toBe("a quoted highlight");
  });

  it("skips rows with no or non-http URLs, and reports them", () => {
    const { rows, skipped } = parseInstapaperCsv(
      header + ",T,,Unread,1,[]\njavascript:alert(1),T,,Unread,1,[]\n",
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped[0].line).toBe(2);
  });

  it("skips a URL repeated within the file", () => {
    const { rows, skipped } = parseInstapaperCsv(
      header +
        "https://example.com/a,A,,Unread,1,[]\nhttps://example.com/a,A,,Unread,2,[]\n",
    );
    expect(rows).toHaveLength(1);
    expect(skipped[0].reason).toContain("duplicate");
  });

  it("falls back to now when the timestamp is unusable", () => {
    const { rows } = parseInstapaperCsv(
      header + "https://example.com/a,A,,Unread,notanumber,[]\n",
    );
    expect(rows[0].savedAt.getTime()).toBeGreaterThan(0);
  });

  it("rejects a CSV that is not an Instapaper export", () => {
    expect(() => parseInstapaperCsv("foo,bar\n1,2\n")).toThrow(/URL/);
  });

  it("reads a tag cell exactly as a real export writes it", () => {
    // Verbatim shape from Instapaper-Export-2026-07-04: the JSON array arrives
    // as a quoted CSV field with its inner quotes doubled. Getting this wrong
    // silently turns every tag into "[tagname]".
    const { rows } = parseInstapaperCsv(
      header +
        'https://www.linkedin.com/pulse/x/,The Status Trap,,Archive,1782027176,"[""product management""]"\n',
    );
    expect(rows[0].tags).toEqual(["product management"]);
    expect(rows[0].title).toBe("The Status Trap");
  });

  it("returns nothing for an empty file", () => {
    expect(parseInstapaperCsv("")).toEqual({ rows: [], skipped: [] });
  });
});
