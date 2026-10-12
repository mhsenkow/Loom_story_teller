// =================================================================
// chartCanvasHelpers — shared canvas helpers extracted from ChartView (LOOM-143)
// =================================================================

type AxisFontOpts = { axisFontSize?: number; fontFamily?: string };

export function axisFontCss(opts: AxisFontOpts | undefined, size?: number): string {
  const floor = Math.max(10, opts?.axisFontSize ?? 11);
  const px = size ?? floor;
  const family = opts?.fontFamily ?? "system-ui, sans-serif";
  return `${px}px ${family}`;
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
