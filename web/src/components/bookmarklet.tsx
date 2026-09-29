"use client";

import { useEffect, useState } from "react";

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

  // React blocks javascript: URLs in JSX hrefs, so the draggable link is
  // rendered via innerHTML. The URL is built from window.location.origin only.
  const linkHtml = `<a href="${escapeHtml(code)}" class="inline-block rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800">📌 Save to Stash</a>`;

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
    <div>
      <p className="text-sm text-slate-600">
        Drag this button to your bookmarks bar, then click it on any page to
        save it to Stash:
      </p>
      <div className="mt-3" dangerouslySetInnerHTML={{ __html: linkHtml }} />
      <p className="mt-4 text-sm text-slate-600">
        Or create a bookmark manually with this address:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          {code}
        </code>
        <button
          type="button"
          onClick={copyCode}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          {copied ? "Copied!" : "Copy"}
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
