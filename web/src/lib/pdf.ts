import { readFileSync } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";
import bidiFactory from "bidi-js";

import { htmlToBlocks, runsToText, type Block, type InlineRun } from "@/lib/doc-blocks";

/**
 * Article → PDF.
 *
 * PDFKit has no HTML renderer, so the body is flattened to blocks
 * (`doc-blocks.ts`) and laid out here. Two things drove the shape of this:
 *
 * - **Fonts are embedded, not built in.** PDF's standard 14 fonts are
 *   WinAnsi-only, and a real library is full of Hebrew, curly quotes and
 *   em dashes. DejaVu ships with the app (`public/fonts`) and covers Latin,
 *   Greek, Cyrillic and Hebrew.
 * - **Right-to-left text needs its own line breaker.** PDF stores glyphs in
 *   visual order and PDFKit does no bidi, so an RTL paragraph is wrapped here
 *   first — in logical order, which is the only order the line breaks are
 *   correct in — and each finished line is then reordered for display.
 *
 * Images are not fetched: a PDF export must not turn into a crawl of every
 * host an article links to. They appear as a caption line instead.
 */

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

type FontKey = "regular" | "bold" | "italic" | "mono";

const FONT_FILES: Record<FontKey, string> = {
  regular: "DejaVuSans.ttf",
  bold: "DejaVuSans-Bold.ttf",
  italic: "DejaVuSans-Oblique.ttf",
  mono: "DejaVuSansMono.ttf",
};

const fontCache = new Map<FontKey, Buffer>();

function font(key: FontKey): Buffer {
  const cached = fontCache.get(key);
  if (cached) return cached;
  const buffer = readFileSync(path.join(FONT_DIR, FONT_FILES[key]));
  fontCache.set(key, buffer);
  return buffer;
}

const bidi = bidiFactory();

// Hebrew, Arabic, Syriac, Thaana and their presentation forms.
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_CHARS = /[A-Za-zÀ-ɏͰ-֏]/g;

/** Which way a block reads, decided by which script owns most of its letters. */
export function isRtl(text: string): boolean {
  const rtl = text.match(RTL_CHARS)?.length ?? 0;
  if (rtl === 0) return false;
  const ltr = text.match(LTR_CHARS)?.length ?? 0;
  return rtl > ltr;
}

export interface PdfArticle {
  title: string;
  url: string;
  siteName: string | null;
  author: string | null;
  content: string;
  summary: string | null;
  savedAt: Date;
  publishedAt: Date | null;
  readingMinutes: number;
  tags: readonly string[];
}

const PAGE_MARGIN = 56;
const BODY_SIZE = 11;
const LINE_GAP = 3;

const HEADING_SIZE: Record<number, number> = {
  1: 19,
  2: 16,
  3: 14,
  4: 12.5,
  5: 11.5,
  6: 11,
};

const INK = "#1e293b"; // slate-800
const MUTED = "#64748b"; // slate-500
const ACCENT = "#6d28d9"; // violet-700
const RULE = "#cbd5e1"; // slate-300

type Doc = InstanceType<typeof PDFDocument>;

function fontFor(run: InlineRun): FontKey {
  if (run.mono) return "mono";
  if (run.bold) return "bold";
  if (run.italic) return "italic";
  return "regular";
}

/**
 * Wraps logical-order text to a width, then hands back display-order lines.
 *
 * Breaking first and reordering afterwards is the whole point: reordering a
 * whole RTL paragraph up front and letting a left-to-right wrapper loose on it
 * puts the lines themselves in the wrong sequence.
 */
function rtlLines(doc: Doc, text: string, width: number, size: number): string[] {
  doc.font("regular").fontSize(size);
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    if (!current) return;
    const levels = bidi.getEmbeddingLevels(current, "rtl");
    lines.push(bidi.getReorderedString(current, levels));
    current = "";
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (doc.widthOfString(candidate) <= width || !current) {
      current = candidate;
      continue;
    }
    flush();
    current = word;
  }
  flush();
  return lines;
}

interface DrawOptions {
  x: number;
  width: number;
  size: number;
  color?: string;
  /** Font used for runs with no emphasis of their own. */
  base?: FontKey;
  align?: "left" | "right";
}

/** Draws one block's inline runs, honouring emphasis, links and direction. */
function drawRuns(doc: Doc, runs: readonly InlineRun[], options: DrawOptions) {
  const { x, width, size, color = INK, base = "regular" } = options;
  const text = runsToText(runs);
  if (!text.trim()) return;

  if (isRtl(text)) {
    // Emphasis and links are dropped here on purpose: mixing fonts inside a
    // line would require measuring each reordered fragment separately, and
    // getting the line breaks right matters far more than a bold word.
    const lines = rtlLines(doc, text, width, size);
    doc.fillColor(color).font(base).fontSize(size);
    for (const line of lines) {
      doc.text(line, x, doc.y, {
        width,
        align: "right",
        lineBreak: false,
        lineGap: LINE_GAP,
      });
    }
    doc.fillColor(INK);
    return;
  }

  const align = options.align ?? "left";
  runs.forEach((run, index) => {
    const key = base === "regular" ? fontFor(run) : run.mono ? "mono" : base;
    const continued = index < runs.length - 1;
    doc
      .font(key)
      .fontSize(size)
      .fillColor(run.href ? ACCENT : color);
    const opts = {
      width,
      align,
      continued,
      lineGap: LINE_GAP,
      underline: Boolean(run.href),
      link: run.href ?? undefined,
    };
    if (index === 0) {
      doc.text(run.text, x, doc.y, opts);
    } else {
      doc.text(run.text, opts);
    }
  });
  doc.fillColor(INK);
}

function drawBlock(doc: Doc, block: Block, left: number, contentWidth: number) {
  switch (block.kind) {
    case "heading": {
      const size = HEADING_SIZE[block.level] ?? BODY_SIZE;
      doc.moveDown(block.level <= 2 ? 0.9 : 0.7);
      drawRuns(doc, block.runs, { x: left, width: contentWidth, size, base: "bold" });
      doc.moveDown(0.3);
      break;
    }
    case "paragraph":
      drawRuns(doc, block.runs, { x: left, width: contentWidth, size: BODY_SIZE });
      doc.moveDown(0.6);
      break;
    case "caption":
      drawRuns(doc, block.runs, {
        x: left,
        width: contentWidth,
        size: BODY_SIZE - 1.5,
        color: MUTED,
        base: "italic",
      });
      doc.moveDown(0.6);
      break;
    case "quote": {
      const inset = 16;
      const top = doc.y;
      drawRuns(doc, block.runs, {
        x: left + inset,
        width: contentWidth - inset,
        size: BODY_SIZE,
        color: MUTED,
        base: "italic",
      });
      doc
        .save()
        .lineWidth(2)
        .strokeColor(RULE)
        .moveTo(left + 3, top)
        .lineTo(left + 3, doc.y)
        .stroke()
        .restore();
      doc.moveDown(0.6);
      break;
    }
    case "list-item": {
      const inset = 18 * (block.depth + 1);
      const y = doc.y;
      if (block.marker) {
        doc
          .font("regular")
          .fontSize(BODY_SIZE)
          .fillColor(MUTED)
          .text(block.marker, left + inset - 16, y, { width: 14, lineBreak: false });
        doc.y = y;
      }
      drawRuns(doc, block.runs, {
        x: left + inset,
        width: contentWidth - inset,
        size: BODY_SIZE,
      });
      doc.moveDown(0.25);
      break;
    }
    case "code": {
      const padding = 8;
      const top = doc.y;
      doc
        // DejaVu Sans Mono has no Hebrew — it never did, subsetting or not —
        // so an RTL code block falls back to the proportional face rather
        // than printing a row of empty boxes.
        .font(isRtl(block.text) ? "regular" : "mono")
        .fontSize(BODY_SIZE - 1.5)
        .fillColor(INK)
        .text(block.text, left + padding, top + padding, {
          width: contentWidth - padding * 2,
          lineGap: 1,
        });
      const bottom = doc.y + padding;
      doc
        .save()
        .lineWidth(1)
        .strokeColor(RULE)
        .rect(left, top, contentWidth, bottom - top)
        .stroke()
        .restore();
      doc.y = bottom;
      doc.moveDown(0.6);
      break;
    }
    case "image": {
      const label = block.alt.trim() ? `[image: ${block.alt.trim()}]` : "[image]";
      doc
        .font("italic")
        .fontSize(BODY_SIZE - 1.5)
        .fillColor(MUTED)
        .text(label, left, doc.y, {
          width: contentWidth,
          link: block.src || undefined,
        });
      doc.fillColor(INK);
      doc.moveDown(0.6);
      break;
    }
    case "rule":
      doc.moveDown(0.4);
      doc
        .save()
        .lineWidth(1)
        .strokeColor(RULE)
        .moveTo(left, doc.y)
        .lineTo(left + contentWidth, doc.y)
        .stroke()
        .restore();
      doc.moveDown(0.6);
      break;
  }
}

function byline(article: PdfArticle): string {
  const date = article.publishedAt ?? article.savedAt;
  const bits = [
    article.siteName,
    article.author,
    `${article.readingMinutes} min read`,
    Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
  ].filter(Boolean);
  return bits.join(" · ");
}

/** Renders one article as a PDF document. */
export function buildPdf(article: PdfArticle): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    // Named up front so PDFKit never reaches for a standard font it cannot
    // render our text with. The same file is registered below under a name,
    // which is what every later font switch uses: passing a Buffer instead
    // makes PDFKit re-parse the whole TTF on every switch.
    font: path.join(FONT_DIR, FONT_FILES.regular),
    // Every value here must be defined. PDFKit walks `info` to build the
    // document's file identifier and calls `.valueOf()` on each value, so a
    // single `undefined` — an article with no author and no site name — throws
    // rather than being skipped.
    info: {
      Title: article.title,
      ...(article.author || article.siteName
        ? { Author: article.author ?? article.siteName ?? "" }
        : {}),
      Subject: article.url,
      Creator: "Stash",
    },
  });

  for (const key of Object.keys(FONT_FILES) as FontKey[]) {
    doc.registerFont(key, font(key));
  }
  doc.font("regular");

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE_MARGIN;
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;

  drawRuns(doc, [{ text: article.title }], {
    x: left,
    width: contentWidth,
    size: 22,
    base: "bold",
  });
  doc.moveDown(0.35);

  drawRuns(doc, [{ text: byline(article) }], {
    x: left,
    width: contentWidth,
    size: 9.5,
    color: MUTED,
  });
  if (article.tags.length) {
    drawRuns(doc, [{ text: article.tags.join(" · ") }], {
      x: left,
      width: contentWidth,
      size: 9.5,
      color: MUTED,
    });
  }
  drawRuns(doc, [{ text: article.url, href: article.url }], {
    x: left,
    width: contentWidth,
    size: 9.5,
  });

  doc.moveDown(0.8);
  doc
    .save()
    .lineWidth(1)
    .strokeColor(RULE)
    .moveTo(left, doc.y)
    .lineTo(left + contentWidth, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.9);

  if (article.summary?.trim()) {
    drawRuns(doc, [{ text: "AI summary" }], {
      x: left,
      width: contentWidth,
      size: 10,
      color: ACCENT,
      base: "bold",
    });
    doc.moveDown(0.4);
    for (const line of article.summary.trim().split("\n")) {
      if (!line.trim()) continue;
      drawRuns(doc, [{ text: line.trim() }], {
        x: left,
        width: contentWidth,
        size: BODY_SIZE - 1,
        color: MUTED,
      });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.8);
  }

  const blocks = htmlToBlocks(article.content);
  if (blocks.length === 0) {
    drawRuns(
      doc,
      [
        { text: "No article text was saved. Read it at the source: " },
        { text: article.url, href: article.url },
      ],
      { x: left, width: contentWidth, size: BODY_SIZE, color: MUTED, base: "italic" },
    );
  }
  for (const block of blocks) {
    drawBlock(doc, block, left, contentWidth);
  }

  // Page numbers, stamped once the page count is known. The footer sits below
  // the bottom margin, and PDFKit would add a fresh page rather than write
  // there — so the margin is dropped for the duration of the stamping.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .font("regular")
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        `${i - range.start + 1} / ${range.count}`,
        left,
        doc.page.height - PAGE_MARGIN + 18,
        { width: contentWidth, align: "center", lineBreak: false },
      );
  }
  doc.flushPages();

  doc.end();
  return done;
}
