import { describe, expect, it } from "vitest";

import { MAX_COLLECTIONS, parseCollections } from "@/lib/collection-names";
import { MAX_TAG_NAME } from "@/lib/tags";
import { sourceUrl } from "@/lib/source-url";
import {
  MAX_TITLE_CHARS,
  normalizeArticleText,
  prepareTextArticle,
  TextArticleError,
  textArticleUrl,
} from "@/lib/text-article";

const prose = "Board update\n\nRevenue grew. Costs did not.";

describe("text article identity", () => {
  it("treats the same text as the same article", () => {
    const a = normalizeArticleText(prose);
    const b = normalizeArticleText(`\r\n${prose}\r\n`);
    expect(textArticleUrl(a)).toBe(textArticleUrl(b));
    expect(textArticleUrl(a).startsWith("stash-text:")).toBe(true);
  });

  it("treats different text as different articles", () => {
    expect(textArticleUrl("one")).not.toBe(textArticleUrl("two"));
  });

  it("hides the internal identity from anything that would link it", () => {
    const prepared = prepareTextArticle({ text: prose });
    expect(sourceUrl(prepared.url)).toBeNull();
    expect(sourceUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(sourceUrl(null)).toBeNull();
  });
});

describe("prepareTextArticle", () => {
  it("turns plain text into paragraphs and a title from the first line", () => {
    const article = prepareTextArticle({ text: prose });
    expect(article.title).toBe("Board update");
    expect(article.content).toBe(
      "<p>Board update</p><p>Revenue grew. Costs did not.</p>",
    );
    expect(article.wordCount).toBe(7);
    expect(article.readingMinutes).toBe(1);
    expect(article.excerpt).toContain("Board update");
    expect(article.author).toBeNull();
    expect(article.url.startsWith("stash-text:")).toBe(true);
  });

  it("keeps an explicit title and author", () => {
    const article = prepareTextArticle({
      text: prose,
      title: "Q3 note",
      author: "Ada",
    });
    expect(article.title).toBe("Q3 note");
    expect(article.author).toBe("Ada");
  });

  it("sanitizes HTML and drops scripts", () => {
    const article = prepareTextArticle({
      text: "<html><body><h1>Hello</h1><p>Body</p><script>alert(1)</script></body></html>",
    });
    expect(article.title).toBe("Hello");
    expect(article.content).toContain("<p>Body</p>");
    expect(article.content).not.toContain("script");
    expect(article.content).not.toContain("alert");
  });

  it("keeps a less-than sign in plain text", () => {
    const article = prepareTextArticle({ text: "A number < 3 is small enough to read." });
    expect(article.content).toContain("&lt;");
    expect(article.content).not.toContain("< 3");
  });

  it("rejects empty, unreadable, and oversized fields", () => {
    expect(() => prepareTextArticle({ text: "   " })).toThrow(TextArticleError);
    expect(() => prepareTextArticle({ text: "<script>alert(1)</script>" })).toThrow(
      /no readable content/,
    );
    expect(() => prepareTextArticle({ text: prose, title: "x".repeat(MAX_TITLE_CHARS + 1) })).toThrow(
      /title must be/,
    );
    expect(() => prepareTextArticle({ text: prose, author: 4 })).toThrow(/author must be a string/);
  });
});

describe("parseCollections", () => {
  it("treats a missing list as no collections", () => {
    expect(parseCollections(undefined)).toEqual({ names: [] });
    expect(parseCollections(null)).toEqual({ names: [] });
  });

  it("trims names and collapses case-insensitive duplicates", () => {
    expect(parseCollections([" Reading ", "reading", "News"])).toEqual({
      names: ["Reading", "News"],
    });
  });

  it("rejects a bad list", () => {
    expect(parseCollections("Reading")).toEqual({
      error: "collections must be an array of names",
    });
    expect(parseCollections([""])).toEqual({
      error: "collections must be an array of non-empty names",
    });
    expect(parseCollections(["x".repeat(MAX_TAG_NAME + 1)])).toMatchObject({
      error: expect.stringContaining(String(MAX_TAG_NAME)),
    });
    expect(parseCollections(Array.from({ length: MAX_COLLECTIONS + 1 }, () => "A"))).toMatchObject({
      error: expect.stringContaining(String(MAX_COLLECTIONS)),
    });
  });
});
