// =================================================================
// QueryView — SQL Editor + Results
// =================================================================
// A SQL query editor that executes against the selected file
// via DuckDB on the Rust side. Results render in a data grid.
// =================================================================

"use client";

import { useLoomStore } from "@/lib/store";
import { queryFile } from "@/lib/tauri";
import { useState, useCallback } from "react";

export function QueryView() {
  const {
    selectedFile, querySql, setQuerySql,
    queryResult, setQueryResult, queryError, setQueryError,
    isQuerying, setIsQuerying,
  } = useLoomStore();

  const [localSql, setLocalSql] = useState(querySql || "SELECT * FROM loom_active LIMIT 100");

  const handleExecute = useCallback(async () => {
    if (!selectedFile) return;
    setIsQuerying(true);
    setQueryError(null);
    setQuerySql(localSql);
    try {
      const result = await queryFile(selectedFile.path, localSql, 10000);
      setQueryResult(result);
    } catch (e) {
      setQueryError(String(e));
      setQueryResult(null);
    } finally {
      setIsQuerying(false);
    }
  }, [selectedFile, localSql, setIsQuerying, setQueryError, setQuerySql, setQueryResult]);

  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-loom-muted">Select a file to query</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Editor */}
      <div className="border-b border-loom-border bg-loom-surface/50 p-3 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-loom-muted font-mono">SQL</span>
          <span className="text-2xs text-loom-muted">
            Table: <code className="text-loom-accent">loom_active</code> = {selectedFile.name}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleExecute}
            disabled={isQuerying}
            className="loom-btn-primary text-xs"
          >
            {isQuerying ? "Running..." : "Execute"}
            <span className="text-2xs opacity-60 ml-1 font-mono">&#x21B5;</span>
          </button>
        </div>
        <textarea
          value={localSql}
          onChange={(e) => setLocalSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleExecute();
            }
          }}
          className="loom-input font-mono text-xs h-24 resize-none"
          placeholder="SELECT * FROM loom_active WHERE ..."
          spellCheck={false}
        />
      </div>

      {/* Error */}
      {queryError && (
        <div className="px-4 py-2 bg-loom-error/10 border-b border-loom-error/30">
          <p className="text-xs font-mono text-loom-error">{queryError}</p>
        </div>
      )}

      {/* Results Grid */}
      <div className="flex-1 overflow-auto">
        {queryResult && queryResult.rows.length > 0 ? (
          <>
            <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1 bg-loom-bg border-b border-loom-border">
              <span className="text-2xs text-loom-muted font-mono">
                {queryResult.total_rows} rows &middot; {queryResult.columns.length} cols
              </span>
            </div>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr>
                  {queryResult.columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left text-2xs font-semibold text-loom-muted uppercase tracking-wider whitespace-nowrap sticky top-7 bg-loom-bg border-b border-loom-border"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queryResult.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-loom-border/30 hover:bg-loom-elevated/40">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-loom-text whitespace-nowrap">
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
          </>
        ) : !queryError ? (
          <div className="flex items-center justify-center h-full text-sm text-loom-muted">
            Run a query to see results
          </div>
        ) : null}
      </div>
    </div>
  );
}
