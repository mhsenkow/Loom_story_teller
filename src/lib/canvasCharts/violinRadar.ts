// =================================================================
// Canvas 2D violin, radar, waterfall and lollipop renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { aggregateValues, fieldLabel, plotOf, pushHit, setLegend, valueTitle } from "./plumbing";
import { classifyKeys, formatDataValue, linear, niceTicks, niceZeroScale } from "../chartAxes";
import { clampTopN } from "../chartFacets";
import { fitTextEllipsis } from "../chartLayout";
import { type PlotRect, drawAxisFrame, drawBandAxisX, drawBandAxisY, drawChartGrid, drawChartTicks } from "../chartLooks";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { resolveLayoutDirection } from "../chartSupport";
import { formatTooltipNumber } from "../chartTooltip";
import { type YAggregateOption } from "../recommendations";
import { axisFont, drawZeroLine, labelGutter, widestText } from "./axisHelpers";
import { groupedDistributions } from "./distributions";
import { numRange } from "./primitives";
import { DEFAULT_COLORS } from "./shared";

export function renderFullViolin(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.55;
  const ink = opts?.themeText ?? "#e8e8ec";
  const groups = groupedDistributions(rows, xi, yi, 12);
  if (groups.length === 0) return;
  // Color only when Color encodes something other than the group itself
  const groupColor = new Map<string, string>();
  if (ci >= 0 && ci !== xi) for (const r of rows) if (!groupColor.has(String(r[xi]))) groupColor.set(String(r[xi]), String(r[ci]));
  const colorKeys = [...new Set(groupColor.values())];
  const rect = plotOf(w, h, pad);
  const gMin = Math.min(...groups.map((g) => g.min));
  const gMax = Math.max(...groups.map((g) => g.max));
  const ys = niceTicks(gMin, gMax, opts?.tickCount ?? 5, true);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const band = (rect.right - rect.left) / groups.length;
  const halfW = Math.min(band * 0.42, 60);
  const bins = 40;
  const binH = (ys.max - ys.min) / bins;
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const centers: number[] = [];

  groups.forEach((g, gi) => {
    // Smoothed density: histogram + 3-tap blur twice
    let counts = new Array<number>(bins).fill(0);
    for (const v of g.sorted) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - ys.min) / binH)))]! += 1;
    for (let pass = 0; pass < 2; pass++) {
      counts = counts.map((c, i) => ((counts[i - 1] ?? 0) + 2 * c + (counts[i + 1] ?? 0)) / 4);
    }
    const maxC = Math.max(...counts, 1e-9);
    const cx = rect.left + (gi + 0.5) * band;
    centers.push(cx);
    const color = groupColor.size ? cols[Math.max(0, colorKeys.indexOf(groupColor.get(g.label)!)) % cols.length]! : cols[0]!;
    // Clip the outline to the group's own range so tails don't float
    const b0 = Math.max(0, Math.floor((g.min - ys.min) / binH));
    const b1 = Math.min(bins - 1, Math.floor((g.max - ys.min) / binH));
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let b = b0; b <= b1; b++) {
      const y = Y(ys.min + (b + 0.5) * binH);
      const dx = (counts[b]! / maxC) * halfW;
      if (b === b0) ctx.moveTo(cx - dx, y);
      else ctx.lineTo(cx - dx, y);
    }
    for (let b = b1; b >= b0; b--) {
      ctx.lineTo(cx + (counts[b]! / maxC) * halfW, Y(ys.min + (b + 0.5) * binH));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Inner box: IQR bar + median dot
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, Y(g.q1));
    ctx.lineTo(cx, Y(g.q3));
    ctx.stroke();
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, Y(g.q2), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    pushHit(opts, {
      shape: "rect", x: rect.left + gi * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, g.label]],
      summary: {
        columns: [xName, "Rows", `Median ${yName}`, "Q1 – Q3"],
        row: [g.label, formatTooltipNumber(g.sorted.length), formatTooltipNumber(g.q2), `${formatTooltipNumber(g.q1)} – ${formatTooltipNumber(g.q3)}`],
      },
    });
  });
  ctx.globalAlpha = 1;
  if (groupColor.size) setLegend(opts, colorKeys.map((label, i) => ({ label, color: cols[i % cols.length]! })));
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, groups.map((g) => g.label), centers, band, w, h, rect, opts, "nominal");
}

// --- Radar / Spider ---

export function renderFullRadar(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columnNames: string[],
  _xi: number,
  _yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const palette = opts?.colors ?? DEFAULT_COLORS;

  if (!rows.length || !columnNames.length) return;

  const numericAxes: { idx: number; name: string }[] = [];
  for (let c = 0; c < columnNames.length; c++) {
    if (c === ci) continue;
    const sample = rows.slice(0, 20);
    const numCount = sample.filter(r => !isNaN(Number(r[c])) && r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean").length;
    if (numCount >= sample.length * 0.5) {
      numericAxes.push({ idx: c, name: columnNames[c] });
    }
  }
  if (numericAxes.length < 3) return;
  const axes = numericAxes.slice(0, 8);
  const n = axes.length;

  const ranges = axes.map(a => numRange(rows, a.idx));

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
  const groupEntries = [...groups.entries()].slice(0, 6);
  const groupAvgs = groupEntries.map(([, gRows]) =>
    axes.map((a) => {
      const vals = gRows.map(r => Number(r[a.idx])).filter(v => !isNaN(v));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    }),
  );
  // Comparing groups: scale each axis across the group averages (lowest at 20% of the radius)
  // so differences show — row-level min/max squashes every average toward the center.
  const compare = groupEntries.length > 1;
  const axisNorm = axes.map((_, ai) => {
    if (!compare) {
      const [mn, mx] = ranges[ai]!;
      return (v: number) => (mx === mn ? 0.5 : (v - mn) / (mx - mn));
    }
    const vals = groupAvgs.map((g) => g[ai]!);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    return (v: number) => (mx === mn ? 0.6 : 0.2 + 0.8 * ((v - mn) / (mx - mn)));
  });

  // Leave room for axis names around the web
  const labelFont = axisFont(opts, Math.max(10, opts?.axisFontSize ?? 10));
  const labelRoom = Math.min(90, widestText(ctx, axes.map((a) => a.name), labelFont) + 8);
  const cx = w / 2;
  const cy = pad + (h - 2 * pad) / 2;
  const radius = Math.max(20, Math.min((w - 2 * pad) / 2 - labelRoom, (h - 2 * pad) / 2 - 18));
  if (radius < 20) return;

  const rings = 4;
  ctx.save();
  ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
  ctx.lineWidth = 0.75;
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius * (ring / rings);
    ctx.globalAlpha = ring === rings ? 0.7 : 0.35;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = (Math.PI * 2 * (i % n)) / n - Math.PI / 2;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.font = labelFont;
  ctx.fillStyle = opts?.themeText ?? opts?.axisLabelColor ?? "#8b8b98";
  ctx.globalAlpha = 1;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const labelR = radius + 8;
    const lx = cx + Math.cos(angle) * labelR;
    const ly = cy + Math.sin(angle) * labelR;
    ctx.textAlign = Math.abs(Math.cos(angle)) < 0.1 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
    ctx.textBaseline = Math.abs(Math.sin(angle)) < 0.1 ? "middle" : Math.sin(angle) > 0 ? "top" : "bottom";
    ctx.fillText(fitTextEllipsis(ctx, axes[i]!.name, labelRoom), lx, ly);
  }
  ctx.restore();

  groupEntries.forEach(([gName], gi) => {
    const avgs = groupAvgs[gi]!;
    const normals = avgs.map((avg, ai) => axisNorm[ai]!(avg));
    const vertex = (i: number) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, normals[i]!) * radius;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    };

    const color = palette[gi % palette.length]!;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    normals.forEach((_, i) => {
      const p = vertex(i);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    normals.forEach((_, i) => {
      const p = vertex(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      pushHit(opts, {
        shape: "circle", cx: p.x, cy: p.y, r: 8,
        match: ci >= 0 ? [[ci, gName]] : [],
        rowIndex: ci >= 0 ? undefined : 0,
        summary: {
          columns: ci >= 0 ? [fieldLabel(opts, ci), `Average ${axes[i]!.name}`] : [`Average ${axes[i]!.name}`],
          row: ci >= 0 ? [gName, formatTooltipNumber(avgs[i]!)] : [formatTooltipNumber(avgs[i]!)],
        },
      });
    });
  });

  setLegend(opts, ci >= 0 ? groupEntries.map(([label], gi) => ({ label, color: palette[gi % palette.length]! })) : []);
  ctx.globalAlpha = 1;
}

// --- Waterfall ---

export function renderFullWaterfall(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  // Steps run in natural order for numbers / dates, otherwise first appearance
  const cls = classifyKeys([...groups.keys()]);
  const keys = (cls.kind !== "band" ? cls.sorted : [...groups.keys()]).slice(0, 20);
  if (keys.length === 0) return;

  let running = 0;
  const bars: { label: string; start: number; end: number; value: number; total?: boolean }[] = [];
  for (const label of keys) {
    const val = aggregateValues(groups.get(label)!.filter(v => !isNaN(v)), agg);
    bars.push({ label, start: running, end: running + val, value: val });
    running += val;
  }
  bars.push({ label: "Total", start: 0, end: running, value: running, total: true });
  const allY = bars.flatMap(b => [b.start, b.end]);
  const ys = niceZeroScale(Math.min(0, ...allY), Math.max(0, ...allY), opts?.tickCount ?? 5);
  const rect = plotOf(w, h, pad);
  const layout = resolveLayoutDirection(opts?.layoutDirection, false);
  // Waterfall stays category-on-X; Direction flips the measure (↓ / ← / → → reverse).
  const flip = layout.reverse || layout.horizontal;
  const Y = flip
    ? linear(ys.min, ys.max, rect.top, rect.bottom)
    : linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const band = (rect.right - rect.left) / bars.length;
  const barW = Math.max(3, Math.min(band * 0.7, 72));
  const up = cols[0]!;
  const down = cols[2] ?? cols[1] ?? cols[0]!;
  const totalColor = cols[3] ?? opts?.axisLabelColor ?? "#6b6b78";
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  const centers: number[] = [];

  bars.forEach((bar, i) => {
    const cx = rect.left + (i + 0.5) * band;
    centers.push(cx);
    const top = Math.min(Y(bar.start), Y(bar.end));
    const bottom = Math.max(Y(bar.start), Y(bar.end));
    ctx.fillStyle = bar.total ? totalColor : bar.value >= 0 ? up : down;
    ctx.globalAlpha = alpha;
    ctx.fillRect(cx - barW / 2, top, barW, Math.max(1, bottom - top));
    if (i > 0) {
      // Connector from the previous step's end
      ctx.globalAlpha = 1;
      ctx.strokeStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.lineWidth = 0.75;
      ctx.setLineDash([3, 2]);
      const prevEnd = Y(bars[i - 1]!.end);
      ctx.beginPath();
      ctx.moveTo(cx - band + barW / 2, prevEnd);
      ctx.lineTo(cx - barW / 2, prevEnd);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (opts?.showDataLabels && band >= 26) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.font = axisFont(opts, 10);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const sign = !bar.total && bar.value > 0 ? "+" : "";
      ctx.fillText(sign + formatDataValue(bar.value), cx, top - 3);
    }
    pushHit(opts, {
      shape: "rect", x: rect.left + i * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: bar.total ? [] : [[xi, bar.label]],
      rowIndex: bar.total ? 0 : undefined,
      summary: bar.total
        ? { columns: [xName, vTitle], row: ["Total", formatTooltipNumber(bar.value)] }
        : { columns: [xName, "Change", "Running total"], row: [bar.label, (bar.value > 0 ? "+" : "") + formatTooltipNumber(bar.value), formatTooltipNumber(bar.end)] },
    });
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
  if (ys.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, bars.map((b) => b.label), centers, band, w, h, rect, opts, "nominal");
  setLegend(opts, [
    { label: "Increase", color: up },
    { label: "Decrease", color: down },
    { label: "Total", color: totalColor },
  ]);
}

// --- Lollipop ---

export function renderFullLollipop(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.9;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const layout = resolveLayoutDirection(opts?.layoutDirection, true);
  const horizontal = layout.horizontal;
  const reverse = layout.reverse;

  const catColorMap = new Map<string, number>();
  let nextCat = 0;
  if (ci >= 0 && ci !== xi) {
    for (const r of rows) {
      const k = String(r[ci]);
      if (!catColorMap.has(k)) catColorMap.set(k, nextCat++);
    }
  }

  const groups = new Map<string, { vals: number[]; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, { vals: [], cat: ci >= 0 ? String(r[ci]) : "" });
    groups.get(k)!.vals.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: aggregateValues(g.vals.filter(v => !isNaN(v)), agg), cat: g.cat }))
    .sort((a, b) => b.value - a.value)
    .slice(0, opts?.topN != null ? clampTopN(opts.topN) : 20);
  if (entries.length === 0) return;

  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  const colorOf = (cat: string) =>
    catColorMap.size ? palette[(catColorMap.get(cat) ?? 0) % palette.length]! : palette[0]!;

  if (horizontal) {
    const gutter = labelGutter(ctx, entries.map((e) => e.label), w, pad, opts);
    const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
    const xs = niceZeroScale(Math.min(0, ...entries.map((e) => e.value)), Math.max(0, ...entries.map((e) => e.value)), opts?.tickCount ?? 5);
    const X = reverse
      ? linear(xs.min, xs.max, rect.right, rect.left)
      : linear(xs.min, xs.max, rect.left, rect.right);
    if (opts) opts.scales = { x: X, valueAxis: "x", rect };
    drawAxisFrame(ctx, w, h, rect, opts);
    drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });

    const bandH = (rect.bottom - rect.top) / entries.length;
    const dotR = Math.max(3, Math.min(6, bandH * 0.3));
    const centers: number[] = [];
    entries.forEach(({ label, value, cat }, i) => {
      const cy = rect.top + (i + 0.5) * bandH;
      centers.push(cy);
      const color = colorOf(cat);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * 0.7;
      ctx.beginPath();
      ctx.moveTo(X(0), cy);
      ctx.lineTo(X(value), cy);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(X(value), cy, dotR, 0, Math.PI * 2);
      ctx.fill();
      if (opts?.showDataLabels) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
        ctx.font = axisFont(opts);
        const tipRight = (value >= 0) !== reverse;
        ctx.textAlign = tipRight ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(formatDataValue(value), X(value) + (tipRight ? dotR + 4 : -(dotR + 4)), cy);
      }
      pushHit(opts, {
        shape: "rect", x: rect.left, y: cy - bandH / 2, w: rect.right - rect.left, h: bandH,
        match: [[xi, label]],
        summary: { columns: [xName, vTitle], row: [label, formatTooltipNumber(value)] },
      });
    });
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
    if (catColorMap.size) setLegend(opts, [...catColorMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
    drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
    drawBandAxisY(ctx, entries.map((e) => e.label), centers, bandH, rect.left - 8, gutter - 10, opts);
    return;
  }

  // Vertical lollipops — categories on X, values grow up (or down when reverse)
  const rect = plotOf(w, h, pad);
  const ys = niceZeroScale(Math.min(0, ...entries.map((e) => e.value)), Math.max(0, ...entries.map((e) => e.value)), opts?.tickCount ?? 5);
  const Y = reverse
    ? linear(ys.min, ys.max, rect.top, rect.bottom)
    : linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const band = (rect.right - rect.left) / entries.length;
  const dotR = Math.max(3, Math.min(6, band * 0.25));
  const centers: number[] = [];
  entries.forEach(({ label, value, cat }, i) => {
    const cx = rect.left + (i + 0.5) * band;
    centers.push(cx);
    const color = colorOf(cat);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx, Y(0));
    ctx.lineTo(cx, Y(value));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, Y(value), dotR, 0, Math.PI * 2);
    ctx.fill();
    if (opts?.showDataLabels) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.font = axisFont(opts, 10);
      const tipAtLow = (value >= 0) !== reverse;
      ctx.textAlign = "center";
      ctx.textBaseline = tipAtLow ? "bottom" : "top";
      ctx.fillText(formatDataValue(value), cx, Y(value) + (tipAtLow ? -(dotR + 3) : dotR + 3));
    }
    pushHit(opts, {
      shape: "rect", x: rect.left + i * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, label]],
      summary: { columns: [xName, vTitle], row: [label, formatTooltipNumber(value)] },
    });
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
  if (catColorMap.size) setLegend(opts, [...catColorMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
  if (ys.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, entries.map((e) => e.label), centers, band, w, h, rect, opts, "nominal");
}

// --- Treemap ---
