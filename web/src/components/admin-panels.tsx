"use client";

import { useEffect, useState } from "react";

import {
  CONTENT_CHOICES,
  ImportOption,
  SUMMARY_CHOICES,
  TAG_CHOICES,
  type ContentOption,
  type SummaryOption,
  type TagsOption,
} from "@/components/import-option";
import { SaveButton } from "@/components/save-button";
import { TopicList } from "@/components/topic-list";

interface AdminSettings {
  aiModel: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  aiPrompt: string;
  defaultPrompt: string;
  models: { id: string; label: string }[];
  defaultTopics: string[];
  importTags: TagsOption;
  importContent: ContentOption;
  importSummary: SummaryOption;
  smtpFrom: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSource: "saved" | "environment" | "none";
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-violet-600 focus:bg-white";

function useAdminSettings() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings")
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json();
      })
      .then((data: AdminSettings) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        if (!cancelled) setStatus("Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setStatus(err?.error ?? `Save failed (HTTP ${res.status})`);
        return false;
      }
      setStatus("Saved");
      return true;
    } catch {
      setStatus("Network error — try again");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { settings, setSettings, status, saving, save };
}

function Status({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span
      className={`text-sm ${status === "Saved" ? "text-green-700" : "text-red-600"}`}
      data-testid="admin-settings-status"
    >
      {status}
    </span>
  );
}

function Loading() {
  return (
    <p className="mt-4 text-sm text-slate-500" data-testid="admin-settings-loading">
      Loading…
    </p>
  );
}

export function AdminAi() {
  const { settings, setSettings, status, saving, save } = useAdminSettings();
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!settings) return;
    setModel(settings.aiModel);
    setPrompt(settings.aiPrompt);
  }, [settings]);

  if (!settings) return <Loading />;

  return (
    <div className="mt-4 space-y-5" data-testid="admin-ai">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="ai-model">
          Model
        </label>
        <select
          id="ai-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className={inputClass}
        >
          {settings.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
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
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            settings.hasApiKey
              ? `Key ending in …${settings.apiKeyHint} is saved — enter a new key to replace it`
              : "Paste the API key for the selected model's provider"
          }
          autoComplete="off"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Stored on the server and only sent to the model provider. Never shown
          again after saving.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="ai-prompt">
          Summary prompt
        </label>
        <textarea
          id="ai-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
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

      <div className="flex items-center gap-3">
        <SaveButton
          saving={saving}
          testId="admin-ai-save"
          onClick={() => {
            const body: Record<string, unknown> = { aiModel: model, aiPrompt: prompt };
            if (apiKey.trim()) body.apiKey = apiKey.trim();
            void save(body).then((ok) => {
              if (!ok || !apiKey.trim()) return;
              setSettings({
                ...settings,
                aiModel: model,
                aiPrompt: prompt,
                hasApiKey: true,
                apiKeyHint: apiKey.trim().slice(-4),
              });
              setApiKey("");
            });
          }}
        />
        <Status status={status} />
      </div>
    </div>
  );
}

export function AdminTags() {
  const { settings, status, saving, save } = useAdminSettings();
  const [topics, setTopics] = useState<string[] | null>(null);

  useEffect(() => {
    if (settings && topics === null) setTopics(settings.defaultTopics);
  }, [settings, topics]);

  if (!settings || topics === null) return <Loading />;

  return (
    <div className="mt-4 space-y-5" data-testid="admin-tags">
      <TopicList topics={topics} onChange={setTopics} placeholder="Add a default tag" />
      <div className="flex items-center gap-3">
        <SaveButton
          saving={saving}
          testId="admin-tags-save"
          onClick={() => void save({ defaultTopics: topics })}
        />
        <Status status={status} />
      </div>
    </div>
  );
}

export function AdminImport() {
  const { settings, status, saving, save } = useAdminSettings();
  const [tags, setTags] = useState<TagsOption>("assign");
  const [content, setContent] = useState<ContentOption>("missing");
  const [summary, setSummary] = useState<SummaryOption>("ondemand");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!settings || ready) return;
    setTags(settings.importTags);
    setContent(settings.importContent);
    setSummary(settings.importSummary);
    setReady(true);
  }, [settings, ready]);

  if (!settings || !ready) return <Loading />;

  return (
    <div className="mt-4 space-y-5" data-testid="admin-import">
      <div className="grid gap-3 sm:grid-cols-3">
        <ImportOption
          label="Collections"
          hint="Assign re-derives them from each article. Import keeps the collections in the file."
          value={tags}
          onChange={setTags}
          testId="admin-option-tags"
          choices={TAG_CHOICES}
        />
        <ImportOption
          label="Article text"
          hint="Re-fetch prefers the live page and keeps the imported copy when a page is gone."
          value={content}
          onChange={setContent}
          testId="admin-option-content"
          choices={CONTENT_CHOICES}
        />
        <ImportOption
          label="AI summaries"
          hint="On demand keeps the cost to what someone actually reads; each article offers a button."
          value={summary}
          onChange={setSummary}
          testId="admin-option-summary"
          choices={SUMMARY_CHOICES}
        />
      </div>
      <div className="flex items-center gap-3">
        <SaveButton
          saving={saving}
          testId="admin-import-save"
          onClick={() =>
            void save({ importTags: tags, importContent: content, importSummary: summary })
          }
        />
        <Status status={status} />
      </div>
    </div>
  );
}

export function AdminKindle() {
  const { settings, setSettings, status, saving, save } = useAdminSettings();
  const [from, setFrom] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!settings || ready) return;
    setFrom(settings.smtpFrom);
    setHost(settings.smtpHost);
    setPort(String(settings.smtpPort || 587));
    setUser(settings.smtpUser);
    setPassword(settings.smtpPassword);
    setReady(true);
  }, [settings, ready]);

  if (!settings || !ready) return <Loading />;

  return (
    <div className="mt-4 space-y-5" data-testid="admin-kindle">
      {settings.smtpSource === "environment" && (
        <p className="text-sm text-amber-700" data-testid="admin-kindle-fallback">
          This is the account the server is using, from its environment. Saving
          stores a copy here.
        </p>
      )}
      {settings.smtpSource === "none" && (
        <p className="text-sm text-amber-700" data-testid="admin-kindle-fallback">
          No sending account is configured.
        </p>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="smtp-from">
          From address
        </label>
        <input
          id="smtp-from"
          type="text"
          inputMode="email"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder="you@gmail.com"
          autoComplete="off"
          data-testid="admin-kindle-from"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Amazon delivers the article only if this address is on the Approved
          Personal Document E-mail List. Settings shows it so it can be added there.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="smtp-host">
            SMTP host
          </label>
          <input
            id="smtp-host"
            type="text"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="smtp.gmail.com"
            autoComplete="off"
            data-testid="admin-kindle-host"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="smtp-port">
            Port
          </label>
          <input
            id="smtp-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            data-testid="admin-kindle-port"
            className={inputClass}
          />
        </div>
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        465 uses implicit TLS. Other ports start with STARTTLS.
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="smtp-user">
          Username
        </label>
        <input
          id="smtp-user"
          type="text"
          value={user}
          onChange={(event) => setUser(event.target.value)}
          placeholder="Usually the same as the From address"
          autoComplete="off"
          data-testid="admin-kindle-user"
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="smtp-password">
          Password
        </label>
        <div className="flex gap-2">
          <input
            id="smtp-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="App password for the account above"
            autoComplete="off"
            spellCheck={false}
            data-testid="admin-kindle-password"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-pressed={showPassword}
            data-testid="admin-kindle-password-reveal"
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Stored on the server and only sent to the mail host.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <SaveButton
          saving={saving}
          testId="admin-kindle-save"
          onClick={() => {
            const body: Record<string, unknown> = {
              smtpFrom: from,
              smtpHost: host,
              smtpPort: port.trim() ? Number(port) : 587,
              smtpUser: user,
              smtpPassword: password,
            };
            void save(body).then(async (ok) => {
              if (!ok) return;
              const res = await fetch("/api/admin/settings");
              if (!res.ok) return;
              const next: AdminSettings = await res.json();
              setSettings(next);
              setFrom(next.smtpFrom);
              setHost(next.smtpHost);
              setPort(String(next.smtpPort || 587));
              setUser(next.smtpUser);
              setPassword(next.smtpPassword);
            });
          }}
        />
        <Status status={status} />
      </div>
    </div>
  );
}
