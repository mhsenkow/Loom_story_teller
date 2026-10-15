// =================================================================
// PreviewFooter — Preview + Schema tabs; drag column tokens into Chart encoding
// =================================================================
// Tabs: Preview (data table) | Schema (draggable column tokens).
// Drag tokens from Schema into the right-panel Chart tab encoding targets.
// Phones (no HTML5 drag on touch): tap a token → "Use as X / Y / Color / Size".
// =================================================================

"use client";

import { useState } from "react";
import { useLoomStore } from "@/lib/store";
import { useIsMobile } from "@/lib/useMediaQuery";
import { reencodeChart, type EncodingDropSlot } from "@/lib/recommendations";

const DRAG_TYPE_COLUMN = "application/x-loom-column";

type FooterTab = "preview" | "schema";

const TAP_SLOTS: { slot: EncodingDropSlot; label: string }[] = [
  { slot: "x", label: "X" },
  { slot: "y", label: "Y" },
  { slot: "color", label: "Color" },
  { slot: "size", label: "Size" },
];

export function PreviewFooter() {
  const { sampleRows, selectedFile, columnStats, activeChart, chartTitleOverrides, viewMode, barStackMode, setActiveChart, setToast } = useLoomStore();
  const [expanded, setExpanded] = useState(false);
  const [footerTab, setFooterTab] = useState<FooterTab>("preview");
  const [tapCol, setTapCol] = useState<string | null>(null);
  const isMobile = useIsMobile();

  if (!selectedFile) return null;
  // Chart view on phones: keep canvas tall; schema/preview stay one tap away from Explorer.
  if (isMobile && viewMode === "chart" && !expanded) return null;

  const rowCount = sampleRows?.rows.length ?? 0;
  const total = sampleRows?.total_rows ?? rowCount;
  const hasSchema = columnStats.length > 0;

  function handleDragStart(e: React.DragEvent, colName: string) {
    e.dataTransfer.setData(DRAG_TYPE_COLUMN, colName);
    e.dataTransfer.setData("text/plain", colName);
    e.dataTransfer.effectAllowed = "copy";
  }

  function assignColumn(slot: EncodingDropSlot, colName: string) {
    if (!activeChart) return;
    const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";
    const rec = reencodeChart(activeChart, columnStats, tableName, slot, colName, barStackMode);
    const label = TAP_SLOTS.find((t) => t.slot === slot)?.label ?? slot;
    if (rec) {
      setActiveChart(rec);
      setToast(`${label} → ${colName}`);
    } else {
      setToast(`${colName} doesn't fit ${label} for this chart`);
    }
    setTapCol(null);
  }

  return (
    <div
      className="flex flex-col border-t border-loom-border bg-loom-surface/95 backdrop-blur-sm max-md:pb-[var(--safe-bottom)]"
      style={{ paddingBottom: expanded ? undefined : undefined }}
    >
      {/* Tab bar + expand toggle */}
      <div className="flex items-center justify-between min-h-11 sm:min-h-[var(--statusbar-height)] sm:h-[var(--statusbar-height)]">
        <div className="loom-seg ml-2 my-1 sm:my-0">
          <button
            type="button"
            onClick={() => setFooterTab("preview")}
            aria-pressed={footerTab === "preview"}
            className="loom-seg-item loom-seg-item-quiet min-h-9 sm:min-h-0 px-3 sm:px-2.5 text-2xs border border-transparent"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setFooterTab("schema")}
            aria-pressed={footerTab === "schema"}
            className="loom-seg-item loom-seg-item-quiet min-h-9 sm:min-h-0 px-3 sm:px-2.5 text-2xs border border-transparent"
          >
            Schema
          </button>
        </div>
        <div className="flex items-center gap-2 pr-2">
          {activeChart && (
            <span className="text-2xs font-mono text-loom-accent truncate max-w-[120px] sm:max-w-[200px]" title={chartTitleOverrides[activeChart.id] ?? activeChart.title}>
              Chart: {chartTitleOverrides[activeChart.id] ?? activeChart.title}
            </span>
          )}
          {footerTab === "preview" && !activeChart && (
            <span className="text-2xs font-mono text-loom-muted">
              {rowCount > 0 ? `${rowCount.toLocaleString()} rows` + (total > rowCount ? ` of ${total.toLocaleString()}` : "") : "No data"}
            </span>
          )}
          {footerTab === "schema" && hasSchema && (
            <>
              <span className="text-2xs font-mono text-loom-muted hidden md:inline">Drag into Chart → Encoding</span>
              <span className="text-2xs font-mono text-loom-muted md:hidden whitespace-nowrap">Tap a column</span>
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 text-2xs text-loom-muted hover:text-loom-text hover:bg-loom-elevated rounded-md grid place-items-center transition-colors"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse preview" : "Expand preview"}
          >
            {expanded ? "▼" : "▶"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="max-h-52 overflow-auto border-t border-loom-border/50">
          {footerTab === "preview" ? (
            !sampleRows || sampleRows.rows.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-loom-muted">No preview data</div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-loom-border">
                    {sampleRows.columns.map((col) => (
                      <th
                        key={col}
                        className="px-2 py-1.5 text-left text-2xs font-semibold text-loom-muted uppercase tracking-wider whitespace-nowrap sticky top-0 bg-loom-surface"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.rows.slice(0, 50).map((row, ri) => (
                    <tr key={ri} className="border-b border-loom-border/50 hover:bg-loom-elevated/50">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-loom-text whitespace-nowrap">
                          {cell === null ? <span className="text-loom-muted italic">null</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <>
              {isMobile && tapCol && (
                <div
                  className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-loom-border/50 bg-loom-surface"
                  role="menu"
                  aria-label={`Use ${tapCol} as`}
                >
                  <span className="text-2xs text-loom-muted truncate max-w-[40%]">
                    Use <span className="font-mono text-loom-text">{tapCol}</span> as
                  </span>
                  {activeChart ? (
                    TAP_SLOTS.map(({ slot, label }) => (
                      <button
                        key={slot}
                        type="button"
                        role="menuitem"
                        onClick={() => assignColumn(slot, tapCol)}
                        className="min-h-10 px-3 rounded border border-loom-border bg-loom-elevated text-xs text-loom-text active:border-loom-accent"
                      >
                        {label}
                      </button>
                    ))
                  ) : (
                    <span className="text-2xs text-loom-muted">— pick a chart first</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setTapCol(null)}
                    className="ml-auto min-h-10 min-w-10 grid place-items-center text-loom-muted"
                    aria-label="Close column menu"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="p-2 flex flex-wrap gap-1.5">
                {!hasSchema ? (
                  <p className="text-sm text-loom-muted px-2">Select a file to see columns</p>
                ) : (
                  columnStats.map((col) => (
                    <div
                      key={col.name}
                      draggable
                      onDragStart={(e) => handleDragStart(e, col.name)}
                      onClick={isMobile ? () => setTapCol((c) => (c === col.name ? null : col.name)) : undefined}
                      role={isMobile ? "button" : undefined}
                      aria-expanded={isMobile ? tapCol === col.name : undefined}
                      className={`flex items-center gap-1.5 px-2 py-1.5 max-md:min-h-10 rounded border hover:border-loom-accent cursor-grab active:cursor-grabbing text-xs font-mono text-loom-text transition-colors shrink-0 ${
                        isMobile && tapCol === col.name ? "border-loom-accent bg-loom-accent/20" : "border-loom-border bg-loom-elevated"
                      }`}
                    >
                      <span className="truncate max-w-[140px]" title={col.name}>{col.name}</span>
                      <span className="text-2xs text-loom-muted shrink-0">({col.data_type})</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
