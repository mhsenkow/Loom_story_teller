/**
 * Unit tests for chart type catalog grouping + search.
 */
import { describe, it, expect } from "vitest";
import { CHART_KIND_CATALOG, searchChartKinds, scoreChartKind } from "../chartKindSearch";
import { CHART_KIND_OPTIONS } from "../recommendations";

describe("chart kind catalog", () => {
  it("lists every kind once with a group", () => {
    const unique = new Set(CHART_KIND_OPTIONS.map((o) => o.value));
    expect(CHART_KIND_CATALOG.length).toBe(unique.size);
    expect(CHART_KIND_CATALOG.find((e) => e.value === "dataCube")?.group).toBe("3D & GPU");
    expect(CHART_KIND_CATALOG.find((e) => e.value === "choropleth")?.group).toBe("Maps");
    expect(CHART_KIND_CATALOG.find((e) => e.value === "bar")?.group).toBe("Classic");
  });
});

describe("searchChartKinds", () => {
  it("returns the whole catalog for an empty query", () => {
    expect(searchChartKinds("  ")).toHaveLength(CHART_KIND_CATALOG.length);
  });

  it("finds the data cube by label, id, and synonyms", () => {
    expect(searchChartKinds("cube")[0]?.value).toBe("dataCube");
    expect(searchChartKinds("datacube")[0]?.value).toBe("dataCube");
    expect(searchChartKinds("voxel").map((e) => e.value)).toContain("dataCube");
    expect(searchChartKinds("3d").map((e) => e.value)).toEqual(expect.arrayContaining(["dataCube", "scatter3d"]));
  });

  it("requires every token and ranks prefix matches first", () => {
    expect(searchChartKinds("data cube")[0]?.value).toBe("dataCube");
    expect(searchChartKinds("cube zzz")).toHaveLength(0);
    expect(searchChartKinds("bar")[0]?.value).toBe("bar");
    expect(searchChartKinds("map").some((e) => e.group === "Maps")).toBe(true);
  });

  it("scores non-matches as zero", () => {
    const bar = CHART_KIND_CATALOG.find((e) => e.value === "bar")!;
    expect(scoreChartKind(bar, "globe")).toBe(0);
  });
});
