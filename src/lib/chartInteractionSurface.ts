import { findChartDefinition } from "./chartDefinitions";
// Scatter navigation needs one coordinate plane; facets use their painted marks.
export function usesScatterNavigation(chart: { kind: string; rowField?: string | null } | null | undefined): boolean {
  return !!chart && !chart.rowField && findChartDefinition(chart.kind)?.interactions.navigation === "scatter";
}
