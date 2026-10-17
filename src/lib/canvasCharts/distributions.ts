// =================================================================
// Canvas 2D strip, box and area renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { aggregateValues, fieldLabel, plotOf, pushHit, setLegend, valueTitle } from "./plumbing";
import { buildXModel, classifyKeys, linear, niceTicks, niceZeroScale } from "../chartAxes";
import { type PlotRect, drawAxisFrame, drawBandAxisX, drawBandAxisY, drawChartGrid, drawChartTicks } from "../chartLooks";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { formatTooltipNumber } from "../chartTooltip";
import { type SeriesNormalize, type YScaleKind, normalizeSeriesValues, rollingMean, scaleDomain, scaleY } from "../dsTransforms";
import { type YAggregateOption } from "../recommendations";
import { drawXModelAxis, drawZeroLine, labelGutter, timeBuckets } from "./axisHelpers";
import { encodingNorm, jitter, numRange } from "./primitives";
import { DEFAULT_COLORS } from "./shared";

export function renderFullStrip(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  encodingIndices?: { opacityIdx: number },
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const baseAlpha = opts?.opacity ?? 0.7;
  const jitterPx = opts?.markJitter ?? 0;
  const freq = new Map<string, number>();
  for (const r of rows) freq.set(String(r[yi]), (freq.get(String(r[yi])) ?? 0) + 1);
  const cls = classifyKeys([...freq.keys()]);
  const yLabels = (cls.kind !== "band" ? cls.sorted : [...freq.keys()].sort((a, b) => freq.get(b)! - freq.get(a)!)).slice(0, 15);
  if (yLabels.length === 0) return;
  const gutter = labelGutter(ctx, yLabels, w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const [dMin, dMax] = numRange(rows, xi);
  const xs = niceTicks(dMin, dMax, opts?.tickCount ?? 5, true);
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  const bandH = (rect.bottom - rect.top) / yLabels.length;
  const opacityIdx = encodingIndices?.opacityIdx ?? -1;
  const getOpacityNorm = opacityIdx >= 0 ? encodingNorm(rows, opacityIdx) : null;
  const bandOf = new Map(yLabels.map((l, i) => [l, i]));

  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });
  // Faint band separators help the eye track long rows
  ctx.save();
  ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.5;
  for (let i = 1; i < yLabels.length; i++) {
    const y = Math.round(rect.top + i * bandH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(rect.left, y);
    ctx.lineTo(rect.right, y);
    ctx.stroke();
  }
  ctx.restore();

  const ciMap = ci >= 0 ? new Map([...new Set(rows.map(r => String(r[ci])))].map((k, i) => [k, i])) : null;
  const tick = Math.max(3, Math.min(bandH * 0.32, 14));
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  let pointIdx = 0;
  rows.forEach((r) => {
    const x = Number(r[xi]);
    if (isNaN(x)) return;
    const yiL = bandOf.get(String(r[yi]));
    if (yiL == null) return;
    let sx = X(x);
    const sy = rect.top + yiL * bandH + bandH / 2;
    if (jitterPx > 0) sx += jitter(pointIdx * 2, jitterPx);
    pointIdx++;
    const alpha =
      getOpacityNorm != null
        ? Math.min(0.6, Math.max(0.15, baseAlpha * (0.3 + 0.7 * getOpacityNorm(r))))
        : Math.min(0.6, baseAlpha);
    ctx.beginPath();
    ctx.moveTo(sx, sy - tick);
    ctx.lineTo(sx, sy + tick);
    ctx.strokeStyle = ciMap ? cols[(ciMap.get(String(r[ci])) ?? 0) % cols.length]! : cols[0]!;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    pushHit(opts, {
      shape: "rect", x: sx - 2, y: sy - tick, w: 4, h: tick * 2,
      match: [[xi, String(r[xi])], [yi, String(r[yi])]],
      summary: { columns: [yName, xName], row: [String(r[yi]), formatTooltipNumber(x)] },
    });
  });
  ctx.globalAlpha = 1;
  if (ciMap) setLegend(opts, [...ciMap.entries()].map(([label, i]) => ({ label, color: cols[i % cols.length]! })));
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, yLabels, yLabels.map((_, i) => rect.top + (i + 0.5) * bandH), bandH, rect.left - 8, gutter - 10, opts);
}

export function quartiles(sorted: number[]): { q1: number; q2: number; q3: number; min: number; max: number } {
  const n = sorted.length;
  if (n === 0) return { q1: 0, q2: 0, q3: 0, min: 0, max: 0 };
  const min = sorted[0];
  const max = sorted[n - 1];
  const q2 = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const lo = sorted.slice(0, Math.floor(n / 2));
  const hi = sorted.slice(Math.ceil(n / 2));
  if (lo.length === 0 || hi.length === 0) return { q1: q2, q2, q3: q2, min, max };
  const q1 = lo.length % 2 === 1 ? lo[(lo.length - 1) / 2]! : (lo[lo.length / 2 - 1]! + lo[lo.length / 2]!) / 2;
  const q3 = hi.length % 2 === 1 ? hi[(hi.length - 1) / 2]! : (hi[hi.length / 2 - 1]! + hi[hi.length / 2]!) / 2;
  return { q1, q2, q3, min, max };
}

/** Group a numeric column by category; ordered keys keep natural order, others rank by median. */
export function groupedDistributions(rows: unknown[][], gi: number, vi: number, limit: number) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r[vi]);
    if (isNaN(v)) continue;
    const k = String(r[gi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const stats = [...groups.entries()].map(([label, vals]) => {
    const s = [...vals].sort((a, b) => a - b);
    return { label, sorted: s, ...quartiles(s) };
  });
  const cls = classifyKeys(stats.map((s) => s.label));
  if (cls.kind !== "band") {
    const byKey = new Map(stats.map((s) => [s.label, s]));
    return cls.sorted.map((k) => byKey.get(k)!).filter(Boolean).slice(0, limit);
  }
  return stats.sort((a, b) => b.q2 - a.q2).slice(0, limit);
}

export function renderFullBox(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const color = cols[0]!;
  const ink = opts?.themeText ?? "#e8e8ec";
  const boxes = groupedDistributions(rows, xi, yi, 20);
  if (boxes.length === 0) return;
  const rect = plotOf(w, h, pad, opts);
  // Tukey whiskers: 1.5 × IQR, points beyond are outliers
  const tukey = boxes.map((b) => {
    const iqr = b.q3 - b.q1;
    const loF = b.q1 - 1.5 * iqr;
    const hiF = b.q3 + 1.5 * iqr;
    const inside = b.sorted.filter((v) => v >= loF && v <= hiF);
    return {
      lo: inside.length ? inside[0]! : b.min,
      hi: inside.length ? inside[inside.length - 1]! : b.max,
      outliers: b.sorted.filter((v) => v < loF || v > hiF),
    };
  });
  const gMin = Math.min(...boxes.map((b) => b.min));
  const gMax = Math.max(...boxes.map((b) => b.max));
  const ys = niceTicks(gMin, gMax, opts?.tickCount ?? 5, true);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const band = (rect.right - rect.left) / boxes.length;
  const boxW = Math.max(6, Math.min(band * 0.55, 72));
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const centers: number[] = [];

  boxes.forEach((box, i) => {
    const cx = rect.left + (i + 0.5) * band;
    centers.push(cx);
    const t = tukey[i]!;
    const q1y = Y(box.q1);
    const q3y = Y(box.q3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cx, Y(t.lo)); ctx.lineTo(cx, q1y);
    ctx.moveTo(cx, q3y); ctx.lineTo(cx, Y(t.hi));
    ctx.moveTo(cx - boxW * 0.25, Y(t.lo)); ctx.lineTo(cx + boxW * 0.25, Y(t.lo));
    ctx.moveTo(cx - boxW * 0.25, Y(t.hi)); ctx.lineTo(cx + boxW * 0.25, Y(t.hi));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(cx - boxW / 2, q3y, boxW, Math.max(1, q1y - q3y));
    ctx.globalAlpha = 1;
    ctx.strokeRect(cx - boxW / 2, q3y, boxW, Math.max(1, q1y - q3y));
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - boxW / 2, Y(box.q2));
    ctx.lineTo(cx + boxW / 2, Y(box.q2));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    for (const v of t.outliers.slice(0, 200)) {
      ctx.beginPath();
      ctx.arc(cx, Y(v), 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    pushHit(opts, {
      shape: "rect", x: rect.left + i * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, box.label]],
      summary: {
        columns: [xName, "Rows", `Median ${yName}`, "Q1 – Q3", "Min – Max"],
        row: [
          box.label,
          formatTooltipNumber(box.sorted.length),
          formatTooltipNumber(box.q2),
          `${formatTooltipNumber(box.q1)} – ${formatTooltipNumber(box.q3)}`,
          `${formatTooltipNumber(box.min)} – ${formatTooltipNumber(box.max)}`,
        ],
      },
    });
  });
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, boxes.map((b) => b.label), centers, band, w, h, rect, opts, "nominal");
}

export function renderFullArea(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  y2Idx = -1,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const rect = plotOf(w, h, pad, opts);
  const span = rect.right - rect.left;
  const tb = timeBuckets(rows, xi);
  const model = buildXModel([...new Set(rows.map(tb.keyOf))]);
  if (model.keys.length === 0) return;
  const keyIndex = new Map(model.keys.map((k, i) => [k, i]));

  // Series in first-appearance order (top 8 by rows when crowded)
  const seriesOrder: string[] = [];
  const seriesCount = new Map<string, number>();
  for (const r of rows) {
    const g = ci >= 0 ? String(r[ci]) : "";
    if (!seriesCount.has(g)) seriesOrder.push(g);
    seriesCount.set(g, (seriesCount.get(g) ?? 0) + 1);
  }
  const keep = new Set([...seriesOrder].sort((a, b) => seriesCount.get(b)! - seriesCount.get(a)!).slice(0, 8));
  const series = seriesOrder.filter((g) => keep.has(g));
  const buckets = series.map(() => model.keys.map(() => [] as number[]));
  for (const r of rows) {
    const si = series.indexOf(ci >= 0 ? String(r[ci]) : "");
    const ki = keyIndex.get(tb.keyOf(r));
    if (si < 0 || ki == null) continue;
    if (yi < 0) buckets[si]![ki]!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) buckets[si]![ki]!.push(v);
    }
  }
  let values = buckets.map((b) => b.map((vals) => (vals.length ? aggregateValues(vals, agg) : 0)));
  const rollW = opts?.rollingWindow ?? null;
  const normMode = (opts?.seriesNormalize ?? null) as SeriesNormalize | null;
  if (rollW || normMode) {
    values = values.map((vals) => {
      let v = vals;
      if (rollW) v = rollingMean(v, rollW);
      if (normMode) v = normalizeSeriesValues(v, normMode);
      return v;
    });
  }
  const tops: number[][] = [];
  let maxStack = 0;
  let minVal = 0;
  values.forEach((vals, si) => {
    tops.push(vals.map((v, ki) => (si === 0 ? 0 : tops[si - 1]![ki]!) + Math.max(0, v)));
    for (const v of vals) minVal = Math.min(minVal, v);
  });
  for (const t of tops[tops.length - 1] ?? []) maxStack = Math.max(maxStack, t);

  // Optional Y2 / earlier-half overlays — extend the value scale
  const overlayPts: { label: string; pts: { ki: number; v: number }[] }[] = [];
  if (y2Idx >= 0 && y2Idx !== yi) {
    const byX = model.keys.map(() => [] as number[]);
    for (const r of rows) {
      const ki = keyIndex.get(tb.keyOf(r));
      if (ki == null) continue;
      const v = Number(r[y2Idx]);
      if (!isNaN(v)) byX[ki]!.push(v);
    }
    const pts = model.keys.map((_, ki) => ({ ki, v: byX[ki]!.length ? aggregateValues(byX[ki]!, agg) : NaN })).filter((p) => !isNaN(p.v));
    for (const p of pts) {
      minVal = Math.min(minVal, p.v);
      maxStack = Math.max(maxStack, p.v);
    }
    overlayPts.push({ label: opts?.fieldNames?.[y2Idx] ?? "Compare Y", pts });
  }
  if (opts?.comparePrevious && model.keys.length >= 4 && series.length === 1) {
    const mid = Math.floor(model.keys.length / 2);
    const pts = values[0]!
      .slice(0, mid)
      .map((v, i) => ({ ki: mid + i, v }));
    overlayPts.push({ label: "Earlier half", pts });
  }

  // A single series may dip below zero; stacked series stack their positive parts
  let yLo = series.length === 1 ? minVal : 0;
  let yHi = maxStack;
  if (opts?.sharedValueDomain) {
    yLo = opts.sharedValueDomain.min;
    yHi = opts.sharedValueDomain.max;
  }
  const yScaleKind = (opts?.yScale ?? "linear") as YScaleKind;
  if (yScaleKind !== "linear") {
    const d = scaleDomain(yLo, yHi, yScaleKind);
    yLo = d.min;
    yHi = d.max;
  }
  const ys = niceZeroScale(yLo, yHi, opts?.tickCount ?? 5);
  const Ylin = linear(ys.min, ys.max, rect.bottom, rect.top);
  const Y = (v: number) => {
    if (yScaleKind === "linear") return Ylin(v);
    const t = scaleY(v, ys.min, ys.max, yScaleKind);
    return rect.bottom - t * (rect.bottom - rect.top);
  };
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const X = (ki: number) => rect.left + model.pos[ki]! * span;
  drawChartGrid(ctx, w, h, rect, opts, { x: model.kind === "number" ? model.domain : null, y: [ys.min, ys.max] });

  ctx.lineCap = opts?.lineCap ?? "round";
  ctx.lineJoin = opts?.lineJoin ?? "round";
  const single = series.length === 1;
  series.forEach((_, si) => {
    const color = cols[si % cols.length]!;
    const top = single ? values[0]! : tops[si]!;
    const base = single ? model.keys.map(() => 0) : si === 0 ? model.keys.map(() => 0) : tops[si - 1]!;
    ctx.fillStyle = color;
    ctx.globalAlpha = single ? 0.3 : Math.min(0.85, opts?.opacity ?? 0.75);
    ctx.beginPath();
    model.keys.forEach((_, ki) => (ki === 0 ? ctx.moveTo(X(ki), Y(top[ki]!)) : ctx.lineTo(X(ki), Y(top[ki]!))));
    for (let ki = model.keys.length - 1; ki >= 0; ki--) ctx.lineTo(X(ki), Y(base[ki]!));
    ctx.closePath();
    ctx.fill();
    // Crisp top edge so each layer reads as a line, not just a blob
    ctx.globalAlpha = 1;
    ctx.strokeStyle = single ? color : (opts?.themeBg ?? "#111114");
    ctx.lineWidth = single ? (opts?.lineWidth ?? 2) : 0.75;
    ctx.beginPath();
    model.keys.forEach((_, ki) => (ki === 0 ? ctx.moveTo(X(ki), Y(top[ki]!)) : ctx.lineTo(X(ki), Y(top[ki]!))));
    ctx.stroke();
  });

  overlayPts.forEach((ov, oi) => {
    if (ov.pts.length < 2) return;
    const color = cols[(series.length + oi) % cols.length]!;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ov.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.ki), Y(p.v)) : ctx.lineTo(X(p.ki), Y(p.v))));
    ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.globalAlpha = 1;

  // One hover column per x key, reporting every layer
  const xName = fieldLabel(opts, xi) + (tb.unit ? ` (${tb.unit})` : "");
  const vTitle = valueTitle(opts, yi);
  const shown = series.slice(0, 6);
  model.keys.forEach((key, ki) => {
    const x = X(ki);
    const prev = ki > 0 ? X(ki - 1) : rect.left;
    const next = ki < model.keys.length - 1 ? X(ki + 1) : rect.right;
    const x0 = ki > 0 ? (prev + x) / 2 : rect.left;
    const x1 = ki < model.keys.length - 1 ? (x + next) / 2 : rect.right;
    const total = values.reduce((s, v) => s + v[ki]!, 0);
    pushHit(opts, {
      shape: "rect", x: x0, y: rect.top, w: Math.max(1, x1 - x0), h: rect.bottom - rect.top,
      match: tb.unit ? [] : [[xi, key]],
      rowIndex: tb.unit ? tb.firstRow.get(key) : undefined,
      summary: single
        ? { columns: [xName, vTitle], row: [key, formatTooltipNumber(total)] }
        : {
          columns: [xName, ...shown, "Total"],
          row: [key, ...shown.map((_, si) => formatTooltipNumber(values[si]![ki]!)), formatTooltipNumber(total)],
        },
    });
  });
  const legend = [
    ...series.map((label, si) => ({ label: label || "series", color: cols[si % cols.length]! })),
    ...overlayPts.map((ov, oi) => ({ label: ov.label, color: cols[(series.length + oi) % cols.length]! })),
  ];
  if (legend.length > 1) setLegend(opts, legend);
  if (ys.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawXModelAxis(ctx, model, w, h, rect, opts);
}
