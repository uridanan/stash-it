import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { listTags } from "@/lib/tags";

export const metadata: Metadata = {
  title: "Collections",
};

export default async function TagsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const tags = await listTags(session.user.id);

  return (
    <AppShell active="tags">
      <h1 className="text-xl font-bold text-slate-900">Collections</h1>
      <p className="mt-1 text-sm text-slate-600">
        Every tag is a collection, and every collection is a playlist — open one
        to reorder it or listen straight through.
      </p>

      {tags.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center">
          <p className="text-base font-medium text-slate-700">
            No collections yet
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Save an article and it will be tagged automatically, or add your own
            tags from the reader.
          </p>
        </div>
      ) : (
        <ul data-testid="tag-list" className="mt-6">
          {tags.map((tag) => (
            <li key={tag.id} className="border-b border-slate-100">
              <Link
                href={`/tags/${tag.slug}`}
                className="flex items-center justify-between py-3 transition-colors hover:text-violet-700"
              >
                <span className="text-sm font-medium text-slate-900">
                  {tag.name}
                </span>
                <span className="text-xs text-slate-400">
                  {tag.articleCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
