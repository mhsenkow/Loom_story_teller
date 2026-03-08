/**
 * Unit tests for chart recommendations (createChartRec, createScatterRec, options).
 */
import { describe, it, expect } from "vitest";
import {
  createChartRec,
  createScatterRec,
  CHART_KIND_OPTIONS,
  getRecommendationReason,
} from "../recommendations";
import type { ColumnInfo } from "../store";

const numericColumns: ColumnInfo[] = [
  { name: "x", data_type: "INTEGER", null_count: 0, distinct_count: 100, min_value: "0", max_value: "99" },
  { name: "y", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "0.5", max_value: "100.5" },
  { name: "value", data_type: "BIGINT", null_count: 0, distinct_count: 50, min_value: "10", max_value: "1000" },
];

const mixedColumns: ColumnInfo[] = [
  ...numericColumns,
  { name: "category", data_type: "VARCHAR", null_count: 0, distinct_count: 5, min_value: null, max_value: null },
  { name: "date", data_type: "DATE", null_count: 0, distinct_count: 30, min_value: "2024-01-01", max_value: "2024-12-31" },
];

describe("recommendations", () => {
  describe("CHART_KIND_OPTIONS", () => {
    it("includes expected chart kinds", () => {
      const kinds = CHART_KIND_OPTIONS.map((o) => o.value);
      expect(kinds).toContain("scatter");
      expect(kinds).toContain("bar");
      expect(kinds).toContain("line");
      expect(kinds).toContain("pie");
      expect(kinds).toContain("histogram");
      expect(CHART_KIND_OPTIONS.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("createScatterRec", () => {
    it("builds scatter recommendation with x, y, optional color and size", () => {
      const rec = createScatterRec(
        numericColumns,
        "x",
        "y",
        null,
        "loom_active",
        undefined
      );
      expect(rec.kind).toBe("scatter");
      expect(rec.xField).toBe("x");
      expect(rec.yField).toBe("y");
      expect(rec.colorField).toBeNull();
      expect(rec.spec).toBeDefined();
      const spec = rec.spec as { encoding?: Record<string, unknown> };
      expect(spec.encoding?.x).toBeDefined();
      expect(spec.encoding?.y).toBeDefined();
    });

    it("includes glowField, outlineField, opacityField when passed", () => {
      const rec = createScatterRec(
        numericColumns,
        "x",
        "y",
        "category",
        "loom_active",
        "value",
        { glowField: "value", outlineField: null, opacityField: "value" }
      );
      expect(rec.glowField).toBe("value");
      expect(rec.opacityField).toBe("value");
    });
  });

  describe("createChartRec", () => {
    it("returns scatter when kind is scatter and x,y are numeric", () => {
      const rec = createChartRec(
        "scatter",
        numericColumns,
        "x",
        "y",
        null,
        "loom_active"
      );
      expect(rec).not.toBeNull();
      expect(rec!.kind).toBe("scatter");
      expect(rec!.xField).toBe("x");
      expect(rec!.yField).toBe("y");
    });

    it("returns null for scatter when yField is null", () => {
      const rec = createChartRec(
        "scatter",
        numericColumns,
        "x",
        null,
        null,
        "loom_active"
      );
      expect(rec).toBeNull();
    });

    it("returns bar recommendation", () => {
      const rec = createChartRec(
        "bar",
        mixedColumns,
        "category",
        "value",
        null,
        "loom_active"
      );
      expect(rec).not.toBeNull();
      expect(rec!.kind).toBe("bar");
      expect(rec!.xField).toBe("category");
      expect(rec!.yField).toBe("value");
    });

    it("returns histogram recommendation", () => {
      const rec = createChartRec(
        "histogram",
        numericColumns,
        "x",
        null,
        null,
        "loom_active"
      );
      expect(rec).not.toBeNull();
      expect(rec!.kind).toBe("histogram");
    });

    it("returns line recommendation with temporal x", () => {
      const rec = createChartRec(
        "line",
        mixedColumns,
        "date",
        "value",
        null,
        "loom_active"
      );
      expect(rec).not.toBeNull();
      expect(rec!.kind).toBe("line");
    });

    it("passes extra sizeField, rowField, glowField, outlineField, opacityField for scatter", () => {
      const rec = createChartRec(
        "scatter",
        numericColumns,
        "x",
        "y",
        "category",
        "loom_active",
        { sizeField: "value", glowField: "value", outlineField: null, opacityField: null }
      );
      expect(rec).not.toBeNull();
      expect(rec!.sizeField).toBe("value");
      expect(rec!.glowField).toBe("value");
    });
  });

  describe("getRecommendationReason", () => {
    it("returns a string for a recommendation", () => {
      const rec = createScatterRec(numericColumns, "x", "y", null, "loom_active");
      const reason = getRecommendationReason(rec);
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    });
  });
});
