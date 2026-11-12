import { describe, expect, it } from "vitest";
import {
  discoverFieldLabel,
  formatDiscoverValue,
  readableDiscoverText,
} from "../discoverEditorial";
import { createDiscoverAssessor } from "../discoverSignals";
import type { ChartRecommendation } from "../recs/types";
import type { ColumnInfo, QueryResult } from "../queryTypes";

describe("discoverFieldLabel", () => {
  it("drops unit suffixes that the value already carries", () => {
    expect(discoverFieldLabel("amount_usd")).toBe("amount");
    expect(discoverFieldLabel("max_delay_min")).toBe("max delay");
    expect(discoverFieldLabel("wave_height_m")).toBe("wave height");
    expect(discoverFieldLabel("payrolls_k")).toBe("payrolls (thousands)");
    expect(discoverFieldLabel("anomaly_c")).toBe("temperature anomaly");
  });

  it("keeps plain names readable", () => {
    expect(discoverFieldLabel("magnitude")).toBe("magnitude");
    expect(discoverFieldLabel("event_type")).toBe("event type");
  });
});

describe("formatDiscoverValue", () => {
  it("adds the registry unit and a real minus sign", () => {
    expect(formatDiscoverValue(-11.393, "change_24h_pct", "crypto")).toBe("−11.4%");
    expect(formatDiscoverValue(4.899, "change_24h_pct", "crypto")).toBe("4.9%");
    expect(formatDiscoverValue(-0.185, "anomaly_c", "climate")).toBe("−0.185°C") /* <1 keeps 3 significant digits */;
    expect(formatDiscoverValue(1_500_000_000_000, "market_cap", "crypto")).toBe("$1.5T");
  });

  it("does not invent units for unknown fields", () => {
    expect(formatDiscoverValue(42.123, "score")).toBe("42.1");
    expect(formatDiscoverValue(0, "score")).toBe("0");
  });
});

describe("total rows beside their parts", () => {
  const sample: QueryResult = {
    columns: ["dimension", "key", "posts"],
    types: ["VARCHAR", "VARCHAR", "INTEGER"],
    rows: [
      ["total", "all posts", 100],
      ["language", "en", 60],
      ["language", "ja", 25],
      ["language", "pt", 15],
    ],
    total_rows: 4,
  };
  const stats: ColumnInfo[] = sample.columns.map((name, i) => ({
    name,
    data_type: sample.types[i]!,
    null_count: 0,
    distinct_count: 4,
    min_value: null,
    max_value: null,
  }));
  const chart: ChartRecommendation = {
    id: "keys",
    kind: "bar",
    title: "Top keys",
    subtitle: "",
    score: 90,
    spec: {},
    xField: "key",
    yField: "posts",
    colorField: null,
    yAggregate: "sum",
  };

  it("does not claim a share for a sum that includes the total", () => {
    expect(createDiscoverAssessor(stats, sample, "bluesky")(chart)).toBeNull();
  });

  it("still reads averages, which a total row does not inflate", () => {
    const mean = createDiscoverAssessor(stats, sample, "bluesky")({ ...chart, yAggregate: "mean" });
    expect(mean?.insight.label).toBe("See who leads");
  });
});

describe("readableDiscoverText", () => {
  it("rewrites field names that a title already spaced out", () => {
    expect(readableDiscoverText("Horizon of payrolls k", ["payrolls_k"])).toBe(
      "Horizon of payrolls (thousands)",
    );
    expect(readableDiscoverText("Sig and magnitude over time", ["sig", "magnitude"])).toBe(
      "Significance and magnitude over time",
    );
  });
});

describe("finding headlines", () => {
  const rows: QueryResult["rows"] = [
    ...Array.from({ length: 17 }, (_, i) => ["Wildfires", true, 10 + i, 2]),
    ["Volcanoes", false, 300, 4],
    ["Storms", false, 500, 6],
    ["Storms", false, 700, 8],
  ];
  const sample: QueryResult = {
    columns: ["category", "on_ground", "altitude_m", "severity"],
    types: ["VARCHAR", "BOOLEAN", "DOUBLE", "DOUBLE"],
    rows,
    total_rows: rows.length,
  };
  const stats: ColumnInfo[] = sample.columns.map((name, i) => ({
    name,
    data_type: sample.types[i]!,
    null_count: 0,
    distinct_count: new Set(rows.map((r) => r[i])).size,
    min_value: null,
    max_value: null,
  }));
  const chart = (over: Partial<ChartRecommendation>): ChartRecommendation => ({
    id: "c",
    kind: "bar",
    title: "Count by category",
    subtitle: "",
    score: 80,
    spec: {},
    xField: "category",
    yField: null,
    colorField: null,
    ...over,
  });
  const assess = createDiscoverAssessor(stats, sample, "eonet");

  it("leads with the finding and keeps a question in reserve", () => {
    const insight = assess(chart({}))!.insight;
    expect(insight.headline).toBe("Wildfires: 85% of the total");
    expect(insight.question).toBe("Which category shows up most?");
  });

  it("uses averages for charts that draw averages", () => {
    const insight = assess(chart({ kind: "errorBars", yField: "altitude_m" }))!.insight;
    // Storms average 600 m; a sum would have crowned Storms at 1,200 (or Wildfires by count).
    expect(insight.headline).toBe("Storms has the highest average altitude: 600");
    expect(insight.detail).toContain("(average altitude)");
  });

  it("reads true/false groups as answers to their column", () => {
    const insight = assess(chart({ xField: "on_ground", yField: "altitude_m", yAggregate: "mean" }))!.insight;
    expect(insight.headline).toBe("Ground status: no has the highest average altitude: 500");
  });

  it("describes relationships in words, with the numbers in the detail", () => {
    const spread: QueryResult = {
      columns: ["altitude_m", "severity"],
      types: ["DOUBLE", "DOUBLE"],
      rows: Array.from({ length: 24 }, (_, i) => [i * 40, i * 0.5 + (i % 3)]),
      total_rows: 24,
    };
    const spreadStats: ColumnInfo[] = spread.columns.map((name) => ({ name, data_type: "DOUBLE", null_count: 0, distinct_count: 24, min_value: null, max_value: null }));
    const insight = createDiscoverAssessor(spreadStats, spread, "eonet")(chart({ kind: "scatter", xField: "altitude_m", yField: "severity" }))!.insight;
    expect(insight.headline).toBe("Altitude and severity rise together");
    expect(insight.detail).toMatch(/r = 0\.\d\d/);
    expect(insight.question).toBe("How do altitude and severity relate?");
  });
});
