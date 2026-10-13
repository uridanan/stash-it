import { auth, signOut } from "@/auth";
import { Sidebar, type ActiveNav } from "@/components/sidebar";
import { ListenProvider } from "@/components/listen/listen-provider";
import { libraryCounts } from "@/lib/articles";
import { listTags } from "@/lib/tags";

export type { ActiveNav };

/**
 * Page chrome: collapsible sidebar (mobile: top bar + drawer) next to the
 * page's main content. `mainClassName` extends the centered content column.
 */
export async function AppShell({
  active,
  q,
  activeTagSlug,
  mainClassName = "py-6",
  wide = false,
  children,
}: {
  active: ActiveNav;
  q?: string;
  /** Slug of the collection being viewed, so the sidebar can highlight it. */
  activeTagSlug?: string;
  mainClassName?: string;
  /** Skip the centered column; children manage their own layout (split view). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;
  const [tags, counts] = user?.id
    ? await Promise.all([listTags(user.id), libraryCounts(user.id)])
    : [[], { unread: 0, read: 0, starred: 0 }] as const;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    // AppShell is rendered by each page, so this remounts on navigation. That
    // is fine: the provider restores an in-flight playlist from sessionStorage
    // on mount. Wrapping the root layout instead would put a client boundary
    // above every page and leave React streaming placeholders in the DOM.
    <ListenProvider>
    <div className="md:flex lg:h-dvh lg:overflow-hidden">
      <Sidebar
        active={active}
        q={q}
        activeTagSlug={activeTagSlug}
        counts={{
          home: counts.unread,
          archive: counts.read,
          starred: counts.starred,
        }}
        tags={tags.map((tag) => ({
          name: tag.name,
          slug: tag.slug,
          articleCount: tag.articleCount,
        }))}
        user={{
          name: user?.name ?? null,
          email: user?.email ?? null,
          image: user?.image ?? null,
        }}
        signOutAction={signOutAction}
      />
      <main
        className={`min-w-0 flex-1 pt-16 md:pt-0 lg:min-h-0 ${
          wide
            ? "lg:flex lg:h-full lg:flex-col lg:overflow-hidden"
            : "lg:h-full lg:overflow-y-auto"
        }`}
      >
        {wide ? (
          children
        ) : (
          <div className={`mx-auto max-w-2xl px-4 ${mainClassName}`}>{children}</div>
        )}
      </main>
    </div>
    </ListenProvider>
  );
}
