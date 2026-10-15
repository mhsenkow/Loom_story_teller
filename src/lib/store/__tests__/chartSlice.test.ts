// =================================================================
// chartSlice tests
// =================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLoomStore } from "../../store";
import type { ChartRecommendation } from "../../recommendations";

function getState() { return useLoomStore.getState(); }

const makeRec = (overrides?: Partial<ChartRecommendation>): ChartRecommendation => ({
  id: "t1", kind: "scatter", title: "Test", subtitle: "", score: 50,
  spec: { mark: "circle" }, xField: "x", yField: "y", colorField: null,
  ...overrides,
});

beforeEach(() => { getState().reset(); });
afterEach(() => vi.useRealTimers());

describe("chartSlice", () => {
  it("undo and redo keep specs, styles and bar/scatter options together", () => {
    const first = makeRec({ kind: "bar", spec: { mark: "bar" }, barStackMode: "percent" });
    getState().setActiveChart(first);
    getState().setChartVisualOverrides({ colorPalette: "viridis" });
    useLoomStore.setState({ connectScatterTrail: true, showMarginals: true });
    getState().pushChartEditUndo();
    const second = makeRec({ id: "next", spec: { mark: "point" } });
    getState().setActiveChart(second);
    getState().setChartVisualOverrides({ opacity: 0.3 });
    useLoomStore.setState({ barStackMode: "grouped", connectScatterTrail: false, showMarginals: false });
    getState().undoChartEdit();
    expect(getState()).toMatchObject({ activeChart: first, vegaSpec: first.spec, chartVisualOverrides: { colorPalette: "viridis" }, barStackMode: "percent", connectScatterTrail: true, showMarginals: true });
    getState().redoChartEdit();
    expect(getState()).toMatchObject({ activeChart: second, vegaSpec: second.spec, chartVisualOverrides: { opacity: 0.3 }, barStackMode: "grouped", connectScatterTrail: false, showMarginals: false });
  });

  it("coalesces rapid slider changes, but preserves discrete choices and later gestures", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    getState().setActiveChart(makeRec());
    getState().editChartVisualOverrides({ pointSize: 6 }, "pointSize");
    vi.advanceTimersByTime(100);
    getState().editChartVisualOverrides({ pointSize: 10 }, "pointSize");
    expect(getState().chartEditUndoStack).toHaveLength(1);
    getState().undoChartEdit();
    expect(getState().chartVisualOverrides).toEqual({});
    getState().redoChartEdit();
    expect(getState().chartVisualOverrides.pointSize).toBe(10);
    getState().editChartVisualOverrides({ showGrid: false });
    vi.advanceTimersByTime(700);
    getState().editChartVisualOverrides({ pointSize: 15 }, "pointSize");
    expect(getState().chartEditUndoStack).toHaveLength(3);
  });

  it("ignores no-op edits, drops redo on branching, and bounds history", () => {
    getState().setActiveChart(makeRec());
    getState().editChartVisualOverrides({ opacity: 0.5 });
    getState().editChartVisualOverrides({ opacity: 0.5 });
    expect(getState().chartEditUndoStack).toHaveLength(1);
    getState().undoChartEdit();
    getState().editChartVisualOverrides({ colorPalette: "viridis", colorScaleKind: "sequential" });
    expect(getState().chartEditRedoStack).toHaveLength(0);
    for (let i = 0; i < 30; i++) getState().editChartVisualOverrides({ opacity: i / 30 });
    expect(getState().chartEditUndoStack).toHaveLength(20);
  });

  it("restores annotations and title changes and clears history on a different dataset", () => {
    getState().setSelectedFile({ path: "a.csv", name: "a.csv", extension: "csv", size_bytes: 1, row_count: 1 });
    getState().setActiveChart(makeRec());
    getState().setChartTitleOverride("t1", "My title");
    getState().addChartAnnotation("t1", "A note");
    getState().undoChartEdit();
    expect(getState().chartAnnotations).toEqual({});
    expect(getState().chartTitleOverrides.t1).toBe("My title");
    getState().redoChartEdit();
    expect(getState().chartAnnotations.t1[0].text).toBe("A note");
    getState().setSelectedFile({ path: "b.csv", name: "b.csv", extension: "csv", size_bytes: 1, row_count: 1 });
    expect(getState().chartEditUndoStack).toEqual([]);
    expect(getState().chartEditRedoStack).toEqual([]);
  });

  it("saves, updates and applies named looks with undo while retaining field encodings", () => {
    getState().setActiveChart(makeRec());
    getState().setChartVisualOverrides({ colorPalette: "viridis", sourceFootnote: "full", opacity: 0.6 });
    const id = getState().saveCustomChartLook("  Favorite  ")!;
    getState().setChartVisualOverrides({ colorPalette: "plasma", opacity: 0.9 });
    getState().applyCustomChartLook(id);
    expect(getState().chartVisualOverrides).toMatchObject({ colorPalette: "viridis", sourceFootnote: "full", opacity: 0.6 });
    expect(getState().activeChart?.xField).toBe("x");
    getState().undoChartEdit();
    expect(getState().chartVisualOverrides.colorPalette).toBe("plasma");
    expect(getState().saveCustomChartLook("favorite")).toBe(id);
    expect(getState().customChartLooks).toHaveLength(1);
    expect(getState().customChartLooks[0].overrides.opacity).toBe(0.9);
    getState().removeCustomChartLook(id);
    expect(getState().customChartLooks).toEqual([]);
  });
  it("setActiveChart mirrors vegaSpec", () => {
    const rec = makeRec({ spec: { mark: "circle", encoding: {} } });
    getState().setActiveChart(rec);
    expect(getState().vegaSpec).toEqual(rec.spec);
  });

  it("setActiveChart(null) clears vegaSpec", () => {
    getState().setActiveChart(makeRec());
    getState().setActiveChart(null);
    expect(getState().activeChart).toBeNull();
    expect(getState().vegaSpec).toBeNull();
  });

  it("setChartVisualOverrides supports function updater", () => {
    getState().setChartVisualOverrides({ pointSize: 8 });
    getState().setChartVisualOverrides((prev) => ({ ...prev, opacity: 0.5 }));
    expect(getState().chartVisualOverrides.pointSize).toBe(8);
    expect(getState().chartVisualOverrides.opacity).toBe(0.5);
  });

  it("editChartVisualOverrides deletes keys when patched with undefined", () => {
    getState().setChartVisualOverrides({
      legendPosition: "custom",
      legendOffsetX: 0.7,
      legendOffsetY: 0.1,
      legendWidth: 0.2,
    });
    getState().editChartVisualOverrides({
      legendPosition: "auto",
      legendOffsetX: undefined,
      legendOffsetY: undefined,
      legendWidth: undefined,
    });
    expect(getState().chartVisualOverrides).toEqual({ legendPosition: "auto" });
  });

  it("setBarStackMode sets barStackMode on bar rec", () => {
    const rec = makeRec({ kind: "bar", barStackMode: "percent" });
    getState().setActiveChart(rec);
    expect(getState().barStackMode).toBe("percent");
  });

  it("addChartAnnotation creates and removeChartAnnotation deletes", () => {
    getState().addChartAnnotation("c1", "Hello", 0.1, 0.2);
    expect(getState().chartAnnotations["c1"]).toHaveLength(1);
    const annId = getState().chartAnnotations["c1"]![0]!.id;
    getState().removeChartAnnotation("c1", annId);
    expect(getState().chartAnnotations["c1"]).toBeUndefined();
  });

  it("addPinnedTooltip caps at 5", () => {
    for (let i = 0; i < 7; i++) {
      getState().addPinnedTooltip({ chartId: "c", x: i, y: i, rowIndex: i, row: [i], columns: ["x"] });
    }
    expect(getState().pinnedTooltips.length).toBeLessThanOrEqual(5);
  });

  it("pushChartEditUndo + undoChartEdit restores state", () => {
    const rec = makeRec();
    getState().setActiveChart(rec);
    getState().pushChartEditUndo();
    getState().setActiveChart(null);
    getState().undoChartEdit();
    expect(getState().activeChart?.id).toBe("t1");
  });

  it("addChartView returns an id", () => {
    const rec = makeRec();
    const id = getState().addChartView("V1", "/a.csv", "a.csv", rec, {});
    expect(id).toBeTruthy();
    expect(getState().chartViews).toHaveLength(1);
  });

  it("removeChartView cleans up dashboard slots", () => {
    const rec = makeRec();
    const id = getState().addChartView("V1", "/a.csv", "a.csv", rec, {});
    getState().setDashboards([{ id: "db1", name: "D", slots: [{ id: "s1", viewType: "chart", viewId: id! }] }]);
    getState().removeChartView(id!);
    expect(getState().dashboards[0]!.slots).toEqual([]);
  });
});
