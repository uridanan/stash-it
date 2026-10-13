/* Stash service worker — minimal, no build step.
 *
 * Strategy:
 *  - install: pre-cache the offline fallback page.
 *  - navigations: network, with navigation preload so the request starts
 *    while the worker boots. The response is passed straight through.
 *    Cloning it into the cache stalls the stream on a large article page,
 *    which made opening the app and an article feel slow. Offline falls
 *    back to /offline.html.
 *  - same-origin static assets (/_next/static/, /icons/): cache-first.
 *  - activate: enable navigation preload and delete caches from older versions.
 */

const CACHE_VERSION = "stash-v2";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  // Navigations: don't buffer the body. A cloned article page is large
  // enough that the cache write holds up the bytes the screen is waiting for.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await fetch(request);
        } catch {
          const fallback = await caches.match(OFFLINE_URL);
          return (
            fallback ||
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Same-origin static assets: cache-first.
  const url = new URL(request.url);
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/"));

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE_VERSION)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
