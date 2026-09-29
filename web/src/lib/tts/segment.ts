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
