"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { SelectCheckbox, useSelection } from "@/components/article-selection";
import { TagChips } from "@/components/tag-chips";
import type { ArticleTagDTO } from "@/types";

export type ArticleRowData = {
  id: string;
  title: string;
  url: string;
  siteName: string | null;
  excerpt: string | null;
  readingMinutes: number;
  savedAtLabel: string;
  starred: boolean;
  state: "UNREAD" | "ARCHIVED";
  tags: ArticleTagDTO[];
};

export function ArticleRow({ article }: { article: ArticleRowData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const archived = article.state === "ARCHIVED";
  const selected = searchParams.get("article") === article.id;
  // Present only inside a SelectionProvider — the lists that support picking
  // several articles at once.
  const selection = useSelection();
  const picked = selection?.selected.has(article.id) ?? false;

  /**
   * Desktop split view (lg+): select into the reader pane instead of
   * navigating. Smaller screens keep the default /article/[id] navigation.
   * Modified clicks (new tab etc.) are left to the browser.
   */
  function handleOpen(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    params.set("article", article.id);
    router.push(`${pathname}?${params}`, { scroll: false });
  }

  async function mutate(fn: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Leave the list as-is; the next refresh will reconcile.
    } finally {
      setBusy(false);
    }
  }

  function patch(body: { state?: "unread" | "archived"; starred?: boolean }) {
    return mutate(() =>
      fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  function handleDelete() {
    if (!confirm("Delete this article? This cannot be undone.")) return;
    void mutate(() =>
      fetch(`/api/articles/${article.id}`, { method: "DELETE" })
    );
  }

  return (
    <li
      data-testid="article-row"
      className={`group relative border-b border-slate-200 py-4 last:border-b-0 ${
        selected ? "lg:-mx-3 lg:rounded-lg lg:border-transparent lg:bg-violet-50 lg:px-3" : ""
      } ${picked ? "bg-violet-50/60" : ""}`}
    >
      <div className="flex gap-3 pr-2">
        {selection && (
          <div
            className={`transition-opacity ${
              picked
                ? ""
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <SelectCheckbox articleId={article.id} />
          </div>
        )}
        <div className="min-w-0 flex-1">
        <Link
          href={`/article/${article.id}`}
          onClick={handleOpen}
          className="text-base font-semibold leading-snug text-slate-900 hover:text-violet-700"
        >
          {article.title}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {article.siteName && (
            <>
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                title={`Open on ${article.siteName}`}
                className="hover:text-violet-700 hover:underline"
              >
                {article.siteName}
              </a>
              {" · "}
            </>
          )}
          <span>{article.readingMinutes} min read</span>
          <span> · {article.savedAtLabel}</span>
          {article.starred && (
            <span className="text-cyan-600"> · ★ starred</span>
          )}
        </p>
        {article.excerpt && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-600">
            {article.excerpt}
          </p>
        )}
        {article.tags.length > 0 && (
          <div className="mt-1.5">
            <TagChips tags={article.tags} max={4} />
          </div>
        )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1 transition-opacity sm:absolute sm:right-0 sm:top-3 sm:mt-0 sm:rounded-lg sm:border sm:border-slate-200 sm:bg-white sm:px-1 sm:py-0.5 sm:opacity-0 sm:shadow-sm sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ starred: !article.starred })}
          title={article.starred ? "Unstar" : "Star"}
          aria-label={article.starred ? "Unstar" : "Star"}
          className={`rounded p-1.5 text-sm transition-colors hover:bg-slate-100 disabled:opacity-50 ${
            article.starred ? "text-cyan-600" : "text-slate-400"
          }`}
        >
          {article.starred ? "★" : "☆"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ state: archived ? "unread" : "archived" })}
          title={archived ? "Mark as unread" : "Mark as read"}
          aria-label={archived ? "Mark as unread" : "Mark as read"}
          // One control, two states: the tick carries the read/unread status
          // in its colour rather than needing a second button beside it.
          className={`rounded p-1.5 text-sm transition-colors hover:bg-slate-100 disabled:opacity-50 ${
            archived
              ? "text-violet-600 hover:text-violet-700"
              : "text-slate-400 hover:text-slate-700"
          }`}
        >
          ✓
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          title="Delete"
          aria-label="Delete"
          className="rounded p-1.5 text-sm text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
