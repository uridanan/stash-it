"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * The toolbar's dropdown.
 *
 * Small enough to own rather than take a headless-UI dependency for: a button,
 * a panel, and the three ways a menu has to close — Escape, a click elsewhere,
 * and picking something. `children` is a render prop so an item can close the
 * menu it lives in.
 */
export function Menu({
  label,
  icon,
  testId,
  disabled = false,
  className,
  children,
}: {
  /** Tooltip and accessible name for the trigger. */
  label: string;
  icon: React.ReactNode;
  testId?: string;
  disabled?: boolean;
  className?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid={testId}
        className={className}
      >
        {icon}
      </button>
      {open && (
        <div
          id={panelId}
          role="menu"
          data-testid={testId ? `${testId}-panel` : undefined}
          className="absolute right-0 top-full z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent";

/** A menu row that runs something. */
export function MenuItem({
  icon,
  label,
  onSelect,
  disabled = false,
  testId,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  testId?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled}
      data-testid={testId}
      className={
        danger
          ? `${ITEM_CLASS} text-red-600 hover:bg-red-50 hover:text-red-700`
          : ITEM_CLASS
      }
    >
      <span className="text-slate-400">{icon}</span>
      {label}
    </button>
  );
}

/** A menu row that is a download link — an anchor, so the browser saves it. */
export function MenuLink({
  icon,
  label,
  href,
  onSelect,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  onSelect?: () => void;
  testId?: string;
}) {
  return (
    <a
      role="menuitem"
      href={href}
      download
      onClick={onSelect}
      data-testid={testId}
      className={ITEM_CLASS}
    >
      <span className="text-slate-400">{icon}</span>
      {label}
    </a>
  );
}
