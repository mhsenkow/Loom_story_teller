// Progressive scan must preserve diversity and isolate cancelled probes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoverStoryCache,
  retainDiscoverFeed,
  scanDiscoverStories,
  stopDiscoverProbes,
  getDiscoverStoryCache,
  setDiscoverStoryCache,
  refreshDiscoverStories,
} from "../discoverStories";
import {
  sourceSnapshot,
  sourceStart,
  sourceStatus,
  sourceStop,
} from "../tauri";
import type { SourceKind } from "../sourceRegistry";
import { SOURCE_EXPLORE_ROWS } from "../sourceRegistry";

vi.mock("../tauri", async (original) => ({
  ...(await original<typeof import("../tauri")>()),
  ALL_SOURCE_KINDS: ["usgs", "meteo", "crypto"],
  sourceStart: vi.fn(async () => {}),
  sourceStop: vi.fn(async () => {}),
  sourceStatus: vi.fn(async () => ({ running: false, buffer_rows: 2 })),
  sourceSnapshot: vi.fn(async () => ({
    stats: [],
    sample: {
      columns: ["x", "y"],
      types: ["DOUBLE", "DOUBLE"],
      rows: [
        [1, 2],
        [2, 3],
      ],
      total_rows: 2,
    },
  })),
}));
vi.mock("../recommendations", () => ({
  recommendSourceStory: (kind: string) => ({
    charts: Array.from({ length: 40 }, (_, i) => ({
      id: `${kind}-${i}`,
      kind: "bar",
      title: `${kind} ${i}`,
      subtitle: "",
      score: 90,
      spec: {},
      xField: "x",
      yField: "y",
      colorField: null,
      topN: i + 1,
    })),
  }),
}));
vi.mock("../discoverHooks", () => ({
  discoverHookFor: (kind: string) => ({
    hook: kind,
    blurb: "",
    score: kind === "usgs" ? 99 : 80,
    category: kind,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  clearDiscoverStoryCache();
  vi.mocked(sourceStart).mockImplementation(async () => {});
  vi.mocked(sourceStatus).mockResolvedValue({
    running: false,
    buffer_rows: 2,
    total_events: 2,
    events_per_sec: 0,
    started_at: null,
    uptime_secs: 0,
  });
});
afterEach(async () => {
  await stopDiscoverProbes();
});

describe("discovery scan", () => {
  it("keeps late source diversity before truncating and snapshots the full chart buffer", async () => {
    let finishCrypto!: () => void;
    vi.mocked(sourceStart)
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishCrypto = resolve;
          }),
      );
    const result = scanDiscoverStories({ limit: 3, includeWiki: false });
    await vi.waitFor(() => expect(finishCrypto).toBeTypeOf("function"));
    finishCrypto();
    const stories = await result;
    expect(new Set(stories.map((story) => story.kind)).size).toBe(3);
    expect(sourceSnapshot).toHaveBeenCalledWith("usgs", SOURCE_EXPLORE_ROWS);
    expect(sourceStop).toHaveBeenCalledTimes(3);
  });

  it("cleans up a source that finishes starting after its scan was cancelled", async () => {
    let finishStart!: () => void;
    vi.mocked(sourceStart).mockImplementation((kind: SourceKind) =>
      kind === "usgs"
        ? new Promise((resolve) => {
            finishStart = resolve;
          })
        : Promise.resolve(),
    );
    const abort = new AbortController();
    const result = scanDiscoverStories({
      includeWiki: false,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(finishStart).toBeTypeOf("function"));
    abort.abort();
    finishStart();
    expect(await result).toEqual([]);
    expect(sourceStop).toHaveBeenCalledWith("usgs");
  });

  it("keeps the selected feed running and leaves pre-existing connections alone", async () => {
    vi.mocked(sourceStart).mockImplementation(async () => {});
    vi.mocked(sourceStatus).mockImplementation(async (kind) => ({
      running: kind === "meteo",
      buffer_rows: 2,
      total_events: 2,
      events_per_sec: 0,
      started_at: null,
      uptime_secs: 0,
    }));
    await scanDiscoverStories({
      includeWiki: false,
      onStory: () => retainDiscoverFeed("usgs"),
    });
    expect(sourceStop).toHaveBeenCalledWith("crypto");
    expect(sourceStop).not.toHaveBeenCalledWith("usgs");
    expect(sourceStop).not.toHaveBeenCalledWith("meteo");
  });

  it("refreshes only requested feeds and leaves the gallery cache intact until merged", async () => {
    const initial = await scanDiscoverStories({ includeWiki: false });
    setDiscoverStoryCache(initial, Date.now() - 60_000);
    vi.mocked(sourceStatus).mockResolvedValue({
      running: true,
      buffer_rows: 2,
      total_events: 2,
      events_per_sec: 0,
      started_at: null,
      uptime_secs: 0,
      last_success_at: Date.now() + 1000,
    });
    vi.mocked(sourceStart).mockClear();
    vi.mocked(sourceSnapshot).mockClear();
    const updated = await refreshDiscoverStories(initial, ["usgs"]);
    expect(sourceStart).not.toHaveBeenCalled();
    expect(sourceSnapshot).toHaveBeenCalledWith("usgs", SOURCE_EXPLORE_ROWS);
    expect(getDiscoverStoryCache()).toBe(initial);
    expect(updated.find((story) => story.kind === "meteo")).toBe(
      initial.find((story) => story.kind === "meteo"),
    );
    expect(updated.find((story) => story.kind === "usgs")).not.toBe(
      initial.find((story) => story.kind === "usgs"),
    );
  });

  it("does not advertise unchanged snapshots as new data", async () => {
    const capturedAt = Date.now() - 60_000;
    vi.mocked(sourceStatus).mockResolvedValue({
      running: true,
      buffer_rows: 2,
      total_events: 2,
      events_per_sec: 0,
      started_at: null,
      uptime_secs: 0,
      last_success_at: capturedAt,
    });
    const initial = await scanDiscoverStories({ includeWiki: false });
    expect(await refreshDiscoverStories(initial, ["usgs"])).toBe(initial);
  });

  it("keeps saved data on a failed partial refresh and honors cancellation", async () => {
    const initial = await scanDiscoverStories({ includeWiki: false });
    vi.mocked(sourceSnapshot).mockRejectedValueOnce(new Error("offline"));
    expect(await refreshDiscoverStories(initial, ["usgs"])).toBe(initial);
    const abort = new AbortController();
    abort.abort();
    expect(await refreshDiscoverStories(initial, ["usgs"], abort.signal)).toBe(
      initial,
    );
  });
});
