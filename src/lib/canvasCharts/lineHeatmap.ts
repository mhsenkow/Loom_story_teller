import { addDensityCell, densityDomain, densityFraction, densityMeasure, densityPlot, densityValue, type DensityCell } from "./densityCells";
import { chartNumber } from "../chartNumbers";
// =================================================================
// Canvas 2D line and heatmap renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { computeAnalysis, drawAnalysisLayers } from "./analysisLayers";
import { aggregateValues, fieldLabel, plotOf, pushHit, setLegend, valueTitle } from "./plumbing";
import { buildXModel, classifyKeys, formatDataValue, linear, niceTicks } from "../chartAxes";
import { contrastingInk } from "../chartLayout";
import { type PlotRect, drawBandAxisX, drawBandAxisY, drawChartGrid, drawChartTicks, drawColorRamp } from "../chartLooks";
import { sampleContinuous } from "../chartPalettes";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { chartTypeRamp } from "../chartType";
import { formatTooltipNumber } from "../chartTooltip";
import { type SeriesNormalize, type YScaleKind, anomalyRowIndices, normalizeSeriesValues, rollingMean, rollingStd, scaleDomain, scaleY } from "../dsTransforms";
import { type YAggregateOption } from "../recommendations";
import { axisFont, densityStops, drawXModelAxis, drawZeroLine, labelGutter, timeBuckets } from "./axisHelpers";
import { applyLineDash, drawSmoothLine, numRange } from "./primitives";
import { DEFAULT_COLORS } from "./shared";
import { chartEmojiLabel } from "../chartEmoji";
import { FORECAST_METHOD_LABEL } from "../timeSeriesAnalysis";
import { drawMarkSymbol, markSymbols } from "../markSymbols";

export function renderFullLine(
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
  const alpha = opts?.opacity ?? 0.9;
  const lineW = opts?.lineWidth ?? 2;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "mean");
  const rect = plotOf(w, h, pad, opts);
  const span = rect.right - rect.left;
  const comparePrev = !!opts?.comparePrevious;

  // Series in first-appearance order; cap at the 10 largest so the legend stays readable
  const seriesRows = new Map<string, unknown[][]>();
  for (const r of rows) {
    const k = ci >= 0 ? String(r[ci]) : "";
    if (!seriesRows.has(k)) seriesRows.set(k, []);
    seriesRows.get(k)!.push(r);
  }
  let series = [...seriesRows.entries()];
  if (series.length > 10) {
    const keep = new Set(series.sort((a, b) => b[1].length - a[1].length).slice(0, 10).map((s) => s[0]));
    series = [...seriesRows.entries()].filter(([k]) => keep.has(k));
  }

  const tb = timeBuckets(rows, xi);
  const model = buildXModel([...new Set(rows.map(tb.keyOf))]);
  if (model.keys.length === 0) return;
  const posOf = new Map(model.keys.map((k, i) => [k, model.pos[i]!]));

  const seriesFrom = (measureIdx: number, nameSuffix = "") =>
    series.map(([name, gRows], seriesIndex) => {
      const byX = new Map<string, number[]>();
      for (const r of gRows) {
        const k = tb.keyOf(r);
        if (!posOf.has(k)) continue;
        if (!byX.has(k)) byX.set(k, []);
        if (measureIdx < 0 || agg === "count") byX.get(k)!.push(1);
        else {
          const v = chartNumber(r[measureIdx]);
          if (r[measureIdx] != null && r[measureIdx] !== "" && Number.isFinite(v)) byX.get(k)!.push(v);
        }
      }
      const pts = model.keys
        .filter((k) => byX.has(k) && (measureIdx < 0 || byX.get(k)!.length > 0))
        .map((k) => ({ key: k, t: posOf.get(k)!, v: aggregateValues(byX.get(k)!, agg) }));
      // Single series + Compare Y: name both lines by their fields, not "series".
      const field = opts?.fieldNames?.[measureIdx];
      const label = nameSuffix ? (name ? `${name}${nameSuffix}` : field ?? "Compare Y") : name || (y2Idx >= 0 && field ? field : name);
      return { name: label, pts, compare: !!nameSuffix, colorIndex: seriesIndex + (nameSuffix ? series.length : 0), measureIdx };
    }).filter((s) => s.pts.length > 0);

  let data = seriesFrom(yi);
  if (data.length === 0) return;

  if (y2Idx >= 0 && y2Idx !== yi) {
    const y2 = seriesFrom(y2Idx, ` · ${opts?.fieldNames?.[y2Idx] ?? "Y2"}`).map((s) => ({ ...s, compare: true }));
    data = [...data, ...y2];
  }

  // Rolling mean / rebase on primary series (not compare overlays)
  const rollW = opts?.rollingWindow ?? null;
  const normMode = (opts?.seriesNormalize ?? null) as SeriesNormalize | null;
  // Bollinger-style ±1σ band around a single rolling mean (raw values, same window).
  let rollBand: { t: number; lo: number; hi: number }[] | null = null;
  if (rollW && !normMode && ci < 0 && data.length === 1 && data[0]!.pts.length >= 3) {
    const raw = data[0]!.pts.map((p) => p.v);
    const mean = rollingMean(raw, rollW);
    const sd = rollingStd(raw, rollW);
    rollBand = data[0]!.pts.map((p, i) => ({ t: p.t, lo: mean[i]! - sd[i]!, hi: mean[i]! + sd[i]! }));
  }
  if (rollW || normMode) {
    data = data.map((s) => {
      let vals = s.pts.map((p) => p.v);
      if (rollW) vals = rollingMean(vals, rollW);
      if (normMode) vals = normalizeSeriesValues(vals, normMode);
      return { ...s, pts: s.pts.map((p, i) => ({ ...p, v: vals[i]! })) };
    });
  }

  // Earlier half of the X domain as a dashed overlay (same series, first 50% of keys)
  if (comparePrev && model.keys.length >= 4) {
    const mid = Math.floor(model.keys.length / 2);
    const earlierKeys = model.keys.slice(0, mid);
    const laterKeys = model.keys.slice(mid);
    const prevOverlay = data.filter(s => !s.compare)
      .map((s) => ({
        name: `${s.name || "series"} (earlier)`,
        pts: earlierKeys
          .map((key, i) => {
            const laterKey = laterKeys[i];
            if (!laterKey) return null;
            const pt = s.pts.find((p) => p.key === key);
            if (!pt) return null;
            const tLater = posOf.get(laterKey);
            if (tLater == null) return null;
            return { ...pt, key: laterKey, t: tLater };
          })
          .filter((p): p is NonNullable<typeof p> => p != null),
        compare: true as const,
        colorIndex: s.colorIndex,
        measureIdx: s.measureIdx,
      }))
      .filter((s) => s.pts.length >= 2);
    data = [...prevOverlay, ...data];
  }

  const originalDomain = model.domain ? [...model.domain] as [number, number] : null;
  const analysisConfig = ci < 0 && y2Idx < 0 && !comparePrev && !rollW && !normMode && model.domain && (opts?.yScale ?? "linear") === "linear" ? opts?.analysis : undefined;
  const analysis = computeAnalysis(analysisConfig && originalDomain ? data[0].pts.map(p => ({ x: originalDomain[0] + p.t * (originalDomain[1] - originalDomain[0]), y: p.v })) : [], analysisConfig);
  let domainFraction = 1;
  if (analysis.forecast && model.domain && originalDomain) {
    model.domain = [originalDomain[0], analysis.forecast.points.at(-1)!.x];
    domainFraction = (originalDomain[1] - originalDomain[0]) / (model.domain[1] - model.domain[0]);
    model.pos = model.pos.map(t => t * domainFraction);
  }

  if (opts?.yScale === "log") {
    data = data.map(s => ({ ...s, pts: s.pts.filter(p => p.v > 0) })).filter(s => s.pts.length);
    if (!data.length) return;
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of data) for (const p of s.pts) { yMin = Math.min(yMin, p.v); yMax = Math.max(yMax, p.v); }
  for (const p of analysis.forecast?.points ?? []) { yMin = Math.min(yMin, p.lower); yMax = Math.max(yMax, p.upper); }
  if (opts?.yScale !== "log") for (const b of rollBand ?? []) { yMin = Math.min(yMin, b.lo); yMax = Math.max(yMax, b.hi); }
  if (opts?.sharedValueDomain) {
    yMin = opts.sharedValueDomain.min;
    yMax = opts.sharedValueDomain.max;
  } else if (opts?.yScale !== "log" && !normMode && (agg === "count" || (agg === "sum" && yMin >= 0))) yMin = Math.min(0, yMin);
  const yScaleKind = (opts?.yScale ?? "linear") as YScaleKind;
  if (yScaleKind !== "linear") {
    const d = scaleDomain(yMin, yMax, yScaleKind);
    yMin = d.min;
    yMax = d.max;
  }
  const ys = yScaleKind === "linear" ? niceTicks(yMin, yMax, opts?.tickCount ?? 5, true) : { min: yMin, max: yMax };
  const Y = (v: number) => {
    if (yScaleKind === "linear") return linear(ys.min, ys.max, rect.bottom, rect.top)(v);
    const t = scaleY(v, ys.min, ys.max, yScaleKind);
    return rect.bottom - t * (rect.bottom - rect.top);
  };
  if (opts) {
    const dom = model.domain;
    opts.scales = { y: Y, x: dom ? (v: number) => rect.left + ((v - dom[0]) / (dom[1] - dom[0] || 1)) * span : undefined, valueAxis: "y", rect };
  }
  const X = (t: number) => rect.left + t * domainFraction * span;

  drawChartGrid(ctx, w, h, rect, opts, { x: model.kind === "number" ? model.domain : null, y: [ys.min, ys.max] });

  const xName = fieldLabel(opts, xi) + (tb.unit ? ` (${tb.unit})` : "");
  const cName = fieldLabel(opts, ci, "series");
  const vTitle = valueTitle(opts, yi, "mean");
  const maxPts = Math.max(...data.map((s) => s.pts.length));
  const hitR = Math.max(4, Math.min(12, span / Math.max(1, maxPts) / 2));
  const anomKeys = new Set<string>();
  if (opts?.anomalyHighlight && yi >= 0) {
    for (const i of anomalyRowIndices(rows, yi)) {
      const k = tb.keyOf(rows[i]!);
      if (k) anomKeys.add(k);
    }
  }
  const symbols = markSymbols(opts, opts?.fieldNames, rows);
  const symbolOf = (s: { name: string; compare: boolean }) => symbols.of(seriesRows.get(s.name)?.[0]);
  const markR = Math.max(3, (opts?.pointSize ?? 10) * 0.45);
  if (rollBand && rollBand.length >= 2) {
    // Soft ±1σ envelope behind the rolling mean
    ctx.beginPath();
    rollBand.forEach((b, i) => (i ? ctx.lineTo(X(b.t), Y(b.hi)) : ctx.moveTo(X(b.t), Y(b.hi))));
    for (let i = rollBand.length - 1; i >= 0; i--) ctx.lineTo(X(rollBand[i]!.t), Y(Math.max(ys.min, rollBand[i]!.lo)));
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = cols[0]!;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Difference chart: shade the gap between Y and Compare Y by which one leads.
  const diffPair = ci < 0 && y2Idx >= 0 && !comparePrev ? [data.find((s) => !s.compare), data.find((s) => s.compare)] : null;
  if (diffPair?.[0] && diffPair[1]) {
    const bMap = new Map(diffPair[1].pts.map((p) => [p.key, p.v]));
    let shared = diffPair[0].pts.filter((p) => bMap.has(p.key)).map((p) => ({ t: p.t, a: p.v, b: bMap.get(p.key)! }));
    // Only meaningful when both measures live on the same scale (their ranges overlap).
    const aLo = Math.min(...shared.map((p) => p.a));
    const aHi = Math.max(...shared.map((p) => p.a));
    const bLo = Math.min(...shared.map((p) => p.b));
    const bHi = Math.max(...shared.map((p) => p.b));
    if (!(Math.min(aHi, bHi) >= Math.max(aLo, bLo))) shared = [];
    const aboveC = cols[diffPair[0].colorIndex % cols.length]!;
    const belowC = cols[diffPair[1].colorIndex % cols.length]!;
    ctx.globalAlpha = 0.22;
    for (let i = 1; i < shared.length; i++) {
      const p = shared[i - 1]!;
      const q = shared[i]!;
      const d0 = p.a - p.b;
      const d1 = q.a - q.b;
      const quad = (t0: number, a0: number, b0: number, t1: number, a1: number, b1: number, up: boolean) => {
        ctx.beginPath();
        ctx.moveTo(X(t0), Y(a0));
        ctx.lineTo(X(t1), Y(a1));
        ctx.lineTo(X(t1), Y(b1));
        ctx.lineTo(X(t0), Y(b0));
        ctx.closePath();
        ctx.fillStyle = up ? aboveC : belowC;
        ctx.fill();
      };
      if (d0 * d1 < 0) {
        // Lines cross inside the segment — split at the crossing.
        const f = d0 / (d0 - d1);
        const tc = p.t + f * (q.t - p.t);
        const vc = p.a + f * (q.a - p.a);
        quad(p.t, p.a, p.b, tc, vc, vc, d0 > 0);
        quad(tc, vc, vc, q.t, q.a, q.b, d1 > 0);
      } else quad(p.t, p.a, p.b, q.t, q.a, q.b, d0 + d1 >= 0);
    }
    ctx.globalAlpha = 1;
  }
  applyLineDash(ctx, opts?.lineStrokeStyle);
  data.forEach((s, si) => {
    const color = cols[s.colorIndex % cols.length]!;
    const pts = s.pts.map((p) => ({ x: X(p.t), y: Y(p.v) }));
    ctx.strokeStyle = color;
    ctx.lineWidth = s.compare ? Math.max(1.25, lineW * 0.9) : lineW;
    ctx.lineJoin = opts?.lineJoin ?? "round";
    ctx.lineCap = opts?.lineCap ?? "round";
    ctx.globalAlpha = s.compare ? alpha * 0.7 : alpha;
    if (s.compare) ctx.setLineDash([5, 4]);
    else applyLineDash(ctx, opts?.lineStrokeStyle);
    ctx.beginPath();
    if (opts?.lineCurveSmooth && pts.length >= 2) drawSmoothLine(ctx, pts);
    else pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    if (!s.compare && symbols.active && pts.length <= 160) {
      ctx.setLineDash([]);
      const symbol = symbolOf(s);
      for (const p of pts) drawMarkSymbol(ctx, symbol, p.x, p.y, markR, color, 1, opts?.themeBg);
      applyLineDash(ctx, opts?.lineStrokeStyle);
    } else if (!s.compare && pts.length <= 40) {
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, pts.length === 1 ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      applyLineDash(ctx, opts?.lineStrokeStyle);
    }
    if (!s.compare && anomKeys.size) {
      ctx.setLineDash([]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      s.pts.forEach((p, i) => {
        if (!anomKeys.has(p.key)) return;
        ctx.beginPath();
        ctx.arc(pts[i]!.x, pts[i]!.y, 6, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
    s.pts.forEach((p, i) => {
      const measureTitle = valueTitle(opts, s.measureIdx, "mean");
      pushHit(opts, {
        shape: "circle", cx: pts[i]!.x, cy: pts[i]!.y, r: hitR,
        // Bucketed keys aren't raw values — identify the bucket by its first row
        match: tb.unit ? [] : ci >= 0 ? [[xi, p.key], [ci, s.name]] : [[xi, p.key]],
        rowIndex: tb.unit ? tb.firstRow.get(p.key) : undefined,
        summary: ci >= 0
          ? { columns: [xName, cName, measureTitle], row: [p.key, s.name, formatTooltipNumber(p.v)] }
          : { columns: [xName, measureTitle], row: [p.key, formatTooltipNumber(p.v)] },
      });
    });
  });
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const legendSrc = data.filter((s) => !s.compare || y2Idx >= 0 || comparePrev);
  if (ci >= 0 || y2Idx >= 0 || comparePrev) {
    setLegend(opts, legendSrc.map((s, si) => {
      const symbol = symbols.categorical && !s.compare ? symbolOf(s) : null;
      const label = s.name || "series";
      return {
        label: symbol?.glyph && opts?.emojiField === opts?.fieldNames?.[ci] ? chartEmojiLabel(label, opts?.emojiField, opts?.emojiMap) : label,
        color: cols[s.colorIndex % cols.length]!,
        ...(symbol?.glyph ? { glyph: symbol.glyph } : symbol ? { shape: symbol.shape } : {}),
      };
    }));
  }
  if (analysisConfig && opts?.scales?.x) {
    drawAnalysisLayers(ctx, analysis, analysisConfig, model.kind, opts.scales.x, Y, rect, opts);
    const entries = [{ label: vTitle, color: cols[0] }];
    if (analysisConfig.forecast?.enabled) entries.push({ label: analysis.forecast ? `Forecast · ${FORECAST_METHOD_LABEL[analysisConfig.forecast.method ?? "line"]}` : "Forecast needs 8 valid points", color: cols[1] ?? cols[0] });
    if (analysisConfig.anomaly?.enabled) entries.push({ label: data[0].pts.length <= analysisConfig.anomaly.window ? "Anomalies need more history" : `${analysis.anomalies.length} unusual ${analysis.anomalies.length === 1 ? "point" : "points"}`, color: cols[2] ?? cols[0] });
    setLegend(opts, entries);
  }
  if (ys.min < 0 && ys.max > 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawXModelAxis(ctx, model, w, h, rect, opts);
}

export function renderFullHeatmap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const stops = densityStops(opts?.continuousStops?.length ? opts.continuousStops : (opts?.colors ?? DEFAULT_COLORS), opts?.themeBg);
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const measure = densityMeasure(opts);
  const alpha = opts?.opacity ?? 1;
  setLegend(opts, []);
  const ramp = (domain: { min: number; max: number }, rect: PlotRect) => {
    if (opts?.mini || opts?.legendPosition === "none") return;
    drawColorRamp(ctx, stops, sampleContinuous, Math.min(w - 38, rect.right + 10), rect.top + 14, Math.min(140, (rect.bottom - rect.top) * 0.5), formatDataValue(domain.min), formatDataValue(domain.max), opts, measure.title);
  };

  // Prefer quantitative density bins when both axes look numeric
  let numericHits = 0;
  const probe = Math.min(rows.length, 40);
  for (let i = 0; i < probe; i++) {
    const x = chartNumber(rows[i]![xi]);
    const y = chartNumber(rows[i]![yi]);
    if (!isNaN(x) && !isNaN(y)) numericHits++;
  }
  if (probe > 0 && numericHits / probe >= 0.7) {
    const rect = densityPlot(w, h, pad, opts);
    const plotW = rect.right - rect.left;
    const plotH = rect.bottom - rect.top;
    const [xMin, xMax] = numRange(rows, xi);
    const [yMin, yMax] = numRange(rows, yi);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const binsX = Math.min(36, Math.max(12, Math.floor(plotW / 18)));
    const binsY = Math.min(28, Math.max(10, Math.floor(plotH / 18)));
    const cells = new Map<number, DensityCell>();
    rows.forEach((r, ri) => {
      const x = chartNumber(r[xi]);
      const y = chartNumber(r[yi]);
      if (isNaN(x) || isNaN(y)) return;
      const bx = Math.min(binsX - 1, Math.max(0, Math.floor(((x - xMin) / xRange) * binsX)));
      const by = Math.min(binsY - 1, Math.max(0, Math.floor(((y - yMin) / yRange) * binsY)));
      addDensityCell(cells, by * binsX + bx, r[measure.index], ri);
    });
    const domain = densityDomain(cells.values(), measure.aggregate);
    const cellW = plotW / binsX;
    const cellH = plotH / binsY;
    for (let by = 0; by < binsY; by++) {
      for (let bx = 0; bx < binsX; bx++) {
        const cell = cells.get(by * binsX + bx);
        const c = densityValue(cell, measure.aggregate);
        if (c === null) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = sampleContinuous(stops, densityFraction(c, domain));
        const px = rect.left + bx * cellW;
        const py = rect.top + (binsY - 1 - by) * cellH;
        ctx.fillRect(px, py, Math.max(1, cellW - 0.5), Math.max(1, cellH - 0.5));
        if (!opts?.mini && opts?.showDataLabels && cellH >= chartTypeRamp(opts.axisFontSize).cell + 4) {
          const label = formatDataValue(c);
          ctx.font = axisFont(opts, chartTypeRamp(opts.axisFontSize).cell);
          if (ctx.measureText(label).width <= cellW - 4) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = contrastingInk(sampleContinuous(stops, densityFraction(c, domain)));
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, px + cellW / 2, py + cellH / 2);
          }
        }
        const x0 = xMin + (bx / binsX) * xRange;
        const y0 = yMin + (by / binsY) * yRange;
        pushHit(opts, {
          shape: "rect", x: px, y: py, w: cellW, h: cellH,
          match: [],
          rowIndex: cell!.row,
          summary: {
            columns: [xName, yName, measure.title],
            row: [
              `${formatDataValue(x0)} – ${formatDataValue(x0 + xRange / binsX)}`,
              `${formatDataValue(y0)} – ${formatDataValue(y0 + yRange / binsY)}`,
              formatTooltipNumber(c),
            ],
          },
        });
      }
    }
    ctx.globalAlpha = 1;
    if (!opts?.mini) drawChartTicks(ctx, xMin, xMax, yMin, yMax, w, h, rect, opts);
    if (opts) opts.scales = { rect };
    ramp(domain, rect);
    return;
  }

  // Category × category: rank by frequency (or natural order for numbers / dates).
  // A wide numeric axis (category × measure) bins into ranges instead of
  // listing the first 20 raw values with a count of 1 each.
  const axisKeys = (idx: number, numericHighFirst: boolean) => {
    const freq = new Map<string, number>();
    for (const r of rows) if (r[idx] != null && r[idx] !== "") freq.set(String(r[idx]), (freq.get(String(r[idx])) ?? 0) + 1);
    const cls = classifyKeys([...freq.keys()]);
    if (cls.kind === "number" && cls.values.length > 20) {
      const lo = cls.values[0]!;
      const hi = cls.values[cls.values.length - 1]!;
      const ticks = niceTicks(lo, hi, 10, false).ticks;
      const edges = ticks.length >= 2 ? ticks : [lo, hi];
      if (edges[0]! > lo) edges.unshift(lo);
      if (edges[edges.length - 1]! < hi) edges.push(hi);
      const labels = edges.slice(0, -1).map((e, i) => `${formatDataValue(e)} – ${formatDataValue(edges[i + 1]!)}`);
      const keyOf = (r: unknown[]) => {
        const v = chartNumber(r[idx]);
        if (!Number.isFinite(v)) return "";
        let b = edges.findIndex((e, i) => i > 0 && v < e) - 1;
        if (b < 0) b = labels.length - 1;
        return labels[b]!;
      };
      return { labels: numericHighFirst ? [...labels].reverse() : labels, keyOf, binned: true };
    }
    const keys = cls.kind !== "band" ? cls.sorted : [...freq.keys()].sort((a, b) => freq.get(b)! - freq.get(a)!);
    const top = keys.slice(0, 20);
    return {
      labels: numericHighFirst && cls.kind === "number" ? [...top].reverse() : top,
      keyOf: (r: unknown[]) => String(r[idx]),
      binned: false,
    };
  };
  const xAxis = axisKeys(xi, false);
  const yAxis = axisKeys(yi, true);
  const xLabels = xAxis.labels;
  const yLabels = yAxis.labels;
  if (xLabels.length === 0 || yLabels.length === 0) return;
  const cells = new Map<string, DensityCell>();
  const xSet = new Set(xLabels), ySet = new Set(yLabels);
  rows.forEach((r, ri) => {
    const x = xAxis.keyOf(r), y = yAxis.keyOf(r);
    if (xSet.has(x) && ySet.has(y)) addDensityCell(cells, JSON.stringify([x, y]), r[measure.index], ri);
  });
  const domain = densityDomain(cells.values(), measure.aggregate);
  const gutter = opts?.mini || opts?.plotBounds ? 0 : labelGutter(ctx, yLabels, w, pad, opts);
  const rect = densityPlot(w, h, pad, opts);
  rect.left += gutter;
  if (opts) opts.scales = { rect };
  const cellW = (rect.right - rect.left) / xLabels.length;
  const cellH = (rect.bottom - rect.top) / yLabels.length;
  const showValues = !opts?.mini && opts?.showDataLabels === true && cellW >= 26 && cellH >= chartTypeRamp(opts?.axisFontSize).cell + 6;
  const emptyFill = opts?.themeBorder ?? "#2a2a30";
  xLabels.forEach((xL, xi2) => {
    yLabels.forEach((yL, yi2) => {
      const cell = cells.get(JSON.stringify([xL, yL]));
      const c = densityValue(cell, measure.aggregate);
      const px = rect.left + xi2 * cellW;
      const py = rect.top + yi2 * cellH;
      const fill = c !== null ? sampleContinuous(stops, densityFraction(c, domain)) : emptyFill;
      ctx.globalAlpha = c !== null ? alpha : 0.16;
      ctx.fillStyle = fill;
      ctx.fillRect(px + 0.5, py + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
      ctx.globalAlpha = 1;
      if (showValues && c !== null) {
        ctx.fillStyle = contrastingInk(fill);
        ctx.font = axisFont(opts, chartTypeRamp(opts?.axisFontSize).cell);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = formatDataValue(c);
        if (ctx.measureText(label).width <= cellW - 6)
          ctx.fillText(label, px + cellW / 2, py + cellH / 2);
      }
      if (c === null) return;
      const binned = xAxis.binned || yAxis.binned;
      pushHit(opts, {
        shape: "rect", x: px, y: py, w: cellW, h: cellH,
        // Range buckets aren't raw values — identify the cell by its first row
        match: !binned ? [[xi, xL], [yi, yL]] : [],
        rowIndex: binned ? cell!.row : undefined,
        summary: { columns: [xName, yName, measure.title], row: [xL, yL, formatTooltipNumber(c)] },
      });
    });
  });
  ctx.textBaseline = "alphabetic";
  if (!opts?.mini) drawBandAxisX(ctx, xLabels, xLabels.map((_, i) => rect.left + (i + 0.5) * cellW), cellW, w, h, rect, opts, "nominal");
  if (!opts?.mini) drawBandAxisY(ctx, yLabels, yLabels.map((_, i) => rect.top + (i + 0.5) * cellH), cellH, rect.left - 8, gutter - 10, opts);
  ramp(domain, rect);
}
