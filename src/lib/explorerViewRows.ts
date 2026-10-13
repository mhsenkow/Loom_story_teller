// =================================================================
// explorerViewRows — apply Explorer filters/sort to a row matrix
// =================================================================
// Shared by Chart (and Preview) so table filters don't stay Explorer-only.
// Returns sourceIndices into the input rows (original sample indices).
// =================================================================

import {
  cellMatchesExplorerNumericFilter,
  parseExplorerNumericFilter,
} from "./tableExplorer";
import { compareExplorerCells } from "./tableSort";

type Cell = string | number | boolean | null;

const NUMERIC_TYPES = new Set([
  "INTEGER",
  "BIGINT",
  "DOUBLE",
  "FLOAT",
  "REAL",
  "DECIMAL",
  "TINYINT",
  "SMALLINT",
]);

export type ExplorerViewSortDir = "asc" | "desc";

export type ApplyExplorerViewOpts = {
  columnFilters?: Record<string, string>;
  /** Original sample indices (e.g. Smart anomaly filter). */
  filterRowIndices?: number[] | null;
  columnStats?: { name: string; data_type: string }[];
  /** Column name to sort by (store uses names, not display index). */
  sortColumn?: string | null;
  sortDir?: ExplorerViewSortDir | null;
  /** Columns considered for filters (defaults to all `columns`). */
  filterColumns?: string[] | null;
};

function isNumericStat(dataType: string): boolean {
  const t = dataType.toUpperCase();
  return NUMERIC_TYPES.has(t) || /INT|FLOAT|DOUBLE|DECIMAL|REAL/.test(t);
}

function rowMatchesColumnFilters(
  row: Cell[],
  columns: string[],
  filterColumns: string[],
  filters: Record<string, string>,
  columnStats: { name: string; data_type: string }[],
): boolean {
  for (const col of filterColumns) {
    const filterVal = (filters[col] ?? "").trim();
    if (!filterVal) continue;
    const rawIdx = columns.indexOf(col);
    if (rawIdx < 0) continue;
    const cell = row[rawIdx];
    const str = String(cell ?? "").toLowerCase();
    const f = filterVal.toLowerCase();
    if (f === "null" || f === "is null") {
      if (cell != null && cell !== "") return false;
      continue;
    }
    const stat = columnStats.find((s) => s.name === col);
    if (stat && isNumericStat(stat.data_type)) {
      const parsed = parseExplorerNumericFilter(filterVal);
      if (parsed) {
        if (!cellMatchesExplorerNumericFilter(cell, parsed)) return false;
        continue;
      }
    }
    if (!str.includes(f)) return false;
  }
  return true;
}

/**
 * Filter (+ optional sort) a sample matrix the same way Explorer does.
 * `sourceIndices` always map back into the input `rows` array.
 */
export function applyExplorerViewToRows(
  rows: Cell[][],
  columns: string[],
  opts: ApplyExplorerViewOpts = {},
): { rows: Cell[][]; sourceIndices: number[]; changed: boolean } {
  const filters = opts.columnFilters ?? {};
  const hasColFilters = Object.keys(filters).some((k) => (filters[k] ?? "").trim());
  const filterSet =
    opts.filterRowIndices?.length ? new Set(opts.filterRowIndices) : null;
  const sortCol = opts.sortColumn?.trim() || null;
  const sortDir = opts.sortDir === "asc" || opts.sortDir === "desc" ? opts.sortDir : null;
  const filterColumns = opts.filterColumns?.length ? opts.filterColumns : columns;
  const stats = opts.columnStats ?? [];

  if (!filterSet && !hasColFilters && !(sortCol && sortDir)) {
    return {
      rows,
      sourceIndices: rows.map((_, i) => i),
      changed: false,
    };
  }

  let indices = rows.map((_, i) => i);
  if (filterSet) {
    indices = indices.filter((i) => filterSet.has(i));
  }
  if (hasColFilters) {
    indices = indices.filter((i) =>
      rowMatchesColumnFilters(rows[i]!, columns, filterColumns, filters, stats),
    );
  }

  if (sortCol && sortDir) {
    const rawIdx = columns.indexOf(sortCol);
    if (rawIdx >= 0) {
      const dir = sortDir === "asc" ? 1 : -1;
      indices = [...indices].sort((ia, ib) => {
        const cmp = compareExplorerCells(
          rows[ia]![rawIdx] as Cell,
          rows[ib]![rawIdx] as Cell,
          dir,
        );
        if (cmp !== 0) return cmp;
        return (ia - ib) * dir;
      });
    }
  }

  const changed =
    indices.length !== rows.length || indices.some((orig, i) => orig !== i);

  return {
    rows: indices.map((i) => rows[i]!),
    sourceIndices: indices,
    changed,
  };
}

/** True when Explorer has an active filter (not sort-only). */
export function explorerFiltersActive(
  columnFilters?: Record<string, string> | null,
  filterRowIndices?: number[] | null,
): boolean {
  if (filterRowIndices?.length) return true;
  if (!columnFilters) return false;
  return Object.keys(columnFilters).some((k) => (columnFilters[k] ?? "").trim());
}
