"use client";

import { useEffect, useState } from "react";

import { Bookmarklet } from "@/components/bookmarklet";
import {
  InstallShot,
  type InstallPlatform,
} from "@/components/install-figures";
import {
  installPromptAvailable,
  runInstallPrompt,
  subscribeInstallPrompt,
} from "@/components/install-prompt";

const PLATFORMS: { id: InstallPlatform; label: string }[] = [
  { id: "iphone", label: "iPhone" },
  { id: "android", label: "Android" },
  { id: "computer", label: "Computer" },
];

const INSTALL_STEPS: Record<InstallPlatform, string[]> = {
  iphone: [
    "Open Stash in Safari. On an iPhone, only Safari can add it to the Home Screen.",
    "Tap Share — the square with an arrow.",
    "Tap Add to Home Screen, then Add.",
    "Open Stash from your Home Screen. It fills the screen, without the browser bar.",
  ],
  android: [
    "Open Stash in Chrome.",
    "Tap the three-dot menu.",
    "Tap Install app, then confirm.",
    "Open Stash from your home screen.",
  ],
  computer: [
    "Show the bookmarks bar if it is hidden. In Chrome or Edge that is under the browser menu; in Safari it is View → Show Favorites Bar.",
    "Drag Save to Stash onto the bar.",
  ],
};

const SAVE_STEPS: Record<InstallPlatform, string[]> = {
  iphone: [
    "In the app that has the link, tap Share.",
    "Tap Stash.",
    "The link is saved, and you can go back to that app.",
  ],
  android: [
    "In the app that has the link, tap Share.",
    "Tap Stash.",
    "The link is saved, and you can go back to that app.",
  ],
  computer: [
    "Open the article you want to keep.",
    "Click Save to Stash in the bookmarks bar.",
    "Stash saves the page and shows a short confirmation.",
  ],
};

const INSTALL_LEAD: Record<InstallPlatform, string> = {
  iphone: "Add Stash to your Home Screen. It then opens like any other app.",
  android: "Add Stash to your home screen. It then opens like any other app.",
  computer:
    "On a computer, Stash is a bookmark. Drag it onto the bookmarks bar once.",
};

const SAVE_LEAD: Record<InstallPlatform, string> = {
  iphone: "Share a link to Stash from any app.",
  android: "Share a link to Stash from any app.",
  computer: "Click the bookmark on the page you want to keep.",
};

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  const iPadOs =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadOs) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "computer";
}

function isInstalledApp(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (
    "standalone" in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

/**
 * Two jobs, picked for the device in front of you: get Stash onto it, and
 * save a page into it. The other devices are one tap away.
 */
export function InstallGuide() {
  const [platform, setPlatform] = useState<InstallPlatform>("computer");
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [prompting, setPrompting] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(isInstalledApp());
    setCanPrompt(installPromptAvailable());
    return subscribeInstallPrompt(() => setCanPrompt(installPromptAvailable()));
  }, []);

  async function install() {
    setPrompting(true);
    try {
      const outcome = await runInstallPrompt();
      if (outcome === "accepted") setInstalled(true);
    } finally {
      setPrompting(false);
    }
  }

  return (
    <div data-testid="install-guide">
      {installed && platform !== "computer" && (
        <p
          data-testid="install-already"
          className="mt-4 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800"
        >
          Stash is already installed on this device. The steps below are for
          another one.
        </p>
      )}

      <div role="tablist" aria-label="Device" className="mt-6 flex gap-1">
        {PLATFORMS.map((item) => {
          const selected = item.id === platform;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`install-platform-${item.id}`}
              onClick={() => setPlatform(item.id)}
              className={`min-h-12 rounded-lg px-3 text-sm font-medium transition-colors ${
                selected
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <section className="mt-8" data-testid="install-section">
        <h2 className="text-base font-semibold text-slate-900">Install</h2>
        <p className="mt-1 text-sm text-slate-600">{INSTALL_LEAD[platform]}</p>
        {canPrompt && platform === "android" && !installed && (
          <button
            type="button"
            onClick={install}
            disabled={prompting}
            data-testid="install-prompt"
            className="mt-4 min-h-12 rounded-lg bg-violet-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
          >
            {prompting ? "Installing…" : "Install"}
          </button>
        )}
        <InstallShot platform={platform} task="install" />
        <Steps steps={INSTALL_STEPS[platform]} />
        {platform === "computer" && <Bookmarklet />}
      </section>

      <section className="mt-10" data-testid="save-section">
        <h2 className="text-base font-semibold text-slate-900">
          Save an article
        </h2>
        <p className="mt-1 text-sm text-slate-600">{SAVE_LEAD[platform]}</p>
        <InstallShot platform={platform} task="save" />
        <Steps steps={SAVE_STEPS[platform]} />
      </section>
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-600">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}
