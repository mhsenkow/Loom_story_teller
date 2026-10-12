// =================================================================
// chartSlice tests
// =================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../../store";
import type { ChartRecommendation } from "../../recommendations";

function getState() { return useLoomStore.getState(); }

const makeRec = (overrides?: Partial<ChartRecommendation>): ChartRecommendation => ({
  id: "t1", kind: "scatter", title: "Test", subtitle: "", score: 50,
  spec: { mark: "circle" }, xField: "x", yField: "y", colorField: null,
  ...overrides,
});

beforeEach(() => { getState().reset(); });

describe("chartSlice", () => {
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
