"use client";

import { useEffect } from "react";

import {
  captureInstallPrompt,
  clearInstallPrompt,
} from "@/components/install-prompt";

export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Service worker registration is best-effort; ignore failures.
      });
    }

    function onPrompt(event: Event) {
      captureInstallPrompt(event);
    }
    function onInstalled() {
      clearInstallPrompt();
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}
