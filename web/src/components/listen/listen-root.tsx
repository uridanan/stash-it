"use client";

import { useEffect, useRef } from "react";

import { useListen } from "@/components/listen/listen-provider";
import { ListenPlayer } from "@/components/listen/listen-player";

/**
 * Marks the reader's content as the thing to narrate.
 *
 * Listen state lives up in `AppShell` so a playlist survives navigation
 * between articles, but the player's *markup* has to stay down here: it docks
 * with `sticky bottom-0`, which only pins correctly when it is the last child
 * inside the reader's own scroll column.
 */
export function ListenRoot({
  articleId,
  title,
  lang,
  children,
}: {
  articleId: string;
  title: string;
  lang: string | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { registerRoot, unregisterRoot } = useListen();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    registerRoot({ element, articleId, title, lang });
    return () => unregisterRoot(articleId);
  }, [articleId, lang, registerRoot, title, unregisterRoot]);

  return (
    <div ref={ref}>
      {children}
      <ListenPlayer />
    </div>
  );
}
