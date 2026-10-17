// Discovery must consider the full catalog, then earn prominence from observed data.
import { describe, expect, it, vi } from "vitest";
import { enumerateDiscoverCharts } from "../discoverCandidates";
import {
  DISCOVER_CHART_FAMILY,
  discoverRecipeKey,
} from "../discoverChartCatalog";
import { createDiscoverAssessor } from "../discoverSignals";
import { orderDiscoverStories, discoverSpotlights } from "../discoverRanking";
import { groupDiscoverStories } from "../discoverPresentation";
import {
  buildDiscoverStories,
  buildDiscoverStoriesAsync,
  type DiscoverStory,
} from "../discoverStories";
import { qualifyDiscoverChart } from "../discoverChartQuality";
import { CHART_KIND_OPTIONS, type ChartRecommendation } from "../recs/types";
import type { ColumnInfo, QueryResult } from "../queryTypes";

const sample: QueryResult = {
  columns: [
    "city",
    "region",
    "country",
    "longitude",
    "latitude",
    "ts",
    "temperature",
    "humidity",
    "cloud_cover",
    "wind_speed",
    "pressure",
  ],
  types: [
    "VARCHAR",
    "VARCHAR",
    "VARCHAR",
    "DOUBLE",
    "DOUBLE",
    "TIMESTAMP",
    "DOUBLE",
    "DOUBLE",
    "DOUBLE",
    "DOUBLE",
    "DOUBLE",
  ],
  rows: Array.from({ length: 240 }, (_, i) => [
    `City ${i % 12}`,
    `Region ${i % 3}`,
    ["USA", "CAN", "GBR", "FRA"][i % 4]!,
    -110 + (i % 12) * 10,
    20 + (i % 12) * 4,
    new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 12))).toISOString(),
    12 + (i % 12) + Math.floor(i / 12) * 0.2,
    20 + (i % 80),
    5 + (i % 70),
    1 + (i % 20),
    990 + (i % 40),
  ]),
  total_rows: 240,
};
const stats: ColumnInfo[] = sample.columns.map((name, i) => ({
  name,
  data_type: sample.types[i]!,
  null_count: 0,
  distinct_count: new Set(sample.rows.map((r) => r[i])).size,
  min_value:
    sample.types[i] === "DOUBLE"
      ? String(Math.min(...sample.rows.map((r) => Number(r[i]))))
      : null,
  max_value:
    sample.types[i] === "DOUBLE"
      ? String(Math.max(...sample.rows.map((r) => Number(r[i]))))
      : null,
}));
const base: ChartRecommendation = {
  id: "cities",
  kind: "bar",
  title: "Temperature by city",
  subtitle: "Average readings",
  score: 90,
  spec: {},
  xField: "city",
  yField: "temperature",
  colorField: null,
  yAggregate: "mean",
};

it("distinguishes repeated map observations from distinct coordinates", () => {
  const assessment = createDiscoverAssessor(
    stats,
    sample,
    "meteo",
  )({ ...base, kind: "geoPoints", xField: "longitude", yField: "latitude" });
  expect(assessment?.insight.detail).toBe(
    "240 mapped observations across 12 distinct locations.",
  );
});
const story = (
  id: string,
  kind: DiscoverStory["kind"],
  chartKind: ChartRecommendation["kind"],
  score = 80,
): DiscoverStory => ({
  id,
  kind,
  chartKind,
  score,
  streamPath: `stream://${kind}`,
  fileName: kind,
  hook: id,
  blurb: "",
  category: kind,
  chart: { ...base, kind: chartKind },
  stats,
  sample,
});

describe("full discovery consideration", () => {
  it("visits every registered chart type deterministically and expands all settings before capping", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Discovery must not use random encodings");
    });
    try {
      const first = enumerateDiscoverCharts(stats, [base], "meteo");
      const second = enumerateDiscoverCharts(stats, [base], "meteo");
      expect(first).toEqual(second);
      expect(new Set(first.map((c) => c.kind))).toEqual(
        new Set(CHART_KIND_OPTIONS.map((c) => c.value)),
      );
      expect(new Set(Object.keys(DISCOVER_CHART_FAMILY))).toEqual(
        new Set(CHART_KIND_OPTIONS.map((c) => c.value)),
      );
      expect(new Set(first.map(discoverRecipeKey)).size).toBe(first.length);
      expect(first.some((c) => c.rollingWindow === 30)).toBe(true);
      expect(first.some((c) => c.seriesNormalize === "zscore")).toBe(true);
      expect(first.some((c) => c.timeWindow)).toBe(true);
      expect(first.some((c) => c.barStackMode === "percent")).toBe(true);
      expect(first.some((c) => c.residualOverlay)).toBe(true);
      for (const measure of [
        "temperature",
        "humidity",
        "cloud_cover",
        "wind_speed",
        "pressure",
      ])
        expect(
          first.some((c) => c.kind === "histogram" && c.xField === measure),
          measure,
        ).toBe(true);
      expect(
        first.some(
          (c) =>
            c.kind === "scatter" &&
            new Set([c.xField, c.yField]).has("wind_speed") &&
            new Set([c.xField, c.yField]).has("pressure"),
        ),
      ).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("retains broad useful kinds and compatible pairs after qualification, with stable recipe identities", () => {
    const candidates = enumerateDiscoverCharts(stats, [base], "meteo");
    const stories = buildDiscoverStories(
      "meteo",
      stats,
      sample,
      candidates,
      120,
    );
    expect(stories.length).toBe(120);
    expect(new Set(stories.map((s) => s.chartKind)).size).toBeGreaterThan(30);
    expect(
      stories.some(
        (s) =>
          s.chartKind === "dumbbell" &&
          [s.chart.yField, s.chart.sizeField].includes("humidity") &&
          [s.chart.yField, s.chart.sizeField].includes("cloud_cover"),
      ),
    ).toBe(true);
    expect(stories.every((s) => s.insight && Number.isFinite(s.quality))).toBe(
      true,
    );
    expect(stories.every((s) => s.sample === sample)).toBe(true);
    const reversed = buildDiscoverStories(
      "meteo",
      stats,
      sample,
      [...candidates].reverse(),
      120,
    );
    const ids = new Map(stories.map((s) => [discoverRecipeKey(s.chart), s.id]));
    for (const s of reversed)
      if (ids.has(discoverRecipeKey(s.chart)))
        expect(s.id).toBe(ids.get(discoverRecipeKey(s.chart)));
  });
});

describe("snapshot fitness and evidence", () => {
  it("does not turn temperature or percentages into stacked totals or shares", () => {
    expect(qualifyDiscoverChart("meteo", { ...base, kind: "pie" })).toBeNull();
    expect(
      qualifyDiscoverChart("meteo", {
        ...base,
        kind: "area",
        colorField: "city",
      }),
    ).toBeNull();
    expect(
      qualifyDiscoverChart("meteo", { ...base, barStackMode: "percent" }),
    ).toBeNull();
    expect(
      qualifyDiscoverChart("world_bank", {
        ...base,
        kind: "pie",
        yField: "population",
        yAggregate: "sum",
      }),
    ).not.toBeNull();
    expect(
      qualifyDiscoverChart("meteo", {
        ...base,
        kind: "line",
        xField: "ts",
        colorField: "city",
      }),
    ).not.toBeNull();
  });

  it("keeps a known single-entity orbit but never links unrelated aircraft", () => {
    const path: ChartRecommendation = {
      ...base,
      kind: "globeTrail",
      xField: "longitude",
      yField: "latitude",
      timeField: "ts",
    };
    expect(createDiscoverAssessor(stats, sample)(path)).toBeNull();
    expect(createDiscoverAssessor(stats, sample, "iss")(path)).not.toBeNull();
    expect(
      qualifyDiscoverChart("opensky", {
        ...path,
        trailId: "icao24",
        colorField: "origin_country",
      })?.colorField,
    ).toBe("icao24");
  });

  it("yields during probe qualification and honors cancellation", async () => {
    const candidates = enumerateDiscoverCharts(stats, [base], "meteo");
    const abort = new AbortController();
    const pending = buildDiscoverStoriesAsync(
      ["meteo", stats, sample, candidates, 120],
      abort.signal,
    );
    abort.abort();
    await expect(pending).resolves.toEqual([]);
    const short = candidates.slice(0, 30);
    await expect(
      buildDiscoverStoriesAsync(["meteo", stats, sample, short]),
    ).resolves.toEqual(buildDiscoverStories("meteo", stats, sample, short));
  });
  it("rejects empty, constant and null measures instead of treating nulls as zero", () => {
    const assess = createDiscoverAssessor([], {
      columns: ["city", "temperature"],
      types: ["VARCHAR", "DOUBLE"],
      rows: [
        ["A", null],
        ["B", ""],
        ["C", 12],
      ],
      total_rows: 300,
    });
    expect(assess(base)).toBeNull();
    const pairs = createDiscoverAssessor([], {
      columns: ["x", "y"],
      types: ["DOUBLE", "DOUBLE"],
      rows: [
        [1, null],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
      total_rows: 4,
    });
    expect(
      pairs({ ...base, kind: "scatter", xField: "x", yField: "y" })?.insight
        .label,
    ).not.toBe("Clear relationship");
  });

  it("requires actual history per series for rolling means, comparisons and ranks", () => {
    const assess = createDiscoverAssessor(stats, sample);
    const line: ChartRecommendation = {
      ...base,
      kind: "line",
      xField: "ts",
      colorField: "city",
    };
    expect(assess({ ...line, rollingWindow: 7 })).not.toBeNull();
    expect(assess({ ...line, rollingWindow: 30 })).toBeNull();
    const snapshot = createDiscoverAssessor(stats, {
      ...sample,
      rows: sample.rows.slice(0, 12),
    });
    expect(snapshot(line)).toBeNull();
    expect(snapshot({ ...line, kind: "bump" })).toBeNull();
  });

  it("reports measured relationships and chronological change, without claiming causes", () => {
    const paired = createDiscoverAssessor([], {
      columns: ["x", "y"],
      types: ["DOUBLE", "DOUBLE"],
      rows: Array.from({ length: 40 }, (_, i) => [i, i * 2]),
      total_rows: 4000,
    });
    const result = paired({
      ...base,
      kind: "scatter",
      xField: "x",
      yField: "y",
    });
    expect(result?.insight).toMatchObject({ label: "Clear relationship" });
    expect(result?.insight.detail).toContain(
      "r = 1.00 across 40 paired observations",
    );
    const trend = createDiscoverAssessor([], {
      columns: ["ts", "y"],
      types: ["TIMESTAMP", "DOUBLE"],
      rows: [
        ["2026-10-03", 30],
        ["2026-10-01", 10],
        ["2026-10-02", 20],
      ],
      total_rows: 3,
    });
    expect(
      trend({ ...base, kind: "line", xField: "ts", yField: "y" })?.insight
        .detail,
    ).toContain("from 10 to 30");
  });

  it("avoids invented journeys, unhelpful transforms, thin densities and summed rates", () => {
    const assess = createDiscoverAssessor(stats, sample);
    expect(
      assess({
        ...base,
        kind: "arcMap",
        xField: "longitude",
        yField: "latitude",
      }),
    ).toBeNull();
    expect(
      assess({ ...base, kind: "line", xField: "ts", yScale: "log" }),
    ).toBeNull();
    expect(
      assess({
        ...base,
        kind: "scatter",
        xField: "wind_speed",
        anomalyHighlight: true,
      }),
    ).toBeNull();
    expect(
      assess({ ...base, yField: "poverty_rate", yAggregate: "sum" }),
    ).toBeNull();
    const thin = createDiscoverAssessor(stats, {
      ...sample,
      rows: sample.rows.slice(0, 12),
    });
    expect(thin({ ...base, kind: "violin" })).toBeNull();
    const leader = assess(base)!;
    expect(leader.insight.label).toBe("See who leads");
    expect(leader.insight.detail).not.toContain("% of");
  });
});

describe("editorial diversity", () => {
  it("interleaves later pages as well as the opening and preserves source scores", () => {
    const pool = ["meteo", "usgs", "crypto"].flatMap((kind, i) =>
      Array.from({ length: 30 }, (_, n) =>
        story(
          `${kind}-${n}`,
          kind as DiscoverStory["kind"],
          ["bar", "geoPoints", "scatter"][i] as ChartRecommendation["kind"],
          90 - i * 3,
        ),
      ),
    );
    const ordered = orderDiscoverStories(pool, (s) => s.score);
    expect(new Set(ordered.slice(0, 24).map((s) => s.kind)).size).toBe(3);
    expect(new Set(ordered.slice(24, 48).map((s) => s.kind)).size).toBe(3);
    expect(ordered).toHaveLength(pool.length);
    expect(pool[0]!.score).toBe(90);
  });

  it("keeps different statistics and measure roles as different questions", () => {
    const a = story("a", "meteo", "bar");
    const b = {
      ...a,
      id: "b",
      chart: { ...a.chart, yAggregate: "sum" as const },
    };
    const c = { ...a, id: "c", chart: { ...a.chart, sizeField: "humidity" } };
    const d = {
      ...a,
      id: "d",
      chart: { ...a.chart, yField: "humidity", sizeField: "temperature" },
    };
    expect(groupDiscoverStories([a, b, c, d])).toHaveLength(4);
    expect(
      groupDiscoverStories([a, { ...a, chart: { ...a.chart, kind: "box" } }]),
    ).toHaveLength(2);
    expect(discoverRecipeKey(a.chart)).not.toBe(
      discoverRecipeKey({ ...a.chart, shapeField: "region" }),
    );
    expect(discoverRecipeKey(a.chart)).not.toBe(
      discoverRecipeKey({ ...a.chart, channelInvert: { size: true } }),
    );
  });

  it("never gives a low-fitness chart the lead treatment", () => {
    const weak = { ...story("weak", "meteo", "bar"), quality: 30 };
    const good = { ...story("good", "usgs", "geoPoints"), quality: 90 };
    const picks = discoverSpotlights([weak, good]);
    expect(picks.has("weak")).toBe(false);
    expect(picks.has("good")).toBe(true);
  });
});
