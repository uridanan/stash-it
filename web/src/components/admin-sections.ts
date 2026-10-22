/**
 * Admin sections, as tabs. Which one is open lives in `?tab=`, the same way
 * Settings does, so a reload keeps the panel and the page only renders one.
 */
export const ADMIN_TABS = [
  { id: "ai", label: "AI" },
  { id: "tags", label: "Tags" },
  { id: "import", label: "Import" },
  { id: "kindle", label: "Kindle" },
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number]["id"];

export const DEFAULT_ADMIN_TAB: AdminTab = "ai";

export function parseAdminTab(value: unknown): AdminTab {
  return ADMIN_TABS.some((tab) => tab.id === value)
    ? (value as AdminTab)
    : DEFAULT_ADMIN_TAB;
}
