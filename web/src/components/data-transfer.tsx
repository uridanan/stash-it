"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { JobProgress } from "@/components/job-progress";

/**
 * Backup, restore, Markdown export and the one-time Instapaper import.
 *
 * Exports are plain links rather than fetches: the responses are streamed, so
 * letting the browser own the download means a large library never has to sit
 * in a JavaScript buffer first.
 */

interface ImportSummary {
  articlesCreated: number;
  articlesSkipped: number;
  tagsCreated: number;
  bodiesAttached: number;
  settingsApplied: boolean;
  problems: string[];
  rowsRead?: number;
  rowsSkipped?: number;
  jobId?: string | null;
}

type TagsOption = "assign" | "import";
type ContentOption = "missing" | "refresh";
type SummaryOption = "ondemand" | "missing" | "always";

const buttonClass =
  "rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-60";

const selectClass =
  "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-violet-600";

function Option<T extends string>({
  label,
  hint,
  value,
  onChange,
  choices,
  testId,
}: {
  label: string;
  hint: string;
  value: T;
  onChange: (value: T) => void;
  choices: { value: T; label: string }[];
  testId: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        data-testid={testId}
        className={`${selectClass} mt-1 block w-full`}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
}

export function DataTransfer() {
  const router = useRouter();
  const backupInput = useRef<HTMLInputElement>(null);
  const instapaperInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "backup" | "instapaper">(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tags, setTags] = useState<TagsOption>("assign");
  const [content, setContent] = useState<ContentOption>("missing");
  const [summaryMode, setSummaryMode] = useState<SummaryOption>("ondemand");

  async function upload(
    file: File,
    endpoint: string,
    kind: "backup" | "instapaper",
  ) {
    setBusy(kind);
    setSummary(null);
    setError(null);
    const query = new URLSearchParams({ tags, content, summary: summaryMode });
    try {
      const res = await fetch(`${endpoint}?${query}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Import failed (HTTP ${res.status})`);
        return;
      }
      setSummary(body as ImportSummary);
      router.refresh();
    } catch {
      setError("Network error — the file may be too large for one request.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-8">
      <section>
        <h3 className="text-sm font-medium text-slate-900">Back up</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href="/api/export/archive"
            download
            data-testid="export-archive"
            className={`${buttonClass} inline-block`}
          >
            ↓ Full backup
          </a>
          <a
            href="/api/export/archive?content=exclude"
            download
            data-testid="export-archive-light"
            className="inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
          >
            ↓ Without article text
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          A <code className="font-mono">.tar.gz</code> holding{" "}
          <code className="font-mono">stash.json</code> (settings and
          collections), <code className="font-mono">links.ndjson</code> (every
          link with its status and tags) and one HTML file per article including
          its summary. This is the artefact to restore from. Your AI API key is
          deliberately left out.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-900">
          Export as Markdown
        </h3>
        <a
          href="/api/export/markdown"
          download
          data-testid="export-markdown"
          className={`${buttonClass} mt-2 inline-block`}
        >
          ↓ Markdown files
        </a>
        <p className="mt-1 text-xs text-slate-500">
          One <code className="font-mono">.md</code> per article with YAML
          frontmatter and a summary section, plus an index — unpack it straight
          into a notes vault. Read-only by design: it is not a restore format,
          because converting to Markdown cannot preserve everything the reader
          renders.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-slate-900">Import</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <Option<TagsOption>
            label="Collections"
            hint="Assign re-derives them from each article. Choose Import when restoring your own backup, or hand-made collections are lost."
            value={tags}
            onChange={setTags}
            testId="option-tags"
            choices={[
              { value: "assign", label: "Assign automatically" },
              { value: "import", label: "Import from file" },
            ]}
          />
          <Option<ContentOption>
            label="Article text"
            hint="Re-fetch prefers the live page and keeps the imported copy when a page is gone."
            value={content}
            onChange={setContent}
            testId="option-content"
            choices={[
              { value: "missing", label: "Fetch if missing" },
              { value: "refresh", label: "Re-fetch everything" },
            ]}
          />
          <Option<SummaryOption>
            label="AI summaries"
            hint="On demand keeps the cost to what you actually read; each article offers a button."
            value={summaryMode}
            onChange={setSummaryMode}
            testId="option-summary"
            choices={[
              { value: "ondemand", label: "On demand" },
              { value: "missing", label: "Generate if missing" },
              { value: "always", label: "Always regenerate" },
            ]}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => backupInput.current?.click()}
            disabled={busy !== null}
            data-testid="import-backup"
            className={buttonClass}
          >
            {busy === "backup" ? "Restoring…" : "↑ Restore a backup"}
          </button>
          <input
            ref={backupInput}
            type="file"
            accept=".gz,.tgz,.ndjson,application/gzip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file, "/api/import", "backup");
            }}
          />
          <button
            type="button"
            onClick={() => instapaperInput.current?.click()}
            disabled={busy !== null}
            data-testid="import-instapaper"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "instapaper" ? "Importing…" : "↑ From Instapaper"}
          </button>
          <input
            ref={instapaperInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file, "/api/import/instapaper", "instapaper");
            }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Restore takes either the <code className="font-mono">.tar.gz</code>{" "}
          archive or an older{" "}
          <code className="font-mono">.ndjson.gz</code> backup. Articles already
          saved are never touched, so restoring twice is harmless — to correct
          one, refetch it from its own page, or delete it and import again.
          Instapaper wants the CSV from its Settings → Export; it carries no
          article text, so those arrive as links.
        </p>
      </section>

      {error ? (
        <p data-testid="transfer-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div
          data-testid="transfer-summary"
          className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-slate-700"
        >
          <p className="font-medium text-violet-800">Import finished</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>{summary.articlesCreated} article(s) added</li>
            <li>{summary.articlesSkipped} already present, left alone</li>
            {summary.bodiesAttached > 0 && (
              <li>{summary.bodiesAttached} article text(s) restored</li>
            )}
            {summary.tagsCreated > 0 && (
              <li>{summary.tagsCreated} collection(s) created</li>
            )}
            {summary.rowsSkipped !== undefined && summary.rowsSkipped > 0 && (
              <li>{summary.rowsSkipped} row(s) in the file were unusable</li>
            )}
            {summary.settingsApplied && <li>preferences restored</li>}
          </ul>
          {summary.problems.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">
                {summary.problems.length} note(s)
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
                {summary.problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : null}

      <section>
        <h3 className="text-sm font-medium text-slate-900">Filling in</h3>
        <p className="mt-1 text-xs text-slate-500">
          Three independent passes. Fetching text and classifying topics are the
          cheap ones, so collections fill up without waiting on summaries.
        </p>
        <JobProgress />
      </section>
    </div>
  );
}
