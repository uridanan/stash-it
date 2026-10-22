"use client";

import { useEffect, useState } from "react";

const EVENT = "stash:article-read";

type ArticleFlagDetail = { id: string; read?: boolean; starred?: boolean };

/**
 * Tell every open list and reader that star or read just changed.
 *
 * The click paints the new highlight immediately. A refresh is not required,
 * and would replace the open article with the loading screen.
 */
export function announceArticleFlags(
  id: string,
  patch: { read?: boolean; starred?: boolean },
) {
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: { id, ...patch } satisfies ArticleFlagDetail }),
  );
}

export function announceArticleRead(id: string, read: boolean) {
  announceArticleFlags(id, { read });
}

export function onArticleFlags(handler: (detail: ArticleFlagDetail) => void): () => void {
  function listener(event: Event) {
    const detail = (event as CustomEvent<ArticleFlagDetail>).detail;
    if (detail?.id) handler(detail);
  }
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function onArticleRead(
  handler: (id: string, read: boolean) => void,
): () => void {
  return onArticleFlags((detail) => {
    if (detail.read !== undefined) handler(detail.id, detail.read);
  });
}

/**
 * Read state announced after this view rendered.
 *
 * Null until that happens, and again once the server value catches up, so a
 * refresh doesn't leave a stale override on top of the new props.
 */
function useAnnouncedFlag(
  id: string,
  serverValue: boolean,
  key: "read" | "starred",
): boolean | null {
  const [override, setOverride] = useState<{ id: string; value: boolean } | null>(null);

  useEffect(() => {
    setOverride((current) => {
      if (current && current.id === id && current.value === serverValue) return null;
      return current;
    });
  }, [id, serverValue]);

  useEffect(
    () =>
      onArticleFlags((detail) => {
        const value = detail[key];
        if (detail.id === id && value !== undefined) setOverride({ id, value });
      }),
    [id, key],
  );

  return override && override.id === id ? override.value : null;
}

export function useAnnouncedRead(id: string, serverRead: boolean): boolean | null {
  return useAnnouncedFlag(id, serverRead, "read");
}

export function useAnnouncedStar(id: string, serverStarred: boolean): boolean | null {
  return useAnnouncedFlag(id, serverStarred, "starred");
}
