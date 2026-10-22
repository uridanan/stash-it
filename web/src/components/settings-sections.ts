/**
 * The settings sections, as tabs.
 *
 * Which tab is open lives in the URL (`?tab=kindle`) rather than in component
 * state, for the same reason the article sort does: it survives a reload, it
 * can be linked to, and it is readable on the server — so the page renders one
 * panel instead of rendering all of them and hiding four.
 *
 * That last part is the real gain. Every panel here fetches something or talks
 * to the browser (voices, tokens, settings), and the page used to do all of it
 * on every visit.
 */
export const SETTINGS_TABS = [
  { id: "ai", label: "AI" },
  { id: "listening", label: "Listening" },
  { id: "appearance", label: "Appearance" },
  { id: "kindle", label: "Kindle" },
  { id: "data", label: "Your data" },
  { id: "apps", label: "Apps & tokens" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "ai";

/** Reads `?tab=` into a known tab, falling back rather than 404ing. */
export function parseSettingsTab(value: unknown): SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value)
    ? (value as SettingsTab)
    : DEFAULT_SETTINGS_TAB;
}
