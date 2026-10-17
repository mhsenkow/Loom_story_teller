// Shared space policy: the host owns the frame, text owns its necessary gutters.
import { resolveChartMargins } from "./chartLayout";
import type { ChartVisualOverrides } from "./chartVisualTypes";

export type ChartSpaceUse = NonNullable<ChartVisualOverrides["spaceUse"]>;

export function chartStageGutter(space: ChartSpaceUse = "auto"): number {
  return space === "fill" ? 4 : space === "roomy" ? 20 : 8;
}

export function chartSpacePadding(space: ChartSpaceUse = "auto", width: number, requested?: number, frame = "focus"): number {
  // An explicit padding slider value takes precedence at every width.
  if (requested != null && Number.isFinite(requested)) return requested;
  const base = space === "fill" ? 28 : space === "roomy" ? 64 : 44;
  // Keep Fill < Auto < Roomy on narrow stages; a shared cap made Auto and Roomy identical.
  if (width < 400) return Math.min(base, space === "fill" ? 20 : space === "roomy" ? 40 : 28);
  if (width < 600) return Math.min(base, space === "fill" ? 24 : space === "roomy" ? 52 : 36);
  return frame === "hero" && space !== "fill" ? Math.max(56, base) : frame === "compact" ? Math.min(40, base) : base;
}

/** Cartesian renderers with a portable plot rect can spend each gutter independently. */
export function automaticPlotBounds(args: Parameters<typeof resolveChartMargins>[0], space: ChartSpaceUse = "auto") {
  if (!["bar", "histogram", "line", "area"].includes(args.kind)) return undefined;
  const m = resolveChartMargins(args);
  const fs = Math.max(11, args.axisFontSize ?? 12);
  const extra = space === "roomy" ? 16 : 0;
  const left = Math.max(m.left, fs * 4 + 12) + extra;
  const right = Math.max(16, m.right) + extra;
  return {
    left: Math.min(left, args.width * 0.4),
    right: Math.max(args.width - right, args.width * 0.6),
    top: m.top,
    bottom: args.height - m.bottom,
  };
}
