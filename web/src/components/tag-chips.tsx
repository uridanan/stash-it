import Link from "next/link";

import type { ArticleTagDTO, TagKind } from "@/types";

/**
 * Tag chips. Automatic tags read quieter than ones the user chose, so a row
 * of derived labels never competes with the article's own title.
 */

const KIND_STYLES: Record<TagKind, string> = {
  TOPIC: "border-violet-200 bg-violet-50 text-violet-700",
  LENGTH: "border-slate-200 bg-slate-50 text-slate-600",
  LANGUAGE: "border-cyan-200 bg-cyan-50 text-cyan-700",
  FORMAT: "border-slate-200 bg-slate-50 text-slate-600",
  SHOPPING: "border-amber-200 bg-amber-50 text-amber-700",
  TTS: "border-slate-200 bg-slate-50 text-slate-500",
  CUSTOM: "border-violet-200 bg-violet-50 text-violet-700",
};

export function TagChip({
  tag,
  href,
  onRemove,
}: {
  tag: { name: string; slug: string; kind: TagKind };
  href?: string;
  onRemove?: () => void;
}) {
  const className = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${KIND_STYLES[tag.kind]}`;
  const label = href ? (
    <Link href={href} className="hover:underline">
      {tag.name}
    </Link>
  ) : (
    <span>{tag.name}</span>
  );

  return (
    <span className={className}>
      {label}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.name}`}
          className="-mr-0.5 rounded-full px-0.5 leading-none opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** Read-only row of chips, used on list rows. */
export function TagChips({
  tags,
  max,
}: {
  tags: ArticleTagDTO[];
  /** Show at most this many, with a count for the rest. */
  max?: number;
}) {
  if (tags.length === 0) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const hidden = tags.length - shown.length;

  return (
    <span data-testid="tag-chips" className="inline-flex flex-wrap gap-1">
      {shown.map((tag) => (
        <TagChip key={tag.id} tag={tag} href={`/tags/${tag.slug}`} />
      ))}
      {hidden > 0 ? (
        <span className="text-xs text-slate-400">+{hidden}</span>
      ) : null}
    </span>
  );
}
