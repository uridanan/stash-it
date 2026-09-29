"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Menu, MenuItem } from "@/components/menu";
import { Toast } from "@/components/toast";
import { CheckIcon, CloseIcon, SpinnerIcon } from "@/components/icons";

/**
 * Selecting several articles at once, so they can be filed together.
 *
 * The state is a context rather than props because the two halves live in
 * different places — a checkbox on every row, one action bar above the list —
 * and the lists are server components that would otherwise have to become
 * client components just to hold a Set.
 *
 * There is no selection *mode* to enter: the checkbox appears on hover (and
 * stays once anything is selected), which is one less thing to explain and one
 * less click before the first selection.
 */

interface Selection {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);

export function useSelection(): Selection | null {
  return useContext(SelectionContext);
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, clear }),
    [selected, toggle, clear],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

/** The checkbox on a row. Renders nothing outside a SelectionProvider. */
export function SelectCheckbox({ articleId }: { articleId: string }) {
  const selection = useSelection();
  if (!selection) return null;
  const checked = selection.selected.has(articleId);

  return (
    // A plain native checkbox, tinted with accent-color. The earlier version
    // hid the real input behind a styled box and a drawn tick, which left the
    // only clickable thing a 1px screen-reader-only input with decoration on
    // top of it — pointer clicks landed on the decoration, not the control.
    <input
      type="checkbox"
      checked={checked}
      onChange={() => selection.toggle(articleId)}
      onClick={(event) => event.stopPropagation()}
      aria-label={checked ? "Deselect article" : "Select article"}
      data-testid={`select-article-${articleId}`}
      className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-violet-600"
    />
  );
}

/**
 * The bar that appears once something is selected.
 *
 * "Add to collection" offers the collections that exist and a field for a new
 * one, and does not care which it is: the server resolves a collection by name
 * case-insensitively, so typing the name of one that already exists adds to it
 * rather than making a near-duplicate.
 */
export function SelectionBar() {
  const selection = useSelection();
  const router = useRouter();
  const [tags, setTags] = useState<{ name: string; slug: string }[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = selection?.selected.size ?? 0;

  // The confirmation is transient for the same reason the reader's is: it
  // reports something already finished, and once the selection has been
  // cleared the note is the only thing keeping the bar on screen.
  useEffect(() => {
    if (!note && !error) return;
    const timer = setTimeout(
      () => {
        setNote(null);
        setError(null);
      },
      error ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [note, error]);

  // Fetched the first time the bar appears, not on every list render: the
  // collections are only needed once something is selected.
  useEffect(() => {
    if (count === 0 || tags !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags");
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setTags(
          (body.tags ?? []).map((tag: { name: string; slug: string }) => ({
            name: tag.name,
            slug: tag.slug,
          })),
        );
      } catch {
        // Leave the list empty; the "new collection" field still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [count, tags]);

  if (!selection) return null;

  async function addTo(name: string) {
    if (!selection || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          articleIds: [...selection.selected],
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `That failed (HTTP ${res.status})`);
        return;
      }
      const added = Number(body?.added ?? 0);
      setNote(
        added === count
          ? `Added ${added} to “${body?.tag?.name ?? name}”`
          : `Added ${added} to “${body?.tag?.name ?? name}” — ${
              count - added
            } already there`,
      );
      setCreating(false);
      setDraft("");
      selection.clear();
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {count > 0 && (
    <div
      data-testid="selection-bar"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2"
    >
      <span className="text-sm font-medium text-violet-900">
        {count} selected
      </span>

      <div className="ml-auto flex items-center gap-2">
        {creating ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addTo(draft);
            }}
            className="flex items-center gap-2"
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="New collection name"
              maxLength={60}
              aria-label="New collection name"
              data-testid="selection-new-collection"
              className="rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-violet-600"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              data-testid="selection-new-collection-save"
              className="rounded-md bg-violet-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md px-2 py-1 text-sm text-violet-800 transition-colors hover:bg-violet-100"
            >
              Cancel
            </button>
          </form>
        ) : (
          <Menu
            label="Add to collection"
            testId="selection-add-to-collection"
            className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
            disabled={busy}
            icon={
              <>
                {busy ? <SpinnerIcon className="h-3.5 w-3.5" /> : null}
                <span>Add to collection</span>
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<CheckIcon />}
                  label="New collection…"
                  testId="selection-add-new"
                  onSelect={() => {
                    close();
                    setCreating(true);
                  }}
                />
                {tags === null ? (
                  <p className="px-3 py-1.5 text-sm text-slate-400">Loading…</p>
                ) : tags.length === 0 ? (
                  <p className="px-3 py-1.5 text-sm text-slate-400">
                    No collections yet
                  </p>
                ) : (
                  tags.map((tag) => (
                    <MenuItem
                      key={tag.slug}
                      icon={<CheckIcon />}
                      label={tag.name}
                      testId={`selection-add-${tag.slug}`}
                      onSelect={() => {
                        close();
                        void addTo(tag.name);
                      }}
                    />
                  ))
                )}
              </>
            )}
          </Menu>
        )}

        <button
          type="button"
          onClick={selection.clear}
          title="Clear selection"
          aria-label="Clear selection"
          data-testid="selection-clear"
          className="flex items-center justify-center rounded-md p-1.5 text-violet-800 transition-colors hover:bg-violet-100"
        >
          <CloseIcon />
        </button>
      </div>

    </div>
      )}

      {error ? (
        <Toast
          message={error}
          tone="error"
          testId="selection-note"
          onDismiss={() => setError(null)}
        />
      ) : note ? (
        <Toast
          message={note}
          testId="selection-note"
          onDismiss={() => setNote(null)}
        />
      ) : null}
    </>
  );
}
