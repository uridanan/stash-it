"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import {
  SETTINGS_TABS,
  type SettingsTab,
} from "@/components/settings-sections";

export function SettingsTabs({ active }: { active: SettingsTab }) {
  const nav = useRef<HTMLElement>(null);

  // The row scrolls sideways. Bring the open tab fully into view, otherwise
  // the last one sits clipped under the edge of the column.
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  return (
    <nav
      ref={nav}
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
