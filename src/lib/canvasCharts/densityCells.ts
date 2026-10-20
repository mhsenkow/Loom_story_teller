// Shared cell statistics and color normalization for rectangular and hexagonal
// heatmaps. Missing measures never become zero; count always counts rows.
import { chartNumber } from "../chartNumbers";
import { aggregateAxisTitle } from "../chartAxes";
import type { ChartRenderOpts } from "../chartRenderTypes";
import type { YAggregateOption } from "../recommendations";
import { plotOf } from "./plumbing";

/** Keep the color-scale title and endpoints on the canvas. Miniatures need no key. */
export function densityPlot(w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const rect = plotOf(w, h, pad, opts);
  if (!opts?.mini && opts?.legendPosition !== "none" && !opts?.plotBounds)
    rect.right = Math.min(rect.right, Math.max(rect.left + 24, w - 92));
  return rect;
}

export type DensityCell = { count: number; valid: number; sum: number; min: number; max: number; row: number };

export function addDensityCell<K>(cells: Map<K, DensityCell>, key: K, value: unknown, row: number): void {
  let cell = cells.get(key);
  if (!cell) {
    cell = { count: 0, valid: 0, sum: 0, min: Infinity, max: -Infinity, row };
    cells.set(key, cell);
  }
  cell.count++;
  const n = chartNumber(value);
  if (!Number.isFinite(n)) return;
  cell.valid++;
  cell.sum += n;
  cell.min = Math.min(cell.min, n);
  cell.max = Math.max(cell.max, n);
}

export function densityMeasure(opts?: ChartRenderOpts): { index: number; aggregate: YAggregateOption; title: string } {
  const index = opts?.colorField ? opts.fieldNames?.indexOf(opts.colorField) ?? -1 : -1;
  const aggregate = index < 0 ? "count" : opts?.yAggregate ?? "mean";
  return { index, aggregate, title: aggregate === "count" ? "Rows" : aggregateAxisTitle(aggregate, opts!.colorField!) };
}

export function densityValue(cell: DensityCell | undefined, aggregate: YAggregateOption): number | null {
  if (!cell) return null;
  if (aggregate === "count") return cell.count;
  if (!cell.valid) return null;
  switch (aggregate) {
    case "sum": return cell.sum;
    case "mean": return cell.sum / cell.valid;
    case "min": return cell.min;
    case "max": return cell.max;
  }
}

export function densityDomain(cells: Iterable<DensityCell>, aggregate: YAggregateOption) {
  let min = Infinity, max = -Infinity;
  for (const cell of cells) {
    const value = densityValue(cell, aggregate);
    if (value === null) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (aggregate === "count") min = 0;
  return { min, max };
}

export function densityFraction(value: number, domain: { min: number; max: number }): number {
  return domain.max === domain.min ? 0.5 : Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
}
