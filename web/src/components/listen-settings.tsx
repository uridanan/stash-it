"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Toggle } from "@/components/toggle";
import type { TtsEngine, TtsVoice } from "@/lib/tts/engine";
import {
  createWebSpeechEngine,
  isSpeechSupported,
} from "@/lib/tts/web-speech-engine";
import { engineRate, RATES } from "@/lib/tts/rate";

/**
 * Voice and speed for listen mode.
 *
 * Client-only on purpose: these are stored in localStorage, not on the User
 * row, because the available voices come from the operating system and differ
 * per device. Syncing the choice across devices would produce broken state.
 */

const VOICE_KEY = "stash:tts-voice";
const RATE_KEY = "stash:tts-rate";
const SAMPLE =
  "The quiet revival of slow reading began, as these things often do, without an announcement.";

const selectClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-violet-600 focus:bg-white";

export function ListenSettings() {
  const engineRef = useRef<TtsEngine | null>(null);
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [rate, setRate] = useState(1);
  const [loading, setLoading] = useState(true);
  const [markReadOnListen, setMarkReadOnListen] = useState(false);
  const [savingSetting, setSavingSetting] = useState(false);

  useEffect(() => {
    if (!isSpeechSupported()) {
      setSupported(false);
      setLoading(false);
      return;
    }
    const engine = createWebSpeechEngine();
    engineRef.current = engine;

    try {
      setVoiceId(window.localStorage.getItem(VOICE_KEY) ?? "");
      const storedRate = Number(window.localStorage.getItem(RATE_KEY));
      if ((RATES as readonly number[]).includes(storedRate)) {
        setRate(storedRate);
      }
    } catch {
      // Private mode — defaults are fine.
    }

    // Unlike voice and speed, this one belongs to the account rather than the
    // device: it changes what happens to articles, not how they sound.
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setMarkReadOnListen(Boolean(data.markReadOnListen));
      })
      .catch(() => {
        // Leave it off if settings cannot be read.
      });

    let cancelled = false;
    engine.listVoices().then((list) => {
      if (cancelled) return;
      setVoices(list);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      engine.stop();
    };
  }, []);

  /** Voices grouped by language, so a long list stays navigable. */
  const grouped = useMemo(() => {
    const groups = new Map<string, TtsVoice[]>();
    for (const voice of voices) {
      const list = groups.get(voice.lang) ?? [];
      list.push(voice);
      groups.set(voice.lang, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [voices]);

  async function saveMarkRead(next: boolean) {
    setMarkReadOnListen(next);
    setSavingSetting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markReadOnListen: next }),
      });
      if (!res.ok) setMarkReadOnListen(!next); // revert on failure
    } catch {
      setMarkReadOnListen(!next);
    } finally {
      setSavingSetting(false);
    }
  }

  function persist(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Best effort only.
    }
  }

  const markReadToggle = (
    <Toggle
      checked={markReadOnListen}
      onChange={(next) => void saveMarkRead(next)}
      disabled={savingSetting}
      label="Mark an article as read when narration finishes it"
      description="Only on reaching the end — skipping ahead with next leaves it unread."
      testId="mark-read-on-listen"
    />
  );

  if (!supported) {
    return (
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-600">
          This browser has no speech synthesis support, so listening is
          unavailable here.
        </p>
        {markReadToggle}
      </div>
    );
  }

  if (!loading && voices.length === 0) {
    return (
      <div className="mt-4 space-y-4">
        <p data-testid="listen-no-voices" className="text-sm text-slate-600">
          This device reports no text-to-speech voices. Install voices in your
          operating system&apos;s speech settings, then reload this page.
        </p>
        {markReadToggle}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label
          htmlFor="tts-voice"
          className="block text-sm font-medium text-slate-700"
        >
          Voice
        </label>
        <div className="mt-1 flex gap-2">
          <select
            id="tts-voice"
            data-testid="tts-voice"
            value={voiceId}
            disabled={loading}
            onChange={(event) => {
              setVoiceId(event.target.value);
              persist(VOICE_KEY, event.target.value);
            }}
            className={selectClass}
          >
            <option value="">System default</option>
            {grouped.map(([lang, list]) => (
              <optgroup key={lang} label={lang}>
                {list.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            data-testid="tts-preview"
            onClick={() =>
              engineRef.current?.preview(voiceId || null, SAMPLE, engineRate(rate))
            }
            className="shrink-0 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100"
          >
            ▸ Preview
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Voices come from your operating system, so this list differs on each
          device — and so does the choice, which is stored locally.
        </p>
      </div>

      <div>
        <label
          htmlFor="tts-rate"
          className="block text-sm font-medium text-slate-700"
        >
          Default speed
        </label>
        <select
          id="tts-rate"
          data-testid="tts-rate-default"
          value={rate}
          onChange={(event) => {
            const next = Number(event.target.value);
            setRate(next);
            persist(RATE_KEY, String(next));
          }}
          className={`${selectClass} mt-1`}
        >
          {RATES.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>

      {markReadToggle}
    </div>
  );
}
