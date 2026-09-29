"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Menu, MenuItem } from "@/components/menu";
import { Toast } from "@/components/toast";
import {
  KindleIcon,
  MoreIcon,
  RefreshIcon,
  SparkleIcon,
  SpinnerIcon,
  TrashIcon,
} from "@/components/icons";

/**
 * The reader's overflow menu: refetch the text, regenerate the summary, delete.
 *
 * These are the escape hatch the import deliberately leaves open. An import
 * never overwrites an article it already has, so correcting one is done from
 * here rather than by importing again — but they are rare next to star, read
 * and download, and destructive enough that they should not sit one stray
 * click away, which is why they live behind the menu.
 */
export function ArticleActions({
  articleId,
  aiConfigured,
  kindleConfigured,
  onDeleted,
  buttonClass,
}: {
  articleId: string;
  aiConfigured: boolean;
  /** Both a mail transport and a Kindle address are set up. */
  kindleConfigured: boolean;
  /** Called after a successful delete, to leave the reader. */
  onDeleted: () => void;
  buttonClass: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    null | "refetch" | "summary" | "delete" | "kindle"
  >(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Both messages are transient.
   *
   * "Sent to …" reports something that is already over, so it has no business
   * staying on screen — and in the split view this component is the same
   * instance from one article to the next, so without this it followed you
   * around the library. An error gets longer, since it is worth reading.
   */
  useEffect(() => {
    if (!note && !error) return;
    const timer = setTimeout(
      () => {
        setNote(null);
        setError(null);
      },
      error ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [note, error]);

  // A different article is a different context: whatever the last one said
  // does not apply here.
  useEffect(() => {
    setNote(null);
    setError(null);
  }, [articleId]);

  async function post(path: string, kind: "refetch" | "summary") {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(path, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `That failed (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Mails the article. Unlike the others this changes nothing on the article,
   * so it reports by saying where it went rather than by the page updating.
   */
  async function sendToKindle() {
    setBusy("kindle");
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/articles/${articleId}/kindle`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setNote(`Sent to ${body?.to ?? "your Kindle"}`);
      } else {
        setError(body?.error ?? `That failed (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Delete this article? This cannot be undone.")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted();
      } else {
        setError(`Delete failed (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Menu
        label="More actions"
        testId="article-actions"
        className={buttonClass}
        icon={busy ? <SpinnerIcon /> : <MoreIcon />}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<RefreshIcon />}
              label={busy === "refetch" ? "Fetching…" : "Fetch"}
              disabled={busy !== null}
              testId="refetch-article"
              onSelect={() => {
                close();
                void post(`/api/articles/${articleId}/extract?force=1`, "refetch");
              }}
            />
            {aiConfigured && (
              <MenuItem
                icon={<SparkleIcon />}
                label={busy === "summary" ? "Summarizing…" : "Summarize"}
                disabled={busy !== null}
                testId="regenerate-summary"
                onSelect={() => {
                  close();
                  void post(`/api/articles/${articleId}/summary`, "summary");
                }}
              />
            )}
            {kindleConfigured && (
              <MenuItem
                icon={<KindleIcon />}
                label={busy === "kindle" ? "Sending…" : "Send to Kindle"}
                disabled={busy !== null}
                testId="send-to-kindle"
                onSelect={() => {
                  close();
                  void sendToKindle();
                }}
              />
            )}
            <MenuItem
              icon={<TrashIcon />}
              label="Delete"
              danger
              disabled={busy !== null}
              testId="delete-article"
              onSelect={() => {
                close();
                void remove();
              }}
            />
          </>
        )}
      </Menu>
      {error ? (
        <Toast
          message={error}
          tone="error"
          testId="article-action-error"
          onDismiss={() => setError(null)}
        />
      ) : note ? (
        <Toast
          message={note}
          testId="article-action-note"
          onDismiss={() => setNote(null)}
        />
      ) : null}
    </>
  );
}
