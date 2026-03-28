// =================================================================
// QueryView — SQL Editor + Results
// =================================================================
// A SQL query editor that executes against the selected file
// via DuckDB on the Rust side. Results render in a data grid.
// =================================================================

"use client";

import { useLoomStore } from "@/lib/store";
import { queryFile, streamQuery } from "@/lib/tauri";
import { recommend, STREAM_SQL_SNIPPETS } from "@/lib/recommendations";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { QueryResultsSkeleton } from "@/components/Skeleton";
import { validateQuery } from "@/lib/queryValidate";

export function QueryView() {
  const {
    selectedFile, querySql, setQuerySql,
    queryResult, setQueryResult, queryError, setQueryError,
    isQuerying, setIsQuerying,
    setSampleRows, setColumnStats, setChartRecs, setActiveChart,
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
  const [localSql, setLocalSql] = useState(
    querySql || (isStream ? "SELECT * FROM wiki_stream ORDER BY ts DESC LIMIT 100" : "SELECT * FROM loom_active LIMIT 100")
  );
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(true);
  const [diffSnapshotId, setDiffSnapshotId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = localSql.slice(0, start);
    const after = localSql.slice(end);
    setLocalSql(before + text + after);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }, [localSql]);

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

  const copyCell = useCallback((rowIndex: number, colIndex: number) => {
    if (!queryResult) return;
    const row = queryResult.rows[rowIndex];
    if (!row || colIndex < 0 || colIndex >= row.length) return;
    const val = row[colIndex];
    const text = val === null || val === undefined ? "" : String(val);
    void navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, [queryResult]);

  const copyRow = useCallback((rowIndex: number) => {
    if (!queryResult) return;
    const row = queryResult.rows[rowIndex];
    if (!row) return;
    const text = row.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t");
    void navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, [queryResult]);

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
      const result = isStream
        ? await streamQuery(localSql, 10000)
        : await queryFile(selectedFile.path, localSql, 10000);
      setQueryResult(result);
      appendQueryHistory(localSql);
      // Sync chart + preview to query result so the chart reflects the query
      const columns = result?.columns ?? [];
      const types = result?.types ?? [];
      if (columns.length > 0) {
        setSampleRows(result);
        const stats = columns.map((name, i) => ({
          name,
          data_type: types[i] ?? "VARCHAR",
          null_count: 0,
          distinct_count: 0,
          min_value: null as string | null,
          max_value: null as string | null,
        }));
        setColumnStats(stats);
        try {
          const recs = recommend(stats, result, selectedFile.name);
          setChartRecs(recs);
          setActiveChart(recs.length > 0 ? recs[0] : null);
        } catch (_) {
          setChartRecs([]);
          setActiveChart(null);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setQueryError(msg);
      setToast(msg);
      setQueryResult(null);
    } finally {
      setIsQuerying(false);
    }
  }, [selectedFile, localSql, setIsQuerying, setQueryError, setQuerySql, setQueryResult, setSampleRows, setColumnStats, setChartRecs, setActiveChart, appendQueryHistory]);

  if (!selectedFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
        <div className="w-16 h-16 rounded-xl bg-loom-elevated border border-loom-border flex items-center justify-center text-loom-muted">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4 4h16v4l-6 6 4 4-2 2-4-4-6-6v-4z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-loom-text">No file selected</p>
        <p className="text-xs text-loom-muted text-center max-w-sm">Select a file from the sidebar, then run SQL against <code className="text-loom-accent">loom_active</code>.</p>
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
          {queryHistory.length > 0 && (
            <select
              className="loom-input text-2xs font-mono max-w-[140px] py-1"
              value=""
              onChange={(e) => {
                const sql = e.target.value;
                if (sql) setLocalSql(sql);
              }}
              title="Query history"
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
            >
              <option value="">Stream queries</option>
              {STREAM_SQL_SNIPPETS.map((s, i) => (
                <option key={s.name} value={i}>{s.name}</option>
              ))}
            </select>
          )}
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
            className="loom-btn-ghost text-2xs py-1 px-2"
            title="Save current SQL as named snippet"
          >
            Save snippet
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
            className="loom-btn-ghost text-2xs py-1 px-2"
            title="Save as view for dashboards"
          >
            Save view
          </button>
          <button
            onClick={handleExecute}
            disabled={isQuerying}
            className="loom-btn-primary text-xs"
          >
            {isQuerying ? "Running..." : "Execute"}
            <span className="text-2xs opacity-60 ml-1 font-mono">&#x21B5;</span>
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
                const prompt = `Table: loom_active\nColumns: ${cols}\n\nGenerate a DuckDB SQL query for: ${nlQueryInput.trim()}\nReturn only the SQL, no explanation.`;
                setLocalSql(`-- AI prompt: ${nlQueryInput.trim()}\n-- Columns: ${cols.slice(0, 120)}...\nSELECT * FROM loom_active LIMIT 100`);
                setToast("NL-to-SQL: Edit the generated query above (AI sidecar required for full generation)");
                setNlQueryInput("");
              }
            }}
            placeholder="Ask in plain English... (press Enter)"
            className="loom-input flex-1 text-2xs py-1 px-2 font-mono"
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
            <textarea
              ref={textareaRef}
              value={localSql}
              onChange={(e) => setLocalSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleExecute();
                }
              }}
              className="loom-input font-mono text-xs h-24 w-full resize-none"
              placeholder="SELECT * FROM loom_active WHERE ..."
              spellCheck={false}
            />
            {!validation.valid && validation.error && (
              <p className="text-2xs text-amber-500 mt-1 font-mono">{validation.error}</p>
            )}
          </div>
          {(columnStats?.length ?? 0) > 0 && (
            <div className="w-44 flex-shrink-0 border border-loom-border rounded overflow-hidden bg-loom-elevated/50">
              <button
                type="button"
                onClick={() => setSchemaOpen((o) => !o)}
                className="w-full px-2 py-1 text-left text-2xs font-semibold text-loom-text bg-loom-elevated/80 border-b border-loom-border"
              >
                Schema {schemaOpen ? "▼" : "▶"}
              </button>
              {schemaOpen && (
                <div className="max-h-48 overflow-y-auto py-1">
                  <p className="px-2 py-0.5 text-2xs text-loom-muted font-semibold">Tables</p>
                  <button type="button" onClick={() => insertAtCursor("loom_active")} className="w-full px-2 py-0.5 text-left text-2xs font-mono text-loom-accent hover:bg-loom-accent/20 block">
                    loom_active
                  </button>
                  <p className="px-2 py-0.5 text-2xs text-loom-muted font-semibold mt-1">Columns</p>
                  {columnStats.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => insertAtCursor(col.name)}
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
          <p className="text-xs font-mono text-loom-error">{queryError}</p>
        </div>
      )}

      {/* Results Grid */}
      <div className="flex-1 overflow-auto relative">
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[120px] py-1 bg-loom-surface border border-loom-border rounded shadow-lg text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-loom-text hover:bg-loom-elevated"
              onClick={() => copyCell(contextMenu.rowIndex, contextMenu.colIndex)}
            >
              Copy cell
            </button>
            <button
              type="button"
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
            <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1 bg-loom-bg border-b border-loom-border flex-wrap">
              <span className="text-2xs text-loom-muted font-mono">
                {queryResult.total_rows} rows &middot; {queryResult.columns.length} cols
              </span>
              {queryResult.rows.length > queryResultPageSize && (
                <span className="text-2xs text-loom-muted font-mono flex items-center gap-1">
                  Page
                  <button type="button" onClick={() => setQueryResultPage(queryResultPage - 1)} disabled={queryResultPage <= 0} className="loom-btn-ghost px-1 py-0 disabled:opacity-50">←</button>
                  <span>{queryResultPage + 1} of {Math.ceil(queryResult.rows.length / queryResultPageSize)}</span>
                  <button type="button" onClick={() => setQueryResultPage(queryResultPage + 1)} disabled={queryResultPage >= Math.ceil(queryResult.rows.length / queryResultPageSize) - 1} className="loom-btn-ghost px-1 py-0 disabled:opacity-50">→</button>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  const csv = queryResultToCsv(queryResult);
                  downloadCsv(csv, selectedFile ? `query-${selectedFile.name.replace(/\.[^.]+$/, "")}` : "query-results");
                }}
                className="loom-btn-ghost text-2xs px-2 py-0.5 border border-loom-border rounded ml-2"
              >
                Export CSV
              </button>
              {diffSnapshotId && (() => {
                const snap = querySnapshots.find((s) => s.id === diffSnapshotId);
                if (!snap) return null;
                const added = queryResult.rows.length - snap.rows.length;
                const colsDiff = queryResult.columns.length !== snap.columns.length;
                return (
                  <span className="text-2xs font-mono ml-2">
                    Diff vs <strong>{snap.name}</strong>:
                    <span className={added > 0 ? "text-green-500 ml-1" : added < 0 ? "text-red-500 ml-1" : "text-loom-muted ml-1"}>
                      {added > 0 ? `+${added}` : added} rows
                    </span>
                    {colsDiff && <span className="text-amber-500 ml-1">cols changed</span>}
                  </span>
                );
              })()}
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
                {queryResult.rows.slice(queryResultPage * queryResultPageSize, (queryResultPage + 1) * queryResultPageSize).map((row, ri) => {
                  const absoluteRi = queryResultPage * queryResultPageSize + ri;
                  return (
                    <tr key={absoluteRi} className="border-b border-loom-border/30 hover:bg-loom-elevated/40">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-1.5 text-loom-text whitespace-nowrap"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: absoluteRi, colIndex: ci });
                          }}
                        >
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
                  );
                })}
              </tbody>
            </table>
          </>
        ) : !queryError && !isQuerying ? (
          <div className="flex items-center justify-center h-full text-sm text-loom-muted">
            Run a query to see results
          </div>
        ) : null}
      </div>
    </div>
  );
}
