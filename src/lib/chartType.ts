// =================================================================
// Loom — Chart type ramp (legibility scale for canvas text)
// =================================================================
// One base size → consistent title / tick / legend / footnote / mark
// steps. Defaults favor reading at arm’s length on laptop + phone.
// Logical sizes here are CSS px; social/export capture scales backing
// store via stage pixelRatio — do not shrink type to fit dense charts.
// =================================================================

import { chartFontStack } from "./fontCatalog";

/** Fallback axis/label ink when theme tokens weren’t passed (mid-gray that works on dark + light better than #6b6b78). */
export const CHART_LABEL_FALLBACK = "#8a8a96";

/** Fallback primary text (near-white; themes should override). */
export const CHART_TEXT_FALLBACK = "#ececf1";

export const MIN_CHART_LABEL_SIZE = 11;
export const DEFAULT_CHART_AXIS_SIZE = 12;

/** Compact layouts keep a smaller default, but must honor an explicit larger size. */
export function resolveChartAxisFontSize(size?: number | null, compact = false): number {
  const requested = size != null && Number.isFinite(size) ? size : compact ? 11 : DEFAULT_CHART_AXIS_SIZE;
  return Math.max(MIN_CHART_LABEL_SIZE, Math.min(16, requested));
}

export type ChartTypeRamp = {
  /** Resolved base (tick) size after compact floor. */
  base: number;
  title: number;
  titleSlab: number;
  titleCompact: number;
  subtitle: number;
  tick: number;
  axisField: number;
  legend: number;
  legendTitle: number;
  footnote: number;
  footnoteMeta: number;
  mark: number;
  cell: number;
  /** CSS font-size floor used in gutters / layout. */
  layoutFloor: number;
};

/**
 * Build a type ramp from the Visual → Axis font size control.
 * Crowded charts thin labels rather than shrinking their type.
 */
export function chartTypeRamp(
  axisFontSize?: number | null,
  opts?: { compact?: boolean },
): ChartTypeRamp {
  const base = resolveChartAxisFontSize(axisFontSize, opts?.compact);

  return {
    base,
    title: Math.round(base * 1.4),
    titleSlab: Math.round(base * 1.7),
    titleCompact: Math.max(12, Math.round(base * 1.15)),
    subtitle: Math.max(11, base - 1),
    tick: base,
    axisField: base,
    legend: base,
    legendTitle: base,
    footnote: Math.max(11, base - 1),
    footnoteMeta: Math.max(11, base - 2),
    mark: Math.max(11, base - 1),
    cell: base,
    layoutFloor: base,
  };
}

/** Canvas `font` shorthand for a ramp step. */
export function chartFont(
  size: number,
  fontFamily?: string | null,
  weight: number | string = 400,
  style: "normal" | "italic" = "normal",
): string {
  const fam = fontFamily?.trim() || "Inter";
  const st = style === "italic" ? "italic " : "";
  const readableSize = Number.isFinite(size) ? Math.max(MIN_CHART_LABEL_SIZE, size) : MIN_CHART_LABEL_SIZE;
  return `${st}${weight} ${readableSize}px ${chartFontStack(fam)}`;
}

export { fitTextWrap } from "./chartText";
