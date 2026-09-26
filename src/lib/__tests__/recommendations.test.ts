/**
 * Unit tests for chart recommendations (createChartRec, createScatterRec, options).
 */
import { describe, it, expect } from "vitest";
import {
  createChartRec,
  createScatterRec,
  CHART_KIND_OPTIONS,
  getRecommendationReason,
  tryBuildRandomChartRec,
  getRandomEncoding,
  chartKindDataSupport,
  recommend,
  getBestSuggestion,
  getTopSuggestions,
  diversifyRecommendations,
} from "../recommendations";
import { chartCapabilities, encodingChannelLabels } from "../chartSupport";
import type { ColumnInfo, QueryResult } from "../store";

const numericColumns: ColumnInfo[] = [
  { name: "x", data_type: "INTEGER", null_count: 0, distinct_count: 100, min_value: "0", max_value: "99" },
  { name: "y", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "0.5", max_value: "100.5" },
  { name: "value", data_type: "BIGINT", null_count: 0, distinct_count: 50, min_value: "10", max_value: "1000" },
];

const mixedColumns: ColumnInfo[] = [
  ...numericColumns,
  { name: "category", data_type: "VARCHAR", null_count: 0, distinct_count: 5, min_value: null, max_value: null },
  { name: "group", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
  { name: "region", data_type: "VARCHAR", null_count: 0, distinct_count: 8, min_value: null, max_value: null },
  { name: "date", data_type: "DATE", null_count: 0, distinct_count: 30, min_value: "2024-01-01", max_value: "2024-12-31" },
];

/** Extra numeric so radar / bubble size always have headroom. */
const richColumns: ColumnInfo[] = [
  ...mixedColumns,
  { name: "z", data_type: "FLOAT", null_count: 0, distinct_count: 40, min_value: "1", max_value: "40" },
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

  describe("kind coverage", () => {
    it("lists all 19 chart kinds", () => {
      expect(CHART_KIND_OPTIONS.map((o) => o.value).sort()).toEqual([
        "area", "bar", "box", "bubble", "choropleth", "forceBubble", "heatmap",
        "histogram", "line", "lollipop", "pie", "radar", "sankey", "scatter",
        "strip", "sunburst", "treemap", "violin", "waterfall",
      ].sort());
    });

    it("every selectable kind has support check + encoding labels + capabilities", () => {
      for (const { value: kind } of CHART_KIND_OPTIONS) {
        const support = chartKindDataSupport(richColumns, kind);
        expect(typeof support.ok).toBe("boolean");
        const labels = encodingChannelLabels(kind);
        expect(labels.x.length).toBeGreaterThan(0);
        expect(labels.y.length).toBeGreaterThan(0);
        const caps = chartCapabilities(kind);
        expect(typeof caps.cartesian).toBe("boolean");
        expect(typeof caps.xChannel).toBe("boolean");
      }
    });

    it("every supported kind can randomize encoding through createChartRec", () => {
      for (const { value: kind } of CHART_KIND_OPTIONS) {
        const support = chartKindDataSupport(richColumns, kind);
        expect(support.ok).toBe(true);
        let built = false;
        for (let i = 0; i < 40; i++) {
          const enc = getRandomEncoding(richColumns, kind);
          expect(enc).not.toBeNull();
          const extra: { sizeField?: string | null } = {};
          if (enc!.sizeField) extra.sizeField = enc!.sizeField;
          const rec = createChartRec(kind, richColumns, enc!.xField, enc!.yField, enc!.colorField, "test", extra);
          if (rec) {
            built = true;
            expect(rec.kind).toBe(kind);
            break;
          }
        }
        expect(built).toBe(true);
      }
    });

    it("tryBuildRandomChartRec returns a supported kind for mixed columns", () => {
      const rec = tryBuildRandomChartRec(richColumns, "test");
      expect(rec).not.toBeNull();
      expect(chartKindDataSupport(richColumns, rec!.kind).ok).toBe(true);
      expect(createChartRec(rec!.kind, richColumns, rec!.xField, rec!.yField, rec!.colorField, "test")).not.toBeNull();
    });

    it("getRandomEncoding for line always has an X and createChartRec succeeds", () => {
      const enc = getRandomEncoding(mixedColumns, "line");
      expect(enc).not.toBeNull();
      const rec = createChartRec("line", mixedColumns, enc!.xField, enc!.yField, enc!.colorField, "test");
      expect(rec).not.toBeNull();
    });

    it("waterfall / treemap / forceBubble work with count-only (no numeric Y)", () => {
      const catsOnly: ColumnInfo[] = [
        { name: "category", data_type: "VARCHAR", null_count: 0, distinct_count: 6, min_value: null, max_value: null },
        { name: "group", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
      ];
      for (const kind of ["waterfall", "treemap", "forceBubble", "sunburst"] as const) {
        expect(chartKindDataSupport(catsOnly, kind).ok).toBe(true);
        const enc = getRandomEncoding(catsOnly, kind);
        expect(enc).not.toBeNull();
        expect(enc!.yField).toBeNull();
        const rec = createChartRec(kind, catsOnly, enc!.xField, enc!.yField, enc!.colorField, "test");
        expect(rec).not.toBeNull();
      }
    });
  });

  describe("scoring and Suggest chart picks", () => {
    it("recommend returns diversified list and prefers correlated scatter pairs", () => {
      const cols: ColumnInfo[] = [
        { name: "x", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "0", max_value: "100" },
        { name: "y_linked", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "0", max_value: "200" },
        { name: "noise", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-50", max_value: "50" },
        { name: "cluster", data_type: "VARCHAR", null_count: 0, distinct_count: 5, min_value: null, max_value: null },
      ];
      const rows: QueryResult["rows"] = [];
      for (let i = 0; i < 120; i++) {
        const x = i;
        rows.push([x, x * 2 + 1, (i * 17) % 97 - 48, `g${i % 5}`]);
      }
      const data: QueryResult = {
        columns: ["x", "y_linked", "noise", "cluster"],
        types: ["DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR"],
        rows,
        total_rows: rows.length,
      };
      const recs = recommend(cols, data, "corr.csv");
      expect(recs.length).toBeGreaterThan(5);
      expect(recs.length).toBeLessThanOrEqual(40);
      const linked = recs.find((r) => r.kind === "scatter" && r.yField === "y_linked");
      const noisy = recs.find((r) => r.kind === "scatter" && r.yField === "noise");
      expect(linked).toBeDefined();
      expect(noisy).toBeDefined();
      expect(linked!.score).toBeGreaterThan(noisy!.score);
    });

    it("getTopSuggestions returns varied kinds", () => {
      const recs = recommend(mixedColumns, null, "mixed.csv");
      const tops = getTopSuggestions(recs, 6);
      expect(tops.length).toBeGreaterThan(1);
      expect(tops.length).toBeLessThanOrEqual(6);
      const kinds = new Set(tops.map((t) => t.kind));
      expect(kinds.size).toBeGreaterThanOrEqual(Math.min(3, tops.length));
      expect(getBestSuggestion(recs)?.id).toBe(diversifyRecommendations(recs, 1)[0]?.id);
    });
  });
});
