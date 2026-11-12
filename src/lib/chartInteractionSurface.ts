// Scatter navigation needs one coordinate plane; facets use their painted marks.
export function usesScatterNavigation(chart: { kind: string; rowField?: string | null } | null | undefined): boolean {
  return chart?.kind === "scatter" && !chart.rowField;
}
