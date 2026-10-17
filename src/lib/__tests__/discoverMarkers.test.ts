import { describe, expect, it } from "vitest";
import {
  assignChartEmoji,
  chartEmoji,
  chartEmojiLabel,
  isEmojiGlyph,
  parseChartEmojiMap,
} from "../chartEmoji";
import { addDiscoverMarkerVariants, semanticEmojiMap } from "../discoverMarkers";
import { createDiscoverAssessor } from "../discoverSignals";
import {
  chartLinkFromState,
  decodeChartLink,
  encodeChartLink,
  restoreChartRec,
} from "../chartLink";
import { createChartRec } from "../recommendations";
import type { ColumnInfo, QueryResult } from "../queryTypes";
import type { ChartRecommendation } from "../recs/types";

const col = (
  name: string,
  data_type: string,
  distinct_count = 4,
): ColumnInfo => ({
  name,
  data_type,
  distinct_count,
  null_count: 0,
  min_value: null,
  max_value: null,
});
const columns = [
  col("temperature", "DOUBLE"),
  col("humidity", "DOUBLE"),
  col("weather_code", "INTEGER"),
  col("region", "VARCHAR"),
];
const rec: ChartRecommendation = {
  id: "r",
  kind: "scatter",
  xField: "temperature",
  yField: "humidity",
  colorField: "region",
  title: "Weather",
  subtitle: "",
  score: 90,
  spec: {},
};
const sample: QueryResult = {
  columns: columns.map((c) => c.name),
  types: columns.map((c) => c.data_type),
  rows: Array.from({ length: 24 }, (_, i) => [
    i + 1,
    80 - i,
    [0, 3, 61, 95][i % 4],
    ["East", "West"][i % 2],
  ]),
  total_rows: 24,
};
const emoji = () =>
  addDiscoverMarkerVariants([rec], columns, "meteo", sample).find(
    (r) => r.emojiField,
  )!;

describe("field-bound emoji", () => {
  it("keeps complete emoji graphemes, validates mappings, and falls back for unknown codes", () => {
    const map = parseChartEmojiMap({
      field: "condition",
      values: { 0: "☀️", storm: "🌩️", family: "👨‍👩‍👧‍👦", flag: "🇺🇸" },
    })!;
    expect(chartEmoji(0, "condition", map)).toBe("☀️");
    expect(chartEmoji("family", "condition", map)).toBe("👨‍👩‍👧‍👦");
    expect(chartEmoji(999, "condition", map)).toBeNull();
    expect(chartEmoji("🌧️", "new-field", map)).toBe("🌧️");
    expect(isEmojiGlyph("weather")).toBe(false);
    expect(isEmojiGlyph("🇺🇸")).toBe(true);
    expect(
      parseChartEmojiMap({ field: "code", values: { 0: "sunny" } }),
    ).toBeUndefined();
    expect(
      parseChartEmojiMap({
        field: "code",
        values: Object.fromEntries(
          Array.from({ length: 81 }, (_, i) => [i, "☀️"]),
        ),
      }),
    ).toBeUndefined();
  });

  it("round-trips the exact encoding through shared links and chart rebuilding", () => {
    const chart = emoji();
    const link = chartLinkFromState({
      selectedFile: { path: "stream://meteo", name: "Weather" },
      activeChart: chart,
      chartTitleOverrides: {},
      chartVisualOverrides: {},
      barStackMode: "grouped",
      connectScatterTrail: false,
      showMarginals: false,
      appSettings: { chartAspect: "free", chartDevice: "auto" },
    })!;
    const restored = restoreChartRec(
      decodeChartLink(encodeChartLink(link))!,
      columns,
      [],
      "weather",
    )!;
    expect(restored.emojiMap).toEqual(chart.emojiMap);
    expect(restored.emojiField).toBe("weather_code");
    expect(
      createChartRec(
        "scatter",
        columns,
        "temperature",
        "humidity",
        null,
        "weather",
        { emojiField: "region", emojiMap: chart.emojiMap },
      )?.emojiMap,
    ).toBeUndefined();
  });
});

describe("expressive discovery candidates", () => {
  it.each([
    ["gdacs", "event_type", "Earthquake", "🫨"],
    ["eonet", "category", "Wildfires", "🔥"],
    ["mbta", "route_type", "Commuter rail", "🚆"],
    ["firms", "daynight", "N", "🌙"],
  ])(
    "matches %s source values on both runtimes",
    (source, field, value, glyph) => {
      const stats = [...columns.slice(0, 2), col(field, "VARCHAR")];
      const variant = addDiscoverMarkerVariants([rec], stats, source).find(
        (r) => r.emojiField,
      )!;
      expect(chartEmoji(value, variant.emojiField, variant.emojiMap)).toBe(
        glyph,
      );
      expect(parseChartEmojiMap(variant.emojiMap)).toEqual(variant.emojiMap);
    },
  );

  it("adds meaningful weather emoji and redundant category shapes without changing axes", () => {
    const variants = addDiscoverMarkerVariants([rec], columns, "meteo", sample);
    expect(variants).toHaveLength(3);
    const mapped = variants.find((r) => r.emojiField)!;
    expect(mapped).toMatchObject({
      xField: rec.xField,
      yField: rec.yField,
      emojiField: "weather_code",
      colorField: null,
    });
    expect(chartEmoji(95, mapped.emojiField, mapped.emojiMap)).toBe("⛈️");
    expect(chartEmojiLabel(95, mapped.emojiField, mapped.emojiMap)).toBe(
      "Thunderstorm",
    );
    expect(variants.find((r) => r.shapeField)).toMatchObject({
      shapeField: "region",
      colorField: "region",
    });
    expect(
      createDiscoverAssessor(columns, sample, "meteo")(mapped),
    ).not.toBeNull();
    expect(
      addDiscoverMarkerVariants(
        [{ ...rec, kind: "bubble" }],
        columns,
        "meteo",
        sample,
      ),
    ).toHaveLength(1);
  });

  it("uses actual emoji columns, avoids high-cardinality shape legends and unmapped values", () => {
    const stats = [...columns.slice(0, 2), col("symbol", "VARCHAR", 2)];
    const data = {
      ...sample,
      columns: stats.map((c) => c.name),
      types: stats.map((c) => c.data_type),
      rows: sample.rows.map((r, i) => [r[0], r[1], i % 2 ? "🔥" : "🌊"]),
    };
    expect(
      addDiscoverMarkerVariants([rec], stats, "custom", data).some(
        (r) => r.emojiField === "symbol",
      ),
    ).toBe(true);
    expect(
      addDiscoverMarkerVariants(
        [rec],
        columns.map((c) => ({ ...c, distinct_count: 99 })),
        "custom",
        sample,
      ),
    ).toHaveLength(1);
    const unmapped = {
      ...sample,
      rows: sample.rows.map((r) => [r[0], r[1], 999, r[3]]),
    };
    expect(
      createDiscoverAssessor(columns, unmapped, "meteo")(emoji()),
    ).toBeNull();
  });

  it("only offers emoji when the renderer can show them, including per-facet budgets", () => {
    const dense = {
      ...sample,
      rows: Array.from({ length: 1300 }, (_, i) => [
        i,
        i + 10,
        0,
        i % 2 ? "East" : "West",
      ]),
      total_rows: 1300,
    };
    const assess = createDiscoverAssessor(columns, dense, "meteo");
    expect(assess(emoji())).toBeNull();
    expect(assess({ ...emoji(), rowField: "region" })).not.toBeNull();
  });

  it("keeps every category as an emoji when one symbol changes", () => {
    const semantic = semanticEmojiMap("event_type");
    const next = assignChartEmoji(
      "event_type",
      ["EQ", "TC", "FL"],
      semantic,
      "TC",
      "⭐",
      semantic,
    );
    expect(next?.values.TC).toBe("⭐");
    expect(next?.values.EQ).toBe("🫨");
    expect(next?.values.FL).toBe("🌊");
    expect(chartEmojiLabel("EQ", "event_type", next)).toBe("Earthquake");
    const fresh = assignChartEmoji(
      "note",
      ["Wildfire", "Flood"],
      null,
      "Flood",
      "🌊",
    );
    expect(fresh?.values.Flood).toBe("🌊");
    expect(isEmojiGlyph(fresh?.values.Wildfire)).toBe(true);
    expect(fresh?.values.Wildfire).not.toBe("W");
  });
});
