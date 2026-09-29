import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArticle, listArticles, parseOrder, parseSort } from "@/lib/articles";
import { tagsForArticles } from "@/lib/tags";
import { AddUrl } from "@/components/add-url";
import { ArticleList, toRowData } from "@/components/article-list";
import { SortControl } from "@/components/sort-control";
import { AppShell } from "@/components/app-shell";
import { SplitView } from "@/components/split-view";

export default async function HomePage({
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
    state: "UNREAD",
    q: query,
    sort: parseSort(sortParam) ?? undefined,
    order: parseOrder(orderParam) ?? undefined,
  });

  const tagsByArticle = await tagsForArticles(articles.map((a) => a.id));

  const selected = articleId
    ? await getArticle(articleId, session.user.id)
    : null;

  return (
    <AppShell active="home" q={q} wide>
      <SplitView
        article={selected}
        requestedId={articleId}
        list={
          <>
        <AddUrl />
        <div className="mt-6 flex justify-end">
          <SortControl />
        </div>
        <div className="mt-3">
          <ArticleList
            articles={articles.map((a) =>
              toRowData(a, tagsByArticle.get(a.id) ?? []),
            )}
            emptyTitle={
              query
                ? `No unread articles match “${query}”`
                : "Nothing stashed yet"
            }
            emptyHint={
              query
                ? "Try a different search."
                : "Paste a URL above to save your first article."
            }
          />
        </div>
          </>
        }
      />
    </AppShell>
  );
}
