"use client";

import { useEffect, useState } from "react";

import { Toggle } from "@/components/toggle";

interface SettingsResponse {
  aiSummariesEnabled: boolean;
  aiModel: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  aiPrompt: string;
  aiPromptIsDefault: boolean;
  summaryView: string;
  customTopics: string[];
  builtInTopics: string[];
  models: { id: string; label: string }[];
  defaultPrompt: string;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-violet-600 focus:bg-white";

export function AiSettings() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState(""); // empty = leave stored key unchanged
  const [prompt, setPrompt] = useState("");
  const [summaryView, setSummaryView] = useState("card");
  const [customTopics, setCustomTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        if (cancelled) return;
        setSettings(data);
        setEnabled(data.aiSummariesEnabled);
        setModel(data.aiModel);
        setPrompt(data.aiPrompt);
        setSummaryView(data.summaryView);
        setCustomTopics((data.customTopics ?? []).join(", "));
      })
      .catch(() => {
        if (!cancelled) setStatus("Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        aiSummariesEnabled: enabled,
        aiModel: model,
        aiPrompt: prompt,
        summaryView,
        customTopics: customTopics
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      // Only send the key if the user typed one — otherwise keep the stored key.
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setStatus(err?.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      setStatus("Saved");
      if (apiKey.trim() && settings) {
        setSettings({ ...settings, hasApiKey: true, apiKeyHint: apiKey.trim().slice(-4) });
        setApiKey("");
      }
    } catch {
      setStatus("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <p className="mt-1 text-sm text-slate-500" data-testid="ai-settings-loading">
        Loading…
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-5" data-testid="ai-settings">
      <div>
        <label
          htmlFor="custom-topics"
          className="block text-sm font-medium text-slate-900"
        >
          Extra topics
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Topics are picked from a fixed list so collections don&apos;t
          fragment into near-duplicates. Add your own here, comma separated —
          they join the list the model chooses from.
        </p>
        <input
          id="custom-topics"
          data-testid="custom-topics"
          value={customTopics}
          onChange={(event) => setCustomTopics(event.target.value)}
          placeholder="Woodworking, Board games"
          className={`${inputClass} mt-2`}
        />
        {settings?.builtInTopics?.length ? (
          <p className="mt-1 text-xs text-slate-400">
            Built in: {settings.builtInTopics.join(", ")}
          </p>
        ) : null}
      </div>

      <Toggle
        checked={enabled}
        onChange={setEnabled}
        label="Enable AI summaries"
        description="New articles are summarized automatically when saved; existing articles get a “Summarize” button in the reader."
        testId="ai-enabled-toggle"
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="ai-model">
          Model
        </label>
        <select
          id="ai-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        >
          {settings.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="ai-key">
          API key
        </label>
        <input
          id="ai-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            settings.hasApiKey
              ? `Key ending in …${settings.apiKeyHint} is saved — enter a new key to replace it`
              : "Paste the API key for the selected model's provider"
          }
          autoComplete="off"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Stored on your server and only sent to the model provider. Never shown again
          after saving.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="ai-prompt">
          Summary prompt
        </label>
        <textarea
          id="ai-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          className={`${inputClass} font-mono text-xs leading-relaxed`}
        />
        <button
          type="button"
          onClick={() => setPrompt(settings.defaultPrompt)}
          className="mt-1 text-xs text-violet-700 underline underline-offset-2 hover:text-violet-800"
        >
          Reset to default prompt
        </button>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-900">
          Summary display
        </span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="summary-view"
              value="card"
              checked={summaryView === "card"}
              onChange={() => setSummaryView("card")}
              className="accent-violet-600"
            />
            Card above the article
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="summary-view"
              value="tabs"
              checked={summaryView === "tabs"}
              onChange={() => setSummaryView("tabs")}
              className="accent-violet-600"
            />
            Summary / Article tabs
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="ai-settings-save"
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save AI settings"}
        </button>
        {status && (
          <span
            className={`text-sm ${status === "Saved" ? "text-green-700" : "text-red-600"}`}
            data-testid="ai-settings-status"
          >
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
