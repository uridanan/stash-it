"use client";

import { useCallback, useEffect, useState } from "react";

type TokenInfo = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function TokenManager() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) return;
      const data: unknown = await res.json();
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { tokens?: unknown }).tokens)
          ? (data as { tokens: unknown[] }).tokens
          : [];
      setTokens(list as TokenInfo[]);
    } catch {
      // Ignore; the list simply stays empty.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;

    setCreating(true);
    setError(null);
    setNewToken(null);
    setCopied(false);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as {
        token?: string;
        error?: string;
      } | null;
      if (res.ok && data?.token) {
        setNewToken(data.token);
        setName("");
        await load();
      } else {
        setError(data?.error ?? "Could not create the token.");
      }
    } catch {
      setError("Network error — could not create the token.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this token? Anything using it will stop working.")) {
      return;
    }
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTokens((current) => current.filter((t) => t.id !== id));
      }
    } catch {
      // Ignore; token remains listed.
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; the user can select the text manually.
    }
  }

  return (
    <div>
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Chrome extension)"
          aria-label="Token name"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-600"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create token"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {newToken && (
        <div className="mt-4 rounded-lg border border-violet-300 bg-violet-50 p-4">
          <p className="text-sm font-medium text-violet-900">
            Copy your token now — it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code
              data-testid="token-value"
              className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded border border-violet-200 bg-white px-3 py-2 font-mono text-sm text-slate-800"
            >
              {newToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading tokens…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-slate-500">
            No API tokens yet. Create one to use the Chrome extension.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {token.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Created {formatDate(token.createdAt)}
                    {token.lastUsedAt &&
                      ` · last used ${formatDate(token.lastUsedAt)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(token.id)}
                  className="shrink-0 rounded px-2 py-1 text-sm text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
