"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon, DownloadIcon } from "@/components/icons";

/**
 * The three fill-in axes, with progress for whichever is running.
 *
 * Polled rather than pushed: a job takes hours and its state lives in the
 * database, so opening this page again shows the same run — still going, or
 * the report once it has finished. A socket would not survive the reload.
 */

type JobType = "FETCH_CONTENT" | "CLASSIFY" | "SUMMARIZE";

interface JobFailure {
  articleId: string;
  title: string;
  url: string;
  reason: string;
}

interface Job {
  id: string;
  type: JobType;
  status: string;
  total: number;
  done: number;
  failed: number;
  cancelRequested: boolean;
  error: string | null;
  failures: JobFailure[];
}

interface Estimate {
  articles: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  needsConfirmation: boolean;
}

interface FillInCount {
  done: number;
  left: number;
  aside: number;
}

interface JobsState {
  remaining: Record<JobType, number>;
  progress?: Record<JobType, FillInCount>;
  summarizeEstimate: Estimate;
  active: Job | null;
  recent: Job[];
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
  "rounded-lg border border-violet-300 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-50";

const DISMISS_KEY = "stash:job-report-dismissed";

function articlesCompleted(n: number): string {
  const count = n.toLocaleString();
  return n === 1
    ? `${count} article completed successfully`
    : `${count} articles completed successfully`;
}

function reportStatus(status: string): string {
  if (status === "DONE") return "finished";
  if (status === "CANCELLED") return "stopped";
  return "didn't finish";
}

/**
 * Spreadsheet form of the report. Each failure is a row, and the run's counts
 * ride along so filtering the list still shows how many articles succeeded.
 * A run with no failures is one row of those counts.
 */
function reportCsv(job: Job): string {
  const failures = job.failures ?? [];
  const rows = failures.length > 0 ? failures : [null];
  const lines = [
    ["job", "status", "completed", "failed", "title", "url", "reason"].join(","),
    ...rows.map((failure) =>
      [
        LABELS[job.type],
        reportStatus(job.status),
        job.done,
        job.failed,
        failure?.title ?? "",
        failure?.url ?? "",
        failure?.reason ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return lines.join("\r\n");
}

function csvCell(value: string | number): string {
  let text = String(value);
  // A cell that starts with one of these is a formula when opened in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function reportFilename(job: Job): string {
  const slug = LABELS[job.type]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `stash-${slug}.csv`;
}

function downloadReport(job: Job) {
  const blob = new Blob(["\uFEFF", reportCsv(job)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFilename(job);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const iconButtonClass =
  "rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100";

function JobReport({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  // Icon actions sit beside Dismiss: copy the CSV, or save it.
  const failures = job.failures ?? [];
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportCsv(job));
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      data-testid="job-report"
      className="rounded-lg border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">
          {LABELS[job.type]} {reportStatus(job.status)}
        </p>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => void copyReport()}
            title={copied ? "Copied" : "Copy report"}
            aria-label={copied ? "Copied" : "Copy report"}
            data-testid="job-report-copy"
            className={iconButtonClass}
          >
            {copied ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => downloadReport(job)}
            title="Download CSV"
            aria-label="Download CSV"
            data-testid="job-report-download"
            className={iconButtonClass}
          >
            <DownloadIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            data-testid="job-report-dismiss"
            className="ml-1 rounded-md px-2 py-1 text-sm text-slate-500 transition-colors hover:bg-slate-100"
          >
            Dismiss
          </button>
        </div>
      </div>
      {job.error ? (
        <p className="mt-1 text-sm text-red-600">{job.error}</p>
      ) : null}
      <p data-testid="job-report-succeeded" className="mt-2 text-sm text-slate-700">
        {articlesCompleted(job.done)}
      </p>
      {failures.length > 0 ? (
        <>
          <p className="mt-2 text-sm font-medium text-slate-600">
            {failures.length.toLocaleString()}{" "}
            {failures.length === 1 ? "failure" : "failures"}
          </p>
          <ul className="mt-1 max-h-64 space-y-2 overflow-y-auto">
            {failures.map((failure, index) => (
              <li
                key={`${failure.articleId}-${index}`}
                data-testid="job-report-failure"
                className="text-sm"
              >
                <a
                  href={`/article/${failure.articleId}`}
                  className="font-medium text-violet-800 hover:underline"
                >
                  {failure.title || failure.url || "Untitled"}
                </a>
                <span className="mt-0.5 block break-words text-slate-500">
                  {failure.reason}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">No failures.</p>
      )}
    </div>
  );
}

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
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDismissedId(localStorage.getItem(DISMISS_KEY));
  }, []);

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

  function dismiss(id: string) {
    localStorage.setItem(DISMISS_KEY, id);
    setDismissedId(id);
  }

  if (!state) return null;

  const active = state.active;
  const processed = active ? active.done + active.failed : 0;
  const percent =
    active && active.total > 0
      ? Math.min(100, Math.round((processed / active.total) * 100))
      : 0;
  const report = active
    ? null
    : (state.recent ?? []).find((job) => job.status !== "RUNNING") ?? null;

  return (
    <div data-testid="job-progress" className="mt-4 space-y-3">
      {active ? (
        <div
          data-testid="job-active"
          className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-violet-800">
              {LABELS[active.type]}
            </span>
            <button
              type="button"
              onClick={() => void cancel(active.id)}
              disabled={busy || active.cancelRequested}
              data-testid="job-cancel"
              className="rounded-md px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
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
          <p data-testid="job-counts" className="mt-1 text-sm text-slate-600">
            {active.done.toLocaleString()} completed
            {active.failed > 0
              ? ` · ${active.failed.toLocaleString()} failed`
              : ""}
            {` · ${active.total.toLocaleString()} in this run`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Keeps going if you leave this page.
          </p>
        </div>
      ) : report && report.id !== dismissedId ? (
        <JobReport job={report} onDismiss={() => dismiss(report.id)} />
      ) : null}

      {(Object.keys(LABELS) as JobType[]).map((type) => {
        const remaining = state.remaining[type] ?? 0;
        const progress = state.progress?.[type] ?? {
          done: 0,
          left: remaining,
          aside: 0,
        };
        const estimate = type === "SUMMARIZE" ? state.summarizeEstimate : null;
        const gated = Boolean(estimate?.needsConfirmation);
        const settled = progress.done + progress.left;
        const percent =
          settled > 0 ? Math.min(100, Math.round((progress.done / settled) * 100)) : 0;

        return (
          <div key={type} className="rounded-lg border border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">
                {LABELS[type]}
              </span>
              <span
                className="text-sm tabular-nums text-slate-600"
                data-testid={`job-progress-${type}`}
              >
                {progress.done.toLocaleString()} done · {progress.left.toLocaleString()} left
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-violet-600"
                style={{ width: `${percent}%` }}
              />
            </div>
            {progress.aside > 0 ? (
              <p className="mt-1 text-sm text-slate-500">
                {type === "FETCH_CONTENT"
                  ? `${progress.aside.toLocaleString()} unreachable, and not tried again`
                  : `${progress.aside.toLocaleString()} still need text before this can run`}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-slate-500">{BLURBS[type]}</p>

            {gated && confirming && type === "SUMMARIZE" ? (
              <div
                data-testid="cost-warning"
                className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
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
                    className="rounded-lg px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
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
                    className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
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
