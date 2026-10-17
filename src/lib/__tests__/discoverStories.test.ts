// =================================================================
// Discover hook unit tests
// =================================================================

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  DISCOVER_SEEN_KEY,
  DISCOVER_STORY_LIMIT,
  DISCOVER_STORY_LIMIT_MOBILE,
  VARIANTS_PER_SOURCE,
  VARIANTS_PER_SOURCE_MOBILE,
  applyDiversityFilters,
  clearDiscoverForceRequest,
  clearDiscoverStoryCache,
  consumeDiscoverForceRequest,
  discoverHookFor,
  discoverSourceBrief,
  discoverStoryLimit,
  getDiscoverScanSummary,
  getDiscoverStoryCache,
  requestDiscoverScan,
  setDiscoverStoryCache,
  type DiscoverStory,
} from "../discoverStories";
import type { ChartRecommendation } from "../recommendations";
import { ALL_SOURCE_KINDS } from "../tauri";
import { SOURCE_BY_KIND, SOURCE_DEFS, sortRowsByOrderBy } from "../sourceRegistry";

describe("discoverStories", () => {
  afterEach(() => {
    clearDiscoverStoryCache();
    clearDiscoverForceRequest();
    vi.unstubAllGlobals();
  });

  it("requestDiscoverScan leaves a pending force for late-mounted Onboarding", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { removeItem: vi.fn() },
      dispatchEvent: dispatch,
    });
    expect(consumeDiscoverForceRequest()).toBe(false);
    requestDiscoverScan();
    expect(dispatch).toHaveBeenCalled();
    expect(consumeDiscoverForceRequest()).toBe(true);
    expect(consumeDiscoverForceRequest()).toBe(false);
  });

  it("exports the dismiss key used by Onboarding", () => {
    expect(DISCOVER_SEEN_KEY).toBe("loom-discover-v1");
  });

  it("discoverSourceBrief returns TLDR + credit for live feeds and wiki", () => {
    const usgs = discoverSourceBrief("usgs");
    expect(usgs.label).toMatch(/earthquake/i);
    expect(usgs.tldr.length).toBeGreaterThan(20);
    expect(usgs.credit).toBeTruthy();
    expect(usgs.homepage).toMatch(/^https?:\/\//);
    const wiki = discoverSourceBrief("wiki");
    expect(wiki.label).toMatch(/wiki/i);
    expect(wiki.credit).toMatch(/CC BY-SA/i);
  });

  it("keeps room for many chart variants across every live feed", () => {
    expect(ALL_SOURCE_KINDS.length).toBe(36);
    expect(VARIANTS_PER_SOURCE).toBeGreaterThanOrEqual(20);
    expect(DISCOVER_STORY_LIMIT).toBeGreaterThanOrEqual(10_000);
    expect(DISCOVER_STORY_LIMIT).toBeGreaterThanOrEqual(ALL_SOURCE_KINDS.length * VARIANTS_PER_SOURCE);
  });

  it("caps the mobile gallery at 120 after considering the full per-feed breadth", () => {
    expect(DISCOVER_STORY_LIMIT_MOBILE).toBe(120);
    expect(VARIANTS_PER_SOURCE_MOBILE).toBe(VARIANTS_PER_SOURCE);
    expect(VARIANTS_PER_SOURCE_MOBILE * ALL_SOURCE_KINDS.length).toBeGreaterThanOrEqual(
      DISCOVER_STORY_LIMIT_MOBILE,
    );
  });

  it("discoverStoryLimit uses the mobile cap on iPad-class UA", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });
    expect(discoverStoryLimit()).toBe(DISCOVER_STORY_LIMIT_MOBILE);
  });

  it("keeps a session cache for reopen-without-rescan", () => {
    expect(getDiscoverStoryCache()).toBeNull();
    const stub = [{ id: "discover-usgs", score: 90 } as DiscoverStory];
    setDiscoverStoryCache(stub);
    expect(getDiscoverStoryCache()).toEqual(stub);
    clearDiscoverStoryCache();
    expect(getDiscoverStoryCache()).toBeNull();
  });

  it("sortRowsByOrderBy puts soonest launches first (net ASC)", () => {
    const cols = ["name", "net"];
    const rows = [
      ["Late", "2026-12-01T00:00:00Z"],
      ["Soon", "2026-10-08T12:00:00Z"],
      ["Mid", "2026-11-01T00:00:00Z"],
    ];
    const ordered = sortRowsByOrderBy(rows, cols, "net ASC");
    expect(ordered.map((r) => r[0])).toEqual(["Soon", "Mid", "Late"]);
  });

  it("sortRowsByOrderBy honors DESC and multi-key clauses", () => {
    const cols = ["as_of", "quote", "rate"];
    const rows = [
      ["2026-01-01", "USD", 1.1],
      ["2026-01-02", "JPY", 160],
      ["2026-01-02", "USD", 1.08],
    ];
    const ordered = sortRowsByOrderBy(rows, cols, "as_of DESC, quote");
    expect(ordered[0]).toEqual(["2026-01-02", "JPY", 160]);
    expect(ordered[1]).toEqual(["2026-01-02", "USD", 1.08]);
  });

  it("exposes discover scan summary defaults", () => {
    expect(getDiscoverScanSummary().failedKinds).toEqual([]);
  });

  it("headlines G1 when Kp peak is 4.67 (spaceweather hook)", () => {
    const sample = {
      columns: ["kp", "storm_level", "ts"],
      types: ["DOUBLE", "VARCHAR", "TIMESTAMP"],
      rows: [[4.67, "G1", "2026-10-12T12:00:00Z"]],
      total_rows: 1,
    };
    const chart = {
      id: "c1",
      kind: "line",
      title: "Kp",
      subtitle: "",
      score: 80,
      spec: {},
      xField: "ts",
      yField: "kp",
      colorField: null,
    } as ChartRecommendation;
    const hook = discoverHookFor("spaceweather", sample, chart);
    expect(hook.hook).toMatch(/G1/i);
  });

  it("every live source has an orderBy Discover/web snapshots can apply", () => {
    for (const def of SOURCE_DEFS) {
      expect(def.orderBy.trim().length).toBeGreaterThan(0);
      expect(SOURCE_BY_KIND[def.kind].orderBy).toBe(def.orderBy);
    }
  });

  it("applyDiversityFilters caps one source when the candidate pool is huge", () => {
    const mk = (
      kind: DiscoverStory["kind"],
      category: string,
      chartKind: string,
      n: number,
      baseScore: number,
    ): DiscoverStory[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `${kind}-${i}`,
        kind,
        streamPath: `stream://${kind}`,
        fileName: kind,
        hook: `${kind} ${i}`,
        blurb: "",
        category,
        chartKind,
        chart: {
          id: `${kind}-c-${i}`,
          kind: chartKind,
          title: "",
          subtitle: "",
          score: baseScore,
          spec: {},
          xField: "x",
          yField: null,
          colorField: null,
        },
        score: baseScore - i * 0.01,
        stats: [],
        sample: { columns: [], types: [], rows: [], total_rows: 0 },
      })) as DiscoverStory[];

    // Five well-stocked sources so the grid can fill without relaxing the source cap.
    const stories = [
      ...mk("usgs", "Earth", "geoPoints", 40, 95),
      ...mk("crypto", "Markets", "scatter", 40, 90),
      ...mk("steam", "Culture", "bar", 40, 85),
      ...mk("iss", "Space", "globeTrail", 40, 80),
      ...mk("citibike", "Cities", "geoPoints", 40, 75),
    ];
    const top = applyDiversityFilters(stories, 20);
    expect(top).toHaveLength(20);
    const usgs = top.filter((s) => s.kind === "usgs").length;
    expect(usgs).toBeLessThanOrEqual(Math.ceil(20 * 0.2));
    expect(new Set(top.map((s) => s.kind)).size).toBeGreaterThanOrEqual(4);

    // Source affinity decides who makes a tight cap — loved feeds stay, hidden go — without rewriting scores.
    const six = [
      ...mk("usgs", "Earth", "geoPoints", 10, 95),
      ...mk("crypto", "Markets", "scatter", 10, 90),
      ...mk("steam", "Culture", "bar", 10, 85),
      ...mk("iss", "Space", "globeTrail", 10, 80),
      ...mk("hn", "Tech", "line", 10, 75),
      ...mk("citibike", "Cities", "heatmap", 10, 70),
    ];
    expect(new Set(applyDiversityFilters(six, 10).map((s) => s.chartKind)).size).toBeGreaterThanOrEqual(4);
    const prefd = applyDiversityFilters(six, 10, { citibike: 12, usgs: -100 });
    expect(prefd.some((s) => s.kind === "citibike")).toBe(true);
    expect(prefd.some((s) => s.kind === "usgs")).toBe(false);
    expect(prefd.find((s) => s.kind === "citibike")!.score).toBe(70);
    expect(prefd.map((s) => s.score)).toEqual([...prefd.map((s) => s.score)].sort((a, b) => b - a));
  });
});
