/**
 * Unit tests for geographic atlas join keys and geo map kinds.
 */
import { describe, it, expect } from "vitest";
import {
  getWorldAtlas,
  getUsAtlas,
  findFeatureIndex,
  joinKeyCandidates,
  pickAtlasKind,
  isGeoRegionField,
  isLatField,
  isLonField,
} from "../geoAtlas";
import {
  GEO_MAP_KINDS,
  isGeoMapKind,
  isGeoFamilyKind,
  geoMapDataSupport,
  getGeoMapRandomEncoding,
  buildGeoMapRec,
  geoMapRecommendationReason,
} from "../geoMaps";
import type { ColumnInfo } from "../store";

const geoCols: ColumnInfo[] = [
  { name: "longitude", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-180", max_value: "180" },
  { name: "latitude", data_type: "DOUBLE", null_count: 0, distinct_count: 100, min_value: "-90", max_value: "90" },
  { name: "magnitude", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "8" },
  { name: "country", data_type: "VARCHAR", null_count: 0, distinct_count: 50, min_value: null, max_value: null },
  { name: "state", data_type: "VARCHAR", null_count: 0, distinct_count: 50, min_value: null, max_value: null },
  { name: "cca3", data_type: "VARCHAR", null_count: 0, distinct_count: 50, min_value: null, max_value: null },
];

describe("geoAtlas", () => {
  it("indexes world features by name and ISO codes", () => {
    const world = getWorldAtlas();
    expect(world.features.length).toBeGreaterThan(100);
    expect(findFeatureIndex(world, "USA")).toBeGreaterThanOrEqual(0);
    expect(findFeatureIndex(world, "United States of America")).toBeGreaterThanOrEqual(0);
    expect(findFeatureIndex(world, "US")).toBeGreaterThanOrEqual(0);
    expect(findFeatureIndex(world, "840")).toBeGreaterThanOrEqual(0);
    expect(findFeatureIndex(world, "BRA")).toBeGreaterThanOrEqual(0);
  });

  it("indexes US states by name, FIPS, and abbreviation", () => {
    const us = getUsAtlas();
    expect(us.features.length).toBeGreaterThan(40);
    expect(findFeatureIndex(us, "California")).toBeGreaterThanOrEqual(0);
    expect(findFeatureIndex(us, "CA")).toBeGreaterThanOrEqual(0);
    expect(findFeatureIndex(us, "06")).toBeGreaterThanOrEqual(0);
  });

  it("pickAtlasKind prefers US for state samples", () => {
    expect(pickAtlasKind("state", ["CA", "TX", "NY", "FL"])).toBe("us");
    expect(pickAtlasKind("country_code", ["USA", "BRA", "DEU"])).toBe("world");
  });

  it("detects geo field names", () => {
    expect(isGeoRegionField("country_code")).toBe(true);
    expect(isGeoRegionField("cca3")).toBe(true);
    expect(isLatField("latitude")).toBe(true);
    expect(isLonField("longitude")).toBe(true);
    expect(joinKeyCandidates("usa").length).toBeGreaterThan(0);
  });
});

describe("geoMaps", () => {
  it("registers map/globe kinds", () => {
    expect(GEO_MAP_KINDS).toContain("geoPoints");
    expect(GEO_MAP_KINDS).toContain("globe");
    expect(GEO_MAP_KINDS).toContain("globeTrail");
    expect(GEO_MAP_KINDS).toContain("arcMap");
    for (const k of GEO_MAP_KINDS) {
      expect(isGeoMapKind(k)).toBe(true);
      expect(isGeoFamilyKind(k)).toBe(true);
      expect(geoMapRecommendationReason(k).length).toBeGreaterThan(8);
    }
    expect(isGeoFamilyKind("choropleth")).toBe(true);
  });

  it("supports lat/lon schemas and region schemas", () => {
    expect(geoMapDataSupport(geoCols, "geoPoints").ok).toBe(true);
    expect(geoMapDataSupport(geoCols, "globe").ok).toBe(true);
    expect(geoMapDataSupport(geoCols, "choropleth").ok).toBe(true);
  });

  it("builds recommendations for geo kinds", () => {
    for (const kind of GEO_MAP_KINDS) {
      const enc = getGeoMapRandomEncoding(geoCols, kind);
      expect(enc).not.toBeNull();
      const rec = buildGeoMapRec(kind, geoCols, enc!.xField, enc!.yField, enc!.colorField, {
        sizeField: enc!.sizeField,
      });
      expect(rec).not.toBeNull();
      expect(rec!.kind).toBe(kind);
    }
  });

  it("choropleth random encoding uses a region field", () => {
    const enc = getGeoMapRandomEncoding(geoCols, "choropleth");
    expect(enc).not.toBeNull();
    expect(["country", "state", "cca3"]).toContain(enc!.xField);
  });
});
