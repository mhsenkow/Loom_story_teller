// =================================================================
// ExplorerView — Data Table + Overview
// =================================================================
// The default view when a file is selected. Shows a full-width
// data table with sortable columns and row-level detail.
// =================================================================

"use client";

import { useLoomStore } from "@/lib/store";
import { formatNumber } from "@/lib/format";

export function ExplorerView() {
  const { selectedFile, sampleRows, columnStats } = useLoomStore();

  if (!selectedFile) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* File Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-loom-border bg-loom-surface/50">
        <div>
          <h2 className="text-sm font-semibold text-loom-text">{selectedFile.name}</h2>
          <p className="text-2xs text-loom-muted font-mono mt-0.5">
            {formatNumber(selectedFile.row_count)} rows &middot;{" "}
            {columnStats.length} columns &middot;{" "}
            {selectedFile.extension.toUpperCase()}
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2">
          {columnStats.slice(0, 4).map((col) => (
            <div key={col.name} className="loom-badge">
              {col.name}: {col.data_type}
            </div>
          ))}
          {columnStats.length > 4 && (
            <span className="loom-badge">+{columnStats.length - 4} more</span>
          )}
        </div>
      </div>

      {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        {sampleRows && sampleRows.rows.length > 0 ? (
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-2xs font-semibold text-loom-muted uppercase tracking-wider whitespace-nowrap sticky top-0 bg-loom-bg border-b border-loom-border w-10">
                  #
                </th>
                {sampleRows.columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2 text-left text-2xs font-semibold text-loom-muted uppercase tracking-wider whitespace-nowrap sticky top-0 bg-loom-bg border-b border-loom-border"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-loom-border/30 hover:bg-loom-elevated/40 transition-colors"
                >
                  <td className="px-3 py-1.5 text-loom-muted">{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-loom-text whitespace-nowrap max-w-[200px] truncate">
                      {cell === null ? (
                        <span className="text-loom-muted/60 italic">null</span>
                      ) : typeof cell === "number" ? (
                        <span className="text-loom-accent">{cell.toLocaleString()}</span>
                      ) : (
                        String(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
