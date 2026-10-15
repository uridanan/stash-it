"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { PlusIcon } from "@/components/icons";

const inputClass =
  "min-h-12 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-base outline-none transition-colors focus:border-violet-600";

const plusClass =
  "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-60";

function useSaveUrl() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || saving) return false;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (res.ok) {
        setUrl("");
        router.refresh();
        return true;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save that URL.");
      return false;
    } catch {
      setError("Network error — could not save that URL.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { url, setUrl, saving, error, submit };
}

function PlusButton({ saving }: { saving: boolean }) {
  return (
    <button
      type="submit"
      disabled={saving}
      aria-label={saving ? "Saving" : "Save"}
      data-testid="add-url-submit"
      className={plusClass}
    >
      {saving ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      ) : (
        <PlusIcon className="h-6 w-6" />
      )}
    </button>
  );
}

/**
 * Desktop save row: the URL field stays visible, and + submits it.
 * Hidden below the `md` title bar, where AddUrlLauncher owns the same action.
 */
export function AddUrl() {
  const { url, setUrl, saving, error, submit } = useSaveUrl();

  return (
    <div className="max-md:hidden min-w-0 flex-1">
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/article-to-read-later"
          aria-label="Article URL"
          data-testid="add-url-input"
          className={inputClass}
        />
        <PlusButton saving={saving} />
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Phone title-bar control. + opens the URL field; it isn't shown until asked,
 * so the list can start at the top of the screen.
 */
export function AddUrlLauncher() {
  const { url, setUrl, saving, error, submit } = useSaveUrl();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Add article"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="add-url-open"
        className={plusClass}
      >
        <PlusIcon className="h-6 w-6" />
      </button>
      {open && (
        <form
          id={panelId}
          onSubmit={(event) => {
            void submit(event).then((ok) => {
              if (ok) setOpen(false);
            });
          }}
          className="fixed inset-x-0 top-16 z-30 border-b border-slate-200 bg-white px-3 py-3 shadow-lg"
        >
          <div className="flex gap-2">
            <input
              type="url"
              required
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
              aria-label="Article URL"
              data-testid="add-url-input"
              className={inputClass}
            />
            <PlusButton saving={saving} />
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}
