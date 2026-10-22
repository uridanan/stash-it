"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChevronLeftIcon, TagIcon } from "@/components/icons";

export interface CollectionIndexTag {
  id: string;
  name: string;
  slug: string;
  articleCount: number;
  readCount: number;
}

export function CollectionIndex({ tags }: { tags: CollectionIndexTag[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? tags.filter((tag) => tag.name.toLowerCase().includes(needle))
        : tags,
    [needle, tags],
  );

  return (
    <>
      <form
        role="search"
        className="relative mt-6"
        onSubmit={(event) => event.preventDefault()}
      >
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-6 w-6 shrink-0"
            aria-hidden
          >
            <circle cx="11" cy="11" r="6.5" />
            <path strokeLinecap="round" d="m16 16 4.5 4.5" />
          </svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a collection"
          aria-label="Find a collection"
          className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-11 pr-3 text-base outline-none transition-colors focus:border-violet-600 focus:bg-white"
        />
      </form>

      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No collections match “{query.trim()}”
        </p>
      ) : (
        <ul data-testid="tag-list" className="mt-4">
          {shown.map((tag) => (
            <li key={tag.id} className="border-b border-slate-100">
              <Link
                href={`/tags/${tag.slug}`}
                className="flex items-center gap-3 py-3 transition-colors hover:bg-slate-50"
              >
                <TagIcon className="h-5 w-5 shrink-0 text-slate-400" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate text-base font-medium text-slate-900">
                  {tag.name}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-slate-500">
                  <span className="font-bold text-slate-900">
                    {tag.articleCount - tag.readCount}
                  </span>
                  /{tag.articleCount}
                </span>
                <ChevronLeftIcon className="h-5 w-5 shrink-0 rotate-180 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
