// =================================================================
// ChartTooltipCard — hover / glass / dock / compact tooltip chrome
// =================================================================
// Shared readout for canvas + scatter tips. Presentation comes from
// resolveTooltipPresentation (Encoding → Tooltip mode).
// =================================================================

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { chartTooltipLayout } from "@/lib/chartTooltipLayout";
import type { ChartTooltipPresentation } from "@/lib/chartTooltipMode";
import { chartFontStack } from "@/lib/fontCatalog";
import { resolveChartAxisFontSize } from "@/lib/chartType";

export type ChartTooltipPayload = {
  clientX: number;
  clientY: number;
  rowIndex: number;
  row: (string | number | boolean | null)[];
  columns: string[];
};

export function ChartTooltipCard({
  tip,
  presentation,
  link,
  onDismiss,
  stageRect,
  fontFamily,
  axisFontSize,
  pinned = false,
  onPin,
  markPinned = false,
  announce = true,
}: {
  tip: ChartTooltipPayload;
  presentation: ChartTooltipPresentation;
  link?: { field: string; value: string } | null;
  onDismiss?: () => void;
  /** Chart stage bounds — used to dock / glass relative to the plot. */
  stageRect?: DOMRect | null;
  fontFamily?: string;
  axisFontSize?: number;
  pinned?: boolean;
  /** Pin / unpin the mark this readout describes (touch + sheet presentations). */
  onPin?: () => void;
  /** The described mark is already pinned (button reads “Unpin”). */
  markPinned?: boolean;
  /** Speak updates as a live status; off when the host announces (e.g. keyboard steps) itself. */
  announce?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));
  useLayoutEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      const next = node.getBoundingClientRect().height;
      setHeight((previous) => previous === next ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [tip.row, tip.columns, presentation, fontFamily, axisFontSize, pinned, viewport.width]);
  if (presentation === "off") return null;

  const rows = tip.columns.slice(0, presentation === "compact" ? 3 : 10);
  const more = tip.columns.length - rows.length;
  const typeStyle = { fontFamily: chartFontStack(fontFamily), fontSize: resolveChartAxisFontSize(axisFontSize), lineHeight: 1.5 };

  const body = (
    <>
      <div
        className={
          presentation === "compact"
            ? "flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            : "grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1 items-baseline"
        }
      >
        {rows.map((col, i) => (
          <div key={`${col}-${i}`} className="contents">
            {presentation === "compact" ? (
              <span className="text-xs [overflow-wrap:anywhere]">
                <span className="text-loom-label">{col} </span>
                <span className={`tabular-nums ${i === 0 ? "font-semibold text-loom-text" : "text-loom-text"}`}>
                  {String(tip.row[i] ?? "—")}
                </span>
                {i < rows.length - 1 ? <span className="text-loom-border mx-0.5">·</span> : null}
              </span>
            ) : (
              <>
                <span className="text-loom-label text-xs [overflow-wrap:anywhere] min-w-0">{col}</span>
                <span className={`tabular-nums [overflow-wrap:anywhere] min-w-0 ${i === 0 ? "font-semibold" : ""}`}>
                  {String(tip.row[i] ?? "—")}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      {more > 0 && <div className="text-loom-muted text-2xs mt-1">+{more} more</div>}
      {link && (
        <div
          className="text-2xs text-loom-accent border-t border-loom-border/60 mt-1.5 pt-1 [overflow-wrap:anywhere]"
          title={`Filter: ${link.field} = ${link.value}`}
        >
          Link: {link.field}={link.value}
        </div>
      )}
    </>
  );

  const interactive = pinned || presentation === "glass" || presentation === "dock";
  const layout = chartTooltipLayout({
    presentation,
    x: tip.clientX,
    y: tip.clientY,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    height: height || 24 + typeStyle.fontSize * 2.5 * rows.length,
    stage: stageRect,
  });
  return (
    <div
      ref={root}
      className={`loom-chart-tooltip fixed z-[100] text-loom-text shadow-lg border ${interactive ? "pointer-events-auto" : "pointer-events-none"} ${
        presentation === "glass"
          ? "px-3.5 py-2.5 rounded-xl border-loom-border/80 bg-loom-surface/95 backdrop-blur-xl"
          : presentation === "compact"
            ? "px-2 py-1 rounded-lg border-loom-border/70 bg-loom-surface/95 backdrop-blur-sm"
            : `px-2.5 py-2 rounded-md bg-loom-surface ${pinned ? "border-loom-accent/60" : "border-loom-border"}`
      }`}
      style={{ ...typeStyle, ...layout, boxSizing: "border-box", overflowY: "auto", overscrollBehavior: "contain" }}
      role={pinned ? "group" : announce ? "status" : undefined}
      aria-label={pinned ? "Pinned chart values" : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{body}</div>
        {interactive && onPin && (
          <button
            type="button"
            onClick={onPin}
            className="shrink-0 min-h-8 px-2 -mt-1 text-2xs font-medium rounded border border-loom-accent/50 text-loom-accent hover:bg-loom-accent/10 focus-visible:outline focus-visible:outline-loom-accent"
            aria-pressed={markPinned}
            title={markPinned ? "Unpin this readout" : "Keep this readout on the chart (and in exports / links)"}
          >
            {markPinned ? "Unpin" : "Pin"}
          </button>
        )}
        {interactive && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            onKeyDown={pinned ? (event) => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(); } } : undefined}
            className="shrink-0 min-w-8 min-h-8 -mr-1 -mt-1 text-loom-label hover:text-loom-text rounded focus-visible:outline focus-visible:outline-loom-accent"
            aria-label={pinned ? "Dismiss pinned tooltip" : "Dismiss tooltip"}
            title={pinned ? "Dismiss pinned tooltip (Esc)" : "Dismiss tooltip"}
          >×</button>
        )}
      </div>
    </div>
  );
}
