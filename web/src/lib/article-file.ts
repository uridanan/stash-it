/**
 * The per-article HTML file inside a backup archive.
 *
 * It carries two payloads — the AI summary and the sanitized body — and has to
 * survive a round trip exactly, since this is the restore artefact. Sections
 * are delimited by HTML comments rather than parsed as a document: comment
 * markers are exact and cost nothing, whereas running a DOM parser over 11k
 * files to find two sections would be slow and would rewrite the very markup
 * we are trying to preserve byte for byte.
 *
 * The file still opens in a browser: the comments are invisible and the body
 * renders as the article.
 */

const SUMMARY_MARKER = "<!--stash:summary-->";
const CONTENT_MARKER = "<!--stash:content-->";
const END_MARKER = "<!--stash:end-->";

/**
 * Escapes text destined for a section that is *not* markup.
 *
 * Only the summary needs this. Model output is plain text but can contain `<`,
 * which would otherwise be read back as the start of a tag.
 */
export function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function unescapeText(text: string): string {
  // Ampersand last, or "&amp;lt;" would decode twice.
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface ArticleFilePayload {
  title: string;
  url: string;
  lang: string | null;
  summary: string | null;
  content: string;
}

export function buildArticleFile(payload: ArticleFilePayload): string {
  const parts = [
    "<!doctype html>",
    `<html lang="${escapeText(payload.lang ?? "en")}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeText(payload.title)}</title>`,
    `<link rel="canonical" href="${escapeText(payload.url)}">`,
    "</head>",
    "<body>",
  ];

  if (payload.summary?.trim()) {
    parts.push(SUMMARY_MARKER, escapeText(payload.summary), CONTENT_MARKER);
  } else {
    parts.push(CONTENT_MARKER);
  }

  parts.push(payload.content, END_MARKER, "</body>", "</html>", "");
  return parts.join("\n");
}

export interface ParsedArticleFile {
  summary: string | null;
  content: string;
}

/**
 * Reads the two sections back out.
 *
 * A file missing the markers yields no content rather than guessing, so a
 * stray file dropped into `articles/` cannot be mistaken for an article body.
 */
export function parseArticleFile(text: string): ParsedArticleFile | null {
  const contentAt = text.indexOf(CONTENT_MARKER);
  if (contentAt === -1) return null;

  const endAt = text.indexOf(END_MARKER, contentAt);
  const content = text
    .slice(contentAt + CONTENT_MARKER.length, endAt === -1 ? undefined : endAt)
    .trim();

  const summaryAt = text.indexOf(SUMMARY_MARKER);
  let summary: string | null = null;
  if (summaryAt !== -1 && summaryAt < contentAt) {
    const raw = text.slice(summaryAt + SUMMARY_MARKER.length, contentAt).trim();
    summary = raw ? unescapeText(raw) : null;
  }

  return { summary, content };
}
