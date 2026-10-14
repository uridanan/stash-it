"use client";

import { useEffect, useState } from "react";

import { TextLargerIcon, TextSmallerIcon } from "@/components/icons";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_STEP,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readFontSize,
  writeFontSize,
} from "@/components/reader-font";

/**
 * Reading appearance. Text size used to live on the article toolbar; it is a
 * preference about how you read, so it lives with the other settings and the
 * reader just applies whatever is stored.
 */
export function AppearanceSettings() {
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);

  useEffect(() => {
    setFontSize(readFontSize());
  }, []);

  function adjust(delta: number) {
    setFontSize((current) => writeFontSize(current + delta));
  }

  const buttonClass =
    "flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40";

  return (
    <div
      data-testid="appearance-settings"
      className="mt-4 flex items-center gap-3"
    >
      <span className="text-sm text-slate-700">Article text</span>
      <button
        type="button"
        onClick={() => adjust(-FONT_SIZE_STEP)}
        disabled={fontSize <= MIN_FONT_SIZE}
        title="Decrease text size"
        aria-label="Decrease text size"
        data-testid="font-smaller"
        className={buttonClass}
      >
        <TextSmallerIcon />
      </button>
      <span className="w-12 text-center text-sm tabular-nums text-slate-500">
        {fontSize}px
      </span>
      <button
        type="button"
        onClick={() => adjust(FONT_SIZE_STEP)}
        disabled={fontSize >= MAX_FONT_SIZE}
        title="Increase text size"
        aria-label="Increase text size"
        data-testid="font-larger"
        className={buttonClass}
      >
        <TextLargerIcon />
      </button>
    </div>
  );
}
