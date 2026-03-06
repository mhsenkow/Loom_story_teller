// =================================================================
// ChartCard — Mini Preview Thumbnail
// =================================================================
// Renders a small Canvas 2D preview of a chart recommendation.
// Click to promote it to the full-size chart view.
// =================================================================

"use client";

import { useEffect, useRef, useCallback } from "react";
import type { ChartRecommendation } from "@/lib/recommendations";
import type { QueryResult } from "@/lib/store";

const COLORS = ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"];

const KIND_LABELS: Record<string, string> = {
  scatter: "Scatter",
  bar: "Bar",
  histogram: "Histogram",
  line: "Line",
  heatmap: "Heatmap",
  strip: "Strip",
  box: "Box",
  area: "Area",
  pie: "Pie",
};

export function ChartCard({
  rec,
  data,
  isActive,
  onClick,
}: {
  rec: ChartRecommendation;
  data: QueryResult | null;
  isActive: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const container = containerRef.current;
    const width = container?.offsetWidth ?? canvas.getBoundingClientRect().width;
    const height = container?.offsetHeight ?? canvas.getBoundingClientRect().height;
    if (width <= 0 || height <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const w = width;
    const h = height;
    const pad = 6;

    ctx.clearRect(0, 0, w, h);

    const xIdx = data.columns.indexOf(rec.xField);
    const yIdx = rec.yField ? data.columns.indexOf(rec.yField) : -1;
    const cIdx = rec.colorField ? data.columns.indexOf(rec.colorField) : -1;

    if (xIdx === -1) return;

    const rows = data.rows.slice(0, 300);

    if (rec.kind === "scatter" && yIdx >= 0) {
      drawScatter(ctx, rows, xIdx, yIdx, cIdx, w, h, pad);
    } else if (rec.kind === "bar") {
      drawBar(ctx, rows, xIdx, yIdx, w, h, pad);
    } else if (rec.kind === "histogram") {
      drawHistogram(ctx, rows, xIdx, w, h, pad);
    } else if (rec.kind === "line" && yIdx >= 0) {
      drawLine(ctx, rows, xIdx, yIdx, cIdx, w, h, pad);
    } else if (rec.kind === "heatmap" && yIdx >= 0) {
      drawHeatmap(ctx, rows, xIdx, yIdx, w, h, pad);
    } else if (rec.kind === "strip" && yIdx >= 0) {
      drawStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad);
    } else if (rec.kind === "box" && yIdx >= 0) {
      drawBox(ctx, rows, xIdx, yIdx, w, h, pad);
    } else if (rec.kind === "area" && yIdx >= 0) {
      drawArea(ctx, rows, xIdx, yIdx, cIdx, w, h, pad);
    } else if (rec.kind === "pie") {
      drawPie(ctx, rows, xIdx, yIdx, w, h, pad);
    }
  }, [rec, data]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <button
      onClick={onClick}
      className={`
        group flex flex-col rounded-lg overflow-hidden transition-all duration-150
        border bg-loom-elevated hover:border-loom-accent
        ${isActive ? "border-loom-accent ring-1 ring-loom-accent/40" : "border-loom-border"}
      `}
    >
      <div ref={containerRef} className="relative w-full aspect-[4/3] min-h-[80px] bg-loom-bg">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2 text-left">
        <div className="flex items-center gap-1.5">
          <span className={`
            inline-block px-1.5 py-0.5 text-2xs font-mono font-semibold rounded
            ${kindColor(rec.kind)}
          `}>
            {KIND_LABELS[rec.kind] ?? rec.kind}
          </span>
        </div>
        <p className="text-xs font-medium text-loom-text truncate leading-tight">{rec.title}</p>
        <p className="text-2xs text-loom-muted truncate">{rec.subtitle}</p>
      </div>
    </button>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case "scatter": return "bg-[#6c5ce7]/20 text-[#a29bfe]";
    case "bar": return "bg-[#00d68f]/20 text-[#00d68f]";
    case "histogram": return "bg-[#00b4d8]/20 text-[#00b4d8]";
    case "line": return "bg-[#ff6b6b]/20 text-[#ff6b6b]";
    case "heatmap": return "bg-[#ffd93d]/20 text-[#ffd93d]";
    case "strip": return "bg-[#e77c5c]/20 text-[#e77c5c]";
    case "box": return "bg-[#a29bfe]/20 text-[#a29bfe]";
    case "area": return "bg-[#74b9ff]/20 text-[#74b9ff]";
    case "pie": return "bg-[#e77c5c]/20 text-[#e77c5c]";
    default: return "bg-loom-muted/20 text-loom-muted";
  }
}

// --- Mini renderers (simple, fast, no labels) ---

function numericRange(rows: unknown[][], idx: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const r of rows) {
    const v = Number(r[idx]);
    if (!isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

function drawScatter(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number) {
  const [xMin, xMax] = numericRange(rows, xi);
  const [yMin, yMax] = numericRange(rows, yi);
  const catMap = new Map<string, number>();
  let nextCat = 0;

  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (isNaN(x) || isNaN(y)) continue;
    let cat = 0;
    if (ci >= 0) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, nextCat++);
      cat = catMap.get(k)!;
    }
    const sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
    ctx.beginPath();
    ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[cat % COLORS.length];
    ctx.globalAlpha = 0.6;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBar(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number) {
  const groups = new Map<string, number>();
  const isCount = yi < 0;
  for (const r of rows) {
    const k = String(r[xi]);
    if (isCount) {
      groups.set(k, (groups.get(k) ?? 0) + 1);
    } else {
      const v = Number(r[yi]);
      if (isNaN(v)) continue;
      groups.set(k, (groups.get(k) ?? 0) + v);
    }
  }
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (entries.length === 0) return;
  const maxVal = Math.max(...entries.map(e => e[1]), 1);
  const barW = Math.max(2, (w - 2 * pad) / entries.length - 2);

  entries.forEach(([, val], i) => {
    const barH = (val / maxVal) * (h - 2 * pad);
    const x = pad + i * ((w - 2 * pad) / entries.length);
    ctx.fillStyle = COLORS[0];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, h - pad - barH, barW, barH);
  });
  ctx.globalAlpha = 1;
}

function drawHistogram(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, w: number, h: number, pad: number) {
  const [min, max] = numericRange(rows, xi);
  const bins = 20;
  const counts = new Array(bins).fill(0);
  for (const r of rows) {
    const v = Number(r[xi]);
    if (isNaN(v)) continue;
    const b = Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins));
    counts[b]++;
  }
  const maxC = Math.max(...counts, 1);
  const barW = (w - 2 * pad) / bins;

  counts.forEach((c, i) => {
    const barH = (c / maxC) * (h - 2 * pad);
    ctx.fillStyle = COLORS[1];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(pad + i * barW, h - pad - barH, barW - 1, barH);
  });
  ctx.globalAlpha = 1;
}

function drawLine(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number) {
  const [yMin, yMax] = numericRange(rows, yi);
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));
  const n = sorted.length;

  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COLORS[3];
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const y = Number(sorted[i][yi]);
    if (isNaN(y)) continue;
    const sx = pad + (i / Math.max(n - 1, 1)) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
    i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawHeatmap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number) {
  const xLabels = [...new Set(rows.map(r => String(r[xi])))].slice(0, 12);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 12);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = `${r[xi]}|${r[yi]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const maxC = Math.max(...counts.values(), 1);
  const cellW = (w - 2 * pad) / xLabels.length;
  const cellH = (h - 2 * pad) / yLabels.length;

  xLabels.forEach((xL, xi2) => {
    yLabels.forEach((yL, yi2) => {
      const c = counts.get(`${xL}|${yL}`) ?? 0;
      const intensity = c / maxC;
      ctx.fillStyle = `rgba(108, 92, 231, ${0.1 + intensity * 0.85})`;
      ctx.fillRect(pad + xi2 * cellW, pad + yi2 * cellH, cellW - 1, cellH - 1);
    });
  });
}

function drawStrip(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number) {
  const [xMin, xMax] = numericRange(rows, xi);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 12);
  const bandH = (h - 2 * pad) / yLabels.length;

  for (const r of rows) {
    const x = Number(r[xi]);
    if (isNaN(x)) continue;
    const yIdx = yLabels.indexOf(String(r[yi]));
    if (yIdx < 0) continue;
    const sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const sy = pad + yIdx * bandH + bandH / 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bandH * 0.3);
    ctx.lineTo(sx, sy + bandH * 0.3);
    ctx.strokeStyle = COLORS[yIdx % COLORS.length];
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function quartiles(sorted: number[]): { q1: number; q2: number; q3: number } {
  const n = sorted.length;
  if (n === 0) return { q1: 0, q2: 0, q3: 0 };
  const q2 = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const lo = sorted.slice(0, Math.floor(n / 2));
  const hi = sorted.slice(Math.ceil(n / 2));
  const q1 = lo.length % 2 === 1 ? lo[(lo.length - 1) / 2]! : (lo[lo.length / 2 - 1]! + lo[lo.length / 2]!) / 2;
  const q3 = hi.length % 2 === 1 ? hi[(hi.length - 1) / 2]! : (hi[hi.length / 2 - 1]! + hi[hi.length / 2]!) / 2;
  return { q1, q2, q3 };
}

function drawBox(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r[yi]);
    if (isNaN(v)) continue;
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const entries = [...groups.entries()].slice(0, 8).map(([label, vals]) => {
    const s = [...vals].sort((a, b) => a - b);
    return { label, ...quartiles(s), min: s[0] ?? 0, max: s[s.length - 1] ?? 0 };
  });
  if (entries.length === 0) return;
  const allVals = entries.flatMap(e => [e.min, e.max]);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const boxW = Math.max(2, (w - 2 * pad) / entries.length - 2);
  const plotH = h - 2 * pad;

  entries.forEach((box, i) => {
    const cx = pad + (i + 0.5) * ((w - 2 * pad) / entries.length);
    const toY = (v: number) => h - pad - ((v - min) / range) * plotH;
    ctx.fillStyle = COLORS[2];
    ctx.globalAlpha = 0.6;
    ctx.fillRect(cx - boxW / 2, toY(box.q3), boxW, toY(box.q1) - toY(box.q3));
    ctx.strokeStyle = "#6b6b78";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cx - boxW / 2, toY(box.q3), boxW, toY(box.q1) - toY(box.q3));
    ctx.beginPath();
    ctx.moveTo(cx, toY(box.min)); ctx.lineTo(cx, toY(box.q1));
    ctx.moveTo(cx, toY(box.q3)); ctx.lineTo(cx, toY(box.max));
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawArea(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number) {
  const [yMin, yMax] = numericRange(rows, yi);
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));
  const range = yMax - yMin || 1;

  if (ci >= 0) {
    const groups = new Map<string, typeof sorted>();
    for (const r of sorted) {
      const k = String(r[ci]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    let stackBase = 0;
    [...groups.entries()].slice(0, 4).forEach(([, gRows], j) => {
      ctx.fillStyle = COLORS[j % COLORS.length];
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      gRows.forEach((r, i) => {
        const y = Number(r[yi]);
        if (isNaN(y)) return;
        const sx = pad + (i / Math.max(gRows.length - 1, 1)) * (w - 2 * pad);
        const sy = h - pad - ((stackBase + y - yMin) / range) * (h - 2 * pad);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      });
      stackBase += gRows.reduce((s, r) => s + (Number(r[yi]) || 0), 0) / Math.max(gRows.length, 1);
      ctx.lineTo(w - pad, h - pad);
      ctx.lineTo(pad, h - pad);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    ctx.fillStyle = COLORS[0];
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    sorted.forEach((r, i) => {
      const y = Number(r[yi]);
      if (isNaN(y)) return;
      const sx = pad + (i / Math.max(sorted.length - 1, 1)) * (w - 2 * pad);
      const sy = h - pad - ((y - yMin) / range) * (h - 2 * pad);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPie(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number) {
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 1 : v));
  }
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return;
  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w, h) / 2 - pad;
  let start = -Math.PI / 2;
  entries.forEach(([, val], i) => {
    const sweep = (val / total) * Math.PI * 2;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.closePath();
    ctx.fill();
    start += sweep;
  });
  ctx.globalAlpha = 1;
}
