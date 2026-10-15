// =================================================================
// DiscoverSourceLink — tertiary “Data” chip on What’s interesting cards
// =================================================================
// Hover (or focus) shows a TLDR bubble; click opens the feed in Inspect
// (Stats) without treating the whole card as the same action.
// =================================================================

"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  discoverSourceBrief,
  type DiscoverKind,
} from "@/lib/discoverStories";

export function DiscoverSourceLink({
  kind,
  onInspect,
}: {
  kind: DiscoverKind;
  onInspect: () => void;
}) {
  const brief = discoverSourceBrief(kind);
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeave = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const show = () => {
    clearLeave();
    setOpen(true);
  };

  const hideSoon = () => {
    clearLeave();
    leaveTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => () => clearLeave(), []);

  return (
    <span
      ref={rootRef}
      className="absolute top-1.5 right-1.5 z-20"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocusCapture={show}
      onBlurCapture={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) hideSoon();
      }}
    >
      <button
        type="button"
        className="
          max-w-[5.5rem] truncate px-1.5 py-px text-[9px] uppercase tracking-wider font-medium
          rounded border border-loom-border/70 bg-loom-bg/85 text-loom-muted
          hover:text-loom-accent hover:border-loom-accent/40
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loom-accent
        "
        aria-label={`About ${brief.label} — open to inspect`}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onInspect();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        Data
      </button>
      {open && (
        <span
          id={tipId}
          role="note"
          className="
            absolute right-0 top-full mt-1 z-30 w-[min(15.5rem,calc(100vw-2rem))]
            rounded-md border border-loom-border bg-loom-surface px-2.5 py-2
            text-2xs text-loom-muted leading-snug shadow-loom-md space-y-1.5
          "
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          <span className="block text-loom-text font-medium text-xs leading-snug">{brief.label}</span>
          <span className="block">{brief.tldr}</span>
          <span className="block text-loom-label">{brief.credit}</span>
          <span className="block text-loom-accent/90 pt-0.5">Click · Inspect this feed</span>
        </span>
      )}
    </span>
  );
}
