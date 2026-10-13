"use client";

import { useEffect } from "react";

/**
 * Hold a screen wake lock while `active` is true.
 *
 * Used while an article is on screen and while a listen session is running,
 * so the phone doesn't dim mid-paragraph or mid-sentence. The browser drops
 * the lock whenever the page is hidden; we take it back on the next visible
 * moment, and also on the next tap in case the first request needed a gesture.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let released = false;
    let sentinel: WakeLockSentinel | null = null;

    async function acquire() {
      if (released || sentinel || document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (released) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // Denied, or the browser wants a user gesture first. The pointer
        // handler below retries.
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") void acquire();
    }

    function onPointerDown() {
      void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", onPointerDown);
      const current = sentinel;
      sentinel = null;
      void current?.release().catch(() => {});
    };
  }, [active]);
}
