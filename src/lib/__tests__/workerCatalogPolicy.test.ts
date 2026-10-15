import { describe, expect, it } from "vitest";
import {
  catalogSearchCacheKey,
  clampWorkerCatalogRows,
  sourceCacheKey,
  sourcePayloadCacheable,
  utf8ByteLength,
  validateOgImageBytes,
  worldBankDateRange,
  SOURCE_CACHE_SCHEMA_VERSION,
} from "../workerCatalogPolicy";

describe("workerCatalogPolicy", () => {
  it("clamps catalog rows and rejects NaN", () => {
    expect(clampWorkerCatalogRows("abc")).toBe(40);
    expect(clampWorkerCatalogRows(999)).toBe(200);
    expect(clampWorkerCatalogRows(0)).toBe(1);
  });

  it("versions source cache keys", () => {
    expect(sourceCacheKey("usgs")).toContain(String(SOURCE_CACHE_SCHEMA_VERSION));
  });

  it("measures UTF-8 bytes for story size caps", () => {
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("🎉")).toBe(4);
  });

  it("validates og image magic bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(validateOgImageBytes("image/png", png)).toBe(true);
    expect(validateOgImageBytes("image/jpeg", jpeg)).toBe(true);
    expect(validateOgImageBytes("image/png", jpeg)).toBe(false);
  });

  it("advances World Bank date range", () => {
    expect(worldBankDateRange(new Date("2026-06-01T00:00:00Z"))).toBe("2000:2025");
  });

  it("normalizes catalog cache keys", () => {
    const u = new URL("https://loom.ibm.io/api/catalog/us?rows=abc&q=water");
    expect(catalogSearchCacheKey("us", u)).toContain("rows=40");
    expect(catalogSearchCacheKey("us", u)).toContain("q=water");
  });

  it("rejects empty source payloads for cache write", () => {
    expect(sourcePayloadCacheable("opensky", JSON.stringify({ states: [] }))).toBe(false);
    expect(sourcePayloadCacheable("opensky", JSON.stringify({ states: [["x"]] }))).toBe(true);
    expect(sourcePayloadCacheable("firms", "[]")).toBe(false);
  });

  it("counts rows in columnar transforms (FIRMS / GDACS / ADSB)", () => {
    const columnar = (rows: unknown[][]) => JSON.stringify({ columns: ["a", "b"], rows });
    for (const kind of ["firms", "gdacs", "opensky"]) {
      expect(sourcePayloadCacheable(kind, columnar([[1, 2]])), kind).toBe(true);
      expect(sourcePayloadCacheable(kind, columnar([])), kind).toBe(false);
    }
    expect(sourcePayloadCacheable("buoys", columnar([]))).toBe(false);
  });
});
