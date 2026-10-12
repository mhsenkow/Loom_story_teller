// =================================================================
// Chart ↔ Encoding / Visual chrome linking
// =================================================================
// Hover axis gutters, title, or legend on the canvas → jump the Detail
// panel to the matching Encoding / Visual control. Hover those controls
// → outline the related chart region. Pure geometry helpers + ids.
// =================================================================

export type ChartChromeSection = "encoding" | "visual";

/** Stable ids shared by canvas hit tests and `data-chrome-target` in the panel. */
export type ChartChromeTarget =
  | "x"
  | "y"
  | "color"
  | "size"
  | "yScale"
  | "direction"
  | "title"
  | "legend"
  | "grid"
  | "marks"
  | "axes";

export interface ChartChromeFocus {
  section: ChartChromeSection;
  target: ChartChromeTarget;
  /** Panel scrolls into view only when the chart initiated the focus. */
  source: "chart" | "panel";
}

export interface ChartChromeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Actual layout from the last chart paint pass (LOOM-394). */
export interface ChartChromeLayout {
  plot: ChartChromeRect;
  title?: ChartChromeRect | null;
  legend?: ChartChromeRect | null;
  xAxis?: ChartChromeRect | null;
  yAxis?: ChartChromeRect | null;
}

function pointInRect(x: number, y: number, r: ChartChromeRect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** DOM id for DetailPanel scroll / highlight (`loom-chrome-y`). */
export function chromeDomId(target: ChartChromeTarget): string {
  return `loom-chrome-${target}`;
}

/** Default section for a target (axes → Encoding, look → Visual). */
export function chromeSectionFor(target: ChartChromeTarget): ChartChromeSection {
  switch (target) {
    case "title":
    case "legend":
    case "grid":
    case "marks":
    case "axes":
      return "visual";
    default:
      return "encoding";
  }
}

/**
 * Hit-test chart chrome (outside the plot marks). Returns null over the
 * interior plot so mark tooltips keep priority.
 */
/** Prefer layout rects from the renderer; falls back to pad heuristic. */
export function pickChartChromeRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number,
  layout?: ChartChromeLayout | null,
): ChartChromeTarget | null {
  if (layout) {
    if (layout.title && pointInRect(x, y, layout.title)) return "title";
    if (layout.legend && pointInRect(x, y, layout.legend)) return "legend";
    if (layout.yAxis && pointInRect(x, y, layout.yAxis)) return "y";
    if (layout.xAxis && pointInRect(x, y, layout.xAxis)) return "x";
    if (pointInRect(x, y, layout.plot)) return null;
    return null;
  }
  if (w <= 0 || h <= 0 || pad <= 0) return null;
  if (x < 0 || y < 0 || x > w || y > h) return null;

  const plotL = pad;
  const plotT = pad;
  const plotR = w - pad;
  const plotB = h - pad;
  const titleBand = Math.min(pad * 0.85, 48);
  const legendBox = Math.min(120, w * 0.22);

  // Title band (top of canvas)
  if (y < titleBand && x > plotL * 0.4 && x < plotR) return "title";

  // Legend pocket (upper-right outside / edge of plot)
  if (x > plotR - 8 && x <= w && y >= titleBand && y < plotT + legendBox * 0.6) return "legend";
  if (x > plotR - legendBox && x < plotR && y >= plotT && y < plotT + 28) return "legend";

  // Left Y gutter (axis title + ticks)
  if (x < plotL && y >= plotT && y <= plotB) return "y";

  // Bottom X strip
  if (y > plotB && y <= h && x >= plotL && x <= plotR) return "x";

  // Thin strip just inside plot edges → axes chrome (Visual)
  const edge = 10;
  if (
    (x >= plotL && x < plotL + edge && y >= plotT && y <= plotB) ||
    (y <= plotB && y > plotB - edge && x >= plotL && x <= plotR)
  ) {
    return "axes";
  }

  // Interior → marks (data), not chrome
  if (x >= plotL && x <= plotR && y >= plotT && y <= plotB) return null;

  return null;
}

/** Pixel rect to outline when a chrome target is focused. */
export function chromeHighlightRect(
  target: ChartChromeTarget,
  w: number,
  h: number,
  pad: number,
): ChartChromeRect | null {
  if (w <= 0 || h <= 0) return null;
  const plotL = pad;
  const plotT = pad;
  const plotR = w - pad;
  const plotB = h - pad;
  const titleBand = Math.min(pad * 0.85, 48);
  const legendBox = Math.min(120, w * 0.22);

  switch (target) {
    case "x":
      return { x: plotL, y: plotB, w: Math.max(8, plotR - plotL), h: Math.max(16, h - plotB) };
    case "y":
    case "yScale":
    case "direction":
      return { x: 0, y: plotT, w: Math.max(16, plotL), h: Math.max(8, plotB - plotT) };
    case "title":
      return { x: plotL * 0.5, y: 2, w: Math.max(40, plotR - plotL * 0.5), h: titleBand };
    case "legend":
      return {
        x: Math.max(plotL, plotR - legendBox),
        y: plotT,
        w: Math.min(legendBox, w - plotR + legendBox),
        h: Math.min(legendBox, plotB - plotT),
      };
    case "color":
      return {
        x: Math.max(plotL, plotR - legendBox),
        y: plotT,
        w: Math.min(legendBox + 8, w - plotL),
        h: 36,
      };
    case "size":
    case "marks":
      return {
        x: plotL + 8,
        y: plotT + 8,
        w: Math.max(24, plotR - plotL - 16),
        h: Math.max(24, plotB - plotT - 16),
      };
    case "grid":
      return { x: plotL, y: plotT, w: Math.max(8, plotR - plotL), h: Math.max(8, plotB - plotT) };
    case "axes":
      return { x: plotL - 2, y: plotT - 2, w: plotR - plotL + 4, h: plotB - plotT + 4 };
    default:
      return null;
  }
}
