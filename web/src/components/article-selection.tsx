"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useListen } from "@/components/listen/listen-provider";
import { Menu, MenuItem } from "@/components/menu";
import { Toast } from "@/components/toast";
import { uniqueSlug } from "@/lib/tag-order";
import {
  CheckIcon,
  CloseIcon,
  HeadphonesIcon,
  MoreIcon,
  RefreshIcon,
  SparkleIcon,
  SpinnerIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
} from "@/components/icons";

/**
 * Selecting several articles at once.
 *
 * On a desktop the checkbox sits in each row's action overlay, to the left of
 * delete. Phones have no checkbox and no per-card actions: a long press enters
 * select mode, and every later tap adds or removes that article until the
 * selection is cleared from the top bar.
 * Once anything is selected, the list's top controls become star, read, tag,
 * listen (one article only), and an overflow menu.
 */

export type SelectionTarget = {
  id: string;
  starred?: boolean;
  archived: boolean;
  /** Collection slugs this article is already in. */
  tagSlugs?: string[];
};

export type ArticleFlags = { starred?: boolean; archived?: boolean };

interface Selection {
  selected: ReadonlySet<string>;
  /** Desktop select mode, or a phone selection that is still open. */
  selecting: boolean;
  toggle: (id: string) => void;
  /** Drop every pick and leave select mode. */
  clear: () => void;
  setSelecting: (on: boolean) => void;
  /**
   * Star and read, applied on click. The list props catch up later, on
   * refresh; until they match, these win so the row doesn't sit unchanged.
   */
  flags: Readonly<Record<string, ArticleFlags>>;
  setFlags: (ids: readonly string[], patch: ArticleFlags) => void;
  /** Drop the override once the server copy of the article agrees with it. */
  settleFlag: (id: string) => void;
}

const SelectionContext = createContext<Selection | null>(null);

export function useSelection(): Selection | null {
  return useContext(SelectionContext);
}

const DESKTOP_QUERY = "(min-width: 1024px)";

function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelectingState] = useState(false);
  const [flags, setFlagsState] = useState<Readonly<Record<string, ArticleFlags>>>({});

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setSelectingState(false);
  }, []);

  const setSelecting = useCallback((on: boolean) => {
    setSelectingState(on);
    if (!on) setSelected(new Set());
  }, []);

  const setFlags = useCallback((ids: readonly string[], patch: ArticleFlags) => {
    setFlagsState((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = { ...current[id], ...patch };
      return next;
    });
  }, []);

  const settleFlag = useCallback((id: string) => {
    setFlagsState((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ selected, selecting, toggle, clear, setSelecting, flags, setFlags, settleFlag }),
    [selected, selecting, toggle, clear, setSelecting, flags, setFlags, settleFlag],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

/**
 * Long-press selection for phone-width lists.
 *
 * Spread `rowProps` on the row. A long press enters select mode and picks the
 * article. After that, a tap anywhere on a card adds or removes it. Call
 * `interceptOpen` from the title link so a tap that reaches the link still
 * toggles instead of opening.
 */
export function useLongPressSelect(articleId: string) {
  const selection = useSelection();
  const suppressClick = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!selection || event.button !== 0) return;
      if (isDesktop() || selection.selecting) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, a[target]")) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const timer = window.setTimeout(() => {
        suppressClick.current = true;
        selection.setSelecting(true);
        if (!selection.selected.has(articleId)) selection.toggle(articleId);
      }, 450);

      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12) cleanup();
      };
      const onUp = () => {
        cleanup();
        if (suppressClick.current) {
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 0);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [articleId, selection],
  );

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    if (!isDesktop()) event.preventDefault();
  }, []);

  const toggleFromTap = useCallback(
    (event: React.MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (!selection?.selecting || isDesktop()) return false;
      event.preventDefault();
      event.stopPropagation();
      selection.toggle(articleId);
      return true;
    },
    [articleId, selection],
  );

  return {
    rowProps: {
      onPointerDown,
      onClickCapture: toggleFromTap,
      onContextMenu,
      className: "max-lg:select-none max-lg:[-webkit-touch-callout:none]",
    },
    interceptOpen: toggleFromTap,
  };
}

/** Desktop checkbox. Phones select with a long press, so this stays hidden there. */
export function SelectCheckbox({
  articleId,
  className = "hidden h-8 w-8 shrink-0 items-center justify-center lg:flex",
}: {
  articleId: string;
  className?: string;
}) {
  const selection = useSelection();
  if (!selection) return null;
  const checked = selection.selected.has(articleId);

  return (
    <label
      className={className}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => selection.toggle(articleId)}
        onClick={(event) => event.stopPropagation()}
        aria-label={checked ? "Deselect article" : "Select article"}
        data-testid={`select-article-${articleId}`}
        className="h-4 w-4 cursor-pointer accent-violet-600"
      />
    </label>
  );
}

const actionButton =
  "flex h-12 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

type Membership = "on" | "off" | "mixed";

function membershipOf(
  slug: string,
  articles: { tagSlugs?: string[] }[],
): Membership {
  if (articles.length === 0) return "off";
  const hits = articles.filter((article) => article.tagSlugs?.includes(slug)).length;
  if (hits === 0) return "off";
  if (hits === articles.length) return "on";
  return "mixed";
}

function filingNote(
  names: string[],
  addedByName: { name: string; added: number }[],
  articleCount: number,
): string {
  if (names.length === 1) {
    const added = addedByName[0]?.added ?? 0;
    const name = addedByName[0]?.name ?? names[0];
    return added === articleCount
      ? `Added ${added} to “${name}”`
      : `Added ${added} to “${name}” — ${articleCount - added} already there`;
  }
  const labels = addedByName.map((row) => `“${row.name}”`).join(", ");
  const already = addedByName.reduce((sum, row) => sum + (articleCount - row.added), 0);
  return already === 0
    ? `Added ${articleCount} to ${labels}`
    : `Added to ${labels} — some were already there`;
}

/** Empty until chosen. A filled check means the articles are in that collection. */
function CollectionMark({ state }: { state: Membership }) {
  const filled = state !== "off";
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        filled ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white"
      }`}
    >
      {state === "on" ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      ) : state === "mixed" ? (
        <span className="block h-0.5 w-2.5 rounded-full bg-white" />
      ) : null}
    </span>
  );
}

const collectionRow =
  "flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-base text-slate-800 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

type CollectionOption = { id?: string; name: string; slug: string };

type CollectionChange = CollectionOption & { action: "add" | "remove" };

/**
 * Checklist of collections. Nothing is filed until Apply.
 *
 * A new name is inserted into this list, already checked, so more collections
 * can be ticked before applying. Checking adds; unchecking removes. Apply
 * stays available for either change.
 */
function CollectionPicker({
  tags,
  chosen,
  busy,
  pinSlug,
  onApply,
  onReload,
}: {
  tags: CollectionOption[] | null;
  chosen: { tagSlugs?: string[] }[];
  busy: boolean;
  /** Shown first, so the collection you are looking at is the one you uncheck. */
  pinSlug?: string;
  onApply: (changes: CollectionChange[]) => void;
  onReload: () => void;
}) {
  const [extras, setExtras] = useState<CollectionOption[]>([]);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, "on" | "off">>(
    () => new Map(),
  );
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    onReload();
  }, [onReload]);

  const listed = useMemo(() => {
    const seen = new Set(extras.map((tag) => tag.slug));
    const rest = (tags ?? []).filter((tag) => {
      if (seen.has(tag.slug)) return false;
      return !extras.some((extra) => extra.name.toLowerCase() === tag.name.toLowerCase());
    });
    const all = [...extras, ...rest];
    if (!pinSlug) return all;
    return [
      ...all.filter((tag) => tag.slug === pinSlug),
      ...all.filter((tag) => tag.slug !== pinSlug),
    ];
  }, [extras, tags, pinSlug]);

  function shownFor(tag: CollectionOption): Membership {
    const override = overrides.get(tag.slug);
    if (override) return override;
    return membershipOf(tag.slug, chosen);
  }

  function toggle(tag: CollectionOption) {
    const membership = membershipOf(tag.slug, chosen);
    setOverrides((current) => {
      const next = new Map(current);
      const shown = next.get(tag.slug) ?? (membership === "mixed" ? "mixed" : membership);
      const desired = shown === "on" ? "off" : "on";
      const back =
        membership !== "mixed" && (desired === "on" ? membership === "on" : membership === "off");
      if (back) next.delete(tag.slug);
      else next.set(tag.slug, desired);
      return next;
    });
  }

  function commitDraft() {
    const name = draft.trim();
    if (!name) return;
    const existing = listed.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setOverrides((current) => new Map(current).set(existing.slug, "on"));
    } else {
      const slug = uniqueSlug(
        name,
        listed.map((tag) => tag.slug),
      );
      setExtras((current) => [...current, { name, slug }]);
      setOverrides((current) => new Map(current).set(slug, "on"));
    }
    setDraft("");
    setComposing(false);
  }

  const changes: CollectionChange[] = [];
  for (const tag of listed) {
    const membership = membershipOf(tag.slug, chosen);
    const desired = shownFor(tag);
    if (desired === "on" && membership !== "on") changes.push({ ...tag, action: "add" });
    else if (desired === "off" && membership !== "off") changes.push({ ...tag, action: "remove" });
  }

  return (
    <>
      {composing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            commitDraft();
          }}
          className="flex items-center gap-2 px-3 py-2"
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="New collection name"
            maxLength={60}
            aria-label="New collection name"
            data-testid="selection-new-collection"
            className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-base outline-none focus:border-violet-600"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            data-testid="selection-new-collection-save"
            className="min-h-12 shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-base font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
          >
            Add
          </button>
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          data-testid="selection-add-new"
          onClick={() => setComposing(true)}
          className={collectionRow}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-lg leading-none text-slate-400">
            +
          </span>
          New collection…
        </button>
      )}
      {tags === null && extras.length === 0 ? (
        <p className="px-4 py-2 text-sm text-slate-400">Loading…</p>
      ) : listed.length === 0 ? (
        <p className="px-4 py-2 text-sm text-slate-400">No collections yet</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {listed.map((tag) => {
            const shown = shownFor(tag);
            return (
              <button
                key={tag.slug}
                type="button"
                role="menuitemcheckbox"
                aria-checked={shown === "on" ? "true" : shown === "mixed" ? "mixed" : "false"}
                data-testid={`selection-add-${tag.slug}`}
                onClick={() => toggle(tag)}
                className={collectionRow}
              >
                <CollectionMark state={shown} />
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="border-t border-slate-100 p-2">
        <button
          type="button"
          disabled={busy || changes.length === 0}
          data-testid="selection-collections-save"
          onClick={() => onApply(changes)}
          className="min-h-12 w-full rounded-lg bg-violet-600 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </>
  );
}

/**
 * Replaces the sort / select controls once something is picked.
 *
 * `articles` is whatever the list currently knows, so star and read can aim
 * at the state the selection is actually in.
 */
export function SelectionToolbar({
  articles,
  children,
  collection,
  onRemovedFromCollection,
}: {
  articles: SelectionTarget[];
  children: React.ReactNode;
  /** The collection on screen. It is listed first, and unchecking it removes the articles. */
  collection?: { slug: string };
  onRemovedFromCollection?: (ids: string[]) => void;
}) {
  return (
    <SelectionActions
      articles={articles}
      collection={collection}
      onRemovedFromCollection={onRemovedFromCollection}
    >
      {children}
    </SelectionActions>
  );
}

function SelectionActions({
  articles,
  children,
  collection,
  onRemovedFromCollection,
}: {
  articles: SelectionTarget[];
  children: React.ReactNode;
  collection?: { slug: string };
  onRemovedFromCollection?: (ids: string[]) => void;
}) {
  const selection = useSelection();
  const listen = useListen();
  const router = useRouter();
  const [tags, setTags] = useState<CollectionOption[] | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Applies land before the list is refreshed, so the next time the menu opens
  // it still knows which collections this session just added or removed.
  const [tagEdits, setTagEdits] = useState<{
    added: Record<string, string[]>;
    removed: Record<string, string[]>;
  }>({ added: {}, removed: {} });

  const count = selection?.selected.size ?? 0;
  const choosing = count > 0 || Boolean(selection?.selecting);
  const ids = useMemo(
    () => (selection ? [...selection.selected] : []),
    [selection],
  );
  const chosen = ids.map((id) => {
    const article = articles.find((item) => item.id === id) ?? {
      id,
      archived: false,
    };
    const slugs = new Set(article.tagSlugs ?? []);
    for (const slug of tagEdits.added[id] ?? []) slugs.add(slug);
    for (const slug of tagEdits.removed[id] ?? []) slugs.delete(slug);
    const flag = selection?.flags[id];
    return {
      ...article,
      starred: flag?.starred ?? article.starred,
      archived: flag?.archived ?? article.archived,
      tagSlugs: [...slugs],
    };
  });
  const allStarred = chosen.length > 0 && chosen.every((article) => article.starred);
  const allRead = chosen.length > 0 && chosen.every((article) => article.archived);

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

  const tagsFetch = useRef(0);

  const reloadTags = useCallback(async () => {
    const token = ++tagsFetch.current;
    try {
      const res = await fetch("/api/tags");
      if (tagsFetch.current !== token) return;
      if (!res.ok) {
        setTags((current) => current ?? []);
        return;
      }
      const body = await res.json();
      if (tagsFetch.current !== token) return;
      setTags(
        (body.tags ?? []).map((tag: { id: string; name: string; slug: string }) => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
        })),
      );
    } catch {
      if (tagsFetch.current === token) setTags((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    if (!selection) return;
    for (const article of articles) {
      const flag = selection.flags[article.id];
      if (!flag) continue;
      const starOk = flag.starred === undefined || flag.starred === Boolean(article.starred);
      const readOk = flag.archived === undefined || flag.archived === article.archived;
      if (starOk && readOk) selection.settleFlag(article.id);
    }
  }, [articles, selection]);

  useEffect(() => {
    if (count === 0) return;
    let cancelled = false;
    void reloadTags();
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (cancelled || !res.ok) return;
        const settings = await res.json();
        setAiConfigured(Boolean(settings.aiSummariesEnabled && settings.hasApiKey));
      } catch {
        // Summarize simply stays hidden when settings can't be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [count, reloadTags]);

  if (!selection) {
    return <div className="flex items-center gap-2">{children}</div>;
  }

  async function patchEach(body: { starred?: boolean; state?: "unread" | "archived" }) {
    if (!selection || busy) return;
    const previous = chosen.map((article) => ({
      id: article.id,
      starred: Boolean(article.starred),
      archived: article.archived,
    }));
    // Paint star and read before the request. The page refresh that follows
    // is what used to be the only update, and it waits on the whole library.
    selection.setFlags(ids, {
      ...(body.starred !== undefined ? { starred: body.starred } : {}),
      ...(body.state !== undefined ? { archived: body.state === "archived" } : {}),
    });
    setBusy("patch");
    setError(null);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/articles/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      );
      if (results.some((res) => !res.ok)) {
        for (const article of previous) {
          selection.setFlags([article.id], {
            starred: article.starred,
            archived: article.archived,
          });
        }
        setError("Some of those failed — try again");
        return;
      }
      router.refresh();
    } catch {
      for (const article of previous) {
        selection.setFlags([article.id], {
          starred: article.starred,
          archived: article.archived,
        });
      }
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  async function runEach(path: (id: string) => string, kind: string) {
    if (!selection || busy) return;
    if (kind === "delete") {
      const label = ids.length === 1 ? "this article" : `these ${ids.length} articles`;
      if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    }
    setBusy(kind);
    setError(null);
    try {
      const results = await Promise.all(ids.map((id) => fetch(path(id), { method: kind === "delete" ? "DELETE" : "POST" })));
      const failed = results.find((res) => !res.ok);
      if (failed) {
        const body = await failed.json().catch(() => null);
        setError(body?.error ?? "Some of those failed — try again");
        return;
      }
      if (kind === "delete") selection.clear();
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  function rememberTags(incoming: CollectionOption[]) {
    tagsFetch.current += 1;
    setTags((current) => {
      const map = new Map((current ?? []).map((tag) => [tag.slug, tag]));
      for (const tag of incoming) map.set(tag.slug, tag);
      return [...map.values()];
    });
  }

  async function applyCollections(changes: CollectionChange[]) {
    if (!selection || changes.length === 0 || busy) return;
    setBusy("tag");
    setError(null);
    setNote(null);
    const adds = changes.filter((change) => change.action === "add");
    const removes = changes.filter((change) => change.action === "remove" && change.id);
    try {
      const added = await Promise.all(
        adds.map(async (change) => {
          const res = await fetch("/api/tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: change.name, articleIds: ids }),
          });
          const body = await res.json().catch(() => null);
          return {
            ok: res.ok,
            status: res.status,
            id: body?.tag?.id as string | undefined,
            name: (body?.tag?.name as string | undefined) ?? change.name,
            slug: (body?.tag?.slug as string | undefined) ?? change.slug,
            added: Number(body?.added ?? 0),
            error: body?.error as string | undefined,
          };
        }),
      );
      const removed = await Promise.all(
        removes.map(async (change) => {
          const results = await Promise.all(
            ids.map((id) =>
              fetch(`/api/articles/${id}/tags?tagId=${encodeURIComponent(change.id!)}`, {
                method: "DELETE",
              }),
            ),
          );
          const failed = results.find((res) => !res.ok);
          return { ok: !failed, name: change.name, status: failed?.status };
        }),
      );
      const failedAdd = added.find((result) => !result.ok);
      const failedRemove = removed.find((result) => !result.ok);
      if (failedAdd || failedRemove) {
        setError(
          failedAdd?.error ??
            `That failed (HTTP ${failedAdd?.status ?? failedRemove?.status})`,
        );
        return;
      }
      if (added.length > 0) {
        rememberTags(
          added.map((result) => ({
            id: result.id,
            name: result.name,
            slug: result.slug,
          })),
        );
      }
      setTagEdits((current) => {
        const nextAdded = { ...current.added };
        const nextRemoved = { ...current.removed };
        for (const id of ids) {
          const addSlugs = new Set(nextAdded[id] ?? []);
          const removeSlugs = new Set(nextRemoved[id] ?? []);
          for (const result of added) {
            addSlugs.add(result.slug);
            removeSlugs.delete(result.slug);
          }
          for (const change of removes) {
            removeSlugs.add(change.slug);
            addSlugs.delete(change.slug);
          }
          nextAdded[id] = [...addSlugs];
          nextRemoved[id] = [...removeSlugs];
        }
        return { added: nextAdded, removed: nextRemoved };
      });
      setNote(
        removes.length === 0
          ? filingNote(
              added.map((result) => result.name),
              added,
              count,
            )
          : added.length === 0
            ? removes.length === 1
              ? `Removed from “${removes[0].name}”`
              : `Removed from ${removes.length} collections`
            : `Updated ${added.length + removes.length} collections`,
      );
      if (collection && removes.some((change) => change.slug === collection.slug)) {
        onRemovedFromCollection?.(ids);
      }
      selection.clear();
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative z-30 ml-auto flex min-w-0 shrink-0 items-center">
      {choosing ? (
      <div
        data-testid="selection-bar"
        className="flex flex-nowrap items-center gap-0.5"
      >
        <span className="mr-1 whitespace-nowrap text-sm font-medium text-slate-700">
          {count} selected
        </span>

            <button
              type="button"
              disabled={busy !== null || count === 0}
              onClick={() => void patchEach({ starred: !allStarred })}
              title={allStarred ? "Unstar" : "Star"}
              aria-label={allStarred ? "Unstar" : "Star"}
              aria-pressed={allStarred}
              data-testid="selection-star"
              className={`${actionButton} ${allStarred ? "text-cyan-600" : ""}`}
            >
              <StarIcon filled={allStarred} />
            </button>
            <button
              type="button"
              disabled={busy !== null || count === 0}
              onClick={() =>
                void patchEach({ state: allRead ? "unread" : "archived" })
              }
              title={allRead ? "Mark as unread" : "Mark as read"}
              aria-label={allRead ? "Mark as unread" : "Mark as read"}
              aria-pressed={allRead}
              data-testid="selection-read"
              className={`${actionButton} ${allRead ? "text-cyan-600" : "text-slate-400"}`}
            >
              <CheckIcon />
            </button>
            <Menu
              label="Add to collection"
              testId="selection-add-to-collection"
              disabled={busy !== null || count === 0}
              className={actionButton}
              icon={busy === "tag" ? <SpinnerIcon /> : <TagIcon />}
            >
              {(close) => (
                <CollectionPicker
                  tags={tags}
                  chosen={chosen}
                  busy={busy !== null}
                  pinSlug={collection?.slug}
                  onReload={reloadTags}
                  onApply={(changes) => {
                    close();
                    void applyCollections(changes);
                  }}
                />
              )}
            </Menu>
            {count === 1 && listen.supported ? (
              <button
                type="button"
                disabled={!listen.ready || busy !== null}
                onClick={() => listen.listenTo(ids[0])}
                title={
                  listen.ready
                    ? "Listen to this article"
                    : "No text-to-speech voices are installed on this device"
                }
                aria-label="Listen to this article"
                data-testid="selection-listen"
                className={actionButton}
              >
                <HeadphonesIcon />
              </button>
            ) : null}
            <Menu
              label="More actions"
              testId="selection-more"
              disabled={busy !== null || count === 0}
              className={actionButton}
              icon={
                busy === "fetch" || busy === "summarize" || busy === "delete" ? (
                  <SpinnerIcon />
                ) : (
                  <MoreIcon />
                )
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<RefreshIcon />}
                    label="Fetch"
                    testId="selection-fetch"
                    disabled={busy !== null}
                    onSelect={() => {
                      close();
                      void runEach((id) => `/api/articles/${id}/extract?force=1`, "fetch");
                    }}
                  />
                  {aiConfigured ? (
                    <MenuItem
                      icon={<SparkleIcon />}
                      label="Summarize"
                      testId="selection-summarize"
                      disabled={busy !== null}
                      onSelect={() => {
                        close();
                        void runEach((id) => `/api/articles/${id}/summary`, "summarize");
                      }}
                    />
                  ) : null}
                  <MenuItem
                    icon={<TrashIcon />}
                    label="Delete"
                    danger
                    testId="selection-delete"
                    disabled={busy !== null}
                    onSelect={() => {
                      close();
                      void runEach((id) => `/api/articles/${id}`, "delete");
                    }}
                  />
                </>
              )}
            </Menu>
            <button
              type="button"
              onClick={selection.clear}
              title="Clear selection"
              aria-label="Clear selection"
              data-testid="selection-clear"
              className={actionButton}
            >
              <CloseIcon />
            </button>
      </div>
      ) : (
        <div className="flex items-center gap-2">{children}</div>
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
    </div>
  );
}
