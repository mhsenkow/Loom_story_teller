// =================================================================
// chartA11ySummary — screen-reader chart synopsis (LOOM-070)
// =================================================================

import type { ChartRecommendation } from "./recommendations";

export function buildChartA11ySummary(args: {
  chart: ChartRecommendation | null;
  rowCount?: number;
  kindLabel?: string;
}): string {
  const { chart, rowCount = 0 } = args;
  if (!chart) return "Chart area. Select a chart to view data.";
  const kind = args.kindLabel ?? chart.kind;
  const parts = [`${chart.title || kind} chart`, `${kind}`];
  if (chart.xField) parts.push(`horizontal ${chart.xField}`);
  if (chart.yField) parts.push(`vertical ${chart.yField}`);
  if (rowCount > 0) parts.push(`${rowCount.toLocaleString()} rows`);
  return parts.join(", ");
}
