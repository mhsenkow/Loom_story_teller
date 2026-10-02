// =================================================================
// ChartCard — Mini Preview Thumbnail
// =================================================================
// Renders a small Canvas 2D preview of a chart recommendation.
// Click to promote it to the full-size chart view.
// =================================================================

"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import type { ChartRecommendation } from "@/lib/recommendations";
import type { QueryResult } from "@/lib/store";
import {
  contrastingInk,
  discreteSeriesColors,
  getThemeUiColors,
  resolveChartColors,
  sampleContinuous,
  VIZ_SEMANTIC,
  type ThemeUiColors,
} from "@/lib/chartPalettes";
import { buildBarFacetGrid } from "@/lib/chartTooltip";
import type { YAggregateOption } from "@/lib/recommendations";
import { useLoomStore } from "@/lib/store";
import { densityAwarePointMarks } from "@/lib/chartLayout";
import { isOddChartKind, renderOddChart, ODD_CHART_KIND_OPTIONS } from "@/lib/oddCharts";
import { isGpuSceneKind, extractGpuScenePoints, renderGpuSceneCanvas, GPU_SCENE_KIND_OPTIONS } from "@/lib/gpuScenes";
import { buildDataCube, renderDataCubeCanvas } from "@/lib/dataCube";
import { isGeoFamilyKind, isGeoMapKind, renderGeoMapCanvas, GEO_MAP_KIND_OPTIONS } from "@/lib/geoMaps";

const FALLBACK_COLORS = discreteSeriesColors(resolveChartColors({ paletteId: "categorical" }), 8);

const KIND_LABELS: Record<string, string> = {
  scatter: "Scatter",
  bubble: "Bubble",
  hexbin: "Hexbin",
  bar: "Bar",
  lollipop: "Lollipop",
  dumbbell: "Dumbbell",
  histogram: "Histogram",
  line: "Line",
  heatmap: "Heatmap",
  strip: "Strip",
  violin: "Violin",
  ridgeline: "Ridgeline",
  box: "Box",
  area: "Area",
  pie: "Pie",
  funnel: "Funnel",
  radar: "Radar",
  parallel: "Parallel",
  waterfall: "Waterfall",
  treemap: "Treemap",
  sunburst: "Sunburst",
  choropleth: "Choropleth",
  forceBubble: "Force Bubble",
  sankey: "Sankey",
  ...Object.fromEntries(ODD_CHART_KIND_OPTIONS.map((o) => [o.value, o.label])),
  ...Object.fromEntries(GPU_SCENE_KIND_OPTIONS.map((o) => [o.value, o.label])),
  ...Object.fromEntries(GEO_MAP_KIND_OPTIONS.map((o) => [o.value, o.label])),
};

export function ChartCard({
  rec,
  data,
  isActive,
  onClick,
  compact = false,
  hero = false,
}: {
  rec: ChartRecommendation;
  data: QueryResult | null;
  isActive: boolean;
  onClick: () => void;
  /** Narrow fixed-width card for mobile horizontal rails */
  compact?: boolean;
  /** Large preview for deep-scan swipe deck */
  hero?: boolean;
}) {
  const theme = useLoomStore((s) => s.appSettings.theme);
  const colorblind = useLoomStore((s) => s.appSettings.colorblindCharts);
  const { COLORS, SEQ, ui } = useMemo(() => {
    const resolved = resolveChartColors({
      paletteId: "auto",
      theme,
      colorblind: !!colorblind,
      chartKind: rec.kind,
    });
    const colors = resolved.continuous
      ? resolved.colors
      : discreteSeriesColors(resolved, 8);
    const themeUi = getThemeUiColors(theme);
    // Magnitude ramp (heatmap / hexbin / density maps). Oriented so the
    // densest cells carry the most contrast against the card background:
    // dark→light on dark themes, light→dark on light themes.
    const seqBase = resolved.continuous
      ? resolved.colors
      : resolveChartColors({ paletteId: "auto", theme, colorblind: !!colorblind, chartKind: "heatmap" }).colors;
    const bgIsLight = contrastingInk(themeUi.bg) !== "#ffffff";
    return {
      COLORS: colors.length >= 4 ? colors : FALLBACK_COLORS,
      SEQ: bgIsLight ? [...seqBase].reverse() : seqBase,
      ui: themeUi,
    };
  }, [theme, colorblind, rec.kind]);
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
      drawHeatmap(ctx, rows, xIdx, yIdx, w, h, pad, SEQ);
    } else if (rec.kind === "strip" && yIdx >= 0) {
      drawStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "box" && yIdx >= 0) {
      drawBox(ctx, rows, xIdx, yIdx, w, h, pad, COLORS, ui);
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
      drawRadar(ctx, rows, data.columns, xIdx, yIdx, cIdx, w, h, pad, COLORS, ui);
    } else if (rec.kind === "waterfall") {
      drawWaterfall(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "lollipop") {
      drawLollipop(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "dumbbell" && yIdx >= 0) {
      const sizeIdx = rec.sizeField ? data.columns.indexOf(rec.sizeField) : -1;
      if (sizeIdx >= 0) drawDumbbell(ctx, rows, xIdx, yIdx, sizeIdx, w, h, pad, COLORS);
    } else if (rec.kind === "ridgeline" && yIdx >= 0) {
      drawRidgeline(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "hexbin" && yIdx >= 0) {
      drawHexbin(ctx, rows, xIdx, yIdx, w, h, pad, SEQ);
    } else if (rec.kind === "funnel") {
      drawFunnel(ctx, rows, xIdx, yIdx, w, h, pad, COLORS);
    } else if (rec.kind === "parallel") {
      drawParallel(ctx, rows, data.columns, cIdx, w, h, pad, COLORS, ui);
    } else if (rec.kind === "treemap") {
      drawTreemap(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "sunburst") {
      drawSunburst(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS, ui);
    } else if (rec.kind === "forceBubble") {
      drawForceBubble(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (rec.kind === "sankey") {
      drawSankey(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, COLORS);
    } else if (isGeoFamilyKind(rec.kind)) {
      const geoKind = rec.kind === "choropleth" ? "choropleth" as const : rec.kind;
      if (geoKind === "choropleth" || isGeoMapKind(geoKind)) {
        renderGeoMapCanvas(
          geoKind,
          ctx,
          rows,
          data.columns,
          {
            xField: rec.xField,
            yField: rec.yField,
            colorField: rec.colorField,
            sizeField: rec.sizeField,
          },
          w,
          h,
          pad,
          {
            colors: COLORS,
            opacity: 0.85,
            // Thumbnail scale: bigger marks so a handful of points still reads
            pointSize: 3.2,
            mini: true,
            // Let the card's themed background show through (the renderer
            // otherwise paints a hard-coded near-black fill).
            themeBg: "rgba(0,0,0,0)",
            themeText: ui.text,
            themeBorder: ui.border,
            themeMuted: ui.muted,
            continuousStops: SEQ,
          },
        );
      }
    } else if (rec.kind === "dataCube") {
      const cube = buildDataCube(rows, data.columns, {
        xField: rec.xField,
        yField: rec.yField,
        zField: rec.zField,
        valueField: rec.sizeField,
        aggregate: rec.yAggregate,
      });
      if (cube) {
        const ui = getThemeUiColors(theme);
        renderDataCubeCanvas(ctx, cube, w, h, {
          ramp: COLORS,
          opacity: 0.9,
          camera: { yaw: 0.62, pitch: 0.42, zoom: hero ? 1 : 1.12 },
          themeBg: "rgba(0,0,0,0)",
          themeText: ui.text,
          themeMuted: ui.muted,
          themeBorder: ui.border,
          mini: !hero,
          showLegend: hero,
        });
      }
    } else if (isGpuSceneKind(rec.kind)) {
      const packed = extractGpuScenePoints(rows, data.columns, {
        xField: rec.xField,
        yField: rec.yField,
        zField: rec.zField,
        colorField: rec.colorField,
        sizeField: rec.sizeField,
        timeField: rec.timeField,
        trailId: rec.trailId,
      }, 1200);
      if (packed) {
        renderGpuSceneCanvas(rec.kind, ctx, packed, w, h, pad, {
          colors: COLORS,
          opacity: 0.85,
          pointSize: 2.6,
          // Transparent so the card's themed background shows (renderer
          // default is a hard-coded near-black fill).
          themeBg: "rgba(0,0,0,0)",
          themeText: ui.text,
          themeMuted: ui.muted,
          themeBorder: ui.border,
        });
      }
    } else if (isOddChartKind(rec.kind)) {
      const sizeIdx = rec.sizeField ? data.columns.indexOf(rec.sizeField) : -1;
      renderOddChart(
        rec.kind,
        ctx,
        rows,
        data.columns,
        xIdx,
        yIdx,
        cIdx,
        sizeIdx,
        w,
        h,
        pad,
        {
          colors: COLORS,
          opacity: 0.85,
          pointSize: 2.5,
          axisLabelColor: ui.muted,
          themeText: ui.text,
          themeMuted: ui.muted,
          themeBorder: ui.border,
        },
        true,
      );
    }
  }, [rec, data, theme, hero, COLORS, SEQ, ui]);

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
      type="button"
      onClick={onClick}
      tabIndex={hero ? -1 : undefined}
      aria-hidden={hero || undefined}
      aria-pressed={hero ? undefined : isActive}
      title={hero ? undefined : rec.subtitle ? `${rec.title} — ${rec.subtitle}` : rec.title}
      className={`
        group flex flex-col overflow-hidden text-left min-w-0
        border bg-loom-elevated
        transition-[border-color,box-shadow,transform] duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loom-accent
        ${hero ? "pointer-events-none border-0 ring-0 shadow-none rounded-xl hover:border-transparent" : "rounded-lg hover:shadow-loom"}
        ${!hero && isActive ? "border-loom-accent ring-2 ring-loom-accent/40 shadow-loom" : !hero ? "border-loom-border hover:border-loom-accent/50" : ""}
        ${compact ? "w-[152px] shrink-0 snap-start rounded-md" : "w-full"}
      `}
    >
      <div
        ref={containerRef}
        className={`relative w-full bg-loom-bg ${
          hero
            ? "aspect-[4/3] min-h-[200px] sm:min-h-[260px] rounded-t-xl"
            : compact
              ? "aspect-[5/3] min-h-[72px] rounded-t-md"
              : "aspect-[4/3] min-h-[80px]"
        }`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
      <div className={`flex flex-col gap-0.5 text-left ${hero ? "px-4 py-3" : compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}>
        {(!compact || hero) && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`
              inline-block max-w-full truncate px-1.5 py-0.5 text-2xs font-mono font-semibold rounded
              ${kindColor(rec.kind)}
            `}>
              {KIND_LABELS[rec.kind] ?? rec.kind}
            </span>
            {!hero && isActive && (
              <span className="ml-auto shrink-0 text-2xs font-medium text-loom-accent">Showing</span>
            )}
          </div>
        )}
        <p className={`font-medium text-loom-text leading-tight ${hero ? "text-sm line-clamp-2" : compact ? "text-2xs line-clamp-2" : "text-xs line-clamp-2"}`}>{rec.title}</p>
        {(!compact || hero) && rec.subtitle && <p className={`text-loom-muted ${hero ? "text-xs line-clamp-2" : "text-2xs truncate"}`}>{rec.subtitle}</p>}
      </div>
    </button>
  );
}

function kindColor(kind: string): string {
  // Theme-aware tint via chart palette tokens (see globals.css --chart-*)
  const n =
    kind === "scatter" || kind === "bubble" || kind === "forceBubble" || kind === "hexbin" ? 1
    : kind === "bar" || kind === "lollipop" || kind === "waterfall" || kind === "dumbbell" || kind === "funnel" ? 2
    : kind === "histogram" || kind === "area" ? 3
    : kind === "line" || kind === "parallel" ? 4
    : kind === "heatmap" || kind === "treemap" ? 5
    : kind === "strip" || kind === "box" || kind === "violin" || kind === "ridgeline" ? 6
    : kind === "pie" || kind === "sunburst" || kind === "radar" ? 7
    : kind === "choropleth" || kind === "sankey" || isGeoFamilyKind(kind) ? 8
    : 0;
  if (!n) return "bg-loom-muted/20 text-loom-muted";
  return `loom-kind-${n}`;
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

/** Order x keys like the axis would: numerically when both parse, else natural text order (ISO dates sort correctly). */
function compareXKeys(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Mean of y per distinct x (or row count when there is no y), sorted along x — mirrors the full line/area renderers. */
function seriesByX(rows: unknown[][], xi: number, yi: number): number[] {
  const byX = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    if (yi >= 0 && isNaN(v)) continue;
    const g = byX.get(k) ?? { sum: 0, n: 0 };
    g.sum += v;
    g.n += 1;
    byX.set(k, g);
  }
  return [...byX.entries()]
    .sort((a, b) => compareXKeys(a[0], b[0]))
    .map(([, g]) => (yi >= 0 ? g.sum / g.n : g.n));
}

function groupRows(rows: unknown[][], ci: number, limit: number): unknown[][][] {
  const groups = new Map<string, unknown[][]>();
  for (const r of rows) {
    const k = String(r[ci]);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length).slice(0, limit);
}

function strokeSeries(ctx: CanvasRenderingContext2D, ys: number[], yMin: number, yMax: number, w: number, h: number, pad: number) {
  const range = yMax - yMin || 1;
  ctx.beginPath();
  ys.forEach((y, i) => {
    const sx = pad + (i / Math.max(ys.length - 1, 1)) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / range) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
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
    // Slightly larger marks read better in 4:3 thumbs without blobbing
    ctx.arc(sx, sy, Math.max(1.75, Math.min(w, h) * 0.012), 0, Math.PI * 2);
    ctx.fillStyle = COL[cat % COL.length];
    ctx.globalAlpha = 0.72;
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
    ctx.fillStyle = COL[0];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(pad + i * barW, h - pad - barH, Math.max(1, barW - 1), barH);
  });
  ctx.globalAlpha = 1;
}

function drawLine(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const series = ci >= 0 && ci !== xi
    ? groupRows(rows, ci, 6).map((g) => seriesByX(g, xi, yi))
    : [seriesByX(rows, xi, yi)];
  const all = series.flat();
  if (all.length === 0) return;
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.9;
  series.forEach((ys, i) => {
    if (ys.length === 0) return;
    ctx.strokeStyle = COL[i % COL.length];
    strokeSeries(ctx, ys, yMin, yMax, w, h, pad);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawHeatmap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const stops = colors.length ? colors : FALLBACK_COLORS;
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
      if (c <= 0) return;
      const intensity = c / maxC;
      ctx.globalAlpha = 0.3 + intensity * 0.7;
      ctx.fillStyle = sampleContinuous(stops, 0.2 + intensity * 0.8);
      ctx.fillRect(pad + xi2 * cellW, pad + yi2 * cellH, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
    });
  });
  ctx.globalAlpha = 1;
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
    const colorIdx = ciLabels && ci >= 0 ? Math.max(0, ciLabels.indexOf(String(r[ci]))) : 0;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bandH * 0.3);
    ctx.lineTo(sx, sy + bandH * 0.3);
    ctx.strokeStyle = COL[colorIdx % COL.length];
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.25;
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

function drawBox(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[], ui: ThemeUiColors) {
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
    ctx.fillStyle = COL[0];
    ctx.globalAlpha = 0.6;
    ctx.fillRect(cx - boxW / 2, toY(box.q3), boxW, toY(box.q1) - toY(box.q3));
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = ui.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxW / 2, toY(box.q3), boxW, toY(box.q1) - toY(box.q3));
    ctx.beginPath();
    ctx.moveTo(cx, toY(box.min)); ctx.lineTo(cx, toY(box.q1));
    ctx.moveTo(cx, toY(box.q3)); ctx.lineTo(cx, toY(box.max));
    // Median tick
    ctx.moveTo(cx - boxW / 2, toY(box.q2)); ctx.lineTo(cx + boxW / 2, toY(box.q2));
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawArea(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const series = ci >= 0 && ci !== xi
    ? groupRows(rows, ci, 4).map((g) => seriesByX(g, xi, yi))
    : [seriesByX(rows, xi, yi)];
  const all = series.flat();
  if (all.length === 0) return;
  // Area marks are anchored at zero like the full chart (or the min when all-negative).
  const yMin = Math.min(0, ...all);
  const yMax = Math.max(0, ...all);
  series.forEach((ys, j) => {
    if (ys.length === 0) return;
    const color = COL[j % COL.length];
    strokeSeries(ctx, ys, yMin, yMax, w, h, pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = series.length > 1 ? 0.35 : 0.45;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.25;
    strokeSeries(ctx, ys, yMin, yMax, w, h, pad);
    ctx.stroke();
  });
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
  const plotW = Math.max(1, w - 2 * pad);
  const plotH = Math.max(1, h - 2 * pad);
  let nValid = 0;
  for (const r of rows) {
    if (!isNaN(Number(r[xi])) && !isNaN(Number(r[yi]))) nValid++;
  }
  const marks = densityAwarePointMarks({
    n: nValid,
    plotW,
    plotH,
    hasSizeEncoding: si >= 0,
    pointSize: 10,
  });
  const { minR, maxR, opacity: alpha, drawStroke } = marks;
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
    const sx = pad + ((x - xMin) / xRange) * plotW;
    const sy = h - pad - ((y - yMin) / yRange) * plotH;
    bubbles.push({ sx, sy, r: radius, cat });
  }
  bubbles.sort((a, b) => b.r - a.r);
  for (const b of bubbles) {
    ctx.fillStyle = COL[b.cat % COL.length];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, b.r, 0, Math.PI * 2);
    ctx.fill();
    if (drawStroke) {
      ctx.globalAlpha = Math.min(alpha + 0.2, 0.8);
      ctx.strokeStyle = COL[b.cat % COL.length];
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
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
    ctx.fillStyle = COL[0];
    ctx.globalAlpha = 0.65;
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

function drawRadar(ctx: CanvasRenderingContext2D, rows: unknown[][], columnNames: string[], _xi: number, _yi: number, ci: number, w: number, h: number, pad: number, colors: string[], ui: ThemeUiColors) {
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

  ctx.strokeStyle = ui.muted;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.35;
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
    ctx.fillStyle = bar.value >= 0 ? VIZ_SEMANTIC.positive : VIZ_SEMANTIC.negative;
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
    ctx.strokeStyle = COL[0];
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(pad, cy);
    ctx.lineTo(endX, cy);
    ctx.stroke();
    ctx.fillStyle = COL[0];
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(endX, cy, Math.max(2, Math.min(3, bandH * 0.35)), 0, Math.PI * 2);
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

function drawSunburst(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, _ci: number, w: number, h: number, pad: number, colors: string[], ui: ThemeUiColors) {
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
  ctx.globalAlpha = 1;
  // Thin separators between segments in the card background colour
  ctx.strokeStyle = ui.bg; ctx.lineWidth = 1;
  angle = -Math.PI / 2;
  for (const [, val] of entries) {
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR); ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR); ctx.stroke();
    angle += (val / total) * Math.PI * 2;
  }
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
    const idx = ci >= 0 ? catLabels.indexOf(c.cat) : 0;
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

function drawDumbbell(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, si: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, { a: number[]; b: number[] }>();
  for (const r of rows) {
    const k = String(r[xi]);
    const a = Number(r[yi]);
    const b = Number(r[si]);
    if (isNaN(a) || isNaN(b)) continue;
    if (!groups.has(k)) groups.set(k, { a: [], b: [] });
    groups.get(k)!.a.push(a);
    groups.get(k)!.b.push(b);
  }
  const entries = [...groups.entries()].map(([label, g]) => ({
    label,
    a: g.a.reduce((s, v) => s + v, 0) / g.a.length,
    b: g.b.reduce((s, v) => s + v, 0) / g.b.length,
  })).slice(0, 10);
  if (!entries.length) return;
  let minV = Infinity, maxV = -Infinity;
  for (const e of entries) { minV = Math.min(minV, e.a, e.b); maxV = Math.max(maxV, e.a, e.b); }
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const range = maxV - minV;
  const bandH = (h - 2 * pad) / entries.length;
  entries.forEach((e, i) => {
    const cy = pad + (i + 0.5) * bandH;
    const x0 = pad + ((e.a - minV) / range) * (w - 2 * pad);
    const x1 = pad + ((e.b - minV) / range) * (w - 2 * pad);
    // Connector in a neutral, endpoints in the two series colours (start / end)
    ctx.strokeStyle = COL[0]; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = COL[0];
    ctx.beginPath(); ctx.arc(x0, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL[1 % COL.length];
    ctx.beginPath(); ctx.arc(x1, cy, 2.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawRidgeline(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[yi]); const v = Number(r[xi]);
    if (isNaN(v)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const entries = [...groups.entries()].slice(0, 6);
  if (!entries.length) return;
  const all = entries.flatMap(([, vs]) => vs);
  const gMin = Math.min(...all), gMax = Math.max(...all), range = gMax - gMin || 1;
  const bins = 16;
  const bandH = (h - 2 * pad) / entries.length;
  entries.forEach(([, vals], gi) => {
    const counts = new Array(bins).fill(0);
    for (const v of vals) counts[Math.min(bins - 1, Math.floor(((v - gMin) / range) * bins))]++;
    const maxC = Math.max(...counts, 1);
    const baseline = pad + (gi + 1) * bandH - 2;
    ctx.beginPath(); ctx.moveTo(pad, baseline);
    for (let b = 0; b < bins; b++) {
      const x = pad + ((b + 0.5) / bins) * (w - 2 * pad);
      ctx.lineTo(x, baseline - (counts[b] / maxC) * bandH * 0.8);
    }
    ctx.lineTo(w - pad, baseline); ctx.closePath();
    ctx.fillStyle = COL[0]; ctx.globalAlpha = 0.5; ctx.fill();
    ctx.strokeStyle = COL[0]; ctx.globalAlpha = 0.9; ctx.lineWidth = 1; ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawHexbin(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, stops: string[]) {
  const [xMin, xMax] = numericRange(rows, xi);
  const [yMin, yMax] = numericRange(rows, yi);
  const hexR = Math.min(w, h) / 18;
  const hexW = hexR * Math.sqrt(3), hexH = hexR * 1.5;
  const counts = new Map<string, number>();
  let maxC = 0;
  for (const r of rows) {
    const xv = Number(r[xi]), yv = Number(r[yi]);
    if (isNaN(xv) || isNaN(yv)) continue;
    const px = pad + ((xv - xMin) / (xMax - xMin || 1)) * (w - 2 * pad);
    const py = h - pad - ((yv - yMin) / (yMax - yMin || 1)) * (h - 2 * pad);
    const col = Math.round((px - pad) / hexW), row = Math.round((py - pad) / hexH);
    const key = `${col},${row}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n); if (n > maxC) maxC = n;
  }
  for (const [key, count] of counts) {
    const [cs, rs] = key.split(",");
    const col = Number(cs), row = Number(rs);
    const cx = pad + col * hexW + (row % 2 ? hexW / 2 : 0);
    const cy = pad + row * hexH;
    const t = count / maxC;
    ctx.fillStyle = sampleContinuous(stops, 0.2 + t * 0.8);
    ctx.globalAlpha = 0.45 + t * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      const hx = cx + hexR * Math.cos(ang), hy = cy + hexR * Math.sin(ang);
      if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFunnel(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, colors: string[]) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]); const v = yi >= 0 ? Number(r[yi]) : 1;
    groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 0 : Math.abs(v)));
  }
  const entries = [...groups.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return;
  const maxVal = entries[0]![1];
  const minW = (w - 2 * pad) * 0.2, maxW = w - 2 * pad;
  const bandH = (h - 2 * pad) / entries.length;
  entries.forEach(([, val], i) => {
    const next = entries[i + 1];
    const topW = minW + (val / maxVal) * (maxW - minW);
    const botW = next ? minW + (next[1] / maxVal) * (maxW - minW) : topW * 0.7;
    const y0 = pad + i * bandH, y1 = y0 + bandH - 2, cx = w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, y0); ctx.lineTo(cx + topW / 2, y0);
    ctx.lineTo(cx + botW / 2, y1); ctx.lineTo(cx - botW / 2, y1);
    ctx.closePath();
    ctx.fillStyle = COL[0]; ctx.globalAlpha = 0.9 - (i / Math.max(entries.length, 1)) * 0.45; ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawParallel(ctx: CanvasRenderingContext2D, rows: unknown[][], columnNames: string[], ci: number, w: number, h: number, pad: number, colors: string[], ui: ThemeUiColors) {
  const COL = colors.length ? colors : FALLBACK_COLORS;
  const axes: { idx: number; min: number; max: number }[] = [];
  for (let c = 0; c < columnNames.length; c++) {
    if (c === ci) continue;
    const [min, max] = numericRange(rows, c);
    const ok = rows.slice(0, 20).some(r => !isNaN(Number(r[c])));
    if (!ok) continue;
    axes.push({ idx: c, min, max });
    if (axes.length >= 5) break;
  }
  if (axes.length < 3) return;
  const xs = axes.map((_, i) => pad + (i / (axes.length - 1)) * (w - 2 * pad));
  ctx.strokeStyle = ui.muted; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
  for (const x of xs) { ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, h - pad); ctx.stroke(); }
  const stride = Math.max(1, Math.floor(rows.length / 80));
  const catIdx = new Map<string, number>();
  for (let ri = 0; ri < rows.length; ri += stride) {
    const r = rows[ri]!;
    let colorIdx = 0;
    if (ci >= 0) {
      const k = String(r[ci]);
      if (!catIdx.has(k)) catIdx.set(k, catIdx.size);
      colorIdx = catIdx.get(k)! % COL.length;
    }
    ctx.strokeStyle = COL[colorIdx]; ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
    ctx.beginPath();
    axes.forEach((ax, i) => {
      const v = Number(r[ax.idx]); if (isNaN(v)) return;
      const t = (v - ax.min) / (ax.max - ax.min || 1);
      const y = h - pad - t * (h - 2 * pad);
      if (i === 0) ctx.moveTo(xs[i]!, y); else ctx.lineTo(xs[i]!, y);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
