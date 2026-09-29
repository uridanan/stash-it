// @vitest-environment node
//
// Coverage of the shipped fonts, which are subsets (see public/fonts/README.md).
// A subset is a decision about what an article is allowed to contain, and a
// missing glyph does not throw — it prints an empty box in a PDF nobody looks
// at until later. So the decision is pinned here.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

// fontkit is CommonJS with named exports and no default, which an ESM default
// import resolves to undefined. It arrives with pdfkit; nothing else uses it.
const fontkit = createRequire(import.meta.url)("fontkit") as {
  create(buffer: Buffer): { hasGlyphForCodePoint(codePoint: number): boolean };
};

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

/** The proportional faces. Mono is deliberately excluded — see below. */
const TEXT_FACES = [
  "DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSans-Oblique.ttf",
] as const;

function load(file: string) {
  return fontkit.create(readFileSync(path.join(FONT_DIR, file)));
}

function missing(file: string, text: string): string[] {
  const font = load(file);
  return [...text]
    .filter((char) => char !== " " && !font.hasGlyphForCodePoint(char.codePointAt(0)!))
    .map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
}

/** Everything a real article — or the renderer itself — is known to use. */
const REQUIRED: Record<string, string> = {
  latin: "The quick brown fox 0123456789",
  "latin accents": "éüñçøåßÆœ",
  hebrew: "אבגדהוזחטיכךלמםנןסעפףצץקרשת",
  "hebrew niqqud": "בְּרֵאשִׁית",
  "hebrew presentation": "ﬠﬡﬢ",
  punctuation: "—–‘’“”…‹›«»",
  "byline and list markers": "·•◦|/",
  "bidi controls": "‎‏‪‫‬",
  currency: "$€£₪¥",
  math: "×÷±≈≤≥−",
  arrows: "←→↑↓",
  "letterlike and fractions": "™№½¼¾",
  "super and subscript": "²³₂₃",
};

describe("shipped fonts", () => {
  for (const face of TEXT_FACES) {
    describe(face, () => {
      for (const [group, text] of Object.entries(REQUIRED)) {
        it(`covers ${group}`, () => {
          expect(missing(face, text)).toEqual([]);
        });
      }
    });
  }

  describe("DejaVuSansMono.ttf", () => {
    it("covers what a code block needs", () => {
      expect(
        missing("DejaVuSansMono.ttf", "const x = 1; // ¬±≤ «quoted» — ok"),
      ).toEqual([]);
    });

    it("has no Hebrew, which is why RTL code falls back to the text face", () => {
      // Upstream DejaVu Sans Mono has never had Hebrew; this is not something
      // subsetting removed. `drawBlock` checks direction for exactly this.
      expect(load("DejaVuSansMono.ttf").hasGlyphForCodePoint(0x05d0)).toBe(false);
    });
  });

  it("stays small — the subset is the reason the fonts can ship at all", () => {
    const total = [...TEXT_FACES, "DejaVuSansMono.ttf"].reduce(
      (sum, file) => sum + readFileSync(path.join(FONT_DIR, file)).length,
      0,
    );
    // Full DejaVu is ~2.4 MB for these four faces. Well under 1 MB means the
    // subset is still applied; re-vendoring the full files would trip this.
    expect(total).toBeLessThan(1_000_000);
  });
});
