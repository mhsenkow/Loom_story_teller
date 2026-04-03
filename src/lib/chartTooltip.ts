// =================================================================
// chartTooltip — Canvas hit-testing + tooltip column projection
// =================================================================
// Picks a representative row under the pointer for each ChartKind,
// projects rows to user-selected tooltip columns, and tests link keys
// for cross-chart tooltip locking.
// =================================================================

import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";

/** Precomputed facet for bar charts (category × subcategory); used for canvas draw + hit-test. */
export type BarFacetHitPayload = {
  xLabels: string[];
  subLabels: string[];
  /** grid[xi][si] = aggregated Y for xLabels[xi] × subLabels[si] */
  grid: number[][];
  stackMode: "grouped" | "stacked" | "percent";
};

const BAR_FACET_MAX_X = 16;
const BAR_FACET_MAX_SUB = 12;

export function buildBarFacetGrid(
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  agg: YAggregateOption,
  stackMode: "grouped" | "stacked" | "percent",
): BarFacetHitPayload | null {
  const nested = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    const xk = String(r[xi]);
    const sk = String(r[ci]);
    if (!nested.has(xk)) nested.set(xk, new Map());
    const m = nested.get(xk)!;
    if (!m.has(sk)) m.set(sk, []);
    if (yi < 0) m.get(sk)!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) m.get(sk)!.push(v);
    }
  }
  const xTotals = [...nested.entries()]
    .map(([xk, sm]) => {
      let t = 0;
      for (const [, vals] of sm) {
        t += aggregateValues(vals, agg);
      }
      return [xk, t] as [string, number];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, BAR_FACET_MAX_X);
  if (xTotals.length === 0) return null;
  const xLabels = xTotals.map(([x]) => x);
  const subSet = new Set<string>();
  for (const xk of xLabels) {
    nested.get(xk)?.forEach((_, sk) => subSet.add(sk));
  }
  const subLabels = [...subSet].sort((a, b) => a.localeCompare(b)).slice(0, BAR_FACET_MAX_SUB);
  if (subLabels.length === 0) return null;
  const grid = xLabels.map((xk) =>
    subLabels.map((sk) => {
      const vals = nested.get(xk)?.get(sk) ?? [];
      return vals.length ? aggregateValues(vals, agg) : 0;
    }),
  );
  return { xLabels, subLabels, grid, stackMode };
}

export type Canvas2DHitContext = {
  kind: ChartKind;
  rows: (string | number | boolean | null)[][];
  columns: string[];
  pad: number;
  w: number;
  h: number;
  xIdx: number;
  yIdx: number;
  cIdx: number;
  sizeIdx: number;
  barEntries?: [string, number][];
  /** Set when bar uses Color as subcategory (grouped / stacked / percent). */
  barFacet?: BarFacetHitPayload;
  yAggregate?: YAggregateOption;
};

export type TooltipLink = { field: string; value: string };

function aggregateValues(values: number[], agg: YAggregateOption): number {
  if (values.length === 0) return 0;
  if (agg === "count") return values.length;
  if (agg === "sum") return values.reduce((a, b) => a + b, 0);
  if (agg === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === "min") return Math.min(...values);
  if (agg === "max") return Math.max(...values);
  return values.reduce((a, b) => a + b, 0);
}

function numRange(rows: unknown[][], xi: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = Number(r[xi]);
    if (!isNaN(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (min === Infinity) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function rowMatchesTooltipLink(
  columns: string[],
  row: (string | number | boolean | null)[],
  link: TooltipLink | null,
): boolean {
  if (!link) return true;
  const idx = columns.indexOf(link.field);
  if (idx < 0) return false;
  return cellStr(row[idx]) === link.value;
}

export function allowedRowIndices(
  rows: (string | number | boolean | null)[][],
  columns: string[],
  link: TooltipLink | null,
): Set<number> | null {
  if (!link) return null;
  const next = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    if (rowMatchesTooltipLink(columns, rows[i]!, link)) next.add(i);
  }
  return next;
}

/** Default tooltip columns: encoding fields that exist in the table, de-duplicated. */
export function resolveTooltipFieldNames(chart: ChartRecommendation, allColumns: string[]): string[] {
  const fromChart = chart.tooltipFields?.filter((n) => allColumns.includes(n));
  if (fromChart && fromChart.length > 0) return fromChart;
  const names: string[] = [];
  const push = (n: string | null | undefined) => {
    if (!n || !allColumns.includes(n)) return;
    if (!names.includes(n)) names.push(n);
  };
  push(chart.xField);
  push(chart.yField);
  push(chart.colorField);
  push(chart.sizeField);
  push(chart.rowField);
  push(chart.glowField);
  push(chart.outlineField);
  push(chart.opacityField);
  return names.length > 0 ? names : [...allColumns].slice(0, 8);
}

export function projectRowForTooltip(
  allColumns: string[],
  row: (string | number | boolean | null)[],
  fieldNames: string[],
): { columns: string[]; row: (string | number | boolean | null)[] } {
  const columns: string[] = [];
  const cells: (string | number | boolean | null)[] = [];
  for (const name of fieldNames) {
    const idx = allColumns.indexOf(name);
    if (idx < 0) continue;
    columns.push(name);
    cells.push(row[idx] ?? null);
  }
  return { columns, row: cells };
}

function inAllowed(i: number, allowed: Set<number> | null): boolean {
  return !allowed || allowed.has(i);
}

function firstRowForLabel(
  rows: (string | number | boolean | null)[][],
  xIdx: number,
  label: string,
  allowed: Set<number> | null,
): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    if (String(rows[i]![xIdx]) === label) return i;
  }
  return null;
}

function firstRowForXAndSub(
  rows: (string | number | boolean | null)[][],
  xIdx: number,
  xLabel: string,
  cIdx: number,
  subLabel: string,
  allowed: Set<number> | null,
): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    if (String(rows[i]![xIdx]) === xLabel && String(rows[i]![cIdx]) === subLabel) return i;
  }
  return null;
}

function pickBarFacetRow(
  facet: BarFacetHitPayload,
  rows: (string | number | boolean | null)[][],
  xIdx: number,
  cIdx: number,
  chartX: number,
  chartY: number,
  pad: number,
  w: number,
  h: number,
  allowed: Set<number> | null,
): number | null {
  const { xLabels, subLabels, grid, stackMode } = facet;
  const nx = xLabels.length;
  const ns = subLabels.length;
  if (nx === 0 || ns === 0) return null;
  const chartW = w - 2 * pad;
  const plotH = h - 2 * pad - 20;
  if (chartW <= 0 || plotH <= 0) return null;
  if (chartX < pad || chartX > w - pad || chartY < pad || chartY > h - pad) return null;

  const groupW = chartW / nx;

  if (stackMode === "grouped") {
    let maxVal = 0;
    for (let gi = 0; gi < nx; gi++) {
      for (let si = 0; si < ns; si++) {
        maxVal = Math.max(maxVal, grid[gi]![si]!);
      }
    }
    if (maxVal <= 0) maxVal = 1;
    const gi = Math.max(0, Math.min(nx - 1, Math.floor((chartX - pad) / groupW)));
    const within = chartX - pad - gi * groupW;
    const innerW = Math.max(2, (groupW - 6) / ns);
    const si = Math.max(0, Math.min(ns - 1, Math.floor((within - 3) / innerW)));
    const val = grid[gi]![si]!;
    const barH = (val / maxVal) * plotH;
    const xBar = pad + gi * groupW + 3 + si * innerW;
    const yTop = h - pad - barH;
    if (chartX < xBar || chartX > xBar + innerW - 1 || chartY < yTop || chartY > h - pad) return null;
    return firstRowForXAndSub(rows, xIdx, xLabels[gi]!, cIdx, subLabels[si]!, allowed);
  }

  const maxStack = Math.max(
    1,
    ...xLabels.map((_, gi) => subLabels.reduce((s, _, si) => s + grid[gi]![si]!, 0)),
  );

  const gi = Math.max(0, Math.min(nx - 1, Math.floor((chartX - pad) / groupW)));
  const x0 = pad + gi * groupW + 2;
  const bw = Math.max(4, groupW - 4);
  if (chartX < x0 || chartX > x0 + bw) return null;

  const xk = xLabels[gi]!;
  let yCursor = h - pad;
  for (let si = 0; si < ns; si++) {
    const v = grid[gi]![si]!;
    let barH: number;
    if (stackMode === "percent") {
      const sum = subLabels.reduce((s, _, j) => s + grid[gi]![j]!, 0) || 1;
      barH = (v / sum) * plotH;
    } else {
      barH = (v / maxStack) * plotH;
    }
    const top = yCursor - barH;
    if (chartY >= top && chartY <= yCursor) {
      return firstRowForXAndSub(rows, xIdx, xk, cIdx, subLabels[si]!, allowed);
    }
    yCursor = top;
  }
  return null;
}

function pickLineLikeNearestFixed(
  rows: (string | number | boolean | null)[][],
  xIdx: number,
  yIdx: number,
  chartX: number,
  chartY: number,
  pad: number,
  w: number,
  h: number,
  allowed: Set<number> | null,
): number | null {
  if (yIdx < 0) return null;
  const chartWidth = w - 2 * pad;
  const chartHeight = h - 2 * pad;
  if (chartWidth <= 0 || chartHeight <= 0) return null;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    const x = Number(rows[i]![xIdx]);
    const y = Number(rows[i]![yIdx]);
    if (!isNaN(x)) {
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
    }
    if (!isNaN(y)) {
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
  }
  if (xMin === Infinity || yMin === Infinity) return null;
  if (xMin === xMax) xMax = xMin + 1;
  if (yMin === yMax) yMax = yMin + 1;
  const dataX = ((chartX - pad) / chartWidth) * (xMax - xMin) + xMin;
  const dataY = yMax - ((chartY - pad) / chartHeight) * (yMax - yMin);
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    const x = Number(rows[i]![xIdx]);
    const y = Number(rows[i]![yIdx]);
    if (isNaN(x) || isNaN(y)) continue;
    const d = (x - dataX) ** 2 + (y - dataY) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pickFallbackNominalBands(
  rows: (string | number | boolean | null)[][],
  xIdx: number,
  yIdx: number,
  chartX: number,
  chartY: number,
  pad: number,
  w: number,
  h: number,
  allowed: Set<number> | null,
): number | null {
  if (xIdx < 0) return null;
  const labels = [...new Set(rows.map((r) => String(r[xIdx])))].slice(0, 20).sort((a, b) => a.localeCompare(b));
  if (labels.length === 0) return null;
  const chartWidth = w - 2 * pad;
  const chartHeight = h - 2 * pad;
  const t = (chartX - pad) / chartWidth;
  const idx = Math.max(0, Math.min(labels.length - 1, Math.floor(t * labels.length)));
  const lab = labels[idx]!;
  const candidates: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    if (String(rows[i]![xIdx]) === lab) candidates.push(i);
  }
  if (candidates.length === 0) return null;
  if (yIdx < 0) return candidates[0]!;
  const [yMin, yMax] = numRange(rows, yIdx);
  const dataY = yMax - ((chartY - pad) / chartHeight) * (yMax - yMin);
  let best = candidates[0]!;
  let bestD = Infinity;
  for (const i of candidates) {
    const y = Number(rows[i]![yIdx]);
    if (isNaN(y)) continue;
    const d = Math.abs(y - dataY);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function pickBubbleNearest(
  rows: (string | number | boolean | null)[][],
  xi: number,
  yi: number,
  ci: number,
  sizeIdx: number,
  chartX: number,
  chartY: number,
  pad: number,
  w: number,
  h: number,
  allowed: Set<number> | null,
): number | null {
  if (yi < 0) return null;
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const minR = 3;
  const maxR = Math.min(w, h) * 0.055;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  let bestIdx: number | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    const x = Number(rows[i]![xi]);
    const y = Number(rows[i]![yi]);
    if (isNaN(x) || isNaN(y)) continue;
    let radius = (minR + maxR) / 2;
    if (sizeIdx >= 0) {
      const s = Number(rows[i]![sizeIdx]);
      if (!isNaN(s)) {
        const t = (s - sizeMin) / sizeRange;
        radius = minR + Math.sqrt(Math.max(0, Math.min(1, t))) * (maxR - minR);
      }
    }
    const sx = pad + ((x - xMin) / xRange) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / yRange) * (h - 2 * pad);
    const d = Math.hypot(chartX - sx, chartY - sy) - radius;
    if (d < bestScore) {
      bestScore = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pickScatterCanvasNearest(
  rows: (string | number | boolean | null)[][],
  xi: number,
  yi: number,
  chartX: number,
  chartY: number,
  pad: number,
  w: number,
  h: number,
  allowed: Set<number> | null,
): number | null {
  if (yi < 0) return null;
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const chartW = w - 2 * pad;
  const chartH = h - 2 * pad;
  let bestIdx: number | null = null;
  let bestDist = 24;
  for (let i = 0; i < rows.length; i++) {
    if (!inAllowed(i, allowed)) continue;
    const x = Number(rows[i]![xi]);
    const y = Number(rows[i]![yi]);
    if (isNaN(x) || isNaN(y)) continue;
    const px = pad + ((x - xMin) / xRange) * chartW;
    const py = pad + (1 - (y - yMin) / yRange) * chartH;
    const d = Math.hypot(chartX - px, chartY - py);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Returns sample row index under pointer (canvas pixel coords), or null.
 * When `allowed` is set, only those row indices are considered (tooltip link).
 */
export function pickCanvasTooltipRowIndex(
  hit: Canvas2DHitContext,
  chartX: number,
  chartY: number,
  allowed: Set<number> | null = null,
): number | null {
  const { kind, rows, pad, w, h, xIdx, yIdx, cIdx, sizeIdx, barEntries, barFacet, yAggregate } = hit;
  const chartWidth = w - 2 * pad;
  const chartHeight = h - 2 * pad;
  if (chartX < pad || chartX > w - pad || chartY < pad || chartY > h - pad) return null;
  if (chartWidth <= 0 || chartHeight <= 0) return null;

  switch (kind) {
    case "bar": {
      if (xIdx < 0) return null;
      if (barFacet && cIdx >= 0) {
        return pickBarFacetRow(barFacet, rows, xIdx, cIdx, chartX, chartY, pad, w, h, allowed);
      }
      if (!barEntries?.length) return null;
      const t = (chartX - pad) / chartWidth;
      const barIndex = Math.floor(t * barEntries.length);
      const idx = Math.max(0, Math.min(barIndex, barEntries.length - 1));
      const [label] = barEntries[idx]!;
      return firstRowForLabel(rows, xIdx, label, allowed);
    }
    case "line":
      return pickLineLikeNearestFixed(rows, xIdx, yIdx, chartX, chartY, pad, w, h, allowed);
    case "area":
      return pickLineLikeNearestFixed(rows, xIdx, yIdx, chartX, chartY, pad, w, h, allowed);
    case "histogram": {
      if (xIdx < 0) return null;
      const [min, max] = numRange(rows, xIdx);
      const bins = 30;
      const binW = chartWidth / bins;
      const bi = Math.max(0, Math.min(bins - 1, Math.floor((chartX - pad) / binW)));
      const lo = min + (bi / bins) * (max - min);
      const hi = min + ((bi + 1) / bins) * (max - min);
      for (let i = 0; i < rows.length; i++) {
        if (!inAllowed(i, allowed)) continue;
        const v = Number(rows[i]![xIdx]);
        if (isNaN(v)) continue;
        if (v >= lo && (bi === bins - 1 ? v <= hi : v < hi)) return i;
      }
      return null;
    }
    case "heatmap": {
      if (xIdx < 0 || yIdx < 0) return null;
      const xLabels = [...new Set(rows.map((r) => String(r[xIdx])))].slice(0, 20);
      const yLabels = [...new Set(rows.map((r) => String(r[yIdx])))].slice(0, 20);
      if (xLabels.length === 0 || yLabels.length === 0) return null;
      const cellW = chartWidth / xLabels.length;
      const cellH = chartHeight / yLabels.length;
      const xi2 = Math.max(0, Math.min(xLabels.length - 1, Math.floor((chartX - pad) / cellW)));
      const yi2 = Math.max(0, Math.min(yLabels.length - 1, Math.floor((chartY - pad - 20) / cellH)));
      const xL = xLabels[xi2]!;
      const yL = yLabels[yi2]!;
      for (let i = 0; i < rows.length; i++) {
        if (!inAllowed(i, allowed)) continue;
        if (String(rows[i]![xIdx]) === xL && String(rows[i]![yIdx]) === yL) return i;
      }
      return null;
    }
    case "strip": {
      if (xIdx < 0 || yIdx < 0) return null;
      const [xMin, xMax] = numRange(rows, xIdx);
      const yLabels = [...new Set(rows.map((r) => String(r[yIdx])))].slice(0, 15);
      if (yLabels.length === 0) return null;
      const bandH = (h - 2 * pad - 20) / yLabels.length;
      const yiL = Math.max(0, Math.min(yLabels.length - 1, Math.floor((chartY - pad - 20) / bandH)));
      const yLab = yLabels[yiL]!;
      let best: number | null = null;
      let bestDx = Infinity;
      const dataX = xMin + ((chartX - pad) / chartWidth) * (xMax - xMin);
      for (let i = 0; i < rows.length; i++) {
        if (!inAllowed(i, allowed)) continue;
        if (String(rows[i]![yIdx]) !== yLab) continue;
        const x = Number(rows[i]![xIdx]);
        if (isNaN(x)) continue;
        const dx = Math.abs(x - dataX);
        if (dx < bestDx) {
          bestDx = dx;
          best = i;
        }
      }
      return best;
    }
    case "box": {
      if (xIdx < 0 || yIdx < 0) return null;
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const v = Number(r[yIdx]);
        if (isNaN(v)) continue;
        const k = String(r[xIdx]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(v);
      }
      const entries = [...groups.keys()].sort((a, b) => a.localeCompare(b)).slice(0, 20);
      if (entries.length === 0) return null;
      const slotW = (w - 2 * pad - 40) / entries.length;
      const i = Math.max(0, Math.min(entries.length - 1, Math.floor((chartX - pad - 24) / slotW)));
      const label = entries[i]!;
      const vals: number[] = [];
      for (let ri = 0; ri < rows.length; ri++) {
        if (!inAllowed(ri, allowed)) continue;
        if (String(rows[ri]![xIdx]) !== label) continue;
        const y = Number(rows[ri]![yIdx]);
        if (!isNaN(y)) vals.push(y);
      }
      const gMin = vals.length ? Math.min(...vals) : 0;
      const gMax = vals.length ? Math.max(...vals) : 1;
      const plotH = h - 2 * pad - 24;
      const range = gMax - gMin || 1;
      const yData = gMax - ((chartY - pad - 20) / plotH) * range;
      let best: number | null = null;
      let bestDy = Infinity;
      for (let ri = 0; ri < rows.length; ri++) {
        if (!inAllowed(ri, allowed)) continue;
        if (String(rows[ri]![xIdx]) !== label) continue;
        const y = Number(rows[ri]![yIdx]);
        if (isNaN(y)) continue;
        const dy = Math.abs(y - yData);
        if (dy < bestDy) {
          bestDy = dy;
          best = ri;
        }
      }
      return best;
    }
    case "pie": {
      if (xIdx < 0) return null;
      const agg: YAggregateOption = yIdx < 0 ? "count" : (yAggregate ?? "sum");
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = String(r[xIdx]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(yIdx >= 0 ? Number(r[yIdx]) : 1);
      }
      const pieEntries = [...groups.entries()]
        .map(([label, vals]) => [label, aggregateValues(vals.filter((v) => !isNaN(v)), agg) || (yIdx < 0 ? vals.length : 0)] as [string, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
      const total = pieEntries.reduce((s, [, v]) => s + v, 0);
      if (total === 0) return null;
      const cx = w / 2;
      const cy = (h - pad - 20) / 2;
      const dx = chartX - cx;
      const dy = chartY - cy;
      const angle = Math.atan2(dy, dx);
      let t = (angle + Math.PI / 2) / (Math.PI * 2);
      if (t < 0) t += 1;
      let acc = 0;
      for (const [label, val] of pieEntries) {
        acc += val / total;
        if (t <= acc) return firstRowForLabel(rows, xIdx, label, allowed);
      }
      const [lastLabel] = pieEntries[pieEntries.length - 1]!;
      return firstRowForLabel(rows, xIdx, lastLabel, allowed);
    }
    case "bubble":
      return pickBubbleNearest(rows, xIdx, yIdx, cIdx, sizeIdx, chartX, chartY, pad, w, h, allowed);
    case "violin": {
      if (xIdx < 0 || yIdx < 0) return null;
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = String(r[xIdx]);
        const v = Number(r[yIdx]);
        if (isNaN(v)) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(v);
      }
      const ventries = [...groups.keys()].slice(0, 12);
      if (ventries.length === 0) return null;
      const bandW = chartWidth / ventries.length;
      const gi = Math.max(0, Math.min(ventries.length - 1, Math.floor((chartX - pad) / bandW)));
      const label = ventries[gi]!;
      const allVals = rows.filter((_, ri) => inAllowed(ri, allowed) && String(rows[ri]![xIdx]) === label).map((r) => Number(r[yIdx])).filter((v) => !isNaN(v));
      const gMin = allVals.length ? Math.min(...allVals) : 0;
      const gMax = allVals.length ? Math.max(...allVals) : 1;
      const range = gMax - gMin || 1;
      const plotH = h - 2 * pad - 20;
      const yData = gMax - ((chartY - pad - 20) / plotH) * range;
      let best: number | null = null;
      let bestDy = Infinity;
      for (let ri = 0; ri < rows.length; ri++) {
        if (!inAllowed(ri, allowed)) continue;
        if (String(rows[ri]![xIdx]) !== label) continue;
        const y = Number(rows[ri]![yIdx]);
        if (isNaN(y)) continue;
        const dy = Math.abs(y - yData);
        if (dy < bestDy) {
          bestDy = dy;
          best = ri;
        }
      }
      return best;
    }
    case "waterfall": {
      if (xIdx < 0) return null;
      const agg: YAggregateOption = yIdx < 0 ? "count" : (yAggregate ?? "sum");
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = String(r[xIdx]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(yIdx >= 0 ? Number(r[yIdx]) : 1);
      }
      const wfEntries = [...groups.entries()]
        .map(([label, vals]) => [label, aggregateValues(vals.filter((v) => !isNaN(v)), agg)] as [string, number])
        .slice(0, 20);
      if (wfEntries.length === 0) return null;
      const t = (chartX - pad) / chartWidth;
      const barIndex = Math.floor(t * wfEntries.length);
      const idx = Math.max(0, Math.min(barIndex, wfEntries.length - 1));
      const [label] = wfEntries[idx]!;
      return firstRowForLabel(rows, xIdx, label, allowed);
    }
    case "lollipop": {
      if (xIdx < 0) return null;
      const agg: YAggregateOption = yIdx < 0 ? "count" : (yAggregate ?? "sum");
      const groups = new Map<string, { vals: number[]; cat: string }>();
      for (const r of rows) {
        const k = String(r[xIdx]);
        if (!groups.has(k)) groups.set(k, { vals: [], cat: cIdx >= 0 ? String(r[cIdx]) : "" });
        groups.get(k)!.vals.push(yIdx >= 0 ? Number(r[yIdx]) : 1);
      }
      const lolli = [...groups.entries()]
        .map(([label, g]) => ({ label, value: aggregateValues(g.vals.filter((v) => !isNaN(v)), agg) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);
      if (lolli.length === 0) return null;
      const bandH = chartHeight / lolli.length;
      const i = Math.max(0, Math.min(lolli.length - 1, Math.floor((chartY - pad) / bandH)));
      const { label } = lolli[i]!;
      return firstRowForLabel(rows, xIdx, label, allowed);
    }
    case "scatter":
      return pickScatterCanvasNearest(rows, xIdx, yIdx, chartX, chartY, pad, w, h, allowed);
    case "radar":
    case "treemap":
    case "sunburst":
    case "choropleth":
    case "forceBubble":
    case "sankey":
      if (yIdx >= 0) {
        const n = pickLineLikeNearestFixed(rows, xIdx, yIdx, chartX, chartY, pad, w, h, allowed);
        if (n != null) return n;
      }
      return pickFallbackNominalBands(rows, xIdx, yIdx, chartX, chartY, pad, w, h, allowed);
    default:
      return null;
  }
}
