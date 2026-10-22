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
import {
  applyVisibleColumnOrder,
  cellMatchesExplorerNumericFilter,
  formatExplorerColumnNumber,
  numericMinMaxForColumn,
  parseExplorerNumericFilter,
  remapSelectedRowIndices,
} from "@/lib/tableExplorer";
import { compareExplorerCells } from "@/lib/tableSort";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { isDateColumn, formatDateCell } from "@/lib/dateFormat";
import { TableSkeleton } from "@/components/Skeleton";
import { StartHere } from "@/components/StartHere";
import { useIsMobile } from "@/lib/useMediaQuery";
import { Dialog } from "@/components/ui/Dialog";
import { encodingChannelLabels } from "@/lib/chartSupport";
import { ViewCohortBar } from "@/components/ViewCohortBar";
import { applyChartTimeWindow } from "@/lib/chartTime";

function colWidthStorageKey(filePath: string): string {
  return `loom-col-widths:${filePath}`;
}

const ROW_HEIGHT = 28;
const VIRTUALIZE_THRESHOLD = 30;

type SortDir = "asc" | "desc" | null;
type SparklineViz = "line" | "histogram";

const NUMERIC_TYPES = new Set(["INTEGER", "BIGINT", "DOUBLE", "FLOAT", "REAL", "DECIMAL", "TINYINT", "SMALLINT"]);

function isNumericCol(
  colName: string,
  allColumns: string[],
  types: string[] | undefined,
  columnStats: { name: string; data_type: string }[]
): boolean {
  const rawIdx = allColumns.indexOf(colName);
  const t = rawIdx >= 0 ? types?.[rawIdx]?.toUpperCase() ?? "" : "";
  if (NUMERIC_TYPES.has(t) || /INT|FLOAT|DOUBLE|DECIMAL|REAL/.test(t)) return true;
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
  displayColumns: string[] | undefined,
  allColumns: string[],
) {
  return useMemo(() => {
    if (!rows?.length || !displayColumns?.length) return null;
    const byCol: Record<number, { min: number; max: number; values: number[] }> = {};
    displayColumns.forEach((colName, ci) => {
      const stats = numericMinMaxForColumn(rows, colName, allColumns);
      if (stats) byCol[ci] = stats;
    });
    return byCol;
  }, [rows, displayColumns, allColumns]);
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
  const { selectedFile, sampleRows, columnStats, tablePrefs, setTablePrefs, setViewMode, setPanelTab, panelOpen, togglePanel, smartResults, tableFilterRowIndices, setTableFilterRowIndices, tableColumnFilters, setTableColumnFilter, setTableColumnFilters, tableSortColumn, tableSortDir, setTableSort, selectedRowIndices, setSelectedRowIndices, tableViews, addTableView, removeTableView, applyTableView, tableUndoStack, tableRedoStack, pushTableUndo, undoTable, redoTable, hoveredRowIndex, setHoveredRowIndex, setToast, setPromptDialog, querySql, activeChart, viewTimeField, viewTimeWindow, setStatsFocusColumn, setPanelOpen } = useLoomStore();
  const isMobile = useIsMobile();

  /** Same accent-as-signal as PreviewFooter: which columns are on the active chart. */
  const chartRoleByCol = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeChart) return map;
    const labels = encodingChannelLabels(activeChart.kind);
    if (activeChart.xField) map.set(activeChart.xField, labels.x);
    if (activeChart.yField) map.set(activeChart.yField, labels.y);
    if (activeChart.colorField) map.set(activeChart.colorField, labels.color);
    if (activeChart.sizeField) map.set(activeChart.sizeField, labels.size);
    if (activeChart.shapeField) map.set(activeChart.shapeField, "Shape");
    if (activeChart.emojiField) map.set(activeChart.emojiField, "Emoji");
    return map;
  }, [activeChart]);
  const [displayOpen, setDisplayOpen] = useState(false);
  /** Column filter row is opt-in on phones so the grid gets more vertical room. */
  const [showColumnFilters, setShowColumnFilters] = useState(false);
  const [profilingCol, setProfilingCol] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [cellDetail, setCellDetail] = useState<{ column: string; value: string } | null>(null);
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    if (!selectedFile?.path) {
      setColumnWidths({});
      return;
    }
    try {
      const raw = localStorage.getItem(colWidthStorageKey(selectedFile.path));
      setColumnWidths(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch {
      setColumnWidths({});
    }
  }, [selectedFile?.path]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r || !selectedFile?.path) return;
      const w = Math.max(80, Math.min(520, r.startW + (e.clientX - r.startX)));
      setColumnWidths((prev) => {
        const next = { ...prev, [r.col]: w };
        try {
          localStorage.setItem(colWidthStorageKey(selectedFile.path), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [selectedFile?.path]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const selectedSet = useMemo(() => new Set(selectedRowIndices), [selectedRowIndices]);
  const prevSampleRef = useRef<typeof sampleRows>(null);
  useEffect(() => {
    const prev = prevSampleRef.current;
    prevSampleRef.current = sampleRows;
    if (!prev?.rows || !sampleRows?.rows || prev.rows === sampleRows.rows) return;
    if (selectedRowIndices.length === 0) return;
    const remapped = remapSelectedRowIndices(
      prev.columns,
      prev.rows,
      selectedRowIndices,
      sampleRows.columns,
      sampleRows.rows,
    );
    if (remapped.join(",") !== selectedRowIndices.join(",")) {
      setSelectedRowIndices(remapped);
    }
  }, [sampleRows, selectedRowIndices, setSelectedRowIndices]);
  const allColumns = sampleRows?.columns ?? [];
  const types = sampleRows?.types;
  const rawRows = sampleRows?.rows ?? [];
  // Prefer live sample total — mount may leave FileEntry.row_count at 0 until patched.
  const totalRowCount = Math.max(
    selectedFile?.row_count ?? 0,
    sampleRows?.total_rows ?? 0,
    rawRows.length,
  );

  const columns = useMemo(
    () => applyVisibleColumnOrder(allColumns, tablePrefs.visibleColumns, tablePrefs.columnOrder),
    [allColumns, tablePrefs.visibleColumns, tablePrefs.columnOrder],
  );

  const sortCol = tableSortColumn ? columns.indexOf(tableSortColumn) : -1;
  const sortDir: SortDir = tableSortDir;
  const [tableEnhance, setTableEnhance] = useState(DEFAULT_TABLE_ENHANCE);
  // On phones, keep header cells lean so columns stay scannable
  const enhance = isMobile
    ? {
      ...tableEnhance,
      showSparklines: false,
      showTrendCue: false,
      showNullRate: false,
      showValueBars: tableEnhance.showValueBars,
      showHeat: tableEnhance.showHeat,
    }
    : tableEnhance;
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
    if (sortDir === null || sortCol < 0 || sortCol >= columns.length) {
      return { sortedRows: rawRows, sortedOriginalIndices: rawRows.map((_, i) => i) };
    }
    const colName = columns[sortCol];
    const rawColIdx = allColumns.indexOf(colName);
    if (rawColIdx < 0) return { sortedRows: rawRows, sortedOriginalIndices: rawRows.map((_, i) => i) };
    const dir = sortDir === "asc" ? 1 : -1;
    const indexed = rawRows.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
      const va = a.row[rawColIdx] as string | number | boolean | null;
      const vb = b.row[rawColIdx] as string | number | boolean | null;
      const cmp = compareExplorerCells(va, vb, dir);
      if (cmp !== 0) return cmp;
      return (a.i - b.i) * dir;
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
    const effectiveFilters = tableColumnFilters ?? {};
    const colFilters = Object.keys(effectiveFilters).some((k) => (effectiveFilters[k] ?? "").trim());
    let displayRows = rows;
    let displayOriginalIndices = indices;
    if (colFilters) {
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
          if (isNum) {
            const parsed = parseExplorerNumericFilter(filterVal);
            if (parsed) {
              if (!cellMatchesExplorerNumericFilter(cell, parsed)) {
                ok = false;
                break;
              }
              continue;
            }
          }
          if (!str.includes(f)) {
            ok = false;
            break;
          }
        }
        if (ok) passed.push({ row, idx: indices[i]! });
      });
      displayRows = passed.map((p) => p.row);
      displayOriginalIndices = passed.map((p) => p.idx);
    }
    if (viewTimeWindow && viewTimeWindow !== "all" && viewTimeField) {
      const timed = applyChartTimeWindow(displayRows, allColumns, {
        timeWindowField: viewTimeField,
        timeWindow: viewTimeWindow,
      });
      if (timed.filtered) {
        displayOriginalIndices = timed.sourceIndices.map((i) => displayOriginalIndices[i]!);
        displayRows = timed.rows;
      }
    }
    return { displayRows, displayOriginalIndices };
  }, [
    sortedRows,
    sortedOriginalIndices,
    filterSet,
    tableColumnFilters,
    columns,
    allColumns,
    columnStats,
    viewTimeField,
    viewTimeWindow,
  ]);

  const useVirtual = displayRows.length > VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    if (focusedRowIndex == null || !tableScrollRef.current) return;
    const row = tableScrollRef.current.querySelector(
      `[data-explorer-focus-row="${focusedRowIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedRowIndex]);

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
    void navigator.clipboard.writeText(text).then(() => setToast("Cell copied"));
    setContextMenu(null);
  }, [displayRows, columns, allColumns, setToast]);

  const copyRow = useCallback((rowIndex: number) => {
    const row = displayRows[rowIndex];
    if (!row) return;
    const text = row.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t");
    void navigator.clipboard.writeText(text).then(() => setToast("Row copied"));
    setContextMenu(null);
  }, [displayRows]);

  const numericData = useNumericColumnData(displayRows, columns, allColumns);

  const numericColSet = useMemo(() => {
    const set = new Set<number>();
    columns.forEach((colName, ci) => {
      if (isNumericCol(colName, allColumns, types, columnStats)) set.add(ci);
    });
    return set;
  }, [columns, allColumns, types, columnStats]);

  const handleSort = useCallback((ci: number) => {
    const colName = columns[ci];
    if (!colName) return;
    if (tableSortColumn === colName) {
      if (tableSortDir === "asc") setTableSort(colName, "desc");
      else if (tableSortDir === "desc") setTableSort(null, null);
      else setTableSort(colName, "asc");
      return;
    }
    setTableSort(colName, "asc");
  }, [columns, tableSortColumn, tableSortDir, setTableSort]);

  const handleSortKey = useCallback(
    (e: React.KeyboardEvent, ci: number) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSort(ci);
      }
    },
    [handleSort],
  );

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
  const moveColumn = useCallback((fromCol: string, toIdx: number) => {
    const fromIdx = columns.indexOf(fromCol);
    if (fromIdx < 0 || toIdx < 0 || toIdx >= columns.length || fromIdx === toIdx) return;
    pushTableUndo();
    const order = columns.slice();
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromCol);
    setTablePrefs({ ...tablePrefs, columnOrder: order });
  }, [columns, tablePrefs, setTablePrefs, pushTableUndo]);
  const handleColumnDrop = useCallback((e: React.DragEvent, targetColName: string) => {
    e.preventDefault();
    setDraggedCol(null);
    const fromCol = e.dataTransfer.getData("text/plain");
    if (!fromCol || fromCol === targetColName) return;
    moveColumn(fromCol, columns.indexOf(targetColName));
  }, [columns, moveColumn]);
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
      const isIntegerCol = stat ? NUMERIC_TYPES.has(stat.data_type.toUpperCase()) && /int/i.test(stat.data_type) : false;
      const colData = numericData?.[ci];
      const numVal = typeof cell === "number" ? cell : Number(cell);
      const isNumCell = !(cell === null || cell === "") && !Number.isNaN(numVal);
      const numDisplay = isNumCell ? formatExplorerColumnNumber(col, numVal, isIntegerCol) : "";
      const pct = isNumCell && colData && colData.max > colData.min ? (numVal - colData.min) / (colData.max - colData.min) : 0;
      const heatOpacity = enhance.showHeat && isNumCell && colData ? pct * 0.12 : 0;
      const showBar = enhance.showValueBars && isNum;
      const heatStyle =
        heatOpacity > 0 && typeof document !== "undefined"
          ? { background: `color-mix(in srgb, var(--loom-accent) ${Math.round(heatOpacity * 100)}%, transparent)` }
          : undefined;
      const displayStr = isDateCol
        ? formatDateCell(cell, stat?.data_type)
        : cell == null || cell === ""
          ? "—"
          : String(cell);
      const colW = columnWidths[col] ?? 200;
      return (
        <td
          key={col}
          role="gridcell"
          tabIndex={0}
          className="px-2 py-1 text-loom-text whitespace-nowrap truncate align-middle"
          style={{ ...heatStyle, maxWidth: colW, minWidth: colW }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri, colIndex: ci });
          }}
          onClick={() => setCellDetail({ column: col, value: displayStr })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCellDetail({ column: col, value: displayStr });
            }
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
              <span className="text-loom-accent">{formatExplorerColumnNumber(col, cell, isIntegerCol)}</span>
            </span>
          ) : isNumCell && isNum ? (
            <span className="flex items-center gap-2">
              {showBar && (
                <span className="inline-block w-10 h-1.5 rounded-full bg-loom-border overflow-hidden shrink-0" aria-hidden>
                  <span className="block h-full rounded-full bg-loom-accent/80" style={{ width: `${Math.min(100, pct * 100)}%` }} />
                </span>
              )}
              <span className="text-loom-accent">{numDisplay}</span>
            </span>
          ) : (
            <span className="truncate block">{displayStr}</span>
          )}
        </td>
      );
    },
    [allColumns, numericColSet, numericData, enhance, setContextMenu, columnStats, columnWidths]
  );

  if (!selectedFile) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden animate-fade-in">
      <Dialog open={!!cellDetail} onClose={() => setCellDetail(null)} ariaLabel="Cell value">
        {cellDetail && (
          <div className="p-4 max-w-lg">
            <h3 className="text-sm font-semibold text-loom-text mb-2">{cellDetail.column}</h3>
            <p className="text-xs text-loom-text whitespace-pre-wrap break-all font-mono max-h-[50vh] overflow-y-auto">
              {cellDetail.value}
            </p>
            <button type="button" className="loom-btn-primary text-xs mt-3" onClick={() => setCellDetail(null)}>
              Close
            </button>
          </div>
        )}
      </Dialog>
      {contextMenu && (
        <div
          className="loom-menu fixed z-50 min-w-[120px] py-1 rounded text-xs"
          style={{
            // Keep the menu on-screen near the right / bottom edges
            left: Math.max(4, Math.min(contextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 136)),
            top: Math.max(4, Math.min(contextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 72)),
          }}
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
          {columns[contextMenu.colIndex] && (
            <button
              type="button"
              role="menuitem"
              className="w-full px-3 py-1.5 text-left text-loom-accent hover:bg-loom-elevated"
              onClick={() => {
                const col = columns[contextMenu.colIndex]!;
                setStatsFocusColumn(col);
                setPanelTab("stats");
                setPanelOpen(true);
                setContextMenu(null);
                setToast(`Explain · ${col}`);
              }}
            >
              Explain column
            </button>
          )}
        </div>
      )}
      <ViewCohortBar surface="explorer" />
      {/* Compact File Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-loom-border bg-loom-surface/50 text-2xs min-h-0 min-w-0 shrink-0">
        <h2 className="text-xs font-semibold text-loom-text truncate max-w-[140px] sm:max-w-[280px]" title={selectedFile.name}>{selectedFile.name}</h2>
        <span
          className="text-loom-muted font-mono shrink-0"
          title={`${selectedFile.row_count.toLocaleString()} rows · ${columnStats.length} columns`}
        >
          {rawRows.length > 0 && rawRows.length < totalRowCount ? (
            <>
              Showing {formatNumber(rawRows.length)} of {formatNumber(totalRowCount)}<span className="hidden sm:inline"> rows (sample)</span>
            </>
          ) : (
            <>
              {formatNumber(totalRowCount)} rows
            </>
          )}
          {" "}&middot; {columnStats.length} cols
        </span>
        <div className="flex-1 min-w-0" />
        {selectedRowIndices.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-loom-muted">{selectedRowIndices.length} selected</span>
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
              title="Download selected rows as CSV"
            >
              CSV
            </button>
          </div>
        )}
        {displayRows.length > 0 && sampleRows && (
          <button
            type="button"
            onClick={() => {
              const types = columns.map((c) => sampleRows.types?.[sampleRows.columns.indexOf(c)] ?? "VARCHAR");
              const rows = displayRows.map((row) =>
                columns.map((c) => {
                  const idx = allColumns.indexOf(c);
                  return idx >= 0 ? (row[idx] ?? null) : null;
                }),
              );
              const csv = queryResultToCsv({
                columns,
                rows,
                types,
                total_rows: rows.length,
              });
              downloadCsv(csv, `${selectedFile?.name?.replace(/\.[^.]+$/, "") ?? "data"}-view`);
              setToast(`Exported ${rows.length} rows (${columns.length} columns)`);
            }}
            className="loom-btn-ghost py-0 px-1.5 text-xs shrink-0"
            title="Export visible columns and filtered rows"
          >
            Export view
          </button>
        )}
        <button
          type="button"
          onClick={() => { setViewMode("chart"); if (!panelOpen) togglePanel(); setPanelTab("chart"); }}
          className="loom-btn-primary min-h-9 sm:min-h-0 py-1 sm:py-0.5 px-3 sm:px-2 shrink-0 text-xs"
        >
          Chart
        </button>
      </div>

      {/* Compact toolbar row */}
      {tableFilterRowIndices != null && tableFilterRowIndices.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-loom-warning/30 bg-loom-warning/5 text-2xs">
          <span className="text-loom-muted">Filtered: {tableFilterRowIndices.length} rows</span>
          <button type="button" onClick={() => setTableFilterRowIndices(null)} className="loom-btn-ghost text-2xs py-0 px-1">Clear</button>
        </div>
      )}
      {sampleRows && sampleRows.rows.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 border-b border-loom-border/50 bg-loom-surface/30 text-2xs overflow-x-auto whitespace-nowrap min-h-0 shrink-0">
          {isMobile ? (
            <button
              type="button"
              onClick={() => setDisplayOpen((o) => !o)}
              aria-expanded={displayOpen}
              className={`min-h-9 px-2.5 rounded border text-2xs ${displayOpen ? "border-loom-accent bg-loom-accent/20 text-loom-text" : "border-loom-border text-loom-muted"}`}
            >
              Display
            </button>
          ) : (
            [
              { key: "showSparklines" as const, label: "Spark", hint: "Sparklines in numeric column headers" },
              { key: "showValueBars" as const, label: "Bars", hint: "Inline value bars in numeric cells" },
              { key: "showHeat" as const, label: "Heat", hint: "Heat tint on numeric cells" },
              { key: "showTrendCue" as const, label: "Trend", hint: "Trend arrows in numeric column headers" },
              { key: "showNullRate" as const, label: "Null%", hint: "Share of empty values per column" },
            ].map(({ key, label, hint }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleEnhance(key)}
                aria-pressed={tableEnhance[key]}
                title={hint}
                className={`px-1.5 py-0.5 rounded text-2xs ${tableEnhance[key] ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
              >
                {label}
              </button>
            ))
          )}
          {isMobile && displayOpen && (
            <div className="flex items-center gap-1">
              {[
                { key: "showValueBars" as const, label: "Bars" },
                { key: "showHeat" as const, label: "Heat" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleEnhance(key)}
                  aria-pressed={tableEnhance[key]}
                  className={`min-h-9 px-2 rounded text-2xs ${tableEnhance[key] ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-loom-border"}`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowColumnFilters((v) => !v)}
                aria-pressed={showColumnFilters}
                className={`min-h-9 px-2 rounded text-2xs ${showColumnFilters ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-loom-border"}`}
              >
                Filters
              </button>
            </div>
          )}
          {!isMobile && <span className="text-loom-muted" aria-hidden>|</span>}
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnsOpen((o) => !o)}
              aria-expanded={columnsOpen}
              aria-haspopup="dialog"
              aria-label="Choose which columns to show"
              className={`min-h-9 sm:min-h-0 px-2.5 sm:px-2 py-0.5 rounded border text-loom-text ${columnsOpen ? "border-loom-accent bg-loom-accent/20" : "border-loom-border hover:border-loom-muted"}`}
            >
              Columns
            </button>
            {columnsOpen && (
              <>
                <div className="loom-menu absolute left-0 top-full mt-1 z-50 min-w-[180px] max-h-64 max-md:fixed max-md:inset-x-3 max-md:top-[calc(var(--safe-top)+9.25rem)] max-md:max-h-[60dvh] overflow-y-auto py-2 rounded">
                  <div className="px-2 pb-1 border-b border-loom-border/50 text-2xs font-semibold text-loom-muted">Show columns<span className="md:hidden font-normal"> · ← → to reorder</span></div>
                  {(isMobile ? [...columns, ...allColumns.filter((c) => !columns.includes(c))] : allColumns).map((col) => {
                    const visible = tablePrefs.visibleColumns == null || tablePrefs.visibleColumns.includes(col);
                    const pos = columns.indexOf(col);
                    return (
                      <div key={col} className="flex items-center">
                      <label className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1 max-md:min-h-10 hover:bg-loom-elevated/60 cursor-pointer text-xs text-loom-text">
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => {
                            pushTableUndo();
                            const next = tablePrefs.visibleColumns ?? allColumns;
                            const set = new Set(next);
                            if (visible) set.delete(col);
                            else set.add(col);
                            const list = allColumns.filter((c) => set.has(c));
                            setTablePrefs({ ...tablePrefs, visibleColumns: list.length === allColumns.length ? null : list });
                          }}
                          className="rounded border-loom-border accent-loom-accent"
                        />
                        <span className="truncate" title={col}>{col}</span>
                      </label>
                      {isMobile && pos >= 0 && <div className="flex shrink-0 pr-1">
                        <button type="button" onClick={() => moveColumn(col, pos - 1)} disabled={pos === 0} className="min-h-10 min-w-10 grid place-items-center text-loom-muted disabled:opacity-30" aria-label={`Move ${col} left`}>←</button>
                        <button type="button" onClick={() => moveColumn(col, pos + 1)} disabled={pos === columns.length - 1} className="min-h-10 min-w-10 grid place-items-center text-loom-muted disabled:opacity-30" aria-label={`Move ${col} right`}>→</button>
                      </div>}
                      </div>
                    );
                  })}
                  <div className="px-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        pushTableUndo();
                        setTablePrefs({ visibleColumns: null, columnOrder: null });
                      }}
                      className="w-full px-2 py-1 text-2xs text-loom-muted hover:text-loom-text border border-loom-border rounded"
                    >
                      Reset to all
                    </button>
                  </div>
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
              aria-haspopup="menu"
              title="Save or restore table views"
              className={`min-h-9 sm:min-h-0 px-2.5 sm:px-2 py-0.5 rounded border text-loom-text ${viewsOpen ? "border-loom-accent bg-loom-accent/20" : "border-loom-border hover:border-loom-muted"}`}
            >
              Views
            </button>
            {viewsOpen && (
              <>
                <div className="loom-menu absolute left-0 top-full mt-1 z-50 min-w-[160px] max-md:fixed max-md:inset-x-3 max-md:top-[calc(var(--safe-top)+9.25rem)] py-2 rounded">
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
                      <button type="button" onClick={() => { pushTableUndo(); applyTableView(v.id); setFilterInputValues(v.columnFilters ?? {}); setViewsOpen(false); }} className="flex-1 text-left text-2xs text-loom-text hover:bg-loom-elevated truncate" title={v.name}>
                        {v.name}
                      </button>
                      <button type="button" onClick={() => removeTableView(v.id)} className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100 text-loom-muted hover:text-loom-text text-2xs" aria-label={`Remove ${v.name}`}>×</button>
                    </div>
                  ))}
                  {tableViews.length === 0 && <p className="px-2 py-1 text-2xs text-loom-muted">No saved views</p>}
                </div>
                <div className="fixed inset-0 z-40" aria-hidden onClick={() => setViewsOpen(false)} />
              </>
            )}
          </div>
          <span className="text-loom-border hidden sm:inline" aria-hidden>|</span>
          <button type="button" onClick={undoTable} disabled={tableUndoStack.length === 0} className="min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 px-1 py-0 rounded text-loom-muted hover:text-loom-text disabled:opacity-30" title="Undo" aria-label="Undo table change">↶</button>
          <button type="button" onClick={redoTable} disabled={tableRedoStack.length === 0} className="min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 px-1 py-0 rounded text-loom-muted hover:text-loom-text disabled:opacity-30" title="Redo" aria-label="Redo table change">↷</button>
          {!isMobile && (
            <>
              <span className="text-loom-border" aria-hidden>|</span>
              <button type="button" onClick={() => toggleEnhance("sparklineViz", "line")} aria-pressed={tableEnhance.sparklineViz === "line"} title="Header sparklines as lines" className={`px-1.5 py-0.5 rounded text-2xs ${tableEnhance.sparklineViz === "line" ? "bg-loom-accent/20 text-loom-text" : "text-loom-muted"}`}>Line</button>
              <button type="button" onClick={() => toggleEnhance("sparklineViz", "histogram")} aria-pressed={tableEnhance.sparklineViz === "histogram"} title="Header sparklines as histograms" className={`px-1.5 py-0.5 rounded text-2xs ${tableEnhance.sparklineViz === "histogram" ? "bg-loom-accent/20 text-loom-text" : "text-loom-muted"}`}>Hist</button>
            </>
          )}
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
              <span className="font-semibold text-loom-text truncate min-w-0" title={profilingCol}>{profilingCol} <span className="font-normal text-loom-muted">{stat?.data_type ?? ""}</span></span>
              <button type="button" onClick={() => setProfilingCol(null)} className="text-loom-muted hover:text-loom-text min-w-6 min-h-6 shrink-0" aria-label={`Close ${profilingCol} profile`}>×</button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-loom-muted">
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
                <th className="px-1 py-1 text-left text-2xs font-semibold text-loom-muted whitespace-nowrap sticky top-0 left-0 z-20 bg-loom-bg border-b border-loom-border border-r border-loom-border/50 w-8 min-w-8 max-w-8">
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
                <th className="px-2 py-1 text-left text-2xs font-semibold text-loom-muted whitespace-nowrap sticky top-0 left-8 z-20 bg-loom-bg border-b border-loom-border border-r border-loom-border/50 w-10 min-w-10">
                  #
                </th>
                {columns.map((col, ci) => {
                  const isNum = numericColSet.has(ci);
                  const colData = numericData?.[ci];
                  const isSorted = sortCol === ci;
                  const nullP = enhance.showNullRate ? nullPct(col) : null;
                  const trend = isNum && colData && enhance.showTrendCue ? trendDirection(colData.values) : null;
                  const chartRole = chartRoleByCol.get(col);
                  return (
                    <th
                      key={col}
                      style={{ minWidth: columnWidths[col] ?? 200, maxWidth: columnWidths[col] ?? 200 }}
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => handleColumnDragStart(e, col)}
                      onDragOver={handleColumnDragOver}
                      onDrop={(e) => handleColumnDrop(e, col)}
                      onDragEnd={handleColumnDragEnd}
                      className={`relative px-2 py-1 text-left text-2xs font-semibold whitespace-nowrap sticky top-0 cursor-pointer hover:bg-loom-elevated/60 select-none ${
                        draggedCol === col ? "opacity-50" : ""
                      } ${
                        chartRole
                          ? "text-loom-text bg-[color-mix(in_srgb,var(--loom-accent)_6%,var(--loom-bg))] border-b border-loom-accent/35 shadow-[inset_0_-2px_0_0_color-mix(in_srgb,var(--loom-accent)_55%,transparent)]"
                          : "text-loom-muted bg-loom-bg border-b border-loom-border"
                      }`}
                      onKeyDown={(e) => handleSortKey(e, ci)}
                      onClick={() => {
                        // A long-press already opened the profile — don't also sort.
                        if (longPressFiredRef.current) {
                          longPressFiredRef.current = false;
                          return;
                        }
                        handleSort(ci);
                      }}
                      onContextMenu={(e) => { e.preventDefault(); setProfilingCol(profilingCol === col ? null : col); }}
                      onTouchStart={() => {
                        longPressFiredRef.current = false;
                        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = setTimeout(() => {
                          longPressFiredRef.current = true;
                          setProfilingCol(profilingCol === col ? null : col);
                        }, 500);
                      }}
                      onTouchMove={() => {
                        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                      }}
                      onTouchEnd={() => {
                        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                      }}
                      title={
                        chartRole
                          ? `${col} — on chart as ${chartRole}. Click to sort, right-click or long-press to profile, drag to reorder`
                          : "Click to sort, right-click or long-press to profile, drag to reorder"
                      }
                      aria-sort={isSorted ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1">
                          {col}
                          {chartRole && (
                            <span className="text-[9px] font-medium normal-case tracking-normal text-loom-accent" aria-label={`Chart ${chartRole}`}>
                              {chartRole}
                            </span>
                          )}
                          {isSorted && (
                            <span className="text-loom-accent font-normal" aria-hidden>
                              {sortDir === "asc" ? "↑" : "↓"}
                            </span>
                          )}
                          {trend === 1 && <span className="text-loom-success font-normal" aria-label="trend up">↑</span>}
                          {trend === -1 && <span className="text-loom-warning font-normal" aria-label="trend down">↓</span>}
                          {nullP != null && (
                            <span className="text-loom-muted/80 font-normal normal-case" title={`${nullP.toFixed(1)}% null`}>
                              {nullP >= 1 ? `${nullP.toFixed(0)}%∅` : "<1%∅"}
                            </span>
                          )}
                        </span>
                        {isNum && colData && enhance.showSparklines && (
                          <>
                            {colData.values.length >= 2 && enhance.sparklineViz === "line" && (
                              <Sparkline values={colData.values} className="opacity-70" />
                            )}
                            {colData.values.length >= 2 && enhance.sparklineViz === "histogram" && (
                              <MiniHistogram values={colData.values} className="opacity-80" />
                            )}
                            <span className="text-2xs text-loom-muted/80 font-normal normal-case">
                              {colData.min === colData.max
                                ? colData.min.toLocaleString()
                                : `${colData.min.toLocaleString()} – ${colData.max.toLocaleString()}`}
                            </span>
                          </>
                        )}
                      </div>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${col}`}
                        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-loom-accent/40"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          resizeRef.current = {
                            col,
                            startX: e.clientX,
                            startW: columnWidths[col] ?? 200,
                          };
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
              {(!isMobile || showColumnFilters) && (
              <tr className="bg-loom-surface/50 sticky top-7 z-10">
                <th className="px-2 py-1 border-b border-loom-border border-r border-loom-border/50 sticky left-0 z-10 bg-loom-surface w-8 min-w-8 max-w-8" />
                <th className="px-2 py-1 border-b border-loom-border border-r border-loom-border/50 sticky left-8 z-10 bg-loom-surface w-10 min-w-10" />
                {columns.map((col) => (
                  <th key={col} className="px-1 py-0.5 border-b border-loom-border">
                    <input
                      type="text"
                      value={filterInputValues[col] ?? ""}
                      onChange={(e) => setFilterInputAndDebounce(col, e.target.value)}
                      placeholder="Filter..."
                      className="loom-input w-full text-2xs py-0.5 px-1 min-w-0 min-h-8 sm:min-h-0"
                      aria-label={`Filter ${col}`}
                    />
                  </th>
                ))}
              </tr>
              )}
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-8 text-center font-sans text-xs text-loom-muted">
                    No rows match the current filters.{" "}
                    <button
                      type="button"
                      className="text-loom-accent hover:underline"
                      onClick={() => {
                        setTableFilterRowIndices(null);
                        for (const t of Object.values(filterDebounceRef.current)) clearTimeout(t);
                        filterDebounceRef.current = {};
                        setTableColumnFilters({});
                        setFilterInputValues({});
                      }}
                    >
                      Clear filters
                    </button>
                  </td>
                </tr>
              )}
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
                            data-explorer-focus-row={ri}
                            className={`border-b border-loom-border/30 hover:bg-loom-elevated/40 ${isAnomaly ? "bg-loom-warning/10 border-l-2 border-l-loom-warning" : ""} ${focusedRowIndex === ri ? "ring-1 ring-inset ring-loom-accent bg-loom-elevated/50" : ""} ${hoveredRowIndex === originalIdx ? "bg-loom-accent/10" : ""}`}
                            title={isAnomaly ? "Marked as anomaly (Smart tab)" : undefined}
                            aria-rowindex={ri + 1}
                            onMouseEnter={() => setHoveredRowIndex(originalIdx)}
                            onMouseLeave={() => setHoveredRowIndex(null)}
                            style={{ height: ROW_HEIGHT }}
                          >
                            <td className="px-1 py-1 w-8 min-w-8 max-w-8 sticky left-0 z-10 bg-inherit border-r border-loom-border/30">
                              <input
                                type="checkbox"
                                checked={selectedSet.has(originalIdx)}
                                onChange={() => toggleRowSelectionByOriginal(originalIdx)}
                                className="rounded border-loom-border accent-loom-accent"
                                aria-label={`Select row ${ri + 1}`}
                              />
                            </td>
                            <td className="px-2 py-1 text-loom-muted w-10 min-w-10 sticky left-8 z-10 bg-inherit border-r border-loom-border/30">{originalIdx + 1}</td>
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
                      data-explorer-focus-row={ri}
                      className={`border-b border-loom-border/30 hover:bg-loom-elevated/40 transition-colors ${isAnomaly ? "bg-loom-warning/10 border-l-2 border-l-loom-warning" : ""} ${focusedRowIndex === ri ? "ring-1 ring-inset ring-loom-accent bg-loom-elevated/50" : ""} ${hoveredRowIndex === originalIdx ? "bg-loom-accent/10" : ""}`}
                      title={isAnomaly ? "Marked as anomaly (Smart tab)" : undefined}
                      aria-rowindex={ri + 1}
                      onMouseEnter={() => setHoveredRowIndex(originalIdx)}
                      onMouseLeave={() => setHoveredRowIndex(null)}
                    >
                      <td className="px-1 py-1 w-8 min-w-8 max-w-8 sticky left-0 z-10 bg-inherit border-r border-loom-border/30">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(originalIdx)}
                          onChange={() => toggleRowSelectionByOriginal(originalIdx)}
                          className="rounded border-loom-border accent-loom-accent"
                          aria-label={`Select row ${ri + 1}`}
                        />
                      </td>
                      <td className="px-2 py-1 text-loom-muted w-10 min-w-10 sticky left-8 z-10 bg-inherit border-r border-loom-border/30">{originalIdx + 1}</td>
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
  return <StartHere />;
}
