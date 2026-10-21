"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { onArticleRead } from "@/components/article-read";
import { CheckIcon, HeadphonesIcon } from "@/components/icons";
import { useListen } from "@/components/listen/listen-provider";
import {
  SelectCheckbox,
  SelectionProvider,
  SelectionToolbar,
  useLongPressSelect,
  useSelection,
} from "@/components/article-selection";

/**
 * Ordered collection view: drag to reorder, or send an article to the top.
 *
 * Order is optimistic — the list reorders immediately and the PATCH follows,
 * because waiting on a round trip to see a drag land feels broken. A failed
 * write reverts to the order the server last confirmed.
 */

export interface CollectionItem {
  id: string;
  title: string;
  siteName: string | null;
  readingMinutes: number;
  read: boolean;
  wontNarrate: boolean;
  starred: boolean;
  tagSlugs: string[];
}

export function CollectionOrder({
  slug,
  name,
  tagId,
  items: initialItems,
  unreadOnly,
  totalCount,
  unreadCount,
  actions,
}: {
  slug: string;
  name: string;
  tagId: string;
  items: CollectionItem[];
  unreadOnly: boolean;
  /** Size of the collection ignoring the filter. */
  totalCount: number;
  unreadCount: number;
  actions: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState(initialItems);
  const { playQueue, supported, ready } = useListen();

  // Server-rendered list is the source of truth; re-sync when the filter or
  // the collection's contents change underneath us.
  useEffect(() => setItems(initialItems), [initialItems]);

  // A finished listen flips the check without waiting for the list to reload.
  useEffect(() => {
    return onArticleRead((id, read) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, read } : item)),
      );
    });
  }, []);

  function showUnread(next: boolean) {
    if (next === unreadOnly) return;
    const params = new URLSearchParams(searchParams);
    if (next) params.set("unread", "1");
    else params.delete("unread");
    // Drop the open article: it may not survive the filter change.
    params.delete("article");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Let a click through: only start dragging past a short distance.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function persist(next: CollectionItem[], movedId: string) {
    const at = next.findIndex((item) => item.id === movedId);
    const afterId = at <= 0 ? null : next[at - 1].id;
    try {
      const res = await fetch(`/api/tags/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: movedId, afterId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setItems(initialItems); // revert to the last confirmed order
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from === -1 || to === -1) return;

    const next = arrayMove(items, from, to);
    setItems(next);
    void persist(next, String(active.id));
  }

  function sendToTop(id: string) {
    const from = items.findIndex((item) => item.id === id);
    if (from <= 0) return;
    const next = arrayMove(items, from, 0);
    setItems(next);
    void persist(next, id);
  }

  return (
    <SelectionProvider>
    <div>
      <div className="relative flex flex-nowrap items-center gap-0.5 overflow-x-auto">
        <Link
          href="/tags"
          aria-label="Back"
          title="Back"
          className="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-slate-600 hover:bg-slate-100"
        >
          ←
        </Link>
        <h1 className="min-w-0 truncate text-lg font-bold text-slate-900">
          {name}
        </h1>
        <CollectionTools
          unreadOnly={unreadOnly}
          totalCount={totalCount}
          unreadCount={unreadCount}
          onShowUnread={showUnread}
          actions={actions}
          collection={{ id: tagId, name }}
          articles={items.map((item) => ({
            id: item.id,
            starred: item.starred,
            archived: item.read,
            tagSlugs: item.tagSlugs,
          }))}
          onRemoved={(ids) => {
            const gone = new Set(ids);
            setItems((current) => current.filter((item) => !gone.has(item.id)));
          }}
          listen={
            supported && items.length > 0 ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() =>
                  playQueue(
                    slug,
                    name,
                    items.map((item) => item.id),
                  )
                }
                title={
                  ready
                    ? "Listen to this collection"
                    : "No text-to-speech voices are installed on this device"
                }
                aria-label="Listen to this collection"
                data-testid="listen-all"
                className="flex h-12 w-11 shrink-0 items-center justify-center rounded-lg text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-40"
              >
                <HeadphonesIcon />
              </button>
            ) : null
          }
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul data-testid="collection-list" className="mt-4">
            {items.map((item, index) => (
              <SortableRow
                key={item.id}
                item={item}
                onSendToTop={() => sendToTop(item.id)}
                canSendToTop={index > 0}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
          <p className="text-base font-medium text-slate-700">
            Nothing in this collection yet
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Add this tag to an article from its reader view.
          </p>
        </div>
      ) : null}
    </div>
    </SelectionProvider>
  );
}

function CollectionTools({
  unreadOnly,
  totalCount,
  unreadCount,
  onShowUnread,
  actions,
  collection,
  articles,
  onRemoved,
  listen,
}: {
  unreadOnly: boolean;
  totalCount: number;
  unreadCount: number;
  onShowUnread: (next: boolean) => void;
  actions: React.ReactNode;
  collection: { id: string; name: string };
  articles: {
    id: string;
    starred: boolean;
    archived: boolean;
    tagSlugs: string[];
  }[];
  onRemoved: (ids: string[]) => void;
  listen: React.ReactNode;
}) {
  const selection = useSelection();
  const choosing =
    (selection?.selected.size ?? 0) > 0 || Boolean(selection?.selecting);

  // Keep the row check in step when a listen finishes while this list is open.
  useEffect(() => {
    return onArticleRead((id, read) => {
      selection?.setFlags([id], { archived: read });
    });
  }, [selection]);

  const chip =
    "min-h-10 shrink-0 rounded-full px-2 text-sm font-medium tabular-nums transition-colors";

  return (
    <>
      {!choosing && (
        <>
          <button
            type="button"
            onClick={() => onShowUnread(false)}
            aria-pressed={!unreadOnly}
            title="Show every article in this collection"
            data-testid="all-filter"
            className={`${chip} ${
              unreadOnly
                ? "text-slate-500 hover:bg-slate-100"
                : "bg-violet-600 text-white"
            }`}
          >
            All({totalCount})
          </button>
          <button
            type="button"
            onClick={() => onShowUnread(true)}
            aria-pressed={unreadOnly}
            title="Show only what is still unread"
            data-testid="unread-filter"
            className={`${chip} ${
              unreadOnly
                ? "bg-violet-600 text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            Unread({unreadCount})
          </button>
        </>
      )}
      {!choosing && actions}
      <SelectionToolbar
        articles={articles}
        collection={collection}
        onRemovedFromCollection={onRemoved}
      >
        {listen}
      </SelectionToolbar>
    </>
  );
}

function ReadMark({ read }: { read: boolean }) {
  return (
    <span
      role="img"
      aria-label={read ? "Read" : "Unread"}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        read ? "bg-violet-600 text-white" : "bg-white ring-2 ring-inset ring-slate-300"
      }`}
    >
      {read ? <CheckIcon className="h-4 w-4" /> : null}
    </span>
  );
}

function SortableRow({
  item,
  onSendToTop,
  canSendToTop,
}: {
  item: CollectionItem;
  onSendToTop: () => void;
  canSendToTop: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const selected = searchParams.get("article") === item.id;
  const selection = useSelection();
  const picked = selection?.selected.has(item.id) ?? false;
  const read = selection?.flags[item.id]?.archived ?? item.read;
  const press = useLongPressSelect(item.id);

  /**
   * Desktop (lg+): select into the reader pane so the collection stays on the
   * left while reading, matching the article lists. Smaller screens navigate.
   */
  function handleOpen(event: React.MouseEvent) {
    if (press.interceptOpen(event)) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    event.preventDefault();
    const params = new URLSearchParams(searchParams);
    params.set("article", item.id);
    router.push(`${pathname}?${params}`, { scroll: false });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="collection-row"
      onPointerDown={press.rowProps.onPointerDown}
      onClickCapture={press.rowProps.onClickCapture}
      onContextMenu={press.rowProps.onContextMenu}
      className={`group relative flex items-start gap-2 border-b border-slate-100 py-3 ${press.rowProps.className} ${
        isDragging ? "z-10 bg-white opacity-90 shadow-md" : ""
      } ${selected ? "lg:-mx-3 lg:rounded-lg lg:border-transparent lg:bg-violet-50 lg:px-3" : ""} ${
        picked ? "max-lg:bg-violet-200/70 lg:bg-violet-50/60" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${item.title}`}
        data-testid="drag-handle"
        className="mt-1 cursor-grab touch-none self-start rounded px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
      >
        ⠿
      </button>

      <ReadMark read={read} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/article/${item.id}`}
          onClick={handleOpen}
          className="text-lg font-semibold leading-snug text-slate-900 hover:text-violet-700"
        >
          {item.title}
        </Link>
        <p className="mt-1 text-sm text-slate-500">
          {item.siteName ? `${item.siteName} · ` : ""}
          {item.readingMinutes} min
          {item.wontNarrate ? " · skipped when listening" : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        <div className="pointer-events-none min-w-0 max-lg:hidden w-0 overflow-hidden opacity-0 transition-all lg:group-hover:pointer-events-auto lg:group-hover:w-16 lg:group-hover:overflow-visible lg:group-hover:opacity-100 lg:group-focus-within:pointer-events-auto lg:group-focus-within:w-16 lg:group-focus-within:overflow-visible lg:group-focus-within:opacity-100">
          <div className="rounded-lg border border-slate-200 bg-white px-1 py-0.5 shadow-sm">
            <SelectCheckbox
              articleId={item.id}
              className="flex h-12 w-12 shrink-0 items-center justify-center"
            />
          </div>
        </div>
      <button
        type="button"
        onClick={onSendToTop}
        disabled={!canSendToTop}
        title="Send to top"
        aria-label={`Send ${item.title} to top`}
        data-testid="send-to-top"
        className="min-h-12 rounded-lg px-3 py-2 text-base text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
      >
        ↑ Top
      </button>
      </div>
    </li>
  );
}
