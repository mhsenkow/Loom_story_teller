import { describe, expect, it } from "vitest";
import { compareExplorerCells } from "../tableSort";

describe("tableSort", () => {
  it("sorts nulls and blanks last in both directions", () => {
    expect(compareExplorerCells(null, 1, 1)).toBeGreaterThan(0);
    expect(compareExplorerCells("", 1, 1)).toBeGreaterThan(0);
    expect(compareExplorerCells(null, 1, -1)).toBeGreaterThan(0);
    expect(compareExplorerCells(1, null, -1)).toBeLessThan(0);
  });

  it("compares numbers and strings without mixing NaN as zero", () => {
    expect(compareExplorerCells(2, 10, 1)).toBeLessThan(0);
    expect(compareExplorerCells("b", "a", 1)).toBeGreaterThan(0);
  });
});
