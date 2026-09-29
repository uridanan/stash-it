"use client";

import { createContext, useContext } from "react";

/**
 * Whether the desktop split view is currently giving the reader the full
 * window, shared between the panes (which own the state) and the reader
 * toolbar (which holds the button).
 *
 * The context is absent on the standalone /article page — there is no list to
 * hide there — and the toolbar uses that absence to leave the button out.
 */
export interface ReaderLayout {
  listHidden: boolean;
  setListHidden: (hidden: boolean) => void;
}

const ReaderLayoutContext = createContext<ReaderLayout | null>(null);

export const ReaderLayoutProvider = ReaderLayoutContext.Provider;

export function useReaderLayout(): ReaderLayout | null {
  return useContext(ReaderLayoutContext);
}
