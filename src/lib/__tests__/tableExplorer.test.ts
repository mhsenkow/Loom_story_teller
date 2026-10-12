import { describe, it, expect } from "vitest";
import {
  applyVisibleColumnOrder,
  cellMatchesExplorerNumericFilter,
  formatExplorerColumnNumber,
  formatExplorerNumber,
  numericMinMaxForColumn,
  parseExplorerNumericFilter,
  remapSelectedRowIndices,
} from "../tableExplorer";

describe("formatExplorerNumber", () => {
  it("shows small decimals instead of 0", () => {
    expect(formatExplorerNumber(0.00012)).toBe("0.00012");
    expect(formatExplorerNumber(0.0000001)).toBe("0.0000001");
  });
});

describe("parseExplorerNumericFilter", () => {
  it("parses equality and ranges including negatives", () => {
    expect(parseExplorerNumericFilter("-5")).toEqual({ kind: "eq", value: -5 });
    expect(parseExplorerNumericFilter("-10..-2")).toEqual({ kind: "range", min: -10, max: -2 });
    expect(parseExplorerNumericFilter("5-10")).toEqual({ kind: "range", min: 5, max: 10 });
  });

  it("matches cells", () => {
    const eq = parseExplorerNumericFilter("-5")!;
    expect(cellMatchesExplorerNumericFilter(-5, eq)).toBe(true);
    expect(cellMatchesExplorerNumericFilter(-4, eq)).toBe(false);
    const range = parseExplorerNumericFilter("-10..-2")!;
    expect(cellMatchesExplorerNumericFilter(-5, range)).toBe(true);
    expect(cellMatchesExplorerNumericFilter(-11, range)).toBe(false);
  });
});

describe("applyVisibleColumnOrder", () => {
  it("keeps custom order when a column is hidden", () => {
    const all = ["a", "b", "c", "d"];
    const order = applyVisibleColumnOrder(all, ["a", "c", "d"], ["d", "a", "c"]);
    expect(order).toEqual(["d", "a", "c"]);
  });
});

describe("numericMinMaxForColumn", () => {
  it("reads the named column after reorder", () => {
    const all = ["x", "y"];
    const rows = [
      [1, 10],
      [2, 20],
    ];
    const stats = numericMinMaxForColumn(rows, "y", all);
    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(20);
  });
});

describe("remapSelectedRowIndices", () => {
  it("keeps selection when live rows refresh with the same keys", () => {
    const cols = ["id", "val"];
    const prevRows = [
      [1, "a"],
      [2, "b"],
    ];
    const nextRows = [
      [9, "z"],
      [1, "a"],
      [2, "b"],
    ];
    expect(remapSelectedRowIndices(cols, prevRows, [0, 1], cols, nextRows)).toEqual([1, 2]);
  });
});

describe("formatExplorerColumnNumber", () => {
  it("does not group-separate year-like columns", () => {
    expect(formatExplorerColumnNumber("year", 2024, true)).toBe("2024");
  });
});
