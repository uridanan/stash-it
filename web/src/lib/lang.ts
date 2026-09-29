/**
 * Language helpers, kept free of server-only imports.
 *
 * Both the save path (automatic language tags) and the player (deciding
 * whether this device has a voice for an article) need these. Living in their
 * own module keeps the client bundle from dragging in `summarize` — and
 * through it the Anthropic SDK — just to normalize a language code.
 */

/**
 * Languages named explicitly. Anything else falls back to the language's own
 * display name, so an Italian article still gets an "Italian" collection.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  he: "Hebrew",
  iw: "Hebrew", // legacy ISO code, still emitted by some sites
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
};

/** Script ranges that identify a language when the page declares none. */
const SCRIPT_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: "he", pattern: /[֐-׿]/ },
  { code: "ar", pattern: /[؀-ۿ]/ },
  { code: "ru", pattern: /[Ѐ-ӿ]/ },
  { code: "el", pattern: /[Ͱ-Ͽ]/ },
  { code: "ja", pattern: /[぀-ヿ]/ },
  { code: "ko", pattern: /[가-힯]/ },
  { code: "zh", pattern: /[一-鿿]/ },
];

/** Enough of a script to be the article's language, not just a quotation. */
const SCRIPT_SHARE_THRESHOLD = 0.2;

/** Normalizes a BCP-47 tag to its primary subtag: "fr-CA" -> "fr". */
export function primaryLanguage(lang: string | null): string | null {
  if (!lang) return null;
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/**
 * Detects the language from the text itself, for pages that declare none.
 * Only scripts are distinguishable this way, which is enough for the case
 * that matters here (Hebrew). Latin-script languages return null rather than
 * guess between French, Spanish and English.
 */
export function detectLanguageFromText(text: string): string | null {
  const sample = text.slice(0, 4_000);
  const letters = sample.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (letters.length < 20) return null;

  for (const { code, pattern } of SCRIPT_PATTERNS) {
    const matches = letters.match(new RegExp(pattern.source, "gu"));
    if (matches && matches.length / letters.length >= SCRIPT_SHARE_THRESHOLD) {
      return code;
    }
  }
  return null;
}

export function languageTagName(code: string): string {
  const known = LANGUAGE_NAMES[code];
  if (known) return known;
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (display && display !== code) return display;
  } catch {
    // Intl.DisplayNames unavailable or given a bad code — fall through.
  }
  return code.toUpperCase();
}
