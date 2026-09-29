"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useListen } from "@/components/listen/listen-provider";

const CARD_COLLAPSED_KEY = "stash:summary-collapsed";

/** Renders summary text with ALL-CAPS lines (THE NEWS, KEY INSIGHTS) as headers. */
function SummaryText({ summary }: { summary: string }) {
  const lines = summary.split("\n");
  return (
    // `summary-text` scales with the reader's A-/A+ buttons; see globals.css.
    <div data-listen="summary" className="summary-text leading-relaxed text-slate-800">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed && /^[A-Z][A-Z\s]+$/.test(trimmed)) {
          return (
            <p
              key={i}
              className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-violet-700 first:mt-0"
            >
              {trimmed}
            </p>
          );
        }
        if (!trimmed) return null;
        return (
          <p key={i} className={trimmed.startsWith("-") || trimmed.startsWith("•") ? "pl-1" : ""}>
            {trimmed.replace(/^[-•]\s*/, "• ")}
          </p>
        );
      })}
    </div>
  );
}

/** Collapsible "AI summary" card shown above the article body. */
export function SummaryCard({ summary }: { summary: string }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(CARD_COLLAPSED_KEY) === "1");
    } catch {
      // localStorage unavailable — stay expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(CARD_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Best effort only.
      }
      return next;
    });
  }

  return (
    <div
      data-testid="summary-card"
      className="mt-6 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-violet-800"
      >
        <span>✨ AI summary</span>
        <span
          aria-hidden
          className={`text-violet-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
        >
          ⌃
        </span>
      </button>
      {!collapsed && (
        <div className="mt-2">
          <SummaryText summary={summary} />
        </div>
      )}
    </div>
  );
}

/** Summary / Full article tab switcher for the reader. */
export function SummaryTabs({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  // Lifted into ListenProvider: the player needs to know which panel is on
  // screen, and switching tabs has to stop a session whose highlighted spans
  // are about to unmount.
  const { tab, setTab } = useListen();

  const tabButton = (value: "summary" | "article", label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      aria-selected={tab === value}
      role="tab"
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        tab === value
          ? "bg-violet-600 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-6">
      <div role="tablist" className="flex gap-1 border-b border-slate-200 pb-2">
        {tabButton("summary", "✨ Summary")}
        {tabButton("article", "Full article")}
      </div>
      {tab === "summary" ? (
        <div data-testid="summary-tab-panel" className="mt-4">
          <SummaryText summary={summary} />
        </div>
      ) : (
        <div className="mt-2">{children}</div>
      )}
    </div>
  );
}

/** Shown when summaries are enabled but this article has none yet. */
export function GenerateSummaryButton({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}/summary`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Failed (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-60"
      >
        {busy ? "Summarizing…" : "✨ Summarize"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
