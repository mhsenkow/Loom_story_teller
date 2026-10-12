// =================================================================
// Canvas 2D scatter renderer.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { fieldLabel, plotOf, setLegend } from "./plumbing";
import { densityAwarePointMarks } from "../chartLayout";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { formatTooltipNumber } from "../chartTooltip";
import { type YScaleKind, anomalyRowIndices, residualYs, scaleDomain, scaleY } from "../dsTransforms";
import { drawScatterMarginals, drawScatterTrail } from "./axisHelpers";
import { type PointVisualOverrides, drawAxisTicks, drawGridLines, drawMark, encodingNorm, jitter, numRange } from "./primitives";
import { DEFAULT_COLORS } from "./shared";

export function renderFullScatter(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  sizeIdx: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  encodingIndices?: { glowIdx: number; outlineIdx: number; opacityIdx: number },
  clusterByRow?: Record<number, number>,
  viewBounds?: { xMin: number; xMax: number; yMin: number; yMax: number },
) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const [dataXMin, dataXMax] = numRange(rows, xi);
  const [dataYMin, dataYMax] = numRange(rows, yi);
  const xs = rows.map((r) => Number(r[xi]));
  const ysRaw = rows.map((r) => Number(r[yi]));
  const fit = opts?.residualOverlay ? residualYs(xs, ysRaw) : null;
  const plotYs = fit
    ? ysRaw.map((y, i) => (Number.isFinite(y) ? fit.residuals[i]! : NaN))
    : ysRaw;
  let dataYMin2 = dataYMin;
  let dataYMax2 = dataYMax;
  if (fit) {
    const finite = plotYs.filter((v) => Number.isFinite(v));
    dataYMin2 = finite.length ? Math.min(...finite) : -1;
    dataYMax2 = finite.length ? Math.max(...finite) : 1;
    if (dataYMin2 === dataYMax2) {
      dataYMin2 -= 1;
      dataYMax2 += 1;
    }
  }
  const sharedBounds = viewBounds ?? opts?.sharedScatterBounds;
  const xMin = sharedBounds?.xMin ?? dataXMin;
  const xMax = sharedBounds?.xMax ?? dataXMax;
  let yMin = sharedBounds?.yMin ?? dataYMin2;
  let yMax = sharedBounds?.yMax ?? dataYMax2;
  const yScaleKind = (opts?.yScale ?? "linear") as YScaleKind;
  if (yScaleKind !== "linear" && !fit) {
    const d = scaleDomain(yMin, yMax, yScaleKind);
    yMin = d.min;
    yMax = d.max;
  }
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const catMap = new Map<string, number>();
  let next = 0;
  const rowSource = opts?.rowSourceIndices;
  const sampleIdxOf = (ri: number) => rowSource?.[ri] ?? ri;
  const anom = opts?.anomalyHighlight ? new Set(anomalyRowIndices(rows, yi)) : null;

  const glowIdx = encodingIndices?.glowIdx ?? -1;
  const outlineIdx = encodingIndices?.outlineIdx ?? -1;
  const opacityIdx = encodingIndices?.opacityIdx ?? -1;
  const getGlowNorm = glowIdx >= 0 ? encodingNorm(rows, glowIdx) : null;
  const getOutlineNorm = outlineIdx >= 0 ? encodingNorm(rows, outlineIdx) : null;
  const getOpacityNorm = opacityIdx >= 0 ? encodingNorm(rows, opacityIdx) : null;
  const glowIntensity = opts?.glowIntensity ?? 8;

  const plotW = Math.max(1, w - 2 * pad);
  const plotH = Math.max(1, h - 2 * pad);
  let nValid = 0;
  for (let i = 0; i < rows.length; i++) {
    const x = Number(rows[i]![xi]);
    const y = plotYs[i]!;
    if (!isNaN(x) && Number.isFinite(y)) nValid++;
  }
  const marks = densityAwarePointMarks({
    n: nValid,
    plotW,
    plotH,
    hasSizeEncoding: sizeIdx >= 0,
    sizeScale: opts?.sizeScale ?? 1,
    pointSize: opts?.pointSize ?? 12,
    opacity: opts?.opacity ?? 0.7,
    opacityUserSet: opts?.opacityUserSet,
  });
  const baseAlpha = marks.opacity;
  const baseRadius = marks.minR;
  const maxSizeRadius = marks.maxR;

  const toSX = (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (w - 2 * pad);
  const toSY = (v: number) => {
    if (yScaleKind !== "linear" && !fit) {
      const t = scaleY(v, yMin, yMax, yScaleKind);
      return h - pad - t * (h - 2 * pad);
    }
    return h - pad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * pad);
  };
  if (opts) opts.scales = { x: toSX, y: toSY, valueAxis: "y", rect: plotOf(w, h, pad) };
  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (opts?.showMarginals && !fit) drawScatterMarginals(ctx, rows, xi, yi, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (opts?.connectTrail && !fit) drawScatterTrail(ctx, rows, xi, yi, ci, toSX, toSY, opts);

  // Residual mode: zero line; otherwise optional fit line under residual stems
  if (fit) {
    const zy = toSY(0);
    ctx.strokeStyle = opts?.themeMuted ?? "rgba(128,128,128,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pad, zy);
    ctx.lineTo(w - pad, zy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const shape = opts?.markShape ?? "circle";
  const jitterPx = opts?.markJitter ?? 0;
  let pointIdx = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri]!;
    const x = Number(r[xi]);
    const y = plotYs[ri]!;
    if (isNaN(x) || !Number.isFinite(y)) continue;
    let cat = 0;
    if (ci >= 0) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, next++);
      cat = catMap.get(k)!;
    }
    let radius = baseRadius;
    if (sizeIdx >= 0) {
      const s = Number(r[sizeIdx]);
      if (!isNaN(s)) {
        const t = (s - sizeMin) / sizeRange;
        radius = baseRadius + Math.sqrt(Math.max(0, Math.min(1, t))) * (maxSizeRadius - baseRadius);
      }
    } else {
      radius = (baseRadius + maxSizeRadius) / 2;
    }
    let sx = toSX(x);
    let sy = toSY(y);
    if (jitterPx > 0) {
      sx += jitter(pointIdx * 2, jitterPx);
      sy += jitter(pointIdx * 2 + 1, jitterPx);
    }
    pointIdx++;

    const useCluster = clusterByRow != null && clusterByRow[ri] !== undefined;
    const fillColor = useCluster
      ? cols[(clusterByRow[ri] ?? 0) % cols.length]
      : cols[cat % cols.length];

    let pointOverrides: PointVisualOverrides | undefined;
    if (getGlowNorm || getOutlineNorm || getOpacityNorm) {
      const gNorm = getGlowNorm ? getGlowNorm(r) : 0;
      const oNorm = getOutlineNorm ? getOutlineNorm(r) : 0;
      const pNorm = getOpacityNorm ? getOpacityNorm(r) : 1;
      pointOverrides = {
        alpha: getOpacityNorm != null ? Math.max(0.15, baseAlpha * (0.3 + 0.7 * pNorm)) : undefined,
        glow: getGlowNorm != null ? (gNorm > 0.05 ? gNorm * glowIntensity : 0) : undefined,
        stroke: getOutlineNorm != null ? oNorm > 0.3 : undefined,
        strokeWidth: getOutlineNorm != null && oNorm > 0.3 ? 0.5 + oNorm * 2 : undefined,
      };
    }

    drawMark(ctx, shape, sx, sy, radius, fillColor, baseAlpha, opts, pointOverrides);
    if (anom?.has(sampleIdxOf(ri))) {
      ctx.strokeStyle = fillColor ?? cols[0]!;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (opts?.hits) {
      const cols2 = [fieldLabel(opts, xi), fit ? `${fieldLabel(opts, yi)} residual` : fieldLabel(opts, yi)];
      const vals: (string | number | null)[] = [formatTooltipNumber(x), formatTooltipNumber(y)];
      if (ci >= 0) { cols2.unshift(fieldLabel(opts, ci)); vals.unshift(String(r[ci])); }
      opts.hits.push({
        shape: "circle", cx: sx, cy: sy, r: Math.max(4, radius),
        match: [[xi, String(r[xi])], [yi, String(r[yi])]],
        rowIndex: sampleIdxOf(ri),
        summary: { columns: cols2, row: vals },
      });
    }
  }
  ctx.globalAlpha = 1;
  if (ci >= 0 && !clusterByRow) setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: cols[i % cols.length]! })));
  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
}
