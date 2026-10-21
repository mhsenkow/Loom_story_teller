/**
 * Unit tests for Zustand store state and actions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../store";
import { resolveDeepScanSource } from "../deepScan";
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
      getState().setPanelTab("settings");
      expect(getState().panelTab).toBe("settings");
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
      getState().setPanelTab("settings");
      getState().setSmartResults({ anomaly: { column: "x", method: "z-score", threshold: 2, rowIndices: [] } });
      getState().reset();
      expect(getState().panelTab).toBe("chart");
      expect(getState().smartResults).toBeNull();
    });
  });

  describe("resolveDeepScanSource", () => {
    it("profiles CSV as file after a live source was opened earlier", () => {
      getState().openDataset({
        file: {
          path: "stream://usgs",
          name: "USGS",
          extension: "stream",
          row_count: 1,
          size_bytes: 0,
        },
        sample: { columns: ["x"], types: ["DOUBLE"], rows: [[1]], total_rows: 1 },
      });
      getState().openDataset({
        file: {
          path: "/data/demo.csv",
          name: "demo.csv",
          extension: "csv",
          row_count: 10,
          size_bytes: 100,
        },
        sample: { columns: ["x"], types: ["DOUBLE"], rows: [[1]], total_rows: 1 },
      });
      const path = getState().selectedFile?.path ?? "";
      expect(resolveDeepScanSource(path, "demo.csv")).toEqual({ kind: "file", fileName: "demo.csv" });
    });
  });

  describe("openDataset", () => {
    it("clears row-indexed state when switching files", () => {
      const fileA: FileEntry = {
        path: "/a.csv",
        name: "a.csv",
        extension: "csv",
        row_count: 10,
        size_bytes: 100,
      };
      const fileB: FileEntry = {
        path: "/b.csv",
        name: "b.csv",
        extension: "csv",
        row_count: 5,
        size_bytes: 50,
      };
      getState().openDataset({ file: fileA, sample: { columns: ["x"], types: ["DOUBLE"], rows: [[1]], total_rows: 1 } });
      getState().setSmartResults({
        anomaly: { column: "x", method: "z-score", threshold: 2, rowIndices: [0, 1, 2] },
      });
      getState().setTableFilterRowIndices([0, 1]);
      getState().setSelectedRowIndices([0]);
      getState().setTableColumnFilters({ x: "1" });
      getState().setLassoPoints([{ x: 1, y: 2 }]);
      getState().setCrosshairPos({ dataX: 1, dataY: 2, screenX: 3, screenY: 4 });
      getState().togglePinnedTooltip({
        chartId: "c1",
        ref: { fields: [["x", "1"]] },
        rowIndex: 0,
        row: [1],
        columns: ["x"],
      });

      getState().openDataset({
        file: fileB,
        stats: [],
        sample: { columns: ["y"], types: ["DOUBLE"], rows: [[9]], total_rows: 1 },
        chartRecs: [],
        activeChart: null,
      });

      const s = getState();
      expect(s.selectedFile?.path).toBe("/b.csv");
      expect(s.smartResults).toBeNull();
      expect(s.tableFilterRowIndices).toBeNull();
      expect(s.selectedRowIndices).toEqual([]);
      expect(s.tableColumnFilters).toEqual({});
      expect(s.lassoPoints).toEqual([]);
      expect(s.crosshairPos).toBeNull();
      expect(s.pinnedTooltips).toEqual([]);
      expect(s.sampleRows?.columns).toEqual(["y"]);
    });
  });

  describe("swipeViz bar stack", () => {
    it("applies barStackMode when swiping right on a percent bar", () => {
      const rec: ChartRecommendation = {
        id: "bar-p",
        kind: "bar",
        title: "Stacked",
        subtitle: "",
        score: 80,
        spec: {},
        xField: "a",
        yField: "b",
        colorField: null,
        barStackMode: "percent",
      };
      getState().setColumnStats([{ name: "a", data_type: "VARCHAR", null_count: 0, distinct_count: 2, min_value: null, max_value: null }]);
      getState().setSampleRows({ columns: ["a", "b"], types: ["VARCHAR", "DOUBLE"], rows: [["x", 1]], total_rows: 1 });
      useLoomStore.setState({
        vizSwipeOpen: true,
        vizScanStatus: "ready",
        vizSwipeDeck: [rec],
        vizSwipeIndex: 0,
      });
      getState().swipeViz("right");
      expect(getState().barStackMode).toBe("percent");
    });
  });

  describe("applyChartView", () => {
    it("synthesizes selectedFile for stream paths not in files", () => {
      const rec: ChartRecommendation = {
        id: "c1",
        kind: "scatter",
        title: "USGS",
        subtitle: "",
        score: 1,
        spec: {},
        xField: "lon",
        yField: "lat",
        colorField: null,
      };
      getState().setChartViews([
        {
          id: "v1",
          name: "Live",
          filePath: "stream://usgs",
          fileName: "USGS",
          chart: rec,
          visualOverrides: {},
        },
      ]);
      getState().applyChartView("v1");
      expect(getState().selectedFile?.path).toBe("stream://usgs");
    });
  });

  describe("applyTableView and undoTable", () => {
    it("restores column layout from a saved table view", () => {
      getState().setTableViews([
        {
          id: "tv1",
          name: "Compact",
          visibleColumns: ["a"],
          columnOrder: ["a", "b"],
          columnFilters: { a: "1" },
        },
      ]);
      getState().applyTableView("tv1");
      expect(getState().tablePrefs.visibleColumns).toEqual(["a"]);
      expect(getState().tableColumnFilters).toEqual({ a: "1" });
      getState().pushTableUndo();
      getState().setTablePrefs({ visibleColumns: ["b"], columnOrder: ["b"] });
      getState().undoTable();
      expect(getState().tablePrefs.visibleColumns).toEqual(["a"]);
    });
  });

  describe("addRecentFile", () => {
    it("merges metadata for the same path", () => {
      const file = {
        path: "/x.csv",
        name: "x.csv",
        extension: "csv",
        row_count: 1,
        size_bytes: 1,
      };
      getState().addRecentFile(file);
      getState().addRecentFile({ ...file, row_count: 99 });
      expect(getState().recentFiles.filter((f) => f.path === "/x.csv")).toHaveLength(1);
      expect(getState().recentFiles[0]?.row_count).toBe(99);
    });
  });

  describe("removeChartView", () => {
    it("drops dashboard slots referencing the view", () => {
      getState().setChartViews([
        {
          id: "cv1",
          name: "C",
          filePath: "/a.csv",
          fileName: "a.csv",
          chart: {
            id: "c",
            kind: "scatter",
            title: "T",
            subtitle: "",
            score: 1,
            spec: {},
            xField: "x",
            yField: "y",
            colorField: null,
          },
          visualOverrides: {},
        },
      ]);
      getState().setDashboards([
        {
          id: "db1",
          name: "D",
          slots: [{ id: "s1", viewType: "chart", viewId: "cv1" }],
          layoutTemplate: "auto",
          refreshInterval: "manual",
          lastRefreshedAt: Date.now(),
        },
      ]);
      getState().removeChartView("cv1");
      expect(getState().dashboards[0]!.slots).toEqual([]);
    });
  });
});
