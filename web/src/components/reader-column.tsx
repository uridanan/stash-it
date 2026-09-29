"use client";

import { useReaderLayout } from "@/components/reader-layout";

/**
 * The reader pane's measure.
 *
 * Normally a 2xl column, so a line stays a comfortable length next to the
 * list. With the list hidden the column widens rather than simply centering
 * in an empty window — otherwise "full width" would give back nothing but
 * margin.
 */
export function ReaderColumn({ children }: { children: React.ReactNode }) {
  const layout = useReaderLayout();
  return (
    <div
      className={`mx-auto px-6 pb-16 ${layout?.listHidden ? "max-w-4xl" : "max-w-2xl"}`}
    >
      {children}
    </div>
  );
}
