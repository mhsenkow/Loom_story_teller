// Freshness is tied to source checks, grouping preserves recipes, and copy stays factual.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverFreshness,
  discoverRefreshInterval,
  dueDiscoverKinds,
} from "../discoverFreshness";
import {
  editorialDiscoverStory,
  readableDiscoverText,
} from "../discoverEditorial";
import { groupDiscoverStories } from "../discoverPresentation";
import {
  DEFAULT_DISCOVER_BROWSE,
  readDiscoverBrowseState,
  saveDiscoverBrowseState,
} from "../discoverBrowseState";
import type { DiscoverStory } from "../discoverStories";

const now = Date.UTC(2026, 9, 16, 2);
const base: DiscoverStory = {
  id: "weather",
  kind: "meteo",
  streamPath: "stream://meteo",
  fileName: "Weather",
  category: "Weather",
  hook: "wind_speed by city",
  blurb: "23 cities in this snapshot",
  chartKind: "bar",
  score: 80,
  capturedAt: now - 120_000,
  stats: [],
  chart: {
    id: "bar",
    kind: "bar",
    title: "wind_speed by city",
    subtitle: "",
    score: 80,
    spec: {},
    xField: "city",
    yField: "wind_speed",
    colorField: null,
  },
  sample: {
    columns: ["city", "wind_speed"],
    types: ["VARCHAR", "DOUBLE"],
    rows: [["Detroit", 12]],
    total_rows: 1,
  },
};
afterEach(() => vi.unstubAllGlobals());

describe("discovery refinements", () => {
  it("uses feed cadence rather than observation dates or the full-scan timestamp", () => {
    expect(discoverRefreshInterval("iss")).toBe(60_000);
    expect(discoverRefreshInterval("climate")).toBe(86_400_000);
    expect(discoverFreshness(base, now)).toMatchObject({
      due: false,
      label: "Checked 2m ago",
      shortLabel: "2m",
    });
    expect(discoverFreshness({ ...base, kind: "usgs" }, now).due).toBe(true);
    expect(
      discoverFreshness({ ...base, capturedAt: now - 86_400_000 }, now),
    ).toMatchObject({ label: "Checked 1d ago", shortLabel: "1d" });
    expect(discoverFreshness({ ...base, capturedAt: undefined }, now).due).toBe(
      true,
    );
    expect(
      discoverFreshness({ ...base, capturedAt: now + 120_000 }, now),
    ).toMatchObject({ label: "Check time unknown", shortLabel: "?" });
  });

  it("bounds refresh work, removes duplicate feeds and backs off failed checks", () => {
    const pool = ["usgs", "crypto", "hn"].map((kind) => ({
      ...base,
      kind,
      capturedAt: now - 3_600_000,
    })) as DiscoverStory[];
    expect(
      dueDiscoverKinds(pool, ["hn", "usgs", "hn", "crypto"], new Map(), now, 2),
    ).toEqual(["hn", "usgs"]);
    expect(
      dueDiscoverKinds(
        pool,
        ["hn", "usgs"],
        new Map([["hn", now - 60_000]]),
        now,
      ),
    ).toEqual(["usgs"]);
    expect(
      dueDiscoverKinds(pool, ["hn"], new Map([["hn", now - 300_000]]), now),
    ).toEqual(["hn"]);
  });

  it("groups views of one question but keeps different measures and windows separate", () => {
    const line = {
      ...base,
      id: "line",
      chartKind: "lollipop",
      chart: { ...base.chart, kind: "lollipop" as const, yScale: "log" as const },
    };
    const other = {
      ...base,
      id: "other",
      chart: { ...base.chart, yField: "temperature" },
    };
    const timed = {
      ...base,
      id: "timed",
      chart: {
        ...base.chart,
        timeWindow: "24h" as const,
        timeWindowField: "ts",
      },
    };
    const groups = groupDiscoverStories([base, line, other, timed]);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.stories).toEqual([base, line]);
    expect(groups[0]?.stories[1]?.chart).toBe(line.chart);
    expect(base.chart.kind).toBe("bar");
  });

  it("turns raw fields into readable copy without changing numerical claims", () => {
    expect(editorialDiscoverStory(base)).toMatchObject({
      hook: "Wind speed by city",
      blurb: base.blurb,
      chart: base.chart,
    });
    expect(
      readableDiscoverText("gdp_per_capita ↔ life_expectancy by country", [
        "gdp_per_capita",
        "life_expectancy",
        "country",
      ]),
    ).toBe("GDP per person ↔ life expectancy by country");
    expect(readableDiscoverText("price_usd rose 23.8%", ["price_usd"])).toBe(
      "Price in USD rose 23.8%",
    );
    expect(
      readableDiscoverText("num_comment_count and comment_count", [
        "comment_count",
      ]),
    ).toBe("Num_comment_count and comments");
  });

  it("restores bounded browse preferences and tolerates unavailable storage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const state = {
      ...DEFAULT_DISCOVER_BROWSE,
      layout: "masonry" as const,
      search: "carbon",
      shownCount: 72,
      scrollTop: 450,
    };
    saveDiscoverBrowseState(state);
    expect(readDiscoverBrowseState()).toEqual(state);
    storage.set(
      "loom-discover-browse-v1",
      JSON.stringify({
        version: 1,
        layout: "invalid",
        shownCount: 1e9,
        scrollTop: -10,
      }),
    );
    expect(readDiscoverBrowseState()).toMatchObject({
      layout: "flow",
      shownCount: 10_000,
      scrollTop: 0,
    });
    storage.set("loom-discover-browse-v1", "broken json");
    expect(readDiscoverBrowseState()).toEqual(DEFAULT_DISCOVER_BROWSE);
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => saveDiscoverBrowseState(state)).not.toThrow();
    expect(readDiscoverBrowseState()).toEqual(DEFAULT_DISCOVER_BROWSE);
  });
});
