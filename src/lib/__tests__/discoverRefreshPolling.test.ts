import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scanDiscoverStories, stopDiscoverProbes } from "../discoverStories";
import {
  sourceStart,
  sourceStop,
  sourceStatus,
  streamStart,
  streamStatus,
  streamSnapshot,
} from "../tauri";
import { recommendSourceStory } from "../recommendations";

// Feed health is advisory network I/O — keep scans hermetic.
vi.mock("../sourceHealth", async (original) => ({
  ...(await original<typeof import("../sourceHealth")>()),
  loadFeedHealth: vi.fn(async () => ({})),
}));
vi.mock("../tauri", async (original) => ({
  ...(await original<typeof import("../tauri")>()),
  ALL_SOURCE_KINDS: ["climate"],
  sourceStart: vi.fn(async () => {}),
  sourceStop: vi.fn(async () => {}),
  sourceStatus: vi.fn(),
  streamStart: vi.fn(async () => {}),
  streamStop: vi.fn(async () => {}),
  streamStatus: vi.fn(),
  streamSnapshot: vi.fn(),
  sourceSnapshot: vi.fn(async () => ({
    stats: [],
    sample: {
      columns: ["city", "value"],
      types: ["VARCHAR", "DOUBLE"],
      rows: [
        ["East", 1],
        ["West", 3],
      ],
      total_rows: 2,
    },
  })),
}));
vi.mock("../recommendations", () => ({
  recommendStreamStory: (...args: unknown[]) =>
    recommendSourceStory(...(args as Parameters<typeof recommendSourceStory>)),
  recommendSourceStory: () => ({
    charts: [
      {
        id: "c",
        kind: "bar",
        title: "Readings",
        subtitle: "",
        score: 90,
        spec: {},
        xField: "city",
        yField: "value",
        colorField: null,
        yAggregate: "mean",
      },
    ],
  }),
}));
vi.mock("../discoverHooks", () => ({
  discoverHookFor: () => ({
    hook: "Readings",
    blurb: "",
    score: 90,
    category: "Climate",
  }),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => stopDiscoverProbes());
const status = (last_success_at: number) => ({
  running: true,
  buffer_rows: 2,
  total_events: 2,
  events_per_sec: 0,
  started_at: null,
  uptime_secs: 0,
  last_success_at,
});

it("rechecks an already-running load-once feed after a day without taking ownership of the connection", async () => {
  vi.mocked(sourceStatus).mockResolvedValue(status(Date.now()));
  vi.mocked(sourceStatus).mockResolvedValueOnce(
    status(Date.now() - 2 * 86_400_000),
  );
  const found = await scanDiscoverStories({
    includeWiki: false,
    commitCache: false,
  });
  expect(found.length).toBeGreaterThan(0);
  expect(sourceStop).toHaveBeenCalledTimes(1);
  expect(sourceStart).toHaveBeenCalledWith("climate");
  await stopDiscoverProbes();
  expect(sourceStop).toHaveBeenCalledTimes(1);
});

it("keeps a recently checked load-once connection running", async () => {
  vi.mocked(sourceStatus).mockResolvedValue(status(Date.now()));
  await scanDiscoverStories({ includeWiki: false, commitCache: false });
  expect(sourceStop).not.toHaveBeenCalled();
  expect(sourceStart).not.toHaveBeenCalled();
});

it("waits for inserted events when reconnecting Wikipedia instead of relabeling the saved buffer", async () => {
  vi.mocked(streamStatus).mockResolvedValue({
    ...status(Date.now()),
    running: false,
    wikis_seen: 1,
  });
  const old = {
    stats: [],
    sample: {
      columns: ["city", "value"],
      types: ["VARCHAR", "DOUBLE"],
      rows: [
        ["East", 1],
        ["West", 3],
      ],
      total_rows: 2,
    },
  };
  const fresh = {
    ...old,
    sample: {
      ...old.sample,
      rows: [
        ["East", 7],
        ["West", 8],
      ],
    },
  };
  vi.mocked(streamSnapshot)
    .mockResolvedValue(fresh)
    .mockResolvedValueOnce(old)
    .mockResolvedValueOnce(old);
  const found = await scanDiscoverStories({
    kinds: ["wiki"],
    commitCache: false,
  });
  expect(streamStart).toHaveBeenCalledOnce();
  expect(streamSnapshot).toHaveBeenCalledTimes(3);
  expect(found[0]?.sample).toBe(fresh.sample);
});
