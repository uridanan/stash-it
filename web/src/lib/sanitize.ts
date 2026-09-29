import sanitizeHtml from "sanitize-html";

/**
 * The allowlist every stored article body passes through.
 *
 * Article HTML is rendered with `dangerouslySetInnerHTML`, so this is the only
 * thing standing between a hostile page — or a hostile backup file — and
 * script execution in the reader. It lives in its own module so both the
 * extraction path and the import path use exactly the same rules; a second
 * copy would inevitably drift.
 */
export const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "caption",
    "cite",
    "code",
    "dd",
    "del",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "ins",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "q",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "time",
    "tr",
    "u",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    time: ["datetime"],
  },
  // img src restricted to http/https; scripts/styles/iframes are stripped
  // (not in allowedTags) and their text content discarded by default.
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
    img: ["http", "https"],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener" }, true),
  },
};

/** Sanitizes an article body for storage. */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
