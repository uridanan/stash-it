import { describe, expect, it } from "vitest";

import {
  articleFilename,
  articleToMarkdown,
  frontmatter,
  htmlToMarkdown,
  indexToMarkdown,
  yamlScalar,
  type MarkdownArticle,
} from "@/lib/markdown";

function article(overrides: Partial<MarkdownArticle> = {}): MarkdownArticle {
  return {
    id: "abc123",
    url: "https://example.com/a",
    title: "A Quiet Article",
    siteName: "Example",
    author: "Ada Lovelace",
    excerpt: null,
    content: "<p>Hello world.</p>",
    summary: null,
    state: "UNREAD",
    starred: false,
    savedAt: new Date("2026-01-02T03:04:05.000Z"),
    publishedAt: null,
    lang: "en",
    readingMinutes: 4,
    tags: [],
    ...overrides,
  };
}

describe("htmlToMarkdown", () => {
  it("converts ordinary prose", () => {
    expect(htmlToMarkdown("<p>Hello <strong>world</strong>.</p>")).toBe(
      "Hello **world**.",
    );
  });

  it("converts headings, lists and links", () => {
    const md = htmlToMarkdown(
      "<h2>Title</h2><ul><li>one</li><li>two</li></ul>" +
        '<p><a href="https://x.com">link</a></p>',
    );
    expect(md).toContain("## Title");
    // Turndown pads after the bullet ("-   one"), which is valid Markdown.
    expect(md).toMatch(/^-\s+one$/m);
    expect(md).toMatch(/^-\s+two$/m);
    expect(md).toContain("[link](https://x.com)");
  });

  it("converts blockquotes and code", () => {
    const md = htmlToMarkdown(
      "<blockquote><p>quoted</p></blockquote><pre><code>x = 1</code></pre>",
    );
    expect(md).toContain("> quoted");
    expect(md).toContain("x = 1");
  });

  it("converts tables via the GFM plugin", () => {
    const md = htmlToMarkdown(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    expect(md).toContain("| a | b |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("keeps constructs Markdown cannot express as inline HTML", () => {
    // sub/sup and definition lists have no Markdown form; losing them outright
    // would change the meaning of the text.
    const md = htmlToMarkdown(
      "<p>H<sub>2</sub>O and x<sup>2</sup></p>" +
        "<dl><dt>term</dt><dd>meaning</dd></dl>",
    );
    expect(md).toContain("<sub>2</sub>");
    expect(md).toContain("<sup>2</sup>");
    expect(md.toLowerCase()).toContain("term");
    expect(md.toLowerCase()).toContain("meaning");
  });

  it("returns nothing for empty content", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });
});

describe("yamlScalar", () => {
  it("quotes values a YAML 1.1 parser would coerce", () => {
    expect(yamlScalar("no")).toBe('"no"');
    expect(yamlScalar("on")).toBe('"on"');
    expect(yamlScalar("1.10")).toBe('"1.10"');
    expect(yamlScalar("2026-07-04")).toBe('"2026-07-04"');
  });

  it("escapes embedded quotes and backslashes", () => {
    expect(yamlScalar('a "b" c')).toBe('"a \\"b\\" c"');
    expect(yamlScalar("a\\b")).toBe('"a\\\\b"');
  });
});

describe("articleFilename", () => {
  it("leads with the id and appends a readable slug", () => {
    expect(articleFilename({ id: "abc", title: "Hello World" }, "md")).toBe(
      "abc-hello-world.md",
    );
  });

  it("falls back to the id alone when the title has no ASCII form", () => {
    // 238 of 11,732 real titles are in this shape.
    expect(articleFilename({ id: "abc", title: "עברית" }, "md")).toBe("abc.md");
  });

  it("handles a blank title", () => {
    expect(articleFilename({ id: "abc", title: "   " }, "html")).toBe("abc.html");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(articleFilename({ id: "abc", title: "Café Société" }, "md")).toBe(
      "abc-cafe-societe.md",
    );
  });

  it("caps a very long title without leaving a trailing hyphen", () => {
    const name = articleFilename(
      { id: "abc", title: "word ".repeat(200) },
      "md",
    );
    expect(name.length).toBeLessThan(80);
    expect(name).not.toContain("-.md");
  });

  it("keeps two articles with the same title distinct", () => {
    const a = articleFilename({ id: "one", title: "Same" }, "md");
    const b = articleFilename({ id: "two", title: "Same" }, "md");
    expect(a).not.toBe(b);
  });
});

describe("frontmatter", () => {
  it("quotes the title, url and tags", () => {
    const fm = frontmatter(article({ title: "no", tags: ["on", "1.10"] }));
    expect(fm).toContain('title: "no"');
    expect(fm).toContain('url: "https://example.com/a"');
    expect(fm).toContain('tags: ["on", "1.10"]');
  });

  it("leaves booleans and numbers unquoted, where YAML is unambiguous", () => {
    const fm = frontmatter(article({ starred: true, readingMinutes: 7 }));
    expect(fm).toContain("starred: true");
    expect(fm).toContain("reading_minutes: 7");
  });

  it("maps state to read/unread", () => {
    expect(frontmatter(article({ state: "ARCHIVED" }))).toContain(
      'status: "read"',
    );
    expect(frontmatter(article({ state: "UNREAD" }))).toContain(
      'status: "unread"',
    );
  });

  it("omits optional fields that are absent", () => {
    const fm = frontmatter(
      article({ siteName: null, author: null, publishedAt: null, lang: null }),
    );
    expect(fm).not.toContain("source:");
    expect(fm).not.toContain("author:");
    expect(fm).not.toContain("published:");
    expect(fm).not.toContain("lang:");
  });

  it("emits an empty list for no tags", () => {
    expect(frontmatter(article({ tags: [] }))).toContain("tags: []");
  });
});

describe("articleToMarkdown", () => {
  it("includes frontmatter, the title and the body", () => {
    const md = articleToMarkdown(article());
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("# A Quiet Article");
    expect(md).toContain("Hello world.");
    expect(md).toContain("[Original](https://example.com/a)");
  });

  it("gives the summary its own section when there is one", () => {
    const md = articleToMarkdown(
      article({ summary: "THE NEWS\nSomething happened." }),
    );
    expect(md).toContain("## Summary");
    expect(md).toContain("Something happened.");
    expect(md.indexOf("## Summary")).toBeLessThan(md.indexOf("## Article"));
  });

  it("omits the summary section when there is none", () => {
    expect(articleToMarkdown(article({ summary: null }))).not.toContain(
      "## Summary",
    );
  });

  it("says so, and links out, when no text was saved", () => {
    const md = articleToMarkdown(article({ content: "" }));
    expect(md).toContain("No article text was saved");
    expect(md).toContain("https://example.com/a");
  });
});

describe("indexToMarkdown", () => {
  it("lists every article with a relative link", () => {
    const md = indexToMarkdown(
      [article({ id: "one", title: "First" }), article({ id: "two", title: "Second" })],
      new Date("2026-08-24T00:00:00.000Z"),
    );
    expect(md).toContain("2 article(s)");
    expect(md).toContain("[First](articles/one-first.md)");
    expect(md).toContain("[Second](articles/two-second.md)");
  });

  it("shows status, stars and tags", () => {
    const md = indexToMarkdown(
      [article({ state: "ARCHIVED", starred: true, tags: ["Tech"] })],
      new Date("2026-08-24T00:00:00.000Z"),
    );
    expect(md).toContain("read");
    expect(md).toContain("starred");
    expect(md).toContain("Tech");
  });

  it("handles an empty export", () => {
    const md = indexToMarkdown([], new Date("2026-08-24T00:00:00.000Z"));
    expect(md).toContain("0 article(s)");
  });
});
