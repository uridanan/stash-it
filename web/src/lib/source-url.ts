/**
 * Text saved through the API has no page to open.
 *
 * The row still needs a unique `url` — that column is how a second save of
 * the same URL (and the same text) finds the article it already stored. The
 * value is `stash-text:` plus a hash, which is not a link. Anything a person
 * might click, or a model might treat as the source, goes through `sourceUrl`
 * and gets null back.
 */

export const TEXT_ARTICLE_PREFIX = "stash-text:";

export function isTextArticleUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(TEXT_ARTICLE_PREFIX);
}

/** The page this article was saved from, or null when there isn't one. */
export function sourceUrl(url: string | null | undefined): string | null {
  if (!url || isTextArticleUrl(url)) return null;
  return url;
}
