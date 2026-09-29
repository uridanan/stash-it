import { JSDOM } from "jsdom";

/**
 * A linear block model of an article body.
 *
 * The PDF renderer needs to lay text out itself — it has no browser to do it —
 * so the sanitized HTML is first flattened into a sequence of blocks with
 * inline runs. Nesting beyond list depth is deliberately discarded: a PDF page
 * has one column and no float, so a `div` inside a `div` carries no meaning
 * once the text is out.
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  /** Absolute href; relative links are dropped, they cannot resolve offline. */
  href?: string;
}

export type Block =
  | { kind: "heading"; level: number; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "quote"; runs: InlineRun[] }
  | { kind: "caption"; runs: InlineRun[] }
  | { kind: "list-item"; marker: string; depth: number; runs: InlineRun[] }
  | { kind: "code"; text: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: "rule" };

const BOLD_TAGS = new Set(["B", "STRONG", "TH"]);
const ITALIC_TAGS = new Set(["I", "EM", "CITE", "Q", "DFN", "VAR"]);
const MONO_TAGS = new Set(["CODE", "KBD", "SAMP", "TT"]);

/** Collapses runs of whitespace the way an HTML renderer would. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

function pushRun(runs: InlineRun[], run: InlineRun) {
  if (!run.text) return;
  const last = runs[runs.length - 1];
  if (
    last &&
    !!last.bold === !!run.bold &&
    !!last.italic === !!run.italic &&
    !!last.mono === !!run.mono &&
    last.href === run.href
  ) {
    last.text += run.text;
    return;
  }
  runs.push({ ...run });
}

function inlineRuns(node: Node, style: Omit<InlineRun, "text"> = {}): InlineRun[] {
  const runs: InlineRun[] = [];

  const walk = (current: Node, inherited: Omit<InlineRun, "text">) => {
    for (const child of Array.from(current.childNodes)) {
      if (child.nodeType === 3) {
        pushRun(runs, { ...inherited, text: collapse(child.textContent ?? "") });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.tagName === "BR") {
        pushRun(runs, { ...inherited, text: " " });
        continue;
      }
      const next: Omit<InlineRun, "text"> = { ...inherited };
      if (BOLD_TAGS.has(el.tagName)) next.bold = true;
      if (ITALIC_TAGS.has(el.tagName)) next.italic = true;
      if (MONO_TAGS.has(el.tagName)) next.mono = true;
      if (el.tagName === "A") {
        const href = el.getAttribute("href") ?? "";
        if (/^(https?:|mailto:)/i.test(href)) next.href = href;
      }
      walk(el, next);
    }
  };

  walk(node, style);

  // Trim the edges without losing the single spaces that separate runs.
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  }
  return runs.filter((run) => run.text.length > 0);
}

export function runsToText(runs: readonly InlineRun[]): string {
  return runs.map((run) => run.text).join("");
}

/** Flattens sanitized article HTML into the block list the PDF renderer walks. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  if (!html.trim()) return blocks;

  const { document } = new JSDOM(`<body>${html}</body>`).window;

  const emit = (block: Block) => {
    if ("runs" in block && block.runs.length === 0) return;
    blocks.push(block);
  };

  const walkList = (list: Element, depth: number) => {
    const ordered = list.tagName === "OL";
    let index = 1;
    for (const item of Array.from(list.children)) {
      if (item.tagName !== "LI") continue;
      const nested = Array.from(item.children).filter(
        (child) => child.tagName === "UL" || child.tagName === "OL",
      );
      const marker = ordered ? `${index++}.` : depth % 2 === 0 ? "•" : "◦";
      // Read the item's own text before recursing, or nested items would be
      // counted twice — once here and once as their own list-item block.
      const clone = item.cloneNode(true) as Element;
      for (const child of Array.from(clone.children)) {
        if (child.tagName === "UL" || child.tagName === "OL") child.remove();
      }
      emit({ kind: "list-item", marker, depth, runs: inlineRuns(clone) });
      for (const sublist of nested) walkList(sublist, depth + 1);
    }
  };

  const walk = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) {
        const text = collapse(node.textContent ?? "").trim();
        if (text) emit({ kind: "paragraph", runs: [{ text }] });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;

      switch (el.tagName) {
        case "H1":
        case "H2":
        case "H3":
        case "H4":
        case "H5":
        case "H6":
          emit({
            kind: "heading",
            level: Number(el.tagName[1]),
            runs: inlineRuns(el),
          });
          break;
        case "P":
          emit({ kind: "paragraph", runs: inlineRuns(el) });
          break;
        case "BLOCKQUOTE":
          emit({ kind: "quote", runs: inlineRuns(el) });
          break;
        case "PRE": {
          const text = (el.textContent ?? "").replace(/\s+$/, "");
          if (text.trim()) emit({ kind: "code", text });
          break;
        }
        case "UL":
        case "OL":
          walkList(el, 0);
          break;
        case "DL": {
          for (const child of Array.from(el.children)) {
            if (child.tagName === "DT") {
              emit({ kind: "paragraph", runs: inlineRuns(child, { bold: true }) });
            } else if (child.tagName === "DD") {
              emit({ kind: "list-item", marker: "", depth: 0, runs: inlineRuns(child) });
            }
          }
          break;
        }
        case "HR":
          blocks.push({ kind: "rule" });
          break;
        case "IMG": {
          const src = el.getAttribute("src") ?? "";
          emit({ kind: "image", src, alt: el.getAttribute("alt") ?? "" });
          break;
        }
        case "FIGCAPTION":
        case "CAPTION":
          emit({ kind: "caption", runs: inlineRuns(el) });
          break;
        case "TABLE": {
          // One row per line, cells joined — a real table needs a column
          // layout engine, and every article table met so far is a data dump.
          for (const row of Array.from(el.querySelectorAll("tr"))) {
            const cells = Array.from(row.children).map((cell) =>
              collapse(cell.textContent ?? "").trim(),
            );
            const text = cells.filter(Boolean).join("  |  ");
            if (text) {
              const header = row.querySelector("th") !== null;
              emit({
                kind: "paragraph",
                runs: [header ? { text, bold: true } : { text }],
              });
            }
          }
          break;
        }
        default:
          walk(el);
      }
    }
  };

  walk(document.body);
  return blocks;
}
