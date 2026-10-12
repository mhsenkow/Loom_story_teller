// =================================================================
// PreviewFooter — Preview + Schema; column tokens → Chart encoding
// =================================================================
// Preview: sortable table with draggable header tokens (roles badge).
// Schema: field chips; desktop drag into Encoding, mobile tap → assign.
// =================================================================

"use client";

import { useMemo, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { useIsMobile } from "@/lib/useMediaQuery";
import { createChartRec } from "@/lib/recommendations";
import { encodingChannelLabels } from "@/lib/chartSupport";

const DRAG_TYPE_COLUMN = "application/x-loom-column";

type FooterTab = "preview" | "schema";
type SortDir = "asc" | "desc";
type EncodeSlot = "x" | "y" | "color";

function compareCells(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
  dir: SortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mul;
  if (typeof a === "boolean" && typeof b === "boolean") return (Number(a) - Number(b)) * mul;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * mul;
}

export function PreviewFooter() {
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const columnStats = useLoomStore((s) => s.columnStats);
  const activeChart = useLoomStore((s) => s.activeChart);
  const chartTitleOverrides = useLoomStore((s) => s.chartTitleOverrides);
  const viewMode = useLoomStore((s) => s.viewMode);
  const panelOpen = useLoomStore((s) => s.panelOpen);
  const setActiveChart = useLoomStore((s) => s.setActiveChart);
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const setPanelOpen = useLoomStore((s) => s.setPanelOpen);
  const [expanded, setExpanded] = useState(false);
  const [footerTab, setFooterTab] = useState<FooterTab>("preview");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [assignCol, setAssignCol] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const tableName = selectedFile?.name?.replace(/\.[^.]+$/, "") ?? "data";

  const roleByCol = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeChart) return map;
    const labels = encodingChannelLabels(activeChart.kind);
    if (activeChart.xField) map.set(activeChart.xField, labels.x);
    if (activeChart.yField) map.set(activeChart.yField, labels.y);
    if (activeChart.colorField) map.set(activeChart.colorField, labels.color);
    if (activeChart.sizeField) map.set(activeChart.sizeField, labels.size);
    return map;
  }, [activeChart]);

  const sortedRows = useMemo(() => {
    if (!sampleRows?.rows.length) return [];
    const cols = sampleRows.columns;
    const idx = sortCol ? cols.indexOf(sortCol) : -1;
    const slice = sampleRows.rows.slice(0, 200);
    if (idx < 0) return slice;
    return [...slice].sort((ra, rb) => compareCells(ra[idx] ?? null, rb[idx] ?? null, sortDir));
  }, [sampleRows, sortCol, sortDir]);

  if (!selectedFile) return null;

  const rowCount = sampleRows?.rows.length ?? 0;
  const total = sampleRows?.total_rows ?? rowCount;
  const hasSchema = columnStats.length > 0;

  function handleDragStart(e: React.DragEvent, colName: string) {
    e.dataTransfer.setData(DRAG_TYPE_COLUMN, colName);
    e.dataTransfer.setData("text/plain", colName);
    e.dataTransfer.effectAllowed = "copy";
  }

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function assignToSlot(slot: EncodeSlot, colName: string) {
    if (!activeChart || columnStats.length === 0) {
      setAssignCol(null);
      return;
    }
    const newX = slot === "x" ? colName : activeChart.xField;
    const newY = slot === "y" ? colName : activeChart.yField;
    const newColor = slot === "color" ? colName : activeChart.colorField;
    const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName);
    if (rec) {
      setActiveChart(rec);
      setPanelTab("chart");
      if (!panelOpen) setPanelOpen(true);
    }
    setAssignCol(null);
  }

  function onTokenActivate(colName: string) {
    if (isMobile || !activeChart) {
      setAssignCol((c) => (c === colName ? null : colName));
      setExpanded(true);
      return;
    }
    // Desktop: drag is primary; click still opens assign for discoverability
    setAssignCol((c) => (c === colName ? null : colName));
  }

  const channelLabels = activeChart
    ? encodingChannelLabels(activeChart.kind)
    : { x: "X", y: "Y", color: "Color", size: "Size" };

  // Mobile chart: keep a slim peek so Preview/Schema stay one tap away
  const peekOnly = isMobile && viewMode === "chart" && !expanded;

  return (
    <div className="flex flex-col border-t border-loom-border bg-loom-surface/95 backdrop-blur-sm max-md:pb-[var(--safe-bottom)]">
      <div className="flex items-center justify-between min-h-11 sm:min-h-[var(--statusbar-height)] sm:h-[var(--statusbar-height)]">
        <div className="loom-seg ml-2 my-1 sm:my-0">
          <button
            type="button"
            onClick={() => {
              setFooterTab("preview");
              if (peekOnly) setExpanded(true);
            }}
            aria-pressed={footerTab === "preview"}
            className="loom-seg-item loom-seg-item-quiet min-h-9 sm:min-h-0 px-3 sm:px-2.5 text-2xs border border-transparent"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => {
              setFooterTab("schema");
              if (peekOnly) setExpanded(true);
            }}
            aria-pressed={footerTab === "schema"}
            className="loom-seg-item loom-seg-item-quiet min-h-9 sm:min-h-0 px-3 sm:px-2.5 text-2xs border border-transparent"
          >
            Schema
          </button>
        </div>
        <div className="flex items-center gap-2 pr-2">
          {activeChart && (
            <span
              className="text-2xs font-mono text-loom-accent truncate max-w-[120px] sm:max-w-[200px]"
              title={chartTitleOverrides[activeChart.id] ?? activeChart.title}
            >
              Chart: {chartTitleOverrides[activeChart.id] ?? activeChart.title}
            </span>
          )}
          {footerTab === "preview" && !activeChart && (
            <span className="text-2xs font-mono text-loom-muted">
              {rowCount > 0
                ? `${rowCount.toLocaleString()} rows` +
                  (total > rowCount ? ` of ${total.toLocaleString()}` : "")
                : "No data"}
            </span>
          )}
          {footerTab === "schema" && hasSchema && (
            <span className="text-2xs font-mono text-loom-muted hidden sm:inline">
              Drag into Chart → Encoding · tap to assign
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 text-2xs text-loom-muted hover:text-loom-text hover:bg-loom-elevated rounded-md grid place-items-center transition-colors"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse preview" : "Expand preview"}
            aria-expanded={expanded}
          >
            <span aria-hidden>{expanded ? "▼" : "▲"}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="max-h-[min(55vh,28rem)] sm:max-h-64 overflow-auto border-t border-loom-border/50">
          {assignCol && activeChart && (
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-loom-elevated/95 border-b border-loom-border backdrop-blur-sm">
              <span className="text-2xs text-loom-muted font-mono truncate max-w-[8rem]" title={assignCol}>
                {assignCol}
              </span>
              <span className="text-2xs text-loom-muted">→</span>
              {(["x", "y", "color"] as EncodeSlot[]).map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => assignToSlot(slot, assignCol)}
                  className="min-h-8 px-2.5 text-2xs rounded-full border border-loom-border bg-loom-surface text-loom-text hover:border-loom-accent hover:text-loom-accent"
                >
                  {slot === "x" ? channelLabels.x : slot === "y" ? channelLabels.y : channelLabels.color}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAssignCol(null)}
                className="ml-auto text-2xs text-loom-muted hover:text-loom-text px-1"
              >
                Cancel
              </button>
            </div>
          )}

          {footerTab === "preview" ? (
            !sampleRows || sampleRows.rows.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-loom-muted">No preview data</div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-loom-border">
                    {sampleRows.columns.map((col) => {
                      const role = roleByCol.get(col);
                      const sorted = sortCol === col;
                      return (
                        <th
                          key={col}
                          className="px-1.5 py-1.5 text-left sticky top-0 bg-loom-surface z-10"
                        >
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => handleDragStart(e, col)}
                            onClick={() => toggleSort(col)}
                            onDoubleClick={() => onTokenActivate(col)}
                            title={`${col} — click sort · drag to Encoding · double-click assign`}
                            className={`
                              group inline-flex items-center gap-1 max-w-[11rem] px-1.5 py-1 rounded-md border text-2xs font-semibold uppercase tracking-wider
                              cursor-grab active:cursor-grabbing transition-colors
                              ${
                                role
                                  ? "border-loom-accent/50 bg-loom-accent/10 text-loom-accent"
                                  : "border-loom-border/80 bg-loom-elevated/60 text-loom-muted hover:border-loom-accent/40 hover:text-loom-text"
                              }
                            `}
                          >
                            <span className="truncate">{col}</span>
                            {role ? (
                              <span className="normal-case tracking-normal font-medium text-[9px] opacity-80 shrink-0">
                                {role}
                              </span>
                            ) : null}
                            <span className="text-[9px] opacity-60 shrink-0 tabular-nums" aria-hidden>
                              {sorted ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.slice(0, 50).map((row, ri) => (
                    <tr key={ri} className="border-b border-loom-border/50 hover:bg-loom-elevated/50">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-2 py-1 text-loom-text whitespace-nowrap max-w-[240px] truncate"
                          title={typeof cell === "string" && cell.length > 30 ? cell : undefined}
                        >
                          {cell === null ? (
                            <span className="text-loom-muted italic">null</span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <div className="p-2 flex flex-wrap gap-1.5">
              {!hasSchema ? (
                <p className="text-sm text-loom-muted px-2">Select a file to see columns</p>
              ) : (
                columnStats.map((col) => {
                  const role = roleByCol.get(col.name);
                  const active = assignCol === col.name;
                  return (
                    <button
                      key={col.name}
                      type="button"
                      draggable
                      onDragStart={(e) => handleDragStart(e, col.name)}
                      onClick={() => onTokenActivate(col.name)}
                      className={`
                        flex items-center gap-1.5 px-2 py-1.5 min-h-9 rounded-md border text-xs font-mono transition-colors shrink-0
                        cursor-grab active:cursor-grabbing
                        ${
                          active
                            ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                            : role
                              ? "border-loom-accent/40 bg-loom-accent/10 text-loom-text"
                              : "border-loom-border bg-loom-elevated hover:border-loom-accent text-loom-text"
                        }
                      `}
                    >
                      <span className="truncate max-w-[140px]" title={col.name}>
                        {col.name}
                      </span>
                      <span className="text-2xs text-loom-muted shrink-0">({col.data_type})</span>
                      {role ? (
                        <span className="text-[9px] uppercase tracking-wide text-loom-accent shrink-0">
                          {role}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
              {hasSchema && (
                <p className="w-full text-2xs text-loom-muted px-1 pt-1">
                  {isMobile
                    ? "Tap a field, then pick X / Y / Color — chart updates live."
                    : "Drag onto Chart → Encoding, or tap to assign."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
