# Listen to Article (TTS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader listen to a saved article, narrating whatever the reader currently has on screen, with a docked player offering play/pause, stop, rewind 10s, and speed.

**Architecture:** Browser-native `speechSynthesis` sits behind a `TtsEngine` interface so a cloud engine can replace it later with no UI rework. Article HTML is walked into sentence chunks wrapped in `<span data-listen-chunk="N">`, which gives both the narration units and the highlight targets. A client `ListenProvider` owns playback state and picks its narration sources by reading `[data-listen]` containers in DOM order — so "what is on screen" is the single source of truth.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript, Tailwind v4, `Intl.Segmenter`, Web Speech API, vitest (new), Playwright (existing).

Spec: `docs/superpowers/specs/2026-08-13-listen-to-article-design.md`

## Global Constraints

- All paths in this plan are relative to `ai-reader/fable/web/` unless stated otherwise. The git repo root is `D:/Github/uri-playground`; run `git` from anywhere inside it.
- **The player must never touch `speechSynthesis` directly.** All engine access goes through the `TtsEngine` interface. Anything the native engine can only approximate is gated on `engine.capabilities`, never hardcoded.
- Sentence chunk indices are contiguous from 0 and always equal their array position. Every module may rely on this.
- No database migration. Voice and rate persist to `localStorage` only, matching `reader-controls.tsx`.
- localStorage keys: `stash:tts-voice`, `stash:tts-rate`. Always wrap access in `try/catch` — private mode throws.
- Speed values are exactly `0.75, 1, 1.25, 1.5, 1.75, 2`.
- Palette: violet is the accent (`violet-600` active, `violet-100` highlight wash), slate is the neutral. Match the existing components; do not introduce new colors.
- Unit test files are colocated as `src/**/*.test.ts`. Playwright's `testDir` is `./e2e`, so there is no collision.
- Run `npx tsc --noEmit` and `npm run lint` before each commit. Both must be clean.

---

### Task 1: vitest harness + sentence segmentation

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/tts/segment.ts`
- Test: `src/lib/tts/segment.test.ts`
- Modify: `package.json` (devDependency + `test:unit` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `segmentSentences(text: string): string[]` and `MAX_CHUNK_CHARS: number` from `@/lib/tts/segment`.

**Why a guard for abbreviations:** `Intl.Segmenter` uses ICU sentence-break rules, which do **not** apply abbreviation suppressions in V8 — `"Dr. Smith left."` segments into two. We post-process to merge those back. Test our guard, not ICU's behavior.

- [ ] **Step 1: Add vitest and the config**

```bash
npm install --save-dev vitest
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests only (colocated `src/**\/*.test.ts`). The e2e suite is Playwright
 * and lives in ./e2e — it boots a Next server and resets a database, which
 * pure-function tests have no business paying for.
 *
 * `process.cwd()` rather than `__dirname`: this config is ESM and the path
 * must stay correct on Windows.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
});
```

Add to `package.json` `scripts`:

```json
"test:unit": "vitest run",
"test:unit:watch": "vitest"
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/tts/segment.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { MAX_CHUNK_CHARS, segmentSentences } from "@/lib/tts/segment";

describe("segmentSentences", () => {
  it("splits plain sentences", () => {
    expect(segmentSentences("One thing. Two things! Three?")).toEqual([
      "One thing.",
      "Two things!",
      "Three?",
    ]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(segmentSentences("")).toEqual([]);
    expect(segmentSentences("   \n\t ")).toEqual([]);
  });

  it("collapses newlines and runs of whitespace", () => {
    expect(segmentSentences("One\n\n  thing.")).toEqual(["One thing."]);
  });

  it("does not split after a titular abbreviation", () => {
    expect(segmentSentences("Dr. Smith left. Then he arrived.")).toEqual([
      "Dr. Smith left.",
      "Then he arrived.",
    ]);
  });

  it("does not split after initials", () => {
    expect(segmentSentences("J. R. R. Tolkien wrote it. It sold well.")).toEqual([
      "J. R. R. Tolkien wrote it.",
      "It sold well.",
    ]);
  });

  it("does not split after e.g. or i.e.", () => {
    expect(segmentSentences("Use fruit, e.g. apples. Not rocks.")).toEqual([
      "Use fruit, e.g. apples.",
      "Not rocks.",
    ]);
  });

  it("splits an over-long sentence at clause boundaries", () => {
    const clause = "a".repeat(60);
    const long = `${clause}, ${clause}, ${clause}, ${clause}, ${clause}.`;
    const parts = segmentSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("hard-splits a long run with no clause boundaries", () => {
    const words = Array.from({ length: 120 }, () => "word").join(" ");
    const parts = segmentSentences(`${words}.`);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("segments CJK sentences on the ideographic full stop", () => {
    expect(segmentSentences("これは一つ目です。これは二つ目です。")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `@/lib/tts/segment`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/tts/segment.ts`:

```ts
/**
 * Text → sentence chunks for narration.
 *
 * `Intl.Segmenter` does the segmentation (no dependency, and better than any
 * regex at the general case), but ICU sentence-break rules in V8 do not apply
 * abbreviation suppressions — "Dr. Smith left." would become two sentences.
 * ABBREVIATIONS below merges those back.
 *
 * Chunks double as rewind granularity and as highlight units, so very long
 * sentences are split at clause boundaries.
 */

/** Longest chunk handed to a speech engine. */
export const MAX_CHUNK_CHARS = 280;

/** Words that end in a period without ending a sentence. Lowercased, no trailing dot. */
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "vs", "etc",
  "e.g", "i.e", "inc", "ltd", "co", "no", "fig", "approx", "dept",
  "est", "min", "max", "al", "jan", "feb", "mar", "apr", "jun",
  "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** True when the segment's final word is an abbreviation or a single initial. */
function endsWithAbbreviation(sentence: string): boolean {
  const match = sentence.match(/(?:^|\s)([A-Za-z][A-Za-z.]*)\.$/);
  if (!match) return false;
  const word = match[1].toLowerCase();
  return ABBREVIATIONS.has(word) || /^[a-z]$/.test(word);
}

export function segmentSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const raw: string[] = [];
  for (const { segment } of segmenter.segment(normalized)) {
    const sentence = segment.trim();
    if (sentence) raw.push(sentence);
  }

  // Merge segments that ICU split on an abbreviation's period.
  const merged: string[] = [];
  for (const sentence of raw) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && endsWithAbbreviation(previous)) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }

  return merged.flatMap(splitLongSentence);
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];

  const parts: string[] = [];
  let current = "";
  for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
    if (current && `${current} ${clause}`.length > MAX_CHUNK_CHARS) {
      parts.push(current);
      current = clause;
    } else {
      current = current ? `${current} ${clause}` : clause;
    }
  }
  if (current) parts.push(current);

  // A single clause can still exceed the cap on its own.
  return parts.flatMap((part) =>
    part.length <= MAX_CHUNK_CHARS ? [part] : hardSplit(part),
  );
}

/** Last-resort split, preferring a word boundary near the cap. */
function hardSplit(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
    const cut = space > MAX_CHUNK_CHARS / 2 ? space : MAX_CHUNK_CHARS;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS, 9 tests.

If the CJK case fails, jsdom's ICU build lacks full data. Do **not** delete the assertion — run `npx vitest run src/lib/tts/segment.test.ts --environment node` to confirm it is an environment gap, then note it in the test with `it.skip` and a one-line comment saying why.

- [ ] **Step 6: Verify types and lint, then commit**

```bash
npx tsc --noEmit && npm run lint
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/lib/tts/
git commit -m "feat(tts): add vitest harness and sentence segmentation"
```

---

### Task 2: wrap article HTML into sentence spans

**Files:**
- Create: `src/components/listen/wrap-sentences.ts`
- Test: `src/components/listen/wrap-sentences.test.ts`

**Interfaces:**
- Consumes: `segmentSentences` from `@/lib/tts/segment`.
- Produces, from `@/components/listen/wrap-sentences`:
  - `CHUNK_ATTR = "data-listen-chunk"`
  - `interface WrappedChunk { index: number; text: string; elements: HTMLElement[] }`
  - `wrapSentences(root: HTMLElement, startIndex?: number): WrappedChunk[]`
  - `unwrapSentences(root: HTMLElement): void`

**The hard case** is a sentence spanning inline elements — `He said <em>hello</em>. Then left.` is three text nodes but two sentences. Rule: a chunk stays open across text nodes until a piece ends in sentence-final punctuation, or until the nearest block-level ancestor changes. One chunk may own several spans; they all highlight together.

- [ ] **Step 1: Write the failing test**

Create `src/components/listen/wrap-sentences.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/listen/wrap-sentences.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `src/components/listen/wrap-sentences.ts`:

```ts
import { segmentSentences } from "@/lib/tts/segment";

/**
 * Wraps the sentences inside a container in indexed spans, so narration has
 * both its units and its highlight targets in one pass.
 *
 * A sentence can span inline elements ("He said <em>hello</em>."), so a chunk
 * stays open across text nodes until a piece ends in sentence-final
 * punctuation or the nearest block ancestor changes. One chunk therefore may
 * own several spans, all highlighted together.
 */

export const CHUNK_ATTR = "data-listen-chunk";

export interface WrappedChunk {
  index: number;
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
    const block = blockAncestor(textNode);
    if (open && block !== openBlock) open = null;

    const sentences = segmentSentences(textNode.nodeValue ?? "");
    if (sentences.length === 0) continue;

    const fragment = doc.createDocumentFragment();
    for (const sentence of sentences) {
      let chunk: WrappedChunk;
      if (open) {
        chunk = open;
        chunk.text += LEADING_PUNCTUATION.test(sentence)
          ? sentence
          : ` ${sentence}`;
      } else {
        chunk = { index: nextIndex, text: sentence, elements: [] };
        nextIndex += 1;
        chunks.push(chunk);
      }

      const span = doc.createElement("span");
      span.setAttribute(CHUNK_ATTR, String(chunk.index));
      span.textContent = sentence;
      chunk.elements.push(span);
      fragment.appendChild(span);

      open = SENTENCE_END.test(sentence) ? null : chunk;
      openBlock = open ? block : null;
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
    span.replaceWith(
      span.ownerDocument.createTextNode(span.textContent ?? ""),
    );
  }
  // Merge the adjacent text nodes left behind, so a repeat wrap segments the
  // same way it did the first time.
  for (const parent of parents) (parent as Element).normalize();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/listen/wrap-sentences.test.ts`
Expected: PASS, 9 tests.

The `unwrapSentences` round-trip test is the strict one. If `innerHTML` differs only by whitespace between sentences (`"One thing. Two things."` vs `"One thing.Two things."`), the join in `wrapSentences` dropped a separator — fix the wrapping so each span's `textContent` preserves the spacing that was in the source, rather than loosening the test.

- [ ] **Step 5: Verify types and lint, then commit**

```bash
npx tsc --noEmit && npm run lint
git add web/src/components/listen/
git commit -m "feat(tts): wrap article sentences into indexed spans"
```

---

### Task 3: rewind estimate

**Files:**
- Create: `src/lib/tts/rewind.ts`
- Test: `src/lib/tts/rewind.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `@/lib/tts/rewind`: `WORDS_PER_SECOND_AT_1X`, `estimateChunkSeconds(text, rate)`, `rewindTarget(chunks, currentIndex, elapsedMs, rate, seconds?)`.

The native engine cannot seek, so "back 10 seconds" is computed from estimated chunk durations. This lives in its own pure module precisely because it is guesswork that needs pinning down with tests.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tts/rewind.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { estimateChunkSeconds, rewindTarget } from "@/lib/tts/rewind";

/** ~10 words ≈ 3.7s at 1x. */
const chunk = { text: "one two three four five six seven eight nine ten" };
const chunks = [chunk, chunk, chunk, chunk, chunk, chunk];

describe("estimateChunkSeconds", () => {
  it("scales inversely with rate", () => {
    const atOne = estimateChunkSeconds(chunk.text, 1);
    const atTwo = estimateChunkSeconds(chunk.text, 2);
    expect(atTwo).toBeCloseTo(atOne / 2, 5);
  });

  it("returns zero for empty text", () => {
    expect(estimateChunkSeconds("   ", 1)).toBe(0);
  });
});

describe("rewindTarget", () => {
  it("stays in the current chunk when enough time has already elapsed", () => {
    expect(rewindTarget(chunks, 3, 12_000, 1)).toBe(3);
  });

  it("walks back over earlier chunks when little has elapsed", () => {
    // 10s of 3.7s chunks ≈ 3 chunks back.
    expect(rewindTarget(chunks, 5, 0, 1)).toBe(2);
  });

  it("walks back further at a higher rate, since chunks are shorter", () => {
    const atOne = rewindTarget(chunks, 5, 0, 1);
    const atTwo = rewindTarget(chunks, 5, 0, 2);
    expect(atTwo).toBeLessThan(atOne);
  });

  it("clamps at the first chunk", () => {
    expect(rewindTarget(chunks, 1, 0, 1)).toBe(0);
    expect(rewindTarget(chunks, 0, 0, 1)).toBe(0);
  });

  it("honours a custom window", () => {
    expect(rewindTarget(chunks, 5, 0, 1, 4)).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tts/rewind.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `src/lib/tts/rewind.ts`:

```ts
/**
 * Rewind for engines that cannot seek.
 *
 * The Web Speech API exposes no playback position, so "back 10 seconds" is
 * estimated from chunk word counts and restarted at a chunk boundary. A cloud
 * engine reporting `capabilities.exactSeek` does a real seek instead and never
 * calls this.
 */

/** Rough conversational narration speed at 1x. */
export const WORDS_PER_SECOND_AT_1X = 2.7;

export function estimateChunkSeconds(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return words / (WORDS_PER_SECOND_AT_1X * Math.max(rate, 0.1));
}

/**
 * The chunk index to restart from to move back roughly `seconds`. Time already
 * spent in the current chunk counts toward the window, so an early press moves
 * back further than a late one.
 */
export function rewindTarget(
  chunks: readonly { text: string }[],
  currentIndex: number,
  elapsedMs: number,
  rate: number,
  seconds = 10,
): number {
  let remaining = seconds - elapsedMs / 1000;
  if (remaining <= 0) return currentIndex;

  let index = currentIndex;
  while (index > 0 && remaining > 0) {
    index -= 1;
    remaining -= estimateChunkSeconds(chunks[index].text, rate);
  }
  return index;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tts/rewind.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify types and lint, then commit**

```bash
npx tsc --noEmit && npm run lint
git add web/src/lib/tts/
git commit -m "feat(tts): estimate rewind target for non-seeking engines"
```

---

### Task 4: the engine seam and the Web Speech engine

**Files:**
- Create: `src/lib/tts/engine.ts`
- Create: `src/lib/tts/web-speech-engine.ts`
- Create: `src/lib/tts/fake-speech.ts` (test helper, imported only by tests)
- Test: `src/lib/tts/web-speech-engine.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `@/lib/tts/engine`: `TtsChunk`, `TtsVoice`, `TtsEvents`, `TtsPlayOptions`, `TtsEngine`.
- Produces, from `@/lib/tts/web-speech-engine`: `isSpeechSupported(): boolean`, `createWebSpeechEngine(): TtsEngine`.
- Produces, from `@/lib/tts/fake-speech`: `installFakeSpeech(options?): FakeSpeech`.

**Browser quirks this module exists to hide** — every one is load-bearing:
- `getVoices()` is empty on the first call in Chrome; voices arrive with `voiceschanged`.
- `cancel()` fires `onend`/`onerror` on the utterance in some browsers, so stale handlers must be ignored — hence the generation counter.
- `pause()` is silently ignored on Android Chrome; verify and fall back to cancel-and-remember.
- Rate cannot change mid-utterance; restart the current chunk.

- [ ] **Step 1: Write the fake and the failing test**

Create `src/lib/tts/fake-speech.ts`:

```ts
/**
 * A `speechSynthesis` stand-in for tests. Headless browsers and jsdom have no
 * speech engine at all, so the real API cannot be exercised anywhere in CI.
 *
 * Utterances complete when `finishCurrent()` is called, keeping tests
 * deterministic rather than timer-dependent.
 */

interface FakeUtterance {
  text: string;
  rate: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

export interface FakeSpeech {
  spoken: string[];
  rates: number[];
  paused: boolean;
  cancelled: number;
  /** Completes the in-flight utterance, as the browser would. */
  finishCurrent(): void;
  /** Fails the in-flight utterance. */
  failCurrent(error: string): void;
  /** Publishes a voice list and fires `voiceschanged`. */
  publishVoices(voices: { name: string; lang: string; voiceURI: string }[]): void;
  /** Makes `pause()` a no-op, as Android Chrome does. */
  breakPause(): void;
  restore(): void;
}

export function installFakeSpeech(
  options: { voices?: { name: string; lang: string; voiceURI: string }[] } = {},
): FakeSpeech {
  const listeners: (() => void)[] = [];
  let voices = options.voices ?? [];
  let current: FakeUtterance | null = null;
  let pauseWorks = true;

  const state: FakeSpeech = {
    spoken: [],
    rates: [],
    paused: false,
    cancelled: 0,
    finishCurrent() {
      const utterance = current;
      current = null;
      utterance?.onend?.();
    },
    failCurrent(error) {
      const utterance = current;
      current = null;
      utterance?.onerror?.({ error });
    },
    publishVoices(next) {
      voices = next;
      for (const listener of [...listeners]) listener();
    },
    breakPause() {
      pauseWorks = false;
    },
    restore() {
      Reflect.deleteProperty(window, "speechSynthesis");
      Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
    },
  };

  class FakeSpeechSynthesisUtterance implements FakeUtterance {
    text: string;
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  const synth = {
    get paused() {
      return state.paused;
    },
    getVoices: () => voices,
    speak(utterance: FakeUtterance) {
      current = utterance;
      state.spoken.push(utterance.text);
      state.rates.push(utterance.rate);
    },
    cancel() {
      state.cancelled += 1;
      state.paused = false;
      // `current` is deliberately NOT cleared: real browsers fire onend for
      // the cancelled utterance, which is exactly what the engine's
      // generation guard has to survive.
    },
    pause() {
      if (pauseWorks) state.paused = true;
    },
    resume() {
      state.paused = false;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === "voiceschanged") listeners.push(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type !== "voiceschanged") return;
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
  };

  Object.defineProperty(window, "speechSynthesis", {
    value: synth,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });

  return state;
}
```

Create `src/lib/tts/web-speech-engine.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TtsChunk, TtsEvents } from "@/lib/tts/engine";
import { installFakeSpeech, type FakeSpeech } from "@/lib/tts/fake-speech";
import {
  createWebSpeechEngine,
  isSpeechSupported,
} from "@/lib/tts/web-speech-engine";

const VOICES = [
  { name: "Zira", lang: "en-US", voiceURI: "urn:zira" },
  { name: "David", lang: "en-US", voiceURI: "urn:david" },
];

const CHUNKS: TtsChunk[] = [
  { index: 0, text: "First sentence." },
  { index: 1, text: "Second sentence." },
  { index: 2, text: "Third sentence." },
];

function events(): TtsEvents & { starts: number[]; ended: number; errors: string[] } {
  const record = {
    starts: [] as number[],
    ended: 0,
    errors: [] as string[],
    onChunkStart(index: number) {
      record.starts.push(index);
    },
    onEnd() {
      record.ended += 1;
    },
    onError(message: string) {
      record.errors.push(message);
    },
  };
  return record;
}

let fake: FakeSpeech;

beforeEach(() => {
  fake = installFakeSpeech({ voices: VOICES });
});

afterEach(() => {
  fake.restore();
  vi.useRealTimers();
});

describe("isSpeechSupported", () => {
  it("is true when the API is present", () => {
    expect(isSpeechSupported()).toBe(true);
  });

  it("is false when it is not", () => {
    fake.restore();
    expect(isSpeechSupported()).toBe(false);
  });
});

describe("createWebSpeechEngine", () => {
  it("reports that it cannot seek exactly", () => {
    expect(createWebSpeechEngine().capabilities.exactSeek).toBe(false);
  });

  it("speaks chunks in order and reports the end", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: "urn:zira", rate: 1 }, record);

    expect(fake.spoken).toEqual(["First sentence."]);
    expect(record.starts).toEqual([0]);

    fake.finishCurrent();
    fake.finishCurrent();
    expect(record.starts).toEqual([0, 1, 2]);
    expect(record.ended).toBe(0);

    fake.finishCurrent();
    expect(record.ended).toBe(1);
  });

  it("starts from the requested index", () => {
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 2, { voiceId: null, rate: 1 }, events());
    expect(fake.spoken).toEqual(["Third sentence."]);
  });

  it("applies the requested rate", () => {
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1.5 }, events());
    expect(fake.rates).toEqual([1.5]);
  });

  it("ignores utterance events that arrive after stop", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, record);
    engine.stop();

    // Browsers fire onend for the utterance cancel() killed. The generation
    // guard must swallow it rather than advancing to the next chunk.
    fake.finishCurrent();
    expect(record.starts).toEqual([0]);
    expect(record.ended).toBe(0);
    expect(fake.spoken).toEqual(["First sentence."]);
  });

  it("restarts the current chunk at the new rate", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, record);
    fake.finishCurrent(); // now on chunk 1
    engine.setRate(2);

    expect(fake.spoken).toEqual([
      "First sentence.",
      "Second sentence.",
      "Second sentence.",
    ]);
    expect(fake.rates[2]).toBe(2);
    expect(record.starts).toEqual([0, 1, 1]);
  });

  it("pauses and resumes through the native API when it works", () => {
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, events());
    engine.pause();
    expect(fake.paused).toBe(true);
    engine.resume();
    expect(fake.paused).toBe(false);
    expect(fake.spoken).toHaveLength(1); // no restart needed
  });

  it("falls back to cancel-and-replay when pause is ignored", () => {
    vi.useFakeTimers();
    fake.breakPause();
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, events());

    engine.pause();
    vi.advanceTimersByTime(200);
    expect(fake.cancelled).toBeGreaterThan(0);

    engine.resume();
    expect(fake.spoken).toEqual(["First sentence.", "First sentence."]);
  });

  it("reports errors", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, record);
    fake.failCurrent("synthesis-failed");
    expect(record.errors).toEqual(["synthesis-failed"]);
  });

  it("returns voices immediately when the browser already has them", async () => {
    const engine = createWebSpeechEngine();
    await expect(engine.listVoices()).resolves.toEqual([
      { id: "urn:zira", label: "Zira", lang: "en-US" },
      { id: "urn:david", label: "David", lang: "en-US" },
    ]);
  });

  it("waits for voiceschanged when the first call is empty", async () => {
    fake.restore();
    fake = installFakeSpeech({ voices: [] });
    const engine = createWebSpeechEngine();
    const pending = engine.listVoices();
    fake.publishVoices(VOICES);
    await expect(pending).resolves.toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tts/web-speech-engine.test.ts`
Expected: FAIL — cannot resolve `@/lib/tts/engine`.

- [ ] **Step 3: Write the engine interface**

Create `src/lib/tts/engine.ts`:

```ts
/**
 * The seam between the player and whatever produces speech.
 *
 * Today the only implementation is the browser's Web Speech API. A server-side
 * neural engine can be added without the player changing: anything the native
 * engine can only approximate is gated on `capabilities`, and the player never
 * touches `speechSynthesis` itself.
 */

/** A narration unit. `index` always equals the chunk's array position. */
export interface TtsChunk {
  index: number;
  text: string;
}

export interface TtsVoice {
  /** Stable, engine-specific id persisted in localStorage. */
  id: string;
  label: string;
  lang: string;
}

export interface TtsEvents {
  onChunkStart(index: number): void;
  onEnd(): void;
  onError(message: string): void;
}

export interface TtsPlayOptions {
  voiceId: string | null;
  rate: number;
}

export interface TtsEngine {
  readonly id: string;
  readonly capabilities: {
    /** True when the engine can seek to an arbitrary time, not just a chunk. */
    exactSeek: boolean;
  };
  listVoices(): Promise<TtsVoice[]>;
  preview(voiceId: string | null, sample: string, rate: number): void;
  play(
    chunks: readonly TtsChunk[],
    fromIndex: number,
    options: TtsPlayOptions,
    events: TtsEvents,
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
}
```

- [ ] **Step 4: Write the Web Speech implementation**

Create `src/lib/tts/web-speech-engine.ts`:

```ts
import type {
  TtsChunk,
  TtsEngine,
  TtsEvents,
  TtsPlayOptions,
  TtsVoice,
} from "@/lib/tts/engine";

/**
 * Web Speech API engine. Free, offline, and full of platform quirks, all of
 * which are contained here:
 *
 * - `getVoices()` is empty on the first call in Chrome; voices arrive later
 *   with `voiceschanged`.
 * - `cancel()` fires `onend`/`onerror` on the in-flight utterance in some
 *   browsers, so a generation token discards stale handlers.
 * - `pause()` is silently ignored on Android Chrome; we verify and fall back
 *   to cancel-and-replay-from-index.
 * - Rate cannot change mid-utterance, so `setRate` restarts the current chunk.
 * - Long utterances get cut off in some Chrome versions; per-sentence chunks
 *   keep us well under any limit.
 */

/** How long to wait before deciding `pause()` was ignored. */
const PAUSE_VERIFY_MS = 150;
/** How long to wait for `voiceschanged` before giving up. */
const VOICES_TIMEOUT_MS = 1000;

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

export function createWebSpeechEngine(): TtsEngine {
  let chunks: readonly TtsChunk[] = [];
  let options: TtsPlayOptions = { voiceId: null, rate: 1 };
  let events: TtsEvents | null = null;
  let currentIndex = 0;
  let generation = 0;
  let speaking = false;
  let paused = false;
  let pauseFallback = false;

  const synth = () => window.speechSynthesis;

  function resolveVoice(voiceId: string | null): SpeechSynthesisVoice | null {
    if (!voiceId) return null;
    return synth().getVoices().find((v) => v.voiceURI === voiceId) ?? null;
  }

  function speakFrom(index: number): void {
    if (index >= chunks.length) {
      speaking = false;
      events?.onEnd();
      return;
    }

    currentIndex = index;
    const token = generation;
    const utterance = new window.SpeechSynthesisUtterance(chunks[index].text);
    utterance.rate = options.rate;
    const voice = resolveVoice(options.voiceId);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      if (token !== generation) return; // stale: cancel() or a restart
      speakFrom(index + 1);
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (token !== generation) return;
      // Cancelling mid-utterance surfaces as an error on some browsers.
      if (event.error === "canceled" || event.error === "interrupted") return;
      speaking = false;
      events?.onError(event.error || "Speech synthesis failed");
    };

    speaking = true;
    events?.onChunkStart(index);
    synth().speak(utterance);
  }

  return {
    id: "web-speech",
    capabilities: { exactSeek: false },

    async listVoices(): Promise<TtsVoice[]> {
      const read = (): TtsVoice[] =>
        synth()
          .getVoices()
          .map((voice) => ({
            id: voice.voiceURI,
            label: voice.name,
            lang: voice.lang,
          }));

      const immediate = read();
      if (immediate.length > 0) return immediate;

      // Chrome populates the list asynchronously on first use.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          synth().removeEventListener("voiceschanged", finish);
          resolve();
        };
        synth().addEventListener("voiceschanged", finish);
        window.setTimeout(finish, VOICES_TIMEOUT_MS);
      });

      return read();
    },

    preview(voiceId, sample, rate) {
      generation += 1;
      synth().cancel();
      const utterance = new window.SpeechSynthesisUtterance(sample);
      utterance.rate = rate;
      const voice = resolveVoice(voiceId);
      if (voice) utterance.voice = voice;
      synth().speak(utterance);
    },

    play(nextChunks, fromIndex, nextOptions, nextEvents) {
      generation += 1;
      synth().cancel();
      chunks = nextChunks;
      options = { ...nextOptions };
      events = nextEvents;
      paused = false;
      pauseFallback = false;
      speakFrom(fromIndex);
    },

    pause() {
      if (!speaking || paused) return;
      paused = true;
      synth().pause();
      // Android Chrome ignores pause(). Verify, then fall back to stopping and
      // remembering where we were.
      window.setTimeout(() => {
        if (!paused || synth().paused) return;
        pauseFallback = true;
        generation += 1;
        synth().cancel();
      }, PAUSE_VERIFY_MS);
    },

    resume() {
      if (!paused) return;
      paused = false;
      if (pauseFallback) {
        pauseFallback = false;
        speakFrom(currentIndex);
      } else {
        synth().resume();
      }
    },

    stop() {
      generation += 1;
      speaking = false;
      paused = false;
      pauseFallback = false;
      synth().cancel();
    },

    setRate(rate) {
      options = { ...options, rate };
      if (!speaking || paused) return;
      generation += 1;
      synth().cancel();
      speakFrom(currentIndex);
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/tts/web-speech-engine.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Run the whole unit suite, verify types and lint, then commit**

```bash
npm run test:unit && npx tsc --noEmit && npm run lint
git add web/src/lib/tts/
git commit -m "feat(tts): add TtsEngine seam and Web Speech implementation"
```

---

### Task 5: ListenProvider — state, sources, highlighting

**Files:**
- Create: `src/components/listen/listen-provider.tsx`
- Modify: `src/app/globals.css` (append the highlight rule)

**Interfaces:**
- Consumes: `TtsChunk`, `TtsEngine` from `@/lib/tts/engine`; `createWebSpeechEngine`, `isSpeechSupported` from `@/lib/tts/web-speech-engine`; `wrapSentences`, `unwrapSentences`, `CHUNK_ATTR` from `@/components/listen/wrap-sentences`; `rewindTarget` from `@/lib/tts/rewind`; `ListenPlayer` from `@/components/listen/listen-player` (Task 6 — create a one-line placeholder now, replace in Task 6).
- Produces, from `@/components/listen/listen-provider`:
  - `RATES: readonly number[]`
  - `type ReaderTab = "summary" | "article"`
  - `interface ListenContextValue` — fields listed in the implementation below
  - `ListenProvider({ title, children }: { title: string; children: React.ReactNode })`
  - `useListen(): ListenContextValue`

**Source selection is DOM order.** The provider queries `[data-listen]` inside its own root. Because the tabs layout renders only the active panel, that single rule produces the right narration for all three view states with no props:

| On screen | `[data-listen]` in DOM order | Narrates |
| --- | --- | --- |
| `card` layout | `summary`, `article` | title → summary → article |
| `tabs`, Summary active | `summary` | title → summary |
| `tabs`, Full article active | `article` | title → article |

A collapsed summary card removes the summary from the DOM, so it is not narrated — correct, since narration follows what is displayed.

- [ ] **Step 1: Add the highlight styles**

Append to `src/app/globals.css`:

```css
/* ---------------------------------------------------------------- */
/* Listen mode: active sentence highlight                            */
/* ---------------------------------------------------------------- */

[data-listen-chunk] {
  border-radius: 0.2em;
  transition: background-color 150ms ease-out;
}

[data-listen-chunk].listen-active {
  background-color: #ede9fe; /* violet-100 */
  box-shadow: 0 0 0 2px #ede9fe;
}

@media (prefers-reduced-motion: reduce) {
  [data-listen-chunk] {
    transition: none;
  }
}
```

- [ ] **Step 2: Create the placeholder player so the provider compiles**

Create `src/components/listen/listen-player.tsx`:

```tsx
"use client";

/** Replaced in full by Task 6. */
export function ListenPlayer() {
  return null;
}
```

- [ ] **Step 3: Write the provider**

Create `src/components/listen/listen-provider.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TtsChunk, TtsEngine, TtsVoice } from "@/lib/tts/engine";
import { rewindTarget } from "@/lib/tts/rewind";
import {
  createWebSpeechEngine,
  isSpeechSupported,
} from "@/lib/tts/web-speech-engine";
import {
  CHUNK_ATTR,
  unwrapSentences,
  wrapSentences,
} from "@/components/listen/wrap-sentences";
import { ListenPlayer } from "@/components/listen/listen-player";

/**
 * Owns listen-mode state for one article: which text is narrated, playback
 * status, and the sentence highlight.
 *
 * Narration sources are read from `[data-listen]` containers in DOM order, so
 * "what is on screen" is the only rule — the tabs layout renders just the
 * active panel, and a collapsed summary card is absent entirely.
 *
 * It also owns the reader's Summary/Article tab, lifted out of SummaryTabs, so
 * that switching tabs can stop a session whose highlighted DOM is about to
 * unmount.
 */

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const VOICE_KEY = "stash:tts-voice";
const RATE_KEY = "stash:tts-rate";
const REWIND_SECONDS = 10;

export type ReaderTab = "summary" | "article";
export type ListenStatus = "idle" | "playing" | "paused";

export interface ListenContextValue {
  /** False when the browser has no speech API at all — hide the entry point. */
  supported: boolean;
  /** False when the device reports no voices — disable it with an explanation. */
  ready: boolean;
  status: ListenStatus;
  /** Global chunk index being spoken, or -1 when idle. */
  activeIndex: number;
  totalChunks: number;
  /** "Title", "Summary" or "Article" — what is being read right now. */
  partLabel: string;
  rate: number;
  error: string | null;
  exactSeek: boolean;
  tab: ReaderTab;
  setTab(tab: ReaderTab): void;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  rewind(): void;
  setRate(rate: number): void;
}

const ListenContext = createContext<ListenContextValue | null>(null);

export function useListen(): ListenContextValue {
  const value = useContext(ListenContext);
  if (!value) throw new Error("useListen must be used inside a ListenProvider");
  return value;
}

function readStored<T>(key: string, parse: (raw: string) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : parse(raw);
  } catch {
    return null; // private mode — fall back to defaults
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort only.
  }
}

export function ListenProvider({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TtsEngine | null>(null);
  const chunksRef = useRef<TtsChunk[]>([]);
  /** Chunk index → the spans to highlight. Title chunk 0 has none. */
  const elementsRef = useRef<Map<number, HTMLElement[]>>(new Map());
  /** Chunk index → "Title" | "Summary" | "Article". */
  const labelsRef = useRef<string[]>([]);
  const chunkStartedAtRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);

  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [status, setStatus] = useState<ListenStatus>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [totalChunks, setTotalChunks] = useState(0);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<ReaderTab>("summary");

  // Engine, stored preferences, and the voice list are all resolved up front:
  // iOS requires the first speak() to happen inside the click handler, so
  // start() must never await anything.
  useEffect(() => {
    if (!isSpeechSupported()) return;
    setSupported(true);
    const engine = createWebSpeechEngine();
    engineRef.current = engine;

    const storedRate = readStored(RATE_KEY, (raw) => {
      const value = Number(raw);
      return RATES.includes(value as (typeof RATES)[number]) ? value : null;
    });
    if (storedRate !== null) setRateState(storedRate);
    setVoiceId(readStored(VOICE_KEY, (raw) => raw));

    let cancelled = false;
    engine.listVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });

    return () => {
      cancelled = true;
      engine.stop();
    };
  }, []);

  const highlight = useCallback((index: number) => {
    for (const [chunkIndex, elements] of elementsRef.current) {
      for (const element of elements) {
        element.classList.toggle("listen-active", chunkIndex === index);
      }
    }
    const first = elementsRef.current.get(index)?.[0];
    if (!first) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    first.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const clearHighlight = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const element of root.querySelectorAll(`[${CHUNK_ATTR}]`)) {
      element.classList.remove("listen-active");
    }
  }, []);

  /** Wraps whatever is on screen and returns the narration chunks. */
  const collect = useCallback((): TtsChunk[] => {
    const root = rootRef.current;
    if (!root) return [];

    const containers = Array.from(
      root.querySelectorAll<HTMLElement>("[data-listen]"),
    );
    for (const container of containers) unwrapSentences(container);

    const chunks: TtsChunk[] = [];
    const elements = new Map<number, HTMLElement[]>();
    const labels: string[] = [];

    const trimmedTitle = title.trim();
    if (trimmedTitle) {
      chunks.push({ index: 0, text: trimmedTitle });
      labels.push("Title");
    }

    for (const container of containers) {
      const part = container.dataset.listen === "summary" ? "Summary" : "Article";
      for (const wrapped of wrapSentences(container, chunks.length)) {
        chunks.push({ index: wrapped.index, text: wrapped.text });
        elements.set(wrapped.index, wrapped.elements);
        labels.push(part);
      }
    }

    chunksRef.current = chunks;
    elementsRef.current = elements;
    labelsRef.current = labels;
    return chunks;
  }, [title]);

  const start = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const chunks = collect();
    setTotalChunks(chunks.length);
    setError(null);
    if (chunks.length === 0) {
      setError("There is nothing to read on screen.");
      return;
    }
    setStatus("playing");
    engine.play(chunks, 0, { voiceId, rate }, {
      onChunkStart(index) {
        chunkStartedAtRef.current = performance.now();
        elapsedBeforePauseRef.current = 0;
        setActiveIndex(index);
        highlight(index);
      },
      onEnd() {
        setStatus("idle");
        setActiveIndex(-1);
        clearHighlight();
      },
      onError(message) {
        setStatus("idle");
        setActiveIndex(-1);
        clearHighlight();
        setError(message);
      },
    });
  }, [clearHighlight, collect, highlight, rate, voiceId]);

  const pause = useCallback(() => {
    engineRef.current?.pause();
    elapsedBeforePauseRef.current +=
      performance.now() - chunkStartedAtRef.current;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
    chunkStartedAtRef.current = performance.now();
    setStatus("playing");
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setStatus("idle");
    setActiveIndex(-1);
    clearHighlight();
  }, [clearHighlight]);

  const rewind = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || status === "idle") return;
    const elapsed =
      elapsedBeforePauseRef.current +
      (status === "playing" ? performance.now() - chunkStartedAtRef.current : 0);
    const target = rewindTarget(
      chunksRef.current,
      Math.max(activeIndex, 0),
      elapsed,
      rate,
      REWIND_SECONDS,
    );
    engine.play(chunksRef.current, target, { voiceId, rate }, {
      onChunkStart(index) {
        chunkStartedAtRef.current = performance.now();
        elapsedBeforePauseRef.current = 0;
        setActiveIndex(index);
        highlight(index);
      },
      onEnd() {
        setStatus("idle");
        setActiveIndex(-1);
        clearHighlight();
      },
      onError(message) {
        setStatus("idle");
        setError(message);
      },
    });
    setStatus("playing");
  }, [activeIndex, clearHighlight, highlight, rate, status, voiceId]);

  const setRate = useCallback((next: number) => {
    setRateState(next);
    persist(RATE_KEY, String(next));
    engineRef.current?.setRate(next);
  }, []);

  /**
   * Switching tabs unmounts the panel holding the highlighted spans, so the
   * session cannot survive it. Stopping is more predictable than silently
   * re-seeking into different text.
   */
  const setTab = useCallback(
    (next: ReaderTab) => {
      if (next === tab) return;
      if (status !== "idle") stop();
      setTabState(next);
    },
    [status, stop, tab],
  );

  /**
   * `L` starts a session. It lives here rather than in the player because the
   * player only exists once playback has begun — there would be nothing
   * mounted to listen for the key that starts it.
   */
  useEffect(() => {
    if (!supported || status !== "idle") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "l" && event.key !== "L") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      start();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [start, status, supported]);

  const value = useMemo<ListenContextValue>(
    () => ({
      supported,
      ready: supported && voices.length > 0,
      status,
      activeIndex,
      totalChunks,
      partLabel: labelsRef.current[activeIndex] ?? "",
      rate,
      error,
      exactSeek: engineRef.current?.capabilities.exactSeek ?? false,
      tab,
      setTab,
      start,
      pause,
      resume,
      stop,
      rewind,
      setRate,
    }),
    [
      activeIndex,
      error,
      pause,
      rate,
      resume,
      rewind,
      setRate,
      setTab,
      start,
      status,
      stop,
      supported,
      tab,
      totalChunks,
      voices.length,
    ],
  );

  return (
    <ListenContext.Provider value={value}>
      <div ref={rootRef}>
        {children}
        <ListenPlayer />
      </div>
    </ListenContext.Provider>
  );
}
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean. The provider has no unit test of its own — it is covered end-to-end in Task 9, where a real browser and real DOM make the assertions meaningful.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/listen/ web/src/app/globals.css
git commit -m "feat(tts): add ListenProvider with DOM-order source selection"
```

---

### Task 6: the docked mini-player

**Files:**
- Modify: `src/components/listen/listen-player.tsx` (replace the Task 5 placeholder in full)

**Interfaces:**
- Consumes: `useListen`, `RATES` from `@/components/listen/listen-provider`.
- Produces: `ListenPlayer()` — no props; reads everything from context.

**Positioning.** The spec described `absolute bottom-0` with `relative` on the reader pane. Use `sticky bottom-0` instead: the reader pane in `split-panes.tsx:115` is itself the scroll container (`lg:overflow-y-auto`), so `absolute` would pin to the bottom of the *content*, not the visible area. `sticky bottom-0` pins to the bottom of the scrollport on desktop **and** to the viewport on the mobile `/article/[id]` page, so one rule covers both breakpoints and `split-panes.tsx` needs no change. Bottom clearance already exists: `pb-16` on both the split-view container (`split-view.tsx:27`) and the article page (`article/[id]/page.tsx:24`).

- [ ] **Step 1: Write the player**

Replace `src/components/listen/listen-player.tsx` entirely:

```tsx
"use client";

import { useEffect } from "react";

import { RATES, useListen } from "@/components/listen/listen-provider";

/**
 * Docked transport for listen mode. Renders only during a session.
 *
 * `sticky bottom-0` rather than `absolute`: on desktop the reader pane is
 * itself the scroll container, so `absolute` would pin to the bottom of the
 * content instead of the visible area. Sticky pins to the scrollport on
 * desktop and to the viewport on the mobile article page — one rule, both
 * breakpoints.
 */
export function ListenPlayer() {
  const {
    status,
    activeIndex,
    totalChunks,
    partLabel,
    rate,
    error,
    exactSeek,
    pause,
    resume,
    stop,
    rewind,
    setRate,
  } = useListen();

  const active = status !== "idle";

  // Desktop transport shortcuts. Skipped while typing in a field, and while
  // idle so they never fight the rest of the page.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (status === "playing") pause();
        else resume();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        rewind();
      } else if (event.key === "Escape") {
        event.preventDefault();
        stop();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, pause, resume, rewind, status, stop]);

  if (!active && !error) return null;

  const spoken = Math.max(activeIndex + 1, 0);
  const percent = totalChunks > 0 ? (spoken / totalChunks) * 100 : 0;
  const buttonClass =
    "rounded-md px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

  return (
    <div
      data-testid="listen-player"
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-slate-200 bg-paper/95 px-4 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-sm"
    >
      {error ? (
        <p data-testid="listen-error" className="pb-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {active ? (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span data-testid="listen-position">
              {partLabel} · {spoken}/{totalChunks}
            </span>
            <div
              role="progressbar"
              aria-label="Listening progress"
              aria-valuemin={0}
              aria-valuemax={totalChunks}
              aria-valuenow={spoken}
              className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200"
            >
              <div
                className="h-full bg-violet-600 transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <div className="mt-1 flex items-center gap-1 pb-2">
            <button
              type="button"
              onClick={rewind}
              title={
                exactSeek ? "Back 10 seconds" : "Back about 10 seconds"
              }
              aria-label="Rewind 10 seconds"
              data-testid="listen-rewind"
              className={buttonClass}
            >
              ⟲10
            </button>
            <button
              type="button"
              onClick={status === "playing" ? pause : resume}
              title={status === "playing" ? "Pause" : "Play"}
              aria-label={status === "playing" ? "Pause" : "Play"}
              data-testid="listen-toggle"
              className={buttonClass}
            >
              {status === "playing" ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              onClick={stop}
              title="Stop listening"
              aria-label="Stop listening"
              data-testid="listen-stop"
              className={buttonClass}
            >
              ✕
            </button>

            <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
              <span className="sr-only">Reading speed</span>
              <select
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
                data-testid="listen-rate"
                aria-label="Reading speed"
                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-violet-600"
              >
                {RATES.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/listen/listen-player.tsx
git commit -m "feat(tts): add docked listen mini-player"
```

---

### Task 7: wire listen mode into the reader

**Files:**
- Modify: `src/components/article-reader.tsx` (wrap in provider; mark the article container)
- Modify: `src/components/summary-view.tsx` (mark the summary container; lift the tab into context)
- Modify: `src/components/reader-controls.tsx` (add the Listen button)

**Interfaces:**
- Consumes: `ListenProvider`, `useListen` from `@/components/listen/listen-provider`.
- Produces: no new exports. `SummaryTabs` keeps its existing props (`summary`, `children`) — only its internal state source changes, so callers are unaffected.

- [ ] **Step 1: Mark the narration containers in `summary-view.tsx`**

`SummaryText` is used by both the card and the tabs layout, so one attribute covers both. Change its root element:

```tsx
    <div data-listen="summary" className="text-sm leading-relaxed text-slate-800">
```

- [ ] **Step 2: Lift the tab out of `SummaryTabs`**

Add the import at the top of `src/components/summary-view.tsx`:

```tsx
import { useListen } from "@/components/listen/listen-provider";
```

In `SummaryTabs`, replace the local state (line 96):

```tsx
  const [tab, setTab] = useState<"summary" | "article">("summary");
```

with the context-backed pair, so the player knows what is on screen and a tab
switch can stop a session whose DOM is about to unmount:

```tsx
  const { tab, setTab } = useListen();
```

`useState` may now be unused in this file — if `npm run lint` reports it, drop
it from the React import.

- [ ] **Step 3: Wrap the reader and mark the article container**

In `src/components/article-reader.tsx`, add the import:

```tsx
import { ListenProvider } from "@/components/listen/listen-provider";
```

Wrap the returned tree so the provider encloses both the control bar (which
hosts the Listen button) and the content (which holds the highlight targets):

```tsx
  return (
    <ListenProvider title={article.title}>
      <ReaderControls
        articleId={article.id}
        starred={article.starred}
        archived={archived}
      >
        {/* ...header, summary, extraction notice, content — unchanged... */}
      </ReaderControls>
    </ListenProvider>
  );
```

Add `data-listen="article"` to **both** `<article>` elements (the tabs branch at
line 96 and the plain branch at line 103):

```tsx
          <article
            className="reader"
            data-listen="article"
            data-testid="reader-content"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
```

```tsx
        <article
          className="reader mt-8"
          data-listen="article"
          data-testid="reader-content"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
```

- [ ] **Step 4: Add the Listen button to `reader-controls.tsx`**

Add the import:

```tsx
import { useListen } from "@/components/listen/listen-provider";
```

Inside the component, next to the other hooks:

```tsx
  const listen = useListen();
```

Add the entry point to the left-hand control group, directly after the
`toggleFontFamily` button and before the `ml-auto` group. It disappears when
the browser has no speech API, and explains itself when the device has no
voices installed:

```tsx
          {listen.supported && (
            <button
              type="button"
              onClick={listen.status === "idle" ? listen.start : listen.stop}
              disabled={!listen.ready}
              title={
                listen.ready
                  ? listen.status === "idle"
                    ? "Listen to this article"
                    : "Stop listening"
                  : "No text-to-speech voices are installed on this device"
              }
              aria-label={
                listen.status === "idle" ? "Listen to this article" : "Stop listening"
              }
              data-testid="listen-start"
              className={`${controlButton} ${
                listen.status !== "idle" ? "text-violet-700" : ""
              }`}
            >
              🎧 Listen
            </button>
          )}
```

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 6: Check it in the running app**

```bash
docker compose up -d db
npm run dev
```

Open `http://localhost:3000`, save an article, and confirm: the 🎧 Listen
button appears in the reader control bar; clicking it narrates and highlights;
the player docks at the bottom of the reader pane without covering the article
list in the desktop split view.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/article-reader.tsx web/src/components/summary-view.tsx web/src/components/reader-controls.tsx
git commit -m "feat(tts): wire listen mode into the reader"
```

---

### Task 8: Listening settings — voice picker and preview

**Files:**
- Create: `src/components/listen-settings.tsx`
- Modify: `src/app/settings/page.tsx` (add the section)

**Interfaces:**
- Consumes: `createWebSpeechEngine`, `isSpeechSupported` from `@/lib/tts/web-speech-engine`; `TtsVoice` from `@/lib/tts/engine`; `RATES` from `@/components/listen/listen-provider`.
- Produces: `ListenSettings()` — no props.

This section is **client-only**. Unlike `AiSettings` above it on the same page,
it does not call `/api/settings` and does not touch the `User` row: OS voices
are per-device, so a voice id chosen on a phone would not exist on a desktop.
It reads and writes the same `localStorage` keys the provider uses.

- [ ] **Step 1: Write the component**

Create `src/components/listen-settings.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { TtsEngine, TtsVoice } from "@/lib/tts/engine";
import {
  createWebSpeechEngine,
  isSpeechSupported,
} from "@/lib/tts/web-speech-engine";
import { RATES } from "@/components/listen/listen-provider";

/**
 * Voice and speed for listen mode.
 *
 * Client-only on purpose: these are stored in localStorage, not on the User
 * row, because the available voices come from the operating system and differ
 * per device. Syncing the choice across devices would produce broken state.
 */

const VOICE_KEY = "stash:tts-voice";
const RATE_KEY = "stash:tts-rate";
const SAMPLE =
  "The quiet revival of slow reading began, as these things often do, without an announcement.";

const selectClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-violet-600 focus:bg-white";

export function ListenSettings() {
  const engineRef = useRef<TtsEngine | null>(null);
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [rate, setRate] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSpeechSupported()) {
      setSupported(false);
      setLoading(false);
      return;
    }
    const engine = createWebSpeechEngine();
    engineRef.current = engine;

    try {
      setVoiceId(window.localStorage.getItem(VOICE_KEY) ?? "");
      const storedRate = Number(window.localStorage.getItem(RATE_KEY));
      if (RATES.includes(storedRate as (typeof RATES)[number])) {
        setRate(storedRate);
      }
    } catch {
      // Private mode — defaults are fine.
    }

    let cancelled = false;
    engine.listVoices().then((list) => {
      if (cancelled) return;
      setVoices(list);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      engine.stop();
    };
  }, []);

  /** Voices grouped by language, so a long list stays navigable. */
  const grouped = useMemo(() => {
    const groups = new Map<string, TtsVoice[]>();
    for (const voice of voices) {
      const list = groups.get(voice.lang) ?? [];
      list.push(voice);
      groups.set(voice.lang, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [voices]);

  function persist(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Best effort only.
    }
  }

  if (!supported) {
    return (
      <p className="mt-4 text-sm text-slate-600">
        This browser has no speech synthesis support, so listening is
        unavailable here.
      </p>
    );
  }

  if (!loading && voices.length === 0) {
    return (
      <p data-testid="listen-no-voices" className="mt-4 text-sm text-slate-600">
        This device reports no text-to-speech voices. Install voices in your
        operating system&apos;s speech settings, then reload this page.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label
          htmlFor="tts-voice"
          className="block text-sm font-medium text-slate-700"
        >
          Voice
        </label>
        <div className="mt-1 flex gap-2">
          <select
            id="tts-voice"
            data-testid="tts-voice"
            value={voiceId}
            disabled={loading}
            onChange={(event) => {
              setVoiceId(event.target.value);
              persist(VOICE_KEY, event.target.value);
            }}
            className={selectClass}
          >
            <option value="">System default</option>
            {grouped.map(([lang, list]) => (
              <optgroup key={lang} label={lang}>
                {list.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            data-testid="tts-preview"
            onClick={() =>
              engineRef.current?.preview(voiceId || null, SAMPLE, rate)
            }
            className="shrink-0 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100"
          >
            ▸ Preview
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Voices come from your operating system, so this list differs on each
          device — and so does the choice, which is stored locally.
        </p>
      </div>

      <div>
        <label
          htmlFor="tts-rate"
          className="block text-sm font-medium text-slate-700"
        >
          Default speed
        </label>
        <select
          id="tts-rate"
          data-testid="tts-rate-default"
          value={rate}
          onChange={(event) => {
            const next = Number(event.target.value);
            setRate(next);
            persist(RATE_KEY, String(next));
          }}
          className={`${selectClass} mt-1`}
        >
          {RATES.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the section to the settings page**

In `src/app/settings/page.tsx`, add the import:

```tsx
import { ListenSettings } from "@/components/listen-settings";
```

Insert this section immediately after the closing `</section>` of the "AI
summaries" block:

```tsx
        <section className="mt-10">
          <h2 className="text-base font-semibold text-slate-900">Listening</h2>
          <p className="mt-1 text-sm text-slate-600">
            Listen to an article instead of reading it. Voices come from this
            device, so both the list and your choice are local to it.
          </p>
          <ListenSettings />
        </section>
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 4: Check it in the running app**

With `npm run dev` running, open `http://localhost:3000/settings`. Confirm the
Listening section lists this machine's voices, that ▸ Preview speaks the sample
in the selected voice, and that reloading keeps both selections.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/listen-settings.tsx web/src/app/settings/page.tsx
git commit -m "feat(tts): add Listening settings with voice preview"
```

---

### Task 9: end-to-end coverage

**Files:**
- Create: `e2e/listen.spec.ts`

**Interfaces:**
- Consumes: `E2E_BASE_URL` from `./config`; the `data-testid` hooks added in Tasks 6–8 (`listen-start`, `listen-player`, `listen-toggle`, `listen-rewind`, `listen-stop`, `listen-rate`, `listen-position`).
- Produces: nothing.

**Headless Chromium has no speech voices**, so the real API cannot be exercised
in CI — `getVoices()` returns `[]` and nothing is ever spoken. `addInitScript`
installs a fake that reports two voices and completes each utterance on a
timer. The assertions are about our behavior, not the fake's.

Follow the existing conventions in `e2e/web.spec.ts`: serial mode, one shared
page, dev login in `beforeAll`, `deleteAllArticles` for isolation.

- [ ] **Step 1: Write the spec**

Create `e2e/listen.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "./config";

const ARTICLE_URL = `${E2E_BASE_URL}/test-article.html`;
const ARTICLE_TITLE = "The Quiet Revival of Slow Reading";

test.describe.configure({ mode: "serial" });

let page: Page;

/**
 * Headless Chromium ships no speech voices, so the real Web Speech API can
 * never speak in CI. This fake reports two voices and finishes each utterance
 * after 80ms, and records what was spoken on `window.__spoken` so the tests
 * can assert which text was narrated.
 */
const FAKE_SPEECH = `
  (() => {
    const spoken = [];
    const rates = [];
    window.__spoken = spoken;
    window.__rates = rates;
    let current = null;
    let paused = false;

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.voice = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    const voices = [
      { name: "Test Female", lang: "en-US", voiceURI: "urn:test:female" },
      { name: "Test Male", lang: "en-US", voiceURI: "urn:test:male" },
    ];

    const synth = {
      get paused() { return paused; },
      getVoices: () => voices,
      speak(utterance) {
        current = utterance;
        spoken.push(utterance.text);
        rates.push(utterance.rate);
        setTimeout(() => {
          if (current !== utterance || paused) return;
          current = null;
          utterance.onend && utterance.onend();
        }, 80);
      },
      cancel() { current = null; paused = false; },
      pause() { paused = true; },
      resume() {
        paused = false;
        const utterance = current;
        if (!utterance) return;
        setTimeout(() => {
          if (current !== utterance || paused) return;
          current = null;
          utterance.onend && utterance.onend();
        }, 80);
      },
      addEventListener() {},
      removeEventListener() {},
    };

    Object.defineProperty(window, "speechSynthesis", { value: synth });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: FakeUtterance,
    });
  })();
`;

async function deleteAllArticles(p: Page) {
  for (const state of ["unread", "archived"]) {
    const res = await p.request.get(`/api/articles?state=${state}&limit=100`);
    if (!res.ok()) continue;
    const body = await res.json();
    for (const a of body.articles ?? []) {
      await p.request.delete(`/api/articles/${a.id}`);
    }
  }
}

/** Opens the saved article in the standalone reader. */
async function openReader(p: Page): Promise<void> {
  const res = await p.request.get("/api/articles?state=unread&limit=1");
  const body = await res.json();
  await p.goto(`/article/${body.articles[0].id}`);
  await expect(p.getByTestId("reader-content")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(FAKE_SPEECH);
  await page.goto("/login");
  await page.getByTestId("dev-login").click();
  await page.waitForURL(/\/$/);
  await deleteAllArticles(page);

  await page.getByTestId("add-url-input").fill(ARTICLE_URL);
  await page.getByTestId("add-url-submit").click();
  await expect(
    page.getByTestId("article-row").filter({ hasText: ARTICLE_TITLE }),
  ).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await deleteAllArticles(page);
  await page.close();
});

test("the Listen button appears once voices are available", async () => {
  await openReader(page);
  const listen = page.getByTestId("listen-start");
  await expect(listen).toBeVisible();
  await expect(listen).toBeEnabled();
  await expect(page.getByTestId("listen-player")).toBeHidden();
});

test("starting playback narrates the title first, then the article", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();

  await expect(page.getByTestId("listen-player")).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(() => window.__spoken)).length)
    .toBeGreaterThan(1);

  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken[0]).toBe(ARTICLE_TITLE);
  // The article body follows the title.
  expect(spoken.slice(1).join(" ").length).toBeGreaterThan(0);
});

test("the active sentence is highlighted", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect
    .poll(() => page.locator("[data-listen-chunk].listen-active").count())
    .toBeGreaterThan(0);
});

test("pause stops advancing and resume continues", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__spoken)).length)
    .toBeGreaterThan(1);

  await page.getByTestId("listen-toggle").click(); // pause
  const atPause = await page.evaluate(() => window.__spoken.length);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__spoken.length)).toBe(atPause);

  await page.getByTestId("listen-toggle").click(); // resume
  await expect
    .poll(async () => (await page.evaluate(() => window.__spoken)).length)
    .toBeGreaterThan(atPause);
});

test("stop hides the player and clears the highlight", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect(page.getByTestId("listen-player")).toBeVisible();

  await page.getByTestId("listen-stop").click();
  await expect(page.getByTestId("listen-player")).toBeHidden();
  await expect(page.locator("[data-listen-chunk].listen-active")).toHaveCount(0);
});

test("rewind moves the position back", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();

  // Let several chunks go by so there is somewhere to rewind to.
  await expect
    .poll(async () => (await page.evaluate(() => window.__spoken)).length)
    .toBeGreaterThan(5);

  const position = () =>
    page.getByTestId("listen-position").innerText();
  const before = Number((await position()).match(/(\d+)\//)?.[1] ?? "0");

  await page.getByTestId("listen-toggle").click(); // pause, so it holds still
  await page.getByTestId("listen-rewind").click();

  const after = Number((await position()).match(/(\d+)\//)?.[1] ?? "0");
  expect(after).toBeLessThan(before);
});

test("the speed selection reaches the engine", async () => {
  await openReader(page);
  await page.getByTestId("listen-start").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__rates)).length)
    .toBeGreaterThan(0);

  await page.getByTestId("listen-rate").selectOption("1.5");
  await expect
    .poll(async () => {
      const rates = await page.evaluate(() => window.__rates);
      return rates[rates.length - 1];
    })
    .toBe(1.5);
});

test("with tabs enabled, only the active panel is narrated", async () => {
  // Switch the reader to the tabbed layout and generate nothing — the summary
  // tab only exists when the article has a summary, so seed one directly.
  const res = await page.request.get("/api/articles?state=unread&limit=1");
  const { articles } = await res.json();
  await page.request.patch(`/api/articles/${articles[0].id}`, {
    data: { summary: "THE NEWS\nA short seeded summary sentence." },
  });
  await page.request.patch("/api/settings", {
    data: { summaryView: "tabs" },
  });

  await page.goto(`/article/${articles[0].id}`);
  await expect(page.getByTestId("summary-tab-panel")).toBeVisible();

  await page.getByTestId("listen-start").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__spoken)).length)
    .toBeGreaterThan(1);

  const spoken = (await page.evaluate(() => window.__spoken)).join(" ");
  expect(spoken).toContain("A short seeded summary sentence.");
  // The article body is not on screen, so it is not read.
  expect(spoken).not.toContain("slow reading");

  await page.request.patch("/api/settings", {
    data: { summaryView: "card" },
  });
});

test("switching tabs stops playback", async () => {
  const res = await page.request.get("/api/articles?state=unread&limit=1");
  const { articles } = await res.json();
  await page.request.patch("/api/settings", { data: { summaryView: "tabs" } });
  await page.goto(`/article/${articles[0].id}`);

  await page.getByTestId("listen-start").click();
  await expect(page.getByTestId("listen-player")).toBeVisible();

  await page.getByRole("tab", { name: /Full article/ }).click();
  await expect(page.getByTestId("listen-player")).toBeHidden();

  await page.request.patch("/api/settings", { data: { summaryView: "card" } });
});
```

- [ ] **Step 2: Declare the injected globals for TypeScript**

Add at the top of `e2e/listen.spec.ts`, below the imports:

```ts
declare global {
  interface Window {
    __spoken: string[];
    __rates: number[];
  }
}
```

- [ ] **Step 3: Run the new spec**

```bash
docker compose up -d db
npx playwright test e2e/listen.spec.ts
```

Expected: all tests pass.

Two things to check rather than paper over if a test fails:
- If the tabs test finds no summary, confirm `PATCH /api/articles/[id]` actually
  accepts a `summary` field. If it does not, seed the summary through
  `prisma` in the spec's setup instead of loosening the assertion.
- If `PATCH /api/settings` rejects a partial body, send the full settings
  object it requires — read `src/app/api/settings/route.ts` for the shape.

- [ ] **Step 4: Run the full suite**

```bash
npm run test:unit && npx playwright test && npx tsc --noEmit && npm run lint
```

Expected: unit tests pass, the whole e2e suite (including the pre-existing
`web.spec.ts` and `extension.spec.ts`) passes, types and lint clean.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/listen.spec.ts
git commit -m "test(tts): cover listen mode end-to-end with a faked speech API"
```

---

## Refinements to the spec, discovered during planning

Two decisions in the plan differ from the spec. Both are improvements; the spec
has been updated to match.

1. **`sticky bottom-0`, not `absolute` + `relative` pane.** The desktop reader
   pane is itself the scroll container, so `absolute bottom-0` would pin to the
   bottom of the content rather than the visible area. Sticky pins correctly on
   desktop *and* on the mobile article page, so one rule serves both
   breakpoints and `split-panes.tsx` needs no change at all.
2. **Source selection reads `[data-listen]` in DOM order** instead of taking
   `summaryView`, `hasSummary`, and `tab` as inputs. Because the tabs layout
   renders only the active panel, DOM order already encodes all three view
   states. The provider needs no layout props, and a collapsed summary card
   correctly drops out of narration. The tab still lives in context — but only
   so that switching it can stop playback.
3. **An empty article reports an error instead of disabling the button.** The
   spec called for the Listen button to be disabled when there are no chunks,
   but chunk count is only known after wrapping the DOM, and wrapping every
   article on mount to pre-empt a rare case is wasted work. `start()` instead
   surfaces "There is nothing to read on screen." in the player and returns to
   idle. Same outcome for the reader, no cost on the common path.
