"use client";

import { useEffect, useState } from "react";

const EVENT = "stash:article-read";

/**
 * Tell every open list and reader that an article's read state just changed.
 *
 * Listening marks an article read from outside the list, which otherwise keeps
 * showing the check it rendered when the page loaded.
 */
export function announceArticleRead(id: string, read: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, read } }));
}

export function onArticleRead(
  handler: (id: string, read: boolean) => void,
): () => void {
  function listener(event: Event) {
    const detail = (event as CustomEvent<{ id: string; read: boolean }>).detail;
    if (detail?.id) handler(detail.id, detail.read);
  }
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/**
 * Read state announced after this view rendered.
 *
 * Null until that happens, and again once the server value catches up, so a
 * refresh doesn't leave a stale override on top of the new props.
 */
export function useAnnouncedRead(id: string, serverRead: boolean): boolean | null {
  const [override, setOverride] = useState<{ id: string; read: boolean } | null>(
    null,
  );

  useEffect(() => {
    setOverride((current) => {
      if (current && current.id === id && current.read === serverRead) return null;
      return current;
    });
  }, [id, serverRead]);

  useEffect(() => onArticleRead((readId, read) => {
    if (readId === id) setOverride({ id, read });
  }), [id]);

  return override && override.id === id ? override.read : null;
}
