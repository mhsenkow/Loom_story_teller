// =================================================================
// Canvas 2D pie and bubble renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { aggregateValues, fieldLabel, plotOf, pushHit, setLegend, valueTitle } from "./plumbing";
import { formatDataValue } from "../chartAxes";
import { contrastingInk, densityAwarePointMarks, fitTextEllipsis } from "../chartLayout";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { formatTooltipNumber } from "../chartTooltip";
import { type YAggregateOption } from "../recommendations";
import { widestText } from "./axisHelpers";
import { drawAxisTicks, drawGridLines, numRange } from "./primitives";
import { DEFAULT_COLORS } from "./shared";
import { directedUnit } from "../channelInvert";
import { chartFont, chartTypeRamp } from "../chartType";

/** Top slices + "Other" so a pie never has more than 8 wedges. */
export function pieSlices(rows: unknown[][], xi: number, yi: number, agg: YAggregateOption) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  const all = [...groups.entries()]
    .map(([label, vals]) => ({ label, value: Math.max(0, aggregateValues(vals.filter((v) => !isNaN(v)), agg)), other: [] as string[] }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
  if (all.length <= 8) return all;
  const head = all.slice(0, 7);
  const tail = all.slice(7);
  return [...head, { label: `Other (${tail.length})`, value: tail.reduce((s, e) => s + e.value, 0), other: tail.map((e) => e.label) }];
}

export function renderFullPie(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = Math.max(0.85, opts?.opacity ?? 0.9);
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const entries = pieSlices(rows, xi, yi, agg);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total === 0) return;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const rect = plotOf(w, h, pad, opts);
  const plotW = rect.right - rect.left;
  const plotH = rect.bottom - rect.top;
  const pct = (v: number) => {
    const p = (v / total) * 100;
    return `${p < 1 ? "<1" : p < 10 ? p.toFixed(1) : Math.round(p)}%`;
  };

  // Legend beside the donut on wide stages, underneath on tall ones
  const legendFont = chartFont(chartTypeRamp(opts?.axisFontSize).legend, fontFamily);
  const legendTexts = entries.map((e) => `${e.label}  ${pct(e.value)}`);
  const textW = widestText(ctx, legendTexts, legendFont);
  const portrait = plotH > plotW * 1.1;
  const rowH = 18;
  const legendW = portrait ? plotW : Math.min(plotW * 0.42, textW + 22);
  const legendH = portrait ? Math.ceil(entries.length / 2) * rowH + 6 : entries.length * rowH;
  const pieW = portrait ? plotW : plotW - legendW - 16;
  const pieH = portrait ? plotH - legendH - 8 : plotH;
  const cx = rect.left + pieW / 2;
  const cy = rect.top + pieH / 2;
  const radius = Math.max(24, Math.min(pieW, pieH) / 2 - 4);
  const innerR = radius * 0.55;
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);

  let start = -Math.PI / 2;
  entries.forEach((e, i) => {
    const sweep = (e.value / total) * Math.PI * 2;
    const fill = cols[i % cols.length]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.arc(cx, cy, innerR, start + sweep, start, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#1a1a1f";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.stroke();
    // Percent on wedges big enough to hold it
    if (sweep > 0.32 && opts?.showDataLabels !== false && opts?.chartDetail !== "plain") {
      const mid = start + sweep / 2;
      const r2 = (radius + innerR) / 2;
      ctx.fillStyle = contrastingInk(fill);
      ctx.font = chartFont(Math.max(chartTypeRamp(opts?.axisFontSize).mark, Math.min(13, (radius - innerR) * 0.32)), fontFamily, 600);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pct(e.value), cx + Math.cos(mid) * r2, cy + Math.sin(mid) * r2);
    }
    const firstOther = e.other.length
      ? rows.findIndex((r) => e.other.includes(String(r[xi])))
      : -1;
    pushHit(opts, {
      shape: "arc", cx, cy, r0: innerR, r1: radius, a0: start, a1: start + sweep,
      match: e.other.length ? [] : [[xi, e.label]],
      rowIndex: firstOther >= 0 ? firstOther : undefined,
      summary: { columns: [xName, vTitle, "Share"], row: [e.label, formatTooltipNumber(e.value), pct(e.value)] },
    });
    start += sweep;
  });

  // Total in the hole
  if (innerR > 26) {
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = chartFont(Math.max(chartTypeRamp(opts?.axisFontSize).titleCompact, Math.min(22, innerR * 0.38)), fontFamily, 600);
    ctx.fillText(formatDataValue(total), cx, cy - innerR * 0.08);
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.font = chartFont(chartTypeRamp(opts?.axisFontSize).mark, fontFamily);
    ctx.fillText(fitTextEllipsis(ctx, agg === "count" ? "total rows" : "total", innerR * 1.6), cx, cy + innerR * 0.28);
  }

  ctx.font = legendFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  entries.forEach((e, i) => {
    const colW = portrait ? plotW / 2 : legendW;
    const lx = portrait ? rect.left + (i % 2) * colW : rect.right - legendW;
    const ly = portrait
      ? rect.top + pieH + 14 + Math.floor(i / 2) * rowH
      : cy - legendH / 2 + i * rowH + rowH / 2;
    ctx.fillStyle = cols[i % cols.length]!;
    ctx.globalAlpha = 1;
    ctx.fillRect(lx, ly - 5, 10, 10);
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    const maxText = colW - 22;
    const pctText = pct(e.value);
    const pctW = ctx.measureText(pctText).width;
    ctx.fillText(fitTextEllipsis(ctx, e.label, Math.max(20, maxText - pctW - 8)), lx + 16, ly);
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.textAlign = "right";
    ctx.fillText(pctText, lx + colW - 4, ly);
    ctx.textAlign = "left";
  });
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, []);
}

// --- Bubble (scatter with size) ---

export function renderFullBubble(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columnNames: string[],
  xi: number,
  yi: number,
  ci: number,
  sizeIdx: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0) return;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const plotW = Math.max(1, w - 2 * pad);
  const plotH = Math.max(1, h - 2 * pad);

  // Count valid points cheaply for density (same filter as draw loop)
  let nValid = 0;
  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (!isNaN(x) && !isNaN(y)) nValid++;
  }
  const marks = densityAwarePointMarks({
    n: nValid,
    plotW,
    plotH,
    hasSizeEncoding: sizeIdx >= 0,
    sizeScale: opts?.sizeScale ?? 1,
    pointSize: opts?.pointSize ?? 12,
    opacity: opts?.opacity,
    opacityUserSet: opts?.opacityUserSet,
  });
  const { minR, maxR, opacity: alpha, drawStroke } = marks;

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (opts) {
    opts.scales = {
      x: (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (w - 2 * pad),
      y: (v: number) => h - pad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * pad),
      valueAxis: "y",
      rect: plotOf(w, h, pad, opts),
    };
  }

  const catMap = new Map<string, number>();
  let nextCat = 0;
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const sName = sizeIdx >= 0 ? (columnNames[sizeIdx] ?? "size") : "";

  type Bubble = { sx: number; sy: number; r: number; cat: number; row: unknown[] };
  const bubbles: Bubble[] = [];
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
    if (sizeIdx >= 0) {
      const s = Number(r[sizeIdx]);
      if (!isNaN(s)) {
        const t = directedUnit((s - sizeMin) / sizeRange, opts?.channelInvert?.size);
        radius = minR + Math.sqrt(t) * (maxR - minR);
      }
    }
    const sx = pad + ((x - xMin) / xRange) * plotW;
    const sy = h - pad - ((y - yMin) / yRange) * plotH;
    bubbles.push({ sx, sy, r: radius, cat, row: r });
  }

  // Big bubbles first so small ones stay visible on top
  bubbles.sort((a, b) => b.r - a.r);

  for (const b of bubbles) {
    const color = palette[b.cat % palette.length]!;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, b.r, 0, Math.PI * 2);
    ctx.fill();
    if (drawStroke) {
      ctx.globalAlpha = Math.min(alpha + 0.25, 0.85);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    const cols = [xName, yName];
    const vals: (string | number | null)[] = [formatTooltipNumber(Number(b.row[xi])), formatTooltipNumber(Number(b.row[yi]))];
    if (sizeIdx >= 0) { cols.push(sName); vals.push(formatTooltipNumber(Number(b.row[sizeIdx]))); }
    if (ci >= 0) { cols.unshift(fieldLabel(opts, ci)); vals.unshift(String(b.row[ci])); }
    pushHit(opts, {
      shape: "circle", cx: b.sx, cy: b.sy, r: Math.max(4, b.r),
      match: [[xi, String(b.row[xi])], [yi, String(b.row[yi])]],
      summary: { columns: cols, row: vals },
    });
  }
  ctx.globalAlpha = 1;

  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (ci >= 0) setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));

  // Size key: three nested reference circles, bottom-right inside the plot
  if (sizeIdx >= 0 && maxR >= 4) {
    const steps = [0.1, 0.5, 1.0];
    const font = chartFont(chartTypeRamp(opts?.axisFontSize).mark, fontFamily);
    const labels = steps.map((t) => formatDataValue(sizeMin + t * sizeRange));
    const labelW = widestText(ctx, labels, font);
    const boxW = maxR * 2 + labelW + 22;
    const boxH = maxR * 2 + 26;
    const bx = w - pad - boxW - 6;
    const by = h - pad - boxH - 6;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.globalAlpha = 1;
    ctx.font = font;
    ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(fitTextEllipsis(ctx, sName, boxW - 8), bx + 4, by + 3);
    const baseY = by + boxH - 4;
    const ccx = bx + 6 + maxR;
    steps.forEach((t, i) => {
      const r = minR + Math.sqrt(t) * (maxR - minR);
      ctx.strokeStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(ccx, baseY - r, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([2, 2]);
      ctx.moveTo(ccx, baseY - 2 * r);
      ctx.lineTo(ccx + maxR + 6, baseY - 2 * r);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i]!, ccx + maxR + 8, baseY - 2 * r);
    });
    ctx.restore();
  }
}

// --- Violin ---
