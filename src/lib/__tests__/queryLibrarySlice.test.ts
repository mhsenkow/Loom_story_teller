/**
 * LOOM-552 — query library slice (history + saved snippets).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useLoomStore } from "../store";
import { QUERY_HISTORY_LIMIT, QUERY_SNIPPET_LIMIT } from "../store/queryLibrarySlice";

const get = () => useLoomStore.getState();

beforeEach(() => get().reset());

describe("queryLibrarySlice", () => {
  it("appendQueryHistory trims, dedupes (most recent first) and ignores blanks", () => {
    get().appendQueryHistory("  select 1  ");
    get().appendQueryHistory("select 2");
    get().appendQueryHistory("select 1");
    get().appendQueryHistory("   ");
    expect(get().queryHistory.map((q) => q.sql)).toEqual(["select 1", "select 2"]);
  });

  it("caps history and snippets", () => {
    for (let i = 0; i < QUERY_HISTORY_LIMIT + 5; i += 1) get().appendQueryHistory(`select ${i}`);
    expect(get().queryHistory).toHaveLength(QUERY_HISTORY_LIMIT);
    expect(get().queryHistory[0]!.sql).toBe(`select ${QUERY_HISTORY_LIMIT + 4}`);

    for (let i = 0; i < QUERY_SNIPPET_LIMIT + 5; i += 1) get().addQuerySnippet(`s${i}`, "select 1");
    expect(get().querySnippets).toHaveLength(QUERY_SNIPPET_LIMIT);
    get().setQuerySnippets(Array.from({ length: 80 }, (_, i) => ({ name: `n${i}`, sql: "x" })));
    expect(get().querySnippets).toHaveLength(QUERY_SNIPPET_LIMIT);
  });

  it("addQuerySnippet replaces a same-named snippet and ignores blank names", () => {
    get().addQuerySnippet("top", " select 1 ");
    get().addQuerySnippet("top", "select 2");
    get().addQuerySnippet("  ", "select 3");
    expect(get().querySnippets).toEqual([{ name: "top", sql: "select 2" }]);
  });

  it("setQueryHistory replaces the list verbatim (hydration)", () => {
    get().setQueryHistory([{ sql: "a", at: 1 }]);
    expect(get().queryHistory).toEqual([{ sql: "a", at: 1 }]);
  });
});
