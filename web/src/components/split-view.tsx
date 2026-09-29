import type { ArticleRow } from "@/lib/articles";
import { ArticleReader } from "@/components/article-reader";
import { ReaderColumn } from "@/components/reader-column";
import { SplitPanes } from "@/components/split-panes";

/**
 * Desktop (lg+) master–detail layout for list pages: independently scrolling
 * article list on the left (width adjustable via the drag handle), reader
 * pane for the ?article=<id> selection on the right. Below lg only the list
 * renders — rows navigate to /article/[id].
 */
export function SplitView({
  list,
  article,
  requestedId,
}: {
  list: React.ReactNode;
  /** The selected article, or null when nothing is selected / not found. */
  article: ArticleRow | null;
  /** The raw ?article= param, to distinguish "none selected" from "not found". */
  requestedId?: string;
}) {
  return (
    <SplitPanes
      list={list}
      reader={
        article ? (
          <ReaderColumn>
            <ArticleReader article={article} />
          </ReaderColumn>
        ) : (
          <div className="flex h-full items-center justify-center px-6">
            <div className="text-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                className="mx-auto h-12 w-12 text-slate-300"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 4.5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM8 9h8M8 12.5h8M8 16h5"
                />
              </svg>
              <p className="mt-3 text-sm text-slate-500">
                {requestedId
                  ? "This article doesn't exist or was deleted."
                  : "Select an article to read it here."}
              </p>
            </div>
          </div>
        )
      }
    />
  );
}
