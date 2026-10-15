"use client";

import { useEffect, useState } from "react";

/**
 * The desktop way to save a page: a bookmark whose address sends the current
 * URL to Stash. The link has to be real (javascript:) so it can be dragged
 * onto the bookmarks bar, which is why it is not a React href.
 */
export function Bookmarklet() {
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!origin) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const code = `javascript:location.href='${origin}/save?url='+encodeURIComponent(location.href)`;

  const linkHtml = `<a href="${escapeHtml(code)}" class="inline-flex min-h-12 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800">Save to Stash</a>`;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; the user can select the text manually.
    }
  }

  return (
    <div data-testid="bookmarklet" className="mt-4">
      <div dangerouslySetInnerHTML={{ __html: linkHtml }} />
      <p className="mt-4 text-sm text-slate-600">
        If the button will not drag, make a bookmark with this address:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          {code}
        </code>
        <button
          type="button"
          onClick={copyCode}
          className="min-h-12 shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
