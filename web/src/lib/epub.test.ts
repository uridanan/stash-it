import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  buildEpub,
  chapterXhtml,
  epubLang,
  navXhtml,
  packageOpf,
  toXhtmlFragment,
  xmlEscape,
  type EpubArticle,
} from "@/lib/epub";

function article(overrides: Partial<EpubArticle> = {}): EpubArticle {
  return {
    id: "abc123",
    title: "A Test Article",
    url: "https://example.com/post?a=1&b=2",
    siteName: "Example",
    author: "A. Writer",
    content: "<p>Hello world.</p>",
    summary: null,
    savedAt: new Date("2026-01-02T03:04:05.678Z"),
    publishedAt: null,
    lang: "en",
    readingMinutes: 4,
    tags: [],
    ...overrides,
  };
}

/** Throws if the string is not well-formed XML — which is what an EPUB needs. */
function parseXml(xml: string) {
  return new JSDOM(xml, { contentType: "application/xhtml+xml" }).window.document;
}

describe("xmlEscape", () => {
  it("escapes the five XML entities", () => {
    expect(xmlEscape(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;",
    );
  });
});

describe("epubLang", () => {
  it("passes a valid tag through", () => {
    expect(epubLang("he")).toBe("he");
    expect(epubLang("en-GB")).toBe("en-GB");
  });

  it("normalizes an underscore locale", () => {
    expect(epubLang("en_US")).toBe("en-US");
  });

  it("falls back to English rather than emitting junk", () => {
    expect(epubLang(null)).toBe("en");
    expect(epubLang("")).toBe("en");
    expect(epubLang("english (US)")).toBe("en");
  });
});

describe("toXhtmlFragment", () => {
  it("closes what the source left open", () => {
    expect(toXhtmlFragment("<p>one<p>two")).toBe("<p>one</p><p>two</p>");
  });

  it("self-closes void elements", () => {
    expect(toXhtmlFragment("<p>a<br>b</p>")).toContain("<br />");
  });

  it("still drops anything outside the allowlist", () => {
    expect(toXhtmlFragment('<p>ok</p><script>alert(1)</script>')).toBe("<p>ok</p>");
  });
});

describe("chapterXhtml", () => {
  it("is well-formed XML", () => {
    const doc = parseXml(chapterXhtml(article({ content: "<p>a<br>b</p><img src='https://e.com/i.png'>" })));
    expect(doc.querySelector("h1")?.textContent).toBe("A Test Article");
  });

  it("escapes the title and the source URL", () => {
    const xhtml = chapterXhtml(article({ title: "Tom & Jerry <live>" }));
    expect(xhtml).toContain("Tom &amp; Jerry &lt;live&gt;");
    expect(xhtml).toContain("https://example.com/post?a=1&amp;b=2");
    expect(() => parseXml(xhtml)).not.toThrow();
  });

  it("includes the summary when there is one", () => {
    const xhtml = chapterXhtml(article({ summary: "THE NEWS\nIt happened." }));
    expect(xhtml).toContain("AI summary");
    expect(xhtml).toContain("<p>It happened.</p>");
  });

  it("omits the summary section entirely when there is none", () => {
    expect(chapterXhtml(article())).not.toContain("AI summary");
  });

  it("says so when no text was saved", () => {
    const xhtml = chapterXhtml(article({ content: "" }));
    expect(xhtml).toContain("No article text was saved");
    expect(() => parseXml(xhtml)).not.toThrow();
  });
});

describe("navXhtml", () => {
  it("is well-formed and lists the single chapter", () => {
    const doc = parseXml(navXhtml(article()));
    const link = doc.querySelector("nav a");
    expect(link?.getAttribute("href")).toBe("article.xhtml");
    expect(link?.textContent).toBe("A Test Article");
  });
});

describe("packageOpf", () => {
  it("is well-formed and identifies the article", () => {
    const doc = parseXml(packageOpf(article(), new Date("2026-01-02T03:04:05.678Z")));
    expect(doc.querySelector("identifier")?.textContent).toBe(
      "urn:stash:article:abc123",
    );
    expect(doc.querySelector("language")?.textContent).toBe("en");
    expect(doc.querySelector("creator")?.textContent).toBe("A. Writer");
  });

  it("stamps dcterms:modified to whole seconds in UTC", () => {
    const opf = packageOpf(article(), new Date("2026-01-02T03:04:05.678Z"));
    expect(opf).toContain(
      '<meta property="dcterms:modified">2026-01-02T03:04:05Z</meta>',
    );
  });

  it("declares remote resources only when the body has images", () => {
    expect(packageOpf(article({ content: '<img src="https://e.com/i.png">' }), new Date())).toContain(
      'properties="remote-resources"',
    );
    expect(packageOpf(article(), new Date())).not.toContain("remote-resources");
  });

  it("writes each tag as a subject", () => {
    const opf = packageOpf(article({ tags: ["Tech", "Deep dive"] }), new Date());
    expect(opf).toContain("<dc:subject>Tech</dc:subject>");
    expect(opf).toContain("<dc:subject>Deep dive</dc:subject>");
  });

  it("falls back to the site when there is no author", () => {
    const opf = packageOpf(article({ author: null }), new Date());
    expect(opf).toContain("<dc:creator>Example</dc:creator>");
  });
});

describe("buildEpub", () => {
  it("puts an uncompressed mimetype first, as the format requires", async () => {
    const buffer = await buildEpub(article());

    // The local file header for the first entry starts at byte 0; the name and
    // the payload sit at fixed offsets when the entry is stored, which is what
    // a reader sniffs.
    expect(buffer.subarray(30, 38).toString("ascii")).toBe("mimetype");
    expect(buffer.subarray(38, 58).toString("ascii")).toBe("application/epub+zip");
  });

  it("contains the whole EPUB skeleton", async () => {
    const zip = await JSZip.loadAsync(await buildEpub(article()));
    const files = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    expect(files).toEqual([
      "META-INF/container.xml",
      "OEBPS/article.xhtml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/style.css",
      "mimetype",
    ]);
  });

  it("points the container at the package document", async () => {
    const zip = await JSZip.loadAsync(await buildEpub(article()));
    const container = parseXml(await zip.file("META-INF/container.xml")!.async("string"));
    expect(container.querySelector("rootfile")?.getAttribute("full-path")).toBe(
      "OEBPS/content.opf",
    );
  });

  it("survives a body with Hebrew and unbalanced markup", async () => {
    const zip = await JSZip.loadAsync(
      await buildEpub(
        article({ lang: "he", content: "<p>שלום עולם<br>שורה שנייה<p>עוד פסקה" }),
      ),
    );
    const chapter = await zip.file("OEBPS/article.xhtml")!.async("string");
    const doc = parseXml(chapter);
    expect(doc.documentElement.getAttribute("lang")).toBe("he");
    expect(chapter).toContain("שלום עולם");
  });
});
