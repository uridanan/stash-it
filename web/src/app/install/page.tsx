import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { InstallGuide } from "@/components/install-guide";

export const metadata: Metadata = {
  title: "Get the app !",
};

export default async function InstallPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <AppShell active="install">
      <h1 className="text-xl font-bold text-slate-900">Get the app !</h1>
      <p className="mt-1 text-sm text-slate-600">
        Stash is a Progressive Web App, so you install it from your browser
        instead of an app store.
      </p>
      <InstallGuide />
    </AppShell>
  );
}
