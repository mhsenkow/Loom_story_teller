// =================================================================
// Facet small-multiples — shared scales across panels (LOOM-116)
// =================================================================

import type { ChartKind } from "./recommendations";
import type { YAggregateOption } from "./recommendations";
import { aggregateValues } from "./canvasCharts/plumbing";

function numRange(rows: unknown[][], idx: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = Number(r[idx]);
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

function barPanelValues(
  rows: unknown[][],
  xi: number,
  yi: number,
  agg: YAggregateOption,
): number[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    if (yi < 0) groups.get(k)!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) groups.get(k)!.push(v);
    }
  }
  return [...groups.values()].map((vals) => aggregateValues(vals, agg));
}

/** Shared measure axis domain for faceted bar / line / area. */
export function computeFacetSharedValueDomain(
  kind: ChartKind,
  allRows: unknown[][],
  xi: number,
  yi: number,
  agg: YAggregateOption,
): { min: number; max: number } | null {
  if (kind === "bar") {
    const vals = barPanelValues(allRows, xi, yi, agg);
    if (vals.length === 0) return null;
    let min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    if (agg === "count" || (agg === "sum" && min >= 0)) min = Math.min(0, min);
    return { min, max };
  }
  if (kind === "line" || kind === "area") {
    const vals: number[] = [];
    for (const r of allRows) {
      if (yi < 0) vals.push(1);
      else {
        const v = Number(r[yi]);
        if (!isNaN(v)) vals.push(v);
      }
    }
    if (vals.length === 0) return null;
    let min = Math.min(...vals);
    const max = Math.max(...vals);
    if (agg === "count" || (agg === "sum" && min >= 0)) min = Math.min(0, min);
    return { min, max };
  }
  return null;
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
