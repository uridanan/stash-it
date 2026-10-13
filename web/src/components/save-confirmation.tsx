"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The share-target landing card.
 *
 * The OS has already opened this window to deliver the link. Stay here: most
 * people want to go back to the app they shared from. The library opens only
 * when they ask for the article.
 */
export function SaveConfirmation({
  articleId,
  title,
  extractionFailed,
  pendingExtraction,
}: {
  articleId: string;
  title: string;
  extractionFailed: boolean;
  pendingExtraction: boolean;
}) {
  const [heading, setHeading] = useState(title);
  const [failed, setFailed] = useState(extractionFailed);
  const [pending, setPending] = useState(pendingExtraction);
  const [marked, setMarked] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/articles/${articleId}?view=status`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          title?: string;
          extractionFailed?: boolean;
          hasContent?: boolean;
        };
        if (!data.hasContent && !data.extractionFailed) return;
        if (cancelled) return;
        if (data.title) setHeading(data.title);
        setFailed(Boolean(data.extractionFailed));
        setPending(false);
      } catch {
        // Keep the confirmation up; the next poll retries.
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [articleId, pending]);

  async function markRead() {
    if (marking || marked) return;
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "archived" }),
      });
      if (res.ok) {
        setMarked(true);
      } else {
        setMarkError("Couldn't mark it as read. Try again.");
      }
    } catch {
      setMarkError("Couldn't mark it as read. Try again.");
    } finally {
      setMarking(false);
    }
  }

  function closeDialog() {
    // navigate-new gives this share its own window. Closing it returns to
    // the app the link was shared from. If the browser refuses, stay on this
    // card rather than opening the library.
    window.close();
  }

  const buttonClass =
    "flex min-h-12 w-full items-center justify-center rounded-lg px-4 py-3 text-base font-medium transition-colors disabled:opacity-60";

  return (
    <div data-testid="save-confirmation">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-2xl">
        ✓
      </div>
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Saved</h1>
      <p className="mb-1 text-lg font-medium text-slate-800">{heading}</p>
      {pending && (
        <p className="mb-2 text-base text-slate-500">Fetching the text…</p>
      )}
      {failed && (
        <p className="mb-2 text-base text-violet-700">
          We saved the link, but couldn&rsquo;t extract the article text.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void markRead()}
          disabled={marking || marked}
          data-testid="save-mark-read"
          className={`${buttonClass} border border-slate-300 text-slate-800 hover:bg-slate-50`}
        >
          {marked ? "Marked as read" : marking ? "Marking…" : "Mark as read"}
        </button>
        <Link
          href={`/article/${articleId}`}
          data-testid="save-open"
          className={`${buttonClass} bg-violet-600 text-white hover:bg-violet-700`}
        >
          Open article
        </Link>
        <button
          type="button"
          onClick={closeDialog}
          data-testid="save-close"
          className={`${buttonClass} border border-slate-300 text-slate-800 hover:bg-slate-50`}
        >
          Close
        </button>
      </div>
      {markError && <p className="mt-3 text-base text-red-600">{markError}</p>}
    </div>
  );
}
