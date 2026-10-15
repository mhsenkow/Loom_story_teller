/**
 * Encoding panel inline hints — dumbbell, split, Top N, color cardinality, skew.
 */
import { describe, it, expect } from "vitest";
import { encodingPanelHints, chartCapabilities, encodingDropAllowed } from "../chartSupport";
import type { ChartRecommendation } from "../recommendations";
import type { ColumnInfo } from "../store";

function col(
  name: string,
  opts: Partial<ColumnInfo> & { data_type?: string } = {},
): ColumnInfo {
  return {
    name,
    data_type: opts.data_type ?? "DOUBLE",
    null_count: opts.null_count ?? 0,
    distinct_count: opts.distinct_count ?? 10,
    min_value: opts.min_value ?? null,
    max_value: opts.max_value ?? null,
  };
}

function rec(partial: Partial<ChartRecommendation> & Pick<ChartRecommendation, "kind">): ChartRecommendation {
  return {
    id: "t",
    title: "t",
    subtitle: "",
    score: 1,
    spec: {},
    xField: "x",
    yField: "y",
    colorField: null,
    ...partial,
  };
}

describe("encodingPanelHints", () => {
  it("flags dumbbell missing or identical end measure", () => {
    const stats = [col("cat", { data_type: "VARCHAR", distinct_count: 5 }), col("a"), col("b")];
    expect(encodingPanelHints(rec({ kind: "dumbbell", xField: "cat", yField: "a", sizeField: null }), stats)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "dumbbell-need-end", level: "error" })]),
    );
    expect(
      encodingPanelHints(rec({ kind: "dumbbell", xField: "cat", yField: "a", sizeField: "a" }), stats),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: "dumbbell-same-ends", level: "error" })]));
  });

  it("explains when Color and Facet differ (Split hidden)", () => {
    const stats = [
      col("x", { data_type: "VARCHAR" }),
      col("y"),
      col("region", { data_type: "VARCHAR", distinct_count: 4 }),
      col("tier", { data_type: "VARCHAR", distinct_count: 3 }),
    ];
    const hints = encodingPanelHints(
      rec({ kind: "bar", xField: "x", yField: "y", colorField: "region", rowField: "tier" }),
      stats,
    );
    expect(hints.some((h) => h.id === "split-fields-differ")).toBe(true);
  });

  it("warns when Top N exceeds category cardinality", () => {
    const stats = [col("city", { data_type: "VARCHAR", distinct_count: 8 }), col("sales")];
    const hints = encodingPanelHints(
      rec({ kind: "bar", xField: "city", yField: "sales", topN: 30 }),
      stats,
    );
    expect(hints).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "topn-above-cardinality", level: "warn" })]),
    );
  });

  it("warns on high-cardinality color", () => {
    const stats = [col("x"), col("y"), col("id", { data_type: "VARCHAR", distinct_count: 80 })];
    const hints = encodingPanelHints(
      rec({ kind: "scatter", xField: "x", yField: "y", colorField: "id" }),
      stats,
    );
    expect(hints.some((h) => h.id === "color-high-cardinality")).toBe(true);
  });

  it("suggests log when Y is skewed and still linear", () => {
    const stats = [col("x"), col("y", { min_value: "1", max_value: "1000" })];
    const hints = encodingPanelHints(
      rec({ kind: "scatter", xField: "x", yField: "y", yScale: null }),
      stats,
    );
    expect(hints.some((h) => h.id === "y-skew-suggest-log")).toBe(true);
  });
});

describe("chartCapabilities advanced encoding", () => {
  it("exposes rolling / normalize on line and residual on scatter", () => {
    expect(chartCapabilities("line").rollingWindow).toBe(true);
    expect(chartCapabilities("line").seriesNormalize).toBe(true);
    expect(chartCapabilities("bar").rollingWindow).toBe(false);
    expect(chartCapabilities("scatter").residualOverlay).toBe(true);
    expect(chartCapabilities("scatter").anomalyHighlight).toBe(true);
    expect(chartCapabilities("bump").bumpMode).toBe(true);
  });

  it("tick label rotation only on continuous-X kinds — not bar", () => {
    expect(chartCapabilities("scatter").tickLabelRotation).toBe(true);
    expect(chartCapabilities("histogram").tickLabelRotation).toBe(true);
    expect(chartCapabilities("bar").tickLabelRotation).toBe(false);
    expect(chartCapabilities("line").tickLabelRotation).toBe(false);
  });
});

describe("encodingDropAllowed", () => {
  it("rejects non-numeric size and scatter Y", () => {
    const nom = col("region", { data_type: "VARCHAR", distinct_count: 5 });
    expect(encodingDropAllowed("scatter", "size", nom).ok).toBe(false);
    expect(encodingDropAllowed("scatter", "y", nom).ok).toBe(false);
    expect(encodingDropAllowed("bar", "x", nom).ok).toBe(true);
    expect(encodingDropAllowed("scatter", "y", col("sales")).ok).toBe(true);
  });
});
