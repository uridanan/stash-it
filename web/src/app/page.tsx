import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  getArticle,
  listArticles,
  parseOrder,
  parseSort,
  type ArticleSort,
  type SortOrder,
} from "@/lib/articles";
import { tagsForArticles } from "@/lib/tags";
import { AddUrl } from "@/components/add-url";
import { ArticleList } from "@/components/article-list";
import { toRowData } from "@/components/article-list-data";
import { AppShell } from "@/components/app-shell";
import { SplitView } from "@/components/split-view";

function ListFallback() {
  return (
    <div className="space-y-4 p-4" aria-hidden>
      <div className="h-12 animate-pulse rounded-lg bg-slate-200/80" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-lg bg-slate-200/70" />
      ))}
    </div>
  );
}

async function HomeList({
  listPromise,
  selectedPromise,
  query,
  sort,
  order,
  articleId,
}: {
  listPromise: ReturnType<typeof listArticles>;
  selectedPromise: ReturnType<typeof getArticle>;
  query?: string;
  sort?: ArticleSort;
  order?: SortOrder;
  articleId?: string;
}) {
  const [{ articles, nextCursor }, selected] = await Promise.all([
    listPromise,
    selectedPromise,
  ]);
  const tagsByArticle = await tagsForArticles(articles.map((a) => a.id));

  return (
    <SplitView
      article={selected}
      requestedId={articleId}
      list={
        <>
          <AddUrl />
          <div className="mt-6">
            <ArticleList
              articles={articles.map((a) =>
                toRowData(a, tagsByArticle.get(a.id) ?? []),
              )}
              page={{ nextCursor, state: "unread", q: query, sort, order }}
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
  );
}

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
  const sort = parseSort(sortParam) ?? undefined;
  const order = parseOrder(orderParam) ?? undefined;
  const userId = session.user.id;

  // In flight before the shell asks for counts and collections, so opening
  // the app doesn't wait for the sidebar and then the list in series.
  const listPromise = listArticles({
    userId,
    state: "UNREAD",
    q: query,
    sort,
    order,
  });
  const selectedPromise = articleId
    ? getArticle(articleId, userId)
    : Promise.resolve(null);

  return (
    <AppShell active="home" q={q} wide>
      <Suspense fallback={<ListFallback />}>
        <HomeList
          listPromise={listPromise}
          selectedPromise={selectedPromise}
          query={query}
          sort={sort}
          order={order}
          articleId={articleId}
        />
      </Suspense>
    </AppShell>
  );
}
