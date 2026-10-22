"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CloseIcon } from "@/components/icons";
import { JobProgress } from "@/components/job-progress";
import { Toggle } from "@/components/toggle";
import type { TagsOption } from "@/components/import-option";

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
 * Export, Markdown export, and import of a Stash-it archive or a CSV.
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

const buttonClass =
  "rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-60";

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
        <h4 className="text-sm font-medium text-slate-900">Expected formats</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
        >
          <CloseIcon />
        </button>
      </div>
      <h5 className="mt-4 text-sm font-medium text-slate-900">Stash-it export</h5>
      <p className="mt-1 text-xs text-slate-600">
        Your articles, their status and tags, the saved text and each summary,
        and your settings. A Markdown export is not imported.
      </p>
      <h5 className="mt-4 text-sm font-medium text-slate-900">CSV</h5>
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
  const importInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "import">(null);
  const [exportLinks, setExportLinks] = useState(true);
  const [exportStatus, setExportStatus] = useState(true);
  const [exportText, setExportText] = useState(true);
  const [exportSettings, setExportSettings] = useState(true);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tags, setTags] = useState<TagsOption | null>(null);
  const [systemTags, setSystemTags] = useState<TagsOption>("assign");
  const [override, setOverride] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const system = data.systemImportTags === "import" ? "import" : "assign";
        const chosen = data.importTags === "import" ? "import" : "assign";
        setSystemTags(system);
        setOverride(data.importTagsOverride === "assign" || data.importTagsOverride === "import");
        setTags(chosen);
      })
      .catch(() => {
        if (!cancelled) setTags("assign");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseTags(value: TagsOption | null) {
    const next = value ?? systemTags;
    setTags(next);
    setOverride(value !== null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importTagsOverride: value }),
      });
      if (!res.ok) setError("Could not save that choice");
    } catch {
      setError("Could not save that choice");
    }
  }

  const exportHref = (() => {
    const params = new URLSearchParams();
    if (!exportLinks) params.set("links", "0");
    if (!exportStatus) params.set("status", "0");
    if (!exportText) params.set("content", "exclude");
    if (!exportSettings) params.set("settings", "0");
    const query = params.toString();
    return query ? `/api/export/archive?${query}` : "/api/export/archive";
  })();
  const exportReady = exportLinks || exportStatus || exportText || exportSettings;

  async function upload(file: File) {
    if (!tags) return;
    setBusy("import");
    setSummary(null);
    setError(null);
    const query = new URLSearchParams({ tags });
    try {
      const res = await fetch(`/api/import?${query}`, {
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
        <h3 className="text-sm font-medium text-slate-900">Export</h3>
        <div className="mt-3 space-y-3">
          <Toggle
            checked={exportLinks}
            onChange={setExportLinks}
            label="Article links"
            testId="export-links"
          />
          <Toggle
            checked={exportStatus}
            onChange={setExportStatus}
            label="Status & Tags"
            testId="export-status"
          />
          <Toggle
            checked={exportText}
            onChange={setExportText}
            label="Article text"
            description="One HTML per article, including its summary."
            testId="export-text"
          />
          <Toggle
            checked={exportSettings}
            onChange={setExportSettings}
            label="Settings"
            testId="export-settings"
          />
        </div>
        {exportReady ? (
          <a
            href={exportHref}
            download
            data-testid="export-archive"
            className={`${buttonClass} mt-3 inline-block`}
          >
            ↓ Export
          </a>
        ) : (
          <button
            type="button"
            disabled
            data-testid="export-archive"
            className={`${buttonClass} mt-3`}
          >
            ↓ Export
          </button>
        )}
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
        <div className="mt-2">
          {tags ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label
                  htmlFor="import-tags"
                  className="text-sm font-medium text-slate-900"
                >
                  Collections
                </label>
                <select
                  id="import-tags"
                  value={override ? tags : ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    void chooseTags(value === "import" || value === "assign" ? value : null);
                  }}
                  data-testid="option-tags"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none transition-colors focus:border-violet-600"
                >
                  <option value="">
                    Use the system default (
                    {systemTags === "import" ? "Import from file" : "Assign automatically"}
                    )
                  </option>
                  <option value="assign">Assign automatically</option>
                  <option value="import">Import from file</option>
                </select>
              </div>
              <p className="mt-1 max-w-lg text-xs text-slate-500">
                Assign re-derives them from each article. Choose Import when
                restoring your own backup, or hand-made collections are lost.
                This overrides the system default for your imports.
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-400">Loading…</p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => importInput.current?.click()}
            disabled={busy !== null || !tags}
            data-testid="import-backup"
            className={buttonClass}
          >
            {busy === "import" ? "Importing…" : "↑ Import"}
          </button>
          <button
            type="button"
            onClick={() => setFormatOpen(true)}
            aria-label="Expected import formats"
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
          <CsvFormatDialog open={formatOpen} onClose={() => setFormatOpen(false)} />
          <input
            ref={importInput}
            type="file"
            accept=".gz,.tgz,.ndjson,.csv,application/gzip,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
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
