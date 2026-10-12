// =================================================================
// querySlice — SQL query state, history, snippets, snapshots, views
// =================================================================

import type { LoomState, QueryViewItem, ViewMode } from "./types";
import type { QueryResult } from "../queryTypes";
import { newLoomId } from "../loomId";

export function queryInitialState() {
  return {
    querySql: "",
    queryResult: null as QueryResult | null,
    queryError: null as string | null,
    isQuerying: false,
    queryResultPage: 0,
    queryResultPageSize: 500,
    querySnapshots: [] as LoomState["querySnapshots"],
    queryViews: [] as QueryViewItem[],
    nlQueryInput: "",
    queryHistory: [] as { sql: string; at: number }[],
    querySnippets: [] as { name: string; sql: string }[],
  };
}

type Setter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;

export function createQuerySlice(set: Setter) {
  return {
    setQuerySql: (sql: string) => set({ querySql: sql }),
    setQueryResult: (result: QueryResult | null) => set({ queryResult: result, queryResultPage: 0 }),
    setQueryError: (error: string | null) => set({ queryError: error }),
    setIsQuerying: (v: boolean) => set({ isQuerying: v }),
    setQueryResultPage: (page: number) => set({ queryResultPage: Math.max(0, page) }),
    setQueryResultPageSize: (size: number) => set({ queryResultPageSize: Math.max(100, Math.min(5000, size)) }),
    addQuerySnapshot: (name: string, columns: string[], rows: (string | number | boolean | null)[][]) =>
      set((s) => ({
        querySnapshots: [{ id: newLoomId("snap-"), name, columns, rows, at: Date.now() }, ...s.querySnapshots.slice(0, 9)],
      })),
    removeQuerySnapshot: (id: string) => set((s) => ({ querySnapshots: s.querySnapshots.filter((x) => x.id !== id) })),
    setNlQueryInput: (v: string) => set({ nlQueryInput: v }),
    setQueryHistory: (h: { sql: string; at: number }[]) => set({ queryHistory: h }),
    appendQueryHistory: (sql: string) =>
      set((s) => {
        const t = sql.trim();
        if (!t) return s;
        const list = s.queryHistory.filter((q) => q.sql !== t);
        list.unshift({ sql: t, at: Date.now() });
        return { queryHistory: list.slice(0, 50) };
      }),
    setQuerySnippets: (s_arg: { name: string; sql: string }[]) => set({ querySnippets: s_arg.slice(0, 30) }),
    addQuerySnippet: (name: string, sql: string) =>
      set((s) => {
        const trimmed = name.trim();
        if (!trimmed) return s;
        const list = s.querySnippets.filter((x) => x.name !== trimmed);
        list.unshift({ name: trimmed, sql: sql.trim() });
        return { querySnippets: list.slice(0, 30) };
      }),
    setQueryViews: (views: QueryViewItem[]) => set({ queryViews: views.slice(0, 30) }),
    addQueryView: (name: string, sql: string) =>
      set((s) => ({
        queryViews: [{ id: newLoomId("qv-"), name: name.trim() || "Query view", sql: sql.trim() }, ...s.queryViews.slice(0, 29)],
      })),
    removeQueryView: (id: string) => set((s) => ({ queryViews: s.queryViews.filter((v) => v.id !== id) })),
    applyQueryView: (id: string) =>
      set((s) => {
        const v = s.queryViews.find((x) => x.id === id);
        if (!v) return s;
        return { querySql: v.sql, viewMode: "query" as ViewMode };
      }),
    applyQuerySnapshot: (id: string) =>
      set((s) => {
        const snap = s.querySnapshots.find((x) => x.id === id);
        if (!snap) return s;
        return {
          sampleRows: { columns: snap.columns, types: snap.columns.map(() => "VARCHAR"), rows: snap.rows, total_rows: snap.rows.length },
          columnStats: snap.columns.map((c) => ({ name: c, data_type: "VARCHAR", null_count: 0, distinct_count: 0, min_value: null, max_value: null })),
          viewMode: "explorer" as ViewMode,
        };
      }),
  };
}
