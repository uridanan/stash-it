"use client";

import { useState } from "react";

/**
 * An editable list of tag names: each one can be removed, and a new one added.
 * Shared by Settings (a person's list) and Admin (the system defaults).
 */
export function TopicList({
  topics,
  onChange,
  testId = "topic-list",
  placeholder = "Add a tag",
}: {
  topics: string[];
  onChange: (topics: string[]) => void;
  testId?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const name = draft.trim().slice(0, 40);
    if (!name) return;
    if (topics.some((topic) => topic.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...topics, name]);
    setDraft("");
  }

  return (
    <div data-testid={testId}>
      {topics.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {topics.map((topic) => (
            <li
              key={topic.toLowerCase()}
              data-testid="topic-chip"
              className="inline-flex items-center gap-0.5 rounded-full border border-violet-200 bg-violet-50 py-px pl-2 pr-0.5 text-xs leading-4 text-violet-800"
            >
              <span>{topic}</span>
              <button
                type="button"
                aria-label={`Remove ${topic}`}
                onClick={() =>
                  onChange(
                    topics.filter(
                      (current) => current.toLowerCase() !== topic.toLowerCase(),
                    ),
                  )
                }
                className="flex h-4 w-4 items-center justify-center rounded-full text-sm leading-none text-violet-500 hover:bg-violet-100 hover:text-violet-800"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No tags yet.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid="topic-add-input"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-violet-600 focus:bg-white"
        />
        <button
          type="submit"
          data-testid="topic-add"
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}
