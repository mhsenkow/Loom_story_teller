import { describe, expect, it } from "vitest";
import { socialKey, socialKindFromPath, socialLinkFor, socialTargetFromState, socialTitleFromLink } from "../socialKey";
import { canonicalLink } from "../../../workers/socialCore";
import { communityBoost, isBuried, sortByCommunity, wilsonLower, formatSocialAgo, formatSocialCount } from "../socialRank";
import { decodeChartLink } from "../chartLink";
import { recipeKeyFromLinkPayload } from "../socialRecipe";
import type { ChartRecommendation } from "../recs/types";

const chart = (over: Partial<ChartRecommendation> = {}): ChartRecommendation => ({
  id: "c1",
  kind: "bar",
  title: "Launches by rocket",
  subtitle: "",
  score: 90,
  spec: {},
  xField: "rocket",
  yField: null,
  colorField: "outcome",
  yAggregate: "count",
  barStackMode: "stacked",
  ...over,
});

describe("socialKey", () => {
  it("keys public feeds by recipe, ignoring title, id, score and look", () => {
    const a = socialKey("spacex", chart());
    expect(a).toMatch(/^spacex:[a-z0-9]{1,16}$/);
    expect(socialKey("spacex", chart({ id: "other", title: "Renamed", score: 10, tooltipFields: ["x"] }))).toBe(a);
    expect(socialKey("spacex", chart({ barStackMode: "grouped" }))).not.toBe(a);
    expect(socialKey("spacex", chart({ topN: 5 }))).not.toBe(a);
    expect(socialKey("hn", chart())).not.toBe(a);
  });

  it("treats empty and default settings as absent", () => {
    expect(socialKey("usgs", chart({ timeWindow: "all", colorField: null }))).toBe(socialKey("usgs", chart({ colorField: undefined })));
  });

  it("only recognizes public live-feed paths", () => {
    expect(socialKindFromPath("stream://usgs")).toBe("usgs");
    expect(socialKindFromPath("web://salaries.csv")).toBeNull();
    expect(socialKindFromPath("/Users/me/private.parquet")).toBeNull();
  });

  it("never makes a community item for someone's own file", () => {
    const state = {
      activeChart: chart(),
      selectedFile: { path: "web://payroll.csv", name: "payroll.csv" },
      chartTitleOverrides: {},
    } as unknown as Parameters<typeof socialTargetFromState>[0];
    expect(socialTargetFromState(state)).toBeNull();
    expect(socialLinkFor("web://payroll.csv", "payroll.csv", chart())).toBeUndefined();
  });

  it("builds a link that reopens the same recipe (including stacking) on the feed", () => {
    const link = socialLinkFor("stream://spacex", "SpaceX", chart({ title: "My private rename", subtitle: "notes to self" }));
    const decoded = decodeChartLink(link!);
    expect(decoded?.src).toBe("stream://spacex");
    expect(decoded?.chart).toMatchObject({ kind: "bar", xField: "rocket", colorField: "outcome" });
    expect(decoded?.barStackMode).toBe("stacked");
    // Titles and notes stay on this device.
    expect(decoded?.titleOverride).toBeUndefined();
    expect(Buffer.from(link!.slice(6), "base64url").toString("utf8")).not.toMatch(/private|notes/);
    expect(socialTitleFromLink(link)).toBe("Count by rocket and outcome");
  });

  it("survives the server's link clean-up with the same key", () => {
    const columns = ["rocket", "outcome", "ts", "magnitude", "a", "b", "c", "d", "e", "f"];
    const recipes: Partial<ChartRecommendation>[] = [
      {},
      { barStackMode: "percent", topN: 10 },
      { kind: "line", xField: "ts", yField: "magnitude", yAggregate: "max", timeWindow: "24h", timeWindowField: "ts", rollingWindow: 7, colorField: null, barStackMode: null },
      { kind: "scatter", xField: "a", yField: "b", sizeField: "c", rowField: "d", y2Field: "e", zField: "f" },
    ];
    for (const r of recipes) {
      const c = chart(r);
      const server = canonicalLink(socialLinkFor("stream://usgs", "USGS", c), "usgs", columns);
      expect(server?.key).toBe(socialKey("usgs", c));
      // And the cleaned link still reopens the same recipe.
      const reopened = decodeChartLink(server!.link)!;
      expect(reopened.chart.kind).toBe(c.kind);
      expect(reopened.chart.xField).toBe(c.xField);
    }
  });

  it("computes the same key in the app and on the server (from the chart's link)", () => {
    const recipes: Partial<ChartRecommendation>[] = [
      {},
      { barStackMode: "grouped" },
      { barStackMode: "percent", topN: 10 },
      { kind: "line", xField: "ts", yField: "magnitude", yAggregate: "max", timeWindow: "24h", rollingWindow: 7, colorField: null, barStackMode: null },
      { kind: "wordCloud", wordCloudMode: "compare", anomalyHighlight: true },
      { kind: "bump", bumpMode: "delta", seriesNormalize: "zscore", timeWindow: "all" },
      { kind: "scatter", xField: "a", yField: "b", sizeField: "c", rowField: "d", y2Field: "e", zField: "f" },
    ];
    for (const r of recipes) {
      const c = chart(r);
      const link = socialLinkFor("stream://usgs", "USGS", c)!;
      const payload = JSON.parse(Buffer.from(link.slice(6), "base64url").toString("utf8"));
      expect(recipeKeyFromLinkPayload("usgs", payload)).toBe(socialKey("usgs", c));
    }
  });

  it("keys the open chart by the recipe on screen, with a title that stays local", () => {
    const state = {
      activeChart: chart({ id: "opened" }),
      selectedFile: { path: "stream://spacex", name: "SpaceX" },
      chartTitleOverrides: { opened: "Falcon 9 dominates" },
    } as unknown as Parameters<typeof socialTargetFromState>[0];
    const target = socialTargetFromState(state)!;
    expect(target.key).toBe(socialKey("spacex", chart()));
    expect(target.title).toBe("Falcon 9 dominates");
    expect(Buffer.from(target.link!.slice(6), "base64url").toString("utf8")).not.toContain("Falcon 9 dominates");
  });
});

describe("socialRank", () => {
  it("nudges loved charts up a little and sinks widely disliked ones", () => {
    expect(communityBoost(undefined)).toBe(0);
    expect(communityBoost([1, 0, 0])).toBeGreaterThan(0);
    expect(communityBoost([40, 0, 40])).toBeLessThanOrEqual(8.5);
    expect(communityBoost([1, 3, 0])).toBeLessThan(0);
    expect(isBuried([1, 9, 0])).toBe(true);
    expect(isBuried([1, 3, 0])).toBe(false); // too few votes to bury
    expect(communityBoost([1, 9, 0])).toBe(-30);
  });

  it("sorts favorites, discussion, divisive and least liked; quiet items keep their order last", () => {
    const counts: Record<string, [number, number, number]> = {
      loved: [20, 1, 0],
      lucky: [1, 0, 0],
      talked: [2, 2, 9],
      split: [10, 9, 1],
      hated: [0, 8, 2],
    };
    const items = ["quiet1", "hated", "lucky", "split", "loved", "talked", "quiet2"];
    const by = (mode: Parameters<typeof sortByCommunity>[1]) => sortByCommunity(items, mode, (k) => counts[k]);
    expect(by("community").slice(0, 3)).toEqual(["loved", "split", "lucky"]);
    // No favorite signal (tied, disliked, or no votes): incoming order, after the favorites.
    expect(by("community").slice(3)).toEqual(["quiet1", "hated", "talked", "quiet2"]);
    expect(by("discussed")[0]).toBe("talked");
    expect(by("divisive")[0]).toBe("split");
    expect(by("leastLiked")[0]).toBe("hated");
  });

  it("formats counts and ages for small labels", () => {
    expect(wilsonLower(9, 1)).toBeGreaterThan(wilsonLower(1, 0));
    expect(formatSocialCount(999)).toBe("999");
    expect(formatSocialCount(1250)).toBe("1.3k");
    const now = Date.UTC(2026, 10, 11, 12);
    expect(formatSocialAgo(now - 20_000, now)).toBe("just now");
    expect(formatSocialAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(formatSocialAgo(now - 3 * 3_600_000, now)).toBe("3h");
  });
});
