import { describe, it, expect } from "vitest";
import { estimateSampleBytes, estimateSampleCells, shouldEvictWebSample } from "../webMemoryBudget";

describe("webMemoryBudget", () => {
  it("estimates cells and bytes", () => {
    const sample = {
      columns: ["a", "b"],
      types: ["VARCHAR", "INTEGER"],
      rows: [["x", 1]],
      total_rows: 1,
    };
    expect(estimateSampleCells(sample)).toBe(2);
    expect(estimateSampleBytes(sample)).toBeGreaterThan(0);
  });

  it("never evicts active path", () => {
    expect(
      shouldEvictWebSample({
        path: "web://a",
        activePath: "web://a",
        cells: 9_999_999,
        bytes: 99_999_999,
      }),
    ).toBe(false);
  });
});
