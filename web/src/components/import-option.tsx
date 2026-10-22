export type TagsOption = "assign" | "import";
export type ContentOption = "missing" | "refresh";
export type SummaryOption = "ondemand" | "missing" | "always";

export const TAG_CHOICES: { value: TagsOption; label: string }[] = [
  { value: "assign", label: "Assign automatically" },
  { value: "import", label: "Import from file" },
];

export const CONTENT_CHOICES: { value: ContentOption; label: string }[] = [
  { value: "missing", label: "Fetch if missing" },
  { value: "refresh", label: "Re-fetch everything" },
];

export const SUMMARY_CHOICES: { value: SummaryOption; label: string }[] = [
  { value: "ondemand", label: "On demand" },
  { value: "missing", label: "Generate if missing" },
  { value: "always", label: "Always regenerate" },
];

const selectClass =
  "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-violet-600";

export function ImportOption<T extends string>({
  label,
  hint,
  value,
  onChange,
  choices,
  testId,
}: {
  label: string;
  hint: string;
  value: T;
  onChange: (value: T) => void;
  choices: { value: T; label: string }[];
  testId: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        data-testid={testId}
        className={`${selectClass} mt-1 block w-full`}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
}
