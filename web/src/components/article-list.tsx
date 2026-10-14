"use client";

import { useEffect, useRef, useState } from "react";

import { ArticleRow, type ArticleRowData } from "@/components/article-row";
import { toRowData } from "@/components/article-list-data";
import {
  SelectionProvider,
  SelectionToolbar,
} from "@/components/article-selection";
import { SortControl } from "@/components/sort-control";
import type { ArticleListResponse } from "@/types";

/** Filters for the next page. Omitted on lists that already have every row. */
export type ArticleListPage = {
  nextCursor: string | null;
  state?: "unread" | "archived";
  starred?: boolean;
  q?: string;
  sort?: string;
  order?: string;
};

function pageQuery(page: ArticleListPage, cursor: string): string {
  const params = new URLSearchParams();
  if (page.state) params.set("state", page.state);
  if (page.starred) params.set("starred", "1");
  if (page.q) params.set("q", page.q);
  if (page.sort) params.set("sort", page.sort);
  if (page.order) params.set("order", page.order);
  params.set("cursor", cursor);
  params.set("include", "tags");
  return params.toString();
}

export function ArticleList({
  articles,
  emptyTitle,
  emptyHint,
  page,
  heading,
}: {
  articles: ArticleRowData[];
  emptyTitle: string;
  emptyHint: string;
  page?: ArticleListPage;
  /** Shown on the left of the sort row. Home leaves this off. */
  heading?: string;
}) {
  const [state, setState] = useState({
    articles,
    extra: [] as ArticleRowData[],
    cursor: page?.nextCursor ?? null,
    failed: false,
  });
  // A refresh (archive, star, search) replaces the first page. Drop anything
  // appended past it so a row that just changed state doesn't linger.
  if (articles !== state.articles) {
    setState({
      articles,
      extra: [],
      cursor: page?.nextCursor ?? null,
      failed: false,
    });
  }

  const { extra, cursor, failed } = state;
  const rows = articles.concat(extra);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor || failed) return;

    let root: Element | null = null;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        root = node;
        break;
      }
    }

    let cancelled = false;
    async function loadNext() {
      if (!cursor || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/articles?${pageQuery(page ?? { nextCursor: cursor }, cursor)}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ArticleListResponse;
        if (cancelled) return;
        setState((current) => {
          if (current.cursor !== cursor) return current;
          const seen = new Set(current.articles.concat(current.extra).map((row) => row.id));
          const more = body.articles
            .filter((article) => !seen.has(article.id))
            .map((article) => toRowData(article, article.tags ?? []));
          return {
            ...current,
            extra: current.extra.concat(more),
            cursor: body.nextCursor,
            failed: false,
          };
        });
      } catch {
        if (!cancelled) setState((current) => ({ ...current, failed: true }));
      } finally {
        loadingRef.current = false;
        if (!cancelled) setLoading(false);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadNext();
      },
      { root, rootMargin: "480px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cursor, failed, page]);

  const targets = rows.map((article) => ({
    id: article.id,
    starred: article.starred,
    archived: article.state === "ARCHIVED",
    tagSlugs: article.tags.map((tag) => tag.slug),
  }));

  return (
    <SelectionProvider>
      <div
        className={`mb-4 flex w-full min-w-0 items-center gap-3 ${
          heading ? "justify-between" : "justify-end"
        }`}
      >
        {heading ? (
          <h1 className="text-xl font-bold text-slate-900">{heading}</h1>
        ) : null}
        <SelectionToolbar articles={targets}>
          <SortControl />
        </SelectionToolbar>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
          <p className="text-base font-medium text-slate-700">{emptyTitle}</p>
          <p className="mt-1 text-sm text-slate-500">{emptyHint}</p>
        </div>
      ) : (
      <>
      <ul>
        {rows.map((article) => (
          <ArticleRow key={article.id} article={article} />
        ))}
      </ul>
      {cursor && (
        <div ref={sentinelRef} className="py-4 text-center" data-testid="article-list-more">
          {failed ? (
            <button
              type="button"
              className="text-sm text-violet-700 hover:underline"
              onClick={() => setState((current) => ({ ...current, failed: false }))}
            >
              Couldn’t load more. Try again.
            </button>
          ) : (
            <p className="text-sm text-slate-400">{loading ? "Loading more…" : "Scroll for more"}</p>
          )}
        </div>
      )}
      </>
      )}
    </SelectionProvider>
  );
}
