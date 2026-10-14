"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ChevronDownIcon } from "@/components/icons";
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

  return (
    <div className="flex items-center gap-2" data-testid="sort-control">
      <SortSelect
        label="Sort by"
        testId="sort-by"
        value={sort}
        onChange={(value) => update({ sort: value })}
        options={[
          { value: "added", label: "Date added" },
          { value: "published", label: "Date published" },
        ]}
      />
      <SortSelect
        label="Order"
        testId="sort-order"
        value={order}
        onChange={(value) => update({ order: value })}
        options={[
          { value: "desc", label: "Newest first" },
          { value: "asc", label: "Oldest first" },
        ]}
      />
    </div>
  );
}

/**
 * The closed control is only as wide as the selected label. A native select
 * sizes to its longest option and pins the chevron to that wider edge, so the
 * arrow is taken out of that width and placed after the words.
 */
function SortSelect({
  label,
  testId,
  value,
  onChange,
  options,
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const selected = options.find((option) => option.value === value)?.label ?? "";

  return (
    <label className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-3 text-base text-slate-800 transition-colors focus-within:border-violet-600">
      <span className="sr-only">{label}</span>
      <span className="relative inline-flex items-center">
        <span aria-hidden className="invisible whitespace-pre">
          {selected}
        </span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          data-testid={testId}
          className="absolute inset-0 w-full appearance-none bg-transparent font-[inherit] text-inherit outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
      <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-500" />
    </label>
  );
}
