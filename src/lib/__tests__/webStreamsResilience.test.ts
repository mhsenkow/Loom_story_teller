import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../openDataCatalog", () => ({
  apiUrl: (path: string) => `https://loom.test${path}`,
}));
import {
  webSourceStart,
  webSourceStatus,
  webSourceStop,
  webSourceClear,
  parseSourceRows,
} from "../webStreams";

const hnBody = {
  hits: [{ objectID: "1", title: "Hello", author: "a", points: 10, num_comments: 2, url: "https://x", created_at: "2026-10-02T12:00:00Z" }],
};

afterEach(async () => {
  await webSourceStop("hn");
  await webSourceClear("hn");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("web source polling resilience", () => {
  it("stop during the first poll does not schedule another fetch", async () => {
    vi.useFakeTimers();
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetches += 1;
            setTimeout(
              () => resolve(new Response(JSON.stringify(hnBody), { status: 200 })),
              5_000,
            );
          }),
      ),
    );

    const startP = webSourceStart("hn");
    await vi.advanceTimersByTimeAsync(50);
    await webSourceStop("hn");
    await vi.advanceTimersByTimeAsync(10_000);
    await startP;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetches).toBe(1);
  });

  it("clear resets events_per_sec to a non-negative value", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(hnBody), { status: 200 })));
    await webSourceStart("hn");
    await webSourceClear("hn");
    const s = await webSourceStatus("hn");
    expect(s.events_per_sec).toBeGreaterThanOrEqual(0);
  });

  it("keeps a feed running after a failed first poll, reports the error, and recovers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "HN 429" }), { status: 502 }))
      .mockResolvedValue(new Response(JSON.stringify(hnBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await webSourceStart("hn");
    let s = await webSourceStatus("hn");
    expect(s.running).toBe(true);
    expect(s.buffer_rows).toBe(0);
    expect(String(s.last_error ?? "")).toMatch(/HN 429/);

    // Next scheduled poll succeeds and clears the error
    await vi.advanceTimersByTimeAsync(300_000);
    s = await webSourceStatus("hn");
    expect(s.buffer_rows).toBe(1);
    expect(s.last_error).toBeNull();
  });

  it("does not schedule polls when stopped during the first await", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      polls += 1;
      await new Promise((r) => setTimeout(r, 500));
      return new Response(JSON.stringify(hnBody), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const startP = webSourceStart("hn");
    await vi.advanceTimersByTimeAsync(50);
    await webSourceStop("hn");
    await vi.advanceTimersByTimeAsync(600);
    await startP;
    await vi.advanceTimersByTimeAsync(300_000);

    expect(polls).toBe(1);
    const s = await webSourceStatus("hn");
    expect(s.running).toBe(false);
  });
});

describe("parseSpacex", () => {
  it("keeps unknown success as null for upcoming flights", () => {
    const rows = parseSourceRows("spacex", [
      { id: "1", name: "A", success: true, upcoming: false },
      { id: "2", name: "B", success: true, upcoming: false },
      { id: "3", name: "C", success: null, upcoming: true },
    ]);
    expect(rows.map((r) => r[3])).toEqual([true, true, null]);
  });
});
