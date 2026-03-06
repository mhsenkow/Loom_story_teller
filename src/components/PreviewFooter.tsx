// =================================================================
// PreviewFooter — Preview + Schema tabs; drag column tokens into Chart encoding
// =================================================================
// Tabs: Preview (data table) | Schema (draggable column tokens).
// Drag tokens from Schema into the right-panel Chart tab encoding targets.
// =================================================================

"use client";

import { useState } from "react";
import { useLoomStore } from "@/lib/store";

const DRAG_TYPE_COLUMN = "application/x-loom-column";

type FooterTab = "preview" | "schema";

export function PreviewFooter() {
  const { sampleRows, selectedFile, columnStats, activeChart, chartTitleOverrides } = useLoomStore();
  const [expanded, setExpanded] = useState(false);
  const [footerTab, setFooterTab] = useState<FooterTab>("preview");

  if (!selectedFile) return null;

  const rowCount = sampleRows?.rows.length ?? 0;
  const total = sampleRows?.total_rows ?? rowCount;
  const hasSchema = columnStats.length > 0;

  function handleDragStart(e: React.DragEvent, colName: string) {
    e.dataTransfer.setData(DRAG_TYPE_COLUMN, colName);
    e.dataTransfer.setData("text/plain", colName);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <div className="flex flex-col border-t border-loom-border bg-loom-surface">
      {/* Tab bar + expand toggle */}
      <div className="flex items-center justify-between h-[var(--statusbar-height)] min-h-[28px]">
        <div className="flex items-center gap-0.5 px-2">
          <button
            type="button"
            onClick={() => setFooterTab("preview")}
            className={`px-2.5 py-1 text-2xs font-medium rounded transition-colors ${footerTab === "preview" ? "bg-loom-elevated text-loom-text" : "text-loom-muted hover:text-loom-text"}`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setFooterTab("schema")}
            className={`px-2.5 py-1 text-2xs font-medium rounded transition-colors ${footerTab === "schema" ? "bg-loom-elevated text-loom-text" : "text-loom-muted hover:text-loom-text"}`}
          >
            Schema
          </button>
        </div>
        <div className="flex items-center gap-2 pr-2">
          {activeChart && (
            <span className="text-2xs font-mono text-loom-accent truncate max-w-[200px]" title={chartTitleOverrides[activeChart.id] ?? activeChart.title}>
              Chart: {chartTitleOverrides[activeChart.id] ?? activeChart.title}
            </span>
          )}
          {footerTab === "preview" && !activeChart && (
            <span className="text-2xs font-mono text-loom-muted">
              {rowCount > 0 ? `${rowCount.toLocaleString()} rows` + (total > rowCount ? ` of ${total.toLocaleString()}` : "") : "No data"}
            </span>
          )}
          {footerTab === "schema" && hasSchema && (
            <span className="text-2xs font-mono text-loom-muted">Drag into Chart → Encoding</span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-2xs text-loom-muted hover:text-loom-text p-0.5"
            title={expanded ? "Collapse" : "Expand"}
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
            <div className="p-2 flex flex-wrap gap-1.5">
              {!hasSchema ? (
                <p className="text-sm text-loom-muted px-2">Select a file to see columns</p>
              ) : (
                columnStats.map((col) => (
                  <div
                    key={col.name}
                    draggable
                    onDragStart={(e) => handleDragStart(e, col.name)}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-loom-border bg-loom-elevated hover:border-loom-accent cursor-grab active:cursor-grabbing text-xs font-mono text-loom-text transition-colors shrink-0"
                  >
                    <span className="truncate max-w-[140px]" title={col.name}>{col.name}</span>
                    <span className="text-2xs text-loom-muted shrink-0">({col.data_type})</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
