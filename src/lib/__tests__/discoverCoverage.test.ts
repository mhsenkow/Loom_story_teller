// Discover must reach trail/arc kinds on moving entities, skip them for fixed
// stations, and never lead with a plot squashed into one corner by an outlier.
import { describe, expect, it } from "vitest";
import { enumerateDiscoverCharts } from "../discoverCandidates";
import { buildDiscoverStories } from "../discoverStories";
import { createDiscoverAssessor } from "../discoverSignals";
import type { ChartRecommendation } from "../recs/types";
import type { ColumnInfo, QueryResult } from "../queryTypes";

function mk(columns: string[], types: string[], rows: unknown[][]): [QueryResult, ColumnInfo[]] {
  const sample = { columns, types, rows, total_rows: rows.length } as QueryResult;
  const stats = columns.map((name, i) => {
    const num = /DOUBLE|INT/.test(types[i]!);
    const vals = rows.map((r) => r[i]);
    return { name, data_type: types[i]!, null_count: 0, distinct_count: new Set(vals).size,
      min_value: num ? String(Math.min(...vals.map(Number))) : null, max_value: num ? String(Math.max(...vals.map(Number))) : null };
  });
  return [sample, stats];
}
const R = (i: number, k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
const meteo = mk(
  ["city","region","country","longitude","latitude","ts","temperature","humidity","cloud_cover","wind_speed","pressure","population"],
  ["VARCHAR","VARCHAR","VARCHAR","DOUBLE","DOUBLE","TIMESTAMP","DOUBLE","DOUBLE","DOUBLE","DOUBLE","DOUBLE","BIGINT"],
  Array.from({ length: 300 }, (_, i) => [`City ${i % 12}`, `Region ${i % 3}`, ["USA","CAN","GBR","FRA","DEU","JPN"][i % 6], -110 + (i % 12) * 10, 20 + (i % 12) * 4,
    new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 12))).toISOString(), 12 + (i % 12) + R(i,3) * 6 + i * 0.02, 20 + R(i,4) * 70, 5 + R(i,5) * 90, 1 + R(i,6) * 20, 990 + R(i,7) * 40, Math.round(1000 + R(i,8) * 90000)]));
const flights = mk(
  ["callsign","origin","destination","airline","ts","longitude","latitude","altitude","velocity","count"],
  ["VARCHAR","VARCHAR","VARCHAR","VARCHAR","TIMESTAMP","DOUBLE","DOUBLE","DOUBLE","DOUBLE","BIGINT"],
  Array.from({ length: 300 }, (_, i) => [`FL${i % 15}`, ["JFK","LAX","ORD","ATL","SEA"][i % 5], ["LHR","CDG","NRT","SFO","MIA"][(i * 3) % 5], ["AA","UA","DL"][i % 3],
    new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString(), -120 + (i % 15) * 5 + (i / 15) * 0.5, 30 + (i % 15) + (i / 15) * 0.2, 3000 + R(i,1) * 9000, 200 + R(i,2) * 300, Math.round(1 + R(i,3) * 50)]));
describe("discover coverage", () => {
  it("connects moving entities by their identity column, never coarse groups", () => {
    const [sample, stats] = flights;
    const stories = buildDiscoverStories("opensky", stats, sample, enumerateDiscoverCharts(stats, [], "opensky", sample), 400);
    for (const kind of ["globeTrail", "arcMap", "trailRibbon"]) {
      const trails = stories.filter((s) => s.chartKind === kind);
      expect(trails.length, kind).toBeGreaterThan(0);
      expect(trails.every((s) => s.chart.trailId === "callsign" && s.chart.timeField === "ts"), kind).toBe(true);
    }
  });
  it("never maps trails for stations that never move", () => {
    const [sample, stats] = meteo;
    const stories = buildDiscoverStories("meteo", stats, sample, enumerateDiscoverCharts(stats, [], "meteo", sample), 400);
    expect(stories.some((s) => ["globeTrail", "arcMap"].includes(s.chartKind))).toBe(false);
    // A city's readings may still trace a path through measure space over time.
    expect(stories.filter((s) => s.chartKind === "trailRibbon").every((s) => s.chart.xField !== "longitude")).toBe(true);
    expect(new Set(stories.map((s) => s.chartKind)).size).toBeGreaterThan(50);
  });
  it("rejects relationship plots one outlier squashes into a corner", () => {
    const [sample, stats] = mk(["coin", "price", "cap"], ["VARCHAR", "DOUBLE", "DOUBLE"],
      Array.from({ length: 40 }, (_, i) => [`c${i}`, i === 0 ? 90000 : 1 + R(i, 1) * 50, i === 0 ? 1.8e12 : 1e6 + R(i, 2) * 5e8]));
    const assess = createDiscoverAssessor(stats, sample, "crypto" as never);
    const chart = { id: "s", kind: "scatter", title: "", subtitle: "", score: 70, spec: {}, xField: "price", yField: "cap", colorField: null } as ChartRecommendation;
    expect(assess(chart)).toBeNull();
    expect(assess({ ...chart, yScale: "log" } as ChartRecommendation)).toBeNull();
    // Same squash on a one-axis distribution, and on GPU / dimensional planes.
    expect(assess({ ...chart, kind: "strip", xField: "cap", yField: "coin" } as ChartRecommendation)).toBeNull();
    expect(assess({ ...chart, kind: "firefly" } as ChartRecommendation)).toBeNull();
  });
});
