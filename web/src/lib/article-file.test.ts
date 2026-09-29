import { describe, expect, it } from "vitest";

import {
  buildArticleFile,
  escapeText,
  parseArticleFile,
  unescapeText,
  type ArticleFilePayload,
} from "@/lib/article-file";

function payload(overrides: Partial<ArticleFilePayload> = {}): ArticleFilePayload {
  return {
    title: "A Quiet Article",
    url: "https://example.com/a",
    lang: "en",
    summary: null,
    content: "<p>Hello world.</p>",
    ...overrides,
  };
}

describe("escapeText / unescapeText", () => {
  it("round-trips text containing markup characters", () => {
    const text = 'a < b > c & d "e"';
    expect(unescapeText(escapeText(text))).toBe(text);
  });

  it("does not double-decode an escaped entity", () => {
    // "&amp;lt;" must come back as "&lt;", not as "<".
    expect(unescapeText(escapeText("&lt;"))).toBe("&lt;");
  });
});

describe("buildArticleFile / parseArticleFile", () => {
  it("round-trips the body byte for byte", () => {
    const content =
      '<p>One</p>\n<table><tr><td colspan="2">x</td></tr></table>\n<p>Two</p>';
    const parsed = parseArticleFile(buildArticleFile(payload({ content })));
    expect(parsed?.content).toBe(content);
  });

  it("round-trips a summary", () => {
    const summary = "THE NEWS\nSomething happened.\n\nKEY INSIGHTS\n- one";
    const parsed = parseArticleFile(buildArticleFile(payload({ summary })));
    expect(parsed?.summary).toBe(summary);
  });

  it("round-trips a summary containing markup characters", () => {
    const summary = "Comparing a < b and <script> in prose & more";
    const parsed = parseArticleFile(buildArticleFile(payload({ summary })));
    expect(parsed?.summary).toBe(summary);
  });

  it("reports no summary when there was none", () => {
    const parsed = parseArticleFile(buildArticleFile(payload({ summary: null })));
    expect(parsed?.summary).toBeNull();
    expect(parsed?.content).toBe("<p>Hello world.</p>");
  });

  it("treats a whitespace-only summary as absent", () => {
    const parsed = parseArticleFile(buildArticleFile(payload({ summary: "   " })));
    expect(parsed?.summary).toBeNull();
  });

  it("handles an empty body", () => {
    const parsed = parseArticleFile(buildArticleFile(payload({ content: "" })));
    expect(parsed?.content).toBe("");
  });

  it("is a real HTML document with the title and canonical url", () => {
    const file = buildArticleFile(payload());
    expect(file.startsWith("<!doctype html>")).toBe(true);
    expect(file).toContain("<title>A Quiet Article</title>");
    expect(file).toContain('href="https://example.com/a"');
  });

  it("escapes the title and url in the header", () => {
    const file = buildArticleFile(
      payload({ title: 'Tom & Jerry <hi>', url: "https://x.com/?a=1&b=2" }),
    );
    expect(file).toContain("<title>Tom &amp; Jerry &lt;hi&gt;</title>");
    expect(file).toContain("a=1&amp;b=2");
  });

  it("keeps body markup that also appears in the markers", () => {
    // An article that itself contains an HTML comment must not confuse the
    // section boundaries.
    const content = "<p>before</p><!-- a comment --><p>after</p>";
    const parsed = parseArticleFile(buildArticleFile(payload({ content })));
    expect(parsed?.content).toBe(content);
  });

  it("returns null for a file that is not an article", () => {
    expect(parseArticleFile("<html><body>nothing here</body></html>")).toBeNull();
    expect(parseArticleFile("")).toBeNull();
  });
});
