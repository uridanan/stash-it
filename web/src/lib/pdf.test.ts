// @vitest-environment node
//
// PDFKit resolves to its browser build under a jsdom environment, where it can
// neither read a font file nor embed one — this suite needs the Node build.

import { describe, expect, it } from "vitest";

import { buildPdf, isRtl, type PdfArticle } from "@/lib/pdf";

function article(overrides: Partial<PdfArticle> = {}): PdfArticle {
  return {
    title: "A Test Article",
    url: "https://example.com/post",
    siteName: "Example",
    author: "A. Writer",
    content: "<p>Hello world.</p>",
    summary: null,
    savedAt: new Date("2026-01-02T03:04:05Z"),
    publishedAt: null,
    readingMinutes: 4,
    tags: [],
    ...overrides,
  };
}

/** Counts `/Type /Page` objects, which is one per rendered page. */
function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe("isRtl", () => {
  it("is false for Latin text", () => {
    expect(isRtl("Hello world")).toBe(false);
  });

  it("is true for Hebrew text", () => {
    expect(isRtl("שלום עולם")).toBe(true);
  });

  it("follows the script that owns most of the letters", () => {
    expect(isRtl("שלום everyone, this is mostly English")).toBe(false);
    expect(isRtl("זהו משפט בעברית עם המילה English בתוכו")).toBe(true);
  });

  it("is false for text with no letters at all", () => {
    expect(isRtl("1234 — 5678")).toBe(false);
  });
});

describe("buildPdf", () => {
  it("produces a one-page PDF for a short article", async () => {
    const pdf = await buildPdf(article());
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("flows onto more pages as the article grows", async () => {
    const long = `<p>${"A sentence that takes up room on the page. ".repeat(400)}</p>`;
    expect(pageCount(await buildPdf(article({ content: long })))).toBeGreaterThan(3);
  });

  it("renders an article whose text was never saved", async () => {
    const pdf = await buildPdf(article({ content: "" }));
    expect(pageCount(pdf)).toBe(1);
  });

  it("embeds a font rather than using a standard one", async () => {
    const pdf = (await buildPdf(article())).toString("latin1");
    // A subset of an embedded TrueType font, not Helvetica.
    expect(pdf).toContain("DejaVuSans");
    expect(pdf).toContain("/FontFile2");
    expect(pdf).not.toContain("/BaseFont /Helvetica");
  });

  it("renders Hebrew without falling over", async () => {
    const hebrew = `<h2>כותרת</h2><p>${"זהו טקסט בעברית שנועד להישבר לשורות רבות. ".repeat(20)}</p>`;
    const pdf = await buildPdf(article({ title: "מאמר", content: hebrew }));
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });

  it("handles every block kind in one document", async () => {
    const content = `
      <h2>Heading</h2>
      <p>Text with <strong>bold</strong>, <em>italic</em> and a <a href="https://example.com">link</a>.</p>
      <blockquote><p>A quotation.</p></blockquote>
      <ul><li>One<ul><li>Nested</li></ul></li></ul>
      <ol><li>First</li></ol>
      <pre><code>const x = 1;</code></pre>
      <hr>
      <figure><img src="https://example.com/a.png" alt="A chart"><figcaption>Caption</figcaption></figure>
      <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
    `;
    const pdf = await buildPdf(article({ content, summary: "THE NEWS\nIt happened." }));
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });

  it("renders an article with no author and no site name", async () => {
    // PDFKit calls .valueOf() on every `info` value when it builds the file
    // identifier, so an undefined Author threw a TypeError on real rows that
    // have neither — the fixture always had both, which is how it shipped.
    const pdf = await buildPdf(article({ author: null, siteName: null }));
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("carries the title into the document metadata", async () => {
    const pdf = (await buildPdf(article({ title: "Metadata Test" }))).toString("latin1");
    expect(pdf).toContain("Metadata Test");
  });
});
