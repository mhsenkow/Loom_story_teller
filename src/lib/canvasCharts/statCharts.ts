import { addDensityCell, densityDomain, densityFraction, densityMeasure, densityPlot, densityValue, type DensityCell } from "./densityCells";
import { chartNumber } from "../chartNumbers";
// =================================================================
// Canvas 2D pareto, correlation matrix, dumbbell, ridgeline, hexbin, funnel and parallel renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { aggregateValues, fieldLabel, plotOf, pushHit, setLegend, valueTitle } from "./plumbing";
import { formatDataValue, linear, niceTicks } from "../chartAxes";
import { DEFAULT_TOP_N, clampTopN } from "../chartFacets";
import { resolveChartInk } from "../chartInk";
import { contrastingInk, fitTextEllipsis } from "../chartLayout";
import { type PlotRect, drawAxisFrame, drawBandAxisX, drawBandAxisY, drawChartGrid, drawChartTicks, drawColorRamp } from "../chartLooks";
import { sampleContinuous } from "../chartPalettes";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { chartFont, chartTypeRamp } from "../chartType";
import { resolveLayoutDirection } from "../chartSupport";
import { formatTooltipNumber } from "../chartTooltip";
import { DEFAULT_CORR_DIVERGING, corrCellInk, corrFillT, sampleCorrDiverging } from "../corrMatrixStyle";
import { buildCorrMatrix, buildPareto } from "../dsTransforms";
import { type YAggregateOption } from "../recommendations";
import { axisFont, barPath, densityStops, labelGutter } from "./axisHelpers";
import { groupedDistributions } from "./distributions";
import { drawAxisTicks, drawGridLines, numRange } from "./primitives";
import { formatDeltaLabel } from "../deltaCompare";
import { DEFAULT_COLORS } from "./shared";

export function renderFullPareto(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const topN = clampTopN(opts?.topN, DEFAULT_TOP_N);
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!byCat.has(k)) byCat.set(k, []);
    if (yi < 0) byCat.get(k)!.push(1);
    else {
      const v = chartNumber(r[yi]);
      if (!isNaN(v)) byCat.get(k)!.push(v);
    }
  }
  const entries = [...byCat.entries()]
    .map(([label, vals]) => ({ label, value: aggregateValues(vals, agg) }))
    .filter((e) => e.value > 0);
  const bins = buildPareto(entries).slice(0, topN);
  if (bins.length === 0) return;

  const layout = resolveLayoutDirection(opts?.layoutDirection, false);
  const reverse = layout.reverse;
  const rect = plotOf(w, h, pad, opts);
  const maxV = Math.max(...bins.map((b) => b.value));
  const ys = niceTicks(0, maxV, opts?.tickCount ?? 5, true);
  // Pareto keeps categories on X; Direction only flips the measure (↑ / ↓).
  // Left/right map to reverse measure so the Encoding control still does something useful.
  const flip = reverse || layout.horizontal;
  const Y = flip
    ? linear(ys.min, ys.max, rect.top, rect.bottom)
    : linear(ys.min, ys.max, rect.bottom, rect.top);
  const Ypct = flip
    ? linear(0, 100, rect.top, rect.bottom)
    : linear(0, 100, rect.bottom, rect.top);
  const band = (rect.right - rect.left) / bins.length;
  const barW = Math.max(2, band * 0.7);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });

  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi, agg);
  const color = cols[0]!;
  const corner = opts?.barCornerRadius ?? 3;
  const barDir: "up" | "down" = flip ? "down" : "up";
  bins.forEach((b, i) => {
    const x = rect.left + i * band + (band - barW) / 2;
    const y0 = Y(0);
    const y1 = Y(b.value);
    const top = Math.min(y0, y1);
    const bh = Math.max(1, Math.abs(y1 - y0));
    ctx.fillStyle = color;
    ctx.globalAlpha = opts?.opacity ?? 0.85;
    ctx.beginPath();
    barPath(ctx, x, top, barW, bh, Math.min(corner, barW / 2, bh / 2), barDir);
    ctx.fill();
    pushHit(opts, {
      shape: "rect", x, y: top, w: barW, h: bh,
      match: [[xi, b.label]],
      summary: {
        columns: [xName, vTitle, "Cumulative %"],
        row: [b.label, formatTooltipNumber(b.value), `${b.cumulativePct.toFixed(1)}%`],
      },
    });
  });
  ctx.globalAlpha = 1;

  // Cumulative % line + 80% marker
  ctx.strokeStyle = cols[1] ?? cols[0]!;
  ctx.lineWidth = 2;
  ctx.beginPath();
  bins.forEach((b, i) => {
    const x = rect.left + (i + 0.5) * band;
    const y = Ypct(b.cumulativePct);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = cols[1] ?? cols[0]!;
  bins.forEach((b, i) => {
    const x = rect.left + (i + 0.5) * band;
    const y = Ypct(b.cumulativePct);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  const y80 = Ypct(80);
  ctx.strokeStyle = opts?.themeMuted ?? "rgba(128,128,128,0.55)";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.left, y80);
  ctx.lineTo(rect.right, y80);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = opts?.themeMuted ?? "#8b8b98";
  ctx.font = axisFont(opts, 10);
  ctx.textAlign = "right";
  ctx.textBaseline = flip ? "top" : "bottom";
  ctx.fillText("80%", rect.right - 2, flip ? y80 + 2 : y80 - 2);

  setLegend(opts, [
    { label: vTitle, color },
    { label: "Cumulative %", color: cols[1] ?? cols[0]! },
  ]);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, bins.map((b) => b.label), bins.map((_, i) => rect.left + (i + 0.5) * band), band, w, h, rect, opts, "nominal");
}

// --- Correlation matrix ---

export function renderFullCorrMatrix(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const labels = (opts?.fieldNames ?? columns)
    .map((name, i) => ({ name, i }))
    .filter(({ name, i }) => {
      // Prefer numeric-looking columns
      let hits = 0;
      const probe = Math.min(rows.length, 40);
      for (let r = 0; r < probe; r++) {
        const v = Number(rows[r]![i]);
        if (Number.isFinite(v)) hits++;
      }
      if (!(probe > 0 && hits / probe >= 0.5 && name.length > 0)) return false;
      // A constant column (all-zero flag, single unit) has no defined r — leave it out
      let lo = Infinity;
      let hi = -Infinity;
      for (const row of rows) {
        const v = chartNumber(row[i]);
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (hi > lo) return true;
      }
      return false;
    })
    .slice(0, 8);
  if (labels.length < 2) return;
  const matrix = buildCorrMatrix(
    rows,
    labels.map((l) => l.i),
    labels.map((l) => l.name),
  );
  if (!matrix) return;

  const rect = plotOf(w, h, pad, opts);
  const n = matrix.labels.length;
  const cellW = (rect.right - rect.left) / n;
  const cellH = (rect.bottom - rect.top) / n;
  const stops = opts?.continuousStops?.length
    ? opts.continuousStops
    : DEFAULT_CORR_DIVERGING;
  const ink = resolveChartInk({
    themeBg: opts?.themeBg,
    themeText: opts?.themeText,
    themeMuted: opts?.themeMuted,
    axisLabelColor: opts?.axisLabelColor,
  });

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const corr = matrix.matrix[r]![c]!;
      const t = corrFillT(corr);
      const x = rect.left + c * cellW;
      const y = rect.top + r * cellH;
      const fill = sampleCorrDiverging(stops, t);
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.35 + Math.abs(corr) * 0.65;
      ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
      if ((opts?.showDataLabels || cellW > 36) && cellW > 28 && cellH > 18) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = corrCellInk(corr, fill, ink.bg, ink.text, 0.35 + Math.abs(corr) * 0.65);
        ctx.font = axisFont(opts, chartTypeRamp(opts?.axisFontSize).cell);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = corr.toFixed(2);
        if (ctx.measureText(label).width <= cellW - 6 && chartTypeRamp(opts?.axisFontSize).cell + 4 <= cellH)
          ctx.fillText(label, x + cellW / 2, y + cellH / 2);
      }
      pushHit(opts, {
        shape: "rect", x, y, w: cellW, h: cellH,
        match: [],
        summary: {
          columns: ["Row", "Col", "r"],
          row: [matrix.labels[r]!, matrix.labels[c]!, corr.toFixed(3)],
        },
      });
    }
  }
  ctx.globalAlpha = 1;

  // Axis labels along left / bottom
  ctx.fillStyle = opts?.axisLabelColor ?? opts?.themeMuted ?? "#8b8b98";
  ctx.font = axisFont(opts, 10);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  matrix.labels.forEach((lab, i) => {
    const y = rect.top + (i + 0.5) * cellH;
    ctx.fillText(fitTextEllipsis(ctx, lab, pad - 6), rect.left - 4, y);
  });
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  matrix.labels.forEach((lab, i) => {
    const x = rect.left + (i + 0.5) * cellW;
    ctx.save();
    ctx.translate(x, rect.bottom + 4);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(fitTextEllipsis(ctx, lab, 70), 0, 0);
    ctx.restore();
  });
}

// --- Dumbbell (category × start → end) ---

export function renderFullDumbbell(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  si: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0 || si < 0) return;
  void ci;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.9;
  const agg: YAggregateOption = opts?.yAggregate ?? "mean";

  const groups = new Map<string, { start: number[]; end: number[] }>();
  for (const r of rows) {
    const k = String(r[xi]);
    const a = chartNumber(r[yi]);
    const b = chartNumber(r[si]);
    if (isNaN(a) || isNaN(b)) continue;
    if (!groups.has(k)) groups.set(k, { start: [], end: [] });
    const g = groups.get(k)!;
    g.start.push(a);
    g.end.push(b);
  }
  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, start: aggregateValues(g.start, agg), end: aggregateValues(g.end, agg) }))
    .sort((a, b) => Math.abs(b.end - b.start) - Math.abs(a.end - a.start))
    .slice(0, 20);
  if (entries.length === 0) return;

  let minV = Infinity;
  let maxV = -Infinity;
  for (const e of entries) {
    minV = Math.min(minV, e.start, e.end);
    maxV = Math.max(maxV, e.start, e.end);
  }
  const gutter = labelGutter(ctx, entries.map((e) => e.label), w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const xs = niceTicks(minV, maxV, opts?.tickCount ?? 5, true);
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });

  const startColor = palette[0]!;
  const endColor = palette[1] ?? palette[0]!;
  const bandH = (rect.bottom - rect.top) / entries.length;
  const dotR = Math.max(3, Math.min(5.5, bandH * 0.28));
  const xName = fieldLabel(opts, xi);
  const aName = fieldLabel(opts, yi, "start");
  const bName = fieldLabel(opts, si, "end");
  const centers: number[] = [];

  const deltaMode = opts?.deltaDisplay ?? "off";
  entries.forEach((e, i) => {
    const cy = rect.top + (i + 0.5) * bandH;
    centers.push(cy);
    const x0 = X(e.start);
    const x1 = X(e.end);
    ctx.strokeStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    ctx.lineTo(x1, cy);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = startColor;
    ctx.beginPath();
    ctx.arc(x0, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = endColor;
    ctx.beginPath();
    ctx.arc(x1, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    const deltaLbl = formatDeltaLabel(e.start, e.end, deltaMode);
    if (deltaLbl && bandH >= 12) {
      ctx.globalAlpha = 1;
      ctx.font = axisFont(opts, 9);
      ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.textBaseline = "middle";
      const midX = (x0 + x1) / 2;
      const preferRight = x1 >= x0;
      ctx.textAlign = preferRight ? "left" : "right";
      const tipX = preferRight ? Math.max(x0, x1) + dotR + 4 : Math.min(x0, x1) - dotR - 4;
      if (tipX > rect.left + 4 && tipX < rect.right - 4) ctx.fillText(deltaLbl, tipX, cy);
      else {
        ctx.textAlign = "center";
        ctx.fillText(deltaLbl, midX, cy - dotR - 6);
      }
    }
    pushHit(opts, {
      shape: "rect", x: rect.left, y: cy - bandH / 2, w: rect.right - rect.left, h: bandH,
      match: [[xi, e.label]],
      summary: {
        columns: [xName, aName, bName, "Change"],
        row: [e.label, formatTooltipNumber(e.start), formatTooltipNumber(e.end), (e.end - e.start > 0 ? "+" : "") + formatTooltipNumber(e.end - e.start)],
      },
    });
  });
  ctx.globalAlpha = 1;
  setLegend(opts, [{ label: aName, color: startColor }, { label: bName, color: endColor }]);
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, entries.map((e) => e.label), centers, bandH, rect.left - 8, gutter - 10, opts);
}

// --- Ridgeline (density per group) ---

export function renderFullRidgeline(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0) return;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.6;
  const groups = groupedDistributions(rows, yi, xi, 10);
  if (groups.length === 0) return;

  const gMin = Math.min(...groups.map((g) => g.min));
  const gMax = Math.max(...groups.map((g) => g.max));
  const xs = niceTicks(gMin, gMax, opts?.tickCount ?? 5, true);
  const gutter = labelGutter(ctx, groups.map((g) => g.label), w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  const bins = 48;
  const binW = (xs.max - xs.min) / bins;
  const bandH = (rect.bottom - rect.top) / groups.length;
  // Ridges overlap the band above by ~40% — the classic joyplot look
  const ridgeH = Math.min(bandH * 1.4, rect.bottom - rect.top);
  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });
  const color = palette[0]!;
  const gName = fieldLabel(opts, yi);
  const vName = fieldLabel(opts, xi);
  const centers: number[] = [];

  groups.forEach((g, gi) => {
    let counts = new Array<number>(bins).fill(0);
    for (const v of g.sorted) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - xs.min) / binW)))]! += 1;
    for (let pass = 0; pass < 2; pass++) counts = counts.map((c, i) => ((counts[i - 1] ?? 0) + 2 * c + (counts[i + 1] ?? 0)) / 4);
    const maxC = Math.max(...counts, 1e-9);
    const baseline = rect.top + (gi + 1) * bandH;
    centers.push(baseline - bandH * 0.3);

    ctx.beginPath();
    ctx.moveTo(rect.left, baseline);
    for (let b = 0; b < bins; b++) ctx.lineTo(X(xs.min + (b + 0.5) * binW), baseline - (counts[b]! / maxC) * ridgeH);
    ctx.lineTo(rect.right, baseline);
    ctx.closePath();
    // Opaque base so the ridge in front hides the one behind it
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.fill();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    pushHit(opts, {
      shape: "rect", x: rect.left, y: rect.top + gi * bandH, w: rect.right - rect.left, h: bandH,
      match: [[yi, g.label]],
      summary: { columns: [gName, "Rows", `Median ${vName}`], row: [g.label, formatTooltipNumber(g.sorted.length), formatTooltipNumber(g.q2)] },
    });
  });

  ctx.globalAlpha = 1;
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, groups.map((g) => g.label), centers, bandH, rect.left - 8, gutter - 10, opts);
}

// --- Hexbin density ---

export function renderFullHexbin(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0) return;
  const stops = densityStops(opts?.continuousStops?.length ? opts.continuousStops : (opts?.colors ?? DEFAULT_COLORS), opts?.themeBg);
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const rect = densityPlot(w, h, pad, opts);
  const plotW = rect.right - rect.left;
  const plotH = rect.bottom - rect.top;
  const measure = densityMeasure(opts);
  setLegend(opts, []);
  const targetHex = Math.max(8, Math.min(28, Math.round(Math.sqrt(rows.length) / 2)));
  const hexR = Math.min(plotW, plotH) / (targetHex * 1.75);
  const hexW = hexR * Math.sqrt(3);
  const hexH = hexR * 1.5;

  const counts = new Map<string, DensityCell>();
  rows.forEach((r, ri) => {
    const xv = chartNumber(r[xi]);
    const yv = chartNumber(r[yi]);
    if (isNaN(xv) || isNaN(yv)) return;
    const px = rect.left + ((xv - xMin) / (xMax - xMin || 1)) * plotW;
    const py = rect.bottom - ((yv - yMin) / (yMax - yMin || 1)) * plotH;
    const row = Math.round((py - rect.top) / hexH);
    const col = Math.round((px - rect.left - (row % 2 === 0 ? 0 : hexW / 2)) / hexW);
    const key = `${col},${row}`;
    addDensityCell(counts, key, r[measure.index], ri);
  });
  if (counts.size === 0) return;

  const domain = densityDomain(counts.values(), measure.aggregate);
  if (!opts?.mini) drawChartGrid(ctx, w, h, rect, opts, { x: [xMin, xMax], y: [yMin, yMax] });
  if (opts) {
    opts.scales = {
      x: (v: number) => rect.left + ((v - xMin) / (xMax - xMin || 1)) * plotW,
      y: (v: number) => rect.bottom - ((v - yMin) / (yMax - yMin || 1)) * plotH,
      valueAxis: "y",
      rect,
    };
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.left, rect.top, plotW, plotH);
  ctx.clip();
  for (const [key, cell] of counts) {
    const [cs, rs] = key.split(",");
    const col = Number(cs);
    const row = Number(rs);
    const cx = rect.left + col * hexW + (Math.abs(row) % 2 === 0 ? 0 : hexW / 2);
    const cy = rect.top + row * hexH;
    const value = densityValue(cell, measure.aggregate);
    if (value === null) continue;
    const fill = sampleContinuous(stops, densityFraction(value, domain));
    ctx.fillStyle = fill;
    ctx.globalAlpha = opts?.opacity ?? 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      const hx = cx + hexR * Math.cos(ang);
      const hy = cy + hexR * Math.sin(ang);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    if (!opts?.mini && opts?.showDataLabels && hexR * 1.2 >= chartTypeRamp(opts.axisFontSize).cell) {
      ctx.font = axisFont(opts, chartTypeRamp(opts.axisFontSize).cell);
      const text = formatDataValue(value);
      if (ctx.measureText(text).width < hexW - 6) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = contrastingInk(fill);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, cx, cy);
      }
    }
    pushHit(opts, {
      shape: "circle", cx, cy, r: hexR * 0.9,
      match: [],
      rowIndex: cell.row,
      summary: { columns: [measure.title, ...(measure.aggregate === "count" ? [] : ["Rows here"])], row: [formatTooltipNumber(value), ...(measure.aggregate === "count" ? [] : [formatTooltipNumber(cell.count)])] },
    });
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if (!opts?.mini) drawChartTicks(ctx, xMin, xMax, yMin, yMax, w, h, rect, opts);
  if (!opts?.mini && opts?.legendPosition !== "none") drawColorRamp(ctx, stops, sampleContinuous, Math.min(w - 38, rect.right + 10), rect.top + 14, Math.min(140, plotH * 0.5), formatDataValue(domain.min), formatDataValue(domain.max), opts, measure.title);
}

// --- Funnel stages ---

export function renderFullFunnel(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  void ci;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? chartNumber(r[yi]) : 1);
  }
  const entries = [...groups.entries()]
    .map(([label, vals]) => ({ label, value: aggregateValues(vals.filter(v => !isNaN(v)), agg) }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, opts?.topN != null ? clampTopN(opts.topN) : 12);
  if (entries.length === 0) return;

  const maxVal = entries[0]!.value;
  const plotW = w - 2 * pad;
  const minW = plotW * 0.16;
  const maxW = plotW * 0.92;
  const bandH = (h - 2 * pad) / entries.length;
  const gap = Math.min(4, bandH * 0.12);
  const color = palette[0]!;
  const ink = contrastingInk(color);
  const cx = w / 2;
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  const widthOf = (v: number) => minW + (v / maxVal) * (maxW - minW);

  entries.forEach((e, i) => {
    const next = entries[i + 1];
    const topW = widthOf(e.value);
    const botW = next ? widthOf(next.value) : topW * 0.85;
    const y0 = pad + i * bandH;
    const y1 = y0 + bandH - gap;
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, y0);
    ctx.lineTo(cx + topW / 2, y0);
    ctx.lineTo(cx + botW / 2, y1);
    ctx.lineTo(cx - botW / 2, y1);
    ctx.closePath();
    ctx.fillStyle = color;
    // Later stages fade slightly so the drop-off reads at a glance
    ctx.globalAlpha = alpha * (1 - (i / Math.max(1, entries.length)) * 0.45);
    ctx.fill();

    const pctOfFirst = (e.value / maxVal) * 100;
    const fs = Math.max(chartTypeRamp(opts?.axisFontSize).mark, Math.min(14, bandH * 0.32));
    const text = `${e.label}  ·  ${formatDataValue(e.value)}${i > 0 ? `  (${pctOfFirst < 10 ? pctOfFirst.toFixed(1) : Math.round(pctOfFirst)}%)` : ""}`;
    ctx.font = chartFont(fs, fontFamily, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    const inner = Math.min(topW, botW) - 12;
    if (ctx.measureText(text).width <= inner) {
      ctx.fillStyle = ink;
      ctx.fillText(text, cx, (y0 + y1) / 2);
    } else {
      // Too narrow: label beside the stage
      ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
      ctx.textAlign = "left";
      const lx = cx + Math.max(topW, botW) / 2 + 8;
      ctx.fillText(fitTextEllipsis(ctx, text, Math.max(30, w - pad - lx)), lx, (y0 + y1) / 2);
    }
    pushHit(opts, {
      shape: "rect", x: pad, y: y0, w: plotW, h: bandH,
      match: [[xi, e.label]],
      summary: { columns: [xName, vTitle, "Of first stage"], row: [e.label, formatTooltipNumber(e.value), `${pctOfFirst.toFixed(1)}%`] },
    });
  });
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, []);
}

// --- Parallel coordinates ---

export function renderFullParallel(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columnNames: string[],
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.35;
  const fontFamily = opts?.fontFamily ?? "Inter";

  const axes: { name: string; idx: number; min: number; max: number }[] = [];
  for (let c = 0; c < columnNames.length; c++) {
    if (c === ci) continue;
    const [min, max] = numRange(rows, c);
    const sampleN = rows.slice(0, 40).filter(r => {
      const v = chartNumber(r[c]);
      return r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean" && !isNaN(v);
    }).length;
    if (sampleN < Math.min(12, rows.length * 0.3)) continue;
    axes.push({ name: columnNames[c]!, idx: c, min, max });
    if (axes.length >= 8) break;
  }
  if (axes.length < 3) return;

  const catMap = new Map<string, number>();
  if (ci >= 0) {
    for (const r of rows) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, catMap.size);
    }
  }

  const fontSize = chartTypeRamp(opts?.axisFontSize).tick;
  const edge = Math.min(40, (w - 2 * pad) / (axes.length * 2));
  const axisXs = axes.map((_, i) => pad + edge + (i / (axes.length - 1)) * (w - 2 * pad - 2 * edge));
  const spacing = (w - 2 * pad - 2 * edge) / (axes.length - 1);
  const plotTop = pad + fontSize + 6;
  const plotBot = h - pad - fontSize - 6;

  const maxLines = Math.min(rows.length, 400);
  const stride = Math.max(1, Math.floor(rows.length / maxLines));
  for (let ri = 0; ri < rows.length; ri += stride) {
    const r = rows[ri]!;
    const colorIdx = ci >= 0 ? (catMap.get(String(r[ci])) ?? 0) : 0;
    ctx.strokeStyle = palette[colorIdx % palette.length]!;
    ctx.lineWidth = 1;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    let started = false;
    axes.forEach((ax, i) => {
      const v = chartNumber(r[ax.idx]);
      if (isNaN(v)) return;
      const t = (v - ax.min) / (ax.max - ax.min || 1);
      const y = plotBot - t * (plotBot - plotTop);
      if (!started) { ctx.moveTo(axisXs[i]!, y); started = true; }
      else ctx.lineTo(axisXs[i]!, y);
    });
    ctx.stroke();
    if (opts?.hits) {
      opts.hits.push({
        shape: "rect",
        x: Math.min(...axisXs) - 6,
        y: plotTop - 4,
        w: Math.max(...axisXs) - Math.min(...axisXs) + 12,
        h: plotBot - plotTop + 8,
        match: ci >= 0 ? [[ci, String(r[ci])]] : [],
        rowIndex: ri,
      });
    }
  }

  // Axes on top of the lines, each with its own min / max
  ctx.globalAlpha = 1;
  axes.forEach((ax, i) => {
    const x = axisXs[i]!;
    ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? "#2a2a30";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBot);
    ctx.stroke();
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.font = chartFont(fontSize, fontFamily, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(fitTextEllipsis(ctx, ax.name, spacing - 8), x, plotBot + 6);
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.font = chartFont(fontSize, fontFamily);
    ctx.textBaseline = "bottom";
    ctx.fillText(formatDataValue(ax.max), x, plotTop - 3);
    ctx.textBaseline = "top";
    ctx.globalAlpha = 0.8;
    ctx.fillText(formatDataValue(ax.min), x, plotBot + fontSize + 8);
    ctx.globalAlpha = 1;
  });
  ctx.textBaseline = "alphabetic";
  if (ci >= 0) setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
}

// --- Helpers ---
