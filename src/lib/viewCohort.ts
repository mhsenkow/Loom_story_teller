// =================================================================
// viewCohort — shared Explorer ↔ Chart “what you’re looking at”
// =================================================================
// Filters, sort, brush selection, and time window form one cohort.
// ViewCohortBar + resetViewCohort keep both surfaces honest.
// =================================================================

import type { ChartTimeRange } from "./chartTime";
import type { LoomState } from "./store/types";

export type ViewCohortSnapshot = {
  hasColumnFilters: boolean;
  hasRowFilter: boolean;
  hasSort: boolean;
  hasSelection: boolean;
  hasTimeWindow: boolean;
  lockedColor: string | null;
  /** Anything that narrows or reorders the view. */
  active: boolean;
  /** Short status for the cohort bar. */
  summary: string;
};

export function describeViewCohort(s: Pick<
  LoomState,
  | "tableColumnFilters"
  | "tableFilterRowIndices"
  | "tableSortColumn"
  | "tableSortDir"
  | "selectedRowIndices"
  | "viewTimeWindow"
  | "viewTimeField"
  | "lockedColorField"
>): ViewCohortSnapshot {
  const colKeys = Object.keys(s.tableColumnFilters ?? {}).filter((k) => (s.tableColumnFilters[k] ?? "").trim());
  const hasColumnFilters = colKeys.length > 0;
  const hasRowFilter = (s.tableFilterRowIndices?.length ?? 0) > 0;
  const hasSort = !!(s.tableSortColumn && s.tableSortDir);
  const hasSelection = (s.selectedRowIndices?.length ?? 0) > 0;
  const hasTimeWindow = !!(s.viewTimeWindow && s.viewTimeWindow !== "all" && s.viewTimeField);
  const lockedColor = s.lockedColorField?.trim() || null;
  const parts: string[] = [];
  if (hasRowFilter) parts.push(`${s.tableFilterRowIndices!.length.toLocaleString()} brushed`);
  if (hasColumnFilters) parts.push(colKeys.length === 1 ? `filter · ${colKeys[0]}` : `${colKeys.length} filters`);
  if (hasSort) parts.push(`sort · ${s.tableSortColumn} ${s.tableSortDir === "asc" ? "↑" : "↓"}`);
  if (hasTimeWindow) parts.push(`${s.viewTimeWindow}${s.viewTimeField ? ` · ${s.viewTimeField}` : ""}`);
  if (hasSelection && !hasRowFilter) parts.push(`${s.selectedRowIndices.length.toLocaleString()} selected`);
  if (lockedColor) parts.push(`color locked · ${lockedColor}`);
  return {
    hasColumnFilters,
    hasRowFilter,
    hasSort,
    hasSelection,
    hasTimeWindow,
    lockedColor,
    active: hasColumnFilters || hasRowFilter || hasSort || hasTimeWindow || hasSelection || !!lockedColor,
    summary: parts.join(" · ") || "Full sample",
  };
}

/** Patch to restore the open cohort (does not touch the dataset). */
export function resetViewCohortPatch(): Partial<LoomState> {
  return {
    tableColumnFilters: {},
    tableFilterRowIndices: null,
    tableSortColumn: null,
    tableSortDir: null,
    selectedRowIndices: [],
    viewTimeWindow: "all",
    viewTimeField: null,
    // Keep color lock — user chose it intentionally; unlock is separate
  };
}

export function isChartTimeRange(v: string): v is ChartTimeRange {
  return ["all", "1h", "6h", "24h", "7d", "30d", "90d", "1y"].includes(v);
}
