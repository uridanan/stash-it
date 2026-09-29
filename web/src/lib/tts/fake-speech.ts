/**
 * A `speechSynthesis` stand-in for tests. Headless browsers and jsdom have no
 * speech engine at all, so the real API cannot be exercised anywhere in CI.
 *
 * Utterances complete when `finishCurrent()` is called, keeping tests
 * deterministic rather than timer-dependent.
 */

interface FakeUtterance {
  text: string;
  rate: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

export interface FakeSpeech {
  spoken: string[];
  rates: number[];
  paused: boolean;
  cancelled: number;
  /** Completes the in-flight utterance, as the browser would. */
  finishCurrent(): void;
  /** Fails the in-flight utterance. */
  failCurrent(error: string): void;
  /** Publishes a voice list and fires `voiceschanged`. */
  publishVoices(voices: { name: string; lang: string; voiceURI: string }[]): void;
  /** Makes `pause()` a no-op, as Android Chrome does. */
  breakPause(): void;
  restore(): void;
}

export function installFakeSpeech(
  options: { voices?: { name: string; lang: string; voiceURI: string }[] } = {},
): FakeSpeech {
  const listeners: (() => void)[] = [];
  let voices = options.voices ?? [];
  let current: FakeUtterance | null = null;
  let pauseWorks = true;

  const state: FakeSpeech = {
    spoken: [],
    rates: [],
    paused: false,
    cancelled: 0,
    finishCurrent() {
      const utterance = current;
      current = null;
      utterance?.onend?.();
    },
    failCurrent(error) {
      const utterance = current;
      current = null;
      utterance?.onerror?.({ error });
    },
    publishVoices(next) {
      voices = next;
      for (const listener of [...listeners]) listener();
    },
    breakPause() {
      pauseWorks = false;
    },
    restore() {
      Reflect.deleteProperty(window, "speechSynthesis");
      Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
    },
  };

  class FakeSpeechSynthesisUtterance implements FakeUtterance {
    text: string;
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  const synth = {
    get paused() {
      return state.paused;
    },
    getVoices: () => voices,
    speak(utterance: FakeUtterance) {
      current = utterance;
      state.spoken.push(utterance.text);
      state.rates.push(utterance.rate);
    },
    cancel() {
      state.cancelled += 1;
      state.paused = false;
      // `current` is deliberately NOT cleared: real browsers fire onend for
      // the cancelled utterance, which is exactly what the engine's
      // generation guard has to survive.
    },
    pause() {
      if (pauseWorks) state.paused = true;
    },
    resume() {
      state.paused = false;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === "voiceschanged") listeners.push(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type !== "voiceschanged") return;
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
  };

  Object.defineProperty(window, "speechSynthesis", {
    value: synth,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });

  return state;
}
