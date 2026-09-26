/**
 * Unit tests for deep scan profiling and swipe deck generation.
 */
import { describe, it, expect } from "vitest";
import { buildDatasetProfile, deepRecommend } from "../deepScan";
import { emptyVizPreferenceModel, recordVizSwipe, extractVizFeatures } from "../vizPreferences";
import type { ColumnInfo, QueryResult } from "../store";
import type { ChartRecommendation } from "../recommendations";

const columns: ColumnInfo[] = [
  { name: "x", data_type: "DOUBLE", null_count: 0, distinct_count: 50, min_value: "0", max_value: "50" },
  { name: "y", data_type: "DOUBLE", null_count: 0, distinct_count: 50, min_value: "0", max_value: "100" },
  { name: "category", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
  { name: "region", data_type: "VARCHAR", null_count: 0, distinct_count: 3, min_value: null, max_value: null },
  { name: "date", data_type: "DATE", null_count: 0, distinct_count: 40, min_value: "2024-01-01", max_value: "2024-02-10" },
];

function makeData(n = 60): QueryResult {
  const rows: (string | number | null)[][] = [];
  const cats = ["A", "B", "C", "D"];
  const regions = ["North", "South", "West"];
  for (let i = 0; i < n; i++) {
    rows.push([
      i,
      i * 1.8 + (i % 3),
      cats[i % 4]!,
      regions[i % 3]!,
      `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    ]);
  }
  return {
    columns: ["x", "y", "category", "region", "date"],
    types: ["DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR", "DATE"],
    rows,
    total_rows: n,
  };
}

describe("deepScan", () => {
  it("builds a profile with correlations and schema signature", () => {
    const data = makeData();
    const profile = buildDatasetProfile(columns, data);
    expect(profile.schemaSignature).toMatch(/^[0-9a-f]+$/);
    expect(profile.columns.length).toBe(columns.length);
    expect(profile.numericCorrelations.length).toBeGreaterThan(0);
    expect(profile.numericCorrelations[0]!.absR).toBeGreaterThan(0.5);
  });

  it("returns a diversified swipe deck", () => {
    const result = deepRecommend(columns, makeData(), emptyVizPreferenceModel(), {
      kind: "file",
      fileName: "demo.csv",
    }, 12);
    expect(result.deck.length).toBeGreaterThan(3);
    expect(result.deck.length).toBeLessThanOrEqual(12);
    expect(result.scanMs).toBeGreaterThanOrEqual(0);
    const kinds = new Set(result.deck.map((r) => r.kind));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("ranks liked kinds higher after preference learning", () => {
    const data = makeData();
    const base = deepRecommend(columns, data, emptyVizPreferenceModel(), { kind: "file", fileName: "demo.csv" }, 16);

    let model = emptyVizPreferenceModel();
    const scatterLike: ChartRecommendation = {
      id: "scatter-x-y",
      kind: "scatter",
      title: "x vs y",
      subtitle: "",
      score: 70,
      spec: {},
      xField: "x",
      yField: "y",
      colorField: null,
    };
    for (let i = 0; i < 10; i++) {
      model = recordVizSwipe(model, "like", extractVizFeatures(scatterLike, columns));
    }

    const learned = deepRecommend(columns, data, model, { kind: "file", fileName: "demo.csv" }, 16);
    const baseScatter = base.deck.find((r) => r.kind === "scatter");
    const learnedScatter = learned.deck.find((r) => r.kind === "scatter");
    if (baseScatter && learnedScatter) {
      expect(learnedScatter.score).toBeGreaterThanOrEqual(baseScatter.score);
    }
    // At least one scatter should appear when preferences favor it
    expect(learned.deck.some((r) => r.kind === "scatter")).toBe(true);
  });
});
