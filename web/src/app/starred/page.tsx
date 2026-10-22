import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArticle, listArticles, parseOrder, parseSort } from "@/lib/articles";
import { tagsForArticles } from "@/lib/tags";
import { ArticleList } from "@/components/article-list";
import { StarIcon } from "@/components/icons";
import { toRowData } from "@/components/article-list-data";
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

  const sort = parseSort(sortParam) ?? undefined;
  const order = parseOrder(orderParam) ?? undefined;
  // Starred spans both unread and archived articles (state omitted = all).
  const { articles, nextCursor } = await listArticles({
    userId: session.user.id,
    starred: true,
    q: query,
    sort,
    order,
  });

  const tagsByArticle = await tagsForArticles(articles.map((a) => a.id));

  const selected = articleId
    ? await getArticle(articleId, session.user.id)
    : null;

  return (
    <AppShell active="starred" q={q} wide barTitle={{ label: "Starred", icon: "star" }}>
      <SplitView
        article={selected}
        requestedId={articleId}
        list={
          <>
          <ArticleList
            heading="Starred"
            headingIcon={<StarIcon className="h-6 w-6 shrink-0" strokeWidth={1.8} />}
            articles={articles.map((a) =>
              toRowData(a, tagsByArticle.get(a.id) ?? []),
            )}
            page={{ nextCursor, starred: true, q: query, sort, order }}
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
          </>
        }
      />
    </AppShell>
  );
}
