import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openDataCatalog", () => ({
  apiUrl: (path: string) => `https://loom.test${path}`,
}));

const hnBody = {
  hits: [{ objectID: "1", title: "Hello", author: "a", points: 10, num_comments: 2, url: "https://x", created_at: "2026-10-02T12:00:00Z" }],
};

type Listener = () => void;
let docListeners: Record<string, Listener[]> = {};
const doc = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener: (type: string, fn: Listener) => {
    (docListeners[type] ??= []).push(fn);
  },
};

function setVisible(visible: boolean) {
  doc.visibilityState = visible ? "visible" : "hidden";
  for (const fn of docListeners.visibilitychange ?? []) fn();
}

/** Fresh webStreams + appActivity with the visibility hook wired to the stub document. */
async function loadWebStreams() {
  vi.resetModules();
  docListeners = {};
  doc.visibilityState = "visible";
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const activity = await import("../appActivity");
  activity._resetAppActivityForTests();
  const ws = await import("../webStreams");
  const { effectivePollIntervalMs } = await import("../sourceRegistry");
  await vi.dynamicImportSettled();
  return { ws, pollMs: effectivePollIntervalMs("hn") };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Pin the ±15% poll jitter to exactly 1x so interval counts are exact.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("web source polling across hide/show", () => {
  it("a short hide during an in-flight poll does not leave two poll loops", async () => {
    const { ws, pollMs } = await loadWebStreams();
    let release: (() => void) | null = null;
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetches += 1;
        if (fetches === 1) {
          return new Promise<Response>((resolve) => {
            release = () => resolve(new Response(JSON.stringify(hnBody), { status: 200 }));
          });
        }
        return Promise.resolve(new Response(JSON.stringify(hnBody), { status: 200 }));
      }),
    );

    const startP = ws.webSourceStart("hn");
    await vi.advanceTimersByTimeAsync(10);
    expect(fetches).toBe(1);
    setVisible(false);
    release!();
    await startP;
    setVisible(true);
    await vi.advanceTimersByTimeAsync(10);
    // Resume runs one poll of its own; the in-flight loop must not have re-armed.
    expect(fetches).toBe(2);
    // One loop → three more polls in 3.5 intervals (two loops would make six).
    await vi.advanceTimersByTimeAsync(Math.round(pollMs * 3.5));
    expect(fetches).toBe(2 + 3);
    await ws.webSourceStop("hn");
  });

  it("a failing feed keeps its backoff and friendly error after hide/show", async () => {
    const { ws, pollMs } = await loadWebStreams();
    const callTimes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callTimes.push(Date.now());
        return Promise.resolve(new Response(JSON.stringify({}), { status: 503 }));
      }),
    );

    await ws.webSourceStart("hn");
    setVisible(false);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(pollMs * 40);
    const gaps = callTimes.slice(2).map((t, i) => t - callTimes[i + 1]);
    // Backoff doubles per failure (capped at 10x): 4x, 8x, 10x after the resume poll.
    expect(gaps.slice(0, 3)).toEqual([pollMs * 4, pollMs * 8, pollMs * 10]);
    const status = await ws.webSourceStatus("hn");
    expect(status.last_error).toBe(ws.formatStreamFetchError("hn", new Error("Source hn failed (503)")));
    await ws.webSourceStop("hn");
  });
});
