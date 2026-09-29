/**
 * Shared API payload types ("DTO"s) used by both the API routes and the
 * frontend. All dates are ISO-8601 strings (the JSON-serialized form).
 *
 * Article `state` is exposed exactly as stored: "UNREAD" | "ARCHIVED".
 * The GET /api/articles `state` query param and PATCH bodies also accept
 * the lowercase forms ("unread" | "archived").
 */

export type ArticleState = "UNREAD" | "ARCHIVED";

export interface ArticleListItemDTO {
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  wordCount: number;
  readingMinutes: number;
  leadImageUrl: string | null;
  state: ArticleState;
  starred: boolean;
  extractionFailed: boolean;
  savedAt: string;
  readAt: string | null;
  /** When the source says it was published; null when the page doesn't say. */
  publishedAt: string | null;
  /** BCP-47 language declared by the page, e.g. "he", "fr-CA". */
  lang: string | null;
}

/** A collection. Doubles as a playlist — its articles carry an explicit order. */
export interface TagDTO {
  id: string;
  name: string;
  slug: string;
  kind: TagKind;
  articleCount: number;
}

export type TagKind =
  | "TOPIC"
  | "LENGTH"
  | "LANGUAGE"
  | "FORMAT"
  | "SHOPPING"
  | "TTS"
  | "CUSTOM";

export type TagSource = "MANUAL" | "AUTO";

/** A tag as attached to one article, with how it got there. */
export interface ArticleTagDTO {
  id: string;
  name: string;
  slug: string;
  kind: TagKind;
  source: TagSource;
}

export interface TagListResponse {
  tags: TagDTO[];
}

/** Full article, including sanitized HTML content (detail endpoint only). */
export interface ArticleDTO extends ArticleListItemDTO {
  content: string;
  summary: string | null;
}

export interface ArticleListResponse {
  articles: ArticleListItemDTO[];
  nextCursor: string | null;
}

export interface ArticleResponse {
  article: ArticleDTO;
}

export interface ApiTokenDTO {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface TokenListResponse {
  tokens: ApiTokenDTO[];
}

/** Returned once, on token creation — the plaintext token is never shown again. */
export interface TokenCreateResponse {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

export interface HealthResponse {
  ok: true;
}

export interface ApiErrorResponse {
  error: string;
}
