import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import {
  CollectionOrder,
  type CollectionItem,
} from "@/components/collection-order";
import { SplitView } from "@/components/split-view";
import { getArticle } from "@/lib/articles";
import { TAG_WONT_NARRATE } from "@/lib/auto-tags";
import { CollectionActions } from "@/components/collection-actions";
import { getTagBySlug, listTagArticles, listTags } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Collection",
};

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ article?: string; unread?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { slug } = await params;
  const { article: articleId, unread } = await searchParams;
  const unreadOnly = unread === "1";
  const tag = await getTagBySlug(session.user.id, slug);
  if (!tag) notFound();

  const SELECT = {
    id: true,
    title: true,
    siteName: true,
    readingMinutes: true,
    state: true,
    tags: { select: { tag: { select: { name: true } } } },
  };

  const rows = await listTagArticles(session.user.id, tag.id, SELECT, unreadOnly);
  // The unfiltered count tells the toggle how much it is hiding.
  const totalCount = unreadOnly
    ? (await listTagArticles(session.user.id, tag.id, { id: true })).length
    : rows.length;

  const items: CollectionItem[] = rows.map((row) => {
    const article = row as unknown as {
      id: string;
      title: string;
      siteName: string | null;
      readingMinutes: number;
      state: string;
      tags: { tag: { name: string } }[];
    };
    return {
      id: article.id,
      title: article.title,
      siteName: article.siteName,
      readingMinutes: article.readingMinutes,
      read: String(article.state).toUpperCase() === "ARCHIVED",
      wontNarrate: article.tags.some((t) => t.tag.name === TAG_WONT_NARRATE),
    };
  });

  const selected = articleId
    ? await getArticle(articleId, session.user.id)
    : null;

  // Merge targets: every other collection this user has.
  const others = (await listTags(session.user.id))
    .filter((row) => row.slug !== tag.slug)
    .map((row) => ({ name: row.name, slug: row.slug }));

  return (
    // Split view, like the article lists: on desktop the collection stays on
    // the left while its articles open on the right, so the running order
    // remains visible while reading or listening through it.
    <AppShell active="tags" activeTagSlug={slug} wide>
      <SplitView
        article={selected}
        requestedId={articleId}
        list={
          <>
            <Link href="/tags" className="text-sm text-violet-700 hover:underline">
              ← Collections
            </Link>
            <div className="mt-2 flex items-start justify-between gap-3">
              <h1 className="text-xl font-bold text-slate-900">{tag.name}</h1>
              <CollectionActions slug={tag.slug} name={tag.name} others={others} />
            </div>
            <div className="mt-4">
              <CollectionOrder
                slug={tag.slug}
                name={tag.name}
                items={items}
                unreadOnly={unreadOnly}
                totalCount={totalCount}
              />
            </div>
          </>
        }
      />
    </AppShell>
  );
}
