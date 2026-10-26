"use client";

import { useEffect, useState } from "react";

import { SaveButton } from "@/components/save-button";
import { SegmentedControl } from "@/components/segmented-control";
import { TopicList } from "@/components/topic-list";
import { Toggle } from "@/components/toggle";

interface SettingsResponse {
  aiSummariesEnabled: boolean;
  summaryView: string;
  topics: string[];
}

export function AiSettings() {
  const [enabled, setEnabled] = useState(false);
  const [summaryView, setSummaryView] = useState("card");
  const [topics, setTopics] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        if (cancelled) return;
        setEnabled(data.aiSummariesEnabled);
        setSummaryView(data.summaryView);
        setTopics(data.topics ?? []);
      })
      .catch(() => {
        if (!cancelled) setStatus("Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!topics) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiSummariesEnabled: enabled,
          summaryView,
          topics,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setStatus(err?.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      const fresh = await fetch("/api/settings").then((response) => response.json());
      setTopics(fresh.topics ?? topics);
      setStatus("Saved");
    } catch {
      setStatus("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!topics) {
    return (
      <p className="mt-1 text-sm text-slate-500" data-testid="ai-settings-loading">
        Loading…
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-6" data-testid="ai-settings">
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-slate-900">Summaries</h3>
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Enable AI summaries"
          description="New articles are summarized automatically when saved; existing articles get a “Summarize” button in the reader."
          testId="ai-enabled-toggle"
        />

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-900">
            Summary display
          </span>
          <SegmentedControl
            label="Summary display"
            value={summaryView}
            onChange={setSummaryView}
            choices={[
              { value: "card", label: "Card above the article" },
              { value: "tabs", label: "Summary / Article tabs" },
            ]}
            testId="summary-view"
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-900">Tags</h3>
        <p className="text-xs text-slate-500">
          Auto-tag picks from this list. It starts as the system defaults —
          remove any you don&apos;t want, or add your own.
        </p>
        <TopicList topics={topics} onChange={setTopics} />
      </section>

      <div className="flex items-center gap-3">
        <SaveButton saving={saving} onClick={save} testId="ai-settings-save" />
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
