import { describe, expect, it } from "vitest";
import { forecastSeries, detectSeriesAnomalies, eventPosition } from "../timeSeriesAnalysis";

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
  const { FORECAST_SOURCE, ANOMALY_SOURCE } = await import("../timeSeriesAnalysisSource");
  const source = readFileSync(new URL("../timeSeriesAnalysis.ts", import.meta.url), "utf8");
  expect(FORECAST_SOURCE).toBe(source.slice(source.indexOf("export function forecastSeries"), source.indexOf("/** Trailing median/MAD")).trim());
  expect(ANOMALY_SOURCE).toBe(source.slice(source.indexOf("export function detectSeriesAnomalies"), source.indexOf("export function eventPosition")).trim());
});
