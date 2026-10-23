"use client";

// Shared Discover-style filter menu: a sentence word that opens facet chips.
import { useEffect, useRef, type ReactNode } from "react";

export function toggleFilter<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 text-2xs px-2 py-0.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded-full border transition-colors ${
        on
          ? "border-loom-accent bg-loom-accent/15 text-loom-accent"
          : "border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterMenu({
  label,
  value,
  active,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      ref={ref}
      className="library-filter-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={`${label}: ${value}`} data-active={active || undefined}>
        <span>{value}</span>
        <span aria-hidden>⌄</span>
      </summary>
      <div className="library-filter-options" role="group" aria-label={label}>
        {children}
      </div>
    </details>
  );
}
