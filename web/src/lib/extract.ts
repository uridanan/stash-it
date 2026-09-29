import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { sanitizeArticleHtml } from "@/lib/sanitize";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 10;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB
const USER_AGENT = "Mozilla/5.0 (compatible; StashBot/1.0)";
const WORDS_PER_MINUTE = 225;
const EXCERPT_LENGTH = 200;

export type ExtractionErrorCode =
  | "invalid-url"
  | "fetch-failed"
  | "http-error"
  | "not-html"
  | "too-large"
  | "parse-failed"
  | "no-content";

/** Typed error thrown for any extraction failure. Callers save a stub article. */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message?: string) {
    super(message ?? `Article extraction failed: ${code}`);
    this.name = "ExtractionError";
    this.code = code;
  }
}

export interface ExtractedArticle {
  title: string;
  siteName: string | null;
  author: string | null;
  excerpt: string | null;
  content: string;
  wordCount: number;
  readingMinutes: number;
  leadImageUrl: string | null;
  /** When the source says it was published. Null when the page doesn't say. */
  publishedAt: Date | null;
  /** BCP-47 language declared by the page, e.g. "he", "fr-CA". */
  lang: string | null;
  /** Signals for automatic tagging that are only visible during extraction. */
  signals: ExtractionSignals;
}

/**
 * Page facts that inform automatic tagging but aren't worth storing as columns.
 * Gathered while the DOM is still open, since Readability mutates it.
 */
export interface ExtractionSignals {
  /** JSON-LD @type: Product, or og:type=product. */
  isProduct: boolean;
  /** The content embeds a <video> or a player <iframe>. */
  hasEmbeddedMedia: boolean;
}


function assertHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExtractionError("invalid-url", `Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ExtractionError(
      "invalid-url",
      `Unsupported URL scheme: ${parsed.protocol}`,
    );
  }
  return parsed;
}

/**
 * Minimal cookie jar for a single redirect chain. Some sites (e.g. Yahoo's
 * consent flow) set cookies on an intermediate redirect hop and only serve
 * the article if later hops send them back; Node's fetch drops cookies
 * between redirects, so we follow redirects manually and carry them.
 * Path/expiry attributes are ignored — the jar lives for one fetch only.
 */
class RedirectCookieJar {
  private cookies = new Map<string, { value: string; domain: string }>();

  store(setCookieLines: string[], requestHost: string): void {
    for (const line of setCookieLines) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = requestHost;
      for (const attr of attrs) {
        const [k, v] = attr.split("=");
        if (k.trim().toLowerCase() === "domain" && v?.trim()) {
          domain = v.trim().replace(/^\./, "").toLowerCase();
        }
      }
      this.cookies.set(`${name}@${domain}`, { value: `${name}=${value}`, domain });
    }
  }

  headerFor(host: string): string | null {
    const lower = host.toLowerCase();
    const matching = [...this.cookies.values()]
      .filter((c) => lower === c.domain || lower.endsWith(`.${c.domain}`))
      .map((c) => c.value);
    return matching.length ? matching.join("; ") : null;
  }
}

interface FollowedResponse {
  res: Response;
  finalUrl: URL;
}

/** Follow redirects manually, carrying cookies set along the chain. */
async function followRedirects(
  startUrl: URL,
  jar: RedirectCookieJar,
  post?: { body: string },
): Promise<FollowedResponse> {
  let current = startUrl;
  let init = post;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const cookie = jar.headerFor(current.hostname);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: init ? "POST" : "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(init ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        ...(init ? { body: init.body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ExtractionError("fetch-failed", `Could not fetch ${current}`);
    }

    jar.store(res.headers.getSetCookie(), current.hostname);

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new ExtractionError("fetch-failed", `Bad redirect from ${current}`);
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new ExtractionError("fetch-failed", `Bad redirect scheme: ${next.protocol}`);
      }
      current = next;
      init = undefined; // redirected POSTs continue as GET
      continue;
    }
    return { res, finalUrl: current };
  }

  throw new ExtractionError("fetch-failed", `Too many redirects for ${startUrl}`);
}

function assertHtmlResponse(res: Response, url: URL): string {
  if (!res.ok) {
    throw new ExtractionError("http-error", `HTTP ${res.status} for ${url}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new ExtractionError("not-html", `Unsupported content-type: ${contentType}`);
  }
  return contentType;
}

/**
 * Yahoo properties bounce non-browser clients to consent.yahoo.com, which
 * serves an "agree" form instead of the article. Submitting the form (with
 * its hidden fields) redirects back to the requested page. Returns null if
 * the page doesn't look like that consent form.
 */
async function submitYahooConsentForm(
  consentHtml: string,
  consentUrl: URL,
  jar: RedirectCookieJar,
): Promise<FollowedResponse | null> {
  if (consentUrl.hostname !== "consent.yahoo.com") return null;

  const hiddenFields = [
    ...consentHtml.matchAll(
      /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g,
    ),
  ].map((m) => [m[1], m[2]] as [string, string]);
  if (!hiddenFields.some(([name]) => name === "csrfToken")) return null;

  const body = new URLSearchParams([...hiddenFields, ["agree", "agree"]]);
  const followed = await followRedirects(consentUrl, jar, { body: body.toString() });
  // Still stuck on the consent host: give up and let extraction fail normally.
  if (followed.finalUrl.hostname === "consent.yahoo.com") {
    await followed.res.body?.cancel().catch(() => {});
    return null;
  }
  return followed;
}

async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: string }> {
  const jar = new RedirectCookieJar();
  let { res, finalUrl } = await followRedirects(url, jar);
  let contentType = assertHtmlResponse(res, url);
  let html = await readBodyCapped(res, contentType);

  if (finalUrl.hostname === "consent.yahoo.com") {
    const afterConsent = await submitYahooConsentForm(html, finalUrl, jar);
    if (afterConsent) {
      ({ res, finalUrl } = afterConsent);
      contentType = assertHtmlResponse(res, url);
      html = await readBodyCapped(res, contentType);
    }
  }

  return { html, finalUrl: finalUrl.toString() };
}

async function readBodyCapped(res: Response, contentType: string): Promise<string> {
  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    throw new ExtractionError("too-large");
  }

  const body = res.body;
  if (!body) {
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new ExtractionError("too-large");
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          throw new ExtractionError("too-large");
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err instanceof ExtractionError) {
      await reader.cancel().catch(() => {});
      throw err;
    }
    throw new ExtractionError("fetch-failed", "Failed reading response body");
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const charset = contentType.match(/charset=["']?([^;"']+)/i)?.[1]?.trim();
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(buf);
}

function metaContent(doc: Document, selector: string): string | null {
  const value = doc.querySelector(selector)?.getAttribute("content")?.trim();
  return value ? value : null;
}

function resolveUrl(candidate: string | null, base: string): string | null {
  if (!candidate) return null;
  try {
    const resolved = new URL(candidate, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Parses a date string, returning null for anything unusable. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Guard against parsers yielding absurd years from junk input.
  const year = date.getUTCFullYear();
  return year >= 1990 && year <= 2100 ? date : null;
}

/** Every JSON-LD block on the page, flattened through @graph and arrays. */
function jsonLdNodes(doc: Document): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue; // Malformed JSON-LD is common; ignore it.
    }
    const queue: unknown[] = [parsed];
    while (queue.length > 0) {
      const node = queue.pop();
      if (Array.isArray(node)) {
        queue.push(...node);
      } else if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;
        nodes.push(record);
        if (record["@graph"]) queue.push(record["@graph"]);
      }
    }
  }
  return nodes;
}

function hasJsonLdType(nodes: Record<string, unknown>[], type: string): boolean {
  return nodes.some((node) => {
    const value = node["@type"];
    if (typeof value === "string") return value === type;
    return Array.isArray(value) && value.includes(type);
  });
}

/**
 * Published date, in descending order of trust: Readability's own reading,
 * then the standard meta tags, then JSON-LD, then a <time> element.
 */
function findPublishedAt(
  doc: Document,
  nodes: Record<string, unknown>[],
  readabilityValue: string | null | undefined,
): Date | null {
  const fromMeta =
    metaContent(doc, 'meta[property="article:published_time"]') ??
    metaContent(doc, 'meta[name="article:published_time"]') ??
    metaContent(doc, 'meta[property="og:article:published_time"]') ??
    metaContent(doc, 'meta[name="publish_date"]') ??
    metaContent(doc, 'meta[name="date"]') ??
    metaContent(doc, 'meta[itemprop="datePublished"]');

  const fromJsonLd = nodes
    .map((node) => node.datePublished)
    .find((value): value is string => typeof value === "string");

  const fromTime = doc
    .querySelector("time[datetime]")
    ?.getAttribute("datetime");

  return (
    parseDate(readabilityValue) ??
    parseDate(fromMeta) ??
    parseDate(fromJsonLd) ??
    parseDate(fromTime)
  );
}

/**
 * Whether the page embeds a player.
 *
 * Must run against the original document: the sanitizer's allowlist has no
 * `iframe` or `video`, so by the time we hold the cleaned content every embed
 * is already gone.
 */
function hasEmbeddedMedia(doc: Document): boolean {
  if (doc.querySelector("video, audio")) return true;
  const iframes = doc.querySelectorAll("iframe[src]");
  return Array.from(iframes).some((frame) =>
    /youtube|youtu\.be|vimeo|dailymotion|twitch|wistia|loom|spotify|soundcloud/i.test(
      frame.getAttribute("src") ?? "",
    ),
  );
}

/** Commerce URL shapes common enough to be a reliable signal on their own. */
const PRODUCT_URL_PATTERN =
  /\/(dp|gp\/product|product|products|item|itm|listing|p)\/|\/pd\/|[?&](sku|variant)=/i;

function isProductPage(
  doc: Document,
  nodes: Record<string, unknown>[],
  url: string,
): boolean {
  if (hasJsonLdType(nodes, "Product")) return true;
  const ogType = metaContent(doc, 'meta[property="og:type"]');
  if (ogType && /product/i.test(ogType)) return true;
  if (doc.querySelector('[itemtype*="schema.org/Product" i]')) return true;
  return PRODUCT_URL_PATTERN.test(url);
}

/**
 * Fetch a URL and extract a clean, sanitized article from it.
 * Throws ExtractionError on any failure; callers save a stub article with
 * extractionFailed=true and title = URL hostname.
 */
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const parsedUrl = assertHttpUrl(url);
  const { html, finalUrl } = await fetchHtml(parsedUrl);

  // Silence jsdom's noisy CSS/script errors on real-world pages.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", () => {});
  virtualConsole.on("jsdomError", () => {});

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url: finalUrl, virtualConsole });
  } catch {
    throw new ExtractionError("parse-failed", "jsdom could not parse the document");
  }

  try {
    const doc = dom.window.document;

    // Read metadata before Readability, which mutates the document.
    const ogImage = resolveUrl(
      metaContent(doc, 'meta[property="og:image"]') ??
        metaContent(doc, 'meta[name="og:image"]'),
      finalUrl,
    );
    const ogSiteName = metaContent(doc, 'meta[property="og:site_name"]');
    const docTitle = doc.title?.trim() || null;

    // All of these read the untouched document — Readability rewrites it, and
    // the sanitizer later drops the embeds entirely.
    const jsonLd = jsonLdNodes(doc);
    const metaPublishedAt = findPublishedAt(doc, jsonLd, null);
    const htmlLang =
      doc.documentElement?.getAttribute("lang")?.trim() || null;
    const signals: ExtractionSignals = {
      isProduct: isProductPage(doc, jsonLd, finalUrl),
      hasEmbeddedMedia: hasEmbeddedMedia(doc),
    };

    let parsed: ReturnType<Readability["parse"]>;
    try {
      parsed = new Readability(doc).parse();
    } catch {
      throw new ExtractionError("parse-failed", "Readability failed to parse");
    }
    if (!parsed || !parsed.content) {
      throw new ExtractionError("no-content", "No readable content found");
    }

    const content = sanitizeArticleHtml(parsed.content);
    if (!content.trim()) {
      throw new ExtractionError("no-content", "Content empty after sanitizing");
    }

    const text = collapseWhitespace(parsed.textContent ?? "");
    const wordCount = text ? text.split(/\s+/).length : 0;
    if (wordCount === 0) {
      throw new ExtractionError("no-content", "No text content found");
    }
    const readingMinutes = Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));

    const readabilityExcerpt = collapseWhitespace(parsed.excerpt ?? "");
    const excerpt =
      readabilityExcerpt ||
      (text.length > EXCERPT_LENGTH
        ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`
        : text) ||
      null;

    const firstImgMatch = content.match(/<img[^>]*\ssrc="([^"]+)"/i);
    const leadImageUrl = ogImage ?? resolveUrl(firstImgMatch?.[1] ?? null, finalUrl);

    return {
      title:
        collapseWhitespace(parsed.title ?? "") ||
        docTitle ||
        parsedUrl.hostname,
      siteName: collapseWhitespace(parsed.siteName ?? "") || ogSiteName,
      author: collapseWhitespace(parsed.byline ?? "") || null,
      excerpt,
      content,
      wordCount,
      readingMinutes,
      leadImageUrl,
      publishedAt: parseDate(parsed.publishedTime) ?? metaPublishedAt,
      lang: collapseWhitespace(parsed.lang ?? "") || htmlLang,
      signals,
    };
  } finally {
    dom.window.close();
  }
}
