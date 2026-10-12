// =================================================================
// ChartTooltipCard — hover / glass / dock / compact tooltip chrome
// =================================================================
// Shared readout for canvas + scatter tips. Presentation comes from
// resolveTooltipPresentation (Encoding → Tooltip mode).
// =================================================================

"use client";

import type { ChartTooltipPresentation } from "@/lib/chartTooltipMode";

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
}: {
  tip: ChartTooltipPayload;
  presentation: ChartTooltipPresentation;
  link?: { field: string; value: string } | null;
  onDismiss?: () => void;
  /** Chart stage bounds — used to dock / glass relative to the plot. */
  stageRect?: DOMRect | null;
}) {
  if (presentation === "off") return null;

  const rows = tip.columns.slice(0, presentation === "compact" ? 3 : 10);
  const more = tip.columns.length - rows.length;

  const body = (
    <>
      <div
        className={
          presentation === "compact"
            ? "flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            : "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 items-baseline"
        }
      >
        {rows.map((col, i) => (
          <div key={`${col}-${i}`} className={presentation === "compact" ? "contents" : "contents"}>
            {presentation === "compact" ? (
              <span className="text-2xs">
                <span className="text-loom-muted">{col} </span>
                <span className={`font-mono ${i === 0 ? "font-semibold text-loom-text" : "text-loom-text"}`}>
                  {String(tip.row[i] ?? "—")}
                </span>
                {i < rows.length - 1 ? <span className="text-loom-border mx-0.5">·</span> : null}
              </span>
            ) : (
              <>
                <span className="text-loom-muted text-2xs">{col}</span>
                <span className={`font-mono break-words min-w-0 ${i === 0 ? "font-semibold" : ""}`}>
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
          className="text-2xs text-loom-accent border-t border-loom-border/60 mt-1.5 pt-1 truncate"
          title={`Filter: ${link.field} = ${link.value}`}
        >
          Link: {link.field}={link.value}
        </div>
      )}
    </>
  );

  if (presentation === "dock") {
    const left = stageRect ? stageRect.left + 8 : 8;
    const width = stageRect ? Math.max(160, stageRect.width - 16) : undefined;
    const bottom = stageRect ? Math.max(8, window.innerHeight - stageRect.bottom + 8) : 12;
    return (
      <div
        className="fixed z-[100] px-3 py-2 text-xs rounded-lg border border-loom-border/80 bg-loom-surface/95 text-loom-text shadow-lg backdrop-blur-md"
        style={{ left, bottom, width, maxWidth: width ?? 480 }}
        role="status"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{body}</div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 text-loom-muted hover:text-loom-text text-sm leading-none px-1"
              aria-label="Dismiss tooltip"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  if (presentation === "glass") {
    const left = stageRect ? stageRect.left + stageRect.width / 2 : tip.clientX;
    const top = stageRect ? stageRect.top + stageRect.height * 0.62 : tip.clientY;
    return (
      <div
        className="fixed z-[100] px-3.5 py-2.5 text-xs rounded-xl border border-white/20 text-loom-text shadow-2xl pointer-events-auto max-w-[min(320px,92vw)]"
        style={{
          left,
          top,
          transform: "translate(-50%, -50%)",
          background: "color-mix(in srgb, var(--loom-surface) 72%, transparent)",
          backdropFilter: "blur(16px) saturate(1.2)",
          WebkitBackdropFilter: "blur(16px) saturate(1.2)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
        role="status"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{body}</div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 text-loom-muted hover:text-loom-text text-sm leading-none px-1"
              aria-label="Dismiss tooltip"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  // hover + compact — follow pointer, flip near edges
  const maxW = presentation === "compact" ? 240 : 280;
  const left =
    tip.clientX + maxW + 16 > window.innerWidth ? Math.max(8, tip.clientX - maxW - 12) : tip.clientX + 12;
  const approxH = presentation === "compact" ? 36 : 16 + 18 * Math.min(9, tip.columns.length);
  const top =
    tip.clientY + approxH + 16 > window.innerHeight
      ? Math.max(8, tip.clientY - approxH - 8)
      : tip.clientY + 12;

  return (
    <div
      className={`fixed z-[100] text-loom-text shadow-lg pointer-events-none ${
        presentation === "compact"
          ? "px-2 py-1 text-2xs rounded-full border border-loom-border/70 bg-loom-surface/95 backdrop-blur-sm max-w-[240px]"
          : "px-2.5 py-2 text-xs rounded-md border border-loom-border bg-loom-surface max-w-[280px]"
      }`}
      style={{ left, top }}
      role="status"
    >
      {body}
    </div>
  );
}
