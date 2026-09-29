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

import { useListen } from "@/components/listen/listen-provider";
import {
  SelectCheckbox,
  SelectionBar,
  SelectionProvider,
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
}

export function CollectionOrder({
  slug,
  name,
  items: initialItems,
  unreadOnly,
  totalCount,
}: {
  slug: string;
  name: string;
  items: CollectionItem[];
  unreadOnly: boolean;
  /** Size of the collection ignoring the filter, so the toggle can say so. */
  totalCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState(initialItems);
  const { playQueue, supported, ready } = useListen();

  // Server-rendered list is the source of truth; re-sync when the filter or
  // the collection's contents change underneath us.
  useEffect(() => setItems(initialItems), [initialItems]);

  function toggleUnreadOnly() {
    const params = new URLSearchParams(searchParams);
    if (unreadOnly) params.delete("unread");
    else params.set("unread", "1");
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-slate-500">
            {items.length} {items.length === 1 ? "article" : "articles"}
          </p>
          <button
            type="button"
            onClick={toggleUnreadOnly}
            aria-pressed={unreadOnly}
            title={
              unreadOnly
                ? `Showing unread only — ${totalCount} in total`
                : "Show only what is still unread"
            }
            data-testid="unread-filter"
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              unreadOnly
                ? "border-violet-300 bg-violet-50 text-violet-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {unreadOnly ? `Unread only · ${totalCount} total` : "All"}
          </button>
        </div>
        {supported && items.length > 0 ? (
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
            data-testid="listen-all"
            className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100 disabled:opacity-60"
          >
            🎧 Listen all
          </button>
        ) : null}
      </div>

      <SelectionBar />

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
                position={index + 1}
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

function SortableRow({
  item,
  position,
  onSendToTop,
  canSendToTop,
}: {
  item: CollectionItem;
  position: number;
  onSendToTop: () => void;
  canSendToTop: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const selected = searchParams.get("article") === item.id;
  const picked = useSelection()?.selected.has(item.id) ?? false;

  /**
   * Desktop (lg+): select into the reader pane so the collection stays on the
   * left while reading, matching the article lists. Smaller screens navigate.
   */
  function handleOpen(event: React.MouseEvent) {
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
      className={`flex items-center gap-2 border-b border-slate-100 py-3 ${
        isDragging ? "relative z-10 bg-white opacity-90 shadow-md" : ""
      } ${selected ? "lg:-mx-3 lg:rounded-lg lg:border-transparent lg:bg-violet-50 lg:px-3" : ""} ${
        picked ? "bg-violet-50/60" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${item.title}`}
        data-testid="drag-handle"
        className="cursor-grab touch-none rounded px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
      >
        ⠿
      </button>

      <span className="w-6 shrink-0 text-xs tabular-nums text-slate-400">
        {position}
      </span>

      <SelectCheckbox articleId={item.id} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/article/${item.id}`}
          onClick={handleOpen}
          className="block truncate text-sm font-medium text-slate-900 hover:text-violet-700"
        >
          {item.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {item.siteName ? `${item.siteName} · ` : ""}
          {item.readingMinutes} min
          {item.read ? " · read" : ""}
          {item.wontNarrate ? " · skipped when listening" : ""}
        </p>
      </div>

      <button
        type="button"
        onClick={onSendToTop}
        disabled={!canSendToTop}
        title="Send to top"
        aria-label={`Send ${item.title} to top`}
        data-testid="send-to-top"
        className="rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
      >
        ↑ Top
      </button>
    </li>
  );
}
