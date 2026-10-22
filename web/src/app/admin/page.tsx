import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AdminAi, AdminImport, AdminKindle, AdminTags } from "@/components/admin-panels";
import { parseAdminTab } from "@/components/admin-sections";
import { AdminTabs } from "@/components/admin-tabs";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Admin",
};

function Panel({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{blurb}</p>
      {children}
    </section>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!isAdminEmail(user?.email)) redirect("/");

  const { tab } = await searchParams;
  const active = parseAdminTab(tab);

  return (
    <AppShell active="admin">
      <h1 className="text-xl font-bold text-slate-900">Admin</h1>
      <AdminTabs active={active} />

      {active === "ai" && (
        <Panel
          title="AI"
          blurb="The model, key, and prompt used to summarize articles."
        >
          <AdminAi />
        </Panel>
      )}

      {active === "tags" && (
        <Panel
          title="Default tags"
          blurb="The tags Auto-tag starts from. Each person can remove some of these, or add their own, in Settings."
        >
          <AdminTags />
        </Panel>
      )}

      {active === "import" && (
        <Panel
          title="Import"
          blurb="How an import treats collections, article text, and AI summaries. People can override the collections choice for their own imports."
        >
          <AdminImport />
        </Panel>
      )}

      {active === "kindle" && (
        <Panel
          title="Kindle"
          blurb="The email account this server uses to send articles to Kindle. Each person still sets their own Kindle address in Settings."
        >
          <AdminKindle />
        </Panel>
      )}
    </AppShell>
  );
}
