"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Menu, MenuItem, MenuLink } from "@/components/menu";
import {
  BookIcon,
  DownloadIcon,
  FileTextIcon,
  MoreIcon,
  RefreshIcon,
  SpinnerIcon,
  TrashIcon,
} from "@/components/icons";

/**
 * What you can do to a whole collection: rename it, merge it into another,
 * download it, delete it.
 *
 * Rename and merge are inline forms rather than dialogs — both need one input
 * and both belong next to the collection they act on. Merge is destructive to
 * the collection it is invoked from (the articles move, this collection goes),
 * so it confirms by name rather than by a generic "are you sure".
 */
export function CollectionActions({
  slug,
  name,
  others,
}: {
  slug: string;
  name: string;
  /** The other collections, as merge targets. */
  others: { name: string; slug: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "rename" | "merge">(null);
  const [draft, setDraft] = useState(name);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>): Promise<unknown | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tags/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (payload as { error?: string })?.error ?? `That failed (HTTP ${res.status})`,
        );
        return null;
      }
      return payload;
    } catch {
      setError("Network error — try again");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    const payload = (await patch({ name: draft })) as {
      tag?: { slug: string };
    } | null;
    if (!payload?.tag) return;
    setMode(null);
    // The slug follows the name, so this page's URL has moved.
    router.replace(`/tags/${payload.tag.slug}`);
    router.refresh();
  }

  async function merge(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    const payload = (await patch({ mergeInto: target })) as {
      tag?: { slug: string };
    } | null;
    if (!payload?.tag) return;
    setMode(null);
    // This collection no longer exists — land on the one it went into.
    router.replace(`/tags/${payload.tag.slug}`);
    router.refresh();
  }

  async function remove() {
    if (
      !confirm(
        `Delete the collection “${name}”? The articles in it are not deleted.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/tags/${slug}`, { method: "DELETE" });
      if (res.ok) {
        router.replace("/tags");
        router.refresh();
      } else {
        setError(`Delete failed (HTTP ${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  const buttonClass =
    "flex items-center justify-center rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";
  const inputClass =
    "min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-violet-600";
  const submitClass =
    "rounded-md bg-violet-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40";
  const cancelClass =
    "rounded-md px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-100";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <Menu
          label="Download this collection"
          testId="collection-download"
          className={buttonClass}
          icon={<DownloadIcon />}
        >
          {(close) => (
            <>
              <MenuLink
                icon={<BookIcon />}
                label="Backup (.tar.gz)"
                href={`/api/export/archive?tag=${encodeURIComponent(slug)}`}
                onSelect={close}
                testId="collection-download-backup"
              />
              <MenuLink
                icon={<FileTextIcon />}
                label="Markdown (.tar.gz)"
                href={`/api/export/markdown?tag=${encodeURIComponent(slug)}`}
                onSelect={close}
                testId="collection-download-markdown"
              />
            </>
          )}
        </Menu>

        <Menu
          label="Collection actions"
          testId="collection-actions"
          className={buttonClass}
          icon={busy ? <SpinnerIcon /> : <MoreIcon />}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<FileTextIcon />}
                label="Rename"
                testId="collection-rename"
                onSelect={() => {
                  close();
                  setDraft(name);
                  setError(null);
                  setMode("rename");
                }}
              />
              <MenuItem
                icon={<RefreshIcon />}
                label="Merge into…"
                disabled={others.length === 0}
                testId="collection-merge"
                onSelect={() => {
                  close();
                  setTarget("");
                  setError(null);
                  setMode("merge");
                }}
              />
              <MenuItem
                icon={<TrashIcon />}
                label="Delete"
                danger
                testId="collection-delete"
                onSelect={() => {
                  close();
                  void remove();
                }}
              />
            </>
          )}
        </Menu>
      </div>

      {mode === "rename" && (
        <form onSubmit={rename} className="flex w-full items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={60}
            aria-label="Collection name"
            data-testid="collection-rename-input"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            data-testid="collection-rename-save"
            className={submitClass}
          >
            Save
          </button>
          <button type="button" onClick={() => setMode(null)} className={cancelClass}>
            Cancel
          </button>
        </form>
      )}

      {mode === "merge" && (
        <form onSubmit={merge} className="flex w-full items-center gap-2">
          <select
            autoFocus
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            aria-label="Merge into"
            data-testid="collection-merge-target"
            className={inputClass}
          >
            <option value="">Choose a collection…</option>
            {others.map((other) => (
              <option key={other.slug} value={other.slug}>
                {other.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !target}
            data-testid="collection-merge-save"
            className={submitClass}
          >
            Merge
          </button>
          <button type="button" onClick={() => setMode(null)} className={cancelClass}>
            Cancel
          </button>
        </form>
      )}

      {mode === "merge" && (
        <p className="w-full text-right text-xs text-slate-500">
          “{name}” is emptied into the collection you pick, then deleted. The
          articles themselves are untouched.
        </p>
      )}

      {error && (
        <p data-testid="collection-action-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
