import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { saveArticleFromUrl } from "@/lib/articles";

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
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
          🔍
        </div>
        <h1 className="mb-2 text-lg font-semibold text-slate-900">
          No link found
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          We couldn&rsquo;t find a URL in what was shared. Try sharing the page
          again, or add it manually from your list.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
        >
          Go home
        </Link>
      </Card>
    );
  }

  let article: Awaited<ReturnType<typeof saveArticleFromUrl>>;
  try {
    article = await saveArticleFromUrl(session.user.id, sharedUrl);
  } catch {
    return (
      <Card>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl">
          ⚠️
        </div>
        <h1 className="mb-2 text-lg font-semibold text-slate-900">
          Couldn&rsquo;t save that
        </h1>
        <p className="mb-1 text-sm text-slate-500">
          Something went wrong while saving:
        </p>
        <p className="mb-6 break-all text-sm text-slate-400">{sharedUrl}</p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
        >
          Go home
        </Link>
      </Card>
    );
  }

  return (
    <>
      {/* Auto-return to the list after a short confirmation pause. */}
      <meta httpEquiv="refresh" content="2.5;url=/" />
      <Card>
        <div data-testid="save-confirmation">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-2xl">
            ✓
          </div>
          <h1 className="mb-2 text-lg font-semibold text-slate-900">Saved</h1>
          <p className="mb-1 text-base font-medium text-slate-700">
            {article.title}
          </p>
          {article.extractionFailed && (
            <p className="mb-2 text-xs text-violet-700">
              We saved the link, but couldn&rsquo;t extract the article text.
            </p>
          )}
          <p className="mb-6 text-xs text-slate-400">
            Returning to your list in a moment&hellip;
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href={`/article/${article.id}`}
              className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              Read now
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Done
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
