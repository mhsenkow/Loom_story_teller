// =================================================================
// tableSlice tests
// =================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../index";

function getState() { return useLoomStore.getState(); }

beforeEach(() => { getState().reset(); });

describe("tableSlice", () => {
  it("setTablePrefs updates prefs", () => {
    getState().setTablePrefs({ visibleColumns: ["a"], columnOrder: ["a", "b"] });
    expect(getState().tablePrefs.visibleColumns).toEqual(["a"]);
  });

  it("pushTableUndo + undoTable round-trips", () => {
    getState().setTablePrefs({ visibleColumns: ["a"], columnOrder: ["a"] });
    getState().pushTableUndo();
    getState().setTablePrefs({ visibleColumns: ["b"], columnOrder: ["b"] });
    getState().undoTable();
    expect(getState().tablePrefs.visibleColumns).toEqual(["a"]);
  });

  it("redoTable after undoTable restores", () => {
    getState().setTablePrefs({ visibleColumns: ["a"], columnOrder: null });
    getState().pushTableUndo();
    getState().setTablePrefs({ visibleColumns: ["b"], columnOrder: null });
    getState().undoTable();
    getState().redoTable();
    expect(getState().tablePrefs.visibleColumns).toEqual(["b"]);
  });

  it("setTableColumnFilter adds and removes", () => {
    getState().setTableColumnFilter("col", "val");
    expect(getState().tableColumnFilters.col).toBe("val");
    getState().setTableColumnFilter("col", "");
    expect(getState().tableColumnFilters.col).toBeUndefined();
  });

  it("addTableView / removeTableView lifecycle", () => {
    getState().addTableView("V1", ["a"], null, {});
    expect(getState().tableViews).toHaveLength(1);
    const id = getState().tableViews[0]!.id;
    getState().removeTableView(id);
    expect(getState().tableViews).toHaveLength(0);
  });

  it("applyTableView restores columns and filters", () => {
    getState().addTableView("V1", ["a"], ["a", "b"], { a: "1" });
    const id = getState().tableViews[0]!.id;
    getState().applyTableView(id);
    expect(getState().tablePrefs.visibleColumns).toEqual(["a"]);
    expect(getState().tableColumnFilters).toEqual({ a: "1" });
  });
});
