import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getArticle } from "@/lib/articles";
import { AppShell } from "@/components/app-shell";
import { ArticleReader } from "@/components/article-reader";

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
  const article = await getArticle(id, session.user.id);
  if (!article) {
    notFound();
  }

  return (
    <AppShell active="none" mainClassName="pb-16">
      <ArticleReader article={article} />
    </AppShell>
  );
}
