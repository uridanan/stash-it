import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { ArticleRow } from "@/lib/articles";
import { ReaderControls } from "@/components/reader-controls";
import { ListenRoot } from "@/components/listen/listen-root";
import { TagEditor } from "@/components/tag-editor";
import { FetchText } from "@/components/fetch-text";
import { isStub } from "@/lib/backup";
import { mailConfig } from "@/lib/mail";
import { tagsForArticles } from "@/lib/tags";
import {
  GenerateSummaryButton,
  SummaryCard,
  SummaryTabs,
} from "@/components/summary-view";

/**
 * Full reader view for an article: sticky controls, title/byline header,
 * AI summary (card or tabs, per user settings), extraction-failed notice,
 * and the sanitized content. Used by both the standalone /article/[id]
 * page and the desktop split-view pane.
 */
export async function ArticleReader({ article }: { article: ArticleRow }) {
  const session = await auth();
  const settings = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          aiSummariesEnabled: true,
          aiApiKey: true,
          summaryView: true,
          kindleEmail: true,
        },
      })
    : null;
  const aiConfigured = Boolean(settings?.aiSummariesEnabled && settings?.aiApiKey);
  // Needs both halves: an address to send to and a transport to send with.
  const kindleConfigured = Boolean(settings?.kindleEmail && mailConfig());
  const tags = (await tagsForArticles([article.id])).get(article.id) ?? [];
  const stub = isStub(article);
  const summaryView = settings?.summaryView === "tabs" ? "tabs" : "card";
  const savedDate = new Date(article.savedAt);
  const savedLabel = Number.isNaN(savedDate.getTime())
    ? null
    : savedDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

  const archived = String(article.state).toUpperCase() === "ARCHIVED";

  let hostname: string | null = null;
  try {
    hostname = new URL(article.url).hostname;
  } catch {
    hostname = null;
  }

  return (
    <ListenRoot
      articleId={article.id}
      title={article.title}
      lang={article.lang}
    >
      <ReaderControls
        articleId={article.id}
        starred={article.starred}
        archived={archived}
        aiConfigured={aiConfigured}
        kindleConfigured={kindleConfigured}
      >
        <header className="mt-8">
          <h1 className="text-[1.7rem] font-bold leading-tight text-slate-900">
            {article.title}
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            {article.siteName && (
              <>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-violet-700 hover:underline"
                >
                  {article.siteName}
                </a>
                {" · "}
              </>
            )}
            {article.author && <span>{article.author} · </span>}
            <span>{article.readingMinutes} min read</span>
            {savedLabel && <span> · saved {savedLabel}</span>}
            {" · "}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-700 underline underline-offset-2 hover:text-violet-800"
            >
              View original
            </a>
          </p>
          <TagEditor articleId={article.id} initialTags={tags} />
        </header>

        {article.summary && summaryView === "card" && (
          <SummaryCard summary={article.summary} />
        )}
        {!article.summary && aiConfigured && (
          <GenerateSummaryButton articleId={article.id} />
        )}

        {stub && <FetchText articleId={article.id} />}

        {article.extractionFailed && (
          <div className="mt-6 rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-900">
            We couldn&apos;t extract a readable version of this page.{" "}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              Read it on {hostname ?? "the original site"}
            </a>
            .
          </div>
        )}

        {article.summary && summaryView === "tabs" ? (
          <SummaryTabs summary={article.summary}>
            <article
              className="reader"
              data-listen="article"
              data-testid="reader-content"
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          </SummaryTabs>
        ) : (
          <article
            className="reader mt-8"
            data-listen="article"
            data-testid="reader-content"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        )}
      </ReaderControls>
    </ListenRoot>
  );
}
