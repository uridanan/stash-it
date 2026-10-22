"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";

import { AddUrlLauncher } from "@/components/add-url";
import { CheckIcon, StarIcon, TagIcon } from "@/components/icons";
import { SortControl } from "@/components/sort-control";

export type ActiveNav =
  | "home"
  | "archive"
  | "starred"
  | "tags"
  | "settings"
  | "install"
  | "none";

const COLLAPSED_KEY = "stash:sidebar-collapsed";
const COLLECTIONS_OPEN_KEY = "stash:sidebar-collections-open";

const COLLECTIONS_ICON = (

      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 11.2V5a1 1 0 0 1 1-1h6.2a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.2 6.2a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7ZM7.8 8.3h.01" />
      </svg>
    
);

const NAV_ITEMS: {
  key: "home" | "archive" | "starred";
  label: string;
  href: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5M5.5 8.9V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V8.9" />
      </svg>
    ),
  },
  {
    key: "archive",
    label: "Read",
    href: "/archive",
    icon: <CheckIcon className="h-6 w-6 shrink-0" />,
  },
  {
    key: "starred",
    label: "Starred",
    href: "/starred",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
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

/** Mobile title bar for Read, Starred, and an open collection. Home stays "Stash". */
export interface BarTitle {
  label: string;
  icon: "check" | "star" | "tag";
}

/** Article totals for Home (unread), Read, and Starred. */
export interface NavCounts {
  home: number;
  archive: number;
  starred: number;
}

interface SidebarProps {
  active: ActiveNav;
  q?: string;
  user: SidebarUser;
  signOutAction: () => Promise<void>;
  counts: NavCounts;
  /** The user's collections, listed under the Collections item. */
  tags?: SidebarTag[];
  /** Slug of the collection currently open, for highlighting. */
  activeTagSlug?: string;
  /** Replaces "Stash" in the phone title bar. */
  barTitle?: BarTitle;
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4.5 4.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8V9c.1.7.8 1.2 1.5 1.3H21a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5.4Z" />
    </svg>
  );
}

function InstallNavIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11M7.5 11.5 12 16l4.5-4.5M5 20h14" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 7V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3m0 0 3.5-3.5M3 12l3.5 3.5" />
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

  const rowClass = `flex items-center gap-3 rounded-lg px-2.5 py-3 text-base transition-colors ${
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
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`h-6 w-6 transition-transform ${open ? "rotate-90" : ""}`}
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
                  className={`flex min-h-12 items-center justify-between gap-2 rounded-lg py-3 pl-10 pr-2.5 text-base transition-colors ${
                    activeTagSlug === tag.slug
                      ? "bg-violet-50 font-medium text-violet-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="truncate">{tag.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
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
  counts,
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
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-2">
        {collapsed ? (
          <button
            type="button"
            onClick={onExpand}
            title="Search"
            aria-label="Search"
            className="flex min-h-12 w-full items-center justify-center rounded-lg px-2.5 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
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
              className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-11 pr-3 text-base outline-none transition-colors focus:border-violet-600 focus:bg-white"
            />
          </form>
        )}
      </div>

      <nav className="mt-3 flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? `${item.label} (${counts[item.key]})` : undefined}
            className={`flex min-h-12 items-center gap-3 rounded-lg px-2.5 py-3 text-base transition-colors ${
              active === item.key
                ? "bg-violet-50 font-medium text-violet-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.icon}
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span
                  className="shrink-0 text-xs tabular-nums text-slate-400"
                  data-testid={`nav-count-${item.key}`}
                >
                  {counts[item.key]}
                </span>
              </>
            )}
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
      </div>

      <div
        className={`shrink-0 border-t border-slate-200 ${collapsed ? "px-1 py-2" : "p-2"}`}
      >
        <Link
          href="/install"
          onClick={onNavigate}
          title={collapsed ? "Get the app !" : undefined}
          data-testid="nav-install"
          aria-current={active === "install" ? "page" : undefined}
          className="flex min-h-12 items-center gap-3 rounded-lg bg-violet-600 px-2.5 py-3 text-base font-medium text-white transition-colors hover:bg-violet-700"
        >
          <InstallNavIcon />
          {!collapsed && <span>Get the app !</span>}
        </Link>
        <Link
          href="/settings"
          onClick={onNavigate}
          title={collapsed ? "Settings" : undefined}
          data-testid="nav-settings"
          className={`mt-1 flex min-h-12 items-center gap-3 rounded-lg px-2.5 py-3 text-base transition-colors ${
            active === "settings"
              ? "bg-violet-50 font-medium text-violet-700"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <SettingsIcon />
          {!collapsed && <span>Settings</span>}
        </Link>
        <div
          className={`mt-1 flex items-center ${collapsed ? "justify-center gap-0.5" : "gap-1 pl-1"}`}
        >
          <Avatar
            user={user}
            className={collapsed ? "h-7 w-7 shrink-0" : "h-8 w-8 shrink-0"}
          />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium text-slate-900">
                {user.name ?? "Signed in"}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {user.email ?? ""}
              </span>
            </span>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              data-testid="nav-sign-out"
              className={`flex shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 ${
                collapsed ? "h-8 w-8" : "h-12 w-12"
              }`}
            >
              <SignOutIcon />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

function MobileTitle({ barTitle }: { barTitle?: BarTitle }) {
  if (!barTitle) {
    return (
      <Link
        href="/"
        className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-slate-900"
      >
        Stash
      </Link>
    );
  }

  const icon =
    barTitle.icon === "check" ? (
      <CheckIcon className="h-6 w-6 shrink-0" />
    ) : barTitle.icon === "star" ? (
      <StarIcon className="h-6 w-6 shrink-0" strokeWidth={1.8} />
    ) : (
      <TagIcon className="h-6 w-6 shrink-0" strokeWidth={1.8} />
    );

  return (
    <h1 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
      {icon}
      <span className="truncate">{barTitle.label}</span>
    </h1>
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
      <div className="fixed inset-x-0 top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="flex h-12 w-12 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7" aria-hidden>
            <path strokeLinecap="round" d="M4 6.5h16M4 12h16M4 17.5h16" />
          </svg>
        </button>
        <MobileTitle barTitle={props.barTitle} />
        {props.active === "home" || props.active === "archive" || props.active === "starred" ? (
          <Suspense fallback={null}>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {props.active === "home" ? <AddUrlLauncher /> : null}
              <SortControl />
            </div>
          </Suspense>
        ) : null}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col overflow-hidden bg-white py-3 shadow-xl">
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
                className="flex h-12 w-12 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7" aria-hidden>
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
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white py-3 transition-[width] duration-200 md:flex ${
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
            className="flex h-12 w-12 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className={`h-6 w-6 transition-transform ${collapsed ? "rotate-180" : ""}`}
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
