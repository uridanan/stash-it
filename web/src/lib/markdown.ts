import TurndownService from "turndown";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- the GFM plugin ships no types
import { gfm } from "turndown-plugin-gfm";

/**
 * Markdown rendering of an article, for the one-way readable export.
 *
 * Deliberately one-way: because these files are never imported, they can be
 * clean Markdown rather than Markdown wrapped around HTML islands. Anything
 * Markdown cannot express is still emitted as inline HTML by Turndown, so the
 * file reads correctly in Obsidian — it just is not a restore artefact.
 */

export interface MarkdownArticle {
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  content: string;
  summary: string | null;
  state: string;
  starred: boolean;
  savedAt: Date;
  publishedAt: Date | null;
  lang: string | null;
  readingMinutes: number;
  tags: string[];
}

/**
 * Tags kept verbatim as inline HTML.
 *
 * Turndown's default for an unrecognized tag is to drop it and keep only its
 * text, which quietly changes meaning: `x<sup>2</sup>` becomes `x2`, and a
 * definition list flattens into loose paragraphs. Every tag here is in the
 * sanitizer's allowlist and has no Markdown equivalent, so it is preserved as
 * HTML — which Obsidian and every other Markdown renderer displays correctly.
 */
const KEEP_AS_HTML = [
  "sub",
  "sup",
  "dl",
  "dt",
  "dd",
  "abbr",
  "kbd",
  "mark",
  "ins",
  "u",
  "small",
  "q",
  "cite",
  "time",
  "figure",
  "figcaption",
  "caption",
] as const;

let turndown: TurndownService | null = null;

function service(): TurndownService {
  if (turndown) return turndown;
  const instance = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  // Tables, strikethrough and task lists, which core Markdown lacks.
  instance.use(gfm);
  instance.keep([...KEEP_AS_HTML]);
  turndown = instance;
  return instance;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  return service().turndown(html).trim();
}

/**
 * Quotes every scalar written into frontmatter.
 *
 * YAML 1.1 — which PyYAML and much of the surrounding tooling still use —
 * reads `no`, `on`, `1.10` and bare dates as booleans, floats and timestamps.
 * Tag names and titles are free text, so quoting unconditionally is the only
 * way a value survives the round trip through someone else's parser.
 */
export function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map(yamlScalar).join(", ")}]`;
}

/**
 * A filename that is unique and still recognizable.
 *
 * Id-led on purpose: measured on a real 11.7k-article library, 238 titles
 * reduce to an empty ASCII slug (they are Hebrew), 14 are blank and 24 collide.
 * The id guarantees uniqueness; the slug is a courtesy for humans browsing a
 * folder.
 */
export function articleFilename(
  article: { id: string; title: string },
  extension: string,
): string {
  const slug = article.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug ? `${article.id}-${slug}.${extension}` : `${article.id}.${extension}`;
}

export function frontmatter(article: MarkdownArticle): string {
  const lines = [
    "---",
    `title: ${yamlScalar(article.title)}`,
    `url: ${yamlScalar(article.url)}`,
  ];
  if (article.siteName) lines.push(`source: ${yamlScalar(article.siteName)}`);
  if (article.author) lines.push(`author: ${yamlScalar(article.author)}`);
  lines.push(`saved: ${yamlScalar(article.savedAt.toISOString())}`);
  if (article.publishedAt) {
    lines.push(`published: ${yamlScalar(article.publishedAt.toISOString())}`);
  }
  if (article.lang) lines.push(`lang: ${yamlScalar(article.lang)}`);
  lines.push(
    `status: ${yamlScalar(article.state === "ARCHIVED" ? "read" : "unread")}`,
  );
  // Booleans and numbers are the two cases where an unquoted scalar is
  // unambiguous in every YAML version.
  lines.push(`starred: ${article.starred ? "true" : "false"}`);
  lines.push(`reading_minutes: ${article.readingMinutes}`);
  lines.push(`tags: ${yamlList(article.tags)}`);
  lines.push("---");
  return lines.join("\n");
}

/** One article as a Markdown document: frontmatter, summary, then the body. */
export function articleToMarkdown(article: MarkdownArticle): string {
  const parts = [frontmatter(article), "", `# ${article.title}`, ""];

  if (article.summary?.trim()) {
    parts.push("## Summary", "", article.summary.trim(), "");
  }

  const body = htmlToMarkdown(article.content);
  if (body) {
    parts.push("## Article", "", body, "");
  } else {
    parts.push(
      "## Article",
      "",
      `*No article text was saved. [Read it at the source](${article.url}).*`,
      "",
    );
  }

  parts.push("---", "", `[Original](${article.url})`, "");
  return parts.join("\n");
}

/** A browsable index of the whole export. */
export function indexToMarkdown(
  articles: readonly MarkdownArticle[],
  exportedAt: Date,
): string {
  const lines = [
    "---",
    `title: ${yamlScalar("Stash export")}`,
    `exported: ${yamlScalar(exportedAt.toISOString())}`,
    `count: ${articles.length}`,
    "---",
    "",
    "# Stash export",
    "",
    `${articles.length} article(s), exported ${exportedAt.toISOString().slice(0, 10)}.`,
    "",
  ];

  for (const article of articles) {
    const file = articleFilename(article, "md");
    const bits = [
      article.state === "ARCHIVED" ? "read" : "unread",
      article.starred ? "starred" : null,
      article.siteName,
      article.tags.length ? article.tags.join(", ") : null,
    ].filter(Boolean);
    lines.push(`- [${article.title}](articles/${file}) — ${bits.join(" · ")}`);
  }

  lines.push("");
  return lines.join("\n");
}
