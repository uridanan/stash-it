import { MAX_TAG_NAME } from "@/lib/tags";

/** How many collection names one save may attach. */
export const MAX_COLLECTIONS = 20;

export type CollectionNames =
  | { names: string[] }
  | { error: string };

/**
 * Collection names supplied with a save.
 *
 * Absent means "add none". Present means those names, created if the account
 * does not have them yet. They are added to whatever the app assigns on its
 * own; nothing here removes a tag.
 */
export function parseCollections(value: unknown): CollectionNames {
  if (value === undefined || value === null) return { names: [] };
  if (!Array.isArray(value)) {
    return { error: "collections must be an array of names" };
  }
  if (value.length > MAX_COLLECTIONS) {
    return {
      error: `collections accepts at most ${MAX_COLLECTIONS} names`,
    };
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return { error: "collections must be an array of non-empty names" };
    }
    const name = item.trim();
    if (name.length > MAX_TAG_NAME) {
      return {
        error: `collection names must be ${MAX_TAG_NAME} characters or fewer`,
      };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return { names };
}
