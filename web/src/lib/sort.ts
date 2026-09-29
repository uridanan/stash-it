/**
 * List sort options.
 *
 * Kept apart from `articles.ts` because the sort control is a client
 * component: importing these from the data layer would pull Prisma and jsdom
 * into the browser bundle just to read two string constants.
 */

/** What the list is ordered by. */
export type ArticleSort = "added" | "published";
export type SortOrder = "asc" | "desc";

export const DEFAULT_SORT: ArticleSort = "added";
export const DEFAULT_ORDER: SortOrder = "desc";

export function parseSort(value: unknown): ArticleSort | null {
  return value === "added" || value === "published" ? value : null;
}

export function parseOrder(value: unknown): SortOrder | null {
  return value === "asc" || value === "desc" ? value : null;
}
