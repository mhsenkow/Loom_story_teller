// Discover search, diversity and evidence contracts.
import { describe, expect, it } from "vitest";
import {
  discoverChartSettings,
  discoverEvidence,
  matchesDiscoverSearch,
  matchesDiscoverSetting,
  rankDiscoverStories,
} from "../discoverPresentation";
import {
  buildDiscoverStories,
  discoverHookFor,
  type DiscoverStory,
} from "../discoverStories";
import type { ChartRecommendation } from "../recommendations";
import type { QueryResult } from "../queryTypes";
import { qualifyDiscoverChart } from "../discoverChartQuality";

const chart: ChartRecommendation = {
  id: "bar",
  kind: "bar",
  title: "Temperature by city",
  subtitle: "Average readings",
  score: 80,
  spec: {},
  xField: "city",
  yField: "temperature",
  colorField: null,
  yAggregate: "mean",
};
const sample: QueryResult = {
  columns: ["city", "temperature", "humidity", "cloud_cover"],
  types: ["VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE"],
  rows: [
    ["Detroit", 12, 60, 40],
    ["London", 15, 75, 80],
  ],
  total_rows: 800,
};
const story: DiscoverStory = {
  id: "weather",
  kind: "meteo",
  streamPath: "stream://meteo",
  fileName: "Weather",
  hook: "Weather across cities",
  blurb: "Compare temperatures",
  category: "Weather",
  chartKind: "bar",
  chart,
  sample,
  stats: [],
  score: 90,
};

describe("discover presentation", () => {
  it("finds sources, fields, chart types and settings using all search terms", () => {
    const variant = {
      ...story,
      chartKind: "pyramid",
      chart: {
        ...chart,
        kind: "pyramid" as const,
        deltaDisplay: "pct" as const,
        pyramidScaleMode: "independent" as const,
      },
    };
    expect(matchesDiscoverSearch(variant, "weather pyramid")).toBe(true);
    expect(matchesDiscoverSearch(variant, "temperature separate scales")).toBe(
      true,
    );
    expect(matchesDiscoverSearch(variant, "% difference")).toBe(true);
    expect(matchesDiscoverSearch(variant, "weather earthquake")).toBe(false);
    expect(discoverChartSettings(variant.chart)).toContain("Separate scales");
  });

  it("distinguishes comparison, facet, time and transform settings", () => {
    expect(
      matchesDiscoverSetting(
        { ...chart, kind: "dumbbell", sizeField: "humidity" },
        "compare",
      ),
    ).toBe(true);
    expect(
      matchesDiscoverSetting({ ...chart, rowField: "city" }, "facet"),
    ).toBe(true);
    expect(
      matchesDiscoverSetting({ ...chart, timeWindow: "all" }, "window"),
    ).toBe(false);
    expect(
      matchesDiscoverSetting({ ...chart, timeWindow: "1h" }, "window"),
    ).toBe(true);
    expect(
      matchesDiscoverSetting({ ...chart, yScale: "log" }, "transform"),
    ).toBe(true);
    expect(matchesDiscoverSetting(chart, "compare")).toBe(false);
  });

  it("varies the opening even when every candidate fits, without mutating input", () => {
    const pool = [
      { ...story, id: "a", score: 95 },
      { ...story, id: "b", score: 94 },
      {
        ...story,
        id: "c",
        kind: "usgs" as const,
        chartKind: "geoPoints",
        category: "Earth",
        score: 91,
      },
      {
        ...story,
        id: "d",
        kind: "crypto" as const,
        chartKind: "scatter",
        category: "Markets",
        score: 89,
      },
    ];
    expect(
      rankDiscoverStories(pool)
        .slice(0, 3)
        .map((item) => item.id),
    ).toEqual(["a", "c", "d"]);
    expect(pool.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(rankDiscoverStories(pool)).toEqual(rankDiscoverStories(pool));
  });

  it("lets source affinity lift a loved feed to the top without changing story scores", () => {
    const pool = [
      { ...story, id: "a", score: 95 },
      { ...story, id: "q", kind: "usgs" as const, chartKind: "geoPoints", category: "Earth", score: 80 },
      { ...story, id: "x", kind: "crypto" as const, chartKind: "scatter", category: "Markets", score: 89 },
    ];
    const loved = { usgs: 20 } as Record<string, number>;
    const ranked = rankDiscoverStories(pool, (s) => s.score + (loved[s.kind] ?? 0));
    expect(ranked[0]!.id).toBe("q");
    expect(ranked[0]!.score).toBe(80);
    expect(rankDiscoverStories(pool)[0]!.id).toBe("a");
  });

  it("labels partial and cached snapshots honestly", () => {
    expect(discoverEvidence({ ...story, snapshotCached: true })).toEqual({
      coverage: "2 of 800 rows",
      shortCoverage: "2/800 rows",
      period: null,
      cached: true,
    });
  });

  it("headlines only observed rows, not the unsampled buffer total", () => {
    const hook = discoverHookFor("mbta", sample, chart);
    expect(hook.hook).toContain("2 MBTA");
    expect(hook.hook).not.toContain("800");
  });

  it("keeps aggregate/scale/Δ variants and rejects missing fields or empty windows", () => {
    const candidates: ChartRecommendation[] = [
      chart,
      { ...chart, id: "sum", yAggregate: "sum" },
      { ...chart, id: "missing", yField: "no_such_column" },
      {
        ...chart,
        id: "pyramid",
        kind: "pyramid",
        yField: "humidity",
        sizeField: "cloud_cover",
        deltaDisplay: "diff",
        pyramidScaleMode: "shared",
      },
      {
        ...chart,
        id: "pyramid-alt",
        kind: "pyramid",
        yField: "humidity",
        sizeField: "cloud_cover",
        deltaDisplay: "pct",
        pyramidScaleMode: "independent",
      },
    ];
    const stories = buildDiscoverStories("meteo", [], sample, candidates);
    expect(stories.map((item) => item.chart.id)).toEqual(
      expect.arrayContaining(["bar", "sum", "pyramid", "pyramid-alt"]),
    );
    expect(stories.some((item) => item.chart.id === "missing")).toBe(false);
    expect(stories.every((item) => item.sample === sample)).toBe(true);
    const timed: QueryResult = {
      columns: ["city", "temperature", "ts"],
      types: [],
      rows: [["A", 10, new Date(Date.now() - 3 * 3_600_000).toISOString()]],
      total_rows: 99,
    };
    expect(
      buildDiscoverStories("meteo", [], timed, [
        { ...chart, timeWindowField: "ts", timeWindow: "1h" },
      ]),
    ).toEqual([]);
  });

  it("never presents differences between dollars and years, or degrees and percentages", () => {
    const mixed = {
      ...chart,
      kind: "dumbbell" as const,
      yField: "gdp_per_capita",
      sizeField: "life_expectancy",
      deltaDisplay: "diff" as const,
    };
    expect(qualifyDiscoverChart("world_bank", mixed)).toBeNull();
    const mirror = qualifyDiscoverChart("world_bank", {
      ...mixed,
      kind: "pyramid",
    });
    expect(mirror).toMatchObject({
      pyramidScaleMode: "independent",
      deltaDisplay: "off",
    });
    expect(mirror?.subtitle).toContain("USD/person / years");
    expect(
      qualifyDiscoverChart("meteo", {
        ...chart,
        kind: "slope",
        sizeField: "humidity",
      }),
    ).toBeNull();
    const comparable = {
      ...chart,
      kind: "dumbbell" as const,
      yField: "pm2_5",
      sizeField: "pm10",
    };
    expect(qualifyDiscoverChart("aq", comparable)).toBe(comparable);
    expect(
      qualifyDiscoverChart("citibike", {
        ...comparable,
        kind: "pyramid",
        yField: "bikes_available",
        sizeField: "latitude",
      }),
    ).toBeNull();
    expect(
      qualifyDiscoverChart("meteo", {
        ...comparable,
        kind: "pyramid",
        yField: "longitude",
        sizeField: "latitude",
      }),
    ).toBeNull();
    expect(
      qualifyDiscoverChart("hn", {
        ...comparable,
        kind: "pyramid",
        yField: "points",
        sizeField: "id",
      }),
    ).toBeNull();
    expect(
      qualifyDiscoverChart("meteo", {
        ...chart,
        y2Field: "humidity",
        seriesNormalize: "index100",
      }),
    ).not.toBeNull();
  });
});
