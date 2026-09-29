/**
 * The topic vocabulary offered to the classifier.
 *
 * Fixed rather than open-ended on purpose: left to invent its own labels, a
 * model produces "AI", "Artificial Intelligence" and "Machine Learning" as
 * three separate collections that then need merging by hand. Users extend the
 * list from Settings (`User.customTopics`), and those additions are handed to
 * the model alongside these.
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

/** The full vocabulary for a user: the built-ins plus anything they added. */
export function topicVocabulary(customTopics: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const topic of [...BUILT_IN_TOPICS, ...customTopics]) {
    const name = topic.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}
