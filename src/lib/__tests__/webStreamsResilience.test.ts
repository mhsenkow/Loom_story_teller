import { afterEach, describe, expect, it, vi } from "vitest";
import { webSourceStart, webSourceStatus, webSourceStop, webSourceClear } from "../webStreams";

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
    expect(s.last_error).toMatch(/HN 429/);

    // Next scheduled poll succeeds and clears the error
    await vi.advanceTimersByTimeAsync(120_000);
    s = await webSourceStatus("hn");
    expect(s.buffer_rows).toBe(1);
    expect(s.last_error).toBeNull();
  });
});
