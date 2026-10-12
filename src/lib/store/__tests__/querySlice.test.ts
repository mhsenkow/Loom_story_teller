// =================================================================
// querySlice tests
// =================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../../store";

function getState() { return useLoomStore.getState(); }

beforeEach(() => { getState().reset(); });

describe("querySlice", () => {
  it("appendQueryHistory deduplicates", () => {
    getState().appendQueryHistory("SELECT 1");
    getState().appendQueryHistory("SELECT 2");
    getState().appendQueryHistory("SELECT 1");
    expect(getState().queryHistory).toHaveLength(2);
    expect(getState().queryHistory[0]!.sql).toBe("SELECT 1");
  });

  it("appendQueryHistory caps at 50", () => {
    for (let i = 0; i < 55; i++) getState().appendQueryHistory(`SELECT ${i}`);
    expect(getState().queryHistory.length).toBeLessThanOrEqual(50);
  });

  it("addQuerySnippet deduplicates by name", () => {
    getState().addQuerySnippet("demo", "SELECT 1");
    getState().addQuerySnippet("demo", "SELECT 2");
    expect(getState().querySnippets).toHaveLength(1);
    expect(getState().querySnippets[0]!.sql).toBe("SELECT 2");
  });

  it("setQueryResult resets page to 0", () => {
    getState().setQueryResultPage(3);
    getState().setQueryResult({ columns: ["a"], types: ["INT"], rows: [[1]], total_rows: 1 });
    expect(getState().queryResultPage).toBe(0);
  });

  it("addQueryView / removeQueryView lifecycle", () => {
    getState().addQueryView("Q1", "SELECT 1");
    expect(getState().queryViews).toHaveLength(1);
    const id = getState().queryViews[0]!.id;
    getState().removeQueryView(id);
    expect(getState().queryViews).toHaveLength(0);
  });

  it("applyQueryView sets sql and viewMode", () => {
    getState().addQueryView("Q1", "SELECT 42");
    const id = getState().queryViews[0]!.id;
    getState().applyQueryView(id);
    expect(getState().querySql).toBe("SELECT 42");
    expect(getState().viewMode).toBe("query");
  });
});
