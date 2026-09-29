# Fonts

These four faces are embedded in the PDF export (`src/lib/pdf.ts`). They ship
with the app because PDF's standard 14 fonts are WinAnsi-only, and a real
library is full of Hebrew, curly quotes and em dashes.

They are **subsets** of upstream DejaVu, not the originals: full DejaVu covers
Armenian, Georgian, Arabic, Thaana, braille, box drawing and a great deal more,
none of which any article here has needed. Subsetting takes the four files from
~2.4 MB to ~630 KB. This affects the repository and the container image only —
PDFKit already embeds just the glyphs a given document uses, so the PDFs
themselves were never the larger for it.

## What is kept

Latin and its diacritics, Hebrew (including niqqud and the presentation forms),
general punctuation, the bidi control characters, super/subscripts, currency,
letterlike symbols and number forms, arrows, common maths, and geometric shapes
— that last one because `•` and `◦` are the bullet markers the renderer draws.

**Dropped:** Greek, Cyrillic, Armenian, Georgian, Arabic and the rest. An
article in one of those scripts will render as empty boxes in a PDF; it reads
correctly everywhere else in the app, since only the PDF path uses these files.
Widen the ranges below and re-run if that changes.

`src/lib/fonts.test.ts` asserts the coverage above, so a future re-subset that
quietly drops a glyph fails the suite rather than shipping a PDF full of boxes.
Note that DejaVu Sans **Mono** has no Hebrew upstream and never has — the
renderer falls back to the proportional face for a right-to-left code block.

## Regenerating

```sh
pip install fonttools

RANGES="U+0000-024F,U+0259,U+02B0-02FF,U+0300-036F,\
U+0590-05FF,U+FB1D-FB4F,\
U+2000-206F,U+2070-209F,U+20A0-20BF,\
U+2100-2138,U+2150-215F,U+2190-21FF,U+2200-22FF,\
U+25A0-25FF,U+FEFF"

for f in DejaVuSans DejaVuSans-Bold DejaVuSans-Oblique DejaVuSansMono; do
  pyftsubset "upstream/$f.ttf" --unicodes="$RANGES" --output-file="$f.ttf" \
    --layout-features+=mark,mkmk,ccmp,kern,liga,rlig \
    --name-IDs='*' --notdef-outline --recalc-bounds
done
```

Hinting is deliberately kept (`--no-hinting` would save a further ~115 KB):
PDF viewers use it when rasterizing at small sizes.

Upstream: <https://dejavu-fonts.github.io/> — licence in `LICENSE.txt`
(Bitstream Vera / Arev, which permits redistribution and modification;
subsetting is a modification, and the licence travels with the files).
