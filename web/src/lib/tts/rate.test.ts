import { describe, expect, it } from "vitest";

import { engineRate, isKnownRate, RATES } from "@/lib/tts/rate";

describe("engineRate", () => {
  it("leaves 1x as the engine's own natural speed", () => {
    expect(engineRate(1)).toBe(1);
  });

  it("sends 2x as 4/3, the calibrated fast-but-followable rate", () => {
    expect(engineRate(2)).toBeCloseTo(4 / 3, 5);
  });

  it("passes speeds below 1x straight through, so they stay audibly slower", () => {
    expect(engineRate(0.75)).toBe(0.75);
    expect(engineRate(0.5)).toBe(0.5);
  });

  it("compresses above 1x rather than scaling linearly", () => {
    // A label 50% above natural must not ask the engine for 50% more.
    expect(engineRate(1.5)).toBeLessThan(1.5);
    expect(engineRate(1.5)).toBeCloseTo(1 + 0.5 / 3, 5);
  });

  it("is continuous at the 1x hinge", () => {
    expect(engineRate(0.999)).toBeCloseTo(engineRate(1.001), 2);
  });

  it("stays monotonic across the offered speeds", () => {
    const rates = RATES.map(engineRate);
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    }
  });

  it("keeps every offered speed inside the range the engine accepts", () => {
    for (const label of RATES) {
      expect(engineRate(label)).toBeGreaterThanOrEqual(0.1);
      expect(engineRate(label)).toBeLessThanOrEqual(10);
    }
  });
});

describe("isKnownRate", () => {
  it("accepts offered speeds and rejects others", () => {
    expect(isKnownRate(1.25)).toBe(true);
    expect(isKnownRate(3)).toBe(false);
  });
});
