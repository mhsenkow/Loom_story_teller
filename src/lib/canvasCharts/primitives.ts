// =================================================================
// Mark drawing primitives, smart overlays and grid helpers shared by every renderer.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { drawChartGrid, drawChartTicks } from "../chartLooks";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { refLineColor, smartOverlayPalette } from "../chartSmartOverlayStyle";
import { type SmartResults } from "../store";
import { drawMarkerPath } from "../chartMarks";

export function drawShape(ctx: CanvasRenderingContext2D, shape: string, cx: number, cy: number, r: number) {
  drawMarkerPath(ctx, shape, cx, cy, r);
}

export interface PointVisualOverrides {
  alpha?: number;
  glow?: number;   // 0 = off, >0 = blur amount
  stroke?: boolean;
  strokeWidth?: number;
}

export function drawMark(
  ctx: CanvasRenderingContext2D,
  shape: string,
  cx: number,
  cy: number,
  r: number,
  fillColor: string,
  alpha: number,
  opts?: ChartRenderOpts,
  pointOverrides?: PointVisualOverrides,
) {
  const useAlpha = pointOverrides?.alpha ?? alpha;
  const useGlow = pointOverrides?.glow !== undefined
    ? pointOverrides.glow > 0
    : (opts?.glowEnabled ?? false);
  const useGlowInt = pointOverrides?.glow !== undefined && pointOverrides.glow > 0
    ? pointOverrides.glow
    : (opts?.glowIntensity ?? 8);
  const useStroke = pointOverrides?.stroke !== undefined
    ? pointOverrides.stroke
    : (opts?.markStroke ?? false);
  const useStrokeWidth = pointOverrides?.strokeWidth ?? opts?.markStrokeWidth ?? 1;

  if (useGlow) {
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = useGlowInt;
  }
  ctx.beginPath();
  drawShape(ctx, shape, cx, cy, r);
  ctx.fillStyle = fillColor;
  ctx.globalAlpha = useAlpha;
  if (shape === "ring") {
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = Math.max(1, r * 0.4);
    ctx.stroke();
  } else {
    ctx.fill();
  }
  if (useStroke && shape !== "ring") {
    ctx.strokeStyle = opts?.markStrokeColor === "auto" || !opts?.markStrokeColor ? fillColor : opts.markStrokeColor;
    ctx.lineWidth = useStrokeWidth;
    ctx.globalAlpha = Math.min(1, useAlpha + 0.2);
    ctx.stroke();
  }
  if (useGlow) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
}

export function drawEmojiMark(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  cx: number,
  cy: number,
  r: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${Math.max(8, r * 2.35)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, cx, cy + r * 0.05);
  ctx.restore();
}

// --- Jitter helper (deterministic per point index) ---
export function jitterUnit(idx: number): number {
  let h = (idx * 2654435761) | 0;
  h = ((h >>> 0) % 10000) / 10000;
  return h * 2 - 1;
}
export function jitter(idx: number, amount: number): number {
  if (amount <= 0) return 0;
  return jitterUnit(idx) * amount;
}

// --- Smart overlays (anomaly, forecast, trend, reference lines) ---
export function drawSmartOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  rows: unknown[][],
  columns: string[],
  xIdx: number,
  yIdx: number,
  activeChart: { kind: string; xField: string; yField: string | null },
  smartResults: SmartResults | null,
  ropts?: ChartRenderOpts,
  overlayPalette?: ReturnType<typeof smartOverlayPalette>,
) {
  if (!smartResults || yIdx < 0 || xIdx < 0 || !rows.length) return;
  const palette = overlayPalette ?? smartOverlayPalette({ bg: "#0a0a0c", text: "#fff", muted: "#888", label: "#aaa", border: "#333", accent: "#6a5ce0" }, false);
  const xMap = ropts?.scales?.x;
  const yMap = ropts?.scales?.y;
  if (!xMap || !yMap) return;
  const toSx = (x: number) => xMap(x);
  const toSy = (y: number) => yMap(y);
  const rowSource = ropts?.rowSourceIndices;

  // Anomaly: ring around anomalous points
  if (smartResults.anomaly?.rowIndices.length) {
    const set = new Set(smartResults.anomaly.rowIndices);
    ctx.strokeStyle = palette.anomaly;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    rows.forEach((r, ri) => {
      const sampleIdx = rowSource?.[ri] ?? ri;
      const x = Number(r[xIdx]);
      const y = Number(r[yIdx]);
      if (!isNaN(x) && !isNaN(y) && set.has(sampleIdx)) {
        ctx.beginPath();
        ctx.arc(toSx(x), toSy(y), 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    ctx.setLineDash([]);
  }

  // Trend line
  if (smartResults.trend?.points.length === 2 && activeChart.kind === "scatter") {
    const [p0, p1] = smartResults.trend.points;
    ctx.strokeStyle = palette.trend;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(toSx(p0.x), toSy(p0.y));
    ctx.lineTo(toSx(p1.x), toSy(p1.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Forecast line
  if (smartResults.forecast?.points.length && (activeChart.kind === "scatter" || activeChart.kind === "line")) {
    const pts = smartResults.forecast.points;
    ctx.strokeStyle = palette.forecast;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(toSx(pts[0]!.x), toSy(pts[0]!.y));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(toSx(pts[i]!.x), toSy(pts[i]!.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.forecastFill;
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(toSx(p.x), toSy(p.y), 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Reference lines
  if (smartResults.referenceLines?.lines.length) {
    const { axis, lines } = smartResults.referenceLines;
    lines.forEach((line) => {
      const v = line.value;
      ctx.strokeStyle = refLineColor(palette, line.type);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      if (axis === "x") {
        const sx = toSx(v);
        ctx.moveTo(sx, pad);
        ctx.lineTo(sx, h - pad);
      } else {
        const sy = toSy(v);
        ctx.moveTo(pad, sy);
        ctx.lineTo(w - pad, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
  }
}

// --- Line dash helper ---
export function applyLineDash(ctx: CanvasRenderingContext2D, style?: string) {
  switch (style) {
    case "dashed": ctx.setLineDash([8, 4]); break;
    case "dotted": ctx.setLineDash([2, 3]); break;
    default: ctx.setLineDash([]); break;
  }
}

// --- Monotone cubic interpolation (Fritsch–Carlson) ---
// Smooth, but never overshoots the data: no dips below zero or false peaks between points.
export function drawSmoothLine(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return;
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  if (n === 2) {
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
    return;
  }
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x || 1e-6);
    slope.push((pts[i + 1]!.y - pts[i]!.y) / dx[i]!);
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    if (a * b <= 0) m.push(0);
    else {
      // Weighted harmonic mean keeps the curve inside each segment's range
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      m.push((w1 + w2) / (w1 / a + w2 / b));
    }
  }
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = dx[i]! / 3;
    ctx.bezierCurveTo(p0.x + h, p0.y + m[i]! * h, p1.x - h, p1.y - m[i + 1]! * h, p1.x, p1.y);
  }
}

export function numRange(rows: unknown[][], idx: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const r of rows) { const v = Number(r[idx]); if (!isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); } }
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

/** Normalize a column to 0–1 for encoding (numeric: min-max, nominal: category index / count). */
export function encodingNorm(rows: unknown[][], idx: number): (row: unknown[]) => number {
  const firstNum = rows.some(r => typeof r[idx] === "number" || !isNaN(Number(r[idx])));
  if (firstNum) {
    const [min, max] = numRange(rows, idx);
    const range = max - min || 1;
    return (row: unknown[]) => {
      const v = Number(row[idx]);
      return isNaN(v) ? 0.5 : (v - min) / range;
    };
  }
  const catMap = new Map<string, number>();
  let next = 0;
  for (const r of rows) {
    const k = String(r[idx]);
    if (!catMap.has(k)) catMap.set(k, next++);
  }
  const n = catMap.size;
  return (row: unknown[]) => {
    const k = String(row[idx]);
    const i = catMap.get(k) ?? 0;
    return n <= 1 ? 1 : i / (n - 1);
  };
}

export function drawGridLines(ctx: CanvasRenderingContext2D, xMin: number, xMax: number, yMin: number, yMax: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  drawChartGrid(ctx, w, h, pad, opts, { x: [xMin, xMax], y: [yMin, yMax] });
}

export function drawAxisTicks(ctx: CanvasRenderingContext2D, xMin: number, xMax: number, yMin: number, yMax: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  drawChartTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
}

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}
