import { chartNumber } from "./chartNumbers";
// =================================================================
// Facet small-multiples — shared scales across panels (LOOM-116)
// =================================================================

import type { ChartKind } from "./recommendations";
import type { YAggregateOption } from "./recommendations";
import { aggregateValues } from "./canvasCharts/plumbing";
import { timeBuckets } from "./canvasCharts/axisHelpers";
import { computeBarModel } from "./canvasCharts/bar";
import { buildBarFacetGrid } from "./chartTooltip";
import { buildXModel } from "./chartAxes";
import { partitionRowsByFacet } from "./chartFacets";
import { normalizeSeriesValues, rollingMean, stackSignedSeries } from "./dsTransforms";
import type { ChartRenderOpts } from "./chartRenderTypes";

function numRange(rows: unknown[][], idx: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = chartNumber(r[idx]);
    if (!isNaN(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min)) return [0, 1];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return [min, max];
}

/** Shared domains are computed from plotted aggregates, separately per panel. */
export function computeFacetSharedValueDomain(
  kind: ChartKind,
  allRows: unknown[][],
  xi: number,
  yi: number,
  agg: YAggregateOption,
  rowIdx = -1,
  colorIdx = -1,
  opts?: ChartRenderOpts,
): { min: number; max: number } | null {
  if (!["bar", "line", "area"].includes(kind)) return null;
  const panels = rowIdx >= 0 ? partitionRowsByFacet(allRows, rowIdx).map(p => p.rows) : [allRows];
  let min = Infinity, max = -Infinity;
  const include = (v: number) => {
    if (!Number.isFinite(v) || (opts?.yScale === "log" && v <= 0)) return;
    min = Math.min(min, v); max = Math.max(max, v);
  };
  for (const rows of panels) {
    if (kind === "bar") {
      const grid = colorIdx >= 0 && colorIdx !== xi ? buildBarFacetGrid(rows, xi, yi, colorIdx, agg, opts?.barStackMode ?? "grouped", opts?.topN) : null;
      if (grid) {
        if (grid.stackMode === "grouped") grid.grid.flat().forEach(include);
        else for (const row of grid.grid) {
          include(row.reduce((sum, v) => sum + Math.max(0, v), 0));
          include(row.reduce((sum, v) => sum + Math.min(0, v), 0));
        }
      } else computeBarModel(rows, xi, yi, agg, opts?.topN ?? undefined).entries.forEach(([, v]) => include(v));
      include(0);
      continue;
    }
    const tb = timeBuckets(rows, xi);
    const keys = buildXModel([...new Set(rows.map(tb.keyOf))]).keys;
    const bySeries = new Map<string, Map<string, number[]>>();
    for (const row of rows) {
      const series = colorIdx >= 0 ? String(row[colorIdx]) : "";
      if (!bySeries.has(series)) bySeries.set(series, new Map());
      const buckets = bySeries.get(series)!;
      const key = tb.keyOf(row);
      if (!buckets.has(key)) buckets.set(key, []);
      const value = yi < 0 || agg === "count" ? 1 : chartNumber(row[yi]);
      if (Number.isFinite(value)) buckets.get(key)!.push(value);
    }
    const transform = (values: number[]) => {
      let result = opts?.rollingWindow ? rollingMean(values, opts.rollingWindow) : values;
      if (opts?.seriesNormalize) result = normalizeSeriesValues(result, opts.seriesNormalize);
      return result;
    };
    const series = [...bySeries.values()].map(buckets => transform(keys
      .filter(key => kind === "area" || buckets.get(key)?.length)
      .map(key => aggregateValues(buckets.get(key) ?? [], agg))));
    if (kind === "area") {
      const stack = stackSignedSeries(series);
      stack.tops.flat().forEach(include);
      stack.bases.flat().forEach(include);
    } else series.flat().forEach(include);
    const y2Idx = opts?.y2Field ? opts.fieldNames?.indexOf(opts.y2Field) ?? -1 : -1;
    if (y2Idx >= 0 && y2Idx !== yi) {
      const overlay = computeFacetSharedValueDomain("line", rows, xi, y2Idx, agg, -1, kind === "line" ? colorIdx : -1, { ...opts!, y2Field: null });
      if (overlay) { include(overlay.min); include(overlay.max); }
    }
    if (kind === "area" || (!opts?.seriesNormalize && (agg === "sum" || agg === "count"))) include(0);
  }
  return Number.isFinite(min) ? { min, max } : null;
}

export function computeFacetSharedScatterBounds(
  allRows: unknown[][],
  xi: number,
  yi: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  if (yi < 0) return null;
  const [xMin, xMax] = numRange(allRows, xi);
  const [yMin, yMax] = numRange(allRows, yi);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null;
  return { xMin, xMax, yMin, yMax };
}
