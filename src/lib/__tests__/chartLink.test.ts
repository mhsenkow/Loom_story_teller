/**
 * Unit tests for `#chart=` shareable chart links.
 */
import { describe, it, expect } from "vitest";
import {
  chartLinkFromState,
  chartLinkMatchesFile,
  chartLinkSrc,
  decodeChartLink,
  encodeChartLink,
  isPortableChartLink,
  restoreChartRec,
  type ChartLink,
} from "../chartLink";
import { b64urlDecode, b64urlEncode } from "../dive";
import { createChartRec, type ChartRecommendation } from "../recommendations";
import type { ColumnInfo } from "../store";

const col = (name: string, data_type: string): ColumnInfo => ({
  name,
  data_type,
  null_count: 0,
  distinct_count: 10,
  min_value: null,
  max_value: null,
});

const columns: ColumnInfo[] = [
  col("region", "VARCHAR"),
  col("product", "VARCHAR"),
  col("revenue", "DOUBLE"),
  col("units", "INTEGER"),
  col("date", "DATE"),
];

const full: ChartLink = {
  src: "mock://sales.csv",
  chart: {
    kind: "bar",
    xField: "region",
    yField: "revenue",
    colorField: "product",
    yAggregate: "mean",
    tooltipFields: ["region", "revenue"],
    title: "Average revenue by region × product",
    subtitle: "stacked by product",
  },
  titleOverride: "Where the money is — café ☕",
  visual: { colorPalette: "seq-blue", axisStyle: "ladder", showGrid: false, pointSize: 6 },
  barStackMode: "stacked",
  connectScatterTrail: true,
  showMarginals: true,
  chartAspect: "9:16",
  chartDevice: "mobile",
};

const payload = (encoded: string) => JSON.parse(b64urlDecode(encoded.replace(/^chart=/, ""))) as Record<string, unknown>;

describe("chart links", () => {
  it("round-trips every field, with or without a leading # and alongside other params", () => {
    const enc = encodeChartLink(full);
    expect(enc).toMatch(/^chart=[A-Za-z0-9_-]+$/);
    expect(decodeChartLink(enc)).toEqual(full);
    expect(decodeChartLink(`#${enc}`)).toEqual(full);
    expect(decodeChartLink(`#foo=1&${enc}`)).toEqual(full);
  });

  it("round-trips a minimal link and carries a version", () => {
    const min: ChartLink = { src: "stream://usgs", chart: { kind: "geoPoints", xField: "lon", yField: "lat" } };
    const enc = encodeChartLink(min);
    expect(payload(enc).v).toBe(1);
    expect(decodeChartLink(enc)).toEqual(min);
  });

  it("omits undefined, null-ish and default values from the payload", () => {
    const link = chartLinkFromState({
      selectedFile: { path: "mock://sales.csv", name: "sales.csv" },
      activeChart: {
        id: "r1",
        kind: "scatter",
        title: "",
        subtitle: "",
        score: 1,
        spec: { big: "x".repeat(500) },
        xField: "units",
        yField: "revenue",
        colorField: null,
        sizeField: undefined,
        zField: null,
      },
      chartTitleOverrides: {},
      chartVisualOverrides: { pointSize: undefined, facetField: null },
      barStackMode: "grouped",
      connectScatterTrail: false,
      showMarginals: false,
      appSettings: { chartAspect: "free", chartDevice: "auto" },
    });
    expect(link).not.toBeNull();
    const p = payload(encodeChartLink(link!));
    expect(p).toEqual({ v: 1, src: "mock://sales.csv", c: { k: "scatter", x: "units", y: "revenue" } });
    // Specs / rows never ride along.
    expect(JSON.stringify(p)).not.toContain("xxxx");
  });

  it("rejects malformed, unknown, and future links", () => {
    expect(decodeChartLink("")).toBeNull();
    expect(decodeChartLink("#dive=abc")).toBeNull();
    expect(decodeChartLink("#chart=!!!")).toBeNull();
    expect(decodeChartLink(`#chart=${b64urlEncode("not json")}`)).toBeNull();
    expect(decodeChartLink(`#chart=${b64urlEncode("[1,2]")}`)).toBeNull();
    const bad = (o: unknown) => decodeChartLink(`#chart=${b64urlEncode(JSON.stringify(o))}`);
    expect(bad({ v: 1, src: "mock://a.csv", c: { k: "notAChart", x: "a" } })).toBeNull();
    expect(bad({ v: 1, src: "mock://a.csv", c: { k: "bar" } })).toBeNull();
    expect(bad({ v: 1, c: { k: "bar", x: "a" } })).toBeNull();
    expect(bad({ v: 99, src: "mock://a.csv", c: { k: "bar", x: "a" } })).toBeNull();
  });

  it("drops invalid optional values instead of failing", () => {
    const enc = `chart=${b64urlEncode(
      JSON.stringify({
        v: 1,
        src: "mock://a.csv",
        u: "javascript:alert(1)",
        c: { k: "bar", x: "a", a: "median", tf: ["a", 3] },
        vo: { colorPalette: "seq-blue", nested: { x: 1 }, __proto__x: 1 },
        bs: "sideways",
        ar: "7:3",
        dv: "watch",
      }),
    )}`;
    expect(decodeChartLink(enc)).toEqual({
      src: "mock://a.csv",
      chart: { kind: "bar", xField: "a", tooltipFields: ["a"] },
      visual: { colorPalette: "seq-blue" },
    });
  });

  it("shares only the file name for local paths, and knows what's portable", () => {
    expect(chartLinkSrc({ path: "/Users/me/data/sales.csv", name: "sales.csv" })).toBe("file:sales.csv");
    expect(chartLinkSrc({ path: "stream://wiki", name: "Wikipedia Live" })).toBe("stream://wiki");
    expect(chartLinkMatchesFile({ src: "file:sales.csv" }, { path: "/other/dir/sales.csv", name: "sales.csv" })).toBe(true);
    expect(chartLinkMatchesFile({ src: "mock://sales.csv" }, { path: "mock://other.csv", name: "other.csv" })).toBe(false);
    expect(isPortableChartLink({ src: "stream://usgs" })).toBe(true);
    expect(isPortableChartLink({ src: "web://x.csv", url: "https://example.org/x.csv" })).toBe(true);
    expect(isPortableChartLink({ src: "web://x.csv" })).toBe(false);
    expect(isPortableChartLink({ src: "file:x.csv" })).toBe(false);
  });

  it("restores the same chart from columns, keeping story titles and extra channels", () => {
    const original = createChartRec("bar", columns, "region", "revenue", "product", "sales", { yAggregate: "mean", barStackMode: "stacked" })!;
    const link = chartLinkFromState({
      selectedFile: { path: "mock://sales.csv", name: "sales.csv" },
      activeChart: { ...original, title: "Hand-written story title" },
      chartTitleOverrides: { [original.id]: "Edited headline" },
      barStackMode: "stacked",
    })!;
    const decoded = decodeChartLink(encodeChartLink(link))!;
    expect(decoded.titleOverride).toBe("Edited headline");
    const rec = restoreChartRec(decoded, columns, [], "sales")!;
    expect(rec.kind).toBe("bar");
    expect(rec.xField).toBe("region");
    expect(rec.yField).toBe("revenue");
    expect(rec.colorField).toBe("product");
    expect(rec.yAggregate).toBe("mean");
    expect(rec.title).toBe("Hand-written story title");
    expect(rec.id).toBe(original.id);
  });

  it("round-trips a Time window on the chart payload", () => {
    const original = createChartRec("bar", columns, "region", "revenue", null, "sales", {
      timeWindowField: "date",
      timeWindow: "24h",
    })!;
    expect(original.timeWindow).toBe("24h");
    expect(original.timeWindowField).toBe("date");
    const link = chartLinkFromState({
      selectedFile: { path: "mock://sales.csv", name: "sales.csv" },
      activeChart: original,
    })!;
    const decoded = decodeChartLink(encodeChartLink(link))!;
    expect(decoded.chart.timeWindow).toBe("24h");
    expect(decoded.chart.timeWindowField).toBe("date");
    const rec = restoreChartRec(decoded, columns, [], "sales")!;
    expect(rec.timeWindow).toBe("24h");
    expect(rec.timeWindowField).toBe("date");
  });

  it("prefers an identical rec already in the rail (keeps its spec)", () => {
    const story: ChartRecommendation = {
      id: "story-1",
      kind: "scatter",
      title: "Quakes",
      subtitle: "",
      score: 90,
      spec: {},
      xField: "units",
      yField: "revenue",
      colorField: null,
      timeField: "date",
    };
    const link = chartLinkFromState({ selectedFile: { path: "stream://usgs", name: "USGS" }, activeChart: story })!;
    expect(restoreChartRec(link, columns, [story], "usgs")).toEqual(story);
  });

  it("returns null when the dataset lacks a column the chart uses", () => {
    const link: ChartLink = { src: "mock://a.csv", chart: { kind: "bar", xField: "region", yField: "profit" } };
    expect(restoreChartRec(link, columns, [], "a")).toBeNull();
  });
});
