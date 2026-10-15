// =================================================================
// EncodingInfoTip — compact ⓘ for Encoding help (replaces long paragraphs)
// =================================================================

"use client";

import { useEffect, useId, useRef, useState } from "react";

export function EncodingInfoTip({
  text,
  label = "More about this control",
}: {
  text: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        className="grid size-5 place-items-center rounded text-loom-muted hover:text-loom-text hover:bg-loom-elevated border border-transparent hover:border-loom-border/80 text-[10px] font-semibold leading-none"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        title={text}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        i
      </button>
      {open && (
        <span
          id={tipId}
          role="note"
          className="absolute z-30 left-0 top-full mt-1 w-[min(16rem,calc(100vw-2rem))] rounded-md border border-loom-border bg-loom-surface px-2.5 py-2 text-2xs text-loom-muted leading-snug shadow-loom-md"
        >
          {text}
        </span>
      )}
    </span>
  );
}
