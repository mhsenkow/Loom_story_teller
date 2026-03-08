/**
 * Unit tests for Zustand store state and actions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../store";
import type { ColumnInfo, FileEntry, QueryResult } from "../store";
import type { ChartRecommendation } from "../recommendations";

function getState() {
  return useLoomStore.getState();
}

beforeEach(() => {
  getState().reset();
});

describe("store", () => {
  describe("initial state", () => {
    it("has expected defaults", () => {
      const s = getState();
      expect(s.mountedFolder).toBeNull();
      expect(s.files).toEqual([]);
      expect(s.selectedFile).toBeNull();
      expect(s.panelTab).toBe("chart");
      expect(s.viewMode).toBe("explorer");
      expect(s.smartResults).toBeNull();
      expect(s.activeChart).toBeNull();
      expect(s.vegaSpec).toBeNull();
    });
  });

  describe("setPanelTab", () => {
    it("updates panelTab", () => {
      getState().setPanelTab("stats");
      expect(getState().panelTab).toBe("stats");
      getState().setPanelTab("smart");
      expect(getState().panelTab).toBe("smart");
      getState().setPanelTab("export");
      expect(getState().panelTab).toBe("export");
    });
  });

  describe("setViewMode", () => {
    it("updates viewMode", () => {
      getState().setViewMode("chart");
      expect(getState().viewMode).toBe("chart");
      getState().setViewMode("query");
      expect(getState().viewMode).toBe("query");
    });
  });

  describe("setSmartResults", () => {
    it("sets smartResults to null", () => {
      getState().setSmartResults({ anomaly: { column: "a", method: "z-score", threshold: 2, rowIndices: [0] } });
      expect(getState().smartResults?.anomaly).not.toBeNull();
      getState().setSmartResults(null);
      expect(getState().smartResults).toBeNull();
    });
    it("merges when passed a function", () => {
      getState().setSmartResults({
        anomaly: { column: "x", method: "z-score", threshold: 2, rowIndices: [1, 2] },
      });
      getState().setSmartResults((prev) => ({
        ...prev,
        trend: {
          xField: "a",
          yField: "b",
          slope: 1,
          intercept: 0,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        },
      }));
      expect(getState().smartResults?.anomaly?.rowIndices).toEqual([1, 2]);
      expect(getState().smartResults?.trend?.slope).toBe(1);
    });
  });

  describe("setActiveChart", () => {
    it("sets activeChart and vegaSpec", () => {
      const rec: ChartRecommendation = {
        id: "test-1",
        kind: "scatter",
        title: "Test",
        subtitle: "Sub",
        score: 50,
        spec: { mark: "circle", encoding: {} },
        xField: "x",
        yField: "y",
        colorField: null,
      };
      getState().setActiveChart(rec);
      expect(getState().activeChart).toBe(rec);
      expect(getState().vegaSpec).toEqual(rec.spec);
    });
    it("clears vegaSpec when chart is null", () => {
      getState().setActiveChart({
        id: "x",
        kind: "scatter",
        title: "X",
        subtitle: "",
        score: 0,
        spec: {},
        xField: "a",
        yField: "b",
        colorField: null,
      });
      getState().setActiveChart(null);
      expect(getState().activeChart).toBeNull();
      expect(getState().vegaSpec).toBeNull();
    });
  });

  describe("setChartVisualOverrides", () => {
    it("updates overrides by object", () => {
      getState().setChartVisualOverrides({ pointSize: 12, showGrid: true });
      expect(getState().chartVisualOverrides.pointSize).toBe(12);
      expect(getState().chartVisualOverrides.showGrid).toBe(true);
    });
    it("updates overrides by function", () => {
      getState().setChartVisualOverrides({ pointSize: 8 });
      getState().setChartVisualOverrides((prev) => ({ ...prev, opacity: 0.8 }));
      expect(getState().chartVisualOverrides.pointSize).toBe(8);
      expect(getState().chartVisualOverrides.opacity).toBe(0.8);
    });
  });

  describe("setSelectedFile / setColumnStats / setSampleRows", () => {
    it("updates selection state", () => {
      const file: FileEntry = {
        path: "/data/a.csv",
        name: "a.csv",
        extension: "csv",
        row_count: 100,
        size_bytes: 1024,
      };
      const stats: ColumnInfo[] = [
        { name: "x", data_type: "INTEGER", null_count: 0, distinct_count: 10, min_value: "0", max_value: "9" },
      ];
      const sample: QueryResult = {
        columns: ["x"],
        types: ["INTEGER"],
        rows: [[1], [2], [3]],
        total_rows: 100,
      };
      getState().setSelectedFile(file);
      getState().setColumnStats(stats);
      getState().setSampleRows(sample);
      expect(getState().selectedFile?.name).toBe("a.csv");
      expect(getState().columnStats).toHaveLength(1);
      expect(getState().sampleRows?.rows).toHaveLength(3);
    });
  });

  describe("reset", () => {
    it("restores initial state", () => {
      getState().setPanelTab("smart");
      getState().setSmartResults({ anomaly: { column: "x", method: "z-score", threshold: 2, rowIndices: [] } });
      getState().reset();
      expect(getState().panelTab).toBe("chart");
      expect(getState().smartResults).toBeNull();
    });
  });
});
