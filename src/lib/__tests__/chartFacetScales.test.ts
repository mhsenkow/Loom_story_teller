import { describe, it, expect } from "vitest";
import { computeFacetSharedValueDomain } from "../chartFacetScales";

describe("chartFacetScales (LOOM-116)", () => {
  it("shared bar domain spans min panel value to max panel value", () => {
    const rows = [
      ["a", 10],
      ["b", 100],
    ];
    const dom = computeFacetSharedValueDomain("bar", rows, 0, 1, "sum");
    expect(dom).toEqual({ min: 0, max: 100 });
  });
});
