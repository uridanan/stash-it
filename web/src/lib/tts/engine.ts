/**
 * The seam between the player and whatever produces speech.
 *
 * Today the only implementation is the browser's Web Speech API. A server-side
 * neural engine can be added without the player changing: anything the native
 * engine can only approximate is gated on `capabilities`, and the player never
 * touches `speechSynthesis` itself.
 */

/** A narration unit. `index` always equals the chunk's array position. */
export interface TtsChunk {
  index: number;
  text: string;
}

export interface TtsVoice {
  /** Stable, engine-specific id persisted in localStorage. */
  id: string;
  label: string;
  lang: string;
}

export interface TtsEvents {
  onChunkStart(index: number): void;
  onEnd(): void;
  onError(message: string): void;
}

export interface TtsPlayOptions {
  voiceId: string | null;
  rate: number;
}

export interface TtsEngine {
  readonly id: string;
  readonly capabilities: {
    /** True when the engine can seek to an arbitrary time, not just a chunk. */
    exactSeek: boolean;
  };
  listVoices(): Promise<TtsVoice[]>;
  preview(voiceId: string | null, sample: string, rate: number): void;
  play(
    chunks: readonly TtsChunk[],
    fromIndex: number,
    options: TtsPlayOptions,
    events: TtsEvents,
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
}
