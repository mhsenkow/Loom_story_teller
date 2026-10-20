// =================================================================
// Canvas chart renderer plumbing (hits, labels, aggregation)
// =================================================================

import type { PlotRect } from "../chartLooks";
import { aggregateAxisTitle } from "../chartAxes";
import type { YAggregateOption } from "../recommendations";
import type { HitTarget } from "../chartTooltip";
import type { ChartRenderOpts } from "../chartRenderTypes";

export function aggregateValues(values: number[], agg: YAggregateOption): number {
  if (agg === "count") return values.length;
  let count = 0, sum = 0, min = Infinity, max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    count++;
    sum += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!count) return 0;
  return agg === "mean" ? sum / count : agg === "min" ? min : agg === "max" ? max : sum;
}

export function pushHit(opts: ChartRenderOpts | undefined, t: HitTarget) {
  opts?.hits?.push(t);
}

export function fieldLabel(opts: ChartRenderOpts | undefined, idx: number, fallback = "value"): string {
  return (idx >= 0 ? opts?.fieldNames?.[idx] : undefined) ?? fallback;
}

export function valueTitle(opts: ChartRenderOpts | undefined, yi: number, fallbackAgg: YAggregateOption = "sum"): string {
  if (opts?.seriesNormalize === "index100") return "Index (first non-zero = 100)";
  if (opts?.seriesNormalize === "zscore") return "Standard deviations from mean";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? fallbackAgg);
  return aggregateAxisTitle(agg, yi >= 0 ? fieldLabel(opts, yi) : null);
}

export function setLegend(opts: ChartRenderOpts | undefined, entries: { label: string; color: string; shape?: string; glyph?: string }[]) {
  if (opts) opts.legend = entries;
}

export function plotOf(w: number, h: number, pad: number, opts?: ChartRenderOpts): PlotRect {
  return opts?.plotBounds ? { ...opts.plotBounds } : { left: pad, top: pad, right: w - pad, bottom: h - pad };
}
