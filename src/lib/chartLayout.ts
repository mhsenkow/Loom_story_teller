// =================================================================
// Loom — Chart plot insets (title / axes / frame → usable pad)
// =================================================================
// Canvas renderers take a single edge pad. Titles and axis labels must
// live inside that margin so marks never collide with chrome.
// =================================================================

import type { ChartKind } from "./recommendations";

const NON_CARTESIAN = new Set<ChartKind>([
  "pie", "treemap", "sunburst", "forceBubble", "sankey", "radar", "choropleth",
]);

/** Bottom of title band (px from canvas top) for each title layout. */
export function titleBandBottom(layout?: string): number {
  switch (layout) {
    case "ticket":
      return 58;
    case "slab":
      return 48;
    case "stack":
    case "spine":
      return 56;
    case "caption":
      return 48;
    default:
      return 52; // pair — title + subtitle with breathing room
  }
}

/** Whether the title block looks better centered on the canvas. */
export function titlePreferCenter(layout?: string): boolean {
  return layout === "pair" || layout === "slab" || layout === "caption" || !layout;
}

export function isCartesianKind(kind: ChartKind): boolean {
  return !NON_CARTESIAN.has(kind);
}

export type ChartMargins = { top: number; right: number; bottom: number; left: number };

/**
 * Per-side gutters so titles, ticks, axis names, and legends don’t collide.
 * Uniform `resolveChartPad` uses the max side for mark renderers that still
 * expect a single inset (keeps the plot optically centered).
 */
export function resolveChartMargins(args: {
  kind: ChartKind;
  width: number;
  height: number;
  basePad: number;
  titleLayout?: string;
  tickRotation?: number;
  chartFrame?: string;
  isCompact?: boolean;
  legendPosition?: string | null;
  axisFontSize?: number;
}): ChartMargins {
  const {
    kind,
    width,
    height,
    basePad,
    titleLayout,
    tickRotation = 0,
    chartFrame = "focus",
    isCompact = false,
    legendPosition,
    axisFontSize = 10,
  } = args;

  let base = basePad;
  if (chartFrame === "hero") base = Math.max(base, 56);
  if (chartFrame === "compact") base = Math.min(Math.max(base, 40), 46);
  if (isCompact) base = Math.min(Math.max(base, 36), 40);

  const cartesian = isCartesianKind(kind);
  const fs = Math.max(8, axisFontSize);
  const rot = Math.abs(tickRotation);
  // Tick stubs + label + axis field name below / beside the plot
  const tickBand = fs + 6;
  const fieldBand = fs + 4;
  const rotExtra = rot > 0 ? Math.sin((rot * Math.PI) / 180) * fs * 4.5 + 10 : 0;

  let top = Math.max(base, titleBandBottom(titleLayout) + 4);
  let bottom = cartesian
    ? Math.max(base * 0.85, 14 + tickBand + fieldBand + rotExtra)
    : Math.max(base * 0.55, 20);
  let left = cartesian
    ? Math.max(base * 0.9, 18 + tickBand + fieldBand + 4)
    : Math.max(base * 0.55, 20);
  let right = Math.max(base * 0.55, cartesian ? 20 : 18);

  // Legend floats inside the plot; only nudge when it would crowd the edge
  if (legendPosition === "right" || legendPosition === "top-right") {
    right = Math.max(right, 28);
  }
  if (legendPosition === "bottom") {
    bottom = Math.max(bottom, 14 + tickBand + fieldBand + 8);
  }

  // Keep a usable plot (≥40% of short side); shrink gutters proportionally if needed
  const short = Math.min(width, height);
  if (short > 0) {
    const minPlot = short * 0.4;
    const hPad = left + right;
    const vPad = top + bottom;
    if (width - hPad < minPlot && hPad > 0) {
      const scale = Math.max(0.55, (width - minPlot) / hPad);
      left = Math.max(28, Math.floor(left * scale));
      right = Math.max(16, Math.floor(right * scale));
    }
    if (height - vPad < minPlot && vPad > 0) {
      const scale = Math.max(0.55, (height - minPlot) / vPad);
      top = Math.max(32, Math.floor(top * scale));
      bottom = Math.max(28, Math.floor(bottom * scale));
    }
  }

  return {
    top: Math.round(Math.max(32, top)),
    right: Math.round(Math.max(16, right)),
    bottom: Math.round(Math.max(28, bottom)),
    left: Math.round(Math.max(28, left)),
  };
}

/**
 * Resolve a single edge pad that clears title + axis chrome while keeping
 * a usable plot. Prefer `resolveChartMargins` for chrome; this max-side
 * value keeps mark renderers centered and collision-free.
 */
export function resolveChartPad(args: {
  kind: ChartKind;
  width: number;
  height: number;
  basePad: number;
  titleLayout?: string;
  tickRotation?: number;
  chartFrame?: string;
  isCompact?: boolean;
  legendPosition?: string | null;
  axisFontSize?: number;
}): number {
  const m = resolveChartMargins(args);
  // Balanced inset: bias toward the larger gutters so labels never clip,
  // but don't let a fat left margin empty the whole right side.
  const pad = Math.max(
    Math.ceil((m.left + m.right) / 2 + Math.abs(m.left - m.right) * 0.35),
    Math.ceil((m.top + m.bottom) / 2 + Math.abs(m.top - m.bottom) * 0.35),
    m.top * 0.92,
    m.bottom * 0.92,
    m.left * 0.92,
  );
  return Math.round(Math.max(32, pad));
}

/** Ellipsize text to fit a max width (mutates nothing; needs a ctx with font set). */
export function fitTextEllipsis(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 8 || !text) return text;
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ell : text.slice(0, lo) + ell;
}

/**
 * Density-aware mark radii + opacity for scatter / bubble.
 * Caps total painted area so 10k+ points don't become opaque blobs.
 */
export function densityAwarePointMarks(args: {
  n: number;
  plotW: number;
  plotH: number;
  hasSizeEncoding?: boolean;
  sizeScale?: number;
  /** Base radius hint from Visual → Point size (default ~12 → ~3px). */
  pointSize?: number;
  opacity?: number;
  /** When false, opacity is auto-lowered for dense plots. */
  opacityUserSet?: boolean;
}): {
  minR: number;
  maxR: number;
  opacity: number;
  thinned: boolean;
  drawStroke: boolean;
} {
  const {
    n,
    plotW,
    plotH,
    hasSizeEncoding = false,
    sizeScale = 1,
    pointSize = 12,
    opacity,
    opacityUserSet = false,
  } = args;

  const plotArea = Math.max(1, plotW * plotH);
  const short = Math.max(1, Math.min(plotW, plotH));
  const count = Math.max(1, n);

  // Target fraction of plot covered by all mark disks combined
  const targetFill =
    count >= 12000 ? 0.05 :
    count >= 6000 ? 0.07 :
    count >= 2500 ? 0.11 :
    count >= 1000 ? 0.16 :
    count >= 400 ? 0.22 :
    0.3;

  const avgR = Math.sqrt((targetFill * plotArea) / (Math.PI * count));
  const hardCap =
    short * (
      count >= 8000 ? 0.01 :
      count >= 3000 ? 0.016 :
      count >= 1200 ? 0.024 :
      0.038
    );

  const sizeMul = Math.max(0.35, Math.min(2.5, sizeScale)) * (pointSize / 12);
  let maxR = Math.min(hardCap, avgR * (hasSizeEncoding ? 2.2 : 1.3)) * sizeMul;
  const minR = hasSizeEncoding
    ? Math.max(0.6, Math.min(avgR * 0.35, maxR * 0.4)) * sizeMul
    : Math.max(0.6, Math.min(avgR, maxR)) * sizeMul;

  maxR = Math.max(minR + 0.35, Math.min(maxR, short * 0.035 * sizeMul));

  const autoOpacity =
    count >= 12000 ? 0.16 :
    count >= 6000 ? 0.24 :
    count >= 2500 ? 0.35 :
    count >= 1000 ? 0.48 :
    0.65;

  const thinned = count >= 800;
  const resolvedOpacity = opacityUserSet && opacity != null
    ? opacity
    : Math.min(opacity ?? autoOpacity, autoOpacity);

  return {
    minR,
    maxR,
    opacity: resolvedOpacity,
    thinned,
    drawStroke: count < 1200 && maxR >= 2.5,
  };
}

/**
 * Stride-sample rows for dense overviews. Zoom scale raises the budget
 * (scale²) so zooming in reveals more points without a full reload.
 */
export function subsampleRowsForDensity<T>(
  rows: T[],
  maxPoints = 3500,
  zoomScale = 1,
): { rows: T[]; sampled: boolean; shown: number; total: number } {
  const total = rows.length;
  const budget = Math.min(
    total,
    Math.round(maxPoints * Math.min(6, Math.max(1, zoomScale * zoomScale))),
  );
  if (total <= budget) {
    return { rows, sampled: false, shown: total, total };
  }
  const stride = total / budget;
  const out: T[] = new Array(budget);
  for (let i = 0; i < budget; i++) {
    out[i] = rows[Math.min(total - 1, Math.floor(i * stride + 0.5))]!;
  }
  return { rows: out, sampled: true, shown: budget, total };
}

/** Title baseline Y positions that stay inside the top pad band. */
export function titlePositions(pad: number, layout?: string): { titleY: number; subtitleY: number; ticketH: number } {
  const band = Math.min(pad - 8, titleBandBottom(layout));
  // Sit titles in the upper third of the band with even subtitle spacing
  switch (layout) {
    case "slab":
      return { titleY: Math.min(30, band * 0.55), subtitleY: 0, ticketH: 0 };
    case "ticket":
      return {
        titleY: Math.min(24, band * 0.42),
        subtitleY: Math.min(40, band - 8),
        ticketH: Math.min(38, band - 10),
      };
    case "stack":
    case "spine":
      return {
        titleY: Math.min(22, band * 0.38),
        subtitleY: Math.min(40, band - 10),
        ticketH: 0,
      };
    case "caption":
      return {
        titleY: Math.min(20, band * 0.36),
        subtitleY: Math.min(36, band - 10),
        ticketH: 0,
      };
    default:
      return {
        titleY: Math.min(26, band * 0.42),
        subtitleY: Math.min(44, band - 8),
        ticketH: 0,
      };
  }
}

/** Pick black or white ink for labels drawn on a fill color. */
export function contrastingInk(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#ffffff";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#1a1a1a" : "#ffffff";
}

/** Soften or deepen a theme bg for radial chart atmospheres. */
export function blendToward(hex: string, amount: number, toward: "black" | "white"): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const target = toward === "white" ? 255 : 0;
  const mix = (c: number) => Math.round(c + (target - c) * amount);
  const r = mix(parseInt(m[1], 16));
  const g = mix(parseInt(m[2], 16));
  const b = mix(parseInt(m[3], 16));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function isLightHex(hex: string): boolean {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}
