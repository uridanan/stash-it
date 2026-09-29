"use client";

import { useEffect } from "react";

import { RATES, useListen } from "@/components/listen/listen-provider";

/**
 * Docked transport for listen mode. Renders only during a session.
 *
 * `sticky bottom-0` rather than `absolute`: on desktop the reader pane is
 * itself the scroll container, so `absolute` would pin to the bottom of the
 * content instead of the visible area. Sticky pins to the scrollport on
 * desktop and to the viewport on the mobile article page — one rule, both
 * breakpoints.
 */
/**
 * Transport icons are drawn rather than typed.
 *
 * U+23EE / U+23ED / U+23F8 default to *emoji* presentation, so the browser
 * substitutes its own coloured glyphs — they came out cobalt blue against a
 * violet and slate player. Inline SVG inherits `currentColor` and matches the
 * stroke weight used elsewhere in the app.
 */
const ICON_CLASS = "h-4 w-4";

function IconPrevious() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden>
      <path d="M7 5.5a1 1 0 0 1 1 1v11a1 1 0 0 1-2 0v-11a1 1 0 0 1 1-1Z" />
      <path d="M18.3 5.9a1 1 0 0 1 .7.95v10.3a1 1 0 0 1-1.55.83l-7.2-5.15a1 1 0 0 1 0-1.66l7.2-5.15a1 1 0 0 1 .85-.12Z" />
    </svg>
  );
}

function IconNext() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={ICON_CLASS} aria-hidden>
      <path d="M17 5.5a1 1 0 0 1 1 1v11a1 1 0 0 1-2 0v-11a1 1 0 0 1 1-1Z" />
      <path d="M5.7 5.9a1 1 0 0 1 .85.12l7.2 5.15a1 1 0 0 1 0 1.66l-7.2 5.15A1 1 0 0 1 5 17.15V6.85a1 1 0 0 1 .7-.95Z" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
      <path d="M8.5 5.4a1 1 0 0 1 1.52-.86l9 5.6a1 1 0 0 1 0 1.72l-9 5.6A1 1 0 0 1 8.5 16.6V5.4Z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
      <path d="M9 5h2.2v14H9zM12.8 5H15v14h-2.2z" />
    </svg>
  );
}

/** Circular arrow with the jump size written inside it. */
function IconSeek({ seconds, back }: { seconds: number; back: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={ICON_CLASS}
        aria-hidden
        style={back ? undefined : { transform: "scaleX(-1)" }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.5 9.5h5v-5M4.9 9.6a8 8 0 1 1-1.2 5.2"
        />
      </svg>
      <span className="text-[11px] tabular-nums">{seconds}</span>
    </span>
  );
}

export function ListenPlayer() {
  const {
    status,
    activeIndex,
    totalChunks,
    partLabel,
    rate,
    error,
    notice,
    exactSeek,
    queue,
    hasNext,
    hasPrevious,
    pause,
    resume,
    stop,
    rewind,
    forward,
    setRate,
    next,
    previous,
  } = useListen();

  const active = status !== "idle";

  // Desktop transport shortcuts. Skipped while typing in a field, and while
  // idle so they never fight the rest of the page.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (status === "playing") pause();
        else resume();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        rewind();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        forward();
      } else if (event.key === "Escape") {
        event.preventDefault();
        stop();
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        next();
      } else if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        previous();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, forward, next, pause, previous, resume, rewind, status, stop]);

  if (!active && !error && !notice) return null;

  const spoken = Math.max(activeIndex + 1, 0);
  const percent = totalChunks > 0 ? (spoken / totalChunks) * 100 : 0;
  const buttonClass =
    "flex items-center justify-center rounded-md px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

  return (
    <div
      data-testid="listen-player"
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-slate-200 bg-paper/95 px-4 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-sm"
    >
      {error ? (
        <p data-testid="listen-error" className="pb-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p data-testid="listen-notice" className="pb-2 text-sm text-slate-500">
          {notice}
        </p>
      ) : null}

      {active ? (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span data-testid="listen-position" className="shrink-0">
              {queue ? (
                <span
                  data-testid="listen-queue-position"
                  className="text-violet-700"
                >
                  {queue.tagName} {queue.index + 1}/{queue.articleIds.length}
                  {" · "}
                </span>
              ) : null}
              {partLabel} · {spoken}/{totalChunks}
            </span>
            <div
              role="progressbar"
              aria-label="Listening progress"
              aria-valuemin={0}
              aria-valuemax={totalChunks}
              aria-valuenow={spoken}
              className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200"
            >
              <div
                className="h-full bg-violet-600 transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/*
            Three equal columns so the transport stays optically centred on the
            play button regardless of whether the queue controls are present:
            speed on the left, stop on the right, both the same fixed width.
          */}
          <div className="mt-1 flex items-center gap-2 pb-2">
            <div className="flex w-20 shrink-0 items-center">
              <label className="flex items-center text-xs text-slate-500">
                <span className="sr-only">Reading speed</span>
                <select
                  value={rate}
                  onChange={(event) => setRate(Number(event.target.value))}
                  data-testid="listen-rate"
                  aria-label="Reading speed"
                  className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-violet-600"
                >
                  {RATES.map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-1 items-center justify-center gap-1">
              {queue ? (
                <button
                  type="button"
                  onClick={previous}
                  // Still useful on the first article: it restarts it, the way
                  // every music player's back button does.
                  disabled={!hasPrevious && activeIndex <= 0}
                  title="Previous article"
                  aria-label="Previous article"
                  data-testid="listen-previous"
                  className={buttonClass}
                >
                  <IconPrevious />
                </button>
              ) : null}
              <button
                type="button"
                onClick={rewind}
                title={exactSeek ? "Back 10 seconds" : "Back about 10 seconds"}
                aria-label="Rewind 10 seconds"
                data-testid="listen-rewind"
                className={buttonClass}
              >
                <IconSeek seconds={10} back />
              </button>

              <button
                type="button"
                onClick={status === "playing" ? pause : resume}
                title={status === "playing" ? "Pause" : "Play"}
                aria-label={status === "playing" ? "Pause" : "Play"}
                data-testid="listen-toggle"
                className="mx-1 flex h-11 w-11 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm transition-colors hover:bg-violet-700"
              >
                {status === "playing" ? <IconPause /> : <IconPlay />}
              </button>

              <button
                type="button"
                onClick={forward}
                title={
                  exactSeek ? "Forward 10 seconds" : "Forward about 10 seconds"
                }
                aria-label="Forward 10 seconds"
                data-testid="listen-forward"
                className={buttonClass}
              >
                <IconSeek seconds={10} back={false} />
              </button>

              <button
                type="button"
                onClick={next}
                disabled={!queue || !hasNext}
                title="Next article"
                aria-label="Next article"
                data-testid="listen-next"
                className={`${buttonClass} ${queue ? "" : "invisible"}`}
              >
                <IconNext />
              </button>
            </div>

            <div className="flex w-20 shrink-0 justify-end">
              <button
                type="button"
                onClick={stop}
                title="Stop listening"
                aria-label="Stop listening"
                data-testid="listen-stop"
                className={buttonClass}
              >
                ✕
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
