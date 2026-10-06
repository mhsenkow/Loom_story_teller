// =================================================================
// dsTransforms — unit tests
// =================================================================

import { describe, expect, it } from "vitest";
import {
  anomalyRowIndices,
  buildCorrMatrix,
  buildPareto,
  normalizeSeriesValues,
  pearsonR,
  residualYs,
  rollingMean,
  scaleDomain,
  scaleY,
} from "../dsTransforms";

describe("dsTransforms", () => {
  it("rollingMean smooths a short series", () => {
    expect(rollingMean([1, 2, 3, 4, 5], 3)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it("normalizeSeriesValues index100 and zscore", () => {
    expect(normalizeSeriesValues([50, 100, 150], "index100")).toEqual([100, 200, 300]);
    const z = normalizeSeriesValues([1, 2, 3], "zscore");
    expect(z[1]).toBeCloseTo(0, 5);
    expect(z[0]).toBeLessThan(0);
    expect(z[2]).toBeGreaterThan(0);
  });

  it("pearsonR and corr matrix", () => {
    expect(pearsonR([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 5);
    const rows = [
      [1, 2, 10],
      [2, 4, 9],
      [3, 6, 8],
      [4, 8, 7],
      [5, 10, 6],
    ];
    const m = buildCorrMatrix(rows, [0, 1, 2], ["a", "b", "c"]);
    expect(m).toBeTruthy();
    expect(m!.matrix[0]![1]).toBeCloseTo(1, 5);
    expect(m!.matrix[0]![2]).toBeLessThan(0);
  });

  it("buildPareto sorts and accumulates to 100%", () => {
    const bins = buildPareto([
      { label: "a", value: 10 },
      { label: "b", value: 30 },
      { label: "c", value: 60 },
    ]);
    expect(bins[0]!.label).toBe("c");
    expect(bins[bins.length - 1]!.cumulativePct).toBeCloseTo(100, 5);
  });

  it("residualYs returns near-zero residuals for a perfect line", () => {
    const xs = [0, 1, 2, 3];
    const ys = [1, 3, 5, 7]; // y = 2x + 1
    const { residuals, slope, intercept } = residualYs(xs, ys);
    expect(slope).toBeCloseTo(2, 5);
    expect(intercept).toBeCloseTo(1, 5);
    for (const r of residuals) expect(Math.abs(r)).toBeLessThan(1e-9);
  });

  it("scaleY / scaleDomain handle log", () => {
    const d = scaleDomain(1, 1000, "log");
    expect(scaleY(1, d.min, d.max, "log")).toBeCloseTo(0, 5);
    expect(scaleY(1000, d.min, d.max, "log")).toBeCloseTo(1, 5);
  });

  it("anomalyRowIndices flags outliers", () => {
    const rows = Array.from({ length: 20 }, (_, i) => [i < 18 ? 10 : 100]);
    const hits = anomalyRowIndices(rows, 0, 2.5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain(18);
  });
});
