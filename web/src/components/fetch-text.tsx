"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Offers to fetch the text of a stub — an article imported from a URL-only
 * source, which has metadata but no content yet.
 */
export function FetchText({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchText() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}/extract`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Could not fetch it (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="fetch-text"
      className="mt-6 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-slate-700"
    >
      <p>
        This one came in as a link, without its text — imports carry the
        metadata but not the article itself.
      </p>
      <button
        type="button"
        onClick={fetchText}
        disabled={busy}
        data-testid="fetch-text-button"
        className="mt-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-60"
      >
        {busy ? "Fetching…" : "Get the full text"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
