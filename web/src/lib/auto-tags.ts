import type { TagKind } from "@prisma/client";

import {
  detectLanguageFromText,
  languageTagName,
  primaryLanguage,
} from "@/lib/lang";
import { htmlToText, youtubeUrl } from "@/lib/summarize";

/**
 * Deterministic tags derived at save time — no AI, no network, no database.
 *
 * Everything here is a property of the *article*. Facts about the reader's
 * device (notably whether a voice is installed for the article's language)
 * deliberately stay out: they differ per device and are evaluated by the
 * player at playback time instead.
 */

export interface AutoTag {
  name: string;
  kind: TagKind;
}

export interface AutoTagInput {
  url: string;
  wordCount: number;
  content: string;
  leadImageUrl: string | null;
  lang: string | null;
  extractionFailed: boolean;
  isProduct: boolean;
  hasEmbeddedMedia: boolean;
}

/** At the app's 200wpm, this is roughly a six-minute read. */
export const LONG_READ_WORDS = 1_200;
/** Below this, a page is mostly not prose — a gallery, a video, a stub. */
export const THIN_TEXT_WORDS = 250;
/** Below this there is nothing worth narrating. */
export const MIN_NARRATABLE_WORDS = 30;

export const TAG_QUICK_READ = "Quick read";
export const TAG_LONG_READ = "Long read";
export const TAG_VISUAL = "Visual content";
export const TAG_SHOPPING = "Shopping";
export const TAG_WONT_NARRATE = "Won't narrate";

export { detectLanguageFromText, languageTagName, primaryLanguage };

export function autoTagsFor(input: AutoTagInput): AutoTag[] {
  const tags: AutoTag[] = [];
  const text = htmlToText(input.content);
  const narratableWords = text ? text.split(/\s+/).filter(Boolean).length : 0;

  // Length. Skipped entirely for failed extractions, where wordCount is 0 and
  // "Quick read" would be actively misleading.
  if (!input.extractionFailed && input.wordCount > 0) {
    tags.push({
      name: input.wordCount >= LONG_READ_WORDS ? TAG_LONG_READ : TAG_QUICK_READ,
      kind: "LENGTH",
    });
  }

  // Language: what the page declares, else what the script says.
  const declared = primaryLanguage(input.lang);
  const code = declared ?? detectLanguageFromText(text);
  if (code) {
    tags.push({ name: languageTagName(code), kind: "LANGUAGE" });
  }

  // Visual: the link is itself a video, the page embeds a player, or the page
  // is too thin for its imagery to be decoration.
  const thinAndIllustrated =
    input.leadImageUrl !== null && narratableWords < THIN_TEXT_WORDS;
  if (
    youtubeUrl(input.url) !== null ||
    input.hasEmbeddedMedia ||
    thinAndIllustrated
  ) {
    tags.push({ name: TAG_VISUAL, kind: "FORMAT" });
  }

  if (input.isProduct) {
    tags.push({ name: TAG_SHOPPING, kind: "SHOPPING" });
  }

  if (input.extractionFailed || narratableWords < MIN_NARRATABLE_WORDS) {
    tags.push({ name: TAG_WONT_NARRATE, kind: "TTS" });
  }

  return tags;
}
