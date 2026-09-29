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

/**
 * The chunk index to jump to in order to skip roughly `seconds` ahead.
 *
 * Time already spent in the current chunk counts against the jump, mirroring
 * `rewindTarget`. Returns `chunks.length` when the skip runs off the end, which
 * the caller treats as "this article is finished".
 */
export function forwardTarget(
  chunks: readonly { text: string }[],
  currentIndex: number,
  elapsedMs: number,
  rate: number,
  seconds = 10,
): number {
  let remaining = seconds + elapsedMs / 1000;
  let index = currentIndex;
  while (index < chunks.length && remaining > 0) {
    remaining -= estimateChunkSeconds(chunks[index].text, rate);
    index += 1;
  }
  return Math.min(index, chunks.length);
}
