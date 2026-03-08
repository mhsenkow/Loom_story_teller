/**
 * Unit tests for smart analytics (anomaly, forecast, trend, reference lines, clustering).
 */
import { describe, it, expect } from "vitest";
import {
  anomalyZScore,
  anomalyIQR,
  anomalyMAD,
  runAnomaly,
  runForecast,
  runTrend,
  runReferenceLines,
  runClustering,
} from "../smartAnalytics";

describe("smartAnalytics", () => {
  const cols = ["x", "y", "value"];
  const rowsNormal: unknown[][] = [
    [1, 10, 100],
    [2, 20, 110],
    [3, 30, 105],
    [4, 40, 115],
    [5, 50, 120],
    [6, 60, 118],
    [7, 70, 122],
    [8, 80, 125],
    [9, 90, 130],
    [10, 100, 128],
  ];

  describe("anomalyZScore", () => {
    it("returns empty for empty rows", () => {
      expect(anomalyZScore([], 0, 2)).toEqual([]);
    });
    it("flags extreme values when |z| > threshold", () => {
      // Mean of [0,0,0,0,100] = 20, std ≈ 44.7, z(100) ≈ 1.79; use threshold 1.5 to catch
      const rows = [[0], [0], [0], [0], [100]];
      const out = anomalyZScore(rows, 0, 1.5);
      expect(out).toContain(4);
    });
  });

  describe("anomalyIQR", () => {
    it("returns empty for fewer than 4 values", () => {
      expect(anomalyIQR([[1], [2], [3]], 0)).toEqual([]);
    });
    it("returns indices outside IQR range", () => {
      const rows = [[1], [2], [3], [4], [5], [6], [7], [8], [9], [100]];
      const out = anomalyIQR(rows, 0, 1.5);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain(9);
    });
  });

  describe("anomalyMAD", () => {
    it("returns empty for insufficient data", () => {
      expect(anomalyMAD([[1]], 0, 3)).toEqual([]);
    });
    it("returns indices for MAD-based outliers", () => {
      const rows = [[1], [2], [2], [2], [2], [2], [2], [2], [2], [50]];
      const out = anomalyMAD(rows, 0, 3);
      expect(out).toContain(9);
    });
  });

  describe("runAnomaly", () => {
    it("returns null for missing column", () => {
      expect(runAnomaly(rowsNormal, "missing", cols, "z-score", 2)).toBeNull();
    });
    it("returns result with rowIndices for z-score", () => {
      const result = runAnomaly(rowsNormal, "value", cols, "z-score", 2);
      expect(result).not.toBeNull();
      expect(result!.column).toBe("value");
      expect(result!.method).toBe("z-score");
      expect(Array.isArray(result!.rowIndices)).toBe(true);
    });
    it("returns result for IQR and MAD", () => {
      expect(runAnomaly(rowsNormal, "value", cols, "iqr", 1.5)).not.toBeNull();
      expect(runAnomaly(rowsNormal, "value", cols, "mad", 3)).not.toBeNull();
    });
  });

  describe("runForecast", () => {
    it("returns null for missing x or y column", () => {
      expect(runForecast(rowsNormal, "missing", "y", cols, 3, "linear")).toBeNull();
      expect(runForecast(rowsNormal, "x", "missing", cols, 3, "linear")).toBeNull();
    });
    it("returns null for horizon < 1 or insufficient points", () => {
      expect(runForecast(rowsNormal, "x", "y", cols, 0, "linear")).toBeNull();
      expect(runForecast([[1, 2]], "x", "y", cols, 3, "linear")).toBeNull();
    });
    it("returns forecast points for linear method", () => {
      const result = runForecast(rowsNormal, "x", "y", cols, 3, "linear");
      expect(result).not.toBeNull();
      expect(result!.points.length).toBe(3);
      expect(result!.method).toBe("linear");
      expect(result!.xField).toBe("x");
      expect(result!.yField).toBe("y");
    });
    it("returns forecast points for moving-avg method", () => {
      const result = runForecast(rowsNormal, "x", "y", cols, 2, "moving-avg");
      expect(result).not.toBeNull();
      expect(result!.points.length).toBe(2);
      expect(result!.method).toBe("moving-avg");
    });
  });

  describe("runTrend", () => {
    it("returns null for missing column", () => {
      expect(runTrend(rowsNormal, "x", "missing", cols)).toBeNull();
    });
    it("returns null for fewer than 2 valid points", () => {
      expect(runTrend([[1, 2]], "x", "y", cols)).toBeNull();
    });
    it("returns trend with slope, intercept, and two line points", () => {
      const result = runTrend(rowsNormal, "x", "y", cols);
      expect(result).not.toBeNull();
      expect(result!.points.length).toBe(2);
      expect(typeof result!.slope).toBe("number");
      expect(typeof result!.intercept).toBe("number");
    });
  });

  describe("runReferenceLines", () => {
    it("returns null for missing column or empty types", () => {
      expect(runReferenceLines(rowsNormal, "missing", cols, "y", ["mean"])).toBeNull();
      expect(runReferenceLines(rowsNormal, "value", cols, "y", [])).toBeNull();
    });
    it("returns lines for mean, median, q1, q3", () => {
      const result = runReferenceLines(
        rowsNormal,
        "value",
        cols,
        "y",
        ["mean", "median", "q1", "q3"]
      );
      expect(result).not.toBeNull();
      expect(result!.lines.length).toBe(4);
      expect(result!.axis).toBe("y");
      const types = result!.lines.map((l) => l.type);
      expect(types).toContain("mean");
      expect(types).toContain("median");
      expect(types).toContain("q1");
      expect(types).toContain("q3");
    });
  });

  describe("runClustering", () => {
    it("returns null for missing column or invalid k", () => {
      expect(runClustering(rowsNormal, "x", "missing", cols, 2)).toBeNull();
      expect(runClustering(rowsNormal, "x", "y", cols, 1)).toBeNull();
      expect(runClustering(rowsNormal, "x", "y", cols, 9)).toBeNull();
    });
    it("returns null when fewer points than k", () => {
      expect(runClustering([[1, 2]], "x", "y", cols, 2)).toBeNull();
    });
    it("returns cluster assignment for k=2", () => {
      const result = runClustering(rowsNormal, "x", "y", cols, 2);
      expect(result).not.toBeNull();
      expect(result!.k).toBe(2);
      expect(result!.columnX).toBe("x");
      expect(result!.columnY).toBe("y");
      const rowToCluster = result!.rowToCluster;
      expect(Object.keys(rowToCluster).length).toBeGreaterThan(0);
      const clusterIds = new Set(Object.values(rowToCluster));
      expect(clusterIds.size).toBeLessThanOrEqual(2);
    });
  });
});
