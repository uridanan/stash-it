import Link from "next/link";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SaveConfirmation } from "@/components/save-confirmation";
import { runAiTasksOnSave } from "@/lib/ai-tasks";
import { saveArticleFromUrl } from "@/lib/articles";
import { fillStub } from "@/lib/backup";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Save — Stash",
};

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;

/**
 * Find the first http(s) URL among the share-target params.
 * Android share intents (notably the Google app) often place the URL
 * inside `text` rather than `url`, so we scan url → text → title.
 */
function findSharedUrl(
  url: string | undefined,
  text: string | undefined,
  title: string | undefined,
): string | null {
  for (const candidate of [url, text, title]) {
    if (!candidate) continue;
    const match = candidate.match(URL_PATTERN);
    if (match) return match[0];
  }
  return null;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {children}
      </div>
    </main>
  );
}

const homeLinkClass =
  "inline-flex min-h-12 items-center justify-center rounded-lg bg-violet-600 px-6 py-3 text-base font-medium text-white hover:bg-violet-700";

type SearchParams = {
  url?: string | string[];
  text?: string | string[];
  title?: string | string[];
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SavePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const sharedUrl = findSharedUrl(
    first(params.url),
    first(params.text),
    first(params.title),
  );

  if (!sharedUrl) {
    return (
      <Card>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
          🔍
        </div>
        <h1 className="mb-2 text-xl font-semibold text-slate-900">
          No link found
        </h1>
        <p className="mb-6 text-base text-slate-500">
          We couldn&rsquo;t find a URL in what was shared. Try sharing the page
          again, or add it manually from your list.
        </p>
        <Link href="/" className={homeLinkClass}>
          Go home
        </Link>
      </Card>
    );
  }

  const userId = session.user.id;
  let article: Awaited<ReturnType<typeof saveArticleFromUrl>>;
  try {
    // The row is enough to confirm the save. Fetching the page can take
    // several seconds and used to leave this screen blank the whole time.
    article = await saveArticleFromUrl(userId, sharedUrl, {
      deferExtraction: true,
    });
  } catch {
    return (
      <Card>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">
          ⚠️
        </div>
        <h1 className="mb-2 text-xl font-semibold text-slate-900">
          Couldn&rsquo;t save that
        </h1>
        <p className="mb-1 text-base text-slate-500">
          Something went wrong while saving:
        </p>
        <p className="mb-6 break-all text-base text-slate-400">{sharedUrl}</p>
        <Link href="/" className={homeLinkClass}>
          Go home
        </Link>
      </Card>
    );
  }

  if (article.pendingExtraction) {
    const articleId = article.id;
    after(() => {
      void fillStub(articleId, userId)
        .then((result) => {
          if (result.ok) return runAiTasksOnSave(articleId, userId);
        })
        .catch(() => {
          console.error(`Background extraction failed for article ${articleId}`);
        });
    });
  }

  return (
    <Card>
      <SaveConfirmation
        articleId={article.id}
        title={article.title}
        extractionFailed={article.extractionFailed}
        pendingExtraction={article.pendingExtraction}
      />
    </Card>
  );
}
