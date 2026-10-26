"use client";

/**
 * A segmented control: one choice is selected, and picking another clears it.
 * For a short fixed set. A long or open-ended list stays a menu.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  choices,
  testId,
}: {
  /** Accessible name for the group. The visible label, if any, sits outside. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  choices: { value: T; label: string }[];
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className="flex flex-wrap gap-1.5"
    >
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={testId ? `${testId}-${choice.value}` : undefined}
            onClick={() => onChange(choice.value)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
              selected
                ? "bg-violet-600 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
