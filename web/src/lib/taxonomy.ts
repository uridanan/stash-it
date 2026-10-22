/**
 * The topic vocabulary offered to the classifier.
 *
 * Fixed rather than open-ended on purpose: left to invent its own labels, a
 * model produces "AI", "Artificial Intelligence" and "Machine Learning" as
 * three separate collections that then need merging by hand. Admin edits the
 * default list. Each person can turn defaults off or add their own in Settings,
 * and that resolved list is what the model chooses from.
 *
 * `BUILT_IN_TOPICS` is the list a new installation starts with. Once Admin
 * saves, `SystemSettings.defaultTopics` is the source of truth.
 */

export const BUILT_IN_TOPICS = [
  "Technology",
  "AI",
  "Science",
  "Health",
  "Business",
  "Finance",
  "Economics",
  "Politics",
  "World",
  "Culture",
  "Media",
  "History",
  "Education",
  "Sport",
  "Travel",
  "Food",
  "Design",
  "Environment",
  "Psychology",
  "Personal",
] as const;

/** At most this many topics per article, so a tag list stays a tag list. */
export const MAX_TOPICS_PER_ARTICLE = 3;

/** A topic name is a label, not a sentence. */
export const MAX_TOPIC_NAME = 40;

/** Additions one person can make. The default list has its own, larger cap. */
export const MAX_CUSTOM_TOPICS = 20;
export const MAX_DEFAULT_TOPICS = 40;

export interface TopicVocabularyOptions {
  /** Replaces the built-in list. Omit it to use `BUILT_IN_TOPICS`. */
  base?: readonly string[];
  /** Defaults this person turned off. Additions are not affected. */
  excluded?: readonly string[];
}

/**
 * The vocabulary for one person: the default list, minus what they removed,
 * plus what they added. Order is the defaults first, then additions.
 */
export function topicVocabulary(
  customTopics: readonly string[],
  options?: TopicVocabularyOptions,
): string[] {
  const excluded = new Set(
    (options?.excluded ?? []).map((topic) => topic.trim().toLowerCase()),
  );
  const seen = new Map<string, string>();
  for (const topic of options?.base ?? BUILT_IN_TOPICS) {
    const name = topic.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (excluded.has(key) || seen.has(key)) continue;
    seen.set(key, name);
  }
  for (const topic of customTopics) {
    const name = topic.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

/** Trims, de-duplicates case-insensitively, and caps a topic list. */
export function normalizeTopicNames(
  values: readonly unknown[],
  limit: number,
): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const name = value.trim().slice(0, MAX_TOPIC_NAME);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(name);
    if (topics.length === limit) break;
  }
  return topics;
}

/**
 * Splits an edited list back into "defaults I turned off" and "tags I added",
 * so a default Admin adds later still shows up for someone who never removed it.
 */
export function splitTopicList(
  wanted: readonly string[],
  defaults: readonly string[],
): { excludedTopics: string[]; customTopics: string[] } {
  const wantedKeys = new Set(wanted.map((topic) => topic.toLowerCase()));
  const defaultKeys = new Set(defaults.map((topic) => topic.toLowerCase()));
  return {
    excludedTopics: defaults.filter(
      (topic) => !wantedKeys.has(topic.toLowerCase()),
    ),
    customTopics: wanted
      .filter((topic) => !defaultKeys.has(topic.toLowerCase()))
      .slice(0, MAX_CUSTOM_TOPICS),
  };
}
