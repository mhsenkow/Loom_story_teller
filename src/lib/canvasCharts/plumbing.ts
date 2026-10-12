// =================================================================
// Canvas chart renderer plumbing (hits, labels, aggregation)
// =================================================================

import type { PlotRect } from "../chartLooks";
import { aggregateAxisTitle } from "../chartAxes";
import type { YAggregateOption } from "../recommendations";
import type { HitTarget } from "../chartTooltip";
import type { ChartRenderOpts } from "../chartRenderTypes";

export function aggregateValues(values: number[], agg: YAggregateOption): number {
  if (values.length === 0) return 0;
  if (agg === "count") return values.length;
  if (agg === "sum") return values.reduce((a, b) => a + b, 0);
  if (agg === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === "min") {
    let m = values[0]!;
    for (let i = 1; i < values.length; i++) m = Math.min(m, values[i]!);
    return m;
  }
  if (agg === "max") {
    let m = values[0]!;
    for (let i = 1; i < values.length; i++) m = Math.max(m, values[i]!);
    return m;
  }
  return values.reduce((a, b) => a + b, 0);
}

export function pushHit(opts: ChartRenderOpts | undefined, t: HitTarget) {
  opts?.hits?.push(t);
}

export function fieldLabel(opts: ChartRenderOpts | undefined, idx: number, fallback = "value"): string {
  return (idx >= 0 ? opts?.fieldNames?.[idx] : undefined) ?? fallback;
}

export function valueTitle(opts: ChartRenderOpts | undefined, yi: number, fallbackAgg: YAggregateOption = "sum"): string {
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? fallbackAgg);
  return aggregateAxisTitle(agg, yi >= 0 ? fieldLabel(opts, yi) : null);
}

export function setLegend(opts: ChartRenderOpts | undefined, entries: { label: string; color: string }[]) {
  if (opts) opts.legend = entries;
}

export function plotOf(w: number, h: number, pad: number): PlotRect {
  return { left: pad, top: pad, right: w - pad, bottom: h - pad };
}
