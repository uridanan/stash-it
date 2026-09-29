"use client";

/**
 * The app's on/off control.
 *
 * A switch rather than a checkbox everywhere: a setting takes effect the
 * moment it is flipped — none of these sit inside a form waiting for Save —
 * and a checkbox reads as "will be applied later". `role="switch"` says the
 * same thing to a screen reader.
 *
 * A checkbox is still right for selecting *things* (picking articles out of a
 * list); this is for settings.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** Optional second line: what the setting does, or its one caveat. */
  description?: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
          checked ? "bg-violet-600" : "bg-slate-300"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <div className="min-w-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(!checked)}
          // The label is a second target for the same action, not a control of
          // its own — the switch above carries the accessible name.
          aria-hidden
          tabIndex={-1}
          className="text-left text-sm font-medium text-slate-900 disabled:opacity-50"
        >
          {label}
        </button>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
