import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArticle, type ArticleRow } from "@/lib/articles";
import { AppShell } from "@/components/app-shell";
import { ArticleReader } from "@/components/article-reader";

function ArticleFallback() {
  return (
    <div role="status" aria-label="Loading article" className="py-6">
      <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-4 w-1/2 animate-pulse rounded bg-slate-100" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-4 animate-pulse rounded bg-slate-100"
            style={{ width: index % 4 === 3 ? "70%" : "100%" }}
          />
        ))}
      </div>
    </div>
  );
}

async function LoadedArticle({
  articlePromise,
}: {
  articlePromise: Promise<ArticleRow | null>;
}) {
  const article = await articlePromise;
  if (!article) notFound();
  return <ArticleReader article={article} />;
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  // Start the article read before the shell's tag and count queries, so the
  // two overlap instead of the reader waiting until the sidebar is done.
  const articlePromise = getArticle(id, session.user.id);

  return (
    <AppShell active="none" mainClassName="pb-16">
      <Suspense fallback={<ArticleFallback />}>
        <LoadedArticle articlePromise={articlePromise} />
      </Suspense>
    </AppShell>
  );
}
