"use client";

const saveClass =
  "rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60";

/** The one save button. Same label and size on every settings page. */
export function SaveButton({
  saving = false,
  type = "button",
  testId,
  onClick,
}: {
  saving?: boolean;
  type?: "button" | "submit";
  testId?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={saving}
      data-testid={testId}
      onClick={onClick}
      className={saveClass}
    >
      {saving ? "Saving…" : "Save"}
    </button>
  );
}
