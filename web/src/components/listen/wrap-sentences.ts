import { segmentSentences } from "@/lib/tts/segment";

/**
 * Wraps the sentences inside a container in indexed spans, so narration has
 * both its units and its highlight targets in one pass.
 *
 * A sentence can span inline elements ("He said <em>hello</em>."), so a chunk
 * stays open across text nodes until a piece ends in sentence-final
 * punctuation or the nearest block ancestor changes. One chunk therefore may
 * own several spans, all highlighted together.
 *
 * Spans carry the *original* source text, not the whitespace-normalized text
 * used for speech. Emitting normalized text would swallow the space in
 * "He said <em>hello</em>" and render it as "He saidhello". The chunk's `text`
 * (what gets spoken) stays normalized; the DOM keeps its exact original bytes,
 * so wrapping is invisible and reversible.
 */

export const CHUNK_ATTR = "data-listen-chunk";

export interface WrappedChunk {
  index: number;
  /** Normalized text for the speech engine. */
  text: string;
  /** Every span belonging to this chunk, in document order. */
  elements: HTMLElement[];
}

/** Content that should not be narrated. Captions interrupt the flow. */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "FIGCAPTION"]);

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "PRE", "FIGURE", "TABLE", "TR", "TD", "TH", "SECTION",
  "ARTICLE", "HEADER", "FOOTER", "ASIDE", "MAIN", "DL", "DT", "DD",
]);

/** Sentence-final punctuation, optionally followed by a closing quote/bracket. */
const SENTENCE_END = /[.!?…。！？]["'”’)\]]?$/;

/** Pieces starting with punctuation join without a leading space. */
const LEADING_PUNCTUATION = /^[.,;:!?…)\]"'”’]/;

const WHITESPACE = /\s/;

function isSkipped(node: Node): boolean {
  let current: Node | null = node.parentNode;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (SKIP_TAGS.has((current as Element).tagName)) return true;
    current = current.parentNode;
  }
  return false;
}

function blockAncestor(node: Node): Node | null {
  let current: Node | null = node.parentNode;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (BLOCK_TAGS.has((current as Element).tagName)) return current;
    current = current.parentNode;
  }
  return current;
}

interface Piece {
  /** Normalized sentence, for speech. */
  normalized: string;
  /** Offsets into the original text node value. */
  start: number;
  end: number;
}

/**
 * Locates each normalized sentence back in the raw text node value.
 *
 * Normalization only ever collapses whitespace runs, so the two strings can be
 * walked in lockstep: a space in the normalized sentence consumes a whitespace
 * run in the raw text, and every other character matches one-for-one.
 */
function locateSentences(raw: string): Piece[] {
  const pieces: Piece[] = [];
  let cursor = 0;

  for (const normalized of segmentSentences(raw)) {
    while (cursor < raw.length && WHITESPACE.test(raw[cursor])) cursor += 1;
    const start = cursor;

    let at = 0;
    while (at < normalized.length && cursor < raw.length) {
      if (WHITESPACE.test(normalized[at])) {
        while (cursor < raw.length && WHITESPACE.test(raw[cursor])) cursor += 1;
        at += 1;
      } else if (raw[cursor] === normalized[at]) {
        cursor += 1;
        at += 1;
      } else {
        // Should not happen; stay in sync with the raw text rather than spin.
        cursor += 1;
      }
    }

    if (cursor > start) pieces.push({ normalized, start, end: cursor });
  }

  return pieces;
}

export function wrapSentences(root: HTMLElement, startIndex = 0): WrappedChunk[] {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      return isSkipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect first: the walk is invalidated by the replacements below.
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  const chunks: WrappedChunk[] = [];
  let nextIndex = startIndex;
  let open: WrappedChunk | null = null;
  let openBlock: Node | null = null;

  for (const textNode of textNodes) {
    const raw = textNode.nodeValue ?? "";
    const pieces = locateSentences(raw);
    if (pieces.length === 0) continue;

    const block = blockAncestor(textNode);
    if (open && block !== openBlock) open = null;

    const fragment = doc.createDocumentFragment();
    let emitted = 0;

    for (const piece of pieces) {
      // Preserve whatever sat between the previous piece and this one.
      if (piece.start > emitted) {
        fragment.appendChild(doc.createTextNode(raw.slice(emitted, piece.start)));
      }

      let chunk: WrappedChunk;
      if (open) {
        chunk = open;
        chunk.text += LEADING_PUNCTUATION.test(piece.normalized)
          ? piece.normalized
          : ` ${piece.normalized}`;
      } else {
        chunk = { index: nextIndex, text: piece.normalized, elements: [] };
        nextIndex += 1;
        chunks.push(chunk);
      }

      const span = doc.createElement("span");
      span.setAttribute(CHUNK_ATTR, String(chunk.index));
      span.textContent = raw.slice(piece.start, piece.end);
      chunk.elements.push(span);
      fragment.appendChild(span);
      emitted = piece.end;

      open = SENTENCE_END.test(piece.normalized) ? null : chunk;
      openBlock = open ? block : null;
    }

    if (emitted < raw.length) {
      fragment.appendChild(doc.createTextNode(raw.slice(emitted)));
    }

    textNode.replaceWith(fragment);
  }

  return chunks;
}

/** Removes the wrapper spans, restoring the container's original markup. */
export function unwrapSentences(root: HTMLElement): void {
  const spans = Array.from(
    root.querySelectorAll<HTMLElement>(`[${CHUNK_ATTR}]`),
  );
  const parents = new Set<Node>();
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    parents.add(parent);
    span.replaceWith(span.ownerDocument.createTextNode(span.textContent ?? ""));
  }
  // Merge the adjacent text nodes left behind, so a repeat wrap segments the
  // same way it did the first time.
  for (const parent of parents) (parent as Element).normalize();
}
