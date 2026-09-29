import { ArticleRow, type ArticleRowData } from "@/components/article-row";
import {
  SelectionBar,
  SelectionProvider,
} from "@/components/article-selection";
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

function formatSavedAt(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function ArticleList({
  articles,
  emptyTitle,
  emptyHint,
}: {
  articles: ArticleRowData[];
  emptyTitle: string;
  emptyHint: string;
}) {
  if (articles.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
        <p className="text-base font-medium text-slate-700">{emptyTitle}</p>
        <p className="mt-1 text-sm text-slate-500">{emptyHint}</p>
      </div>
    );
  }

  return (
    // Wrapped so every row gets a checkbox and the bar above them can act on
    // what is ticked; the provider holds the only copy of that state.
    <SelectionProvider>
      <SelectionBar />
      <ul>
        {articles.map((article) => (
          <ArticleRow key={article.id} article={article} />
        ))}
      </ul>
    </SelectionProvider>
  );
}
