import type {
  TtsChunk,
  TtsEngine,
  TtsEvents,
  TtsPlayOptions,
  TtsVoice,
} from "@/lib/tts/engine";

/**
 * Web Speech API engine. Free, offline, and full of platform quirks, all of
 * which are contained here:
 *
 * - `getVoices()` is empty on the first call in Chrome; voices arrive later
 *   with `voiceschanged`.
 * - `cancel()` fires `onend`/`onerror` on the in-flight utterance in some
 *   browsers, so a generation token discards stale handlers.
 * - `pause()` is silently ignored on Android Chrome; we verify and fall back
 *   to cancel-and-replay-from-index.
 * - Rate cannot change mid-utterance, so `setRate` restarts the current chunk.
 * - Long utterances get cut off in some Chrome versions; per-sentence chunks
 *   keep us well under any limit.
 */

/** How long to wait before deciding `pause()` was ignored. */
const PAUSE_VERIFY_MS = 150;
/** How long to wait for `voiceschanged` before giving up. */
const VOICES_TIMEOUT_MS = 1000;

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

export function createWebSpeechEngine(): TtsEngine {
  let chunks: readonly TtsChunk[] = [];
  let options: TtsPlayOptions = { voiceId: null, rate: 1 };
  let events: TtsEvents | null = null;
  let currentIndex = 0;
  let generation = 0;
  let speaking = false;
  let paused = false;
  let pauseFallback = false;

  const synth = () => window.speechSynthesis;

  function resolveVoice(voiceId: string | null): SpeechSynthesisVoice | null {
    if (!voiceId) return null;
    return synth().getVoices().find((v) => v.voiceURI === voiceId) ?? null;
  }

  function speakFrom(index: number): void {
    if (index >= chunks.length) {
      speaking = false;
      events?.onEnd();
      return;
    }

    currentIndex = index;
    const token = generation;
    const utterance = new window.SpeechSynthesisUtterance(chunks[index].text);
    utterance.rate = options.rate;
    const voice = resolveVoice(options.voiceId);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      if (token !== generation) return; // stale: cancel() or a restart
      speakFrom(index + 1);
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (token !== generation) return;
      // Cancelling mid-utterance surfaces as an error on some browsers.
      if (event.error === "canceled" || event.error === "interrupted") return;
      speaking = false;
      events?.onError(event.error || "Speech synthesis failed");
    };

    speaking = true;
    events?.onChunkStart(index);
    synth().speak(utterance);
  }

  return {
    id: "web-speech",
    capabilities: { exactSeek: false },

    async listVoices(): Promise<TtsVoice[]> {
      const read = (): TtsVoice[] =>
        synth()
          .getVoices()
          .map((voice) => ({
            id: voice.voiceURI,
            label: voice.name,
            lang: voice.lang,
          }));

      const immediate = read();
      if (immediate.length > 0) return immediate;

      // Chrome populates the list asynchronously on first use.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          synth().removeEventListener("voiceschanged", finish);
          resolve();
        };
        synth().addEventListener("voiceschanged", finish);
        window.setTimeout(finish, VOICES_TIMEOUT_MS);
      });

      return read();
    },

    preview(voiceId, sample, rate) {
      generation += 1;
      synth().cancel();
      const utterance = new window.SpeechSynthesisUtterance(sample);
      utterance.rate = rate;
      const voice = resolveVoice(voiceId);
      if (voice) utterance.voice = voice;
      synth().speak(utterance);
    },

    play(nextChunks, fromIndex, nextOptions, nextEvents) {
      generation += 1;
      synth().cancel();
      chunks = nextChunks;
      options = { ...nextOptions };
      events = nextEvents;
      paused = false;
      pauseFallback = false;
      speakFrom(fromIndex);
    },

    pause() {
      if (!speaking || paused) return;
      paused = true;
      synth().pause();
      // Android Chrome ignores pause(). Verify, then fall back to stopping and
      // remembering where we were.
      window.setTimeout(() => {
        if (!paused || synth().paused) return;
        pauseFallback = true;
        generation += 1;
        synth().cancel();
      }, PAUSE_VERIFY_MS);
    },

    resume() {
      if (!paused) return;
      paused = false;
      if (pauseFallback) {
        pauseFallback = false;
        speakFrom(currentIndex);
      } else {
        synth().resume();
      }
    },

    stop() {
      generation += 1;
      speaking = false;
      paused = false;
      pauseFallback = false;
      synth().cancel();
    },

    setRate(rate) {
      options = { ...options, rate };
      if (!speaking || paused) return;
      generation += 1;
      synth().cancel();
      speakFrom(currentIndex);
    },
  };
}
