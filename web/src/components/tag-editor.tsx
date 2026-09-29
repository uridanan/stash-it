"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { TagChip } from "@/components/tag-chips";
import type { ArticleTagDTO, TagDTO } from "@/types";

/**
 * Add and remove an article's tags.
 *
 * A combobox rather than a plain input: typing filters the collections that
 * already exist, so tagging tends toward reusing a collection instead of
 * quietly creating a near-duplicate of one.
 */
export function TagEditor({
  articleId,
  initialTags,
}: {
  articleId: string;
  initialTags: ArticleTagDTO[];
}) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  const [all, setAll] = useState<TagDTO[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTags(initialTags), [initialTags]);

  useEffect(() => {
    if (!open || all.length > 0) return;
    fetch("/api/tags")
      .then((res) => (res.ok ? res.json() : { tags: [] }))
      .then((data) => setAll(data.tags ?? []))
      .catch(() => setAll([]));
  }, [all.length, open]);

  useEffect(() => {
    if (!open) return;
    function onClickAway(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const attached = new Set(tags.map((t) => t.name.toLowerCase()));
  const trimmed = query.trim();
  const suggestions = all
    .filter((tag) => !attached.has(tag.name.toLowerCase()))
    .filter((tag) =>
      trimmed ? tag.name.toLowerCase().includes(trimmed.toLowerCase()) : true,
    )
    .slice(0, 8);
  const exactExists = all.some(
    (tag) => tag.name.toLowerCase() === trimmed.toLowerCase(),
  );

  async function add(name: string) {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags ?? []);
        setQuery("");
        setAll([]); // refetch next open, so a new tag shows up in suggestions
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(tagId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/articles/${articleId}/tags?tagId=${encodeURIComponent(tagId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags ?? []);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={boxRef} className="relative mt-3 flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          href={`/tags/${tag.slug}`}
          onRemove={() => remove(tag.id)}
        />
      ))}

      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add(trimmed);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        disabled={busy}
        placeholder="Add tag…"
        aria-label="Add tag"
        data-testid="tag-input"
        className="w-28 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs outline-none transition-colors focus:border-violet-500 focus:bg-white"
      />

      {open && (suggestions.length > 0 || (trimmed && !exactExists)) ? (
        <ul
          data-testid="tag-suggestions"
          className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((tag) => (
            <li key={tag.id}>
              <button
                type="button"
                onClick={() => void add(tag.name)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span>{tag.name}</span>
                <span className="text-xs text-slate-400">{tag.articleCount}</span>
              </button>
            </li>
          ))}
          {trimmed && !exactExists ? (
            <li>
              <button
                type="button"
                onClick={() => void add(trimmed)}
                data-testid="tag-create"
                className="w-full px-3 py-1.5 text-left text-sm text-violet-700 hover:bg-violet-50"
              >
                Create “{trimmed}”
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
