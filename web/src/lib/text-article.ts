import { createHash } from "node:crypto";

import { detectLanguageFromText } from "@/lib/lang";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { TEXT_ARTICLE_PREFIX } from "@/lib/source-url";
import { htmlToText } from "@/lib/summarize";

/** Same pace the URL extractor uses, so a pasted article reads the same length. */
const WORDS_PER_MINUTE = 225;
const EXCERPT_LENGTH = 200;

export const MAX_TEXT_CHARS = 1_500_000;
export const MAX_TITLE_CHARS = 300;
export const MAX_AUTHOR_CHARS = 200;

export class TextArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextArticleError";
  }
}

export interface PreparedTextArticle {
  /** Stable identity for this exact text. Not a link. */
  url: string;
  title: string;
  author: string | null;
  excerpt: string | null;
  content: string;
  wordCount: number;
  readingMinutes: number;
  lang: string | null;
}

/**
 * The identity of a text article: the same text saved twice is the same row.
 *
 * Hashing the normalized text, not a random id, is what makes an agent retry
 * land on the article it already created instead of a duplicate.
 */
export function textArticleUrl(normalizedText: string): string {
  const hash = createHash("sha256").update(normalizedText).digest("hex");
  return TEXT_ARTICLE_PREFIX + hash;
}

/** Newlines unified and surrounding space dropped, so a retry matches. */
export function normalizeArticleText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A real tag, as opposed to a less-than sign in prose ("a < b").
 * Markup is sanitized; plain text is escaped and wrapped in paragraphs.
 */
const HTML_MARKUP = /<\/?[a-z][\w:-]*\b[^>]*>/i;

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function wordCountOf(text: string): number {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.split(" ").length : 0;
}

function excerptOf(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : flat;
}

function derivedTitle(plain: string): string {
  const line =
    plain
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  const stripped = line.replace(/^#{1,6}\s+/, "").trim();
  const cut =
    stripped.length > MAX_TITLE_CHARS
      ? stripped.slice(0, MAX_TITLE_CHARS).trimEnd()
      : stripped;
  return cut || "Untitled";
}

function optionalName(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TextArticleError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new TextArticleError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

/**
 * Turns an agent's text into the fields an article row stores.
 *
 * Plain text becomes paragraphs. Markup is sanitized with the same allowlist
 * as a fetched page, so a pasted email cannot carry a script into the reader.
 * There is no URL to fetch and no source link to store.
 */
export function prepareTextArticle(input: {
  text: unknown;
  title?: unknown;
  author?: unknown;
}): PreparedTextArticle {
  if (typeof input.text !== "string") {
    throw new TextArticleError("Missing required field: text");
  }
  const normalized = normalizeArticleText(input.text);
  if (!normalized) throw new TextArticleError("text is empty");
  if (normalized.length > MAX_TEXT_CHARS) {
    throw new TextArticleError(
      `text must be ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters or fewer`,
    );
  }

  const title = optionalName(input.title, "title", MAX_TITLE_CHARS);
  const author = optionalName(input.author, "author", MAX_AUTHOR_CHARS);

  const html = HTML_MARKUP.test(normalized)
    ? sanitizeArticleHtml(normalized)
    : sanitizeArticleHtml(plainTextToHtml(normalized));
  const plain = htmlToText(html);
  const wordCount = wordCountOf(plain);
  if (!html.trim() || wordCount === 0) {
    throw new TextArticleError("text has no readable content");
  }

  return {
    url: textArticleUrl(normalized),
    title: title ?? derivedTitle(plain),
    author,
    excerpt: excerptOf(plain),
    content: html,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
    lang: detectLanguageFromText(plain),
  };
}
