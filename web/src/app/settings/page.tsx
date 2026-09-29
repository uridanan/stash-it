import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AiSettings } from "@/components/ai-settings";
import { Bookmarklet } from "@/components/bookmarklet";
import { KindleSettings } from "@/components/kindle-settings";
import { ListenSettings } from "@/components/listen-settings";
import { DataTransfer } from "@/components/data-transfer";
import { AppShell } from "@/components/app-shell";
import { SettingsTabs, parseSettingsTab } from "@/components/settings-tabs";
import { TokenManager } from "@/components/token-manager";

export const metadata: Metadata = {
  title: "Settings",
};

/** One section's heading and blurb, above whatever that section renders. */
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

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { tab } = await searchParams;
  const active = parseSettingsTab(tab);

  return (
    <AppShell active="settings">
      <h1 className="text-xl font-bold text-slate-900">Settings</h1>
      <SettingsTabs active={active} />

      {active === "ai" && (
        <Panel
          title="AI summaries"
          blurb="Summarize saved articles in English — the news item plus the key insights the article states. Bring your own API key."
        >
          <AiSettings />
        </Panel>
      )}

      {active === "listening" && (
        <Panel
          title="Listening"
          blurb="Listen to an article instead of reading it. Voices come from this device, so both the list and your choice are local to it."
        >
          <ListenSettings />
        </Panel>
      )}

      {active === "kindle" && (
        <Panel
          title="Kindle"
          blurb="Mail an article to your Kindle as an EPUB, which reflows on the device rather than arriving as fixed pages."
        >
          <KindleSettings />
        </Panel>
      )}

      {active === "data" && (
        <Panel
          title="Your data"
          blurb="Take a backup, restore one, or bring a library across from Instapaper."
        >
          <DataTransfer />
        </Panel>
      )}

      {active === "apps" && (
        <>
          <Panel
            title="API tokens"
            blurb="Tokens authenticate the Chrome extension and other API clients. Each token is shown in full only once, when it is created."
          >
            <div className="mt-4">
              <TokenManager />
            </div>
          </Panel>

          {/* Kept alongside the tokens: step three needs one. */}
          <section className="mt-10">
            <h2 className="text-base font-semibold text-slate-900">
              Chrome extension
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
              <li>
                Open{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  chrome://extensions
                </code>{" "}
                and enable <span className="font-medium">Developer mode</span>.
              </li>
              <li>
                Click <span className="font-medium">Load unpacked</span> and
                select the{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  extension/
                </code>{" "}
                folder from this repository.
              </li>
              <li>
                Open the extension&apos;s{" "}
                <span className="font-medium">Options</span> page and paste this
                server&apos;s URL along with an API token created above.
              </li>
              <li>
                Click the Stash icon on any page (or use the right-click menu)
                to save it.
              </li>
            </ol>
          </section>

          <section className="mt-10">
            <h2 className="text-base font-semibold text-slate-900">
              Bookmarklet
            </h2>
            <div className="mt-3">
              <Bookmarklet />
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
