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
  title: "Starred",
};

export default async function StarredPage({
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

  // Starred spans both unread and archived articles (state omitted = all).
  const { articles } = await listArticles({
    userId: session.user.id,
    starred: true,
    q: query,
    sort: parseSort(sortParam) ?? undefined,
    order: parseOrder(orderParam) ?? undefined,
  });

  const tagsByArticle = await tagsForArticles(articles.map((a) => a.id));

  const selected = articleId
    ? await getArticle(articleId, session.user.id)
    : null;

  return (
    <AppShell active="starred" q={q} wide>
      <SplitView
        article={selected}
        requestedId={articleId}
        list={
          <>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-900">Starred</h1>
          <SortControl />
        </div>
        <div className="mt-4">
          <ArticleList
            articles={articles.map((a) =>
              toRowData(a, tagsByArticle.get(a.id) ?? []),
            )}
            emptyTitle={
              query
                ? `No starred articles match “${query}”`
                : "No starred articles"
            }
            emptyHint={
              query
                ? "Try a different search."
                : "Star the articles you love and they will collect here."
            }
          />
        </div>
          </>
        }
      />
    </AppShell>
  );
}
