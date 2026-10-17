// =================================================================
// Canvas 2D bar and histogram renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { aggregateValues, fieldLabel, plotOf, pushHit, setLegend, valueTitle } from "./plumbing";
import { classifyKeys, formatAxisValue, formatDataValue, histogramBins, linear, niceTicks, niceZeroScale } from "../chartAxes";
import { DEFAULT_TOP_N, clampTopN } from "../chartFacets";
import { drawBandAxisX, drawBandAxisY, drawChartGrid, drawChartTicks } from "../chartLooks";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { type BarFacetHitPayload, formatTooltipNumber } from "../chartTooltip";
import { type YAggregateOption } from "../recommendations";
import { axisFont, barPath, drawZeroLine, labelGutter, widestText } from "./axisHelpers";
import { DEFAULT_COLORS } from "./shared";

export type BarModel = { entries: [string, number][]; rowCounts: Map<string, number>; ordered: boolean };

/** Aggregate simple bars. Ordered keys (numbers, dates) keep their order; categories rank by value (Top N). */
export function computeBarModel(rows: unknown[][], xi: number, yi: number, agg: YAggregateOption, topN = DEFAULT_TOP_N): BarModel {
  const limit = clampTopN(topN, DEFAULT_TOP_N);
  const groups = new Map<string, number[]>();
  const rowCounts = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    rowCounts.set(k, (rowCounts.get(k) ?? 0) + 1);
    if (yi < 0) groups.get(k)!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) groups.get(k)!.push(v);
    }
  }
  const all = [...groups.entries()].map(([label, vals]) => [label, aggregateValues(vals, agg)] as [string, number]);
  const cls = classifyKeys(all.map((e) => e[0]));
  if (cls.kind !== "band" && cls.sorted.length >= 3 && cls.sorted.length <= Math.max(40, limit)) {
    const byKey = new Map(all);
    return { entries: cls.sorted.map((k) => [k, byKey.get(k) ?? 0] as [string, number]), rowCounts, ordered: true };
  }
  return { entries: all.sort((a, b) => b[1] - a[1]).slice(0, limit), rowCounts, ordered: false };
}

/** Horizontal bands when the stage is portrait or category names can't sit flat under their bars. */
export function barsShouldBeHorizontal(ctx: CanvasRenderingContext2D, model: BarModel, w: number, h: number, pad: number, opts?: ChartRenderOpts): boolean {
  const n = model.entries.length;
  if (n === 0) return false;
  if (h > w * 1.05) return true;
  if (model.ordered) return false;
  const band = (w - 2 * pad) / n;
  const widest = widestText(ctx, model.entries.map((e) => e[0]), axisFont(opts));
  return widest > band - 6;
}

export function renderFullBar(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  facet?: BarFacetHitPayload | null,
  horizontal = false,
  model?: BarModel,
  colorByCategory = false,
  reverse = false,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const cornerR = opts?.barCornerRadius ?? 3;
  const showDataLabels = opts?.showDataLabels ?? false;
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const rect = plotOf(w, h, pad, opts);
  const chartW = rect.right - rect.left;
  const xName = fieldLabel(opts, xi, "category");
  const vTitle = valueTitle(opts, yi);
  const vBarDir = (val: number): "up" | "down" => ((val >= 0) !== reverse ? "up" : "down");
  const hBarDir = (val: number): "right" | "left" => ((val >= 0) !== reverse ? "right" : "left");

  if (facet && ci >= 0 && facet.grid.length > 0 && facet.subLabels.length > 0) {
    const { xLabels, subLabels, grid, stackMode } = facet;
    const nx = xLabels.length;
    const ns = subLabels.length;
    const band = chartW / nx;
    const cName = fieldLabel(opts, ci, "group");
    setLegend(opts, subLabels.map((label, si) => ({ label, color: cols[si % cols.length]! })));

    let lo = 0;
    let hi = 0;
    if (stackMode === "grouped") {
      for (const row of grid) for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    } else if (stackMode === "stacked") {
      for (const row of grid) hi = Math.max(hi, row.reduce((s, v) => s + Math.max(0, v), 0));
    } else {
      hi = 100;
    }
    const scale = stackMode === "percent" ? niceTicks(0, 100, opts?.tickCount ?? 5, true) : niceZeroScale(lo, hi, opts?.tickCount ?? 5);
    const Y = reverse
      ? linear(scale.min, scale.max, rect.top, rect.bottom)
      : linear(scale.min, scale.max, rect.bottom, rect.top);
    if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
    drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [scale.min, scale.max] });

    const centers: number[] = [];
    for (let gi = 0; gi < nx; gi++) {
      const xk = xLabels[gi]!;
      const gx = rect.left + gi * band;
      centers.push(gx + band / 2);
      if (stackMode === "grouped") {
        const inner = band * 0.8;
        const innerW = inner / ns;
        for (let si = 0; si < ns; si++) {
          const val = grid[gi]![si]!;
          const x = gx + (band - inner) / 2 + si * innerW;
          const y0 = Y(0);
          const y1 = Y(val);
          const top = Math.min(y0, y1);
          const bh = Math.max(val === 0 ? 0 : 1, Math.abs(y1 - y0));
          ctx.fillStyle = cols[si % cols.length]!;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          barPath(ctx, x + 0.5, top, Math.max(1, innerW - 1), bh, cornerR, vBarDir(val));
          ctx.fill();
          if (showDataLabels && innerW >= 18 && bh > 0) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = axisLabelColor;
            ctx.font = axisFont(opts, 10);
            ctx.textAlign = "center";
            const tipAtLow = (val >= 0) !== reverse;
            ctx.textBaseline = tipAtLow ? "bottom" : "top";
            ctx.fillText(formatDataValue(val), x + innerW / 2, tipAtLow ? top - 3 : top + bh + 3);
          }
          pushHit(opts, {
            shape: "rect", x, y: rect.top, w: innerW, h: rect.bottom - rect.top,
            match: [[xi, xk], [ci, subLabels[si]!]],
            summary: { columns: [xName, cName, vTitle], row: [xk, subLabels[si]!, formatTooltipNumber(val)] },
          });
        }
      } else {
        const bw = Math.min(band * 0.72, 96);
        const x0 = gx + (band - bw) / 2;
        const total = grid[gi]!.reduce((s, v) => s + Math.max(0, v), 0) || 1;
        let acc = 0;
        for (let si = 0; si < ns; si++) {
          const v = Math.max(0, grid[gi]![si]!);
          const share = (v / total) * 100;
          const a = stackMode === "percent" ? acc / total * 100 : acc;
          const b = stackMode === "percent" ? (acc + v) / total * 100 : acc + v;
          acc += v;
          const yTop = Y(b);
          const yBot = Y(a);
          if (yBot - yTop < 0.25) continue;
          ctx.fillStyle = cols[si % cols.length]!;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.rect(x0, yTop, bw, yBot - yTop);
          ctx.fill();
          // Hairline separator between stacked segments
          ctx.globalAlpha = 1;
          ctx.strokeStyle = opts?.themeBg ?? "#111114";
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(x0, yTop);
          ctx.lineTo(x0 + bw, yTop);
          ctx.stroke();
          pushHit(opts, {
            shape: "rect", x: x0, y: yTop, w: bw, h: yBot - yTop,
            match: [[xi, xk], [ci, subLabels[si]!]],
            summary: {
              columns: [xName, cName, vTitle, "Share"],
              row: [xk, subLabels[si]!, formatTooltipNumber(v), `${share.toFixed(share < 10 ? 1 : 0)}%`],
            },
          });
        }
      }
    }
    ctx.globalAlpha = 1;
    if (scale.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
    drawChartTicks(ctx, 0, 1, scale.min, scale.max, w, h, rect, opts, {
      x: false,
      yFormat: stackMode === "percent" ? (v) => `${Math.round(v)}%` : undefined,
    });
    drawBandAxisX(ctx, xLabels, centers, band, w, h, rect, opts, "nominal");
    return;
  }

  const bm = model ?? computeBarModel(rows, xi, yi, yi < 0 ? "count" : (opts?.yAggregate ?? "sum"));
  const entries = bm.entries;
  if (entries.length === 0) return;
  const n = entries.length;
  const vals = entries.map((e) => e[1]);
  // Ordered bars: ghost the earlier half onto the later half (same contract as line/area).
  const ghostCompare =
    !!opts?.comparePrevious && bm.ordered && n >= 4
      ? (() => {
          const mid = Math.floor(n / 2);
          return entries.slice(0, mid).map((e, i) => ({
            at: mid + i,
            fromLabel: e[0],
            val: e[1],
          })).filter((g) => g.at < n);
        })()
      : [];
  let vMin = Math.min(0, ...vals, ...ghostCompare.map((g) => g.val));
  let vMax = Math.max(0, ...vals, ...ghostCompare.map((g) => g.val));
  if (opts?.sharedValueDomain) {
    vMin = opts.sharedValueDomain.min;
    vMax = opts.sharedValueDomain.max;
  }
  const colorOf = (i: number) => (colorByCategory ? cols[i % cols.length]! : cols[0]!);
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const summaryFor = (label: string, val: number) => {
    const rowsIn = bm.rowCounts.get(label) ?? 0;
    return agg === "count"
      ? { columns: [xName, vTitle], row: [label, formatTooltipNumber(val)] }
      : { columns: [xName, vTitle, "Rows"], row: [label, formatTooltipNumber(val), formatTooltipNumber(rowsIn)] };
  };
  if (colorByCategory) setLegend(opts, []);
  if (ghostCompare.length) {
    setLegend(opts, [
      { label: vTitle, color: cols[0]! },
      { label: "Earlier half", color: axisLabelColor },
    ]);
  }

  if (horizontal) {
    // Category names read left-to-right in a gutter; values sit at the bar ends.
    const band = (rect.bottom - rect.top) / n;
    const labelW = labelGutter(ctx, entries.map((e) => e[0]), w, pad, opts);
    const x0 = rect.left + labelW;
    const valueFont = axisFont(opts);
    const valueRoom = widestText(ctx, vals.map(formatDataValue), valueFont) + 10;
    const plotW = Math.max(8, rect.right - x0 - valueRoom);
    const X = reverse
      ? linear(vMin, vMax || 1, x0 + plotW, x0)
      : linear(vMin, vMax || 1, x0, x0 + plotW);
    if (opts) opts.scales = { x: X, valueAxis: "x", rect: { left: x0, top: rect.top, right: x0 + plotW, bottom: rect.bottom } };
    const barT = Math.max(2, Math.min(band * 0.72, 30));
    const centers: number[] = [];
    for (const g of ghostCompare) {
      const yMid = rect.top + band * (g.at + 0.5);
      const xa = X(0);
      const xb = X(g.val);
      const left = Math.min(xa, xb);
      const len = Math.max(g.val === 0 ? 0 : 1, Math.abs(xb - xa));
      ctx.fillStyle = axisLabelColor;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      if (g.val !== 0) barPath(ctx, left, yMid - barT / 2, len, barT, cornerR, hBarDir(g.val));
      else ctx.rect(left, yMid - barT / 2, len, barT);
      ctx.fill();
    }
    entries.forEach(([label, val], i) => {
      const yMid = rect.top + band * (i + 0.5);
      centers.push(yMid);
      const xa = X(0);
      const xb = X(val);
      const left = Math.min(xa, xb);
      const len = Math.max(val === 0 ? 0 : 1, Math.abs(xb - xa));
      ctx.fillStyle = colorOf(i);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      if (val !== 0) barPath(ctx, left, yMid - barT / 2, len, barT, cornerR, hBarDir(val));
      else ctx.rect(left, yMid - barT / 2, len, barT);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = axisLabelColor;
      ctx.font = valueFont;
      ctx.textBaseline = "middle";
      const tipRight = (val >= 0) !== reverse;
      ctx.textAlign = tipRight ? "left" : "right";
      ctx.fillText(formatDataValue(val), tipRight ? left + len + 5 : left - 5, yMid);
      pushHit(opts, {
        shape: "rect", x: rect.left, y: rect.top + band * i, w: rect.right - rect.left, h: band,
        match: [[xi, label]],
        summary: summaryFor(label, val),
      });
    });
    ctx.textBaseline = "alphabetic";
    // Baseline at zero replaces the L-frame (category labels sit left of it)
    drawZeroLine(ctx, X(0), rect.top, X(0), rect.bottom, opts);
    drawBandAxisY(ctx, entries.map((e) => e[0]), centers, band, x0 - 8, labelW - 10, opts);
    ctx.globalAlpha = 1;
    return;
  }

  const scale = niceZeroScale(vMin, vMax, opts?.tickCount ?? 5);
  const Y = reverse
    ? linear(scale.min, scale.max, rect.top, rect.bottom)
    : linear(scale.min, scale.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [scale.min, scale.max] });
  const band = chartW / n;
  const barW = Math.max(1, Math.min(band * (n > 24 ? 0.86 : 0.72), 96));
  const centers: number[] = [];
  for (const g of ghostCompare) {
    const cx = rect.left + band * (g.at + 0.5);
    const y0 = Y(0);
    const y1 = Y(g.val);
    const top = Math.min(y0, y1);
    const bh = Math.max(g.val === 0 ? 0 : 1, Math.abs(y1 - y0));
    ctx.fillStyle = axisLabelColor;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    barPath(ctx, cx - barW / 2, top, barW, bh, cornerR, vBarDir(g.val));
    ctx.fill();
  }
  entries.forEach(([label, val], i) => {
    const cx = rect.left + band * (i + 0.5);
    centers.push(cx);
    const y0 = Y(0);
    const y1 = Y(val);
    const top = Math.min(y0, y1);
    const bh = Math.max(val === 0 ? 0 : 1, Math.abs(y1 - y0));
    ctx.fillStyle = colorOf(i);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    barPath(ctx, cx - barW / 2, top, barW, bh, cornerR, vBarDir(val));
    ctx.fill();
    if (showDataLabels) {
      const lbl = formatDataValue(val);
      ctx.globalAlpha = 1;
      ctx.fillStyle = axisLabelColor;
      ctx.font = axisFont(opts, 10);
      if (ctx.measureText(lbl).width <= band + 2) {
        ctx.textAlign = "center";
        const tipAtLow = (val >= 0) !== reverse;
        ctx.textBaseline = tipAtLow ? "bottom" : "top";
        ctx.fillText(lbl, cx, tipAtLow ? top - 3 : top + bh + 3);
      }
    }
    pushHit(opts, {
      shape: "rect", x: rect.left + band * i, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, label]],
      summary: summaryFor(label, val),
    });
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
  if (scale.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, scale.min, scale.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, entries.map((e) => e[0]), centers, band, w, h, rect, opts, bm.ordered ? "ordered" : "nominal");
}

export function renderFullHistogram(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const values = rows.map((r) => Number(r[xi]));
  const bins = histogramBins(values);
  if (!bins) return;
  const rect = plotOf(w, h, pad, opts);
  const maxC = Math.max(1, ...bins.counts);
  const ys = niceZeroScale(0, maxC, opts?.tickCount ?? 5);
  const X = linear(bins.lo, bins.hi, rect.left, rect.right);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { x: X, y: Y, valueAxis: "y", rect };
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });

  // Representative row per bin for the tooltip
  const firstRow = new Array<number>(bins.counts.length).fill(-1);
  values.forEach((v, ri) => {
    if (!Number.isFinite(v)) return;
    const bi = Math.min(bins.counts.length - 1, Math.max(0, Math.floor((v - bins.lo) / bins.step + 1e-9)));
    if (firstRow[bi]! < 0) firstRow[bi] = ri;
  });
  const name = fieldLabel(opts, xi);
  bins.counts.forEach((c, i) => {
    const a = bins.lo + i * bins.step;
    const b = a + bins.step;
    const x0 = X(a);
    const x1 = X(b);
    const top = Y(c);
    ctx.fillStyle = cols[0]!;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x0 + 0.5, top, Math.max(1, x1 - x0 - 1), rect.bottom - top);
    if (firstRow[i]! >= 0) {
      pushHit(opts, {
        shape: "rect", x: x0, y: rect.top, w: x1 - x0, h: rect.bottom - rect.top,
        match: [],
        rowIndex: firstRow[i]!,
        summary: {
          columns: [name, "Count"],
          row: [`${formatAxisValue(a, bins.step)} – ${formatAxisValue(b, bins.step)}`, formatTooltipNumber(c)],
        },
      });
    }
  });
  ctx.globalAlpha = 1;
  drawChartTicks(ctx, bins.lo, bins.hi, ys.min, ys.max, w, h, rect, opts);
}
