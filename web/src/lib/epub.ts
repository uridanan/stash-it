import JSZip from "jszip";
import sanitizeHtml from "sanitize-html";

import { SANITIZE_OPTIONS } from "@/lib/sanitize";

/**
 * Article → EPUB 3.
 *
 * An EPUB is a zip with a fixed skeleton, so this builds one directly rather
 * than pulling in a generator: the whole format we need is a container
 * pointing at a package document, a nav document, and one XHTML chapter.
 *
 * Two rules the format actually enforces:
 *
 * - **`mimetype` must be the first entry and stored uncompressed.** It is how
 *   a reader sniffs the file without unzipping it, so it is added first with
 *   compression off.
 * - **The chapter must be well-formed XML, not HTML.** Bodies are already
 *   sanitized for storage, but they are re-sanitized here because that is what
 *   balances tags and self-closes voids — an unclosed `<br>` is a parse error
 *   in an EPUB, not a shrug.
 *
 * Images keep their original URLs. Embedding them would mean fetching every
 * host an article references, which an export has no business doing; readers
 * that allow remote resources will show them, and the package declares that.
 */

export interface EpubArticle {
  id: string;
  title: string;
  url: string;
  siteName: string | null;
  author: string | null;
  content: string;
  summary: string | null;
  savedAt: Date;
  publishedAt: Date | null;
  lang: string | null;
  readingMinutes: number;
  tags: readonly string[];
}

/** XML text escaping — stricter than HTML's, since there are no named entities. */
export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A BCP-47 tag EPUB readers accept.
 *
 * `lang` is whatever the page claimed, which in practice includes junk like
 * `EN` or `en_US`; anything unrecognizable falls back to English rather than
 * producing a package document a validator rejects.
 */
export function epubLang(lang: string | null): string {
  const normalized = (lang ?? "").trim().replace(/_/g, "-");
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(normalized) ? normalized : "en";
}

/**
 * Article HTML as an XHTML fragment.
 *
 * Re-sanitizing is the point: sanitize-html re-serializes from a parse tree,
 * which closes what the source left open and self-closes void elements.
 */
export function toXhtmlFragment(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

const STYLESHEET = `html { font-family: sans-serif; }
body { margin: 0 5%; line-height: 1.6; }
h1 { font-size: 1.5em; line-height: 1.25; margin: 0 0 0.4em; }
h2 { font-size: 1.25em; margin: 1.6em 0 0.4em; }
h3 { font-size: 1.1em; margin: 1.4em 0 0.4em; }
p { margin: 0 0 1em; }
img { max-width: 100%; height: auto; }
figure { margin: 1.5em 0; }
figcaption, .byline { font-size: 0.85em; color: #555; }
blockquote { margin: 1.2em 0; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
pre { white-space: pre-wrap; font-size: 0.85em; background: #f4f4f5; padding: 0.8em; }
code { font-size: 0.9em; }
hr { border: 0; border-top: 1px solid #ddd; margin: 2em 0; }
table { border-collapse: collapse; }
td, th { border: 1px solid #ddd; padding: 0.3em 0.5em; }
.summary { border: 1px solid #d8c8f5; background: #f6f2ff; padding: 0.8em 1em; margin: 1.5em 0; }
.summary h2 { font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.5em; }
.source { margin-top: 2.5em; font-size: 0.85em; }
`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function bylineHtml(article: EpubArticle): string {
  const date = article.publishedAt ?? article.savedAt;
  const bits = [
    article.siteName,
    article.author,
    `${article.readingMinutes} min read`,
    Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10),
  ].filter(Boolean) as string[];
  return xmlEscape(bits.join(" · "));
}

function summaryHtml(summary: string): string {
  const paragraphs = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${xmlEscape(line)}</p>`)
    .join("\n      ");
  return `<section class="summary" epub:type="abstract">
      <h2>AI summary</h2>
      ${paragraphs}
    </section>`;
}

export function chapterXhtml(article: EpubArticle): string {
  const lang = epubLang(article.lang);
  const body = toXhtmlFragment(article.content);
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
  <head>
    <meta charset="utf-8"/>
    <title>${xmlEscape(article.title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>${xmlEscape(article.title)}</h1>
    <p class="byline">${bylineHtml(article)}</p>
${article.summary?.trim() ? `    ${summaryHtml(article.summary.trim())}\n` : ""}    <section epub:type="bodymatter">
${body || `      <p><em>No article text was saved.</em></p>`}
    </section>
    <p class="source"><a href="${xmlEscape(article.url)}">${xmlEscape(article.url)}</a></p>
  </body>
</html>
`;
}

export function navXhtml(article: EpubArticle): string {
  const lang = epubLang(article.lang);
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
  <head>
    <meta charset="utf-8"/>
    <title>Contents</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
        <li><a href="article.xhtml">${xmlEscape(article.title)}</a></li>
      </ol>
    </nav>
  </body>
</html>
`;
}

export function packageOpf(article: EpubArticle, modified: Date): string {
  const lang = epubLang(article.lang);
  const remote = /<img\b/i.test(article.content) ? ' properties="remote-resources"' : "";
  const subjects = article.tags
    .map((tag) => `    <dc:subject>${xmlEscape(tag)}</dc:subject>`)
    .join("\n");
  const creator = article.author ?? article.siteName;
  // dcterms:modified must be a whole-second UTC timestamp; anything else is a
  // package-document error.
  const stamp = `${modified.toISOString().slice(0, 19)}Z`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:stash:article:${xmlEscape(article.id)}</dc:identifier>
    <dc:title>${xmlEscape(article.title)}</dc:title>
    <dc:language>${lang}</dc:language>
${creator ? `    <dc:creator>${xmlEscape(creator)}</dc:creator>\n` : ""}    <dc:source>${xmlEscape(article.url)}</dc:source>
    <dc:date>${article.savedAt.toISOString()}</dc:date>
${subjects ? `${subjects}\n` : ""}    <meta property="dcterms:modified">${stamp}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="article" href="article.xhtml" media-type="application/xhtml+xml"${remote}/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="article"/>
  </spine>
</package>
`;
}

/** Packs one article into an EPUB 3 file. */
export async function buildEpub(article: EpubArticle): Promise<Buffer> {
  const zip = new JSZip();

  // First entry, uncompressed — this is how a reader identifies the file.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", packageOpf(article, article.savedAt));
  zip.file("OEBPS/nav.xhtml", navXhtml(article));
  zip.file("OEBPS/article.xhtml", chapterXhtml(article));
  zip.file("OEBPS/style.css", STYLESHEET);

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
