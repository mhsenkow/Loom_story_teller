// =================================================================
// ChartCellChrome — floating cell actions next to the chart stage
// =================================================================
// Icon rail (refresh / save / data / why / arrange / edit title) sits beside
// the chart so the plot reads as one cell, not a header+footer sandwich.
// =================================================================

"use client";

import type { ReactNode } from "react";

type CellIconBtnProps = {
  label: string;
  title: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

export function CellIconBtn({ label, title, onClick, pressed, disabled, children }: CellIconBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      className={`
        inline-flex items-center justify-center size-7 rounded-md border transition-colors
        disabled:opacity-40 disabled:pointer-events-none
        ${
          pressed
            ? "border-loom-accent/50 bg-loom-accent/15 text-loom-text"
            : "border-transparent text-loom-muted hover:text-loom-text hover:border-loom-border hover:bg-loom-elevated/80"
        }
      `}
    >
      {children}
    </button>
  );
}

export function IconRefresh() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9A7 7 0 0119 8.5M18.5 15A7 7 0 015 15.5" />
    </svg>
  );
}

export function IconSave() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3v6H9V3M9 21v-8h6v8" />
    </svg>
  );
}

export function IconDataTable() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path strokeLinecap="round" d="M3 9h18M3 14h18M9 9v11M15 9v11" />
    </svg>
  );
}

export function IconWhy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 17h.01M10.5 9.5a1.5 1.5 0 112.4 1.2c-.5.4-.9.7-.9 1.3V13" />
    </svg>
  );
}

export function IconEditTitle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

/** Move / resize canvas chrome (title, legend, plot). */
export function IconArrange() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  );
}

type ChartCellRailProps = {
  orientation?: "vertical" | "horizontal";
  children: ReactNode;
};

export function ChartCellRail({ orientation = "vertical", children }: ChartCellRailProps) {
  return (
    <div
      role="toolbar"
      aria-label="Chart cell actions"
      className={`
        self-start shrink-0 flex gap-0.5 p-1 rounded-lg border border-loom-border/80 w-auto
        bg-[color-mix(in_srgb,var(--loom-surface)_92%,transparent)] backdrop-blur-md
        shadow-[0_1px_0_color-mix(in_srgb,var(--loom-border)_55%,transparent),0_8px_24px_-12px_rgba(0,0,0,0.35)]
        ${orientation === "vertical" ? "flex-col items-stretch" : "flex-row items-center"}
      `}
    >
      {children}
    </div>
  );
}
