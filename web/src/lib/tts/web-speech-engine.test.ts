import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TtsChunk, TtsEvents } from "@/lib/tts/engine";
import { installFakeSpeech, type FakeSpeech } from "@/lib/tts/fake-speech";
import {
  createWebSpeechEngine,
  isSpeechSupported,
} from "@/lib/tts/web-speech-engine";

const VOICES = [
  { name: "Zira", lang: "en-US", voiceURI: "urn:zira" },
  { name: "David", lang: "en-US", voiceURI: "urn:david" },
];

const CHUNKS: TtsChunk[] = [
  { index: 0, text: "First sentence." },
  { index: 1, text: "Second sentence." },
  { index: 2, text: "Third sentence." },
];

function events(): TtsEvents & { starts: number[]; ended: number; errors: string[] } {
  const record = {
    starts: [] as number[],
    ended: 0,
    errors: [] as string[],
    onChunkStart(index: number) {
      record.starts.push(index);
    },
    onEnd() {
      record.ended += 1;
    },
    onError(message: string) {
      record.errors.push(message);
    },
  };
  return record;
}

let fake: FakeSpeech;

beforeEach(() => {
  fake = installFakeSpeech({ voices: VOICES });
});

afterEach(() => {
  fake.restore();
  vi.useRealTimers();
});

describe("isSpeechSupported", () => {
  it("is true when the API is present", () => {
    expect(isSpeechSupported()).toBe(true);
  });

  it("is false when it is not", () => {
    fake.restore();
    expect(isSpeechSupported()).toBe(false);
  });
});

describe("createWebSpeechEngine", () => {
  it("reports that it cannot seek exactly", () => {
    expect(createWebSpeechEngine().capabilities.exactSeek).toBe(false);
  });

  it("speaks chunks in order and reports the end", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: "urn:zira", rate: 1 }, record);

    expect(fake.spoken).toEqual(["First sentence."]);
    expect(record.starts).toEqual([0]);

    fake.finishCurrent();
    fake.finishCurrent();
    expect(record.starts).toEqual([0, 1, 2]);
    expect(record.ended).toBe(0);

    fake.finishCurrent();
    expect(record.ended).toBe(1);
  });

  it("starts from the requested index", () => {
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 2, { voiceId: null, rate: 1 }, events());
    expect(fake.spoken).toEqual(["Third sentence."]);
  });

  it("applies the requested rate", () => {
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1.5 }, events());
    expect(fake.rates).toEqual([1.5]);
  });

  it("ignores utterance events that arrive after stop", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, record);
    engine.stop();

    // Browsers fire onend for the utterance cancel() killed. The generation
    // guard must swallow it rather than advancing to the next chunk.
    fake.finishCurrent();
    expect(record.starts).toEqual([0]);
    expect(record.ended).toBe(0);
    expect(fake.spoken).toEqual(["First sentence."]);
  });

  it("restarts the current chunk at the new rate", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, record);
    fake.finishCurrent(); // now on chunk 1
    engine.setRate(2);

    expect(fake.spoken).toEqual([
      "First sentence.",
      "Second sentence.",
      "Second sentence.",
    ]);
    expect(fake.rates[2]).toBe(2);
    expect(record.starts).toEqual([0, 1, 1]);
  });

  it("pauses and resumes through the native API when it works", () => {
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, events());
    engine.pause();
    expect(fake.paused).toBe(true);
    engine.resume();
    expect(fake.paused).toBe(false);
    expect(fake.spoken).toHaveLength(1); // no restart needed
  });

  it("falls back to cancel-and-replay when pause is ignored", () => {
    vi.useFakeTimers();
    fake.breakPause();
    const engine = createWebSpeechEngine();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, events());

    engine.pause();
    vi.advanceTimersByTime(200);
    expect(fake.cancelled).toBeGreaterThan(0);

    engine.resume();
    expect(fake.spoken).toEqual(["First sentence.", "First sentence."]);
  });

  it("reports errors", () => {
    const engine = createWebSpeechEngine();
    const record = events();
    engine.play(CHUNKS, 0, { voiceId: null, rate: 1 }, record);
    fake.failCurrent("synthesis-failed");
    expect(record.errors).toEqual(["synthesis-failed"]);
  });

  it("returns voices immediately when the browser already has them", async () => {
    const engine = createWebSpeechEngine();
    await expect(engine.listVoices()).resolves.toEqual([
      { id: "urn:zira", label: "Zira", lang: "en-US" },
      { id: "urn:david", label: "David", lang: "en-US" },
    ]);
  });

  it("waits for voiceschanged when the first call is empty", async () => {
    fake.restore();
    fake = installFakeSpeech({ voices: [] });
    const engine = createWebSpeechEngine();
    const pending = engine.listVoices();
    fake.publishVoices(VOICES);
    await expect(pending).resolves.toHaveLength(2);
  });
});
