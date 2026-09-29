"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReaderLayoutProvider } from "@/components/reader-layout";

const WIDTH_KEY = "stash:split-width";
const FULL_WIDTH_KEY = "stash:reader-full-width";
const DEFAULT_WIDTH = 416; // 26rem — matches the previous fixed column
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const KEYBOARD_STEP = 24;

function clamp(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

/**
 * Client half of the desktop split view: list pane with adjustable width,
 * draggable divider, reader pane. Width persists in localStorage; the
 * divider supports arrow keys and double-click-to-reset. Below lg only the
 * list renders (the divider and reader pane are hidden), so the inline
 * width is applied through a CSS variable used only by an lg: class.
 *
 * The reader's full-width mode is owned here too, since it is the list pane
 * that has to disappear — the toolbar button that toggles it reaches this
 * state through ReaderLayoutProvider. It only takes effect at lg and up: below
 * that the reader is a page of its own and there is no list beside it to hide.
 */
export function SplitPanes({
  list,
  reader,
}: {
  list: React.ReactNode;
  reader: React.ReactNode;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [listHidden, setListHidden] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(WIDTH_KEY));
      if (stored >= MIN_WIDTH && stored <= MAX_WIDTH) setWidth(stored);
      setListHidden(window.localStorage.getItem(FULL_WIDTH_KEY) === "1");
    } catch {
      // localStorage unavailable — keep the defaults.
    }
  }, []);

  function persist(value: number) {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(value));
    } catch {
      // Best effort only.
    }
  }

  const hideList = useCallback((hidden: boolean) => {
    setListHidden(hidden);
    try {
      window.localStorage.setItem(FULL_WIDTH_KEY, hidden ? "1" : "0");
    } catch {
      // Best effort only.
    }
  }, []);

  const layout = useMemo(
    () => ({ listHidden, setListHidden: hideList }),
    [listHidden, hideList],
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag) return;
    setWidth(clamp(drag.startWidth + (e.clientX - drag.startX)));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    dragState.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setWidth((current) => {
      persist(current);
      return current;
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      e.key === "ArrowLeft" ? -KEYBOARD_STEP : e.key === "ArrowRight" ? KEYBOARD_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    setWidth((current) => {
      const next = clamp(current + delta);
      persist(next);
      return next;
    });
  }

  function resetWidth() {
    setWidth(DEFAULT_WIDTH);
    persist(DEFAULT_WIDTH);
  }

  return (
    <ReaderLayoutProvider value={layout}>
      <div
        className="lg:flex lg:h-screen"
        style={{ "--list-pane-width": `${width}px` } as React.CSSProperties}
      >
        <div
          className={`lg:w-[var(--list-pane-width)] lg:shrink-0 lg:overflow-y-auto lg:bg-white ${
            listHidden ? "lg:hidden" : ""
          }`}
        >
          <div className="mx-auto max-w-2xl px-4 py-6 lg:mx-0 lg:max-w-none">
            {list}
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize article list"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          onDoubleClick={resetWidth}
          className={`hidden shrink-0 cursor-col-resize touch-none border-l border-slate-200 transition-colors hover:border-violet-400 focus-visible:border-violet-600 focus-visible:outline-none active:border-violet-500 lg:w-1 ${
            listHidden ? "" : "lg:block"
          }`}
        />

        <div className="hidden min-w-0 flex-1 lg:block lg:h-full lg:overflow-y-auto">
          {reader}
        </div>
      </div>
    </ReaderLayoutProvider>
  );
}
