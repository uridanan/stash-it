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
