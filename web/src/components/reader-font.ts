/** Article text size. Stored on the device, shared by the reader and Settings. */
export const FONT_SIZE_KEY = "stash:font-size";
export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 26;
export const FONT_SIZE_STEP = 2;
export const DEFAULT_FONT_SIZE = 18;

export function readFontSize(): number {
  try {
    const stored = Number(window.localStorage.getItem(FONT_SIZE_KEY));
    if (stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE) return stored;
  } catch {
    // localStorage unavailable — use the default.
  }
  return DEFAULT_FONT_SIZE;
}

/** Clamps, stores, and returns the size the reader should use. */
export function writeFontSize(next: number): number {
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
  try {
    window.localStorage.setItem(FONT_SIZE_KEY, String(clamped));
  } catch {
    // Best effort only.
  }
  return clamped;
}
