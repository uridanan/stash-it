import { beforeEach, describe, expect, it } from "vitest";

import {
  CHUNK_ATTR,
  unwrapSentences,
  wrapSentences,
} from "@/components/listen/wrap-sentences";

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("wrapSentences", () => {
  it("wraps each sentence in its own indexed span", () => {
    const el = root("<p>One thing. Two things.</p>");
    const chunks = wrapSentences(el);
    expect(chunks.map((c) => c.text)).toEqual(["One thing.", "Two things."]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
    expect(el.querySelectorAll(`[${CHUNK_ATTR}]`)).toHaveLength(2);
  });

  it("keeps a sentence spanning inline elements as one chunk", () => {
    const el = root("<p>He said <em>hello</em>. Then he left.</p>");
    const chunks = wrapSentences(el);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe("He said hello.");
    expect(chunks[0].elements.length).toBeGreaterThan(1);
    expect(chunks[1].text).toBe("Then he left.");
  });

  it("closes a chunk at a block boundary even without punctuation", () => {
    const el = root("<p>Unfinished</p><p>Next thing.</p>");
    const chunks = wrapSentences(el);
    expect(chunks.map((c) => c.text)).toEqual(["Unfinished", "Next thing."]);
  });

  it("skips script, style and figcaption", () => {
    const el = root(
      "<script>var x = 1;</script><style>p{color:red}</style>" +
        "<figure><figcaption>A caption.</figcaption></figure><p>Body text.</p>",
    );
    const chunks = wrapSentences(el);
    expect(chunks.map((c) => c.text)).toEqual(["Body text."]);
  });

  it("continues numbering from startIndex", () => {
    const el = root("<p>Third. Fourth.</p>");
    const chunks = wrapSentences(el, 2);
    expect(chunks.map((c) => c.index)).toEqual([2, 3]);
    expect(el.querySelector(`[${CHUNK_ATTR}="2"]`)).not.toBeNull();
  });

  it("ignores whitespace-only text nodes", () => {
    const el = root("<p>One.</p>\n\n  <p>Two.</p>");
    expect(wrapSentences(el)).toHaveLength(2);
  });

  it("produces no chunks for empty content", () => {
    expect(wrapSentences(root("<p>   </p>"))).toEqual([]);
  });
});

describe("unwrapSentences", () => {
  it("restores the original markup so wrapping can be repeated", () => {
    const html = "<p>He said <em>hello</em>. Then he left.</p>";
    const el = root(html);
    wrapSentences(el);
    unwrapSentences(el);
    expect(el.innerHTML).toBe(html);
  });

  it("yields the same chunks on a second wrap", () => {
    const el = root("<p>One thing. Two things.</p>");
    const first = wrapSentences(el).map((c) => c.text);
    unwrapSentences(el);
    const second = wrapSentences(el).map((c) => c.text);
    expect(second).toEqual(first);
  });
});
