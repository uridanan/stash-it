"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CloseIcon } from "@/components/icons";
import { JobProgress } from "@/components/job-progress";

/** A file the importer accepts. Column order does not matter; names do. */
const CSV_TEMPLATE = [
  "URL,Title,Selection,Folder,Timestamp,Tags",
  'https://ex.com/a,A title,Opening line,Unread,1710000000,"[""News""]"',
  "https://ex.com/b,Already read,,Archive,1710001000,[]",
  "https://ex.com/c,Kept close,,Starred,1710002000,[]",
  "",
].join("\n");

const CSV_FIELDS: { name: string; need: "Required" | "Optional"; detail: string }[] = [
  { name: "URL", need: "Required", detail: "The link to save." },
  { name: "Title", need: "Optional", detail: "Name shown in the list." },
  { name: "Selection", need: "Optional", detail: "A short excerpt." },
  {
    name: "Folder",
    need: "Optional",
    detail: "Archive = read; Starred = starred and unread; else unread.",
  },
  { name: "Timestamp", need: "Optional", detail: "When it was saved, as Unix seconds." },
  { name: "Tags", need: "Optional", detail: 'Collection names, as ["News"].' },
];

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
  articlesUpdated?: number;
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

function downloadCsvTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "stash-import.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function CsvFormatDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      data-testid="instapaper-format"
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed top-1/2 left-1/2 m-0 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 text-slate-800 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-slate-900">Expected format: CSV file</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
        >
          <CloseIcon />
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
        {CSV_TEMPLATE.trim()}
      </pre>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-600">
        {CSV_FIELDS.map((field) => (
          <li key={field.name}>
            <span className="font-medium text-slate-800">{field.name}</span>
            {" — "}
            {field.need}. {field.detail}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={downloadCsvTemplate}
        data-testid="download-csv-template"
        className={`${buttonClass} mt-4`}
      >
        Download template
      </button>
    </dialog>
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
  const [formatOpen, setFormatOpen] = useState(false);

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
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => instapaperInput.current?.click()}
              disabled={busy !== null}
              data-testid="import-instapaper"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "instapaper" ? "Importing…" : "↑ From Instapaper"}
            </button>
            <button
              type="button"
              onClick={() => setFormatOpen(true)}
              aria-label="Expected CSV format"
              data-testid="instapaper-format-info"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-4 w-4"
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 11v6" />
                <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </span>
          <CsvFormatDialog open={formatOpen} onClose={() => setFormatOpen(false)} />
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
        <div
          data-testid="import-behavior"
          className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"
        >
          <p>Import will not create duplicates of existing articles.</p>
          <p>Stash-it import leaves existing articles untouched.</p>
          <p>CSV import (Instapaper) updates the Read / Unread / Starred status of existing articles.</p>
        </div>
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
            {(summary.articlesUpdated ?? 0) > 0 && (
              <li>
                {summary.articlesUpdated} read/unread or star status(es) updated
              </li>
            )}
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
