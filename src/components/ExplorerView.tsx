// =================================================================
// ExplorerView — Data Table + Overview
// =================================================================
// The default view when a file is selected. Shows a full-width
// data table with sortable columns and row-level detail.
// =================================================================

"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLoomStore } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { isDateColumn, formatDateCell } from "@/lib/dateFormat";
import { TableSkeleton } from "@/components/Skeleton";

const ROW_HEIGHT = 28;
const VIRTUALIZE_THRESHOLD = 30;

type SortDir = "asc" | "desc" | null;
type SparklineViz = "line" | "histogram";

const NUMERIC_TYPES = new Set(["INTEGER", "BIGINT", "DOUBLE", "FLOAT", "REAL", "DECIMAL", "TINYINT", "SMALLINT"]);

function isNumericCol(
  colIndex: number,
  columns: string[],
  types: string[] | undefined,
  columnStats: { name: string; data_type: string }[]
): boolean {
  const t = types?.[colIndex]?.toUpperCase() ?? "";
  if (NUMERIC_TYPES.has(t) || /INT|FLOAT|DOUBLE|DECIMAL|REAL/.test(t)) return true;
  const colName = columns[colIndex];
  const stat = columnStats.find((c) => c.name === colName);
  return stat ? NUMERIC_TYPES.has(stat.data_type.toUpperCase()) || /int|float|double|decimal|real/i.test(stat.data_type) : false;
}

function Sparkline({
  values,
  width = 56,
  height = 20,
  strokeColor = "var(--loom-accent)",
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline fill="none" stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

/** Mini bar histogram for a numeric column (same width/height as sparkline). */
function MiniHistogram({
  values,
  width = 56,
  height = 20,
  bins = 12,
  fill = "var(--loom-accent)",
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  bins?: number;
  fill?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor(((v - min) / range) * bins));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts, 1);
  const barW = (width - 1) / bins - 0.5;
  const bars = counts.map((c, i) => (
    <rect
      key={i}
      x={1 + i * ((width - 1) / bins)}
      y={height - 1 - (c / maxCount) * (height - 2)}
      width={barW}
      height={(c / maxCount) * (height - 2)}
      fill={fill}
      opacity={0.8}
    />
  ));
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      {bars}
    </svg>
  );
}

/** Trend: +1 = up, -1 = down, 0 = flat (compare first-half vs second-half mean). */
function trendDirection(values: number[]): 1 | -1 | 0 {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const m1 = first.reduce((a, b) => a + b, 0) / first.length;
  const m2 = second.reduce((a, b) => a + b, 0) / second.length;
  if (m2 > m1) return 1;
  if (m2 < m1) return -1;
  return 0;
}

function useNumericColumnData(
  rows: (string | number | boolean | null)[][] | undefined,
  columns: string[] | undefined,
  columnStats: { name: string; data_type: string }[]
) {
  return useMemo(() => {
    if (!rows?.length || !columns?.length) return null;
    const byCol: Record<number, { min: number; max: number; values: number[] }> = {};
    columns.forEach((_, ci) => {
      const values: number[] = [];
      for (const row of rows) {
        const v = Number(row[ci]);
        if (!Number.isNaN(v)) values.push(v);
      }
      if (values.length === 0) return;
      byCol[ci] = {
        min: Math.min(...values),
        max: Math.max(...values),
        values,
      };
    });
    return byCol;
  }, [rows, columns]);
}

const DEFAULT_TABLE_ENHANCE = {
  showSparklines: true,
  showValueBars: true,
  showHeat: true,
  showTrendCue: true,
  showNullRate: true,
  sparklineViz: "line" as SparklineViz,
};

export function ExplorerView() {
  const { selectedFile, sampleRows, columnStats, tablePrefs, setTablePrefs, setViewMode, setPanelTab, panelOpen, togglePanel, smartResults, tableFilterRowIndices, setTableFilterRowIndices, tableColumnFilters, setTableColumnFilter, selectedRowIndices, setSelectedRowIndices, tableViews, addTableView, removeTableView, applyTableView, tableUndoStack, tableRedoStack, pushTableUndo, undoTable, redoTable, hoveredRowIndex, setHoveredRowIndex, setToast, setPromptDialog, querySql } = useLoomStore();
  const [profilingCol, setProfilingCol] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selectedRowIndices), [selectedRowIndices]);
  const allColumns = sampleRows?.columns ?? [];
  const types = sampleRows?.types;
  const rawRows = sampleRows?.rows ?? [];
  const totalRowCount = selectedFile?.row_count ?? 0;

  const columns = useMemo(() => {
    let list = allColumns;
    if (tablePrefs.visibleColumns != null && tablePrefs.visibleColumns.length > 0) {
      const set = new Set(tablePrefs.visibleColumns);
      list = allColumns.filter((c) => set.has(c));
    }
    if (tablePrefs.columnOrder != null && tablePrefs.columnOrder.length === list.length) {
      const order = new Map(tablePrefs.columnOrder.map((c, i) => [c, i]));
      list = [...list].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
    }
    return list;
  }, [allColumns, tablePrefs.visibleColumns, tablePrefs.columnOrder]);

  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [tableEnhance, setTableEnhance] = useState(DEFAULT_TABLE_ENHANCE);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const [filterInputValues, setFilterInputValues] = useState<Record<string, string>>({});
  const filterDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setFilterInputValues(tableColumnFilters ?? {});
  }, [selectedFile?.path]);

  const setFilterInputAndDebounce = useCallback((col: string, value: string) => {
    setFilterInputValues((prev) => ({ ...prev, [col]: value }));
    if (filterDebounceRef.current[col]) clearTimeout(filterDebounceRef.current[col]);
    filterDebounceRef.current[col] = setTimeout(() => {
      setTableColumnFilter(col, value);
      delete filterDebounceRef.current[col];
    }, 300);
  }, [setTableColumnFilter]);

  const toggleEnhance = useCallback((key: keyof typeof tableEnhance, value?: boolean | SparklineViz) => {
    setTableEnhance((prev) => {
      if (key === "sparklineViz" && (value === "line" || value === "histogram")) return { ...prev, sparklineViz: value };
      if (typeof value === "boolean") return { ...prev, [key]: value };
      return { ...prev, [key]: !(prev as Record<string, unknown>)[key] };
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!columnsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColumnsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [columnsOpen]);

  const { sortedRows, sortedOriginalIndices } = useMemo(() => {
    if (sortCol === null || sortCol < 0 || sortCol >= columns.length) {
      return { sortedRows: rawRows, sortedOriginalIndices: rawRows.map((_, i) => i) };
    }
    const colName = columns[sortCol];
    const rawColIdx = allColumns.indexOf(colName);
    if (rawColIdx < 0) return { sortedRows: rawRows, sortedOriginalIndices: rawRows.map((_, i) => i) };
    const dir = sortDir === "asc" ? 1 : -1;
    const indexed = rawRows.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
      const va = a.row[rawColIdx];
      const vb = b.row[rawColIdx];
      const na = typeof va === "number" ? va : Number(va);
      const nb = typeof vb === "number" ? vb : Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
    return {
      sortedRows: indexed.map((x) => x.row),
      sortedOriginalIndices: indexed.map((x) => x.i),
    };
  }, [rawRows, sortCol, sortDir, columns, allColumns]);

  const anomalySet = useMemo(() => {
    const idx = smartResults?.anomaly?.rowIndices;
    if (!idx?.length) return null;
    return new Set(idx);
  }, [smartResults?.anomaly?.rowIndices]);

  const filterSet = useMemo(() => {
    if (!tableFilterRowIndices?.length) return null;
    return new Set(tableFilterRowIndices);
  }, [tableFilterRowIndices]);

  const { displayRows, displayOriginalIndices } = useMemo(() => {
    let rows = sortedRows;
    let indices = sortedOriginalIndices;
    if (filterSet) {
      const r: typeof sortedRows = [];
      const i: number[] = [];
      sortedOriginalIndices.forEach((origIdx, idx) => {
        if (filterSet.has(origIdx)) {
          r.push(sortedRows[idx]);
          i.push(origIdx);
        }
      });
      rows = r;
      indices = i;
    }
    const effectiveFilters = { ...tableColumnFilters, ...filterInputValues };
    const colFilters = Object.keys(effectiveFilters).some((k) => (effectiveFilters[k] ?? "").trim());
    if (!colFilters) return { displayRows: rows, displayOriginalIndices: indices };
    const passed: { row: (string | number | boolean | null)[]; idx: number }[] = [];
    rows.forEach((row, i) => {
      let ok = true;
      for (const col of columns) {
        const filterVal = (effectiveFilters[col] ?? "").trim();
        if (!filterVal) continue;
        const rawIdx = allColumns.indexOf(col);
        if (rawIdx < 0) continue;
        const cell = row[rawIdx];
        const str = String(cell ?? "").toLowerCase();
        const f = filterVal.toLowerCase();
        if (f === "null" || f === "is null") {
          if (cell != null && cell !== "") {
            ok = false;
            break;
          }
          continue;
        }
        const stat = columnStats.find((s) => s.name === col);
        const isNum = stat && (NUMERIC_TYPES.has(stat.data_type.toUpperCase()) || /int|float|double|decimal|real/i.test(stat.data_type));
        if (isNum && f.includes("-")) {
          const [a, b] = f.split("-").map((x) => Number(x.trim()));
          const v = Number(cell);
          if (Number.isNaN(v)) { ok = false; break; }
          if (!Number.isNaN(a) && v < a) { ok = false; break; }
          if (!Number.isNaN(b) && v > b) { ok = false; break; }
          continue;
        }
        if (!str.includes(f)) {
          ok = false;
          break;
        }
      }
      if (ok) passed.push({ row, idx: indices[i] });
    });
    return {
      displayRows: passed.map((p) => p.row),
      displayOriginalIndices: passed.map((p) => p.idx),
    };
  }, [sortedRows, sortedOriginalIndices, filterSet, tableColumnFilters, filterInputValues, columns, allColumns, columnStats]);

  const useVirtual = displayRows.length > VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const copyCell = useCallback((rowIndex: number, colIndex: number) => {
    const row = displayRows[rowIndex];
    if (!row || colIndex < 0 || colIndex >= columns.length) return;
    const colName = columns[colIndex];
    const rawIdx = allColumns.indexOf(colName);
    if (rawIdx < 0) return;
    const val = row[rawIdx];
    const text = val === null || val === undefined ? "" : String(val);
    void navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, [displayRows, columns, allColumns]);

  const copyRow = useCallback((rowIndex: number) => {
    const row = displayRows[rowIndex];
    if (!row) return;
    const text = row.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t");
    void navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, [displayRows]);

  const numericData = useNumericColumnData(displayRows, columns, columnStats);

  const numericColSet = useMemo(() => {
    const set = new Set<number>();
    columns.forEach((_, ci) => {
      if (isNumericCol(ci, columns, types, columnStats)) set.add(ci);
    });
    return set;
  }, [columns, types, columnStats]);

  const handleSort = useCallback((ci: number) => {
    setSortCol((prev) => {
      if (prev === ci) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return ci;
      }
      setSortDir("asc");
      return ci;
    });
  }, []);

  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const handleColumnDragStart = useCallback((e: React.DragEvent, colName: string) => {
    setDraggedCol(colName);
    e.dataTransfer.setData("text/plain", colName);
    e.dataTransfer.effectAllowed = "move";
  }, []);
  const handleColumnDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const handleColumnDrop = useCallback((e: React.DragEvent, targetColName: string) => {
    e.preventDefault();
    setDraggedCol(null);
    const fromCol = e.dataTransfer.getData("text/plain");
    if (!fromCol || fromCol === targetColName) return;
    pushTableUndo();
    const order = columns.slice();
    const fromIdx = order.indexOf(fromCol);
    const toIdx = order.indexOf(targetColName);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromCol);
    setTablePrefs({ ...tablePrefs, columnOrder: order });
  }, [columns, tablePrefs, setTablePrefs, pushTableUndo]);
  const handleColumnDragEnd = useCallback(() => setDraggedCol(null), []);

  const toggleRowSelectionByOriginal = useCallback((originalIdx: number) => {
    setSelectedRowIndices((prev) => {
      const set = new Set(prev);
      if (set.has(originalIdx)) set.delete(originalIdx);
      else set.add(originalIdx);
      return Array.from(set);
    });
  }, [setSelectedRowIndices]);
  const selectAllDisplayRows = useCallback(() => {
    setSelectedRowIndices(displayOriginalIndices);
  }, [displayOriginalIndices, setSelectedRowIndices]);
  const clearRowSelection = useCallback(() => {
    setSelectedRowIndices([]);
  }, [setSelectedRowIndices]);

  const nullPct = useCallback(
    (colName: string) => {
      const stat = columnStats.find((c) => c.name === colName);
      if (!stat || totalRowCount <= 0) return null;
      const pct = (stat.null_count / totalRowCount) * 100;
      return pct > 0 ? pct : null;
    },
    [columnStats, totalRowCount]
  );

  const renderCell = useCallback(
    (row: (string | number | boolean | null)[], ri: number, ci: number, col: string, _originalIdx: number) => {
      const rawIdx = allColumns.indexOf(col);
      const cell = rawIdx >= 0 ? row[rawIdx] : null;
      const stat = columnStats.find((s) => s.name === col);
      const isDateCol = stat ? isDateColumn(stat.data_type) : false;
      const isNum = numericColSet.has(ci);
      const colData = numericData?.[ci];
      const numVal = typeof cell === "number" ? cell : Number(cell);
      const isNumCell = !(cell === null || cell === "") && !Number.isNaN(numVal);
      const pct = isNumCell && colData && colData.max > colData.min ? (numVal - colData.min) / (colData.max - colData.min) : 0;
      const heatOpacity = tableEnhance.showHeat && isNumCell && colData ? pct * 0.12 : 0;
      const showBar = tableEnhance.showValueBars && isNum;
      const heatStyle =
        heatOpacity > 0 && typeof document !== "undefined"
          ? { background: `color-mix(in srgb, var(--loom-accent) ${Math.round(heatOpacity * 100)}%, transparent)` }
          : undefined;
      const displayStr = isDateCol ? formatDateCell(cell) : String(cell ?? "");
      return (
        <td
          key={col}
          className="px-2 py-1 text-loom-text whitespace-nowrap max-w-[200px] truncate align-middle"
          style={heatStyle}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri, colIndex: ci });
          }}
        >
          {cell === null || cell === "" ? (
            <span className="text-loom-muted/60 italic">null</span>
          ) : typeof cell === "number" ? (
            <span className="flex items-center gap-2">
              {showBar && (
                <span className="inline-block w-10 h-1.5 rounded-full bg-loom-border overflow-hidden shrink-0" aria-hidden>
                  <span className="block h-full rounded-full bg-loom-accent/80" style={{ width: `${Math.min(100, pct * 100)}%` }} />
                </span>
              )}
              <span className="text-loom-accent">{cell.toLocaleString()}</span>
            </span>
          ) : isNumCell && isNum ? (
            <span className="flex items-center gap-2">
              {showBar && (
                <span className="inline-block w-10 h-1.5 rounded-full bg-loom-border overflow-hidden shrink-0" aria-hidden>
                  <span className="block h-full rounded-full bg-loom-accent/80" style={{ width: `${Math.min(100, pct * 100)}%` }} />
                </span>
              )}
              <span className="text-loom-accent">{numVal.toLocaleString()}</span>
            </span>
          ) : (
            <span className="truncate block max-w-[180px]" title={displayStr}>{displayStr}</span>
          )}
        </td>
      );
    },
    [allColumns, numericColSet, numericData, tableEnhance, setContextMenu, columnStats]
  );

  if (!selectedFile) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden animate-fade-in">
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[120px] py-1 bg-loom-surface border border-loom-border rounded shadow-lg text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Table cell actions"
        >
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-1.5 text-left text-loom-text hover:bg-loom-elevated"
            onClick={() => copyCell(contextMenu.rowIndex, contextMenu.colIndex)}
          >
            Copy cell
          </button>
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-1.5 text-left text-loom-text hover:bg-loom-elevated"
            onClick={() => copyRow(contextMenu.rowIndex)}
          >
            Copy row
          </button>
        </div>
      )}
      {/* Compact File Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-loom-border bg-loom-surface/50 text-2xs min-h-0 min-w-0 shrink-0">
        <h2 className="text-xs font-semibold text-loom-text truncate max-w-[140px]">{selectedFile.name}</h2>
        <span className="text-loom-muted font-mono shrink-0">{formatNumber(selectedFile.row_count)}r &middot; {columnStats.length}c</span>
        <div className="flex-1 min-w-0" />
        {selectedRowIndices.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-loom-muted">{selectedRowIndices.length} sel</span>
            <button type="button" onClick={clearRowSelection} className="loom-btn-ghost py-0 px-1">Clear</button>
            <button
              type="button"
              onClick={() => {
                const rows = selectedRowIndices
                  .map((i) => sampleRows?.rows[i])
                  .filter(Boolean) as (string | number | boolean | null)[][];
                if (rows.length && sampleRows) {
                  const csv = queryResultToCsv({ columns: sampleRows.columns, rows, types: sampleRows.types ?? [], total_rows: rows.length });
                  downloadCsv(csv, `${selectedFile?.name?.replace(/\.[^.]+$/, "") ?? "data"}-selected`);
                }
              }}
              className="loom-btn-primary py-0 px-1.5"
            >
              CSV
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => { setViewMode("chart"); if (!panelOpen) togglePanel(); setPanelTab("chart"); }}
          className="loom-btn-primary py-0.5 px-2 shrink-0"
        >
          Chart
        </button>
      </div>

      {/* Compact toolbar row */}
      {tableFilterRowIndices != null && tableFilterRowIndices.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-amber-500/30 bg-amber-500/5 text-2xs">
          <span className="text-loom-muted">Filtered: {tableFilterRowIndices.length} rows</span>
          <button type="button" onClick={() => setTableFilterRowIndices(null)} className="loom-btn-ghost text-2xs py-0 px-1">Clear</button>
        </div>
      )}
      {sampleRows && sampleRows.rows.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-loom-border/50 bg-loom-surface/30 text-2xs overflow-x-auto whitespace-nowrap min-h-0 shrink-0">
          {[
            { key: "showSparklines" as const, label: "Spark" },
            { key: "showValueBars" as const, label: "Bars" },
            { key: "showHeat" as const, label: "Heat" },
            { key: "showTrendCue" as const, label: "Trend" },
            { key: "showNullRate" as const, label: "Null%" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleEnhance(key)}
              className={`px-1.5 py-0.5 rounded text-2xs ${tableEnhance[key] ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
            >
              {label}
            </button>
          ))}
          <span className="text-loom-muted">|</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnsOpen((o) => !o)}
              aria-expanded={columnsOpen}
              aria-haspopup="dialog"
              aria-label="Choose which columns to show"
              className={`px-2 py-0.5 rounded border text-loom-text ${columnsOpen ? "border-loom-accent bg-loom-accent/20" : "border-loom-border hover:border-loom-muted"}`}
            >
              Columns
            </button>
            {columnsOpen && (
              <>
                <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] max-h-64 overflow-y-auto py-2 bg-loom-surface border border-loom-border rounded shadow-lg">
                  <div className="px-2 pb-1 border-b border-loom-border/50 text-2xs font-semibold text-loom-muted">Show columns</div>
                  {allColumns.map((col) => {
                    const visible = tablePrefs.visibleColumns == null || tablePrefs.visibleColumns.includes(col);
                    return (
                      <label key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-loom-elevated/60 cursor-pointer text-xs text-loom-text">
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => {
                            const next = tablePrefs.visibleColumns ?? allColumns;
                            const set = new Set(next);
                            if (visible) set.delete(col);
                            else set.add(col);
                            const list = allColumns.filter((c) => set.has(c));
                            setTablePrefs({ ...tablePrefs, visibleColumns: list.length === allColumns.length ? null : list });
                          }}
                          className="rounded border-loom-border accent-loom-accent"
                        />
                        <span className="truncate">{col}</span>
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setTablePrefs({ visibleColumns: null, columnOrder: null })}
                    className="w-full mt-2 mx-2 px-2 py-1 text-2xs text-loom-muted hover:text-loom-text border border-loom-border rounded"
                  >
                    Reset to all
                  </button>
                </div>
                <div className="fixed inset-0 z-40" aria-hidden onClick={() => setColumnsOpen(false)} />
              </>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setViewsOpen((o) => !o)}
              aria-expanded={viewsOpen}
              className={`px-2 py-0.5 rounded border text-loom-text ${viewsOpen ? "border-loom-accent bg-loom-accent/20" : "border-loom-border hover:border-loom-muted"}`}
            >
              Views
            </button>
            {viewsOpen && (
              <>
                <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] py-2 bg-loom-surface border border-loom-border rounded shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setPromptDialog({
                        title: "View name",
                        defaultValue: "Table view",
                        onConfirm: (name) => {
                          if (name != null && name.trim()) {
                            addTableView(name.trim(), tablePrefs.visibleColumns, tablePrefs.columnOrder, { ...tableColumnFilters, ...filterInputValues }, querySql, sampleRows ?? undefined);
                            setToast("Table view saved");
                            setViewsOpen(false);
                          }
                        }
                      });
                    }}
                    className="w-full px-2 py-1 text-left text-2xs text-loom-text hover:bg-loom-elevated"
                  >
                    Save current view
                  </button>
                  {tableViews.map((v) => (
                    <div key={v.id} className="flex items-center gap-1 px-2 py-0.5 group">
                      <button type="button" onClick={() => { pushTableUndo(); applyTableView(v.id); setFilterInputValues(v.columnFilters ?? {}); setViewsOpen(false); }} className="flex-1 text-left text-2xs text-loom-text hover:bg-loom-elevated truncate">
                        {v.name}
                      </button>
                      <button type="button" onClick={() => removeTableView(v.id)} className="opacity-0 group-hover:opacity-100 text-loom-muted hover:text-loom-text text-2xs" aria-label={`Remove ${v.name}`}>×</button>
                    </div>
                  ))}
                  {tableViews.length === 0 && <p className="px-2 py-1 text-2xs text-loom-muted">No saved views</p>}
                </div>
                <div className="fixed inset-0 z-40" aria-hidden onClick={() => setViewsOpen(false)} />
              </>
            )}
          </div>
          <span className="text-loom-border/50">|</span>
          <button type="button" onClick={undoTable} disabled={tableUndoStack.length === 0} className="px-1 py-0 rounded text-loom-muted hover:text-loom-text disabled:opacity-30" title="Undo">↶</button>
          <button type="button" onClick={redoTable} disabled={tableRedoStack.length === 0} className="px-1 py-0 rounded text-loom-muted hover:text-loom-text disabled:opacity-30" title="Redo">↷</button>
          <span className="text-loom-border/50">|</span>
          <button type="button" onClick={() => toggleEnhance("sparklineViz", "line")} className={`px-1.5 py-0.5 rounded text-2xs ${tableEnhance.sparklineViz === "line" ? "bg-loom-accent/20 text-loom-text" : "text-loom-muted"}`}>Line</button>
          <button type="button" onClick={() => toggleEnhance("sparklineViz", "histogram")} className={`px-1.5 py-0.5 rounded text-2xs ${tableEnhance.sparklineViz === "histogram" ? "bg-loom-accent/20 text-loom-text" : "text-loom-muted"}`}>Hist</button>
        </div>
      )}

      {/* Column profiling card */}
      {profilingCol && (() => {
        const stat = columnStats.find((s) => s.name === profilingCol);
        const rawIdx = allColumns.indexOf(profilingCol);
        const vals = rawIdx >= 0 ? rawRows.map((r) => r[rawIdx]) : [];
        const numericVals = vals.map(Number).filter((v) => !isNaN(v));
        const sorted = [...numericVals].sort((a, b) => a - b);
        const isNum = numericVals.length > vals.length * 0.5;
        const nullCount = vals.filter((v) => v == null || v === "").length;
        const unique = new Set(vals.map(String)).size;
        const topVals = isNum ? null : (() => {
          const freq: Record<string, number> = {};
          for (const v of vals) freq[String(v ?? "null")] = (freq[String(v ?? "null")] ?? 0) + 1;
          return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
        })();
        return (
          <div className="px-3 py-2 border-b border-loom-border bg-loom-surface/80 text-2xs space-y-1 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-loom-text">{profilingCol} <span className="font-normal text-loom-muted">{stat?.data_type ?? ""}</span></span>
              <button type="button" onClick={() => setProfilingCol(null)} className="text-loom-muted hover:text-loom-text">×</button>
            </div>
            <div className="flex gap-4 text-loom-muted">
              <span>Null: {nullCount} ({vals.length > 0 ? ((nullCount / vals.length) * 100).toFixed(1) : 0}%)</span>
              <span>Unique: {unique}</span>
              {stat?.min_value != null && <span>Min: {stat.min_value}</span>}
              {stat?.max_value != null && <span>Max: {stat.max_value}</span>}
              {isNum && sorted.length > 0 && <span>Median: {sorted[Math.floor(sorted.length / 2)].toLocaleString()}</span>}
            </div>
            {isNum && sorted.length > 2 && (
              <div className="flex items-end gap-px h-6 mt-1">
                {(() => {
                  const buckets = 20;
                  const min = sorted[0], max = sorted[sorted.length - 1];
                  const range = max - min || 1;
                  const counts = new Array(buckets).fill(0);
                  for (const v of sorted) counts[Math.min(buckets - 1, Math.floor(((v - min) / range) * buckets))]++;
                  const maxC = Math.max(...counts, 1);
                  return counts.map((c, i) => (
                    <div key={i} className="flex-1 bg-loom-accent/60 rounded-t-sm" style={{ height: `${(c / maxC) * 100}%` }} />
                  ));
                })()}
              </div>
            )}
            {topVals && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {topVals.map(([v, c]) => <span key={v} className="text-loom-text">{v} <span className="text-loom-muted">({c})</span></span>)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Data Grid — keyboard: ↑/↓ move focus, Space toggle selection */}
      <div
        ref={tableScrollRef}
        className="flex-1 overflow-auto min-w-0 min-h-0"
        tabIndex={0}
        role="grid"
        aria-rowcount={displayRows.length}
        aria-label="Data table"
        onKeyDown={(e) => {
          if (displayRows.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedRowIndex((i) => (i == null ? 0 : Math.min(displayRows.length - 1, (i ?? 0) + 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedRowIndex((i) => (i == null ? displayRows.length - 1 : Math.max(0, (i ?? 0) - 1)));
          } else if (e.key === " " && focusedRowIndex != null) {
            e.preventDefault();
            const orig = displayOriginalIndices[focusedRowIndex];
            if (orig != null) toggleRowSelectionByOriginal(orig);
          }
        }}
      >
        {sampleRows && sampleRows.rows.length > 0 ? (
          <table className="text-xs font-mono border-collapse" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                <th className="px-1 py-1 text-left text-2xs font-semibold text-loom-muted whitespace-nowrap sticky top-0 left-0 z-20 bg-loom-bg border-b border-loom-border border-r border-loom-border/50 w-8">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={displayRows.length > 0 && displayOriginalIndices.every((idx) => selectedSet.has(idx))}
                      onChange={() => (displayOriginalIndices.every((idx) => selectedSet.has(idx)) ? clearRowSelection() : selectAllDisplayRows())}
                      className="rounded border-loom-border accent-loom-accent"
                      aria-label="Select all rows"
                      ref={(el) => {
                        if (!el) return;
                        const some = displayOriginalIndices.some((idx) => selectedSet.has(idx));
                        const all = displayRows.length > 0 && displayOriginalIndices.every((idx) => selectedSet.has(idx));
                        el.indeterminate = some && !all;
                      }}
                    />
                  </label>
                </th>
                <th className="px-2 py-1 text-left text-2xs font-semibold text-loom-muted whitespace-nowrap sticky top-0 left-8 z-20 bg-loom-bg border-b border-loom-border border-r border-loom-border/50 w-10">
                  #
                </th>
                {columns.map((col, ci) => {
                  const isNum = numericColSet.has(ci);
                  const colData = numericData?.[ci];
                  const isSorted = sortCol === ci;
                  const nullP = tableEnhance.showNullRate ? nullPct(col) : null;
                  const trend = isNum && colData && tableEnhance.showTrendCue ? trendDirection(colData.values) : null;
                  return (
                    <th
                      key={col}
                      draggable
                      onDragStart={(e) => handleColumnDragStart(e, col)}
                      onDragOver={handleColumnDragOver}
                      onDrop={(e) => handleColumnDrop(e, col)}
                      onDragEnd={handleColumnDragEnd}
                      className={`px-2 py-1 text-left text-2xs font-semibold text-loom-muted whitespace-nowrap sticky top-0 bg-loom-bg border-b border-loom-border cursor-pointer hover:bg-loom-elevated/60 select-none ${draggedCol === col ? "opacity-50" : ""}`}
                      onClick={() => handleSort(ci)}
                      onContextMenu={(e) => { e.preventDefault(); setProfilingCol(profilingCol === col ? null : col); }}
                      title="Click to sort, right-click to profile, drag to reorder"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1">
                          {col}
                          {isSorted && (
                            <span className="text-loom-accent font-normal" aria-hidden>
                              {sortDir === "asc" ? "↑" : "↓"}
                            </span>
                          )}
                          {trend === 1 && <span className="text-green-500/90 font-normal" aria-label="trend up">↑</span>}
                          {trend === -1 && <span className="text-amber-500/90 font-normal" aria-label="trend down">↓</span>}
                          {nullP != null && (
                            <span className="text-loom-muted/80 font-normal normal-case" title={`${nullP.toFixed(1)}% null`}>
                              {nullP >= 1 ? `${nullP.toFixed(0)}%∅` : "<1%∅"}
                            </span>
                          )}
                        </span>
                        {isNum && colData && tableEnhance.showSparklines && (
                          <>
                            {colData.values.length >= 2 && tableEnhance.sparklineViz === "line" && (
                              <Sparkline values={colData.values} className="opacity-70" />
                            )}
                            {colData.values.length >= 2 && tableEnhance.sparklineViz === "histogram" && (
                              <MiniHistogram values={colData.values} className="opacity-80" />
                            )}
                            <span className="text-[10px] text-loom-muted/80 font-normal normal-case">
                              {colData.min === colData.max
                                ? colData.min.toLocaleString()
                                : `${colData.min.toLocaleString()} – ${colData.max.toLocaleString()}`}
                            </span>
                          </>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
              <tr className="bg-loom-surface/50">
                <th className="px-2 py-1 border-b border-loom-border border-r border-loom-border/50 sticky left-0 z-20 bg-loom-surface w-8" style={{ top: 40 }} />
                <th className="px-2 py-1 border-b border-loom-border border-r border-loom-border/50 sticky left-8 z-20 bg-loom-surface w-10" style={{ top: 40 }} />
                {columns.map((col) => (
                  <th key={col} className="px-1 py-0.5 border-b border-loom-border">
                    <input
                      type="text"
                      value={filterInputValues[col] ?? ""}
                      onChange={(e) => setFilterInputAndDebounce(col, e.target.value)}
                      placeholder="Filter..."
                      className="loom-input w-full text-2xs py-0.5 px-1 min-w-0"
                      aria-label={`Filter ${col}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {useVirtual
                ? (() => {
                  const items = rowVirtualizer.getVirtualItems();
                  const paddingTop = items.length > 0 ? items[0].start : 0;
                  const paddingBottom = items.length > 0 ? rowVirtualizer.getTotalSize() - items[items.length - 1].end : 0;
                  return (
                    <>
                      {paddingTop > 0 && <tr><td style={{ height: paddingTop, padding: 0 }} colSpan={columns.length + 2} /></tr>}
                      {items.map((virtualRow) => {
                        const ri = virtualRow.index;
                        const row = displayRows[ri];
                        const originalIdx = displayOriginalIndices[ri];
                        const isAnomaly = anomalySet?.has(originalIdx);
                        return (
                          <tr
                            key={virtualRow.key}
                            className={`border-b border-loom-border/30 hover:bg-loom-elevated/40 ${isAnomaly ? "bg-amber-500/10 border-l-2 border-l-amber-500" : ""} ${focusedRowIndex === ri ? "ring-1 ring-inset ring-loom-accent bg-loom-elevated/50" : ""} ${hoveredRowIndex === originalIdx ? "bg-loom-accent/10" : ""}`}
                            title={isAnomaly ? "Marked as anomaly (Smart tab)" : undefined}
                            aria-rowindex={ri + 1}
                            onMouseEnter={() => setHoveredRowIndex(originalIdx)}
                            onMouseLeave={() => setHoveredRowIndex(null)}
                            style={{ height: ROW_HEIGHT }}
                          >
                            <td className="px-1 py-1 w-8 sticky left-0 z-10 bg-inherit border-r border-loom-border/30">
                              <input
                                type="checkbox"
                                checked={selectedSet.has(originalIdx)}
                                onChange={() => toggleRowSelectionByOriginal(originalIdx)}
                                className="rounded border-loom-border accent-loom-accent"
                                aria-label={`Select row ${ri + 1}`}
                              />
                            </td>
                            <td className="px-2 py-1 text-loom-muted w-10 sticky left-8 z-10 bg-inherit border-r border-loom-border/30">{ri + 1}</td>
                            {columns.map((col, ci) => renderCell(row, ri, ci, col, originalIdx))}
                          </tr>
                        );
                      })}
                      {paddingBottom > 0 && <tr><td style={{ height: paddingBottom, padding: 0 }} colSpan={columns.length + 2} /></tr>}
                    </>
                  );
                })()
                : displayRows.map((row, ri) => {
                  const originalIdx = displayOriginalIndices[ri];
                  const isAnomaly = anomalySet?.has(originalIdx);
                  return (
                    <tr
                      key={ri}
                      className={`border-b border-loom-border/30 hover:bg-loom-elevated/40 transition-colors ${isAnomaly ? "bg-amber-500/10 border-l-2 border-l-amber-500" : ""} ${focusedRowIndex === ri ? "ring-1 ring-inset ring-loom-accent bg-loom-elevated/50" : ""} ${hoveredRowIndex === originalIdx ? "bg-loom-accent/10" : ""}`}
                      title={isAnomaly ? "Marked as anomaly (Smart tab)" : undefined}
                      aria-rowindex={ri + 1}
                      onMouseEnter={() => setHoveredRowIndex(originalIdx)}
                      onMouseLeave={() => setHoveredRowIndex(null)}
                    >
                      <td className="px-1 py-1 sticky left-0 z-10 bg-inherit border-r border-loom-border/30">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(originalIdx)}
                          onChange={() => toggleRowSelectionByOriginal(originalIdx)}
                          className="rounded border-loom-border accent-loom-accent"
                          aria-label={`Select row ${ri + 1}`}
                        />
                      </td>
                      <td className="px-2 py-1 text-loom-muted sticky left-8 z-10 bg-inherit border-r border-loom-border/30">{ri + 1}</td>
                      {columns.map((col, ci) => renderCell(row, ri, ci, col, originalIdx))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ) : selectedFile && !sampleRows ? (
          <div className="p-4 h-full overflow-auto">
            <TableSkeleton rows={12} cols={Math.min(columnStats.length || 5, 8)} />
          </div>
        ) : sampleRows && sampleRows.rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-loom-muted">
            No rows
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-loom-muted">
            Loading data...
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
      <div className="w-16 h-16 rounded-xl bg-loom-elevated border border-loom-border flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-loom-muted">
          <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-loom-text">Mount a data folder</p>
        <p className="text-xs text-loom-muted mt-1">
          Select a folder containing .csv or .parquet files to begin exploring
        </p>
      </div>
    </div>
  );
}
