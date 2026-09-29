"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type ActiveNav =
  | "home"
  | "archive"
  | "starred"
  | "tags"
  | "settings"
  | "none";

const COLLAPSED_KEY = "stash:sidebar-collapsed";
const COLLECTIONS_OPEN_KEY = "stash:sidebar-collections-open";

const COLLECTIONS_ICON = (

      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 11.2V5a1 1 0 0 1 1-1h6.2a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.2 6.2a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7ZM7.8 8.3h.01" />
      </svg>
    
);

const NAV_ITEMS: { key: ActiveNav; label: string; href: string; icon: React.ReactNode }[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5M5.5 8.9V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V8.9" />
      </svg>
    ),
  },
  {
    key: "archive",
    label: "Read",
    href: "/archive",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 5h17v4h-17zM5 9v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
      </svg>
    ),
  },
  {
    key: "starred",
    label: "Starred",
    href: "/starred",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
      </svg>
    ),
  },
];

const SEARCH_PATHS: Partial<Record<ActiveNav, string>> = {
  home: "/",
  archive: "/archive",
  starred: "/starred",
};

export interface SidebarUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

export interface SidebarTag {
  name: string;
  slug: string;
  articleCount: number;
}

interface SidebarProps {
  active: ActiveNav;
  q?: string;
  user: SidebarUser;
  signOutAction: () => Promise<void>;
  /** The user's collections, listed under the Collections item. */
  tags?: SidebarTag[];
  /** Slug of the collection currently open, for highlighting. */
  activeTagSlug?: string;
}

function Avatar({ user, className }: { user: SidebarUser; className: string }) {
  if (user.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt={user.name ?? "Account"}
        className={`${className} rounded-full border border-slate-200`}
      />
    );
  }
  return (
    <span
      className={`${className} flex items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white`}
    >
      {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4.5 4.5" />
    </svg>
  );
}

/**
 * Collections nav item: a link to the index plus a disclosure listing the
 * user's collections, so one can be opened without a detour through /tags.
 * Expanded state is remembered, like the rail's own collapsed state.
 */
function CollectionsSection({
  active,
  activeTagSlug,
  tags,
  collapsed,
  onExpand,
  onNavigate,
}: {
  active: ActiveNav;
  activeTagSlug?: string;
  tags: SidebarTag[];
  collapsed: boolean;
  onExpand?: () => void;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(COLLECTIONS_OPEN_KEY) !== "0");
    } catch {
      // localStorage unavailable — stay expanded.
    }
  }, []);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLECTIONS_OPEN_KEY, next ? "1" : "0");
      } catch {
        // Best effort only.
      }
      return next;
    });
  }

  const rowClass = `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
    active === "tags"
      ? "bg-violet-50 font-medium text-violet-700"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

  // Collapsed rail: the icon alone, which expands the rail rather than
  // opening a disclosure there is no room for.
  if (collapsed) {
    return (
      <Link
        href="/tags"
        onClick={onExpand ? () => onExpand() : onNavigate}
        title="Collections"
        className={rowClass}
      >
        {COLLECTIONS_ICON}
      </Link>
    );
  }

  return (
    <div>
      <div className={`${rowClass} pr-1`}>
        {COLLECTIONS_ICON}
        <Link href="/tags" onClick={onNavigate} className="flex-1">
          Collections
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? "Hide collections" : "Show collections"}
          data-testid="collections-toggle"
          className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>

      {open ? (
        <ul data-testid="sidebar-collections" className="mt-0.5 space-y-0.5">
          {tags.length === 0 ? (
            <li className="px-2.5 py-1 pl-10 text-xs text-slate-400">
              No collections yet
            </li>
          ) : (
            tags.map((tag) => (
              <li key={tag.slug}>
                <Link
                  href={`/tags/${tag.slug}`}
                  onClick={onNavigate}
                  className={`flex items-center justify-between gap-2 rounded-lg py-1.5 pl-10 pr-2.5 text-sm transition-colors ${
                    activeTagSlug === tag.slug
                      ? "bg-violet-50 font-medium text-violet-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="truncate">{tag.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {tag.articleCount}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Nav + search + account, shared by the desktop rail and the mobile drawer. */

function SidebarContent({
  active,
  q,
  user,
  signOutAction,
  tags = [],
  activeTagSlug,
  collapsed,
  onExpand,
  onNavigate,
}: SidebarProps & {
  collapsed: boolean;
  onExpand?: () => void;
  onNavigate?: () => void;
}) {
  const searchPath = SEARCH_PATHS[active] ?? "/";

  return (
    <>
      <nav className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              active === item.key
                ? "bg-violet-50 font-medium text-violet-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}

        <CollectionsSection
          active={active}
          activeTagSlug={activeTagSlug}
          tags={tags}
          collapsed={collapsed}
          onExpand={onExpand}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="mt-3 px-2">
        {collapsed ? (
          <button
            type="button"
            onClick={onExpand}
            title="Search"
            aria-label="Search"
            className="flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <SearchIcon />
          </button>
        ) : (
          <form action={searchPath} method="get" role="search" className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search"
              aria-label="Search articles"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-2.5 text-sm outline-none transition-colors focus:border-violet-600 focus:bg-white"
            />
          </form>
        )}
      </div>

      <div className="mt-auto border-t border-slate-200 p-2">
        <details className="relative">
          <summary
            className="menu-button flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-slate-100"
            aria-label="Account menu"
            title={collapsed ? (user.name ?? "Account") : undefined}
          >
            <Avatar user={user} className="h-8 w-8 shrink-0" />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {user.name ?? "Signed in"}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {user.email ?? ""}
                </span>
              </span>
            )}
          </summary>
          <div className="absolute bottom-full left-0 z-10 mb-2 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <Link
              href="/settings"
              onClick={onNavigate}
              className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Settings
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </>
  );
}

export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // localStorage unavailable — stay expanded.
    }
  }, []);

  function setAndPersist(next: boolean) {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Best effort only.
    }
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-20 flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
            <path strokeLinecap="round" d="M4 6.5h16M4 12h16M4 17.5h16" />
          </svg>
        </button>
        <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
          Stash
        </Link>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white py-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between px-4">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="text-lg font-bold tracking-tight text-slate-900"
              >
                Stash
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
                  <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <SidebarContent
              {...props}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop rail */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white py-3 transition-[width] duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div
          className={`mb-3 flex items-center px-2 ${
            collapsed ? "justify-center" : "justify-between pl-4"
          }`}
        >
          {!collapsed && (
            <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
              Stash
            </Link>
          )}
          <button
            type="button"
            onClick={() => setAndPersist(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className={`h-5 w-5 transition-transform ${collapsed ? "rotate-180" : ""}`}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 6-6 6 6 6" />
            </svg>
          </button>
        </div>
        <SidebarContent
          {...props}
          collapsed={collapsed}
          onExpand={() => setAndPersist(false)}
        />
      </aside>
    </>
  );
}
