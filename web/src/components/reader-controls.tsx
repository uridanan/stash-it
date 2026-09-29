"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useListen } from "@/components/listen/listen-provider";
import { ArticleActions } from "@/components/article-actions";
import { DownloadMenu } from "@/components/download-menu";
import { useReaderLayout } from "@/components/reader-layout";
import {
  CheckIcon,
  CloseIcon,
  ExpandIcon,
  HeadphonesIcon,
  PanelLeftIcon,
  StarIcon,
  StopIcon,
  TextLargerIcon,
  TextSmallerIcon,
} from "@/components/icons";

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 26;
const FONT_SIZE_STEP = 2;
const FONT_SIZE_KEY = "stash:font-size";

/**
 * The reader's toolbar.
 *
 * Every control is an icon with a tooltip: the bar carries ten actions and
 * labelling them all in words pushed the row past the width of a split pane.
 * The left half is about the view — leave, widen, resize the text — and the
 * right half is about the article. Fetch, summarize and delete sit in the
 * overflow menu because they are rare and, in one case, irreversible.
 */
export function ReaderControls({
  articleId,
  starred,
  archived,
  aiConfigured,
  kindleConfigured,
  children,
}: {
  articleId: string;
  starred: boolean;
  archived: boolean;
  aiConfigured: boolean;
  kindleConfigured: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const listen = useListen();
  // Null on the standalone /article page, where there is no list beside the
  // reader and so nothing for the full-width button to hide.
  const layout = useReaderLayout();
  const [fontSize, setFontSize] = useState(18);
  const [busy, setBusy] = useState(false);

  /**
   * Leave the reader after close/archive/delete. On the standalone /article
   * page that means going home; in the desktop split view it means clearing
   * the ?article= selection while keeping the list (and any search) in place.
   */
  function exitReader() {
    if (pathname.startsWith("/article")) {
      router.push("/");
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete("article");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    router.refresh();
  }

  useEffect(() => {
    try {
      const storedSize = Number(window.localStorage.getItem(FONT_SIZE_KEY));
      if (storedSize >= MIN_FONT_SIZE && storedSize <= MAX_FONT_SIZE) {
        setFontSize(storedSize);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — use the default.
    }
  }, []);

  function adjustFontSize(delta: number) {
    setFontSize((current) => {
      const next = Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FONT_SIZE, current + delta)
      );
      try {
        window.localStorage.setItem(FONT_SIZE_KEY, String(next));
      } catch {
        // Best effort only.
      }
      return next;
    });
  }

  async function toggleStar() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !starred }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Read/unread is one state; the tick carries it in its colour. */
  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: archived ? "unread" : "archived" }),
      });
      if (res.ok) {
        if (archived) {
          router.refresh();
        } else {
          exitReader();
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const controlButton =
    "flex items-center justify-center rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div>
      <div className="sticky top-12 z-10 -mx-4 border-b border-slate-200 bg-paper/95 px-4 py-2 backdrop-blur-sm md:top-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={exitReader}
            title="Close article"
            aria-label="Close article"
            data-testid="reader-close"
            className={controlButton}
          >
            <CloseIcon />
          </button>

          {layout && (
            <button
              type="button"
              onClick={() => layout.setListHidden(!layout.listHidden)}
              title={layout.listHidden ? "Show the article list" : "Full width"}
              aria-label={layout.listHidden ? "Show the article list" : "Full width"}
              aria-pressed={layout.listHidden}
              data-testid="reader-full-width"
              className={`${controlButton} ${layout.listHidden ? "text-violet-700" : ""}`}
            >
              {layout.listHidden ? <PanelLeftIcon /> : <ExpandIcon />}
            </button>
          )}

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

          <button
            type="button"
            onClick={() => adjustFontSize(-FONT_SIZE_STEP)}
            disabled={fontSize <= MIN_FONT_SIZE}
            title="Decrease text size"
            aria-label="Decrease text size"
            data-testid="font-smaller"
            className={controlButton}
          >
            <TextSmallerIcon />
          </button>
          <button
            type="button"
            onClick={() => adjustFontSize(FONT_SIZE_STEP)}
            disabled={fontSize >= MAX_FONT_SIZE}
            title="Increase text size"
            aria-label="Increase text size"
            data-testid="font-larger"
            className={controlButton}
          >
            <TextLargerIcon />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={toggleStar}
              title={starred ? "Unstar" : "Star"}
              aria-label={starred ? "Unstar" : "Star"}
              aria-pressed={starred}
              data-testid="reader-star-toggle"
              className={`${controlButton} ${
                starred ? "text-cyan-600 hover:text-cyan-700" : ""
              }`}
            >
              <StarIcon filled={starred} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={toggleArchive}
              title={archived ? "Mark as unread" : "Mark as read"}
              aria-label={archived ? "Mark as unread" : "Mark as read"}
              aria-pressed={archived}
              data-testid="reader-read-toggle"
              className={`${controlButton} ${
                archived ? "text-violet-600 hover:text-violet-700" : ""
              }`}
            >
              <CheckIcon />
            </button>

            <DownloadMenu articleId={articleId} buttonClass={controlButton} />

            {listen.supported && (
              <button
                type="button"
                onClick={listen.status === "idle" ? listen.start : listen.stop}
                disabled={!listen.ready}
                title={
                  listen.ready
                    ? listen.status === "idle"
                      ? "Listen to this article (L)"
                      : "Stop listening"
                    : "No text-to-speech voices are installed on this device"
                }
                aria-label={
                  listen.status === "idle"
                    ? "Listen to this article"
                    : "Stop listening"
                }
                data-testid="listen-start"
                className={`${controlButton} ${
                  listen.status !== "idle" ? "text-violet-700" : ""
                }`}
              >
                {listen.status === "idle" ? <HeadphonesIcon /> : <StopIcon />}
              </button>
            )}

            <ArticleActions
              articleId={articleId}
              aiConfigured={aiConfigured}
              kindleConfigured={kindleConfigured}
              onDeleted={exitReader}
              buttonClass={controlButton}
            />
          </div>
        </div>
      </div>

      <div style={{ "--reader-font-size": `${fontSize}px` } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
}
