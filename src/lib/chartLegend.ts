// =================================================================
// Floating chart legend (Canvas overlay + 2D charts)
// =================================================================

import { fitTextEllipsis } from "./chartLayout";
import type { ChartChromeLayout } from "./chartChromeLink";

export function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function buildCategoricalLegendEntries(
  rows: unknown[][],
  cIdx: number,
  colors: string[],
): { label: string; color: string }[] | null {
  if (cIdx < 0) return null;
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[cIdx]);
    if (!seen.has(k)) seen.set(k, seen.size);
  }
  if (seen.size <= 1) return null;
  return [...seen.entries()].map(([label, i]) => ({ label, color: colors[i % colors.length]! }));
}

export function drawLegend(
  ctx: CanvasRenderingContext2D,
  entries: { label: string; color: string }[],
  position: string,
  w: number,
  h: number,
  pad: number,
  fontFamily: string,
  themeBg = "#111114",
  themeBorder = "#2a2a30",
  themeText = "#e8e8ec",
  title?: string,
): ChartChromeLayout["legend"] {
  if (position === "none" || entries.length === 0) return null;
  const maxRows = 10;
  const shown = entries.slice(0, maxRows);
  const extra = entries.length - shown.length;
  const font = `11px '${fontFamily}', system-ui, sans-serif`;
  const titleFont = `600 11px '${fontFamily}', system-ui, sans-serif`;
  const lineH = 18;
  const sw = 10;
  const maxText = Math.min(170, Math.max(60, (w - 2 * pad) * 0.32));
  ctx.save();
  ctx.font = font;
  let textW = Math.max(...shown.map((e) => ctx.measureText(e.label).width), extra > 0 ? ctx.measureText(`+${extra} more`).width : 0);
  if (title) {
    ctx.font = titleFont;
    textW = Math.max(textW, ctx.measureText(title).width);
  }
  textW = Math.min(maxText, textW);
  const legendW = Math.ceil(10 + sw + 6 + textW + 10);
  const rowsN = shown.length + (extra > 0 ? 1 : 0) + (title ? 1 : 0);
  const legendH = rowsN * lineH + 10;

  const inset = 8;
  const corners: Record<string, [number, number]> = {
    "top-right": [w - pad - legendW - inset, pad + inset],
    "top-left": [pad + inset, pad + inset],
    "bottom-right": [w - pad - legendW - inset, h - pad - legendH - inset],
    "bottom-left": [pad + inset, h - pad - legendH - inset],
    right: [w - pad - legendW - inset, Math.round(pad + (h - 2 * pad - legendH) / 2)],
    bottom: [Math.round((w - legendW) / 2), h - pad - legendH - inset],
  };
  let [lx, ly] = corners[position] ?? corners["top-right"]!;
  if (position === "auto") {
    const dpr = ctx.getTransform().a || 1;
    let best = Infinity;
    for (const key of ["top-right", "top-left", "bottom-right", "bottom-left"]) {
      const [cx, cy] = corners[key]!;
      try {
        const img = ctx.getImageData(Math.max(0, cx * dpr), Math.max(0, cy * dpr), Math.max(1, legendW * dpr), Math.max(1, legendH * dpr));
        const d = img.data;
        const bg = themeBg.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        const [br, bgc, bb] = bg ? [parseInt(bg[1]!, 16), parseInt(bg[2]!, 16), parseInt(bg[3]!, 16)] : [0, 0, 0];
        let ink = 0;
        for (let i = 0; i < d.length; i += 16) {
          if (d[i + 3]! < 16) continue;
          if (Math.abs(d[i]! - br) + Math.abs(d[i + 1]! - bgc) + Math.abs(d[i + 2]! - bb) > 60) ink++;
        }
        if (ink < best - 2) {
          best = ink;
          lx = cx;
          ly = cy;
        }
      } catch {
        break;
      }
    }
  }
  lx = Math.max(4, Math.min(w - legendW - 4, lx));
  ly = Math.max(4, Math.min(h - legendH - 4, ly));

  ctx.globalAlpha = 0.92;
  ctx.fillStyle = themeBg;
  ctx.strokeStyle = themeBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedBox(ctx, lx, ly, legendW, legendH, 5);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let ey = ly + 5 + lineH / 2;
  if (title) {
    ctx.font = titleFont;
    ctx.fillStyle = themeText;
    ctx.fillText(fitTextEllipsis(ctx, title, legendW - 20), lx + 10, ey);
    ey += lineH;
  }
  ctx.font = font;
  for (const e of shown) {
    ctx.fillStyle = e.color;
    ctx.beginPath();
    roundedBox(ctx, lx + 10, ey - sw / 2, sw, sw, 2);
    ctx.fill();
    ctx.fillStyle = themeText;
    ctx.fillText(fitTextEllipsis(ctx, e.label, textW), lx + 10 + sw + 6, ey);
    ey += lineH;
  }
  if (extra > 0) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = themeText;
    ctx.fillText(`+${extra} more`, lx + 10 + sw + 6, ey);
  }
  const rect = { x: lx, y: ly, w: legendW, h: legendH };
  ctx.restore();
  return rect;
}
