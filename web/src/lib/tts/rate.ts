/**
 * Reading speed: what the player shows versus what the engine is told.
 *
 * The Web Speech API's `rate` is perceptually exaggerated above 1 — the top of
 * its range runs away far faster than the numbers suggest — so labels above 1×
 * are compressed before they reach the engine. Below 1× the engine's own scale
 * behaves sensibly and passes straight through, which keeps 0.75× an audible
 * slowdown rather than a rounding error.
 *
 * The curve is fixed by two calibration points, both from listening:
 *   - 1× should sound natural, which is the engine's own 1.0.
 *   - 2× should sound fast but followable, which is the engine's 1.333.
 */

/** Speeds offered in the player, as the reader understands them. */
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * How much of a label's excess over 1× survives to the engine.
 *
 * From the second calibration point: label 2 must reach engine 4/3, so a whole
 * step of label above 1 becomes a third of a step of rate.
 */
export const ABOVE_ONE_COMPRESSION = 1 / 3;

/** Converts a displayed speed to the value handed to the engine. */
export function engineRate(label: number): number {
  if (label <= 1) return label;
  return 1 + (label - 1) * ABOVE_ONE_COMPRESSION;
}

export function isKnownRate(value: number): boolean {
  return (RATES as readonly number[]).includes(value);
}
