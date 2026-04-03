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
import { getPaletteColors } from "@/lib/chartPalettes";
import { buildBarFacetGrid } from "@/lib/chartTooltip";
import type { YAggregateOption } from "@/lib/recommendations";
import { useLoomStore } from "@/lib/store";

const FALLBACK_COLORS = ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"];

const KIND_LABELS: Record<string, string> = {
  scatter: "Scatter",
  bubble: "Bubble",
  bar: "Bar",
  lollipop: "Lollipop",
  histogram: "Histogram",
  line: "Line",
  heatmap: "Heatmap",
  strip: "Strip",
  violin: "Violin",
  box: "Box",
  area: "Area",
  pie: "Pie",
  radar: "Radar",
  waterfall: "Waterfall",
  treemap: "Treemap",
  sunburst: "Sunburst",
  choropleth: "Choropleth",
  forceBubble: "Force Bubble",
  sankey: "Sankey",
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
  const theme = useLoomStore((s) => s.appSettings.theme);
  const colors = getPaletteColors("theme");
  const COLORS = colors.length >= 8 ? colors : FALLBACK_COLORS;
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
      drawScatter(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "bar") {
      drawBar(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "histogram") {
      drawHistogram(ctx, rows, xIdx, w, h, pad, COLORS);
    } else if (rec.kind === "line" && yIdx >= 0) {
      drawLine(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "heatmap" && yIdx >= 0) {
      drawHeatmap(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "strip" && yIdx >= 0) {
      drawStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "box" && yIdx >= 0) {
      drawBox(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "area" && yIdx >= 0) {
      drawArea(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "pie") {
      drawPie(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "bubble" && yIdx >= 0) {
      const sizeIdx = rec.sizeField ? data.columns.indexOf(rec.sizeField) : -1;
      drawBubble(ctx, rows, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, COLORS);
    } else if (rec.kind === "violin" && yIdx >= 0) {
      drawViolin(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "radar") {
      drawRadar(ctx, rows, data.columns, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "waterfall") {
      drawWaterfall(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "lollipop") {
      drawLollipop(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "treemap") {
      drawTreemap(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "sunburst") {
      drawSunburst(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "choropleth") {
      drawChoropleth(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "forceBubble") {
      drawForceBubble(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "sankey") {
      drawSankey(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    }
  }, [rec, data, theme]);

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
    case "bubble": return "bg-[#00b4d8]/20 text-[#00b4d8]";
    case "violin": return "bg-[#a29bfe]/20 text-[#a29bfe]";
    case "radar": return "bg-[#ffd93d]/20 text-[#ffd93d]";
    case "waterfall": return "bg-[#00d68f]/20 text-[#00d68f]";
    case "lollipop": return "bg-[#ff6b6b]/20 text-[#ff6b6b]";
    case "treemap": return "bg-[#55efc4]/20 text-[#55efc4]";
    case "sunburst": return "bg-[#fd79a8]/20 text-[#fd79a8]";
    case "choropleth": return "bg-[#81ecec]/20 text-[#81ecec]";
    case "forceBubble": return "bg-[#fab1a0]/20 text-[#fab1a0]";
    case "sankey": return "bg-[#dfe6e9]/20 text-[#dfe6e9]";
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

function drawScatter(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const [xMin, xMax] = numericRange(rows, xi);
  const [yMin, yMax] = numericRange(rows, yi);
  const catMap = new Map<string, number>();
  let nextCat = 0;
  const COL = colors.length ? colors : FALLBACK_COLORS;

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
    ctx.fillStyle = COL[cat % COL.length];
    ctx.globalAlpha = 0.6;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  colors: string[],
) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const plotH = h - 2 * pad;
  const chartW = w - 2 * pad;
  const barColorIdx = ci >= 0 && ci !== xi ? ci : -1;
  const agg: YAggregateOption = yi < 0 ? "count" : "sum";
  const facet = barColorIdx >= 0 ? buildBarFacetGrid(rows, xi, yi, barColorIdx, agg, "grouped") : null;

  if (facet && facet.grid.length > 0 && facet.subLabels.length > 0) {
    const { xLabels, subLabels, grid } = facet;
    const nx = xLabels.length;
    const ns = subLabels.length;
    let maxVal = 0;
    for (let gi = 0; gi < nx; gi++) {
      for (let si = 0; si < ns; si++) {
        maxVal = Math.max(maxVal, grid[gi]![si]!);
      }
    }
    if (maxVal <= 0) return;
    const groupW = chartW / nx;
    const innerW = Math.max(1, (groupW - 4) / ns);
    for (let gi = 0; gi < nx; gi++) {
      for (let si = 0; si < ns; si++) {
        const val = grid[gi]![si]!;
        const barH = (val / maxVal) * plotH;
        const x = pad + gi * groupW + 2 + si * innerW;
        ctx.fillStyle = COL[si % COL.length];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, h - pad - barH, Math.max(1, innerW - 1), barH);
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

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
    const barH = (val / maxVal) * plotH;
    const x = pad + i * ((w - 2 * pad) / entries.length);
    ctx.fillStyle = COL[0];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, h - pad - barH, barW, barH);
  });
  ctx.globalAlpha = 1;
}

function drawHistogram(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
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
    ctx.fillStyle = COL[1];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(pad + i * barW, h - pad - barH, barW - 1, barH);
  });
  ctx.globalAlpha = 1;
}

function drawLine(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const [yMin, yMax] = numericRange(rows, yi);
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));
  const n = sorted.length;

  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COL[3];
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

function drawHeatmap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const hex = colors[0] ?? "#6c5ce7";
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const r = m ? parseInt(m[1], 16) : 108;
  const g = m ? parseInt(m[2], 16) : 92;
  const b = m ? parseInt(m[3], 16) : 231;
  const xLabels = [...new Set(rows.map(r => String(r[xi])))].slice(0, 12);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 12);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = `${row[xi]}|${row[yi]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const maxC = Math.max(...counts.values(), 1);
  const cellW = (w - 2 * pad) / xLabels.length;
  const cellH = (h - 2 * pad) / yLabels.length;

  xLabels.forEach((xL, xi2) => {
    yLabels.forEach((yL, yi2) => {
      const c = counts.get(`${xL}|${yL}`) ?? 0;
      const intensity = c / maxC;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 + intensity * 0.85})`;
      ctx.fillRect(pad + xi2 * cellW, pad + yi2 * cellH, cellW - 1, cellH - 1);
    });
  });
}

function drawStrip(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const [xMin, xMax] = numericRange(rows, xi);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 12);
  const bandH = (h - 2 * pad) / yLabels.length;
  const ciLabels = ci >= 0 ? [...new Set(rows.map(r => String(r[ci])))] : null;

  for (const r of rows) {
    const x = Number(r[xi]);
    if (isNaN(x)) continue;
    const yIdx = yLabels.indexOf(String(r[yi]));
    if (yIdx < 0) continue;
    const sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const sy = pad + yIdx * bandH + bandH / 2;
    const colorIdx = ciLabels && ci >= 0 ? (ciLabels.indexOf(String(r[ci])) ?? 0) : yIdx;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bandH * 0.3);
    ctx.lineTo(sx, sy + bandH * 0.3);
    ctx.strokeStyle = COL[colorIdx % COL.length];
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

function drawBox(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
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
    ctx.fillStyle = COL[2];
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

function drawArea(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
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
      ctx.fillStyle = COL[j % COL.length];
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
    ctx.fillStyle = COL[0];
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

function drawPie(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
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
    ctx.fillStyle = COL[i % COL.length];
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

function drawBubble(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, si: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const [xMin, xMax] = numericRange(rows, xi);
  const [yMin, yMax] = numericRange(rows, yi);
  const [sMin, sMax] = si >= 0 ? numericRange(rows, si) : [0, 1];
  const sRange = sMax - sMin || 1;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const minR = 2;
  const maxR = Math.min(w, h) * 0.08;
  const catMap = new Map<string, number>();
  let nextCat = 0;

  type B = { sx: number; sy: number; r: number; cat: number };
  const bubbles: B[] = [];
  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (isNaN(x) || isNaN(y)) continue;
    let cat = 0;
    if (ci >= 0) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, nextCat++);
      cat = catMap.get(k)!;
    }
    let radius = (minR + maxR) / 2;
    if (si >= 0) {
      const s = Number(r[si]);
      if (!isNaN(s)) radius = minR + Math.sqrt((s - sMin) / sRange) * (maxR - minR);
    }
    const sx = pad + ((x - xMin) / xRange) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / yRange) * (h - 2 * pad);
    bubbles.push({ sx, sy, r: radius, cat });
  }
  bubbles.sort((a, b) => b.r - a.r);
  for (const b of bubbles) {
    ctx.fillStyle = COL[b.cat % COL.length];
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = COL[b.cat % COL.length];
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawViolin(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r[yi]);
    if (isNaN(v)) continue;
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const entries = [...groups.entries()].slice(0, 8);
  if (entries.length === 0) return;
  const allVals = entries.flatMap(([, vs]) => vs);
  const gMin = Math.min(...allVals);
  const gMax = Math.max(...allVals);
  const range = gMax - gMin || 1;
  const bandW = (w - 2 * pad) / entries.length;
  const bins = 12;
  entries.forEach(([, vals], gi) => {
    const counts = new Array(bins).fill(0);
    for (const v of vals) {
      const b = Math.min(bins - 1, Math.floor(((v - gMin) / range) * bins));
      counts[b]++;
    }
    const maxC = Math.max(...counts, 1);
    const cx = pad + (gi + 0.5) * bandW;
    const halfW = bandW * 0.35;
    ctx.fillStyle = COL[gi % COL.length];
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let b = 0; b < bins; b++) {
      const y = h - pad - (b / bins) * (h - 2 * pad);
      const dx = (counts[b] / maxC) * halfW;
      b === 0 ? ctx.moveTo(cx - dx, y) : ctx.lineTo(cx - dx, y);
    }
    for (let b = bins - 1; b >= 0; b--) {
      const y = h - pad - (b / bins) * (h - 2 * pad);
      ctx.lineTo(cx + (counts[b] / maxC) * halfW, y);
    }
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawRadar(ctx: CanvasRenderingContext2D, rows: unknown[][], columnNames: string[], _xi: number, _yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  if (!rows.length || !columnNames.length) return;

  const numericAxes: number[] = [];
  for (let c = 0; c < columnNames.length; c++) {
    if (c === ci) continue;
    const sample = rows.slice(0, 20);
    const numCount = sample.filter(r => !isNaN(Number(r[c])) && r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean").length;
    if (numCount >= sample.length * 0.5) numericAxes.push(c);
  }
  if (numericAxes.length < 3) return;
  const axes = numericAxes.slice(0, 6);
  const n = axes.length;
  const ranges = axes.map(c => numericRange(rows, c));

  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w, h) / 2 - pad - 4;

  ctx.strokeStyle = "#3a3a40";
  ctx.lineWidth = 0.3;
  ctx.globalAlpha = 0.2;
  for (let ring = 1; ring <= 3; ring++) {
    const r = radius * (ring / 3);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = (Math.PI * 2 * (i % n)) / n - Math.PI / 2;
      i === 0 ? ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r) : ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    ctx.closePath();
    ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const groups = new Map<string, unknown[][]>();
  if (ci >= 0) {
    for (const r of rows) {
      const k = String(r[ci]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r as unknown[]);
    }
  } else {
    groups.set("all", rows as unknown[][]);
  }

  let gi = 0;
  for (const [, gRows] of [...groups.entries()].slice(0, 4)) {
    const means = axes.map((c, ai) => {
      const vals = gRows.map(r => Number(r[c])).filter(v => !isNaN(v));
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const [mn, mx] = ranges[ai];
      return mx === mn ? 0.5 : (avg - mn) / (mx - mn);
    });
    ctx.fillStyle = COL[gi % COL.length];
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    means.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, v) * radius;
      i === 0 ? ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r) : ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    });
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COL[gi % COL.length];
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.stroke();

    means.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, v) * radius;
      ctx.fillStyle = COL[gi % COL.length];
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    gi++;
  }
  ctx.globalAlpha = 1;
}

function drawWaterfall(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, _colors: string[]) {
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 0 : v));
  }
  const entries = [...groups.entries()].slice(0, 12);
  if (entries.length === 0) return;
  let running = 0;
  const bars: { start: number; end: number; value: number }[] = [];
  for (const [, val] of entries) {
    bars.push({ start: running, end: running + val, value: val });
    running += val;
  }
  const allY = bars.flatMap(b => [b.start, b.end]);
  const yMin = Math.min(0, ...allY);
  const yMax = Math.max(...allY);
  const range = yMax - yMin || 1;
  const barW = Math.max(3, (w - 2 * pad) / bars.length - 2);
  const toY = (v: number) => h - pad - ((v - yMin) / range) * (h - 2 * pad);
  bars.forEach((bar, i) => {
    const x = pad + i * ((w - 2 * pad) / bars.length);
    const top = Math.min(toY(bar.start), toY(bar.end));
    const bottom = Math.max(toY(bar.start), toY(bar.end));
    ctx.fillStyle = bar.value >= 0 ? "#00d68f" : "#ff6b6b";
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, top, barW, Math.max(1, bottom - top));
  });
  ctx.globalAlpha = 1;
}

function drawLollipop(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 0 : v));
  }
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return;
  const maxVal = Math.max(...entries.map(e => e[1]), 1);
  const bandH = (h - 2 * pad) / entries.length;
  entries.forEach(([, val], i) => {
    const cy = pad + (i + 0.5) * bandH;
    const endX = pad + (val / maxVal) * (w - 2 * pad);
    ctx.strokeStyle = COL[i % COL.length];
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad, cy);
    ctx.lineTo(endX, cy);
    ctx.stroke();
    ctx.fillStyle = COL[i % COL.length];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(endX, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawTreemap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, _ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, number>();
  for (const r of rows) { const k = String(r[xi]); const v = yi >= 0 ? Number(r[yi]) : 1; groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 0 : Math.abs(v))); }
  const entries = [...groups.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (entries.length === 0) return;
  type R = { x: number; y: number; w: number; h: number; idx: number };
  const rects: R[] = [];
  const layout = (items: [string, number][], x0: number, y0: number, w0: number, h0: number) => {
    if (items.length === 0 || w0 <= 0 || h0 <= 0) return;
    if (items.length === 1) { rects.push({ x: x0, y: y0, w: w0, h: h0, idx: entries.indexOf(items[0]) }); return; }
    const total = items.reduce((s, [, v]) => s + v, 0); if (total <= 0) return;
    let cum = 0, si = 0;
    for (let i = 0; i < items.length; i++) { cum += items[i][1]; if (cum >= total / 2) { si = i; break; } }
    si = Math.max(0, Math.min(items.length - 2, si));
    const left = items.slice(0, si + 1), right = items.slice(si + 1);
    const ratio = left.reduce((s, [, v]) => s + v, 0) / total;
    if (w0 >= h0) { layout(left, x0, y0, w0 * ratio, h0); layout(right, x0 + w0 * ratio, y0, w0 * (1 - ratio), h0); }
    else { layout(left, x0, y0, w0, h0 * ratio); layout(right, x0, y0 + h0 * ratio, w0, h0 * (1 - ratio)); }
  };
  layout(entries, pad, pad, w - 2 * pad, h - 2 * pad);
  for (const r of rects) { ctx.fillStyle = COL[r.idx % COL.length]; ctx.globalAlpha = 0.75; ctx.fillRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
  ctx.globalAlpha = 1;
}

function drawSunburst(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, _ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, number>();
  for (const r of rows) { const k = String(r[xi]); const v = yi >= 0 ? Number(r[yi]) : 1; groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 0 : Math.abs(v))); }
  const entries = [...groups.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (entries.length === 0) return;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const cx = w / 2, cy = h / 2, outerR = Math.min(w, h) / 2 - pad - 2, innerR = outerR * 0.4;
  let angle = -Math.PI / 2;
  entries.forEach(([, val], i) => {
    const sweep = (val / total) * Math.PI * 2;
    ctx.fillStyle = COL[i % COL.length]; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(cx, cy, outerR, angle, angle + sweep); ctx.arc(cx, cy, innerR, angle + sweep, angle, true); ctx.closePath(); ctx.fill();
    angle += sweep;
  });
  ctx.fillStyle = "#0e0e12"; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(cx, cy, innerR * 0.5, 0, Math.PI * 2); ctx.fill();
}

function drawChoropleth(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, _colors: string[]) {
  const groups = new Map<string, number>();
  for (const r of rows) { const k = String(r[xi]); const v = yi >= 0 ? Number(r[yi]) : 1; groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 0 : v)); }
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  if (entries.length === 0) return;
  const maxV = Math.max(...entries.map(([, v]) => v), 1), minV = Math.min(...entries.map(([, v]) => v), 0), range = maxV - minV || 1;
  const cols = Math.ceil(Math.sqrt(entries.length * (w / h))), rowC = Math.ceil(entries.length / cols);
  const cellW = (w - 2 * pad) / cols, cellH = (h - 2 * pad) / rowC;
  entries.forEach(([, val], i) => {
    const t = (val - minV) / range;
    ctx.fillStyle = `hsl(${220 - t * 180}, ${50 + t * 30}%, ${15 + t * 40}%)`;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(pad + (i % cols) * cellW + 0.5, pad + Math.floor(i / cols) * cellH + 0.5, cellW - 1, cellH - 1);
  });
  ctx.globalAlpha = 1;
}

function drawForceBubble(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, { val: number; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]); const v = yi >= 0 ? Number(r[yi]) : 1; const cat = ci >= 0 ? String(r[ci]) : "";
    const prev = groups.get(k);
    if (prev) prev.val += (isNaN(v) ? 0 : v); else groups.set(k, { val: isNaN(v) ? 0 : v, cat });
  }
  const entries = [...groups.entries()].map(([, g]) => g).filter(g => g.val > 0).sort((a, b) => b.val - a.val).slice(0, 20);
  if (entries.length === 0) return;
  const maxVal = Math.max(...entries.map(e => e.val));
  const catLabels = ci >= 0 ? [...new Set(entries.map(e => e.cat))] : [];
  const cx = w / 2, cy = h / 2, maxR = Math.min(w, h) / 2 - pad - 2;
  type C = { x: number; y: number; r: number; cat: string };
  const circles: C[] = entries.map(e => ({ x: cx + (Math.random() - 0.5) * 6, y: cy + (Math.random() - 0.5) * 6, r: Math.max(2, Math.sqrt(e.val / maxVal) * maxR * 0.45), cat: e.cat }));
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < circles.length; i++) {
      circles[i].x += (cx - circles[i].x) * 0.04; circles[i].y += (cy - circles[i].y) * 0.04;
      for (let j = i + 1; j < circles.length; j++) {
        const dx = circles[j].x - circles[i].x, dy = circles[j].y - circles[i].y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minD = circles[i].r + circles[j].r + 1;
        if (dist < minD) { const o = (minD - dist) / 2; circles[i].x -= (dx / dist) * o; circles[i].y -= (dy / dist) * o; circles[j].x += (dx / dist) * o; circles[j].y += (dy / dist) * o; }
      }
    }
  }
  for (const c of circles) {
    const idx = ci >= 0 ? catLabels.indexOf(c.cat) : circles.indexOf(c);
    ctx.fillStyle = COL[Math.max(0, idx) % COL.length]; ctx.globalAlpha = 0.65;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSankey(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const tIdx = ci >= 0 ? ci : yi; if (tIdx < 0) return;
  const flows = new Map<string, number>(), srcSet = new Set<string>(), tgtSet = new Set<string>();
  for (const r of rows) {
    const s = String(r[xi]), t = String(r[tIdx]), v = yi >= 0 && tIdx !== yi ? Number(r[yi]) : 1;
    const key = `${s}\0${t}`; flows.set(key, (flows.get(key) ?? 0) + (isNaN(v) ? 1 : Math.abs(v)));
    srcSet.add(s); tgtSet.add(t);
  }
  const sources = [...srcSet].slice(0, 6), targets = [...tgtSet].slice(0, 6);
  if (!sources.length || !targets.length) return;
  const sT = new Map<string, number>(), tT = new Map<string, number>();
  for (const [k, v] of flows) { const [s, t] = k.split("\0"); sT.set(s, (sT.get(s) ?? 0) + v); tT.set(t, (tT.get(t) ?? 0) + v); }
  const total = [...sT.values()].reduce((a, b) => a + b, 0) || 1;
  const lx = pad + 2, rx = w - pad - 2, plotH = h - 2 * pad, sc = plotH / total;
  let sy = pad; const sY = new Map<string, { y: number; h: number }>();
  for (const s of sources) { const sh = Math.max(2, (sT.get(s) ?? 0) * sc); sY.set(s, { y: sy, h: sh }); sy += sh + 1; }
  const totalT = [...tT.values()].reduce((a, b) => a + b, 0) || 1; const scT = plotH / totalT;
  let ty = pad; const tY = new Map<string, { y: number; h: number }>();
  for (const t of targets) { const th = Math.max(2, (tT.get(t) ?? 0) * scT); tY.set(t, { y: ty, h: th }); ty += th + 1; }
  const sO = new Map<string, number>(), tO = new Map<string, number>();
  for (const s of sources) sO.set(s, 0); for (const t of targets) tO.set(t, 0);
  for (const [k, v] of [...flows.entries()].sort((a, b) => b[1] - a[1])) {
    const [s, t] = k.split("\0"); const sr = sY.get(s), tr = tY.get(t); if (!sr || !tr) continue;
    const so = sO.get(s) ?? 0, to = tO.get(t) ?? 0, bh = Math.max(1, v * sc), bht = Math.max(1, v * scT);
    ctx.fillStyle = COL[sources.indexOf(s) % COL.length]; ctx.globalAlpha = 0.3;
    ctx.beginPath(); const mx = (lx + 3 + rx) / 2;
    ctx.moveTo(lx + 3, sr.y + so); ctx.bezierCurveTo(mx, sr.y + so, mx, tr.y + to, rx, tr.y + to);
    ctx.lineTo(rx, tr.y + to + bht); ctx.bezierCurveTo(mx, tr.y + to + bht, mx, sr.y + so + bh, lx + 3, sr.y + so + bh);
    ctx.closePath(); ctx.fill();
    sO.set(s, so + bh); tO.set(t, to + bht);
  }
  for (const [i, s] of sources.entries()) { const r = sY.get(s)!; ctx.fillStyle = COL[i % COL.length]; ctx.globalAlpha = 0.9; ctx.fillRect(lx, r.y, 3, r.h); }
  for (const [i, t] of targets.entries()) { const r = tY.get(t)!; ctx.fillStyle = COL[i % COL.length]; ctx.globalAlpha = 0.7; ctx.fillRect(rx, r.y, 3, r.h); }
  ctx.globalAlpha = 1;
}
