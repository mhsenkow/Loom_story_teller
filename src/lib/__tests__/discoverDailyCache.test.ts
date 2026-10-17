// Daily cache durability, deduplication and calendar-day policy.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  isDiscoverCacheFresh,
  packDiscoverCache,
  readDiscoverDailyCache,
  unpackDiscoverCache,
  writeDiscoverDailyCache,
} from "../discoverDailyCache";
import type { DiscoverStory } from "../discoverStories";

const story: DiscoverStory = {
  id: "hn",
  kind: "hn",
  streamPath: "stream://hn",
  fileName: "Hacker News",
  category: "News",
  chartKind: "scatter",
  score: 90,
  hook: "A story worth reading",
  blurb: "Discussion and votes",
  capturedAt: Date.now(),
  stats: [],
  chart: {
    id: "hn-chart",
    kind: "scatter",
    title: "Engagement",
    subtitle: "",
    score: 90,
    spec: {},
    xField: "points",
    yField: "comments",
    colorField: null,
  },
  sample: {
    columns: ["points", "comments"],
    types: ["DOUBLE", "DOUBLE"],
    rows: [
      [120, 30],
      [60, 20],
    ],
    total_rows: 2,
  },
};

describe("daily discovery cache", () => {
  it("expires at a new local calendar day, including a midnight reopen", () => {
    const late = new Date(2026, 9, 15, 23, 59).getTime();
    expect(isDiscoverCacheFresh(late, late + 30_000)).toBe(true);
    expect(isDiscoverCacheFresh(late, late + 120_000)).toBe(false);
    expect(isDiscoverCacheFresh(null, late)).toBe(false);
    expect(isDiscoverCacheFresh(late + 100, late)).toBe(false);
  });

  it("stores each feed once and restores shared snapshots with saved-data labels", () => {
    const packed = packDiscoverCache([
      story,
      { ...story, id: "hn-alt", hook: "Another perspective" },
    ]);
    expect(packed.feeds).toHaveLength(1);
    expect(packed.ideas).toHaveLength(2);
    const restored = unpackDiscoverCache(packed)!;
    expect(restored.stories[0]?.sample).toBe(restored.stories[1]?.sample);
    expect(restored.stories[0]?.chart).toEqual(story.chart);
    expect(restored.stories[0]?.snapshotCached).toBe(true);
  });

  it("ignores corrupt, incompatible and week-old records", () => {
    const packed = packDiscoverCache([story]);
    expect(unpackDiscoverCache({ ...packed, version: 99 })).toBeNull();
    expect(
      unpackDiscoverCache({ ...packed, savedAt: Date.now() - 8 * 86_400_000 }),
    ).toBeNull();
    expect(unpackDiscoverCache({ ...packed, feeds: [] })).toBeNull();
    expect(
      unpackDiscoverCache({
        ...packed,
        ideas: [{ ...packed.ideas[0], chart: { kind: "made-up" } }],
      }),
    ).toBeNull();
  });

  it("keeps old-algorithm picks visible but marks them due for a broader scan", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const packed = packDiscoverCache([story], now);
    const legacy = unpackDiscoverCache({ ...packed, algorithm: undefined }, now)!;
    expect(legacy.stories).toHaveLength(1);
    expect(isDiscoverCacheFresh(legacy.savedAt, now)).toBe(false);
    expect(isDiscoverCacheFresh(unpackDiscoverCache(packed, now)!.savedAt, now)).toBe(true);
  });

  it("survives a reload and never lets a slower older scan replace newer picks", async () => {
    const savedAt = Date.now();
    await writeDiscoverDailyCache([story], savedAt);
    await writeDiscoverDailyCache(
      [{ ...story, hook: "Older scan" }],
      savedAt - 60_000,
    );
    const restored = await readDiscoverDailyCache();
    expect(restored?.savedAt).toBe(savedAt);
    expect(restored?.stories[0]?.hook).toBe(story.hook);
    expect(restored?.stories[0]?.sample.rows).toEqual(story.sample.rows);
  });

  it("falls back to session memory when durable storage is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      await expect(readDiscoverDailyCache()).resolves.toBeNull();
      await expect(writeDiscoverDailyCache([story])).resolves.toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });
});
