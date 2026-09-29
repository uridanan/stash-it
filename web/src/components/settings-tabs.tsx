import Link from "next/link";

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
  { id: "ai", label: "AI summaries" },
  { id: "listening", label: "Listening" },
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

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label="Settings sections"
      data-testid="settings-tabs"
      // Scrolls sideways on a narrow screen rather than wrapping into a block
      // of links that pushes the panel off the fold.
      className="mt-4 -mb-px flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {SETTINGS_TABS.map((tab) => {
        const current = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/settings?tab=${tab.id}`}
            scroll={false}
            aria-current={current ? "page" : undefined}
            data-testid={`settings-tab-${tab.id}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              current
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
