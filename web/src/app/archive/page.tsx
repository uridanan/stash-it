import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArticle, listArticles, parseOrder, parseSort } from "@/lib/articles";
import { tagsForArticles } from "@/lib/tags";
import { ArticleList } from "@/components/article-list";
import { toRowData } from "@/components/article-list-data";
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
  const sort = parseSort(sortParam) ?? undefined;
  const order = parseOrder(orderParam) ?? undefined;
  const { articles, nextCursor } = await listArticles({
    userId: session.user.id,
    state: "ARCHIVED",
    q: query,
    sort,
    order,
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
          <ArticleList
            heading="Read"
            articles={articles.map((a) =>
              toRowData(a, tagsByArticle.get(a.id) ?? []),
            )}
            page={{ nextCursor, state: "archived", q: query, sort, order }}
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
          </>
        }
      />
    </AppShell>
  );
}
