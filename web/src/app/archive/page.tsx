import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArticle, listArticles, parseOrder, parseSort } from "@/lib/articles";
import { tagsForArticles } from "@/lib/tags";
import { ArticleList, toRowData } from "@/components/article-list";
import { SortControl } from "@/components/sort-control";
import { AppShell } from "@/components/app-shell";
import { SplitView } from "@/components/split-view";

export const metadata: Metadata = {
  title: "Read",
};

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; article?: string; sort?: string; order?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { q, article: articleId, sort: sortParam, order: orderParam } =
    await searchParams;
  const query = q?.trim() || undefined;
  const { articles } = await listArticles({
    userId: session.user.id,
    state: "ARCHIVED",
    q: query,
    sort: parseSort(sortParam) ?? undefined,
    order: parseOrder(orderParam) ?? undefined,
  });

  const tagsByArticle = await tagsForArticles(articles.map((a) => a.id));

  const selected = articleId
    ? await getArticle(articleId, session.user.id)
    : null;

  return (
    <AppShell active="archive" q={q} wide>
      <SplitView
        article={selected}
        requestedId={articleId}
        list={
          <>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-900">Read</h1>
          <SortControl />
        </div>
        <div className="mt-4">
          <ArticleList
            articles={articles.map((a) =>
              toRowData(a, tagsByArticle.get(a.id) ?? []),
            )}
            emptyTitle={
              query
                ? `No read articles match “${query}”`
                : "Nothing read yet"
            }
            emptyHint={
              query
                ? "Try a different search."
                : "Articles you mark as read will land here."
            }
          />
        </div>
          </>
        }
      />
    </AppShell>
  );
}
