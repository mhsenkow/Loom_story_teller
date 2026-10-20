import { describe, expect, it } from "vitest";
import { chartNumber } from "../chartNumbers";
import { magnitudeTicks } from "../chartAxes";
import { stackSignedSeries } from "../dsTransforms";
import { aggregateValues } from "../canvasCharts/plumbing";
import { computeBarModel } from "../canvasCharts/bar";
import { addDensityCell, densityValue, densityDomain, type DensityCell } from "../canvasCharts/densityCells";
import { computeFacetSharedValueDomain } from "../chartFacetScales";
import { encodingDropAllowed, encodingPanelHints } from "../chartSupport";
import { canUseWebGpuScatter } from "../webGpuScatterEligibility";
import { createChartRec } from "../recommendations";
import { chartLinkFromState, encodeChartLink, decodeChartLink, restoreChartRec } from "../chartLink";
import { useLoomStore } from "../store";

describe("chart data fidelity", () => {
  it.each([null, undefined, "", "   ", true, false, Infinity, -Infinity, "Infinity", {}, []])("does not turn %j into a numeric observation", value => {
    expect(chartNumber(value)).toBeNaN();
  });
  it("keeps zero and numeric strings, excludes missing values from averages, and counts rows", () => {
    expect(chartNumber(" 0 ")).toBe(0);
    expect(aggregateValues([10, NaN, 20], "mean")).toBe(15);
    expect(computeBarModel([["a", null], ["a", ""], ["a", 10]], 0, 1, "mean").entries).toEqual([["a", 10]]);
    expect(computeBarModel([["a", null], ["a", ""], ["a", 10]], 0, 1, "count").entries).toEqual([["a", 3]]);
  });
  it("keeps signed and zero heat values and uses the same domain for cells and the scale", () => {
    const cells = new Map<string, DensityCell>();
    [-10, null, 10].forEach((v, i) => addDensityCell(cells, "a", v, i));
    addDensityCell(cells, "b", -20, 3);
    addDensityCell(cells, "missing", null, 4);
    expect(densityValue(cells.get("a"), "mean")).toBe(0);
    expect(densityValue(cells.get("a"), "count")).toBe(3);
    expect(densityValue(cells.get("missing"), "sum")).toBeNull();
    expect(densityDomain(cells.values(), "mean")).toEqual({ min: -20, max: 0 });
  });
  it("stacks losses below zero independently of gains", () => {
    expect(stackSignedSeries([[5, -4], [-3, 2], [8, -6]])).toEqual({ bases: [[0, 0], [0, 0], [5, -4]], tops: [[5, -4], [-3, 2], [13, -10]], min: -10, max: 13 });
  });
  it("sizes facet domains from each panel's aggregated values", () => {
    const rows = [["a", 10, "north"], ["a", 20, "north"], ["a", 100, "south"], ["a", 200, "south"]];
    expect(computeFacetSharedValueDomain("bar", rows, 0, 1, "sum", 2)).toEqual({ min: 0, max: 300 });
    expect(computeFacetSharedValueDomain("line", rows, 0, 1, "sum", 2)).toEqual({ min: 0, max: 300 });
    expect(computeFacetSharedValueDomain("line", rows, 0, 1, "count", 2)).toEqual({ min: 0, max: 2 });
  });
  it("uses powers of ten for log axes without introducing zero", () => {
    expect(magnitudeTicks(1, 1000, "log").ticks).toEqual([1, 10, 100, 1000]);
    expect(magnitudeTicks(.1, 100, "log").ticks).toEqual([.1, 1, 10, 100]);
  });
});

const columns = ["region", "group", "value"].map((name, i) => ({ name, data_type: i < 2 ? "VARCHAR" : "DOUBLE", distinct_count: 4, null_count: 0, min_value: null, max_value: null }));
describe("editor and renderer connections", () => {
  it.each(["heatmap", "strip", "ridgeline", "dataCube"] as const)("accepts categorical Y for %s", kind => {
    expect(encodingDropAllowed(kind, "y", columns[0]).ok).toBe(true);
  });
  it.each(["heatmap", "hexbin"] as const)("keeps %s heat aggregation in its spec and shared link", kind => {
    const rec = createChartRec(kind, columns, kind === "hexbin" ? "value" : "region", kind === "hexbin" ? "value" : "group", "value", "test", { yAggregate: "max" })!;
    expect(rec.yAggregate).toBe("max");
    expect(rec.spec).toMatchObject({ encoding: { color: { field: "value", aggregate: "max" } } });
    const link = chartLinkFromState({ selectedFile: { name: "test.csv", path: "mock://test.csv" }, activeChart: rec })!;
    const restored = restoreChartRec(decodeChartLink(encodeChartLink(link))!, columns, [], "test")!;
    expect(restored).toMatchObject({ colorField: "value", yAggregate: "max" });
    expect(encodingDropAllowed(kind, "color", columns[0]).ok).toBe(false);
    expect(encodingPanelHints(rec, columns.map(c => ({ ...c, distinct_count: 1000 }))).some(h => h.id === "color-high-cardinality")).toBe(false);
  });
  it.each([{ rowField: "region" }, { residualOverlay: true }, { anomalyHighlight: true }])("uses Canvas for %j", feature => {
    expect(canUseWebGpuScatter({ kind: "scatter", gpuReady: true, forceCanvasCapture: false, hasSmartOverlays: false, connectScatterTrail: false, showMarginals: false, customRefLineCount: 0, chart: { id: "x", ...feature }, overrides: {} })).toBe(false);
  });
  it("carries authored chart details through an encoding edit, undo and redo", () => {
    const store = useLoomStore;
    store.getState().reset();
    const first = createChartRec("bar", columns, "region", "value", null, "test")!;
    first.channelInvert = { color: true };
    store.getState().setActiveChart(first);
    store.getState().setChartTitleOverride(first.id, "My headline");
    store.getState().addChartAnnotation(first.id, "A note");
    store.getState().addCustomRefLine(first.id, "y", 5, "Target");
    const next = createChartRec("bar", columns, "group", "value", null, "test")!;
    store.getState().editActiveChart(next);
    expect(store.getState().chartTitleOverrides[next.id]).toBe("My headline");
    expect(store.getState().chartAnnotations[next.id][0].text).toBe("A note");
    expect(store.getState().customRefLines[next.id][0].value).toBe(5);
    expect(store.getState().activeChart?.channelInvert?.color).toBe(true);
    store.getState().undoChartEdit();
    expect(store.getState().activeChart?.id).toBe(first.id);
    store.getState().redoChartEdit();
    expect(store.getState().chartTitleOverrides[next.id]).toBe("My headline");
    store.getState().reset();
  });
});
