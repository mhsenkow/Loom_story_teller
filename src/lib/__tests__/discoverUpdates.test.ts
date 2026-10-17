import { describe, expect, it } from "vitest";
import { planDiscoverRefresh } from "../discoverFreshness";
import {
  changedDiscoverKinds,
  discoverSnapshotFingerprint,
  stampDiscoverDataChanges,
  withDiscoverCheckTimes,
} from "../discoverUpdates";
import type { DiscoverKind, DiscoverStory } from "../discoverStories";

const now = 1_800_000_000_000;
const story = (
  kind: DiscoverKind = "meteo",
  capturedAt = now,
): DiscoverStory => ({
  id: kind,
  kind,
  streamPath: `stream://${kind}`,
  fileName: kind,
  hook: "Observed readings",
  blurb: "",
  category: "Weather",
  score: 90,
  chartKind: "scatter",
  capturedAt,
  chart: {
    id: kind,
    kind: "scatter",
    xField: "x",
    yField: "y",
    colorField: null,
    title: "Readings",
    subtitle: "",
    spec: {},
    score: 90,
  },
  sample: {
    columns: ["x", "y"],
    types: ["DOUBLE", "DOUBLE"],
    rows: [
      [1, 2],
      [2, 3],
    ],
    total_rows: 2,
  },
  stats: [],
});

describe("discovery content updates", () => {
  it("ignores check times, editorial copy, score changes and row ordering", () => {
    const before = story();
    const after = {
      ...before,
      capturedAt: now + 10_000,
      hook: "New copy",
      score: 95,
      chart: { ...before.chart, id: "reranked", score: 99 },
      sample: { ...before.sample, rows: [...before.sample.rows].reverse() },
    };
    expect(discoverSnapshotFingerprint(before.sample)).toBe(
      discoverSnapshotFingerprint(after.sample),
    );
    expect(changedDiscoverKinds([before], [after]).size).toBe(0);
    const checked = withDiscoverCheckTimes([before], [after])[0]!;
    expect(checked.capturedAt).toBe(after.capturedAt);
    expect(checked.chart).toBe(before.chart);
    expect(checked.sample).toBe(before.sample);
  });

  it("detects changed data and recipes, and highlights only new observations", () => {
    const before = story();
    const data = {
      ...before,
      capturedAt: now + 10_000,
      sample: {
        ...before.sample,
        rows: [
          [1, 5],
          [2, 3],
        ],
      },
    };
    expect([...changedDiscoverKinds([before], [data])]).toEqual(["meteo"]);
    expect(stampDiscoverDataChanges([before], [data])[0]?.dataChangedAt).toBe(
      data.capturedAt,
    );
    const recipe = {
      ...before,
      capturedAt: now + 10_000,
      chart: { ...before.chart, shapeField: "group" },
    };
    expect(changedDiscoverKinds([before], [recipe]).size).toBe(1);
    expect(
      stampDiscoverDataChanges([before], [recipe])[0]?.dataChangedAt,
    ).toBeUndefined();
    const marked = { ...before, dataChangedAt: now - 1000 };
    expect(stampDiscoverDataChanges([marked], [recipe])[0]?.dataChangedAt).toBe(
      marked.dataChangedAt,
    );
  });

  it("counts affected sources once and leaves untouched feeds alone", () => {
    const weather = story(),
      quake = story("usgs");
    const newer = { ...weather, sample: { ...weather.sample, total_rows: 3 } };
    expect([
      ...changedDiscoverKinds(
        [weather, quake],
        [newer, { ...newer, id: "alternative" }, quake],
      ),
    ]).toEqual(["meteo"]);
    expect(withDiscoverCheckTimes([quake], [newer])[0]).toBe(quake);
  });
});

describe("rolling discovery refresh", () => {
  it("reserves space for old offscreen feeds and still includes visible due feeds", () => {
    const kinds: DiscoverKind[] = [
      "usgs",
      "meteo",
      "crypto",
      "eonet",
      "wiki",
      "mbta",
      "firms",
      "gdacs",
    ];
    const stories = kinds.map((kind, i) =>
      story(kind, now - (20 - i) * 86_400_000),
    );
    const next = planDiscoverRefresh(
      stories,
      ["gdacs", "firms", "mbta"],
      kinds,
      new Map(),
      now,
    );
    expect(next).toHaveLength(6);
    expect(next.slice(0, 3)).toEqual(["usgs", "meteo", "crypto"]);
    expect(next).toEqual(expect.arrayContaining(["gdacs", "firms", "mbta"]));
    const attempts = new Map(next.map((kind) => [kind, now]));
    const following = planDiscoverRefresh(
      stories,
      ["gdacs"],
      kinds,
      attempts,
      now + 60_000,
    );
    expect(following).toEqual(expect.arrayContaining(["eonet", "wiki"]));
    expect(following.some((kind) => next.includes(kind))).toBe(false);
  });

  it("retries unavailable sources with backoff and skips fresh snapshots", () => {
    const catalog: DiscoverKind[] = ["meteo", "usgs", "wiki"];
    expect(
      planDiscoverRefresh(
        [story()],
        [],
        catalog,
        new Map([["usgs", now]]),
        now,
      ),
    ).toEqual(["wiki"]);
    expect(
      planDiscoverRefresh(
        [story()],
        [],
        catalog,
        new Map([["usgs", now]]),
        now + 300_000,
      ),
    ).toContain("usgs");
    expect(planDiscoverRefresh([], [], catalog, new Map(), now, 0)).toEqual([]);
  });
});
