/**
 * Panel controls only show when the renderer actually reads them
 * (audit: dead Color / Legend / Data labels / tick rotation controls).
 */
import { describe, it, expect } from "vitest";
import { chartCapabilities, defaultYAggregate, encodingChannelLabels } from "../chartSupport";

describe("chartCapabilities", () => {
  it("hides Color on kinds that paint one series or a ramp", () => {
    for (const k of ["waffle", "isotype", "horizon", "radialBar", "isoBars", "contour", "geoHex", "calendar"] as const) {
      expect(chartCapabilities(k).colorChannel, k).toBe(false);
    }
  });

  it("shows controls the renderer honors", () => {
    expect(chartCapabilities("geoPoints").sizeChannel).toBe(true);
    expect(chartCapabilities("choropleth").aggregate).toBe(true);
    expect(chartCapabilities("waterfall").dataLabels).toBe(true);
    expect(chartCapabilities("treemap").legend).toBe(true);
    expect(chartCapabilities("forceBubble").legend).toBe(true);
  });

  it("hides controls the renderer ignores", () => {
    for (const k of ["pareto", "dumbbell", "slope"] as const) expect(chartCapabilities(k).dataLabels, k).toBe(false);
    for (const k of ["box", "ridgeline", "funnel", "sankey", "sparkGrid"] as const) expect(chartCapabilities(k).legend, k).toBe(false);
    for (const k of ["histogram", "waterfall", "ecdf"] as const) expect(chartCapabilities(k).markMotif, k).toBe(false);
    for (const k of ["beeswarm", "isoScatter", "scatter3d"] as const) expect(chartCapabilities(k).tickLabelRotation, k).toBe(false);
    for (const k of ["voronoi", "contour", "ecdf"] as const) expect(chartCapabilities(k).tickLabelRotation, k).toBe(true);
  });

  it("labels new kinds by role", () => {
    expect(encodingChannelLabels("sparkGrid").color).toBe("Panel");
    expect(encodingChannelLabels("rose").color).toBe("Stack");
    expect(chartCapabilities("ecdf").yChannel).toBe(false);
    expect(encodingChannelLabels("voronoi").size).toBe("Size");
  });

  it("defaults aggregates the way renderers do", () => {
    expect(defaultYAggregate("dumbbell")).toBe("mean");
    expect(defaultYAggregate("heatmap")).toBe("mean");
    expect(defaultYAggregate("bar")).toBe("sum");
  });
});
