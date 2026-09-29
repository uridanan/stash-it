import { describe, expect, it } from "vitest";

import {
  MIN_POSITION_GAP,
  needsRebalance,
  positionBetween,
  positionForAppend,
  positionForTop,
  rebalancedPositions,
  slugify,
  uniqueSlug,
} from "@/lib/tag-order";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Long Read")).toBe("long-read");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Café Société")).toBe("cafe-societe");
  });

  it("collapses punctuation and trims stray hyphens", () => {
    expect(slugify("  AI & ML!!  ")).toBe("ai-ml");
  });

  it("keeps non-Latin names distinct instead of collapsing them", () => {
    const hebrew = slugify("עברית");
    const french = slugify("צרפתית");
    expect(hebrew).not.toBe("");
    expect(hebrew).not.toBe(french);
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!")).not.toBe("");
  });
});

describe("uniqueSlug", () => {
  it("returns the plain slug when free", () => {
    expect(uniqueSlug("Tech", [])).toBe("tech");
  });

  it("suffixes on collision", () => {
    expect(uniqueSlug("Tech", ["tech"])).toBe("tech-2");
    expect(uniqueSlug("Tech", ["tech", "tech-2"])).toBe("tech-3");
  });
});

describe("positions", () => {
  it("appends after the current maximum", () => {
    expect(positionForAppend([1, 2, 3])).toBe(4);
    expect(positionForAppend([])).toBe(1);
  });

  it("sends to top ahead of the current minimum", () => {
    expect(positionForTop([1, 2, 3])).toBe(0);
    expect(positionForTop([-4, 2])).toBe(-5);
    expect(positionForTop([])).toBe(1);
  });

  it("drops between neighbours at the midpoint", () => {
    expect(positionBetween(2, 3)).toBe(2.5);
    expect(positionBetween(2, 2.5)).toBe(2.25);
  });

  it("handles a drop at either end", () => {
    expect(positionBetween(undefined, 5)).toBe(4);
    expect(positionBetween(5, undefined)).toBe(6);
    expect(positionBetween(undefined, undefined)).toBe(1);
  });

  it("keeps ordering stable through repeated midpointing", () => {
    let low = 1;
    const high = 2;
    for (let i = 0; i < 20; i += 1) {
      const mid = positionBetween(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});

describe("needsRebalance", () => {
  it("is false for comfortably spaced positions", () => {
    expect(needsRebalance([1, 2, 3])).toBe(false);
  });

  it("is false for a list too short to crowd", () => {
    expect(needsRebalance([1])).toBe(false);
    expect(needsRebalance([])).toBe(false);
  });

  it("is true once two positions crowd together", () => {
    expect(needsRebalance([1, 1 + MIN_POSITION_GAP / 2, 2])).toBe(true);
  });

  it("detects crowding regardless of input order", () => {
    expect(needsRebalance([5, 1, 1 + MIN_POSITION_GAP / 2])).toBe(true);
  });

  it("catches the crowding that repeated midpointing eventually causes", () => {
    const positions = [1, 2];
    for (let i = 0; i < 40; i += 1) {
      positions.push(positionBetween(positions[0], positions[positions.length - 1]));
      positions.sort((a, b) => a - b);
    }
    expect(needsRebalance(positions)).toBe(true);
  });
});

describe("rebalancedPositions", () => {
  it("spaces positions evenly from one", () => {
    expect(rebalancedPositions(3)).toEqual([1, 2, 3]);
    expect(rebalancedPositions(0)).toEqual([]);
  });
});
