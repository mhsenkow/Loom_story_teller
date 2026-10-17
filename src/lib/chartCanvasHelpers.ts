// =================================================================
// chartCanvasHelpers — shared canvas helpers extracted from ChartView (LOOM-143)
// =================================================================

import { chartFont, chartTypeRamp } from "./chartType";

type AxisFontOpts = { axisFontSize?: number; fontFamily?: string };

export function axisFontCss(opts: AxisFontOpts | undefined, size?: number): string {
  const type = chartTypeRamp(opts?.axisFontSize);
  return chartFont(size == null ? type.tick : Math.max(type.mark, size), opts?.fontFamily);
}

export function widestText(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  font: string,
): number {
  ctx.save();
  ctx.font = font;
  let w = 0;
  for (const lab of labels) {
    w = Math.max(w, ctx.measureText(lab).width);
  }
  ctx.restore();
  return w;
}
