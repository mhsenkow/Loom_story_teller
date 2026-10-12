// =================================================================
// queryLibrarySlice — Query tab history + saved snippets (LOOM-552)
// =================================================================
// First LoomState slice carved out of store.ts. Composed into `useLoomStore`
// via `createQueryLibrarySlice`; persisted by HydrateStore like before.
// =================================================================

import type { StateCreator } from "zustand";
import type { LoomState } from "./types";

export const QUERY_HISTORY_LIMIT = 50;
export const QUERY_SNIPPET_LIMIT = 30;

export type QueryLibrarySlice = Pick<
  LoomState,
  "setQueryHistory" | "appendQueryHistory" | "setQuerySnippets" | "addQuerySnippet"
>;

export const createQueryLibrarySlice: StateCreator<LoomState, [], [], QueryLibrarySlice> = (set) => ({
  setQueryHistory: (h) => set({ queryHistory: h }),
  appendQueryHistory: (sql) =>
    set((s) => {
      const t = sql.trim();
      if (!t) return s;
      const list = s.queryHistory.filter((q) => q.sql !== t);
      list.unshift({ sql: t, at: Date.now() });
      return { queryHistory: list.slice(0, QUERY_HISTORY_LIMIT) };
    }),
  setQuerySnippets: (s) => set({ querySnippets: s.slice(0, QUERY_SNIPPET_LIMIT) }),
  addQuerySnippet: (name, sql) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed) return s;
      const list = s.querySnippets.filter((x) => x.name !== trimmed);
      list.unshift({ name: trimmed, sql: sql.trim() });
      return { querySnippets: list.slice(0, QUERY_SNIPPET_LIMIT) };
    }),
});
