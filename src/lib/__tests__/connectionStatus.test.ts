// =================================================================
// connectionStatus tests (LOOM-416)
// =================================================================

import { describe, expect, it } from "vitest";
import { describeOfflineImpact, isRemoteDatasetPath, probeConnection } from "../connectionStatus";

describe("probeConnection", () => {
  it("is offline when the fetch rejects (not just navigator.onLine)", async () => {
    expect(await probeConnection(() => Promise.reject(new TypeError("Failed to fetch")), 50)).toBe(false);
  });
  it("is online on any HTTP response", async () => {
    expect(await probeConnection(async () => ({ ok: false }), 50)).toBe(true);
  });
});

describe("describeOfflineImpact", () => {
  it("names a live source that can't refresh and labels snapshot age", () => {
    const r = describeOfflineImpact({
      activePath: "stream://usgs",
      activeName: "USGS Earthquakes",
      durableUploadCount: 2,
      snapshotCapturedAt: 1_000_000,
      now: 1_000_000 + 5 * 60_000,
    });
    expect(r.remoteBlocked).toBe(true);
    expect(r.headline).toContain("can't refresh offline");
    expect(r.detail).toContain("5 min ago");
    expect(r.detail).toContain("2 saved uploads");
  });
  it("tells a cold session that durable uploads still open", () => {
    const r = describeOfflineImpact({ activePath: null, activeName: null, durableUploadCount: 1, snapshotCapturedAt: null });
    expect(r.remoteBlocked).toBe(false);
    expect(r.detail).toContain("1 saved upload still open from Recent files");
  });
  it("treats uploads as local", () => {
    expect(isRemoteDatasetPath("web://upload/a.csv")).toBe(false);
    expect(isRemoteDatasetPath("stream://wiki")).toBe(true);
  });
});
