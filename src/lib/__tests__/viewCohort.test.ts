import { describe, expect, it } from "vitest";
import { describeViewCohort, resetViewCohortPatch } from "../viewCohort";

describe("describeViewCohort", () => {
  it("summarizes an empty cohort", () => {
    const d = describeViewCohort({
      tableColumnFilters: {},
      tableFilterRowIndices: null,
      tableSortColumn: null,
      tableSortDir: null,
      selectedRowIndices: [],
      viewTimeWindow: "all",
      viewTimeField: null,
      lockedColorField: null,
    });
    expect(d.active).toBe(false);
    expect(d.summary).toBe("Full sample");
  });

  it("lists brush, filter, sort, and time", () => {
    const d = describeViewCohort({
      tableColumnFilters: { site: "will" },
      tableFilterRowIndices: [1, 2, 3],
      tableSortColumn: "cfs",
      tableSortDir: "desc",
      selectedRowIndices: [1],
      viewTimeWindow: "7d",
      viewTimeField: "ts",
      lockedColorField: "site",
    });
    expect(d.active).toBe(true);
    expect(d.summary).toMatch(/brushed/);
    expect(d.summary).toMatch(/filter/);
    expect(d.summary).toMatch(/sort/);
    expect(d.summary).toMatch(/7d/);
    expect(d.summary).toMatch(/color locked/);
  });
});

describe("resetViewCohortPatch", () => {
  it("clears filters without inventing a color lock", () => {
    const p = resetViewCohortPatch();
    expect(p.tableColumnFilters).toEqual({});
    expect(p.tableFilterRowIndices).toBeNull();
    expect(p.viewTimeWindow).toBe("all");
    expect(p.selectedRowIndices).toEqual([]);
  });
});
