"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The three fill-in axes, with progress for whichever is running.
 *
 * Polled rather than pushed: a job takes hours and its state lives in the
 * database, so a poll survives a reload, a second tab, and a server restart —
 * none of which a socket would.
 */

type JobType = "FETCH_CONTENT" | "CLASSIFY" | "SUMMARIZE";

interface Job {
  id: string;
  type: JobType;
  status: string;
  total: number;
  done: number;
  failed: number;
  cancelRequested: boolean;
  error: string | null;
}

interface Estimate {
  articles: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  needsConfirmation: boolean;
}

interface JobsState {
  remaining: Record<JobType, number>;
  summarizeEstimate: Estimate;
  active: Job | null;
}

const LABELS: Record<JobType, string> = {
  FETCH_CONTENT: "Fetch article text",
  CLASSIFY: "Classify topics",
  SUMMARIZE: "Generate summaries",
};

const BLURBS: Record<JobType, string> = {
  FETCH_CONTENT:
    "Fetches the full text of links that arrived without it. Free, but slow — expect dead links in an old library.",
  CLASSIFY:
    "Assigns topic collections from each article's text. Cheap: a fraction of what summarising the same articles costs.",
  SUMMARIZE:
    "Writes the AI summary. The expensive one — this is why it defaults to on demand.",
};

const buttonClass =
  "rounded-lg border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-50";

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function JobProgress() {
  const [state, setState] = useState<JobsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) setState((await res.json()) as JobsState);
    } catch {
      // A failed poll is not worth surfacing; the next one will do.
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // Poll only while something is running, so an idle settings page is quiet.
  useEffect(() => {
    if (!state?.active) return;
    timer.current = setTimeout(() => void load(), 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, load]);

  async function start(type: JobType, force = false) {
    setBusy(true);
    setError(null);
    setConfirming(false);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, force }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Could not start that job (HTTP ${res.status})`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel: id }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const active = state.active;
  const percent =
    active && active.total > 0
      ? Math.min(100, Math.round((active.done / active.total) * 100))
      : 0;

  return (
    <div data-testid="job-progress" className="mt-4 space-y-3">
      {active ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-violet-800">
              {LABELS[active.type]}
            </span>
            <button
              type="button"
              onClick={() => void cancel(active.id)}
              disabled={busy || active.cancelRequested}
              data-testid="job-cancel"
              className="rounded-md px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              {active.cancelRequested ? "Stopping…" : "Stop"}
            </button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-violet-600 transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p data-testid="job-counts" className="mt-1 text-xs text-slate-600">
            {active.done} of {active.total} done
            {active.failed > 0 ? ` · ${active.failed} unreachable` : ""}
          </p>
        </div>
      ) : null}

      {(Object.keys(LABELS) as JobType[]).map((type) => {
        const remaining = state.remaining[type] ?? 0;
        const estimate = type === "SUMMARIZE" ? state.summarizeEstimate : null;
        const gated = Boolean(estimate?.needsConfirmation);

        return (
          <div key={type} className="rounded-lg border border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">
                {LABELS[type]}
              </span>
              <span className="text-xs text-slate-500">
                {remaining === 0 ? "nothing outstanding" : `${remaining} waiting`}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{BLURBS[type]}</p>

            {gated && confirming && type === "SUMMARIZE" ? (
              <div
                data-testid="cost-warning"
                className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <p className="font-medium">
                  This will summarise {estimate!.articles} articles.
                </p>
                <p className="mt-1">
                  Roughly {compact(estimate!.inputTokens)} input and{" "}
                  {compact(estimate!.outputTokens)} output tokens against{" "}
                  {estimate!.model ?? "your model"}, billed to your own key.
                  Check that model&apos;s pricing — the figure is an upper
                  bound, since most articles are shorter than the limit sent.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void start("SUMMARIZE")}
                    disabled={busy}
                    data-testid="cost-confirm"
                    className={buttonClass}
                  >
                    Yes, summarise them
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || remaining === 0 || Boolean(active)}
                  onClick={() =>
                    gated ? setConfirming(true) : void start(type)
                  }
                  data-testid={`job-start-${type}`}
                  className={buttonClass}
                >
                  Start
                </button>
                {type === "FETCH_CONTENT" ? (
                  <button
                    type="button"
                    disabled={busy || Boolean(active)}
                    onClick={() => void start(type, true)}
                    title="Re-fetch every article, keeping the saved copy if a page is gone"
                    data-testid="job-start-refresh"
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    Re-fetch everything
                  </button>
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      {error ? (
        <p data-testid="job-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
