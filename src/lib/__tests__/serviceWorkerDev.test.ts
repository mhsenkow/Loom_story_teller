import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../../public/sw.js"),
  "utf8",
);

function loadWorker(production: boolean) {
  const listeners = new Map<string, (event: unknown) => void>();
  const cached = new Response("cached chunk");
  const match = vi.fn().mockResolvedValue(cached);
  const open = vi.fn().mockResolvedValue({ match, put: vi.fn() });
  const fetch = vi.fn();
  runInNewContext(
    production
      ? source.replace(
          'const BUILD_ID = "dev"',
          'const BUILD_ID = "test-release"',
        )
      : source,
    {
      self: {
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
        location: { origin: "https://loom.example" },
      },
      caches: { open },
      URL,
      Response,
      Headers,
      fetch,
    },
  );
  return { listeners, cached, open, fetch };
}

describe("service worker development boundary", () => {
  it("leaves development chunks, navigation and API responses to the browser", () => {
    const worker = loadWorker(false);
    for (const path of [
      "/_next/static/chunks/app.js",
      "/",
      "/api/source/usgs",
    ]) {
      const respondWith = vi.fn();
      worker.listeners.get("fetch")!({
        request: {
          url: `https://loom.example${path}`,
          method: "GET",
          mode: "navigate",
        },
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(worker.open).not.toHaveBeenCalled();
  });
  it("retains production chunk caching for offline use", async () => {
    const worker = loadWorker(true);
    const respondWith = vi.fn();
    worker.listeners.get("fetch")!({
      request: {
        url: "https://loom.example/_next/static/chunks/app.js",
        method: "GET",
      },
      respondWith,
    });
    expect(await respondWith.mock.calls[0][0]).toBe(worker.cached);
    expect(worker.open).toHaveBeenCalledWith("loom-static-test-release");
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
