// Paint an already-built area path. Geometry and hit targets are unchanged.
// Never use on density/color-mapped cells: their lightness encodes a value.
import type { ChartRenderOpts } from "../chartRenderTypes";
import { withAlpha } from "../chartInk";

export function fillMaterialPath(ctx: CanvasRenderingContext2D, top: number, bottom: number, opts?: Pick<ChartRenderOpts, "markMaterial" | "themeText" | "themeBorder" | "lineJoin">) {
  ctx.fill();
  const material = opts?.markMaterial ?? "flat";
  if (material === "flat" || bottom <= top) return;
  ctx.save();
  if (material === "glaze" || material === "satin") {
    const wash = ctx.createLinearGradient(0, top, 0, bottom);
    wash.addColorStop(0, material === "glaze" ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)");
    wash.addColorStop(0.48, "rgba(255,255,255,0)");
    wash.addColorStop(1, "rgba(0,0,0,0.035)");
    ctx.fillStyle = wash;
    ctx.fill();
  }
  // A subpixel edge, not a shadow that exaggerates area or obscures small gaps.
  ctx.strokeStyle = withAlpha(opts?.themeText ?? opts?.themeBorder ?? "#808080", material === "ink" ? 0.22 : 0.12);
  ctx.lineWidth = material === "etched" ? 0.8 : 0.5;
  ctx.lineJoin = opts?.lineJoin ?? "round";
  ctx.stroke();
  ctx.restore();
}
