// =================================================================
// tableSlice — table prefs, column filters, undo/redo, saved views
// =================================================================

import type { LoomState, TableViewItem, ViewMode } from "./types";
import { snapshotTableState } from "./coreSlice";
import { newLoomId } from "../loomId";
import type { ChartTimeRange } from "../chartTime";
import { resetViewCohortPatch } from "../viewCohort";

export const TABLE_UNDO_LIMIT = 20;
export const TABLE_VIEW_LIMIT = 20;

export function tableInitialState() {
  return {
    tablePrefs: { visibleColumns: null as string[] | null, columnOrder: null as string[] | null },
    tableFilterRowIndices: null as number[] | null,
    tableColumnFilters: {} as Record<string, string>,
    tableSortColumn: null as string | null,
    tableSortDir: null as "asc" | "desc" | null,
    viewTimeField: null as string | null,
    viewTimeWindow: "all" as ChartTimeRange,
    lockedColorField: null as string | null,
    brushLinksFilter: true,
    statsFocusColumn: null as string | null,
    tableUndoStack: [] as LoomState["tableUndoStack"],
    tableRedoStack: [] as LoomState["tableRedoStack"],
    selectedRowIndices: [] as number[],
    tableViews: [] as TableViewItem[],
  };
}

type Setter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;

export function createTableSlice(set: Setter) {
  return {
    setTablePrefs: (p: { visibleColumns: string[] | null; columnOrder: string[] | null }) => set({ tablePrefs: p }),
    setTableFilterRowIndices: (indices: number[] | null) => set({ tableFilterRowIndices: indices }),
    setTableColumnFilter: (column: string, value: string) =>
      set((s) => ({
        tableColumnFilters: value.trim()
          ? { ...s.tableColumnFilters, [column]: value.trim() }
          : (() => { const next = { ...s.tableColumnFilters }; delete next[column]; return next; })(),
      })),
    setTableColumnFilters: (filters: Record<string, string>) =>
      set((s) => {
        const next = { ...filters };
        const prev = s.tableColumnFilters;
        const same = Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => prev[k] === v);
        if (same) return s;
        return { tableColumnFilters: next, tableUndoStack: [snapshotTableState(s), ...s.tableUndoStack].slice(0, 20), tableRedoStack: [] };
      }),
    setTableSort: (column: string | null, dir: "asc" | "desc" | null) =>
      set({ tableSortColumn: column, tableSortDir: dir }),
    setViewTimeWindow: (field: string | null, range: ChartTimeRange) =>
      set({
        viewTimeField: range === "all" ? null : field,
        viewTimeWindow: range,
      }),
    setLockedColorField: (field: string | null) =>
      set({ lockedColorField: field?.trim() || null }),
    setBrushLinksFilter: (v: boolean) => set({ brushLinksFilter: v }),
    setStatsFocusColumn: (column: string | null) => set({ statsFocusColumn: column }),
    /** Chart brush/lasso → Explorer (+ Chart) cohort when linking is on. */
    applyBrushSelection: (indices: number[]) =>
      set((s) => {
        const next: Partial<LoomState> = { selectedRowIndices: indices };
        if (s.brushLinksFilter) {
          next.tableFilterRowIndices = indices.length > 0 ? indices : null;
        }
        return next;
      }),
    resetViewCohort: () => set((s) => ({ ...resetViewCohortPatch(), lockedColorField: s.lockedColorField })),
    unlockColorAndResetLocks: () => set({ lockedColorField: null }),
    pushTableUndo: () =>
      set((s) => ({ tableUndoStack: [snapshotTableState(s), ...s.tableUndoStack].slice(0, 20), tableRedoStack: [] })),
    undoTable: () =>
      set((s) => {
        if (s.tableUndoStack.length === 0) return s;
        const [snap, ...rest] = s.tableUndoStack;
        return { tablePrefs: snap.tablePrefs, tableColumnFilters: snap.tableColumnFilters, tableUndoStack: rest, tableRedoStack: [snapshotTableState(s), ...s.tableRedoStack].slice(0, 20) };
      }),
    redoTable: () =>
      set((s) => {
        if (s.tableRedoStack.length === 0) return s;
        const [snap, ...rest] = s.tableRedoStack;
        return { tablePrefs: snap.tablePrefs, tableColumnFilters: snap.tableColumnFilters, tableRedoStack: rest, tableUndoStack: [snapshotTableState(s), ...s.tableUndoStack].slice(0, 20) };
      }),
    setSelectedRowIndices: (indices: number[] | ((prev: number[]) => number[])) =>
      set((s) => ({ selectedRowIndices: typeof indices === "function" ? indices(s.selectedRowIndices) : indices })),
    setTableViews: (views: TableViewItem[]) => set({ tableViews: views.slice(0, 20) }),
    addTableView: (name: string, visibleColumns: string[] | null, columnOrder: string[] | null, columnFilters: Record<string, string>, querySql?: string | null, snapshotData?: TableViewItem["snapshotData"]) =>
      set((s) => ({
        tableViews: [{ id: newLoomId("v-"), name: name.trim() || "View", visibleColumns, columnOrder, columnFilters: { ...columnFilters }, querySql, snapshotData }, ...s.tableViews.slice(0, 19)],
      })),
    removeTableView: (id: string) => set((s) => ({ tableViews: s.tableViews.filter((v) => v.id !== id) })),
    applyTableView: (id: string) =>
      set((s) => {
        const v = s.tableViews.find((x) => x.id === id);
        if (!v) return s;
        const updateData: Partial<LoomState> = {
          tablePrefs: { visibleColumns: v.visibleColumns, columnOrder: v.columnOrder },
          tableColumnFilters: v.columnFilters,
          viewMode: "explorer" as ViewMode,
          dashboardsExpanded: false,
        };
        if (v.snapshotData) {
          updateData.sampleRows = v.snapshotData;
          updateData.columnStats = v.snapshotData.columns.map((c, i) => ({ name: c, data_type: v.snapshotData?.types[i] || "VARCHAR", null_count: 0, distinct_count: 0, min_value: null, max_value: null }));
        }
        if (v.querySql) updateData.querySql = v.querySql;
        return updateData;
      }),
  };
}
