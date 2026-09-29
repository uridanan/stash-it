"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { DEFAULT_ORDER, DEFAULT_SORT } from "@/lib/sort";

/**
 * Sort control for the article lists.
 *
 * State lives in the URL rather than in component state, so a sorted list is
 * shareable, survives a reload, and is read on the server where the query
 * actually happens.
 */
export function SortControl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sort = searchParams.get("sort") === "published" ? "published" : DEFAULT_SORT;
  const order = searchParams.get("order") === "asc" ? "asc" : DEFAULT_ORDER;

  function update(next: { sort?: string; order?: string }) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      // Keep the URL clean: defaults are implied, not spelled out.
      const isDefault =
        (key === "sort" && value === DEFAULT_SORT) ||
        (key === "order" && value === DEFAULT_ORDER);
      if (isDefault) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const selectClass =
    "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-violet-600";

  return (
    <div className="flex items-center gap-2" data-testid="sort-control">
      <label className="flex items-center gap-1 text-xs text-slate-500">
        <span className="sr-only">Sort by</span>
        <select
          value={sort}
          onChange={(event) => update({ sort: event.target.value })}
          aria-label="Sort by"
          data-testid="sort-by"
          className={selectClass}
        >
          <option value="added">Date added</option>
          <option value="published">Date published</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-500">
        <span className="sr-only">Order</span>
        <select
          value={order}
          onChange={(event) => update({ order: event.target.value })}
          aria-label="Order"
          data-testid="sort-order"
          className={selectClass}
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </label>
    </div>
  );
}
