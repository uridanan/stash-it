"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TtsChunk, TtsEngine, TtsEvents, TtsVoice } from "@/lib/tts/engine";
import { primaryLanguage } from "@/lib/lang";
import { engineRate, isKnownRate } from "@/lib/tts/rate";
import { forwardTarget, rewindTarget } from "@/lib/tts/rewind";
import {
  createWebSpeechEngine,
  isSpeechSupported,
} from "@/lib/tts/web-speech-engine";
import {
  CHUNK_ATTR,
  unwrapSentences,
  wrapSentences,
} from "@/components/listen/wrap-sentences";

/**
 * Owns listen-mode state for the whole app.
 *
 * This lives in `AppShell`, not in the reader: a playlist plays across several
 * articles, and App Router navigation is client-side, so keeping the provider
 * mounted above the page keeps both this state and the `speechSynthesis`
 * singleton (with its iOS user-gesture grant) alive across the hop.
 *
 * The reader registers its content via `ListenRoot`. Narration sources are
 * still read from `[data-listen]` containers in DOM order, so "what is on
 * screen" remains the only rule for *which* text gets read.
 */

export { RATES } from "@/lib/tts/rate";

const VOICE_KEY = "stash:tts-voice";
const RATE_KEY = "stash:tts-rate";
const QUEUE_KEY = "stash:listen-queue";
const REWIND_SECONDS = 10;

export type ReaderTab = "summary" | "article";
export type ListenStatus = "idle" | "playing" | "paused";

export interface ListenQueue {
  tagSlug: string;
  tagName: string;
  articleIds: string[];
  index: number;
  /**
   * Whether narration should resume as soon as an article registers.
   *
   * Navigating remounts `AppShell` and therefore this provider, so in-memory
   * intent does not survive the hop — it has to ride along with the queue in
   * sessionStorage.
   */
  autoplay: boolean;
}

export interface ListenRootMeta {
  element: HTMLElement;
  articleId: string;
  title: string;
  lang: string | null;
}

export interface ListenContextValue {
  supported: boolean;
  ready: boolean;
  status: ListenStatus;
  activeIndex: number;
  totalChunks: number;
  partLabel: string;
  rate: number;
  error: string | null;
  notice: string | null;
  exactSeek: boolean;
  tab: ReaderTab;
  queue: ListenQueue | null;
  hasNext: boolean;
  hasPrevious: boolean;
  setTab(tab: ReaderTab): void;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  rewind(): void;
  forward(): void;
  setRate(rate: number): void;
  next(): void;
  previous(): void;
  /** Begin a playlist. Navigates to its first article and starts there. */
  playQueue(tagSlug: string, tagName: string, articleIds: string[]): void;
  registerRoot(meta: ListenRootMeta): void;
  unregisterRoot(articleId: string): void;
}

const ListenContext = createContext<ListenContextValue | null>(null);

export function useListen(): ListenContextValue {
  const value = useContext(ListenContext);
  if (!value) throw new Error("useListen must be used inside a ListenProvider");
  return value;
}

function readStored<T>(key: string, parse: (raw: string) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : parse(raw);
  } catch {
    return null; // private mode — fall back to defaults
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort only.
  }
}

export function ListenProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const engineRef = useRef<TtsEngine | null>(null);
  const chunksRef = useRef<TtsChunk[]>([]);
  const elementsRef = useRef<Map<number, HTMLElement[]>>(new Map());
  const labelsRef = useRef<string[]>([]);
  const chunkStartedAtRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  /**
   * True while navigating between articles for a queue. Distinguishes "the
   * reader unmounted because we're moving to the next track" from "the user
   * navigated away", which must stop playback.
   */
  const advancingRef = useRef(false);

  const [root, setRoot] = useState<ListenRootMeta | null>(null);
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [status, setStatus] = useState<ListenStatus>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [totalChunks, setTotalChunks] = useState(0);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTabState] = useState<ReaderTab>("summary");
  const [queue, setQueue] = useState<ListenQueue | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  /** Account setting: mark an article read once narration reaches its end. */
  const markReadOnListenRef = useRef(false);

  // Engine, stored preferences and voices resolve up front: iOS requires the
  // first speak() to happen inside the click handler, so start() never awaits.
  useEffect(() => {
    if (!isSpeechSupported()) return;
    setSupported(true);
    const engine = createWebSpeechEngine();
    engineRef.current = engine;

    const storedRate = readStored(RATE_KEY, (raw) => {
      const value = Number(raw);
      return isKnownRate(value) ? value : null;
    });
    if (storedRate !== null) setRateState(storedRate);
    setVoiceId(readStored(VOICE_KEY, (raw) => raw));

    try {
      const raw = window.sessionStorage.getItem(QUEUE_KEY);
      if (raw) {
        const restored = JSON.parse(raw) as ListenQueue;
        setQueue(restored);
        // Mid-playlist: pick up where the previous page left off as soon as
        // the article registers itself.
        if (restored.autoplay) {
          setStatus("playing");
          setAutoStart(true);
        }
      }
    } catch {
      // Corrupt or unavailable — start without a queue.
    }

    let cancelled = false;
    engine.listVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });

    // Read once per mount. A ref rather than state: only the completion
    // handler consults it, and it must not re-create the engine callbacks.
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          markReadOnListenRef.current = Boolean(data.markReadOnListen);
        }
      })
      .catch(() => {
        // Setting unavailable — leave articles untouched.
      });

    return () => {
      cancelled = true;
      engine.stop();
    };
  }, []);

  const saveQueue = useCallback((next: ListenQueue | null) => {
    setQueue(next);
    try {
      if (next) window.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(next));
      else window.sessionStorage.removeItem(QUEUE_KEY);
    } catch {
      // Best effort only.
    }
  }, []);

  const highlight = useCallback((index: number) => {
    for (const [chunkIndex, elements] of elementsRef.current) {
      for (const element of elements) {
        element.classList.toggle("listen-active", chunkIndex === index);
      }
    }
    const first = elementsRef.current.get(index)?.[0];
    if (!first) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    first.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const clearHighlight = useCallback(() => {
    const element = root?.element;
    if (!element) return;
    for (const span of element.querySelectorAll(`[${CHUNK_ATTR}]`)) {
      span.classList.remove("listen-active");
    }
  }, [root]);

  /**
   * Wraps whatever the registered reader has on screen.
   *
   * Reports body chunks separately from the total: every article has a title,
   * so a total of one means there is nothing to actually read.
   */
  const collect = useCallback((): { chunks: TtsChunk[]; bodyCount: number } => {
    const element = root?.element;
    if (!element) return { chunks: [], bodyCount: 0 };

    const containers = Array.from(
      element.querySelectorAll<HTMLElement>("[data-listen]"),
    );
    for (const container of containers) unwrapSentences(container);

    const chunks: TtsChunk[] = [];
    const elements = new Map<number, HTMLElement[]>();
    const labels: string[] = [];

    const trimmedTitle = root.title.trim();
    if (trimmedTitle) {
      chunks.push({ index: 0, text: trimmedTitle });
      labels.push("Title");
    }

    for (const container of containers) {
      const part = container.dataset.listen === "summary" ? "Summary" : "Article";
      for (const wrapped of wrapSentences(container, chunks.length)) {
        chunks.push({ index: wrapped.index, text: wrapped.text });
        elements.set(wrapped.index, wrapped.elements);
        labels.push(part);
      }
    }

    chunksRef.current = chunks;
    elementsRef.current = elements;
    labelsRef.current = labels;
    return { chunks, bodyCount: chunks.length - (trimmedTitle ? 1 : 0) };
  }, [root]);

  /**
   * Where a queued article lives. Routing through the collection rather than
   * straight to /article keeps the desktop split view — the running order stays
   * beside whatever is playing.
   */
  const queueHref = useCallback((tagSlug: string, articleId: string) => {
    // Below lg the split view renders the list only, so routing through the
    // collection would leave nothing on screen to narrate. Match what the rows
    // themselves do and go to the standalone reader instead.
    const splitView = window.matchMedia("(min-width: 1024px)").matches;
    if (!splitView) return `/article/${encodeURIComponent(articleId)}`;

    const params = new URLSearchParams({ article: articleId });
    // Carry the unread filter across, or starting a playlist would silently
    // widen the list the reader had narrowed.
    if (new URLSearchParams(window.location.search).get("unread") === "1") {
      params.set("unread", "1");
    }
    return `/tags/${encodeURIComponent(tagSlug)}?${params}`;
  }, []);

  /** Moves the queue by `delta`, navigating to that article. Returns false at the end. */
  const goTo = useCallback(
    (delta: number): boolean => {
      if (!queue) return false;
      const nextIndex = queue.index + delta;
      if (nextIndex < 0 || nextIndex >= queue.articleIds.length) return false;

      advancingRef.current = true;
      engineRef.current?.stop();
      setStatus("playing");
      setActiveIndex(-1);
      saveQueue({ ...queue, index: nextIndex, autoplay: true });
      setAutoStart(true);
      router.push(queueHref(queue.tagSlug, queue.articleIds[nextIndex]));
      return true;
    },
    [queue, queueHref, router, saveQueue],
  );

  /** Whether this device can speak the registered article's language. */
  const voiceMissingFor = useCallback(
    (lang: string | null): string | null => {
      const wanted = primaryLanguage(lang);
      if (!wanted || voices.length === 0) return null;
      const covered = voices.some(
        (voice) => primaryLanguage(voice.lang) === wanted,
      );
      return covered ? null : wanted;
    },
    [voices],
  );

  /**
   * Marks the article just finished as read, when the setting asks for it.
   *
   * Only on reaching the end: skipping past an article with next is explicitly
   * not finishing it, so it stays unread.
   */
  const markFinishedRead = useCallback((articleId: string | undefined) => {
    if (!markReadOnListenRef.current || !articleId) return;
    void fetch(`/api/articles/${articleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "archived" }),
    }).catch(() => {
      // Best effort: playback matters more than the flag.
    });
  }, []);

  const makeEvents = useCallback(
    (): TtsEvents => ({
      onChunkStart(index) {
        chunkStartedAtRef.current = performance.now();
        elapsedBeforePauseRef.current = 0;
        setActiveIndex(index);
        highlight(index);
      },
      onEnd() {
        // End of an article: move to the next track, or finish.
        markFinishedRead(root?.articleId);
        if (goTo(1)) return;
        saveQueue(null);
        setStatus("idle");
        setActiveIndex(-1);
        clearHighlight();
      },
      onError(message) {
        setStatus("idle");
        setActiveIndex(-1);
        clearHighlight();
        setError(message);
      },
    }),
    [clearHighlight, goTo, highlight, markFinishedRead, root, saveQueue],
  );

  const startFrom = useCallback(
    (fromIndex: number) => {
      const engine = engineRef.current;
      if (!engine) return;

      const missing = voiceMissingFor(root?.lang ?? null);
      if (missing) {
        // Device-specific, so it is decided here rather than stored as a tag.
        setNotice(
          `No ${missing.toUpperCase()} voice is installed on this device — skipping.`,
        );
        if (goTo(1)) return;
        saveQueue(null);
        setStatus("idle");
        return;
      }

      const { chunks, bodyCount } = collect();
      setTotalChunks(chunks.length);
      setError(null);
      // A title with no body is not worth narrating — this is the playback-time
      // half of the "Won't narrate" tag.
      if (bodyCount === 0) {
        // Nothing narratable here. In a queue that is a skip, not an error.
        if (queue) {
          setNotice("Nothing to read in that one — skipping.");
          if (goTo(1)) return;
          saveQueue(null);
          setStatus("idle");
          return;
        }
        setError("There is nothing to read on screen.");
        setStatus("idle");
        return;
      }

      setNotice(null);
      setStatus("playing");
      engine.play(
        chunks,
        fromIndex,
        { voiceId, rate: engineRate(rate) },
        makeEvents(),
      );
    },
    [
      collect,
      goTo,
      makeEvents,
      queue,
      rate,
      root,
      saveQueue,
      voiceId,
      voiceMissingFor,
    ],
  );

  const start = useCallback(() => startFrom(0), [startFrom]);

  // Auto-start once the next article's content has registered itself.
  useEffect(() => {
    if (!autoStart || !root) return;
    if (queue && queue.articleIds[queue.index] !== root.articleId) {
      // Mid-advance the old article is still the registered one, because
      // router.push has not landed yet. Keep waiting for the right one.
      if (advancingRef.current) return;
      // Otherwise the reader opened something else themselves; the queue ends
      // rather than hijacking whatever they chose.
      setAutoStart(false);
      saveQueue(null);
      setStatus("idle");
      return;
    }
    setAutoStart(false);
    advancingRef.current = false;
    startFrom(0);
  }, [autoStart, queue, root, saveQueue, startFrom]);

  const pause = useCallback(() => {
    engineRef.current?.pause();
    elapsedBeforePauseRef.current +=
      performance.now() - chunkStartedAtRef.current;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
    chunkStartedAtRef.current = performance.now();
    setStatus("playing");
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    saveQueue(null);
    setStatus("idle");
    setActiveIndex(-1);
    setNotice(null);
    clearHighlight();
  }, [clearHighlight, saveQueue]);

  const rewind = useCallback(() => {
    if (status === "idle") return;
    const elapsed =
      elapsedBeforePauseRef.current +
      (status === "playing" ? performance.now() - chunkStartedAtRef.current : 0);
    startFrom(
      rewindTarget(
        chunksRef.current,
        Math.max(activeIndex, 0),
        elapsed,
        rate,
        REWIND_SECONDS,
      ),
    );
  }, [activeIndex, rate, startFrom, status]);

  const forward = useCallback(() => {
    if (status === "idle") return;
    const elapsed =
      elapsedBeforePauseRef.current +
      (status === "playing" ? performance.now() - chunkStartedAtRef.current : 0);
    const target = forwardTarget(
      chunksRef.current,
      Math.max(activeIndex, 0),
      elapsed,
      rate,
      REWIND_SECONDS,
    );
    // Skipping past the last sentence means this article is done; let the queue
    // move on exactly as it would have on its own.
    if (target >= chunksRef.current.length) {
      markFinishedRead(root?.articleId);
      if (goTo(1)) return;
      engineRef.current?.stop();
      saveQueue(null);
      setStatus("idle");
      setActiveIndex(-1);
      clearHighlight();
      return;
    }
    startFrom(target);
  }, [
    activeIndex,
    clearHighlight,
    goTo,
    markFinishedRead,
    rate,
    root,
    saveQueue,
    startFrom,
    status,
  ]);

  const setRate = useCallback((next: number) => {
    setRateState(next);
    persist(RATE_KEY, String(next));
    engineRef.current?.setRate(engineRate(next));
  }, []);

  const setTab = useCallback(
    (next: ReaderTab) => {
      if (next === tab) return;
      if (status !== "idle") stop();
      setTabState(next);
    },
    [status, stop, tab],
  );

  const playQueue = useCallback(
    (tagSlug: string, tagName: string, articleIds: string[]) => {
      if (articleIds.length === 0) return;
      advancingRef.current = true;
      engineRef.current?.stop();
      saveQueue({ tagSlug, tagName, articleIds, index: 0, autoplay: true });
      setStatus("playing");
      setAutoStart(true);
      router.push(queueHref(tagSlug, articleIds[0]));
    },
    [queueHref, router, saveQueue],
  );

  const next = useCallback(() => {
    if (!goTo(1)) stop();
  }, [goTo, stop]);

  const previous = useCallback(() => {
    // Mirrors every music player: restart this article before stepping back.
    if (activeIndex > 0) {
      startFrom(0);
      return;
    }
    goTo(-1);
  }, [activeIndex, goTo, startFrom]);

  const registerRoot = useCallback((meta: ListenRootMeta) => {
    setRoot(meta);
  }, []);

  const unregisterRoot = useCallback((articleId: string) => {
    // Only forget the element. Stopping playback here would be wrong twice
    // over: React re-runs effects on mount in development, so this fires
    // spuriously, and a genuine navigation already unmounts the provider,
    // whose cleanup stops the engine.
    setRoot((current) => (current?.articleId === articleId ? null : current));
  }, []);

  /** `L` starts a session; the player owns the rest of the shortcuts. */
  useEffect(() => {
    if (!supported || status !== "idle" || !root) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "l" && event.key !== "L") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      start();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [root, start, status, supported]);

  const value = useMemo<ListenContextValue>(
    () => ({
      supported,
      ready: supported && voices.length > 0,
      status,
      activeIndex,
      totalChunks,
      partLabel: labelsRef.current[activeIndex] ?? "",
      rate,
      error,
      notice,
      exactSeek: engineRef.current?.capabilities.exactSeek ?? false,
      tab,
      queue,
      hasNext: queue !== null && queue.index < queue.articleIds.length - 1,
      hasPrevious: queue !== null && queue.index > 0,
      setTab,
      start,
      pause,
      resume,
      stop,
      rewind,
      forward,
      setRate,
      next,
      previous,
      playQueue,
      registerRoot,
      unregisterRoot,
    }),
    [
      activeIndex,
      error,
      next,
      notice,
      pause,
      playQueue,
      previous,
      queue,
      rate,
      registerRoot,
      resume,
      forward,
      rewind,
      setRate,
      setTab,
      start,
      status,
      stop,
      supported,
      tab,
      totalChunks,
      unregisterRoot,
      voices.length,
    ],
  );

  return (
    <ListenContext.Provider value={value}>{children}</ListenContext.Provider>
  );
}
