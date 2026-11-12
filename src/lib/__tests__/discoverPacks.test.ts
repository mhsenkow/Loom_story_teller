import { describe, expect, it } from "vitest";
import { packDiscoverCache, unpackDiscoverCache } from "../discoverDailyCache";
import { qualifyDiscoverChart } from "../discoverChartQuality";
import { discoverRefreshInterval } from "../discoverFreshness";
import {
  discoverPacksForScan,
  thinDiscoverRows,
} from "../discoverPacks";
import { balanceDiscoverPacks, keepDiscoverPackLeads, surfaceDiscoverPacks } from "../discoverRanking";
import { applyDiversityFilters, discoverSourceBrief, type DiscoverStory } from "../discoverStories";
import type { ChartRecommendation } from "../recommendations";

function story(id: string, kind: DiscoverStory["kind"], score: number, headline = false): DiscoverStory {
  return {
    id,
    kind,
    streamPath: kind.startsWith("pack:") ? `web://pack/${kind.slice(5)}` : `stream://${kind}`,
    fileName: id,
    hook: id,
    blurb: id,
    category: "Open data",
    chartKind: "scatter",
    chart: {
      id: `${id}-chart`,
      kind: "scatter",
      title: id,
      subtitle: "",
      score,
      spec: {},
      xField: "x",
      yField: "y",
      colorField: null,
    },
    score,
    stats: [],
    sample: { columns: ["x", "y"], types: ["DOUBLE", "DOUBLE"], rows: [[1, 2]], total_rows: 1 },
    headline,
  };
}

describe("discover packs", () => {
  it("skips the oversized power-plant file and leaves live-only refreshes alone", () => {
    const ids = discoverPacksForScan().map((pack) => pack.id);
    expect(ids).not.toContain("power-plants");
    expect(ids).toContain("gapminder");
    expect(ids.indexOf("gapminder")).toBeLessThan(ids.indexOf("owid-co2-per-capita"));
    expect(discoverPacksForScan(["usgs", "wiki"])).toEqual([]);
    expect(discoverPacksForScan(["pack:airline-safety"]).map((pack) => pack.id)).toEqual(["airline-safety"]);
  });

  it("strides long tables so the span survives the cache cap", () => {
    const sample = {
      columns: ["year"],
      types: ["DOUBLE"],
      rows: [[2000], [2001], [2002], [2003], [2004]],
      total_rows: 5,
    };
    const thin = thinDiscoverRows(sample, 2);
    expect(thin.rows).toEqual([[2000], [2003]]);
    expect(thin.total_rows).toBe(5);
    expect(thinDiscoverRows(sample, 5)).toBe(sample);
  });

  it("keeps public-table headlines inside a gallery full of live feeds", () => {
    const live = [story("a", "usgs", 99, true), story("b", "hn", 98, true)];
    const pack = story("g", "pack:gapminder", 70, true);
    const kept = keepDiscoverPackLeads(live, [...live, pack], 2);
    expect(kept.map((item) => item.kind)).toContain("pack:gapminder");
    expect(kept).toHaveLength(2);
  });

  it("weaves a public table into the opening screen", () => {
    const groups = ["usgs", "hn", "meteo", "crypto", "pack:gapminder"].map((kind) => ({
      stories: [{ kind }],
    }));
    const woven = surfaceDiscoverPacks(groups, 1, 2);
    expect(woven.map((group) => group.stories[0]!.kind)).toEqual([
      "usgs",
      "pack:gapminder",
      "hn",
      "meteo",
      "crypto",
    ]);
  });

  it("puts live feeds back on the first screen when public tables would fill it", () => {
    const groups = [
      "pack:gapminder",
      "pack:keeling-curve",
      "pack:airline-safety",
      "usgs",
      "hn",
      "pack:gapminder",
    ].map((kind) => ({ stories: [{ kind }] }));
    const woven = surfaceDiscoverPacks(groups, 1, 3);
    expect(woven.slice(0, 3).map((group) => group.stories[0]!.kind)).toEqual([
      "usgs",
      "hn",
      "pack:gapminder",
    ]);
    expect(woven.map((group) => group.stories[0]!.kind)).toContain("pack:keeling-curve");
    expect(woven.map((group) => group.stories[0]!.kind)).toContain("pack:airline-safety");
  });

  it("keeps live feeds in an iPad-sized gallery", () => {
    const packs = ["gapminder", "keeling-curve", "airline-safety", "brent-oil"].flatMap((id) =>
      [0, 1, 2, 3].map((n) => story(`${id}-${n}`, `pack:${id}`, 99 - n, n === 0)),
    );
    const live = ["usgs", "hn", "crypto", "meteo"].flatMap((kind) =>
      [0, 1, 2].map((n) => story(`${kind}-${n}`, kind as DiscoverStory["kind"], 70 - n, n === 0)),
    );
    const balanced = applyDiversityFilters([...packs, ...live], 12);
    const packCount = balanced.filter((item) => item.kind.startsWith("pack:")).length;
    expect(packCount).toBeLessThanOrEqual(Math.round(12 * 0.4));
    expect(balanced.some((item) => item.kind === "usgs")).toBe(true);
    expect(balanced.filter((item) => item.kind === "pack:gapminder").length).toBeLessThanOrEqual(2);
    expect(balanceDiscoverPacks(live, live, 10_000)).toEqual(live);
  });

  it("describes a pack without a live-feed registry entry", () => {
    expect(discoverSourceBrief("pack:gapminder").label).toBe("Gapminder: wealth & health");
    const chart: ChartRecommendation = {
      id: "c",
      kind: "scatter",
      title: "Life",
      subtitle: "",
      score: 80,
      spec: {},
      xField: "year",
      yField: "life",
      colorField: null,
    };
    expect(qualifyDiscoverChart("pack:gapminder", chart)).toEqual(chart);
    expect(
      qualifyDiscoverChart("pack:gapminder", { ...chart, kind: "pyramid", sizeField: "gdp" }),
    ).toBeNull();
    expect(discoverRefreshInterval("pack:gapminder")).toBe(86_400_000);
  });

  it("round-trips a public table through the daily cache", () => {
    const packed = packDiscoverCache([
      {
        ...story("gap", "pack:gapminder", 80, true),
        sourceUrl: "https://example.com/gapminder.csv",
        sourceCredit: "Gapminder",
        sourceHome: "https://example.com/gapminder.csv",
        chart: {
          id: "gap-chart",
          kind: "scatter",
          title: "Wealth",
          subtitle: "",
          score: 80,
          spec: {},
          xField: "x",
          yField: "y",
          colorField: null,
        },
      },
    ]);
    const restored = unpackDiscoverCache(packed);
    expect(restored?.stories[0]?.kind).toBe("pack:gapminder");
    expect(restored?.stories[0]?.streamPath).toBe("web://pack/gapminder");
    expect(restored?.stories[0]?.sourceUrl).toBe("https://example.com/gapminder.csv");
    expect(restored?.stories[0]?.fileName).toBe("Gapminder: wealth & health");
  });
});
