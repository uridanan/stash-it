"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CheckIcon, SortIcon } from "@/components/icons";
import { Menu } from "@/components/menu";
import { DEFAULT_ORDER, DEFAULT_SORT } from "@/lib/sort";

/**
 * Sort control for the article lists.
 *
 * One button opens the four choices (what to sort by, and which way). State
 * lives in the URL, so a sorted list is shareable, survives a reload, and is
 * read on the server where the query actually happens.
 */
export function SortControl({ className = "" }: { className?: string }) {
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

  return (
    <div className={className} data-testid="sort-control">
      <Menu
        label="Sort"
        testId="sort-menu"
        icon={<SortIcon className="h-6 w-6" />}
        className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
      >
        {(close) => (
          <>
            <SortOption
              label="Date added"
              checked={sort === "added"}
              testId="sort-added"
              onSelect={() => {
                update({ sort: "added" });
                close();
              }}
            />
            <SortOption
              label="Date published"
              checked={sort === "published"}
              testId="sort-published"
              onSelect={() => {
                update({ sort: "published" });
                close();
              }}
            />
            <div className="my-1 border-t border-slate-100" role="separator" />
            <SortOption
              label="Newest first"
              checked={order === "desc"}
              testId="sort-newest"
              onSelect={() => {
                update({ order: "desc" });
                close();
              }}
            />
            <SortOption
              label="Oldest first"
              checked={order === "asc"}
              testId="sort-oldest"
              onSelect={() => {
                update({ order: "asc" });
                close();
              }}
            />
          </>
        )}
      </Menu>
    </div>
  );
}

function SortOption({
  label,
  checked,
  testId,
  onSelect,
}: {
  label: string;
  checked: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      data-testid={testId}
      onClick={onSelect}
      className={`flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-base transition-colors hover:bg-slate-100 ${
        checked ? "font-medium text-violet-700" : "text-slate-800"
      }`}
    >
      <CheckIcon className={`h-4 w-4 shrink-0 ${checked ? "opacity-100" : "opacity-0"}`} />
      {label}
    </button>
  );
}
