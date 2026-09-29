import { describe, expect, it } from "vitest";

import { htmlToBlocks, runsToText, type Block } from "@/lib/doc-blocks";

function texts(blocks: readonly Block[], kind: Block["kind"]): string[] {
  return blocks
    .filter((block) => block.kind === kind)
    .map((block) => ("runs" in block ? runsToText(block.runs) : ""));
}

describe("htmlToBlocks", () => {
  it("returns nothing for an empty body", () => {
    expect(htmlToBlocks("")).toEqual([]);
    expect(htmlToBlocks("   ")).toEqual([]);
  });

  it("keeps headings with their level", () => {
    const blocks = htmlToBlocks("<h2>Title</h2><h4>Sub</h4>");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, runs: [{ text: "Title" }] },
      { kind: "heading", level: 4, runs: [{ text: "Sub" }] },
    ]);
  });

  it("carries emphasis and links as inline runs", () => {
    const blocks = htmlToBlocks(
      '<p>Plain <strong>bold</strong> <em>italic</em> <a href="https://example.com">link</a></p>',
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "Plain " },
          { text: "bold", bold: true },
          { text: " " },
          { text: "italic", italic: true },
          { text: " " },
          { text: "link", href: "https://example.com" },
        ],
      },
    ]);
  });

  it("drops links that cannot resolve offline", () => {
    const blocks = htmlToBlocks('<p><a href="/relative">here</a></p>');
    expect(blocks[0]).toEqual({ kind: "paragraph", runs: [{ text: "here" }] });
  });

  it("collapses whitespace the way a browser would", () => {
    const blocks = htmlToBlocks("<p>  one\n\n  two  </p>");
    expect(texts(blocks, "paragraph")).toEqual(["one two"]);
  });

  it("numbers ordered lists and indents nested ones", () => {
    const blocks = htmlToBlocks(
      "<ol><li>First</li><li>Second<ul><li>Inner</li></ul></li></ol>",
    );
    expect(blocks).toEqual([
      { kind: "list-item", marker: "1.", depth: 0, runs: [{ text: "First" }] },
      { kind: "list-item", marker: "2.", depth: 0, runs: [{ text: "Second" }] },
      { kind: "list-item", marker: "◦", depth: 1, runs: [{ text: "Inner" }] },
    ]);
  });

  it("does not count a nested list's text twice", () => {
    const blocks = htmlToBlocks("<ul><li>Outer<ul><li>Inner</li></ul></li></ul>");
    expect(texts(blocks, "list-item")).toEqual(["Outer", "Inner"]);
  });

  it("keeps preformatted text verbatim", () => {
    const blocks = htmlToBlocks("<pre><code>const x = 1;\n  indented\n</code></pre>");
    expect(blocks).toEqual([
      { kind: "code", text: "const x = 1;\n  indented" },
    ]);
  });

  it("records images without fetching them", () => {
    const blocks = htmlToBlocks('<img src="https://example.com/a.png" alt="A chart">');
    expect(blocks).toEqual([
      { kind: "image", src: "https://example.com/a.png", alt: "A chart" },
    ]);
  });

  it("flattens a table to one line per row", () => {
    const blocks = htmlToBlocks(
      "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "A  |  B", bold: true }] },
      { kind: "paragraph", runs: [{ text: "1  |  2" }] },
    ]);
  });

  it("unwraps containers it has no layout for", () => {
    const blocks = htmlToBlocks("<div><section><p>Deep</p></section></div>");
    expect(texts(blocks, "paragraph")).toEqual(["Deep"]);
  });

  it("keeps a figure's caption as its own block", () => {
    const blocks = htmlToBlocks(
      '<figure><img src="https://e.com/a.png" alt=""><figcaption>What it shows</figcaption></figure>',
    );
    expect(blocks.map((block) => block.kind)).toEqual(["image", "caption"]);
  });
});
