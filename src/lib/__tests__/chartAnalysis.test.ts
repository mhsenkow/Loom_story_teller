import { beforeAll, describe, expect, it } from "vitest";
import { CHART_DEFINITION_LIST } from "../chartDefinitions";
import { analyzeChart, chartAnalysisData, chartAnalysisScope, chartForecast, outlierScores, type ChartAnomalyConfig } from "../chartAnalysis";
import { anomalyHitTargets } from "../chartAnalysisOverlay";
import type { ChartKind, ChartRecommendation } from "../recommendations";
import { auditRecommendation, paintAuditStage } from "./fixtures/chartStageAudit";
import { auditColumns, auditRows, prepareChartAudit } from "./fixtures/chartAudit";
import { recordChartPaint } from "./fixtures/chartRecording";

const chart = (kind: ChartKind, extra: Partial<ChartRecommendation> = {}): ChartRecommendation => ({ id: "analysis", kind, title: "", subtitle: "", score: 1, spec: {}, xField: "x", yField: "y", colorField: null, ...extra });
const config = (c: ChartRecommendation, extra: Partial<ChartAnomalyConfig> = {}): ChartAnomalyConfig => ({ scope: chartAnalysisScope(c), enabled: true, method: "mad", threshold: 3.5, window: 5, ...extra });

beforeAll(async () => { if (!globalThis.Path2D) globalThis.Path2D = class {} as typeof Path2D; await prepareChartAudit(); });

it("finds unusual bar totals that source-row detection cannot find", () => {
  const c = chart("bar");
  const rows = Array.from({ length: 10 }, (_, i) => [String.fromCharCode(65 + i), 10]);
  rows.push(...Array.from({ length: 9 }, () => ["J", 10]));
  const report = analyzeChart(c, rows, ["x", "y"], config(c));
  expect(report.flagged.map(p => p.label)).toEqual(["J"]);
  expect(report.flagged[0].values).toEqual([100]);
  expect(report.rowIndices).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  expect(analyzeChart(c, rows, ["x", "y"], config(c, { field: "y" })).flagged).toHaveLength(0);
});
it("respects bar aggregate, Top N, color groups, percent stacking and nulls", () => {
  const c = chart("bar", { yAggregate: "mean", colorField: "series", barStackMode: "percent", topN: 3 });
  const rows = [["A", 10, "a"], ["A", 30, "a"], ["A", 20, "b"], ["B", 10, "a"], ["B", 20, "b"], ["C", null, "a"], ["C", 10, "b"], ["D", 1, "a"]];
  const data = chartAnalysisData(c, rows, ["x", "y", "series"]);
  expect(data.observations.find(p => p.label === "a · A")?.values).toEqual([50]);
  expect(data.observations.some(p => p.label.includes("D"))).toBe(false);
  expect(data.observations.every(p => p.values.every(Number.isFinite))).toBe(true);
});
it("uses the Z coordinate and excludes incomplete 3D points", () => {
  const c = chart("scatter3d", { zField: "z" });
  const rows = Array.from({ length: 12 }, (_, i) => [1, 2, i === 11 ? 100 : 3]);
  rows.push([1, 2, null as unknown as number]);
  const report = analyzeChart(c, rows, ["x", "y", "z"], config(c));
  expect(report.rowIndices).toEqual([11]);
  expect(report.flagged[0].dimension).toBe("z");
  expect(report.observations).toHaveLength(12);
});
it("detects series departures independently in each color and facet", () => {
  const c = chart("line", { colorField: "s", rowField: "facet" });
  const rows = Array.from({ length: 20 }, (_, x) => [[x, x === 19 ? 100 : 10, "a", "panel"], [x, 1000, "b", "panel"]]).flat();
  const report = analyzeChart(c, rows, ["x", "y", "s", "facet"], config(c, { method: "trailing" }));
  expect(report.rowIndices).toEqual([38]);
  expect(report.flagged[0].markKey).toBe(JSON.stringify(["panel", "a", "19"]));
  expect(analyzeChart(c, rows.slice(0, 6), ["x", "y", "s", "facet"], config(c, { method: "trailing" })).reason).toMatch(/more points/);
});
it("uses cube aggregation and all contributing rows, never only a representative row", () => {
  const c = chart("dataCube", { zField: "z", sizeField: "value", yAggregate: "sum" });
  const rows = Array.from({ length: 10 }, (_, i) => [`C${i}`, "Y", "Z", 10]);
  rows.push(...Array.from({ length: 9 }, () => ["C9", "Y", "Z", 10]));
  const report = analyzeChart(c, rows, ["x", "y", "z", "value"], config(c));
  expect(report.flagged).toHaveLength(1);
  expect(report.flagged[0].values).toEqual([100]);
  expect(report.rowIndices).toHaveLength(10);
  expect(report.cells.size).toBe(1);
});
it("rejects stale, hidden, invalid and insufficient analysis without misleading flags", () => {
  const c = chart("scatter"), rows = [[1, 1], [1, 1], [1, 1], [100, 100]];
  for (const extra of [{ scope: "old" }, { enabled: false }, { threshold: NaN }, { threshold: 100 }]) expect(analyzeChart(c, rows, ["x", "y"], config(c, extra)).flagged).toHaveLength(0);
  expect(analyzeChart(c, [[null, 1], ["", 2], [false, 4], [Infinity, 3]], ["x", "y"], config(c)).reason).toMatch(/No finite/);
});
it("keeps flat-baseline detection scale invariant and does not manufacture outliers", () => {
  for (const method of ["mad", "iqr", "z-score"] as const) {
    expect(outlierScores([10, 10, 10, 10], method)).toEqual([0, 0, 0, 0]);
    expect(outlierScores([1, 2, 3], method)).toEqual([0, 0, 0]);
    expect(outlierScores([1, 1, 1, 1, 1, 1, 1, 20], method)[7]).toBeGreaterThan(1.5);
  }
  expect(outlierScores([.0001, .0001, .0001, .0001, .0002], "mad")[4]).toBe(Infinity);
});
it("matches rendered marks after filtering/thinning and excludes comparison series", () => {
  const circle = { shape: "circle" as const, cx: 1, cy: 1, r: 2, match: [] as [number, string][] };
  const hits = [{ ...circle, rowIndex: 0 }, { ...circle, rowIndex: 1 }];
  expect(anomalyHitTargets(hits, [[1], [2]], new Set([8]), [4, 8])).toEqual([hits[1]]);
  expect(anomalyHitTargets([{ ...circle, rowIndex: 8 }], [[1], [2]], new Set([8]), [4, 8], true)).toHaveLength(1);
  const key = JSON.stringify(["", "a", "2026-01-01"]);
  expect(anomalyHitTargets([{ ...circle, analysisKey: key }, circle], [], new Set(), undefined, false, new Set([key]))).toHaveLength(1);
});
it("forecasts ordered aggregates and refuses categories, gaps or insufficient seasons", () => {
  const rows = Array.from({ length: 12 }, (_, i) => [i, i * 2]);
  for (const method of ["line", "naive", "holt", "seasonal"] as const) {
    const result = chartForecast(rows, ["x", "y"], "x", "y", "mean", 3, method, 4);
    expect(result.forecast?.points).toHaveLength(3);
    expect(result.forecast?.points.every(p => [p.x, p.y, p.lower, p.upper].every(Number.isFinite))).toBe(true);
  }
  expect(chartForecast(rows, ["x", "y"], "x", "y", "mean", 2, "line", 4).forecast?.points[0].y).toBeCloseTo(24);
  expect(chartForecast(rows.filter(r => r[0] !== 4), ["x", "y"], "x", "y", "mean", 2, "line", 4).reason).toMatch(/irregular/);
  expect(chartForecast(rows, ["x", "y"], "x", "y", "mean", 2, "seasonal", 8).reason).toMatch(/two complete/);
  expect(chartForecast([["apple", 2], ["pear", 4]], ["x", "y"], "x", "y", "sum", 2, "line", 4).forecast).toBeNull();
});

describe.each(CHART_DEFINITION_LIST)("$kind analysis contract", definition => {
  it("has a declared unit, valid source analysis and a forecast route", () => {
    const c = auditRecommendation(definition.kind);
    const result = analyzeChart(c, auditRows, auditColumns, config(c, { field: "value" }));
    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.overlay).toBe("none");
    expect(result.observations.every(p => p.values.every(Number.isFinite))).toBe(true);
    expect(definition.analysis.forecast).toBe("ordered-source");
    expect(() => analyzeChart(c, auditRows, auditColumns, config(c))).not.toThrow();
  });
});

it.each(["bar", "line", "area", "scatter", "bubble", "scatter3d", "firefly", "dataCube"] as ChartKind[])("%s draws actual statistical emphasis through the production stage", kind => {
  const recipe = kind === "dataCube" ? { xField: "region", yField: "series", zField: "depth", sizeField: "value", yAggregate: "sum" as const } : { colorField: null };
  const c = { ...auditRecommendation(kind), ...recipe };
  const rows = auditRows.map((r, i) => i === auditRows.length - 1 ? r.map((v, j) => [2, 3, 4].includes(j) ? 100000 : v) : r);
  const report = analyzeChart(c, rows, auditColumns, config(c, { threshold: 1 }));
  expect(report.flagged.length).toBeGreaterThan(0);
  const plain = recordChartPaint(), marked = recordChartPaint();
  paintAuditStage(kind, plain.ctx, {}, rows, recipe);
  paintAuditStage(kind, marked.ctx, {}, rows, recipe, { chartAnomalies: report });
  expect(marked.digest()).not.toBe(plain.digest());
});
