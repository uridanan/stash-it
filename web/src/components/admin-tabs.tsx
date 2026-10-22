"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { ADMIN_TABS, type AdminTab } from "@/components/admin-sections";

export function AdminTabs({ active }: { active: AdminTab }) {
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  return (
    <nav
      ref={nav}
      aria-label="Admin sections"
      data-testid="admin-tabs"
      className="mt-4 -mb-px flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {ADMIN_TABS.map((tab) => {
        const current = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/admin?tab=${tab.id}`}
            scroll={false}
            aria-current={current ? "page" : undefined}
            data-testid={`admin-tab-${tab.id}`}
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
