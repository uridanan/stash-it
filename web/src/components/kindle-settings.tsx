"use client";

import { useEffect, useState } from "react";

/**
 * Where Send to Kindle delivers, and who it arrives from.
 *
 * The sender is read-only on purpose: it is the app's mail transport, set in
 * the environment by whoever runs it. It is shown because Amazon drops mail
 * from any address that is not on your Approved Personal Document E-mail List,
 * and you cannot approve an address the app never tells you.
 */
export function KindleSettings() {
  const [address, setAddress] = useState("");
  const [sender, setSender] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const body = await res.json();
        setAddress(body.kindleEmail ?? "");
        setSender(body.kindleSender ?? null);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindleEmail: address }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Save failed (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p className="mt-4 text-sm text-slate-400">Loading…</p>;

  return (
    <form onSubmit={save} className="mt-4 space-y-4">
      <div>
        <label
          className="mb-1 block text-sm font-medium text-slate-900"
          htmlFor="kindle-email"
        >
          Your Kindle address
        </label>
        <input
          id="kindle-email"
          // Deliberately not type="email": the browser would block submission
          // with its own bubble, so the server's check would never run and the
          // message would not match how every other field in this app reports
          // a problem.
          type="text"
          inputMode="email"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setSaved(false);
          }}
          placeholder="you@kindle.com"
          data-testid="kindle-email"
          className="w-full max-w-md rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-600"
        />
        <p className="mt-1 text-sm text-slate-500">
          Find it under Manage Your Content and Devices → Preferences → Personal
          Document Settings.
        </p>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-900">Sent from</p>
        {sender ? (
          <>
            <p
              data-testid="kindle-sender"
              className="mt-1 font-mono text-sm text-slate-700"
            >
              {sender}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Add this to your Approved Personal Document E-mail List on the same
              Amazon page, or the articles will be dropped without a bounce.
            </p>
          </>
        ) : (
          <p
            data-testid="kindle-unconfigured"
            className="mt-1 text-sm text-amber-700"
          >
            This app has no mail transport configured, so nothing can be sent.
            Set SMTP_HOST and SMTP_FROM in its environment — see the README.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          data-testid="kindle-save"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span data-testid="kindle-saved" className="text-sm text-slate-500">
            Saved
          </span>
        )}
        {error && (
          <span data-testid="kindle-error" className="text-sm text-red-600">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
