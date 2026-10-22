// =================================================================
// QueryView — SQL Editor + Results
// =================================================================
// A SQL query editor that executes against the selected file
// via DuckDB on the Rust side. Results render in a data grid.
// =================================================================

"use client";

import { useLoomStore } from "@/lib/store";
import { viewModeName } from "@/lib/viewModes";
import { applyQueryResult } from "@/lib/datasetPipeline";
import { queryFile, streamQuery, sourceQuery } from "@/lib/tauri";
import { STREAM_SQL_SNIPPETS, SOURCE_SQL_SNIPPETS } from "@/lib/recommendations";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { SqlEditor } from "@/components/SqlEditor";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { QueryResultsSkeleton } from "@/components/Skeleton";
import { validateQuery } from "@/lib/queryValidate";
import { sqlIdent } from "@/lib/dive";
import { formatExplorerNumber } from "@/lib/tableExplorer";
import { compareExplorerCells } from "@/lib/tableSort";
import { StartHere } from "@/components/StartHere";
import { sourceKindFromPath, sourceTable as sourceTableName } from "@/lib/sourceRegistry";

export function QueryView() {
  const {
    selectedFile, querySql, setQuerySql,
    queryResult, setQueryResult, queryError, setQueryError,
    isQuerying, setIsQuerying,
    queryHistory, appendQueryHistory,
    querySnippets, addQuerySnippet, setPromptDialog,
    columnStats,
    setToast,
    queryResultPage, queryResultPageSize, setQueryResultPage, setQueryResultPageSize,
    querySnapshots, addQuerySnapshot, removeQuerySnapshot,
    nlQueryInput, setNlQueryInput,
    addQueryView,
  } = useLoomStore();

  const isStream = selectedFile?.path === "stream://wiki";
  const pathSourceKind = sourceKindFromPath(selectedFile?.path);
  const sourceTable = pathSourceKind ? sourceTableName(pathSourceKind) : undefined;
  const activeTable = isStream ? "wiki_stream" : sourceTable ?? "loom_active";
  const defaultSql = isStream
    ? "SELECT * FROM wiki_stream ORDER BY ts DESC LIMIT 100"
    : sourceTable
      ? `SELECT * FROM ${sourceTable} LIMIT 100`
      : "SELECT * FROM loom_active LIMIT 100";
  const [localSql, setLocalSql] = useState(querySql || defaultSql);
  const filePath = selectedFile?.path ?? null;

  // Reset only on a real dataset switch: on mount, querySql may carry a saved view /
  // Dive handoff, and openDataset already clears query state for the new file.
  const lastPathRef = useRef(filePath);
  useEffect(() => {
    if (lastPathRef.current === filePath) return;
    lastPathRef.current = filePath;
    setLocalSql(defaultSql);
    setQueryResult(null);
    setQueryError(null);
    setResultSort(null);
    setQuerySql("");
  }, [filePath, defaultSql, setQueryResult, setQueryError, setQuerySql]);
  // Handoffs (saved query views, Dive "Open in Query") reach an already-mounted editor.
  useEffect(() => {
    if (querySql) setLocalSql((cur) => (cur === querySql ? cur : querySql));
  }, [querySql]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(true);
  const [diffSnapshotId, setDiffSnapshotId] = useState<string | null>(null);
  const [queryStatusMessage, setQueryStatusMessage] = useState("");
  const [resultSort, setResultSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const validationId = "query-validation-hint";

  const sortedResultRows = useMemo(() => {
    if (!queryResult) return [];
    if (!resultSort) return queryResult.rows;
    const { col, dir } = resultSort;
    const mult = dir === "asc" ? 1 : -1;
    return [...queryResult.rows].sort((a, b) => compareExplorerCells(a[col], b[col], mult));
  }, [queryResult, resultSort]);

  const insertAtCursor = useCallback((text: string) => {
    setLocalSql((prev) => {
      const sep = prev.length && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return prev + sep + text;
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

  // Context-menu indices are positions in the displayed (sorted) rows.
  const copyCell = useCallback((rowIndex: number, colIndex: number) => {
    const row = sortedResultRows[rowIndex];
    if (!row || colIndex < 0 || colIndex >= row.length) return;
    const val = row[colIndex];
    const text = val === null || val === undefined ? "" : String(val);
    void navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, [sortedResultRows]);

  const copyRow = useCallback((rowIndex: number) => {
    const row = sortedResultRows[rowIndex];
    if (!row) return;
    const text = row.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t");
    void navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, [sortedResultRows]);

  const validation = useMemo(() => validateQuery(localSql), [localSql]);

  const handleExecute = useCallback(async () => {
    if (!selectedFile) return;
    if (!validation.valid) {
      setQueryError(validation.error ?? "Invalid query");
      setToast(validation.error ?? "Invalid query");
      return;
    }
    setIsQuerying(true);
    setQueryError(null);
    setQuerySql(localSql);
    try {
      const isStream = selectedFile.path === "stream://wiki";
      const sourceKind = sourceKindFromPath(selectedFile.path);
      const result = isStream
        ? await streamQuery(localSql, 10000)
        : sourceKind
          ? await sourceQuery(sourceKind, localSql, 10000)
          : await queryFile(selectedFile.path, localSql, 10000);
      setQueryResult(result);
      setResultSort(null);
      setQueryStatusMessage(
        result.rows.length === 0
          ? "Query finished: no rows returned"
          : `Query finished: ${result.rows.length.toLocaleString()} rows returned`,
      );
      appendQueryHistory(localSql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setQueryError(msg);
      setToast(msg);
      setQueryResult(null);
      setQueryStatusMessage(`Query failed: ${msg}`);
    } finally {
      setIsQuerying(false);
    }
  }, [selectedFile, localSql, validation.valid, validation.error, setIsQuerying, setQueryError, setQuerySql, setQueryResult, appendQueryHistory, setToast]);

  if (!selectedFile) {
    return (
      <StartHere
        detail={<>Once something is open, run SQL against the active table (usually <code className="text-loom-accent">loom_active</code>).</>}
      />
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {queryStatusMessage}
      </p>
      {/* Editor */}
      <div className="border-b border-loom-border bg-loom-surface/50 p-2.5 sm:p-3 space-y-2">
        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2 flex-wrap">
          <span className="text-xs text-loom-muted font-mono shrink-0">SQL</span>
          <span className="text-2xs text-loom-muted truncate min-w-0 max-w-[42vw] sm:max-w-none" title={`${activeTable} = ${selectedFile.name}`}>
            <code className="text-loom-accent">{activeTable}</code>
            <span className="hidden sm:inline"> = {selectedFile.name}</span>
          </span>
          <div className="flex-1 min-w-0" />
          {queryHistory.length > 0 && (
            <select
              className="loom-input text-2xs font-mono max-w-[140px] py-1"
              value=""
              onChange={(e) => {
                const sql = e.target.value;
                if (sql) setLocalSql(sql);
              }}
              title="Query history"
              aria-label="Query history"
            >
              <option value="">History</option>
              {queryHistory.slice(0, 15).map((item, i) => (
                <option key={`${item.at}-${i}`} value={item.sql}>
                  {item.sql.slice(0, 50)}{item.sql.length > 50 ? "…" : ""}
                </option>
              ))}
            </select>
          )}
          {querySnippets.length > 0 && (
            <select
              className="loom-input text-2xs font-mono max-w-[140px] py-1"
              value=""
              onChange={(e) => {
                const name = e.target.value;
                if (name) {
                  const sn = querySnippets.find((s) => s.name === name);
                  if (sn) setLocalSql(sn.sql);
                }
              }}
              title="Saved snippets"
              aria-label="Saved snippets"
            >
              <option value="">Snippets</option>
              {querySnippets.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          )}
          {selectedFile?.path === "stream://wiki" && (
            <select
              className="loom-input text-2xs font-mono max-w-[140px] py-1"
              value=""
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                if (!isNaN(idx) && STREAM_SQL_SNIPPETS[idx]) setLocalSql(STREAM_SQL_SNIPPETS[idx].sql);
              }}
              title="Pre-built stream queries"
              aria-label="Pre-built stream queries"
            >
              <option value="">Stream queries</option>
              {STREAM_SQL_SNIPPETS.map((s, i) => (
                <option key={s.name} value={i}>{s.name}</option>
              ))}
            </select>
          )}
          {(() => {
            const sk = sourceKindFromPath(selectedFile?.path) ?? undefined;
            const snippets = sk ? SOURCE_SQL_SNIPPETS[sk] : undefined;
            if (!snippets?.length) return null;
            return (
              <select
                className="loom-input text-2xs font-mono max-w-[140px] py-1"
                value=""
                onChange={(e) => {
                  const idx = parseInt(e.target.value, 10);
                  if (!isNaN(idx) && snippets[idx]) setLocalSql(snippets[idx].sql);
                }}
                title="Pre-built queries for this source"
                aria-label="Pre-built queries for this source"
              >
                <option value="">Source queries</option>
                {snippets.map((s, i) => (
                  <option key={s.name} value={i}>{s.name}</option>
                ))}
              </select>
            );
          })()}
          <button
            type="button"
            onClick={() => {
              setPromptDialog({
                title: "Snippet name",
                defaultValue: "",
                onConfirm: (name) => {
                  if (name?.trim()) addQuerySnippet(name.trim(), localSql);
                }
              });
            }}
            className="loom-btn-ghost text-2xs min-h-9 sm:min-h-0 py-1 px-2"
            title="Save current SQL as named snippet"
          >
            <span className="sm:hidden">Snippet</span>
            <span className="hidden sm:inline">Save snippet</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPromptDialog({
                title: "Name for this query view",
                defaultValue: "Query view",
                onConfirm: (name) => {
                  if (name != null && name.trim()) {
                    addQueryView(name.trim(), localSql);
                    setToast("Query view saved");
                  }
                }
              });
            }}
            className="loom-btn-ghost text-2xs min-h-9 sm:min-h-0 py-1 px-2"
            title="Save as view for dashboards"
          >
            <span className="sm:hidden">View</span>
            <span className="hidden sm:inline">Save view</span>
          </button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={isQuerying}
            className="loom-btn-primary text-xs min-h-9 sm:min-h-0 px-3"
            title="Run query (⌘/Ctrl + Enter)"
          >
            {isQuerying ? "Running..." : "Execute"}
            <span className="text-2xs opacity-60 ml-1 font-mono hidden sm:inline">&#x21B5;</span>
          </button>
        </div>
        {/* NL-to-SQL */}
        <div className="flex gap-1.5 items-center">
          <input
            type="text"
            value={nlQueryInput}
            onChange={(e) => setNlQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nlQueryInput.trim()) {
                const cols = (columnStats ?? []).map((c) => `${c.name} (${c.data_type})`).join(", ");
                const note = `-- NL request: ${nlQueryInput.trim()}\n-- Table: ${activeTable}\n-- Columns: ${cols.slice(0, 200)}${cols.length > 200 ? "…" : ""}\n-- (AI sidecar not connected — write SQL below)\n`;
                setLocalSql((prev) => (prev.trim() ? `${note}\n${prev}` : `${note}\nSELECT * FROM ${sqlIdent(activeTable)} LIMIT 100`));
                setToast("Added your plain-English note above the SQL (existing query kept)");
                setNlQueryInput("");
              }
            }}
            placeholder="Ask in plain English... (press Enter)"
            aria-label="Describe a query in plain English"
            className="loom-input flex-1 min-w-0 text-2xs py-1 px-2 font-mono"
          />
          {queryResult && (
            <button
              type="button"
              onClick={() => { addQuerySnapshot(`Snap ${querySnapshots.length + 1}`, queryResult.columns, queryResult.rows); setToast("Snapshot saved"); }}
              className="loom-btn-ghost text-2xs py-0.5 px-1.5 shrink-0"
              title="Save result as snapshot for diffing"
            >
              Snapshot
            </button>
          )}
          {querySnapshots.length > 0 && (
            <select
              className="loom-input text-2xs py-0.5 max-w-[100px]"
              aria-label="Compare results with a snapshot"
              title="Compare results with a snapshot"
              value={diffSnapshotId ?? ""}
              onChange={(e) => setDiffSnapshotId(e.target.value || null)}
            >
              <option value="">Diff...</option>
              {querySnapshots.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <SqlEditor
              value={localSql}
              onChange={setLocalSql}
              onRun={handleExecute}
              activeTable={activeTable}
              columnStats={columnStats ?? []}
              placeholder={`SELECT * FROM ${activeTable} WHERE ...`}
              describedBy={!validation.valid && validation.error ? validationId : undefined}
            />
            {!validation.valid && validation.error && (
              <p id={validationId} className="text-2xs text-loom-warning-text mt-1 font-mono" role="status">
                {validation.error}
              </p>
            )}
          </div>
          {(columnStats?.length ?? 0) > 0 && (
            <div className="hidden sm:block w-44 flex-shrink-0 border border-loom-border rounded overflow-hidden bg-loom-elevated/50">
              <button
                type="button"
                onClick={() => setSchemaOpen((o) => !o)}
                aria-expanded={schemaOpen}
                className="w-full px-2 py-1 text-left text-2xs font-semibold text-loom-text bg-loom-elevated/80 border-b border-loom-border"
              >
                Schema <span aria-hidden>{schemaOpen ? "▼" : "▶"}</span>
              </button>
              {schemaOpen && (
                <div className="max-h-48 overflow-y-auto py-1">
                  <p className="px-2 py-0.5 text-2xs text-loom-muted font-semibold">Tables</p>
                  <button type="button" onClick={() => insertAtCursor(activeTable)} className="w-full px-2 py-0.5 text-left text-2xs font-mono text-loom-accent hover:bg-loom-accent/20 block">
                    {activeTable}
                  </button>
                  <p className="px-2 py-0.5 text-2xs text-loom-muted font-semibold mt-1">Columns</p>
                  {columnStats.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => insertAtCursor(sqlIdent(col.name))}
                      className="w-full px-2 py-0.5 text-left text-2xs font-mono text-loom-text hover:bg-loom-accent/20 truncate"
                      title={`${col.name} (${col.data_type})`}
                    >
                      {col.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {queryError && (
        <div className="px-4 py-2 bg-loom-error/10 border-b border-loom-error/30">
          <p className="text-xs font-mono text-loom-error whitespace-pre-wrap break-words" role="alert">{queryError}</p>
        </div>
      )}

      {/* Results Grid */}
      <div className="flex-1 overflow-auto relative">
        {contextMenu && (
          <div
            className="loom-menu fixed z-50 min-w-[120px] py-1 rounded text-xs"
            style={{
              // Keep the menu on-screen near the right / bottom edges
              left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - 136)),
              top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 72)),
            }}
            role="menu"
            aria-label="Result cell actions"
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
        {isQuerying ? (
          <QueryResultsSkeleton rows={8} cols={queryResult?.columns.length ?? 4} />
        ) : queryResult && queryResult.rows.length > 0 ? (
          <>
            <div className="loom-data-chrome sticky max-md:static top-0 z-20 bg-loom-bg border-b border-loom-border">
            <div className="flex items-center gap-2 px-3 py-1 flex-wrap">
              <span className="text-2xs text-loom-muted font-mono">
                {queryResult.rows.length < queryResult.total_rows
                  ? `First ${queryResult.rows.length.toLocaleString()} of ${queryResult.total_rows.toLocaleString()} rows (10k cap)`
                  : `${queryResult.total_rows.toLocaleString()} rows`}
                {" "}&middot; {queryResult.columns.length} cols
              </span>
              {sortedResultRows.length > queryResultPageSize && (
                <span className="text-2xs text-loom-muted font-mono flex items-center gap-1">
                  Page
                  <button type="button" onClick={() => setQueryResultPage(queryResultPage - 1)} disabled={queryResultPage <= 0} aria-label="Previous page" className="loom-btn-ghost px-1 py-0 max-md:min-w-9 disabled:opacity-50">←</button>
                  <span>{queryResultPage + 1} of {Math.ceil(sortedResultRows.length / queryResultPageSize)}</span>
                  <button type="button" onClick={() => setQueryResultPage(queryResultPage + 1)} disabled={queryResultPage >= Math.ceil(sortedResultRows.length / queryResultPageSize) - 1} aria-label="Next page" className="loom-btn-ghost px-1 py-0 max-md:min-w-9 disabled:opacity-50">→</button>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  const csv = queryResultToCsv(queryResult);
                  downloadCsv(csv, selectedFile ? `query-${selectedFile.name.replace(/\.[^.]+$/, "")}` : "query-results");
                }}
                className="loom-btn-ghost text-2xs px-2 py-0.5 max-md:min-h-9 max-md:px-3 border border-loom-border rounded ml-2"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!queryResult) return;
                  applyQueryResult(queryResult, selectedFile.name);
                  setToast(`Using query results for ${viewModeName("chart")} and ${viewModeName("explorer")}`);
                  useLoomStore.getState().setViewMode("chart");
                }}
                className="text-2xs px-2 py-0.5 max-md:min-h-9 max-md:px-3 rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent font-medium"
              >
                Chart this →
              </button>
              {diffSnapshotId && (() => {
                const snap = querySnapshots.find((s) => s.id === diffSnapshotId);
                if (!snap) return null;
                const added = queryResult.rows.length - snap.rows.length;
                const colsDiff = queryResult.columns.length !== snap.columns.length;
                return (
                  <span className="text-2xs font-mono ml-2">
                    Diff vs <strong>{snap.name}</strong>:
                    <span className={added > 0 ? "text-loom-success ml-1" : added < 0 ? "text-loom-error ml-1" : "text-loom-muted ml-1"}>
                      {added > 0 ? `+${added}` : added} rows
                    </span>
                    {colsDiff && <span className="text-loom-warning-text ml-1">cols changed</span>}
                  </span>
                );
              })()}
            </div>
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr>
                  {queryResult.columns.map((col, ci) => (
                    <th
                      key={`${col}-${ci}`}
                      className="loom-data-chrome px-3 py-2 text-left text-2xs font-semibold text-loom-muted uppercase tracking-wider whitespace-nowrap bg-loom-bg border-b border-loom-border"
                    >
                      <button
                        type="button"
                        className="hover:text-loom-text uppercase tracking-wider"
                        onClick={() =>
                          setResultSort((prev) =>
                            prev?.col === ci
                              ? { col: ci, dir: prev.dir === "asc" ? "desc" : "asc" }
                              : { col: ci, dir: "asc" },
                          )
                        }
                      >
                        {col}
                        {resultSort?.col === ci ? (resultSort.dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
            </div>
            <table className="w-full text-xs font-mono border-collapse">
              <tbody>
                {sortedResultRows.slice(queryResultPage * queryResultPageSize, (queryResultPage + 1) * queryResultPageSize).map((row, ri) => {
                  const absoluteRi = queryResultPage * queryResultPageSize + ri;
                  return (
                    <tr key={absoluteRi} className="border-b border-loom-border/30 hover:bg-loom-elevated/40">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-1.5 text-loom-text whitespace-nowrap max-w-[320px] truncate"
                          title={typeof cell === "string" && cell.length > 40 ? cell : undefined}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: absoluteRi, colIndex: ci });
                          }}
                        >
                          {cell === null ? (
                            <span className="text-loom-muted/60 italic">null</span>
                          ) : typeof cell === "number" ? (
                            <span className="text-loom-accent">{formatExplorerNumber(cell)}</span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : queryResult && !queryError ? (
          <div className="flex flex-col items-center justify-center gap-1 h-full px-4 text-center">
            <p className="text-sm text-loom-text">No rows returned</p>
            {queryResult.columns.length > 0 && (
              <p className="text-2xs text-loom-muted font-mono max-w-full truncate" title={queryResult.columns.join(", ")}>
                Columns: {queryResult.columns.join(", ")}
              </p>
            )}
          </div>
        ) : !queryError ? (
          <div className="flex flex-col items-center justify-center gap-1 h-full px-4 text-center">
            <p className="text-sm text-loom-muted">Run a query to see results</p>
            <p className="text-2xs text-loom-muted">Press Execute or ⌘/Ctrl + Enter in the editor</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
