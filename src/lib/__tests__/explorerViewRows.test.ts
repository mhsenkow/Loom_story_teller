import { describe, expect, it } from "vitest";
import { applyExplorerViewToRows, explorerFiltersActive } from "../explorerViewRows";

const columns = ["site", "cfs"];
const rows = [
  ["A", 10],
  ["B", 50],
  ["C", 20],
  ["A", 80],
];

describe("applyExplorerViewToRows", () => {
  it("filters by column substring", () => {
    const out = applyExplorerViewToRows(rows, columns, {
      columnFilters: { site: "a" },
      columnStats: [
        { name: "site", data_type: "VARCHAR" },
        { name: "cfs", data_type: "DOUBLE" },
      ],
    });
    expect(out.changed).toBe(true);
    expect(out.rows).toEqual([
      ["A", 10],
      ["A", 80],
    ]);
    expect(out.sourceIndices).toEqual([0, 3]);
  });

  it("applies numeric range filters", () => {
    const out = applyExplorerViewToRows(rows, columns, {
      columnFilters: { cfs: "20..60" },
      columnStats: [
        { name: "site", data_type: "VARCHAR" },
        { name: "cfs", data_type: "DOUBLE" },
      ],
    });
    expect(out.rows.map((r) => r[1])).toEqual([50, 20]);
    expect(out.sourceIndices).toEqual([1, 2]);
  });

  it("sorts after filter and keeps source indices", () => {
    const out = applyExplorerViewToRows(rows, columns, {
      columnFilters: { site: "a" },
      sortColumn: "cfs",
      sortDir: "desc",
      columnStats: [
        { name: "site", data_type: "VARCHAR" },
        { name: "cfs", data_type: "DOUBLE" },
      ],
    });
    expect(out.rows).toEqual([
      ["A", 80],
      ["A", 10],
    ]);
    expect(out.sourceIndices).toEqual([3, 0]);
  });

  it("honors anomaly-style index filters", () => {
    const out = applyExplorerViewToRows(rows, columns, {
      filterRowIndices: [1, 3],
    });
    expect(out.rows).toEqual([
      ["B", 50],
      ["A", 80],
    ]);
  });
});

describe("explorerFiltersActive", () => {
  it("detects column and index filters", () => {
    expect(explorerFiltersActive({}, null)).toBe(false);
    expect(explorerFiltersActive({ site: "a" }, null)).toBe(true);
    expect(explorerFiltersActive({}, [1])).toBe(true);
  });
});
