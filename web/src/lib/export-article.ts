import { prisma } from "@/lib/db";

/**
 * The one article shape every single-article download route needs.
 *
 * Markdown, PDF and EPUB each want the same row — body, summary, byline,
 * dates, tags — so the query lives here rather than being copied three times
 * and drifting.
 */
export async function loadExportArticle(id: string, userId: string) {
  const article = await prisma.article.findFirst({
    where: { id, userId },
    select: {
      id: true,
      url: true,
      title: true,
      siteName: true,
      author: true,
      excerpt: true,
      content: true,
      summary: true,
      state: true,
      starred: true,
      savedAt: true,
      publishedAt: true,
      lang: true,
      readingMinutes: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!article) return null;

  return {
    ...article,
    state: String(article.state),
    tags: article.tags.map((entry) => entry.tag.name),
  };
}

export type ExportArticle = NonNullable<
  Awaited<ReturnType<typeof loadExportArticle>>
>;
