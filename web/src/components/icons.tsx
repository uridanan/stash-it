/**
 * The reader's icon set.
 *
 * Hand-drawn inline SVG rather than an icon package: the app already draws its
 * transport controls and empty states this way, a dependency would ship a
 * hundred icons to render eight, and — the reason that actually bit us —
 * emoji-presentation codepoints like ⏸ and ↩ render as coloured emoji in most
 * browsers, which looks wrong next to a monochrome toolbar.
 *
 * Every icon is a 24×24 stroked path on `currentColor`, so colour and size
 * come from the button that holds it.
 */

export type IconProps = {
  className?: string;
  /** Fills the shape as well as stroking it — used for the "on" star. */
  filled?: boolean;
};

function Svg({
  className = "h-4 w-4",
  filled = false,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

/** Arrows pushing outwards: hide the list and let the reader have the width. */
export function ExpandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H4v5M4 4l6 6M15 4h5v5M20 4l-6 6M9 20H4v-5M4 20l6-6M15 20h5v-5M20 20l-6-6" />
    </Svg>
  );
}

/** A page with a column down its left edge: bring the article list back. */
export function PanelLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </Svg>
  );
}

function LetterA() {
  return <path d="M3.5 17.5L7.5 7l4 10.5M4.9 14.2h5.2" />;
}

export function TextSmallerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <LetterA />
      <path d="M14.5 12.5h6" />
    </Svg>
  );
}

export function TextLargerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <LetterA />
      <path d="M14.5 12.5h6M17.5 9.5v6" />
    </Svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M4.5 19.5h15" />
    </Svg>
  );
}

export function HeadphonesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 15v-2.5a8 8 0 0 1 16 0V15" />
      <path d="M4 14.5h2.5a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5zM20 14.5h-2.5a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h1a1.5 1.5 0 0 0 1.5-1.5z" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" />
    </Svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />
    </Svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8zM18 16l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5h15M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7M6.5 6.5l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3l.8-12.2" />
    </Svg>
  );
}

export function FileTextIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M8.5 13h7M8.5 16.5h5" />
    </Svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5h-9.5z" />
      <path d="M19.5 6.5v13H16" />
    </Svg>
  );
}

export function KindleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4" />
    </Svg>
  );
}

/** A ring with one quarter drawn, spun by Tailwind's animate-spin. */
export function SpinnerIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`${className} animate-spin`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" className="opacity-25" />
      <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" />
    </svg>
  );
}
