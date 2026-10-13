import type { ArticleRowData } from "@/components/article-row";
import type { ArticleTagDTO } from "@/types";

/** Structural shape of an article as returned by the data layer. */
export type ArticleListItem = {
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  excerpt: string | null;
  readingMinutes: number;
  savedAt: Date | string;
  starred: boolean;
  /** Normalized case-insensitively; "archived"/"ARCHIVED" both accepted. */
  state: string;
  publishedAt?: Date | string | null;
};

export function toRowData(
  article: ArticleListItem,
  tags: ArticleTagDTO[] = [],
): ArticleRowData {
  return {
    tags,
    id: article.id,
    title: article.title,
    url: article.url,
    siteName: article.siteName,
    excerpt: article.excerpt,
    readingMinutes: article.readingMinutes,
    savedAtLabel: formatSavedAt(article.savedAt),
    starred: article.starred,
    state: article.state.toUpperCase() === "ARCHIVED" ? "ARCHIVED" : "UNREAD",
  };
}

/**
 * UTC, so a page rendered in the container and a page fetched in the browser
 * print the same day. The container's clock is UTC; the browser's is not.
 */
function formatSavedAt(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
