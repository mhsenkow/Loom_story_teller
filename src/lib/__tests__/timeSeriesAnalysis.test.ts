import { describe, expect, it } from "vitest";
import { forecastHolt, forecastNaive, forecastSeasonal, forecastSeries, detectSeriesAnomalies, eventPosition } from "../timeSeriesAnalysis";

describe("displayed series analysis", () => {
  const points = Array.from({ length: 20 }, (_, i) => ({ x: Date.UTC(2026, 0, i + 1), y: 10 + 2 * i }));
  it("forecasts dates beyond the observed domain with a stable fit", () => {
    const result = forecastSeries(points, 7)!;
    expect(result.points).toHaveLength(7);
    expect(result.points[0].x).toBe(Date.UTC(2026, 0, 21));
    expect(result.points[0].y).toBeCloseTo(50);
    expect(result.points[6].y).toBeCloseTo(62);
  });
  it("widens the interval for noisy data and rejects unsafe horizons", () => {
    const result = forecastSeries(points.map((p, i) => ({ ...p, y: p.y + i % 3 })), 10)!;
    expect(result.points[9].upper - result.points[9].lower).toBeGreaterThan(result.points[0].upper - result.points[0].lower);
    for (const horizon of [NaN, Infinity, 0, -1, 1.5, 51]) expect(forecastSeries(points, horizon)).toBeNull();
    expect(forecastSeries(points.slice(0, 7), 2)).toBeNull();
    expect(forecastSeries(points.map(p => ({ ...p, x: 1 })), 2)).toBeNull();
  });
  it("flags departures from flat history without flagging flat values", () => {
    const flat = points.map(p => ({ ...p, y: 10 }));
    expect(detectSeriesAnomalies(flat, 10, 3.5)).toEqual([]);
    flat[15].y = 100;
    expect(detectSeriesAnomalies(flat, 10, 3.5).map(p => p.x)).toEqual([flat[15].x]);
    expect(detectSeriesAnomalies(flat.slice(0, 10), 10, 3.5)).toEqual([]);
  });
  it("keeps a last-value path flat and a recent trend pointed with the series", () => {
    const naive = forecastNaive(points, 4)!;
    expect(naive.points.every(p => p.y === points[19].y)).toBe(true);
    expect(naive.points[3].upper - naive.points[3].lower).toBeGreaterThan(naive.points[0].upper - naive.points[0].lower);
    const holt = forecastHolt(points, 4)!;
    expect(holt.points[0].y).toBeGreaterThan(points[19].y);
    expect(holt.points[3].y).toBeGreaterThan(holt.points[0].y);
  });
  it("repeats the last cycle and refuses a cycle the series cannot support", () => {
    const seasonal = points.map((p, i) => ({ ...p, y: [2, 5, 9, 4][i % 4] }));
    const result = forecastSeasonal(seasonal, 4, 4)!;
    expect(result.points.map(p => p.y)).toEqual([2, 5, 9, 4]);
    expect(forecastSeasonal(points, 4, 1)).toBeNull();
    expect(forecastSeasonal(points.slice(0, 8), 2, 12)).toBeNull();
  });
  it("distinguishes dates from numeric X coordinates and invalid input", () => {
    expect(eventPosition("2026-01-05", "time")).toBe(Date.UTC(2026, 0, 5));
    expect(eventPosition("2026", "number")).toBe(2026);
    expect(eventPosition("", "time")).toBeNull();
    expect(eventPosition("invalid", "time")).toBeNull();
    expect(eventPosition("Infinity", "number")).toBeNull();
  });
});

it("keeps the displayed code identical to the methods that run", async () => {
  const { readFileSync } = await import("node:fs");
  const { FORECAST_SOURCES, ANOMALY_SOURCE } = await import("../timeSeriesAnalysisSource");
  const source = readFileSync(new URL("../timeSeriesAnalysis.ts", import.meta.url), "utf8");
  const between = (startNeedle: string, endNeedle: string) => source.slice(source.indexOf(startNeedle), source.indexOf(endNeedle, source.indexOf(startNeedle) + startNeedle.length)).trim();
  const helpers = between("function prepareForecast", "/** Repeat the latest point");
  const methods = ["forecastNaive", "forecastLine", "forecastHolt", "forecastSeasonal"];
  for (const [index, method] of ["naive", "line", "holt", "seasonal"].entries()) {
    const next = methods[index + 1] ?? "forecastSeries";
    const body = between(`export function ${methods[index]}`, `export function ${next}`).replace(/\n\/\*\*[\s\S]*\*\/\s*$/, "").trim();
    expect(FORECAST_SOURCES[method]).toBe(`${helpers}\n\n${body}`);
  }
  expect(ANOMALY_SOURCE).toBe(between("export function detectSeriesAnomalies", "export function eventPosition"));
});
