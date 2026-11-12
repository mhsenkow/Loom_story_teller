/** A compact, keyboard-accessible explanation of the values actually drawn. */
"use client";
import type { ChartReading as Reading } from "@/lib/chartReading";
import type { HitTarget } from "@/lib/chartTooltip";

export function ChartReading({ reading, onShow, onTable, isPinned = () => false }: {
  reading: Reading;
  onShow: (hit: HitTarget) => void;
  onTable: () => void;
  isPinned?: (hit: HitTarget) => boolean;
}) {
  return (
    <details className="loom-chart-reading group shrink-0 border-b border-loom-border bg-loom-surface text-loom-text max-h-[40%] overflow-auto">
      <summary className="cursor-pointer px-3 py-2 text-xs leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-loom-accent">
        <span className="font-semibold text-loom-accent mr-2">At a glance</span>
        <span>{reading.headline}</span>
      </summary>
      <div className="px-3 pb-3 space-y-2.5">
        <p className="text-xs leading-relaxed text-loom-muted">{reading.guide}</p>
        <div className="flex flex-wrap gap-2">
          {reading.facts.map((fact, index) => (
            <button key={`${fact.title}-${index}`} type="button" onClick={() => onShow(fact.hit)}
              className="flex-1 min-w-[8rem] text-left rounded-lg border border-loom-border bg-loom-elevated px-3 py-2 hover:border-loom-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-loom-accent"
              aria-pressed={isPinned(fact.hit)}
              aria-label={`${isPinned(fact.hit) ? "Unpin" : "Pin"} ${fact.title.toLowerCase()}: ${fact.label}, ${fact.value}`}>
              <span className="block text-2xs text-loom-muted">{fact.title}</span>
              <span className="block text-lg font-semibold tabular-nums leading-snug">{fact.value}</span>
              <span className="block text-xs break-words">{fact.label}</span>
              <span className="block mt-1 text-2xs text-loom-accent">{isPinned(fact.hit) ? "Pinned · tap to remove" : "Pin on chart"}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <p className="text-2xs text-loom-muted leading-relaxed flex-1 min-w-[12rem]">{reading.context}</p>
          <button type="button" onClick={onTable} className="loom-btn-ghost text-xs min-h-9 px-3">See the numbers</button>
        </div>
      </div>
    </details>
  );
}
