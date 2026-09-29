import { describe, expect, it } from "vitest";

import {
  estimateChunkSeconds,
  forwardTarget,
  rewindTarget,
} from "@/lib/tts/rewind";

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
    // The window is a floor, not a ceiling: one 3.7s chunk does not cover 4s,
    // so it steps back one further rather than landing short.
    expect(rewindTarget(chunks, 5, 0, 1, 4)).toBe(3);
    expect(rewindTarget(chunks, 5, 0, 1, 3)).toBe(4);
  });
});

describe("forwardTarget", () => {
  it("skips ahead over roughly the requested window", () => {
    // 10s of 3.7s chunks ≈ 3 chunks on.
    expect(forwardTarget(chunks, 0, 0, 1)).toBe(3);
  });

  it("counts time already spent in the current chunk", () => {
    expect(forwardTarget(chunks, 0, 8_000, 1)).toBeGreaterThan(
      forwardTarget(chunks, 0, 0, 1),
    );
  });

  it("skips further at a higher rate, since chunks are shorter", () => {
    expect(forwardTarget(chunks, 0, 0, 2)).toBeGreaterThan(
      forwardTarget(chunks, 0, 0, 1),
    );
  });

  it("stops at the end rather than running past it", () => {
    expect(forwardTarget(chunks, 5, 0, 1)).toBe(chunks.length);
    expect(forwardTarget(chunks, chunks.length, 0, 1)).toBe(chunks.length);
  });
});
