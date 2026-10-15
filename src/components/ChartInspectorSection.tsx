"use client";

// Consistent disclosures for a compact, keyboard-accessible visual inspector.
import { useId, type ReactNode } from "react";

export function ChartInspectorSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="space-y-2 border-t border-loom-border/60 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center justify-between min-h-9 text-2xs font-semibold text-loom-muted uppercase tracking-wide hover:text-loom-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-loom-accent rounded"
      >
        <span>{title}</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div id={id} className="space-y-2.5">
          {children}
        </div>
      )}
    </section>
  );
}
