"use client";

import { CloseIcon } from "@/components/icons";

/**
 * A transient card for something that has already happened — "Sent to …",
 * "Added 3 to Reading Pile", or the error where one of those was meant to be.
 *
 * Floating rather than inline: these messages used to sit in the toolbar row,
 * where they pushed the controls around, competed with the icons for the same
 * few pixels, and were easy to miss. It docks top-right, clear of the sticky
 * toolbar (z-10) and any open menu (z-20).
 *
 * Dismissal is the caller's business — every caller already runs a timer, and
 * a card that could only be closed by hand would be the old problem again.
 */
export function Toast({
  message,
  tone = "info",
  onDismiss,
  testId,
}: {
  message: string;
  tone?: "info" | "error";
  onDismiss: () => void;
  testId?: string;
}) {
  const error = tone === "error";

  return (
    <div
      // polite, not assertive: it is a confirmation, not an interruption.
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={`toast-card fixed right-4 top-16 z-50 flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg md:top-4 md:max-w-sm ${
        error
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-violet-200 bg-white text-slate-800"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
          error ? "bg-red-500" : "bg-violet-500"
        }`}
      />
      <p className="min-w-0 flex-1 leading-snug">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className={`-mr-1 -mt-0.5 shrink-0 rounded p-1 transition-colors ${
          error ? "hover:bg-red-100" : "hover:bg-slate-100"
        }`}
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
