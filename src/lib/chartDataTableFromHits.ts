// =================================================================
// chartDataTableFromHits — sr-only data table from hit summaries (LOOM-348)
// =================================================================

import type { HitTarget } from "./chartTooltip";

export type ChartDataTableRow = {
  key: string;
  columns: string[];
  cells: (string | number | null)[];
};

export function dataTableRowsFromHits(targets: HitTarget[] | undefined): ChartDataTableRow[] {
  if (!targets?.length) return [];
  const rows: ChartDataTableRow[] = [];
  const seen = new Set<string>();
  targets.forEach((t, i) => {
    const summary = t.summary;
    if (!summary?.columns?.length) return;
    const key = summary.row.map(String).join("\u0001");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      key: `hit-${i}-${key.slice(0, 40)}`,
      columns: summary.columns,
      cells: summary.row,
    });
  });
  return rows;
}
