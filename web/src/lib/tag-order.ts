/**
 * Slugs and playlist ordering.
 *
 * Positions are floats so a drag writes the midpoint of its new neighbours
 * and touches exactly one row — no cascading renumber. Repeated midpointing
 * halves the gap each time, so `needsRebalance` watches for the point where
 * float precision would start to bite and the caller renumbers that one tag.
 */

/** Gap below which midpointing is no longer safely representable. */
export const MIN_POSITION_GAP = 1e-6;
/** Spacing used when a tag's positions are renumbered from scratch. */
export const REBALANCE_STEP = 1;

/**
 * URL-safe slug. Non-Latin scripts have no ASCII form, so they fall back to a
 * stable encoding rather than collapsing every Hebrew tag to the same slug.
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents: é -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base) return base.slice(0, 64);

  // Nothing survived (e.g. "עברית"): percent-encode so the slug stays unique
  // and URL-safe without being empty.
  const encoded = encodeURIComponent(name.trim().toLowerCase())
    .replace(/%/g, "")
    .toLowerCase();
  return encoded.slice(0, 64) || "tag";
}

/** Appends a numeric suffix until the slug is free. */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  const base = slugify(name);
  if (!existing.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** Position for a new item appended to the end of a tag. */
export function positionForAppend(positions: readonly number[]): number {
  if (positions.length === 0) return REBALANCE_STEP;
  return Math.max(...positions) + REBALANCE_STEP;
}

/** Position that places an item ahead of everything else. */
export function positionForTop(positions: readonly number[]): number {
  if (positions.length === 0) return REBALANCE_STEP;
  return Math.min(...positions) - REBALANCE_STEP;
}

/**
 * Position for an item dropped between two neighbours. Either side may be
 * undefined when the item is dropped at one end of the list.
 */
export function positionBetween(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before === undefined && after === undefined) return REBALANCE_STEP;
  if (before === undefined) return after! - REBALANCE_STEP;
  if (after === undefined) return before + REBALANCE_STEP;
  return (before + after) / 2;
}

/** True when positions have crowded together and the tag should be renumbered. */
export function needsRebalance(positions: readonly number[]): boolean {
  if (positions.length < 2) return false;
  const sorted = [...positions].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] < MIN_POSITION_GAP) return true;
  }
  return false;
}

/** Evenly spaced positions for a list already in its intended order. */
export function rebalancedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * REBALANCE_STEP);
}
