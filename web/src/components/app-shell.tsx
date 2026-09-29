import { auth, signOut } from "@/auth";
import { Sidebar, type ActiveNav } from "@/components/sidebar";
import { ListenProvider } from "@/components/listen/listen-provider";
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
  const tags = user?.id ? await listTags(user.id) : [];

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
    <div className="md:flex">
      <Sidebar
        active={active}
        q={q}
        activeTagSlug={activeTagSlug}
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
      <main className="min-w-0 flex-1 pt-12 md:pt-0">
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
