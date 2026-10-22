"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { announceArticleRead, useAnnouncedRead } from "@/components/article-read";
import { useListen } from "@/components/listen/listen-provider";
import { useWakeLock } from "@/components/use-wake-lock";
import { ArticleActions } from "@/components/article-actions";
import { DownloadMenu } from "@/components/download-menu";
import { useReaderLayout } from "@/components/reader-layout";
import { readFontSize } from "@/components/reader-font";
import {
  CheckIcon,
  CloseIcon,
  ExpandIcon,
  HeadphonesIcon,
  PanelLeftIcon,
  StarIcon,
  StopIcon,
} from "@/components/icons";

/**
 * The reader's toolbar.
 *
 * Every control is an icon with a tooltip, and the row stays on one line:
 * leave, widen, then star, read, listen, download, and the overflow menu.
 * Text size lives in Settings → Appearance. Fetch, summarize and delete sit
 * in the overflow menu because they are rare and, in one case, irreversible.
 */
export function ReaderControls({
  articleId,
  starred,
  archived,
  kindleConfigured,
  canFetch = true,
  children,
}: {
  articleId: string;
  starred: boolean;
  archived: boolean;
  kindleConfigured: boolean;
  /** False when the article has no page to fetch, such as one saved as text. */
  canFetch?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const listen = useListen();
  // Reading keeps the screen on even when nothing is being spoken.
  useWakeLock(true);
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
    setFontSize(readFontSize());
  }, []);

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
      const nextRead = !shownArchived;
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextRead ? "archived" : "unread" }),
      });
      if (res.ok) {
        announceArticleRead(articleId, nextRead);
        if (nextRead) {
          exitReader();
        } else {
          router.refresh();
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const controlButton =
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent";
  // A listen can mark this article read without the page props changing yet.
  const shownArchived = useAnnouncedRead(articleId, archived) ?? archived;

  return (
    <div>
      <div className="sticky top-16 z-10 -mx-4 border-b border-slate-200 bg-paper/95 px-2 py-2 backdrop-blur-sm md:top-0">
        <div className="flex flex-nowrap items-center gap-1">
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

          <div className="ml-auto flex items-center justify-end gap-1">
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
              title={shownArchived ? "Mark as unread" : "Mark as read"}
              aria-label={shownArchived ? "Mark as unread" : "Mark as read"}
              aria-pressed={shownArchived}
              data-testid="reader-read-toggle"
              className={`${controlButton} ${
                shownArchived
                  ? "text-cyan-600 hover:text-cyan-700"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <CheckIcon />
            </button>

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

            <DownloadMenu articleId={articleId} buttonClass={controlButton} />

            <ArticleActions
              articleId={articleId}
              kindleConfigured={kindleConfigured}
              canFetch={canFetch}
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
