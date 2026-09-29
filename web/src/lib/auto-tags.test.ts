import { describe, expect, it } from "vitest";

import {
  autoTagsFor,
  detectLanguageFromText,
  languageTagName,
  LONG_READ_WORDS,
  primaryLanguage,
  TAG_LONG_READ,
  TAG_QUICK_READ,
  TAG_SHOPPING,
  TAG_VISUAL,
  TAG_WONT_NARRATE,
  type AutoTagInput,
} from "@/lib/auto-tags";

function words(count: number): string {
  return Array.from({ length: count }, () => "word").join(" ");
}

function input(overrides: Partial<AutoTagInput> = {}): AutoTagInput {
  return {
    url: "https://example.com/article",
    wordCount: 500,
    content: `<p>${words(500)}</p>`,
    leadImageUrl: null,
    lang: "en",
    extractionFailed: false,
    isProduct: false,
    hasEmbeddedMedia: false,
    ...overrides,
  };
}

const names = (i: AutoTagInput) => autoTagsFor(i).map((t) => t.name);

describe("length tags", () => {
  it("tags a short article as a quick read", () => {
    expect(names(input({ wordCount: 300 }))).toContain(TAG_QUICK_READ);
  });

  it("switches to long read exactly at the threshold", () => {
    expect(names(input({ wordCount: LONG_READ_WORDS - 1 }))).toContain(
      TAG_QUICK_READ,
    );
    expect(names(input({ wordCount: LONG_READ_WORDS }))).toContain(
      TAG_LONG_READ,
    );
  });

  it("assigns no length tag when extraction failed", () => {
    const result = names(
      input({ extractionFailed: true, wordCount: 0, content: "" }),
    );
    expect(result).not.toContain(TAG_QUICK_READ);
    expect(result).not.toContain(TAG_LONG_READ);
  });
});

describe("language tags", () => {
  it("uses the declared language", () => {
    expect(names(input({ lang: "fr" }))).toContain("French");
  });

  it("normalizes a regional tag to its primary language", () => {
    expect(primaryLanguage("fr-CA")).toBe("fr");
    expect(names(input({ lang: "fr-CA" }))).toContain("French");
  });

  it("detects Hebrew from the text when the page declares nothing", () => {
    const hebrew = "זהו מאמר בעברית על קריאה איטית ועל תשומת לב ".repeat(6);
    expect(names(input({ lang: null, content: `<p>${hebrew}</p>` }))).toContain(
      "Hebrew",
    );
  });

  it("maps the legacy Hebrew code", () => {
    expect(names(input({ lang: "iw" }))).toContain("Hebrew");
  });

  it("does not guess between Latin-script languages", () => {
    expect(detectLanguageFromText("Ceci est un article en français")).toBeNull();
  });

  it("ignores a short quotation in another script", () => {
    const mostlyEnglish = `${words(200)} שלום`;
    expect(detectLanguageFromText(mostlyEnglish)).toBeNull();
  });

  it("names an unlisted language via Intl", () => {
    expect(languageTagName("sv")).toBe("Swedish");
  });
});

describe("visual content", () => {
  it("tags an embedded player", () => {
    expect(names(input({ hasEmbeddedMedia: true }))).toContain(TAG_VISUAL);
  });

  it("tags a thin page carrying a lead image", () => {
    const result = names(
      input({
        wordCount: 40,
        content: `<p>${words(40)}</p>`,
        leadImageUrl: "https://example.com/hero.jpg",
      }),
    );
    expect(result).toContain(TAG_VISUAL);
  });

  it("tags a link that is itself a video", () => {
    expect(names(input({ url: "https://youtu.be/dQw4w9WgXcQ" }))).toContain(
      TAG_VISUAL,
    );
    expect(
      names(input({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })),
    ).toContain(TAG_VISUAL);
  });

  it("leaves a long illustrated article alone", () => {
    const result = names(
      input({ leadImageUrl: "https://example.com/hero.jpg" }),
    );
    expect(result).not.toContain(TAG_VISUAL);
  });
});

describe("shopping", () => {
  it("tags a product page", () => {
    expect(names(input({ isProduct: true }))).toContain(TAG_SHOPPING);
  });

  it("leaves ordinary articles alone", () => {
    expect(names(input())).not.toContain(TAG_SHOPPING);
  });
});

describe("narratability", () => {
  it("flags a failed extraction", () => {
    expect(
      names(input({ extractionFailed: true, wordCount: 0, content: "" })),
    ).toContain(TAG_WONT_NARRATE);
  });

  it("flags a page with almost no text", () => {
    expect(
      names(input({ wordCount: 12, content: `<p>${words(12)}</p>` })),
    ).toContain(TAG_WONT_NARRATE);
  });

  it("leaves a normal article narratable", () => {
    expect(names(input())).not.toContain(TAG_WONT_NARRATE);
  });

  it("counts narratable words from text, not markup", () => {
    // Plenty of markup, almost no words: still not narratable.
    const markupHeavy = `<div><p><em>${words(5)}</em></p></div>`.repeat(3);
    expect(names(input({ wordCount: 15, content: markupHeavy }))).toContain(
      TAG_WONT_NARRATE,
    );
  });
});

describe("kinds", () => {
  it("labels each tag with its kind", () => {
    const tags = autoTagsFor(
      input({ isProduct: true, hasEmbeddedMedia: true, lang: "he" }),
    );
    const byName = Object.fromEntries(tags.map((t) => [t.name, t.kind]));
    expect(byName[TAG_QUICK_READ]).toBe("LENGTH");
    expect(byName["Hebrew"]).toBe("LANGUAGE");
    expect(byName[TAG_VISUAL]).toBe("FORMAT");
    expect(byName[TAG_SHOPPING]).toBe("SHOPPING");
  });
});
