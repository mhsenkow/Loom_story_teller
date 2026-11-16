// Paint an already-built area path. Geometry and hit targets are unchanged.
// Never use on density/color-mapped cells: their lightness encodes a value.
import type { ChartRenderOpts } from "../chartRenderTypes";
import { withAlpha } from "../chartInk";

export function fillMaterialPath(ctx: CanvasRenderingContext2D, top: number, bottom: number, opts?: Pick<ChartRenderOpts, "markMaterial" | "themeText" | "themeBorder" | "lineJoin" | "lineWidth">) {
  ctx.fill();
  const material = opts?.markMaterial ?? "flat";
  if (material === "flat" || bottom <= top) return;
  ctx.save();
  const ink = opts?.themeText ?? opts?.themeBorder ?? "#808080";
  ctx.lineJoin = opts?.lineJoin ?? "round";

  if (material === "glaze") {
    const wash = ctx.createLinearGradient(0, top, 0, bottom);
    wash.addColorStop(0, "rgba(255,255,255,0.18)");
    wash.addColorStop(0.35, "rgba(255,255,255,0.05)");
    wash.addColorStop(0.72, "rgba(255,255,255,0)");
    wash.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.strokeStyle = withAlpha(ink, 0.1);
    ctx.lineWidth = 0.5;
    ctx.stroke();
  } else if (material === "satin") {
    const wash = ctx.createLinearGradient(0, top, 0, bottom);
    wash.addColorStop(0, "rgba(255,255,255,0)");
    wash.addColorStop(0.38, "rgba(255,255,255,0.07)");
    wash.addColorStop(0.55, "rgba(255,255,255,0.02)");
    wash.addColorStop(1, "rgba(0,0,0,0.04)");
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.strokeStyle = withAlpha(ink, 0.08);
    ctx.lineWidth = 0.4;
    ctx.stroke();
  } else if (material === "ink") {
    ctx.strokeStyle = withAlpha(ink, 0.32);
    ctx.lineWidth = Math.max(0.6, Math.min(1.6, (opts?.lineWidth ?? 1.5) * 0.45));
    ctx.stroke();
  } else if (material === "etched") {
    ctx.strokeStyle = withAlpha(ink, 0.14);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.clip();
    ctx.strokeStyle = withAlpha(ink, 0.2);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
}
