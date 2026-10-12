/**
 * LOOM-552 — table slice (prefs, filters, undo/redo, saved views).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useLoomStore } from "../store";
import { TABLE_UNDO_LIMIT, TABLE_VIEW_LIMIT } from "../store/tableSlice";

const get = () => useLoomStore.getState();

beforeEach(() => get().reset());

describe("tableSlice", () => {
  it("sets and clears single column filters (trimmed; empty removes)", () => {
    get().setTableColumnFilter("region", "  East ");
    expect(get().tableColumnFilters).toEqual({ region: "East" });
    get().setTableColumnFilter("region", "   ");
    expect(get().tableColumnFilters).toEqual({});
  });

  it("setTableColumnFilters pushes undo only when filters actually change", () => {
    get().setTableColumnFilters({ a: "1" });
    expect(get().tableUndoStack).toHaveLength(1);
    get().setTableColumnFilters({ a: "1" });
    expect(get().tableUndoStack).toHaveLength(1);
  });

  it("undo / redo restores prefs and filters", () => {
    get().setTablePrefs({ visibleColumns: ["a"], columnOrder: ["a", "b"] });
    get().setTableColumnFilters({ a: "x" });
    get().setTablePrefs({ visibleColumns: ["b"], columnOrder: null });
    get().pushTableUndo();
    get().setTableColumnFilters({ a: "y" });
    get().undoTable();
    expect(get().tableColumnFilters).toEqual({ a: "x" });
    expect(get().tableRedoStack).toHaveLength(1);
    get().redoTable();
    expect(get().tableColumnFilters).toEqual({ a: "y" });
  });

  it("undo/redo are no-ops on empty stacks and stacks are capped", () => {
    const before = get().tablePrefs;
    get().undoTable();
    get().redoTable();
    expect(get().tablePrefs).toBe(before);
    for (let i = 0; i < TABLE_UNDO_LIMIT + 5; i += 1) get().pushTableUndo();
    expect(get().tableUndoStack).toHaveLength(TABLE_UNDO_LIMIT);
  });

  it("selectedRowIndices accepts a value or an updater", () => {
    get().setSelectedRowIndices([1, 2]);
    get().setSelectedRowIndices((prev) => [...prev, 3]);
    expect(get().selectedRowIndices).toEqual([1, 2, 3]);
  });

  it("saves, caps, applies and removes table views", () => {
    get().addTableView("First", ["a"], ["a", "b"], { a: "1" }, "select 1");
    const id = get().tableViews[0]!.id;
    expect(get().tableViews[0]!.name).toBe("First");
    get().setTableColumnFilters({});
    get().applyTableView(id);
    expect(get().tableColumnFilters).toEqual({ a: "1" });
    expect(get().tablePrefs.visibleColumns).toEqual(["a"]);
    expect(get().querySql).toBe("select 1");
    expect(get().viewMode).toBe("explorer");
    get().removeTableView(id);
    expect(get().tableViews).toHaveLength(0);
    get().applyTableView("missing");
    for (let i = 0; i < TABLE_VIEW_LIMIT + 3; i += 1) get().addTableView(`v${i}`, null, null, {});
    expect(get().tableViews).toHaveLength(TABLE_VIEW_LIMIT);
    expect(get().tableViews[0]!.name).toBe(`v${TABLE_VIEW_LIMIT + 2}`);
  });

  it("applyTableView with a snapshot rebuilds column stats", () => {
    get().addTableView("snap", null, null, {}, null, {
      columns: ["x", "y"],
      types: ["DOUBLE"],
      rows: [[1, 2]],
      total_rows: 1,
    });
    get().applyTableView(get().tableViews[0]!.id);
    expect(get().sampleRows?.columns).toEqual(["x", "y"]);
    expect(get().columnStats.map((c) => [c.name, c.data_type])).toEqual([
      ["x", "DOUBLE"],
      ["y", "VARCHAR"],
    ]);
  });
});
