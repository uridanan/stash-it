/**
 * One-time import from an Instapaper CSV export.
 *
 * The export carries no article text — only URLs and metadata — so rows land
 * as stubs and the full text is fetched later, on demand or in bulk. See
 * `isStub` in `articles.ts`.
 *
 * Folder mapping deserves a note: Instapaper models Starred as a *folder*, not
 * a flag, so a starred row says nothing about whether it was read. Those rows
 * come in starred and unread, which is the reading that loses no information a
 * user would notice.
 */

export interface InstapaperRow {
  url: string;
  title: string;
  /** Instapaper's highlight for the row, if any. Mapped to excerpt. */
  selection: string | null;
  folder: string;
  savedAt: Date;
  tags: string[];
}

export interface InstapaperParseResult {
  rows: InstapaperRow[];
  /** Rows that could not be used, with the reason, for reporting back. */
  skipped: { line: number; reason: string }[];
}

/**
 * RFC 4180 reader: fields may be quoted, and quoted fields may contain commas,
 * newlines and doubled quotes. Instapaper titles contain all three, so a
 * split(",") would corrupt a meaningful share of any real export.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Strip a UTF-8 BOM, which Excel-saved exports often carry.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as one break, and ignore blank lines between records.
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Instapaper writes tags as a JSON array in one column, usually "[]". */
export function parseTags(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    const names: string[] = [];
    for (const value of parsed) {
      const name = typeof value === "string" ? value.trim() : "";
      if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    }
    return names;
  } catch {
    // Older exports use a bare comma-separated list.
    return trimmed
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
}

export interface MappedArticle {
  state: "UNREAD" | "ARCHIVED";
  starred: boolean;
}

/**
 * Folder → state. Anything unrecognized is treated as unread, which errs
 * toward the reader seeing it rather than it disappearing into the read pile.
 */
export function mapFolder(folder: string): MappedArticle {
  switch (folder.trim().toLowerCase()) {
    case "archive":
      return { state: "ARCHIVED", starred: false };
    case "starred":
      return { state: "UNREAD", starred: true };
    default:
      return { state: "UNREAD", starred: false };
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes a cell into an http(s) URL, or null if it cannot be one.
 *
 * Real exports contain the occasional bare hostname ("www.example.com"),
 * which is unambiguously meant as a link; assuming https recovers the row
 * rather than dropping it.
 */
export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isHttpUrl(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // some other scheme
  const assumed = `https://${trimmed}`;
  return isHttpUrl(assumed) ? assumed : null;
}

/** Titles are occasionally blank in real exports; fall back to the hostname. */
function titleFor(title: string, url: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function parseInstapaperCsv(text: string): InstapaperParseResult {
  const table = parseCsv(text);
  const rows: InstapaperRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  if (table.length === 0) return { rows, skipped };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name);
  const iUrl = at("url");
  const iTitle = at("title");
  const iSelection = at("selection");
  const iFolder = at("folder");
  const iTimestamp = at("timestamp");
  const iTags = at("tags");

  if (iUrl === -1) {
    throw new Error(
      'This CSV has no "URL" column — is it an Instapaper export?',
    );
  }

  const seen = new Set<string>();
  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r];
    const line = r + 1;
    const raw = (cells[iUrl] ?? "").trim();
    if (!raw) {
      skipped.push({ line, reason: "no URL" });
      continue;
    }
    const url = normalizeUrl(raw);
    if (!url) {
      skipped.push({ line, reason: `unsupported URL: ${raw.slice(0, 60)}` });
      continue;
    }
    // The export can repeat a URL; the app holds one row per URL per user.
    if (seen.has(url)) {
      skipped.push({ line, reason: "duplicate URL in file" });
      continue;
    }
    seen.add(url);

    const seconds = Number((cells[iTimestamp] ?? "").trim());
    const savedAt =
      Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000)
        : new Date();

    const selection = (cells[iSelection] ?? "").trim();
    rows.push({
      url,
      title: titleFor(cells[iTitle] ?? "", url),
      selection: selection || null,
      folder: (cells[iFolder] ?? "").trim(),
      savedAt,
      tags: parseTags(cells[iTags] ?? ""),
    });
  }

  return { rows, skipped };
}
