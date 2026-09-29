import { describe, expect, it } from "vitest";

import { parseTopics } from "@/lib/classify";
import {
  BUILT_IN_TOPICS,
  MAX_TOPICS_PER_ARTICLE,
  topicVocabulary,
} from "@/lib/taxonomy";

const VOCAB = topicVocabulary([]);

describe("topicVocabulary", () => {
  it("includes the built-ins", () => {
    expect(VOCAB).toEqual(expect.arrayContaining([...BUILT_IN_TOPICS]));
  });

  it("appends custom topics", () => {
    expect(topicVocabulary(["Woodworking"])).toContain("Woodworking");
  });

  it("does not duplicate a custom topic that already exists", () => {
    const vocab = topicVocabulary(["technology", "Technology"]);
    const technology = vocab.filter((t) => t.toLowerCase() === "technology");
    expect(technology).toHaveLength(1);
  });

  it("ignores blank custom topics", () => {
    expect(topicVocabulary(["  ", ""])).toEqual([...BUILT_IN_TOPICS]);
  });
});

describe("parseTopics", () => {
  it("reads a plain JSON array", () => {
    expect(parseTopics('["Technology","Business"]', VOCAB)).toEqual([
      "Technology",
      "Business",
    ]);
  });

  it("reads JSON wrapped in prose or code fences", () => {
    const raw = 'Sure!\n```json\n["Science"]\n```\nHope that helps.';
    expect(parseTopics(raw, VOCAB)).toEqual(["Science"]);
  });

  it("discards topics outside the vocabulary", () => {
    expect(parseTopics('["Technology","Underwater Basketry"]', VOCAB)).toEqual([
      "Technology",
    ]);
  });

  it("canonicalizes casing to the vocabulary spelling", () => {
    expect(parseTopics('["technology","SCIENCE"]', VOCAB)).toEqual([
      "Technology",
      "Science",
    ]);
  });

  it("collapses duplicates", () => {
    expect(parseTopics('["Technology","technology","Technology"]', VOCAB)).toEqual(
      ["Technology"],
    );
  });

  it("caps the number of topics", () => {
    const raw = JSON.stringify([
      "Technology",
      "Science",
      "Business",
      "Politics",
      "Health",
    ]);
    expect(parseTopics(raw, VOCAB)).toHaveLength(MAX_TOPICS_PER_ARTICLE);
  });

  it("falls back to a comma-separated list when there is no JSON", () => {
    expect(parseTopics("Technology, Science", VOCAB)).toEqual([
      "Technology",
      "Science",
    ]);
  });

  it("falls back to a bulleted list", () => {
    expect(parseTopics("- Technology\n- Science", VOCAB)).toEqual([
      "Technology",
      "Science",
    ]);
  });

  it("returns nothing for malformed JSON with no recognizable topics", () => {
    expect(parseTopics("{ broken", VOCAB)).toEqual([]);
  });

  it("returns nothing for an explicitly empty array", () => {
    expect(parseTopics("[]", VOCAB)).toEqual([]);
  });

  it("ignores non-string entries", () => {
    expect(parseTopics('[1, null, "Science"]', VOCAB)).toEqual(["Science"]);
  });

  it("honours a custom topic", () => {
    const vocab = topicVocabulary(["Woodworking"]);
    expect(parseTopics('["Woodworking"]', vocab)).toEqual(["Woodworking"]);
  });
});
